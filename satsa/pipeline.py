"""End-to-end analysis run: canonical tables -> features -> detectors ->
calibrated entity scores -> analysis tables in DuckDB + ledger entries.

Usage:  python -m satsa.pipeline [--regen] [--seed 7]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from satsa import __version__, ledger, taxonomy as tx
from satsa.detect import detectors as D
from satsa.features import build_case_features, fit_superficial_model
from satsa.stats.core import acat, attention_index, bh, ebh, p_to_e, qvalues, rate_test
from satsa.store import DATA, POINTER, connect, load_parquet_dir, write_tables

GEN_DIR = DATA / "generated"
TRUTH_DIR = GEN_DIR / "_truth"
CODE_DIR = Path(__file__).resolve().parent


def _hash_files(paths) -> str:
    h = hashlib.sha256()
    for p in sorted(paths):
        h.update(Path(p).name.encode())
        h.update(Path(p).read_bytes())
    return h.hexdigest()


def code_hash() -> str:
    return _hash_files([p for p in CODE_DIR.rglob("*.py")])[:16]


def prior_labels(cf: pd.DataFrame, frac: float = 0.03, seed: int = 11, truth_dir: Path = TRUTH_DIR) -> pd.DataFrame:
    """Simulated prior-cycle examiner labels used to train the superficiality predictor.
    In production these are the examiners' confirmed verdicts from earlier cycles."""
    truth = pd.read_parquet(Path(truth_dir) / "case_truth.parquet")
    pool = cf[cf.closed & ~cf.auto_closed][["case_id"]].merge(truth, on="case_id")
    s = pool.sample(frac=frac, random_state=seed)
    return s.rename(columns={"superficial": "label"})[["case_id", "label"]]


def _json(v):
    return json.dumps(v, default=lambda o: o.item() if hasattr(o, "item") else str(o))


