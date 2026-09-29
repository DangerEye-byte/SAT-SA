"""Pre-generate verified explanations for the top findings (so the demo shows them instantly).

Usage:  python -m satsa.ai.warm [--top 10] [--per-entity 1] [--also PWR-01:EG2,TEL-02:EG3] [--skip-verified]
        (stop the API first: DuckDB file lock)

Order: the --also pairs (the demo cast), then the top findings of each flagged entity.
"""

import argparse
import json
import time

from satsa.store import connect, live_db_path


def _has_verified(api, entity_id: str, detector_id: str) -> bool:
    try:
        c = api.q("SELECT body FROM explanations WHERE entity_id = ? AND detector_id = ? ORDER BY ts DESC LIMIT 1",
                  [entity_id, detector_id])
    except Exception:  # table not created yet
        return False
    if not len(c):
        return False
    body = json.loads(c.body.iloc[0])
    return body.get("mode") == "local_model" and len(body.get("verified_claims", [])) > 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--per-entity", type=int, default=2)
    ap.add_argument("--also", default="", help="comma-separated ENTITY:DETECTOR pairs to warm first")
    ap.add_argument("--skip-verified", action="store_true",
                    help="keep cached local-model explanations that already have verified claims")
    a = ap.parse_args()
    from fastapi.testclient import TestClient
    from satsa.api import main as api
    c = TestClient(api.app)
    q = c.get("/api/queue?fdr=0.1").json()["entities"]
    todo = [tuple(p.split(":")) for p in a.also.split(",") if ":" in p]
    for e in q:
        if not e["flagged"]:
            continue
        for f in c.get(f"/api/entities/{e['entity_id']}").json()["findings"][:a.per_entity]:
            if (e["entity_id"], f["detector_id"]) not in todo:
                todo.append((e["entity_id"], f["detector_id"]))
    todo = todo[: a.top]
    if a.skip_verified:
        todo = [(e, d) for e, d in todo if not _has_verified(api, e, d)]
    t0 = time.time()
    for i, (e, d) in enumerate(todo, 1):
        r = c.get(f"/api/entities/{e}/findings/{d}/explain?refresh=true").json()
        print(f"[{i}/{len(todo)}] {e} {d}: {r['mode']} {r['seconds']}s, "
              f"{len(r['verified_claims'])} verified / {len(r['rejected_claims'])} rejected", flush=True)
    print(f"done in {time.time() - t0:.0f}s ({live_db_path().name})")


if __name__ == "__main__":
    main()
