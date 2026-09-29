"""SAT-SA HTTP API. Contract documented in docs/API.md (keep them in sync).

Run:  python -m uvicorn satsa.api.main:app --port 8000
"""

from __future__ import annotations

import json
import math
import threading
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from satsa import __version__, brief, ledger, review, taxonomy as tx, workflow
from satsa.detect.detectors import DETECTORS, DET_SCORE, conformance_violations
from satsa.ingest.loader import ingest_files
from satsa.store import DATA, ROOT, connect, live_db_path

app = FastAPI(title="SAT-SA API", version=__version__,
              description="Supervisory Analytics Tool for SOC Assessment - offline API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_lock = threading.RLock()
_con = None


def con():
    global _con
    if _con is None:
        path = live_db_path()
        if not path.exists():
            from satsa.pipeline import run
            run(verbose=True)
        _con = connect(path=path)
        workflow.ensure_tables(_con)
    return _con


def swap_db(new_path: Path) -> None:
    """Point the API at a freshly built database, carrying examiner state across."""
    global _con
    with _lock:
        workflow.carry_over(con(), new_path)
        _con.close()
        _con = connect(path=new_path)
        workflow.ensure_tables(_con)
    workflow.cleanup_runs()


def q(sql: str, params=None) -> pd.DataFrame:
    with _lock:
        return con().execute(sql, params or []).df()


def clean(v):
    """Make pandas / numpy values JSON-safe (NaN -> None, timestamps -> ISO)."""
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, (pd.Timestamp, datetime, date)):
        return None if pd.isna(v) else v.isoformat()
    if v is pd.NaT:
        return None
    if isinstance(v, np.ndarray):
        return clean(v.tolist())
    return v


def records(df: pd.DataFrame) -> list[dict]:
    return [clean(r) for r in df.to_dict("records")]


def _j(s):
    try:
        return json.loads(s) if isinstance(s, str) else s
    except (TypeError, ValueError):
        return s


def _entity_or_404(entity_id: str) -> dict:
    e = q("SELECT * FROM entity_scores WHERE entity_id = ?", [entity_id])
    if e.empty:
        raise HTTPException(404, f"Unknown entity {entity_id}")
    r = records(e)[0]
    r["capabilities"] = _j(r["capabilities"])
    r["top_reasons"] = _j(r["top_reasons"])
    return r


def _flag(p_ok: bool, det_sev: int) -> str | None:
    if p_ok and det_sev:
        return "both"
    if p_ok:
        return "statistical"
    if det_sev:
        return "deterministic"
    return None


# ---------------------------------------------------------------- meta
@app.get("/api/health")
def health():
    return {"ok": True, "version": __version__}


@app.get("/api/meta")
def meta():
    rm = {r["key"]: _j(r["value"]) for r in records(q("SELECT * FROM run_meta"))}
    det = records(q("SELECT * FROM detector_meta ORDER BY detector_id"))
    for d in det:
        d["regulations"] = _j(d["regulations"])
    period = q("SELECT min(ts) AS start, max(ts) AS end FROM alerts")
    return {"run": rm, "detectors": det, "capabilities": tx.CAPABILITIES, "tactics": tx.TACTICS,
            "sectors": tx.SECTORS, "log_sources": tx.LOG_SOURCES,
            "providers": q("SELECT DISTINCT soc_provider FROM entities ORDER BY 1").soc_provider.tolist(),
            "period": records(period)[0]}


