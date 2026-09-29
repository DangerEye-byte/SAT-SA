"""Put the demo back to its starting state without losing the pre-generated explanations.

Usage:  python -m satsa.reset_demo      (stop the API first: DuckDB file lock)

Clears examiner review samples, labels and dispositions, and drops any committed submission
(data/runs, e.g. HLT-07 from the ingest demo) so the API serves the base panel again.
Cached local-AI explanations are kept. Ledger entries are never removed (append-only).
"""

import shutil

from satsa import workflow
from satsa.store import DB_PATH, POINTER, connect


def main():
    if POINTER.exists():
        POINTER.unlink()
    for d in (workflow.RUNS, workflow.WORKING, workflow.STAGING):
        shutil.rmtree(d, ignore_errors=True)
    con = connect(path=DB_PATH)
    tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
    cleared = {}
    for t in ("review_samples", "review_labels", "dispositions"):
        if t in tables:
            cleared[t] = con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
            con.execute(f"DELETE FROM {t}")
    kept = con.execute("SELECT count(DISTINCT entity_id || detector_id) FROM explanations").fetchone()[0] \
        if "explanations" in tables else 0
    con.close()
    print(f"cleared {cleared}; kept {kept} cached explanations; serving {DB_PATH.name}")


if __name__ == "__main__":
    main()
