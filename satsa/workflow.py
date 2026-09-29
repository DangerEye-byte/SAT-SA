"""Examiner workflow: submission staging and commit (background re-analysis with a
hot database swap), finding dispositions, red-team report reconciliation, cycle
comparison and sector summaries. Everything that changes state is written to the
hash-chained ledger."""

from __future__ import annotations

import shutil
import threading
import time
import traceback
import uuid
from pathlib import Path

import numpy as np
import pandas as pd

from satsa import ledger
from satsa.store import CANONICAL, DATA, POINTER

STAGING = DATA / "staging"
WORKING = DATA / "working"
RUNS = DATA / "runs"
GEN_DIR = DATA / "generated"
KEEP_TABLES = ("review_labels", "review_samples", "dispositions")  # examiner state carried across re-analyses

DISPOSITIONS = ("accepted", "dismissed", "escalated", "open")

# optional columns the analysis uses, with neutral defaults for submissions that omit them
CASE_DEFAULTS = {"disposition": "BP", "remediation_required": False, "remediated": False, "ioc_enriched": False,
                 "auto_closed": False, "redteam": False, "analyst_id": "unknown", "detector_id": "unknown",
                 "category": "unknown", "tactic": "unknown", "asset_id": "unknown"}
ALERT_DEFAULTS = {"disposition": "BP", "redteam": False, "recurrence_of": None, "tactic": "unknown",
                  "technique_id": None}


# ------------------------------------------------------------------ staging + commit
def stage(tables: dict[str, pd.DataFrame], report: dict) -> str:
    token = uuid.uuid4().hex[:12]
    d = STAGING / token
    d.mkdir(parents=True, exist_ok=True)
    for t, df in tables.items():
        df.to_parquet(d / f"{t}.parquet", index=False)
    (d / "report.json").write_text(pd.Series(report).to_json())
    return token


def _prepare_working() -> None:
    if not (WORKING / "cases.parquet").exists():
        WORKING.mkdir(parents=True, exist_ok=True)
        for f in GEN_DIR.glob("*.parquet"):
            shutil.copy2(f, WORKING / f.name)
        if (GEN_DIR / "_truth").exists():
            shutil.copytree(GEN_DIR / "_truth", WORKING / "_truth", dirs_exist_ok=True)