# ---------------------------------------------------------------- queue
@app.get("/api/queue")
def queue(fdr: float = Query(0.10, ge=0.001, le=0.5), sector: str | None = None, provider: str | None = None):
    s = q("SELECT * FROM entity_scores")
    if sector:
        s = s[s.sector == sector]
    if provider:
        s = s[s.soc_provider == provider]
    spark = q("SELECT entity_id, period, mean_superficial_score FROM entity_monthly ORDER BY period")
    sp = spark.groupby("entity_id").mean_superficial_score.apply(lambda x: [round(float(v), 4) for v in x])
    out = []
    for r in records(s):
        stat_flag = r["q_value"] <= fdr
        fb = _flag(stat_flag, r["det_severity"])
        out.append({k: r[k] for k in ["entity_id", "entity_name", "sector", "sector_name", "size_band", "soc_provider",
                                      "claims_24x7", "p_value", "q_value", "attention", "trust_score", "n_tests",
                                      "n_deterministic"]}
                   | {"flagged": fb is not None, "flag_basis": fb, "top_reasons": _j(r["top_reasons"]),
                      "capabilities": _j(r["capabilities"]), "sparkline": sp.get(r["entity_id"], [])})
    out.sort(key=lambda x: (not x["flagged"], -x["attention"], x["p_value"]))
    n_stat = sum(1 for x in out if x["flag_basis"] in ("statistical", "both"))
    return {"fdr": fdr, "n_entities": len(out), "n_flagged": sum(x["flagged"] for x in out),
            "n_flagged_statistical": n_stat, "n_flagged_deterministic": sum(1 for x in out if x["flag_basis"] == "deterministic"),
            "expected_false_discoveries_max": round(fdr * n_stat, 2), "entities": out}


# ---------------------------------------------------------------- entity
def _findings(entity_id: str, include_all: bool = False) -> list[dict]:
    r = q("SELECT * FROM detector_results WHERE entity_id = ?", [entity_id])
    meta_ = {d: v for d, v in DETECTORS.items()}
    with _lock:
        disp = {x["detector_id"]: x for x in records(workflow.dispositions(con(), entity_id))}
    out = []
    for x in records(r):
        det = meta_[x["detector_id"]]
        sig = (x["p_value"] is not None and x["p_value"] < 0.01) or bool(x["severity"])
        if not include_all and not sig:
            continue
        x.update({"name": det[0], "family": det[1], "capability": det[2], "method": det[3],
                  "regulations": tx.REGMAP.get(x["detector_id"], []), "significant": sig,
                  "evidence": _j(x["evidence"]), "extra": _j(x["extra"])})
        d_ = disp.get(x["detector_id"])
        x["disposition"] = {k: d_[k] for k in ("status", "reason", "examiner", "ts")} if d_ else {"status": "open"}
        x["score"] = DET_SCORE.get(x["severity"], 0) if x["deterministic"] else (
            min(100, 20 * -math.log10(max(x["p_value"], 1e-12))) if x["p_value"] is not None else 0)
        # keep payloads small in list views; charts are served by /finding
        if not include_all:
            x["extra"] = {k: v for k, v in (x["extra"] or {}).items()
                          if k not in ("chart", "series", "assets", "rules", "techniques", "twin")}
            x["evidence"] = x["evidence"][:10]
        out.append(x)
    out.sort(key=lambda x: -x["score"])
    return out


@app.get("/api/entities")
def entities():
    return records(q("SELECT entity_id, entity_name, sector, sector_name, size_band, soc_provider, attention, q_value "
                     "FROM entity_scores ORDER BY entity_id"))


@app.get("/api/entities/{entity_id}")
def entity(entity_id: str, all_detectors: bool = False):
    e = _entity_or_404(entity_id)
    e["declared_log_sources"] = e["declared_log_sources"].split(",")
    e["findings"] = _findings(entity_id, include_all=all_detectors)
    e["monthly"] = records(q("SELECT * FROM entity_monthly WHERE entity_id = ? ORDER BY period", [entity_id]))
    e["tactics"] = records(q("SELECT tactic, state, observed, expected, p, supportable FROM tactic_matrix WHERE entity_id = ?",
                             [entity_id]))
    prov = q("SELECT * FROM providers WHERE provider = ?", [e["soc_provider"]])
    e["provider"] = _provider_rows(prov)[0] if len(prov) else None
    e["quarterly"] = _quarterly(entity_id)
    return e


def _quarterly(entity_id: str) -> list[dict]:
    try:
        return records(q("SELECT look, quarter, p_value, e_value, cum_e, ebh_flag, naive_bh_flag FROM entity_quarterly "
                         "WHERE entity_id = ? ORDER BY look", [entity_id]))
    except Exception:  # table absent in databases built before quarterly monitoring
        return []


