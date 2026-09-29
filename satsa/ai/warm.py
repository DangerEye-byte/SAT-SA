"""Pre-generate verified explanations for the top findings (so the demo shows them instantly).

Usage:  python -m satsa.ai.warm [--top 10]      (stop the API first: DuckDB file lock)
"""

import argparse
import json
import time

from satsa.store import connect, live_db_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=10)
    a = ap.parse_args()
    from fastapi.testclient import TestClient
    from satsa.api import main as api
    c = TestClient(api.app)
    q = c.get("/api/queue?fdr=0.1").json()["entities"]
    todo = []
    for e in q:
        if not e["flagged"]:
            continue
        for f in c.get(f"/api/entities/{e['entity_id']}").json()["findings"][:2]:
            todo.append((e["entity_id"], f["detector_id"]))
    t0 = time.time()
    for i, (e, d) in enumerate(todo[: a.top], 1):
        r = c.get(f"/api/entities/{e}/findings/{d}/explain?refresh=true").json()
        print(f"[{i}/{min(a.top, len(todo))}] {e} {d}: {r['mode']} {r['seconds']}s, "
              f"{len(r['verified_claims'])} verified / {len(r['rejected_claims'])} rejected", flush=True)
    print(f"done in {time.time() - t0:.0f}s ({live_db_path().name})")


if __name__ == "__main__":
    main()