def score_entities(res: pd.DataFrame, entities: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for eid in entities.entity_id:
        r = res[res.entity_id == eid]
        stat = r[~r.deterministic & r.p_value.notna()]
        det = r[r.deterministic & r.severity.notna()]
        p_ent = acat(stat.p_value.to_numpy()) if len(stat) else 1.0
        caps = {c: 0.0 for c in tx.CAPABILITIES}
        for x in r.itertuples():
            cap = D.DETECTORS[x.detector_id][2]
            if x.deterministic and x.severity:
                caps[cap] = max(caps[cap], D.DET_SCORE[x.severity])
            elif np.isfinite(x.p_value):
                caps[cap] = max(caps[cap], attention_index(x.p_value))
        top = stat.sort_values("p_value").head(3)
        reasons = [{"detector_id": x.detector_id, "name": D.DETECTORS[x.detector_id][0], "p_value": float(x.p_value),
                    "effect": x.effect} for x in top.itertuples() if x.p_value < 0.01]
        reasons += [{"detector_id": x.detector_id, "name": D.DETECTORS[x.detector_id][0], "p_value": None,
                     "effect": x.effect, "deterministic": True, "severity": x.severity} for x in det.itertuples()]
        rows.append({"entity_id": eid, "p_value": p_ent, "n_tests": len(stat),
                     "n_deterministic": len(det), "det_severity": (det.severity.map({"high": 2, "medium": 1}).max()
                                                                  if len(det) else 0),
                     "capabilities": _json(caps), "top_reasons": _json(reasons)})
    sc = pd.DataFrame(rows)
    sc["q_value"] = qvalues(sc.p_value.to_numpy())
    det_score = sc.det_severity.map({2: D.DET_SCORE["high"], 1: D.DET_SCORE["medium"], 0: 0.0}).fillna(0)
    sc["attention"] = np.maximum([attention_index(q) for q in sc.q_value], det_score).round(1)
    return sc.merge(entities, on="entity_id")


def trust_scores(ctx, res: pd.DataFrame) -> pd.DataFrame:
    """Data-trust score per submission set: mean of completeness, temporal sanity,
    timeliness and history coverage. Low trust downgrades findings to 'insufficient evidence'."""
    cf, subs, al = ctx.cf, ctx.submissions, ctx.alerts
    rows = []
    for eid in ctx.entities.entity_id:
        hc = al[(al.entity_id == eid) & al.severity.isin(["high", "critical"]) & ~al.redteam]
        completeness = float(hc.alert_id.isin(cf.alert_id).mean()) if len(hc) else 1.0
        c = cf[cf.entity_id == eid]
        sanity = float((c.ack_min >= 0).mean()) if len(c) else 1.0
        s = subs[subs.entity_id == eid]
        timeliness = float((s.received_ts <= s.due_ts).mean()) if len(s) else 1.0
        a = al[al.entity_id == eid]
        span = (a.ts.max() - a.ts.min()).days + 1 if len(a) else 0
        coverage = float(min(1.0, span / 180))
        rows.append({"entity_id": eid, "trust_completeness": completeness, "trust_temporal": sanity,
                     "trust_timeliness": timeliness, "trust_coverage": coverage,
                     "trust_score": round(100 * np.mean([completeness, sanity, timeliness, coverage]), 1)})
    return pd.DataFrame(rows)


def monthly_trends(cf: pd.DataFrame) -> pd.DataFrame:
    hc = cf[~cf.auto_closed]
    g = hc.groupby(["entity_id", "period"])
    out = pd.DataFrame({
        "cases": g.size(),
        "fast_share": g.apply(lambda d: float((d.p_fast <= 0.05).mean()) if d.p_fast.notna().any() else np.nan, include_groups=False),
        "no_investigation_share": g.apply(lambda d: float((d[d.severity.isin(["high", "critical"])].n_investigate == 0).mean()), include_groups=False),
        "templated_share": g.templated.mean(),
        "median_ttc_critical": g.apply(lambda d: float(d[d.severity == "critical"].ttc_min.median()), include_groups=False),
        "escalation_rate_critical": g.apply(lambda d: float(d[d.severity == "critical"].escalated.mean()), include_groups=False),
        "mean_superficial_score": g.yhat.mean(),
    }).reset_index()
    return out


def hourly_profile(cf: pd.DataFrame) -> pd.DataFrame:
    hc = cf[~cf.auto_closed & cf.severity.isin(["high", "critical"])].copy()
    hc["dow"] = hc.opened_ts.dt.dayofweek
    g = hc.groupby(["entity_id", "dow", "open_hour"])
    return pd.DataFrame({"cases": g.size(), "median_ack_min": g.ack_min.median(),
                         "slow_ack_share": g.ack_min.apply(lambda s: float((s > 60).mean()))}).reset_index()


def provider_lens(cf: pd.DataFrame, entities: pd.DataFrame) -> pd.DataFrame:
    """Systemic provider effect (D11). Each entity's share of likely-superficial cases
    (model score > 0.5) on the logit scale; a random-effects model (between-entity
    variance tau^2, DerSimonian-Laird) separates a provider-level shift from ordinary
    entity-to-entity variation. Effect reported in percentage points with a 90% CI."""
    from scipy import stats as st
    hc = cf[cf.closed & ~cf.auto_closed].merge(entities[["entity_id", "soc_provider"]], on="entity_id")
    hc["weak"] = hc.yhat > 0.5
    by = hc.groupby("entity_id").agg(k=("weak", "sum"), n=("weak", "size"), prov=("soc_provider", "first"))
    by["y"] = np.log((by.k + 0.5) / (by.n - by.k + 0.5))
    by["v"] = 1 / (by.k + 0.5) + 1 / (by.n - by.k + 0.5)

    def re_mean(g):
        w = 1 / g.v
        mu_fe = np.sum(w * g.y) / w.sum()
        qstat = np.sum(w * (g.y - mu_fe) ** 2)
        c = w.sum() - np.sum(w ** 2) / w.sum()
        tau2 = max(0.0, (qstat - (len(g) - 1)) / c) if len(g) > 1 and c > 0 else 0.0
        ws = 1 / (g.v + tau2)
        return float(np.sum(ws * g.y) / ws.sum()), float(1 / ws.sum()), tau2

    expit = lambda x: 1 / (1 + np.exp(-x))  # noqa: E731
    z90 = st.norm.ppf(0.95)
    rows = []
    for prov, g in by.groupby("prov"):
        others = by[by.prov != prov]
        clients = entities[entities.soc_provider == prov]
        row = {"provider": prov, "n_clients": len(g), "clients": _json(g.index.tolist()),
               "sectors": _json(sorted(clients.sector.unique().tolist())), "rate": float(g.k.sum() / g.n.sum()),
               "others_rate": float(others.k.sum() / others.n.sum()) if len(others) else np.nan,
               "client_rates": _json({e: float(x.k / x.n) for e, x in g.iterrows()}),
               "p_value": np.nan, "effect_pp": np.nan, "effect_ci90": _json(None), "tau2": np.nan}
        if prov != "INHOUSE" and len(g) >= 2 and len(others) >= 5:
            mu1, v1, _ = re_mean(g)
            mu0, v0, tau2 = re_mean(others)
            d, se = mu1 - mu0, np.sqrt(v1 + v0 + tau2 / len(g))
            row.update({"p_value": float(st.norm.sf(d / se)), "tau2": tau2,
                        "effect_pp": float(100 * (expit(mu0 + d) - expit(mu0))),
                        "effect_ci90": _json([float(100 * (expit(mu0 + d - z90 * se) - expit(mu0))),
                                              float(100 * (expit(mu0 + d + z90 * se) - expit(mu0)))])})
        rows.append(row)
    return pd.DataFrame(rows)


def survival(cf: pd.DataFrame, period_end: pd.Timestamp) -> pd.DataFrame:
    """Kaplan-Meier time-to-close for high/critical human-handled cases, with cases still
    open at the period end treated as censored. The naive median (closed cases only) is
    biased low whenever slow cases are still open."""
    from lifelines import KaplanMeierFitter
    h = cf[~cf.auto_closed & cf.severity.isin(["high", "critical"])]
    dur = np.where(h.closed, h.ttc_min, (period_end - h.opened_ts).dt.total_seconds() / 60)
    h = h.assign(dur=dur)
    rows = []
    grid = np.array([15, 30, 60, 120, 180, 240, 300, 360, 480, 600, 720, 960, 1440, 2880])
    for eid, g in h.groupby("entity_id"):
        g = g[g.dur > 0]
        if len(g) < 20:
            continue
        km = KaplanMeierFitter().fit(g.dur, event_observed=g.closed)
        surv = km.survival_function_at_times(grid).to_numpy()
        med = km.median_survival_time_
        rows.append({"entity_id": eid, "n": len(g), "open": int((~g.closed).sum()),
                     "km_median_min": float(med) if np.isfinite(med) else None,
                     "naive_median_min": float(g[g.closed].dur.median()) if g.closed.any() else None,
                     "curve": _json({"t": grid.tolist(), "open_share": np.round(surv, 4).tolist()})})
    return pd.DataFrame(rows)


QUARTER_DETECTORS = ("eg1", "eg2", "eg3", "eg4", "eg5", "eg7", "eg11", "eg12", "eg13", "ns7")


def quarterly_evidence(ctx, q: float = 0.10) -> pd.DataFrame:
    """Anytime-valid monitoring (D1+). Each quarter is analysed on its own data only
    (the detectors that make sense on a quarter), giving one p-value per entity per
    quarter. Each p becomes an e-value (Vovk-Wang calibrator), the running product is
    an e-process, and e-BH is applied at every look: the false-discovery guarantee holds
    no matter how often or when the regulator looks. For contrast we also record what
    naive per-quarter BH would flag."""
    starts = [ctx.period_end - pd.DateOffset(months=12 - 3 * i) for i in range(4)]
    rows, det_rows = [], []
    cum = {e: 1.0 for e in ctx.entities.entity_id}
    for i, st in enumerate(starts):
        en = st + pd.DateOffset(months=3)
        cf = ctx.cf[(ctx.cf.opened_ts >= st) & (ctx.cf.opened_ts < en)]
        al = ctx.alerts[(ctx.alerts.ts >= st) & (ctx.alerts.ts < en)]
        cq = D.Ctx(entities=ctx.entities, assets=ctx.assets, alerts=al, cf=cf,
                   escalations=ctx.escalations[ctx.escalations.case_id.isin(cf.case_id)],
                   submissions=ctx.submissions, redteam=pd.DataFrame(), period_end=en)
        res = []
        for name in QUARTER_DETECTORS:
            res += getattr(D, name)(cq)
        r = pd.DataFrame(res)
        r = r[r.p_value.notna()]
        det_rows.append(r[["entity_id", "detector_id", "p_value"]].assign(look=i + 1))
        ents = ctx.entities.entity_id.tolist()
        p = np.array([acat(r[r.entity_id == e].p_value.to_numpy()) if (r.entity_id == e).any() else 1.0 for e in ents])
        e_val = np.array([p_to_e(x) for x in p])
        for e, ev in zip(ents, e_val):
            cum[e] *= ev
        cum_arr = np.array([cum[e] for e in ents])
        f_e = ebh(cum_arr, q)
        f_bh = bh(p, q)
        label = f"{st.year}-Q{(st.month - 1) // 3 + 1}"
        rows += [{"entity_id": e, "look": i + 1, "quarter": label, "p_value": float(p[j]), "e_value": float(e_val[j]),
                  "cum_e": float(cum_arr[j]), "ebh_flag": bool(f_e[j]), "naive_bh_flag": bool(f_bh[j])}
                 for j, e in enumerate(ents)]
    out = pd.DataFrame(rows)
    out.attrs["detectors"] = pd.concat(det_rows, ignore_index=True)
    return out


def analyze(con, gen_dir: Path = GEN_DIR, log=lambda *a: None, quarters: bool = False) -> dict:
    """Load a generated/ingested panel into `con` and run the whole analysis.
    Returns the analysis frames without writing them anywhere (used by the
    pipeline and by the validation suite, which runs many panels in memory)."""
    t0 = time.time()
    gen_dir = Path(gen_dir)
    counts = load_parquet_dir(gen_dir, con)
    log("loaded", counts, f"{time.time() - t0:.1f}s")
    cf = build_case_features(con)
    log("case features", len(cf), f"{time.time() - t0:.1f}s")
    labels = prior_labels(cf, truth_dir=gen_dir / "_truth")
    _, yhat = fit_superficial_model(cf, labels)
    cf["yhat"] = yhat
    log("predictor trained on", len(labels), "prior labels", f"{time.time() - t0:.1f}s")

    q = lambda s: con.execute(s).df()  # noqa: E731
    ctx = D.Ctx(entities=q("SELECT * FROM entities"), assets=q("SELECT * FROM assets"),
                alerts=q("SELECT alert_id, entity_id, asset_id, ts, category, tactic, severity, detector_id, disposition, redteam FROM alerts"),
                cf=cf, escalations=q("SELECT * FROM escalations"), submissions=q("SELECT * FROM submissions"),
                redteam=q("SELECT * FROM redteam") if "redteam" in counts else pd.DataFrame(),
                period_end=pd.Timestamp(q("SELECT max(ts) AS m FROM alerts").m.iloc[0]).normalize() + pd.Timedelta(days=1))
    res, tm = D.run_all(ctx)
    log("detectors", len(res), f"{time.time() - t0:.1f}s")
    scores = score_entities(res, ctx.entities).merge(trust_scores(ctx, res), on="entity_id")
    out = {"counts": counts, "cf": cf, "ctx": ctx, "res": res, "tm": tm, "scores": scores, "n_prior_labels": len(labels)}
    if quarters:
        out["quarterly"] = quarterly_evidence(ctx)
        log("quarterly evidence", f"{time.time() - t0:.1f}s")
    return out


def run(regen: bool = False, seed: int = 7, verbose: bool = True, gen_dir: Path | None = None,
        db_path: Path | None = None, log=None) -> dict:
    """Full analysis into a DuckDB file. Defaults: the generated panel -> data/satsa.duckdb
    (and the live-database pointer is reset). An ingest commit passes its working
    folder and a fresh database file instead."""
    warnings.filterwarnings("ignore")
    t0 = time.time()
    log = log or ((lambda *a: print(*a, flush=True)) if verbose else (lambda *a: None))
    src = Path(gen_dir or GEN_DIR)
    if gen_dir is None and (regen or not (GEN_DIR / "cases.parquet").exists()):
        from satsa.gen.generator import generate
        log("generating synthetic panel ...")
        generate(GEN_DIR, seed)
    if db_path is None and POINTER.exists():
        POINTER.unlink()
    con = connect(path=db_path)
    input_hash = _hash_files([p for p in src.glob("*.parquet")])
    a = analyze(con, src, log, quarters=True)
    counts, cf, ctx, res, tm, scores = a["counts"], a["cf"], a["ctx"], a["res"], a["tm"], a["scores"]

    det_meta = pd.DataFrame([{"detector_id": k, "name": v[0], "family": v[1], "capability": v[2], "method": v[3],
                              "regulations": _json(tx.REGMAP.get(k, []))} for k, v in D.DETECTORS.items()])
    res_out = res.copy()
    res_out["evidence"] = res_out.evidence.map(_json)
    res_out["extra"] = res_out.extra.map(_json)
    keep_cols = ["case_id", "entity_id", "alert_id", "asset_id", "category", "tactic", "detector_id", "severity",
                 "disposition", "alert_ts", "opened_ts", "ack_ts", "closed_ts", "analyst_id", "escalated",
                 "remediation_required", "remediated", "ioc_enriched", "auto_closed", "notes", "redteam", "n_events",
                 "n_investigate", "n_triage", "n_escalate_ev", "n_contain", "n_remediate_ev", "n_automation", "ttc_min",
                 "ack_min", "open_hour", "month_idx", "period", "closed", "night", "note_len", "short_note",
                 "injection_like", "p_fast", "template_cluster", "template_key", "templated", "yhat"]
    write_tables({
        "case_features": cf[keep_cols],
        "detector_results": res_out,
        "detector_meta": det_meta,
        "entity_scores": scores,
        "tactic_matrix": tm,
        "entity_monthly": monthly_trends(cf),
        "entity_hourly": hourly_profile(cf),
        "providers": provider_lens(cf, ctx.entities),
        "entity_survival": survival(cf, ctx.period_end),
        "entity_quarterly": a["quarterly"],
        "entity_quarterly_detectors": a["quarterly"].attrs.get("detectors", pd.DataFrame(
            columns=["entity_id", "look", "detector_id", "p_value"])),
    }, con)
    con.execute("CREATE TABLE IF NOT EXISTS review_labels (entity_id VARCHAR, case_id VARCHAR, label INTEGER, "
                "reviewer VARCHAR, sample_type VARCHAR, blind_first BOOLEAN, ts TIMESTAMP)")
    con.execute("CREATE TABLE IF NOT EXISTS review_samples (entity_id VARCHAR, case_id VARCHAR, sample_type VARCHAR, "
                "rank INTEGER, created TIMESTAMP)")
    run_hash = hashlib.sha256(f"{input_hash}|{code_hash()}|{seed}".encode()).hexdigest()
    meta = {"run_hash": run_hash, "input_hash": input_hash, "code_hash": code_hash(), "version": __version__,
            "seed": seed, "counts": counts, "n_findings": int(((res.p_value < 0.01) | res.severity.notna()).sum()),
            "seconds": round(time.time() - t0, 1), "created": pd.Timestamp.now().isoformat(timespec="seconds")}
    write_tables({"run_meta": pd.DataFrame([{"key": k, "value": _json(v)} for k, v in meta.items()])}, con)
    con.close()
    ledger.append("analysis_run", {"run_hash": run_hash, "input_hash": input_hash, "code_hash": meta["code_hash"],
                                   "entities": int(len(scores)), "findings": meta["n_findings"]})
    log("done", f"{time.time() - t0:.1f}s", "run_hash", run_hash[:16])
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--regen", action="store_true")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    run(a.regen, a.seed)


if __name__ == "__main__":
    main()