@app.get("/api/entities/{entity_id}/evidence")
def evidence(entity_id: str, fdr: float = Query(0.10, ge=0.001, le=0.5)):
    """Anytime-valid quarterly evidence (e-values). cum_e >= n_entities / (fdr * rank) is the e-BH rule;
    as a single-entity rule of thumb, cum_e >= 1/fdr is already strong evidence."""
    _entity_or_404(entity_id)
    n = int(q("SELECT count(*) AS n FROM entity_scores").n.iloc[0])
    return {"entity_id": entity_id, "fdr": fdr, "n_entities": n, "looks": _quarterly(entity_id),
            "note": "Each quarter is analysed on its own data; the running product of e-values keeps its false-alarm "
                    "guarantee no matter how often the regulator looks (e-BH, Wang & Ramdas 2022)."}


@app.get("/api/entities/{entity_id}/survival")
def entity_survival(entity_id: str):
    _entity_or_404(entity_id)
    try:
        r = q("SELECT * FROM entity_survival WHERE entity_id = ?", [entity_id])
    except Exception:
        return {"entity_id": entity_id, "available": False}
    if r.empty:
        return {"entity_id": entity_id, "available": False}
    out = records(r)[0]
    out["curve"] = _j(out["curve"])
    peers = q("SELECT median(km_median_min) AS m FROM entity_survival WHERE entity_id <> ?", [entity_id]).m.iloc[0]
    return out | {"available": True, "peer_km_median_min": clean(peers)}


@app.get("/api/entities/{entity_id}/findings/{detector_id}")
def finding(entity_id: str, detector_id: str, limit: int = 40):
    _entity_or_404(entity_id)
    rows = [f for f in _findings(entity_id, include_all=True) if f["detector_id"] == detector_id]
    if not rows:
        raise HTTPException(404, "No such finding")
    f = rows[0]
    ids = (f["evidence"] or [])[:limit]
    et = f["evidence_type"]
    if et == "case" and ids:
        f["records"] = records(q(f"SELECT case_id, severity, category, tactic, asset_id, opened_ts, ack_ts, closed_ts, "
                                 f"ttc_min, ack_min, escalated, disposition, n_investigate, p_fast, templated, yhat, notes, "
                                 f"injection_like FROM case_features WHERE case_id IN ({','.join('?' * len(ids))})", ids))
    elif et == "asset" and ids:
        f["records"] = records(q(f"SELECT * FROM assets WHERE asset_id IN ({','.join('?' * len(ids))})", ids))
    elif et == "alert" and ids:
        f["records"] = records(q(f"SELECT alert_id, asset_id, ts, category, severity, detector_id FROM alerts "
                                 f"WHERE alert_id IN ({','.join('?' * len(ids))})", ids))
    else:
        f["records"] = [{"id": i} for i in ids]
    return f


@app.get("/api/entities/{entity_id}/findings/{detector_id}/explain")
def explain_finding(entity_id: str, detector_id: str, refresh: bool = False, model: bool = True):
    """Verifier-gated plain-language explanation (local model if present, else template). Cached."""
    from satsa.ai.explain import explain
    with _lock:
        con().execute("CREATE TABLE IF NOT EXISTS explanations (entity_id VARCHAR, detector_id VARCHAR, "
                      "body VARCHAR, ts TIMESTAMP)")
        if not refresh:
            c = q("SELECT body FROM explanations WHERE entity_id = ? AND detector_id = ? ORDER BY ts DESC LIMIT 1",
                  [entity_id, detector_id])
            if len(c):
                return json.loads(c.body.iloc[0]) | {"cached": True}
    f = finding(entity_id, detector_id, limit=40)
    out = clean(explain(f, use_model=model))
    with _lock:
        con().execute("INSERT INTO explanations VALUES (?, ?, ?, now())", [entity_id, detector_id, json.dumps(out)])
    ledger.append("explanation_generated", {"entity_id": entity_id, "detector_id": detector_id, "mode": out["mode"],
                                            "verified": len(out["verified_claims"]),
                                            "rejected": len(out["rejected_claims"])})
    return out | {"cached": False}


