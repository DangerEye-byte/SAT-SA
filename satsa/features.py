"""Case-level feature engineering shared by detectors, the PPI predictor and the UI."""

from __future__ import annotations

import re

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import HashingVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import normalize

from satsa.stats.core import conformal_left_pvalues

CASE_FEAT_SQL = """
WITH ev AS (
  SELECT e.case_id,
         count(*) AS n_events,
         count(*) FILTER (WHERE activity = 'investigate') AS n_investigate,
         count(*) FILTER (WHERE activity = 'triage') AS n_triage,
         count(*) FILTER (WHERE activity = 'escalate') AS n_escalate_ev,
         count(*) FILTER (WHERE activity = 'contain') AS n_contain,
         count(*) FILTER (WHERE activity = 'remediate') AS n_remediate_ev,
         count(*) FILTER (WHERE activity IN ('playbook', 'enrich')) AS n_automation,
         count(*) FILTER (WHERE activity = 'close') AS n_close,
         min(ts) FILTER (WHERE activity = 'triage') AS triage_ts
  FROM case_events e GROUP BY e.case_id
)
SELECT c.*, ev.* EXCLUDE (case_id),
       date_diff('second', c.opened_ts, c.closed_ts) / 60.0 AS ttc_min,
       date_diff('second', c.opened_ts, c.ack_ts) / 60.0 AS ack_min,
       hour(c.opened_ts) AS open_hour,
       (year(c.opened_ts) - 2025) * 12 + month(c.opened_ts) - 10 AS month_idx,
       strftime(c.opened_ts, '%Y-%m') AS period
FROM cases c LEFT JOIN ev USING (case_id)
"""

_punct = re.compile(r"[^\w\s]")
_ws = re.compile(r"\s+")


def _norm_note(s: str) -> str:
    return _ws.sub(" ", _punct.sub(" ", str(s).lower())).strip()


def template_clusters(notes: pd.Series, threshold: float = 0.9, min_cluster: int = 5,
                      fuzzy_max_len: int = 200, fuzzy_max_distinct: int = 3000) -> tuple[np.ndarray, np.ndarray]:
    """For one entity's notes return (cluster_size, cluster_key) per note.

    Short notes (where templates live) are compared fuzzily: cosine >= threshold on
    char 3-5-gram hashed vectors. Long, specific notes are compared exactly
    (after normalisation), which keeps the cost linear in the number of notes."""
    norm = notes.fillna("").map(_norm_note)
    counts = norm.value_counts()
    distinct = counts.index.to_list()
    cnt = counts.to_numpy()
    if not distinct:
        return np.zeros(len(notes), int), np.full(len(notes), -1)
    size = cnt.astype(float).copy()
    key = np.arange(len(distinct))
    short = np.array([len(s) <= fuzzy_max_len for s in distinct])
    si = np.where(short)[0]
    if 1 < len(si) <= fuzzy_max_distinct:
        hv = HashingVectorizer(analyzer="char_wb", ngram_range=(3, 5), n_features=2 ** 18, alternate_sign=False, norm=None)
        X = normalize(hv.transform([distinct[i] for i in si]))
        sim = (X @ X.T).tocsr()
        sim.data[sim.data < threshold] = 0
        sim.eliminate_zeros()
        c_short = cnt[si]
        size[si] = np.asarray(sim.astype(bool) @ c_short).ravel()
        for j, i in enumerate(si):
            nb = sim.indices[sim.indptr[j]:sim.indptr[j + 1]]
            key[i] = si[nb[np.argmax(c_short[nb])]] if len(nb) else i
    idx = pd.Series(np.arange(len(distinct)), index=distinct)
    pos = norm.map(idx).to_numpy()
    sz = np.where(size[pos] >= min_cluster, size[pos], 0).astype(int)
    return sz, key[pos]


