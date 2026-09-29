"""End-to-end API workflow on a throwaway database (slow: builds a database and re-runs
the analysis once). Run:  python -m pytest tests/test_workflow_e2e.py -q -s"""

import os
import shutil
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TEST_DB = ROOT / "data" / "test_api.duckdb"


@pytest.fixture(scope="module")
def client():
    os.environ["SATSA_DB"] = str(TEST_DB)
    from satsa import pipeline, store, workflow
    store.DB_PATH = TEST_DB
    for d in (workflow.WORKING, workflow.RUNS, workflow.STAGING):
        shutil.rmtree(d, ignore_errors=True)
    if store.POINTER.exists():
        store.POINTER.unlink()
    if not TEST_DB.exists():
        pipeline.run(db_path=TEST_DB, verbose=False)
    from fastapi.testclient import TestClient
    from satsa.api import main
    main._con = None
    main.live_db_path = lambda: TEST_DB if not store.POINTER.exists() else Path(store.POINTER.read_text().strip())
    yield TestClient(main.app)
    if main._con is not None:
        main._con.close()
        main._con = None
    for d in (workflow.WORKING, workflow.RUNS, workflow.STAGING):
        shutil.rmtree(d, ignore_errors=True)
    if store.POINTER.exists():
        store.POINTER.unlink()


def test_new_endpoints(client):
    q = client.get("/api/queue?fdr=0.1").json()
    eid = q["entities"][0]["entity_id"]
    e = client.get(f"/api/entities/{eid}").json()
    assert "quarterly" in e and len(e["quarterly"]) == 4
    assert all("disposition" in f for f in e["findings"])
    assert client.get(f"/api/entities/{eid}/evidence").json()["looks"]
    assert client.get(f"/api/entities/{eid}/survival").json()["available"]
    assert "new" in client.get(f"/api/entities/{eid}/cycle").json()
    assert client.get("/api/sectors").json()[0]["entities"] > 0
    prov = client.get("/api/providers").json()
    assert any(p["provider"] == "MSSP-3" and p["effect_pp"] is not None for p in prov)
    g = client.get("/api/gaming/run?strategy=off_audit_drift&policy=quarterly_audit").json()
    assert len(g["trace"]) == 12
    det = e["findings"][0]["detector_id"]
    r = client.post(f"/api/entities/{eid}/findings/{det}/disposition", json={"status": "dismissed", "reason": ""})
    assert r.status_code == 400
    r = client.post(f"/api/entities/{eid}/findings/{det}/disposition",
                    json={"status": "accepted", "reason": "confirmed on sample", "examiner": "tester"})
    assert r.status_code == 200 and r.json()["ledger_hash"]
    e2 = client.get(f"/api/entities/{eid}").json()
    assert [f for f in e2["findings"] if f["detector_id"] == det][0]["disposition"]["status"] == "accepted"
    html = client.get(f"/api/entities/{eid}/brief").text
    assert "examination brief" in html.lower() and "CSCRF" in html
    rt = ROOT / "data" / "samples" / "redteam" / "tel03_exercise.csv"
    r = client.post("/api/entities/TEL-03/redteam", files={"file": (rt.name, rt.read_bytes(), "text/csv")}).json()
    assert r["funnel"]["executed"] == 8 and r["funnel"]["alerted"] < 8


def test_ingest_commit_roundtrip(client):
    sub = ROOT / "data" / "samples" / "submission"
    files = [("files", (f.name, f.read_bytes())) for f in sorted(sub.iterdir())]
    rep = client.post("/api/ingest/validate", files=files).json()
    assert rep["accepted"] and rep["token"] and rep["entities"] == ["HLT-07"]
    bad = ROOT / "data" / "samples" / "broken"
    rep_bad = client.post("/api/ingest/validate", files=[("files", (f.name, f.read_bytes())) for f in bad.iterdir()]).json()
    assert not rep_bad["accepted"] and "token" not in rep_bad
    # examiner state must survive the re-analysis
    client.post("/api/review/BFS-02/simulate?n=3")
    job = client.post(f"/api/ingest/commit/{rep['token']}").json()
    t0 = time.time()
    while True:
        j = client.get(f"/api/jobs/{job['job_id']}").json()
        if j["status"] != "running" or time.time() - t0 > 900:
            break
        time.sleep(3)
    assert j["status"] == "done", j
    q = client.get("/api/queue?fdr=0.1").json()
    new = [x for x in q["entities"] if x["entity_id"] == "HLT-07"]
    assert new and new[0]["flagged"], "the uploaded weak entity should be flagged"
    assert client.get("/api/review/BFS-02").json()["estimate"]["n_labeled_random"] >= 1
    assert client.post("/api/ledger/verify").json()["ok"]