@app.get("/api/ai/status")
def ai_status():
    from satsa.ai.explain import MODEL_NAME, MODEL_PATH, model_available
    return {"available": model_available(), "model": MODEL_NAME if model_available() else None,
            "path": MODEL_PATH.name, "offline": True}


@app.get("/api/entities/{entity_id}/hourly")
def hourly(entity_id: str):
    _entity_or_404(entity_id)
    h = q("SELECT dow, open_hour AS hour, cases, median_ack_min, slow_ack_share FROM entity_hourly WHERE entity_id = ?",
          [entity_id])
    peers = q("SELECT open_hour AS hour, median(median_ack_min) AS peer_median_ack_min FROM entity_hourly "
              "WHERE entity_id <> ? GROUP BY 1 ORDER BY 1", [entity_id])
    return {"cells": records(h), "peer_by_hour": records(peers)}


@app.get("/api/entities/{entity_id}/regulatory")
def entity_regulatory(entity_id: str):
    e = _entity_or_404(entity_id)
    fs = {f["detector_id"]: f for f in _findings(entity_id, include_all=True)}
    items = []
    for did, regs in tx.REGMAP.items():
        f = fs.get(did)
        if f is None:
            continue
        status = "evidence_contradicts" if f["significant"] else ("insufficient_evidence" if (
            f["p_value"] is None and not f["deterministic"]) else "consistent")
        for reg in regs:
            items.append({"obligation": reg, "detector_id": did, "detector": DETECTORS[did][0], "status": status,
                          "effect": f["effect"], "reason": f["reason"]})
    order = {"evidence_contradicts": 0, "insufficient_evidence": 1, "consistent": 2}
    items.sort(key=lambda x: order[x["status"]])
    return {"entity_id": entity_id, "entity_name": e["entity_name"], "items": items}


@app.get("/api/regulatory")
def regulatory():
    return {"crosswalk": [{"detector_id": d, "detector": DETECTORS[d][0], "obligations": regs}
                          for d, regs in tx.REGMAP.items() if d in DETECTORS]}


class DispositionIn(BaseModel):
    status: str
    reason: str = ""
    examiner: str = "examiner"


@app.post("/api/entities/{entity_id}/findings/{detector_id}/disposition")
def set_disposition(entity_id: str, detector_id: str, body: DispositionIn):
    _entity_or_404(entity_id)
    if detector_id not in DETECTORS:
        raise HTTPException(404, "Unknown detector")
    try:
        with _lock:
            return workflow.set_disposition(con(), entity_id, detector_id, body.status, body.reason, body.examiner)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/dispositions")
def list_dispositions(entity_id: str | None = None):
    with _lock:
        return records(workflow.dispositions(con(), entity_id))


@app.get("/api/entities/{entity_id}/cycle")
def cycle(entity_id: str):
    _entity_or_404(entity_id)
    with _lock:
        return workflow.cycle_comparison(con(), entity_id)


@app.post("/api/entities/{entity_id}/redteam")
async def redteam_upload(entity_id: str, file: UploadFile = File(...)):
    _entity_or_404(entity_id)
    from satsa.ingest.loader import read_any
    try:
        tables = read_any(file.filename, await file.read())
        rt = next(iter(tables.values()))
        with _lock:
            return clean(workflow.reconcile_redteam(con(), entity_id, rt))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/entities/{entity_id}/brief", response_class=HTMLResponse)
def entity_brief(entity_id: str, fdr: float = Query(0.10, ge=0.001, le=0.5)):
    e = _entity_or_404(entity_id)
    fs = _findings(entity_id, include_all=True)
    disp = {f["detector_id"]: f["disposition"] for f in fs}
    with _lock:
        est = clean(review.estimate(con(), entity_id))
    rm = {r["key"]: _j(r["value"]) for r in records(q("SELECT * FROM run_meta"))}
    led = ledger.read()
    return HTMLResponse(brief.render(e, fs, disp, est, _quarterly(entity_id), rm, led[-1] if led else None, fdr))


@app.get("/api/sectors")
def sectors(fdr: float = Query(0.10, ge=0.001, le=0.5)):
    with _lock:
        return clean(workflow.sector_summary(con(), fdr))


