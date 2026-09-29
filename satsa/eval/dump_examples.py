"""Regenerate docs/api-examples/*.json from live API responses (trimmed for reading).

Usage:  python -m satsa.eval.dump_examples      (stop the API first: DuckDB file lock)
"""

from __future__ import annotations

import json

from satsa.store import ROOT

OUT = ROOT / "docs" / "api-examples"


def trim(v, n: int = 3, depth: int = 0):
    if isinstance(v, list):
        head = [trim(x, n, depth + 1) for x in v[:n]]
        return head + ([f"...({len(v) - n} more)"] if len(v) > n else [])
    if isinstance(v, dict):
        return {k: trim(x, n if depth < 1 else 4, depth + 1) for k, x in v.items()}
    if isinstance(v, str) and len(v) > 400:
        return v[:400] + "...(truncated)"
    return v


def main():
    from fastapi.testclient import TestClient

    from satsa.api.main import app
    c = TestClient(app)
    OUT.mkdir(parents=True, exist_ok=True)
    GET = {
        "meta": "/api/meta", "queue": "/api/queue?fdr=0.1", "sectors": "/api/sectors",
        "entity": "/api/entities/PWR-01", "finding_case": "/api/entities/BFS-02/findings/EG1",
        "finding_bunching": "/api/entities/BFS-03/findings/EG6", "finding_decay": "/api/entities/PWR-03/findings/NS5",
        "finding_asset": "/api/entities/TRN-02/findings/NS1", "finding_twin": "/api/entities/TRN-06/findings/TW1",
        "hourly": "/api/entities/PWR-05/hourly", "entity_regulatory": "/api/entities/PWR-01/regulatory",
        "evidence": "/api/entities/BFS-02/evidence", "cycle": "/api/entities/TRN-06/cycle",
        "survival": "/api/entities/BFS-02/survival", "case": None, "blindspot": "/api/blindspot",
        "providers": "/api/providers", "redteam": "/api/redteam/PWR-01", "regulatory": "/api/regulatory",
        "review": "/api/review/BFS-02", "ledger": "/api/ledger?limit=5", "gaming": "/api/gaming",
        "gaming_run": "/api/gaming/run?strategy=off_audit_drift&policy=satsa_with_floor",
        "ai_status": "/api/ai/status", "explain": "/api/entities/PWR-01/findings/EG2/explain",
        "dispositions": "/api/dispositions",
    }
    written = []
    for name, path in GET.items():
        if name == "case":
            ev = c.get("/api/entities/BFS-02/findings/EG1").json()["evidence"]
            path = f"/api/cases/{ev[0]}"
        r = c.get(path)
        if r.status_code != 200:
            print("skip", name, r.status_code)
            continue
        (OUT / f"{name}.json").write_text(json.dumps({"_request": f"GET {path}", "response": trim(r.json())}, indent=1))
        written.append(name)
    rt = ROOT / "data" / "samples" / "redteam" / "tel03_exercise.csv"
    r = c.post("/api/entities/TEL-03/redteam", files={"file": (rt.name, rt.read_bytes(), "text/csv")})
    (OUT / "redteam_upload.json").write_text(json.dumps({"_request": "POST /api/entities/TEL-03/redteam (file)",
                                                          "response": trim(r.json())}, indent=1))
    r = c.post("/api/ledger/verify")
    (OUT / "ledger_verify.json").write_text(json.dumps({"_request": "POST /api/ledger/verify", "response": r.json()}, indent=1))
    bad = ROOT / "data" / "samples" / "broken"
    r = c.post("/api/ingest/validate", files=[("files", (f.name, f.read_bytes())) for f in bad.iterdir()])
    (OUT / "ingest_rejected.json").write_text(json.dumps({"_request": "POST /api/ingest/validate (data/samples/broken)",
                                                           "response": trim(r.json())}, indent=1))
    print("wrote", len(written) + 3, "examples to", OUT)


if __name__ == "__main__":
    main()
