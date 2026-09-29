"""Examiner Review Lab: sampling + prediction-powered inference (PPI).

Population: an entity's closed, human-handled cases. Target: the share handled
superficially. Examiners label a *uniform random* sample (so the PPI interval is
valid); an additional *targeted* sample (the cases the model rates most likely to
be superficial) is offered to confirm weaknesses faster. It is reported separately
and never enters the estimate. Labels: 1 = superficial."""

from __future__ import annotations

import numpy as np
import pandas as pd

from satsa import ledger
from satsa.stats.core import ppi_mean_ci
from satsa.pipeline import TRUTH_DIR

ALPHA = 0.1  # 90% intervals
MIN_LABELS_PPI = 20  # below this the PPI variance estimate is unreliable; show classical only


def population(con, entity_id: str) -> pd.DataFrame:
    return con.execute(
        "SELECT case_id, severity, category, yhat, ttc_min, notes, p_fast, templated, n_investigate, escalated "
        "FROM case_features WHERE entity_id = ? AND closed AND NOT auto_closed", [entity_id]).df()


def create_sample(con, entity_id: str, n_random: int = 20, n_active: int = 10, seed: int | None = None) -> pd.DataFrame:
    pop = population(con, entity_id)
    rng = np.random.default_rng(seed)
    existing = con.execute("SELECT case_id FROM review_samples WHERE entity_id = ?", [entity_id]).df().case_id
    pool = pop[~pop.case_id.isin(existing)]
    rnd = pool.sample(n=min(n_random, len(pool)), random_state=int(rng.integers(1e9)))
    rest = pool[~pool.case_id.isin(rnd.case_id)]
    act = rest.nlargest(n_active, "yhat")
    rows = [(entity_id, c, "random") for c in rnd.case_id] + [(entity_id, c, "active") for c in act.case_id]
    start = len(existing)
    for i, (e, c, t) in enumerate(rows):
        con.execute("INSERT INTO review_samples VALUES (?, ?, ?, ?, now())", [e, c, t, start + i + 1])
    ledger.append("review_sample_drawn", {"entity_id": entity_id, "random": len(rnd), "active": len(act)})
    return get_sample(con, entity_id)


def get_sample(con, entity_id: str) -> pd.DataFrame:
    return con.execute("""
        SELECT s.case_id, s.sample_type, s.rank, f.severity, f.category, f.ttc_min, f.notes, f.yhat,
               f.n_investigate, f.escalated, l.label, l.reviewer, l.blind_first
        FROM review_samples s JOIN case_features f USING (case_id)
        LEFT JOIN (SELECT * FROM review_labels QUALIFY row_number() OVER (PARTITION BY case_id ORDER BY ts DESC) = 1) l
          USING (case_id)
        WHERE s.entity_id = ? ORDER BY s.rank""", [entity_id]).df()


def add_label(con, entity_id: str, case_id: str, label: int, reviewer: str = "examiner", blind_first: bool = True,
              sample_type: str | None = None):
    con.execute("INSERT INTO review_labels VALUES (?, ?, ?, ?, ?, ?, now())",
                [entity_id, case_id, int(label), reviewer, sample_type, blind_first])
    ledger.append("examiner_verdict", {"entity_id": entity_id, "case_id": case_id, "label": int(label),
                                       "blind_first": blind_first}, actor=reviewer)


def simulate_labels(con, entity_id: str, n: int = 5) -> int:
    """DEMO ONLY: label the next n unlabeled sampled cases with the hidden answer key,
    as a stand-in for a human examiner. Recorded in the ledger as simulated."""
    s = get_sample(con, entity_id)
    todo = s[s.label.isna()].sort_values(["sample_type", "rank"], ascending=[False, True]).head(n)
    if todo.empty:
        return 0
    truth = pd.read_parquet(TRUTH_DIR / "case_truth.parquet").set_index("case_id").superficial
    for r in todo.itertuples():
        add_label(con, entity_id, r.case_id, int(truth.get(r.case_id, False)), reviewer="simulated-examiner",
                  sample_type=r.sample_type)
    return len(todo)


def estimate(con, entity_id: str) -> dict:
    pop = population(con, entity_id)
    s = get_sample(con, entity_id)
    lab = s[s.label.notna() & (s.sample_type == "random")]
    out = {"population": int(len(pop)), "n_labeled_random": int(len(lab)),
           "n_labeled_active": int((s.label.notna() & (s.sample_type == "active")).sum()),
           "n_sampled": int(len(s)), "model_mean": float(pop.yhat.mean()) if len(pop) else None, "alpha": ALPHA}
    n0, k0 = len(lab), float(lab.label.sum()) if len(lab) else 0.0
    if n0:
        z0 = 1.6448536269514722
        c0 = (k0 + z0 * z0 / 2) / (n0 + z0 * z0)
        h0 = z0 * np.sqrt(k0 * (n0 - k0) / n0 + z0 * z0 / 4) / (n0 + z0 * z0)
        out["classical"] = {"estimate": k0 / n0, "lo": max(0.0, c0 - h0), "hi": min(1.0, c0 + h0), "width": 2 * h0}
    if n0 < MIN_LABELS_PPI:
        out["status"] = "collecting"
        out["labels_needed"] = MIN_LABELS_PPI - n0
        return out
    Y = lab.label.to_numpy(float)
    Yhat = lab.yhat.to_numpy(float)
    unl = pop[~pop.case_id.isin(lab.case_id)].yhat.to_numpy(float)
    ppi = ppi_mean_ci(Y, Yhat, unl, alpha=ALPHA)
    lo, hi, point = ppi["lo"], ppi["hi"], ppi["estimate"]
    # classical interval: Wilson score (valid at small n, unlike the normal approximation)
    n, k = len(Y), Y.sum()
    z = 1.6448536269514722
    c = (k + z * z / 2) / (n + z * z)
    h = z * np.sqrt(k * (n - k) / n + z * z / 4) / (n + z * z)
    clo, chi = max(0.0, c - h), min(1.0, c + h)
    lo, hi = max(0.0, lo), min(1.0, hi)
    w_ppi, w_cls = hi - lo, chi - clo
    ratio = (w_ppi / w_cls) ** 2 if w_cls > 0 else 1.0
    half = 0.03
    p_ = min(max(point, 0.02), 0.98)
    n_cls = int(np.ceil(z * z * p_ * (1 - p_) / half ** 2))
    out.update({"status": "ok", "ppi": {"estimate": point, "lo": lo, "hi": hi, "width": w_ppi, "lambda": ppi["lambda"]},
                "classical": {"estimate": float(k / n), "lo": clo, "hi": chi, "width": w_cls},
                "review_saving": float(max(0.0, 1 - ratio)),
                "planner": {"target_half_width": half, "reviews_manual_only": n_cls,
                            "reviews_with_satsa": int(np.ceil(n_cls * min(1.0, ratio)))}})
    return out


def reset(con, entity_id: str):
    con.execute("DELETE FROM review_labels WHERE entity_id = ?", [entity_id])
    con.execute("DELETE FROM review_samples WHERE entity_id = ?", [entity_id])