# ---------------------------------------------------------------- cases
@app.get("/api/cases/{case_id}")
def case(case_id: str):
    c = q("SELECT * FROM case_features WHERE case_id = ?", [case_id])
    if c.empty:
        raise HTTPException(404, "Unknown case")
    viol = conformance_violations(c).iloc[0]
    out = records(c)[0]
    out["violations"] = [k for k, v in viol.items() if v]
    out["events"] = records(q("SELECT ts, activity, actor FROM case_events WHERE case_id = ? ORDER BY ts", [case_id]))
    out["escalations"] = records(q("SELECT ts, to_level, acknowledged_ts FROM escalations WHERE case_id = ? ORDER BY ts",
                                   [case_id]))
    if out.get("templated") and out.get("template_key"):
        out["template_siblings"] = records(q(
            "SELECT case_id, notes, opened_ts FROM case_features WHERE template_key = ? AND case_id <> ? LIMIT 5",
            [out["template_key"], case_id]))
    return out


# ---------------------------------------------------------------- blind spots, providers, red team
@app.get("/api/blindspot")
def blindspot():
    tm = q("SELECT entity_id, tactic, state, observed, expected, p, supportable FROM tactic_matrix")
    ents = q("SELECT entity_id, entity_name, sector, declared_log_sources FROM entity_scores ORDER BY sector, entity_id")
    summary = tm.groupby("state").size().to_dict()
    return {"tactics": tx.TACTICS, "entities": records(ents), "cells": records(tm), "summary": clean(summary),
            "legend": {"covered": "Log sources can see this tactic and alerts are present at expected levels",
                       "quiet": "Log sources can see this tactic but alerts are far below the expected level",
                       "blind": "Declared log sources cannot support detection of this tactic (most peers can)",
                       "not_applicable": "Not expected for this entity's asset mix"}}


def _provider_rows(p: pd.DataFrame) -> list[dict]:
    out = records(p)
    for r in out:
        for k in ("clients", "sectors", "client_rates", "effect_ci90"):
            if k in r:
                r[k] = _j(r[k])
    return out


@app.get("/api/providers")
def providers():
    return _provider_rows(q("SELECT * FROM providers ORDER BY p_value NULLS LAST"))


# ---------------------------------------------------------------- red-team lab (gaming simulator)
@app.get("/api/gaming")
def gaming_matrix():
    """Detection matrix (strategies x policies). Served from the validation report when present."""
    f = ROOT / "reports" / "validation.json"
    if f.exists():
        v = json.loads(f.read_text())
        if "D4_gaming" in v:
            return v["D4_gaming"]
    from satsa.eval.gaming import matrix
    return matrix(100)


@app.get("/api/gaming/run")
def gaming_run(strategy: str = "off_audit_drift", policy: str = "quarterly_audit", seed: int = 1):
    from satsa.eval.gaming import POLICIES, STRATEGIES, timeline
    if strategy not in STRATEGIES or policy not in POLICIES:
        raise HTTPException(400, f"strategy in {STRATEGIES}, policy in {POLICIES}")
    return timeline(strategy, policy, seed)


@app.get("/api/redteam/{entity_id}")
def redteam(entity_id: str):
    f = [x for x in _findings(entity_id, include_all=True) if x["detector_id"] == "RT1"]
    if not f or not f[0]["extra"]:
        return {"entity_id": entity_id, "has_report": False}
    return {"entity_id": entity_id, "has_report": True, "funnel": f[0]["extra"].get("funnel"),
            "techniques": f[0]["extra"].get("techniques"), "reason": f[0]["reason"]}


# ---------------------------------------------------------------- review lab (PPI)
class LabelIn(BaseModel):
    case_id: str
    label: int
    reviewer: str = "examiner"
    blind_first: bool = True


def _review_payload(entity_id: str, reveal: bool):
    s = review.get_sample(con(), entity_id)
    rows = records(s)
    if not reveal:
        for r in rows:
            if r["label"] is None:
                r["yhat"] = None  # blind-first: hide the model's opinion until the examiner decides
    return {"entity_id": entity_id, "sample": rows, "estimate": clean(review.estimate(con(), entity_id))}