def _complete(t: str, df: pd.DataFrame, base: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    defaults = CASE_DEFAULTS if t == "cases" else ALERT_DEFAULTS if t == "alerts" else {}
    for c in base.columns:
        if c not in df.columns:
            df[c] = defaults.get(c, None)
    if t == "cases" and "alert_ts" in base.columns and df["alert_ts"].isna().all():
        df["alert_ts"] = df["opened_ts"]
    df = df[list(base.columns)]
    for c in base.columns:
        try:
            df[c] = df[c].astype(base[c].dtype)
        except (TypeError, ValueError):
            pass
    return df


def merge_submission(token: str) -> dict:
    """Merge a staged submission into the working dataset (a re-submission replaces the
    entity's previous data)."""
    d = STAGING / token
    if not d.exists():
        raise FileNotFoundError(token)
    _prepare_working()
    new = {f.stem: pd.read_parquet(f) for f in d.glob("*.parquet")}
    ents = set()
    for t in ("entities", "alerts", "cases"):
        if t in new and "entity_id" in new[t].columns:
            ents |= set(new[t].entity_id.dropna().astype(str))
    if "cases" in new and "entity_id" not in new["cases"].columns and "alerts" in new:
        new["cases"] = new["cases"].merge(new["alerts"][["alert_id", "entity_id"]], on="alert_id", how="left")
    counts = {}
    for t in CANONICAL:
        f = WORKING / f"{t}.parquet"
        if t not in new or not f.exists():
            continue
        base = pd.read_parquet(f)
        add = _complete(t, new[t], base)
        if "entity_id" in base.columns:
            base = base[~base.entity_id.isin(ents)]
        elif t == "case_events":
            old_cases = pd.read_parquet(WORKING / "cases.parquet")
            base = base[~base.case_id.isin(old_cases[old_cases.entity_id.isin(ents)].case_id)]
        if t == "escalations" and "esc_id" in base.columns and add["esc_id"].isna().all():
            add["esc_id"] = [f"ES-{token}-{i}" for i in range(len(add))]
        pd.concat([base, add], ignore_index=True).to_parquet(f, index=False)
        counts[t] = int(len(add))
    return {"entities": sorted(ents), "rows": counts}


class Jobs:
    def __init__(self):
        self.jobs: dict[str, dict] = {}
        self.lock = threading.Lock()

    def start(self, kind: str, fn, *args) -> str:
        jid = uuid.uuid4().hex[:10]
        job = {"job_id": jid, "kind": kind, "status": "running", "started": time.time(), "log": [], "result": None}
        self.jobs[jid] = job

        def log(*a):
            job["log"].append(" ".join(str(x) for x in a))

        def target():
            try:
                job["result"] = fn(*args, log=log)
                job["status"] = "done"
            except Exception as e:  # noqa: BLE001 - reported to the client
                job["status"] = "failed"
                job["error"] = f"{e}"
                job["log"].append(traceback.format_exc(limit=3))
            job["seconds"] = round(time.time() - job["started"], 1)

        threading.Thread(target=target, daemon=True).start()
        return jid

    def get(self, jid: str) -> dict | None:
        j = self.jobs.get(jid)
        if j is None:
            return None
        return {k: v for k, v in j.items()} | {"elapsed": round(time.time() - j["started"], 1)}


JOBS = Jobs()


def commit_and_rerun(token: str, swap, log=print) -> dict:
    """Merge the staged submission, re-run the full analysis into a new database file,
    carry over examiner state, then ask the API to swap to it."""
    log("merging submission", token)
    m = merge_submission(token)
    ledger.append("submission_committed", {"token": token, **m})
    RUNS.mkdir(parents=True, exist_ok=True)
    new_db = RUNS / f"satsa_{time.strftime('%Y%m%d_%H%M%S')}.duckdb"
    from satsa.pipeline import run
    meta = run(gen_dir=WORKING, db_path=new_db, verbose=False, log=log)
    swap(new_db)
    log("live database switched to", new_db.name)
    return {"merged": m, "run_hash": meta["run_hash"], "db": new_db.name, "seconds": meta["seconds"]}


def carry_over(old_con, new_path: Path) -> None:
    """Copy examiner state tables from the live database into a freshly built one."""
    import duckdb
    new = duckdb.connect(str(new_path))
    for t in KEEP_TABLES:
        try:
            df = old_con.execute(f"SELECT * FROM {t}").df()
        except Exception:  # noqa: BLE001 - table may not exist yet
            continue
        new.register("_k", df)
        new.execute(f"CREATE OR REPLACE TABLE {t} AS SELECT * FROM _k")
        new.unregister("_k")
    new.close()
    POINTER.write_text(str(new_path))


def cleanup_runs(keep: int = 2) -> None:
    files = sorted(RUNS.glob("satsa_*.duckdb"))
    for f in files[:-keep]:
        try:
            f.unlink()
        except OSError:
            pass


# ------------------------------------------------------------------ dispositions
def ensure_tables(con) -> None:
    con.execute("CREATE TABLE IF NOT EXISTS dispositions (entity_id VARCHAR, detector_id VARCHAR, status VARCHAR, "
                "reason VARCHAR, examiner VARCHAR, ts TIMESTAMP)")


def set_disposition(con, entity_id: str, detector_id: str, status: str, reason: str, examiner: str) -> dict:
    if status not in DISPOSITIONS:
        raise ValueError(f"status must be one of {DISPOSITIONS}")
    if status == "dismissed" and not reason.strip():
        raise ValueError("A dismissal needs a reason")
    ensure_tables(con)
    con.execute("INSERT INTO dispositions VALUES (?, ?, ?, ?, ?, now())", [entity_id, detector_id, status, reason, examiner])
    e = ledger.append("finding_disposition", {"entity_id": entity_id, "detector_id": detector_id, "status": status,
                                              "reason": reason}, actor=examiner)
    return {"entity_id": entity_id, "detector_id": detector_id, "status": status, "reason": reason,
            "examiner": examiner, "ledger_hash": e["hash"]}


def dispositions(con, entity_id: str | None = None) -> pd.DataFrame:
    ensure_tables(con)
    where = "WHERE entity_id = ?" if entity_id else ""
    return con.execute(f"SELECT * FROM dispositions {where} QUALIFY row_number() OVER "
                       f"(PARTITION BY entity_id, detector_id ORDER BY ts DESC) = 1",
                       [entity_id] if entity_id else []).df()


# ------------------------------------------------------------------ red-team upload
def reconcile_redteam(con, entity_id: str, rt: pd.DataFrame) -> dict:
    """Reconcile an uploaded red-team / drill report against the entity's own submission."""
    from satsa import taxonomy as tx
    rt = rt.copy()
    rt.columns = [str(c).strip().lower() for c in rt.columns]
    if "category" not in rt.columns and "technique_id" in rt.columns:
        by_tid = {v[1]: k for k, v in tx.CATEGORIES.items()}
        rt["category"] = rt.technique_id.map(by_tid)
    need = {"category", "start_ts"}
    if not need <= set(rt.columns):
        raise ValueError(f"red-team report needs columns {sorted(need)} (or technique_id instead of category)")
    rt["start_ts"] = pd.to_datetime(rt.start_ts, errors="coerce")
    rt = rt[rt.start_ts.notna() & rt.category.isin(tx.CATEGORIES)]
    al = con.execute("SELECT alert_id, ts, category FROM alerts WHERE entity_id = ?", [entity_id]).df()
    cf = con.execute("SELECT alert_id, escalated FROM case_features WHERE entity_id = ?", [entity_id]).df()
    rows = []
    for x in rt.itertuples():
        m = al[(al.category == x.category) & (al.ts >= x.start_ts - pd.Timedelta(hours=1))
               & (al.ts <= x.start_ts + pd.Timedelta(hours=24))]
        cs = cf[cf.alert_id.isin(m.alert_id)]
        tactic, tid, tname = tx.CATEGORIES[x.category]
        rows.append({"technique_id": tid, "technique": tname, "tactic": tactic,
                     "target_asset": getattr(x, "target_asset", None), "start_ts": x.start_ts.isoformat(),
                     "executed": True, "alerted": len(m) > 0, "cased": len(cs) > 0,
                     "escalated": bool(cs.escalated.any()) if len(cs) else False,
                     "matched_alerts": m.alert_id.head(3).tolist()})
    f = pd.DataFrame(rows)
    funnel = {k: int(f[k].sum()) if len(f) else 0 for k in ("executed", "alerted", "cased", "escalated")}
    missed = f[~f.alerted] if len(f) else f
    ledger.append("redteam_report_reconciled", {"entity_id": entity_id, **funnel})
    return {"entity_id": entity_id, "funnel": funnel, "techniques": rows,
            "missed": missed.technique.tolist() if len(missed) else [],
            "severity": "high" if len(missed) >= 2 else ("medium" if len(missed) else None)}


# ------------------------------------------------------------------ cycle comparison + sectors
def cycle_comparison(con, entity_id: str, alpha: float = 0.01) -> dict:
    try:
        d = con.execute("SELECT * FROM entity_quarterly_detectors WHERE entity_id = ?", [entity_id]).df()
        qs = con.execute("SELECT look, quarter FROM entity_quarterly WHERE entity_id = ? ORDER BY look", [entity_id]).df()
    except Exception:  # noqa: BLE001
        return {"entity_id": entity_id, "available": False}
    if d.empty or len(qs) < 2:
        return {"entity_id": entity_id, "available": False}
    last, prev = int(qs.look.max()), int(qs.look.max()) - 1
    a = set(d[(d.look == prev) & (d.p_value < alpha)].detector_id)
    b = set(d[(d.look == last) & (d.p_value < alpha)].detector_id)
    from satsa.detect.detectors import DETECTORS
    name = lambda x: {"detector_id": x, "name": DETECTORS.get(x, (x,))[0]}  # noqa: E731
    lbl = dict(zip(qs.look, qs.quarter))
    return {"entity_id": entity_id, "available": True, "previous": lbl[prev], "current": lbl[last], "alpha": alpha,
            "new": [name(x) for x in sorted(b - a)], "resolved": [name(x) for x in sorted(a - b)],
            "persisting": [name(x) for x in sorted(a & b)]}


def sector_summary(con, fdr: float = 0.10) -> list[dict]:
    s = con.execute("SELECT entity_id, sector, sector_name, soc_provider, q_value, det_severity, attention "
                    "FROM entity_scores").df()
    tm = con.execute("SELECT entity_id, tactic, state FROM tactic_matrix").df()
    res = con.execute("SELECT entity_id, detector_id, p_value, severity FROM detector_results").df()
    prov = con.execute("SELECT provider, p_value, effect_pp FROM providers").df()
    weak_prov = set(prov[(prov.p_value < 0.05)].provider)
    out = []
    for sec, g in s.groupby("sector"):
        flagged = g[(g.q_value <= fdr) | (g.det_severity > 0)]
        r = res[res.entity_id.isin(g.entity_id) & ((res.p_value < 0.01) | res.severity.notna())]
        top = r.detector_id.value_counts().head(3)
        blind = tm[tm.entity_id.isin(g.entity_id) & (tm.state == "blind")]
        out.append({"sector": sec, "sector_name": g.sector_name.iloc[0], "entities": int(len(g)),
                    "flagged": int(len(flagged)), "mean_attention": float(g.attention.mean()),
                    "top_detectors": [{"detector_id": k, "entities": int(v)} for k, v in top.items()],
                    "blind_tactics": sorted(blind.tactic.unique().tolist()),
                    "entities_blind_somewhere": int(blind.entity_id.nunique()),
                    "systemic_providers": sorted(set(g.soc_provider) & weak_prov)})
    return sorted(out, key=lambda x: -x["flagged"])