def build_case_features(con) -> pd.DataFrame:
    cf = con.execute(CASE_FEAT_SQL).df()
    for c in ["n_events", "n_investigate", "n_triage", "n_escalate_ev", "n_contain", "n_remediate_ev", "n_automation", "n_close"]:
        cf[c] = cf[c].fillna(0).astype(int)
    cf["closed"] = cf.closed_ts.notna()
    cf["night"] = cf.open_hour < 6
    cf["note_len"] = cf.notes.fillna("").str.len()
    cf["short_note"] = cf.note_len < 40
    cf["injection_like"] = cf.notes.fillna("").str.contains(
        r"ignore (all )?(previous|prior)|you are now|\[\[assistant\]\]|note to ai|mark this (entity|case)|system:",
        case=False, regex=True)

    # Leave-one-entity-out conformal p-value for "unusually fast closure"
    p_fast = np.full(len(cf), np.nan)
    elig = (cf.closed & ~cf.auto_closed & (cf.ttc_min > 0)).to_numpy()
    sub = cf.loc[elig, ["severity", "category", "entity_id", "ttc_min"]]
    pos_all = np.where(elig)[0]
    for _, cell_idx in sub.groupby(["severity", "category"]).indices.items():
        t_cell = sub.ttc_min.to_numpy()[cell_idx]
        all_sorted = np.sort(t_cell)
        ent = sub.entity_id.to_numpy()[cell_idx]
        for eid in np.unique(ent):
            m = ent == eid
            t = t_cell[m]
            own = np.sort(t)
            k = np.searchsorted(all_sorted, t, side="right") - np.searchsorted(own, t, side="right")
            n = len(all_sorted) - len(own)
            p_fast[pos_all[cell_idx[m]]] = (1 + k) / (n + 1) if n > 0 else 1.0
    cf["p_fast"] = p_fast

    # Template / near-duplicate notes, per entity (automation notes excluded)
    cf["template_cluster"] = 0
    cf["template_key"] = ""
    human = ~cf.auto_closed
    for eid, grp in cf[human].groupby("entity_id"):
        size, key = template_clusters(grp.notes)
        cf.loc[grp.index, "template_cluster"] = size
        cf.loc[grp.index, "template_key"] = [f"{eid}:{k}" for k in key]
    cf["templated"] = cf.template_cluster > 0
    return cf


PRED_FEATURES = ["neglogp_fast", "n_investigate", "n_triage", "templated", "short_note", "log_note_len",
                 "escalated", "is_critical", "ioc_enriched", "night", "log_ack"]


def _xmat(cf: pd.DataFrame) -> np.ndarray:
    X = pd.DataFrame({
        "neglogp_fast": -np.log10(cf.p_fast.fillna(1.0).clip(1e-6, 1)),
        "n_investigate": cf.n_investigate.clip(0, 5),
        "n_triage": cf.n_triage.clip(0, 2),
        "templated": cf.templated.astype(float),
        "short_note": cf.short_note.astype(float),
        "log_note_len": np.log1p(cf.note_len),
        "escalated": cf.escalated.astype(float),
        "is_critical": (cf.severity == "critical").astype(float),
        "ioc_enriched": cf.ioc_enriched.astype(float),
        "night": cf.night.astype(float),
        "log_ack": np.log1p(cf.ack_min.clip(lower=0).fillna(0)),
    })
    return X.to_numpy()


def fit_superficial_model(cf: pd.DataFrame, prior_labels: pd.DataFrame, seed: int = 0):
    """Train the 'superficial handling' predictor on prior-cycle examiner labels.
    prior_labels: case_id, label (1 = superficial). Returns (model, yhat for all cases)."""
    tr = cf.merge(prior_labels, on="case_id")
    model = LogisticRegression(max_iter=2000, C=1.0, class_weight=None, random_state=seed)
    model.fit(_xmat(tr), tr.label.astype(int))
    yhat = model.predict_proba(_xmat(cf))[:, 1]
    return model, yhat