@app.get("/api/review/{entity_id}")
def review_get(entity_id: str, reveal: bool = False):
    _entity_or_404(entity_id)
    with _lock:
        return _review_payload(entity_id, reveal)


@app.post("/api/review/{entity_id}/sample")
def review_sample(entity_id: str, n_random: int = 20, n_active: int = 10):
    _entity_or_404(entity_id)
    with _lock:
        review.create_sample(con(), entity_id, n_random, n_active)
        return _review_payload(entity_id, False)


@app.post("/api/review/{entity_id}/label")
def review_label(entity_id: str, body: LabelIn):
    with _lock:
        st = q("SELECT sample_type FROM review_samples WHERE entity_id = ? AND case_id = ?", [entity_id, body.case_id])
        if st.empty:
            raise HTTPException(400, "Case is not in this entity's review sample")
        review.add_label(con(), entity_id, body.case_id, body.label, body.reviewer, body.blind_first, st.sample_type.iloc[0])
        return _review_payload(entity_id, False)


@app.post("/api/review/{entity_id}/simulate")
def review_simulate(entity_id: str, n: int = 5):
    with _lock:
        if q("SELECT count(*) AS n FROM review_samples WHERE entity_id = ?", [entity_id]).n.iloc[0] == 0:
            review.create_sample(con(), entity_id)
        done = review.simulate_labels(con(), entity_id, n)
        p = _review_payload(entity_id, False)
        p["simulated"] = done
        return p


@app.post("/api/review/{entity_id}/reset")
def review_reset(entity_id: str):
    with _lock:
        review.reset(con(), entity_id)
        return _review_payload(entity_id, False)


# ---------------------------------------------------------------- ledger
@app.get("/api/ledger")
def ledger_list(limit: int = 200):
    e = ledger.read()
    return {"entries": list(reversed(e[-limit:])), "total": len(e)}


@app.post("/api/ledger/verify")
def ledger_verify():
    return ledger.verify()


@app.post("/api/ledger/tamper-demo")
def ledger_tamper():
    return ledger.tamper_demo()


# ---------------------------------------------------------------- ingestion
@app.post("/api/ingest/validate")
async def ingest_validate(files: list[UploadFile] = File(...)):
    payload = [(f.filename, await f.read()) for f in files]
    tables, report = ingest_files(payload)
    report["tables"] = {k: len(v) for k, v in tables.items()}
    if report["accepted"]:
        report["token"] = workflow.stage(tables, report)
        ents = set()
        for t in ("entities", "alerts", "cases"):
            if t in tables and "entity_id" in tables[t].columns:
                ents |= set(tables[t].entity_id.dropna().astype(str))
        report["entities"] = sorted(ents)
    ledger.append("submission_validated", {"files": report["sha256"], "accepted": report["accepted"],
                                           "rows": report["tables"]})
    return clean(report)


@app.post("/api/ingest/commit/{token}")
def ingest_commit(token: str):
    if not (workflow.STAGING / token).exists():
        raise HTTPException(404, "Unknown or expired submission token")
    jid = workflow.JOBS.start("ingest_commit", workflow.commit_and_rerun, token, swap_db)
    return {"job_id": jid, "status": "running"}


@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    j = workflow.JOBS.get(job_id)
    if j is None:
        raise HTTPException(404, "Unknown job")
    return clean(j)


# ---------------------------------------------------------------- validation + static
@app.get("/api/validation")
def validation():
    f = ROOT / "reports" / "validation.json"
    if not f.exists():
        return {"available": False}
    return {"available": True} | json.loads(f.read_text())


@app.get("/api/guide")
def guide():
    f = ROOT / "reports" / "guide.json"
    if not f.exists():
        return {"available": False}
    return {"available": True} | json.loads(f.read_text())


STATIC = Path(__file__).resolve().parent / "static"
if STATIC.exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = STATIC / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(STATIC / "index.html")
else:
    @app.get("/", include_in_schema=False)
    def root():
        return HTMLResponse("<h3>SAT-SA API running.</h3><p>Frontend not built yet. See <a href='/docs'>/docs</a>.</p>")
