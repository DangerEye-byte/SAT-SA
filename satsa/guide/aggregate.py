"""One-pass DuckDB aggregation of Microsoft GUIDE (CDLA-Permissive-2.0) into small
parquet tables in data/guide/agg/.

GUIDE (Freitas et al., arXiv 2407.09017): ~13M evidence rows, 1.6M alerts and 1M
triage-annotated incidents from 6,100+ organisations. IncidentGrade is the SOC
analysts' verdict (TruePositive / BenignPositive / FalsePositive).
GUIDE_Test_Queue_Rankings.csv holds expert-assigned queue ranks for 499 orgs.

Usage:  python -m satsa.guide.aggregate        (~5-10 min, once)
"""

from __future__ import annotations

import time
from pathlib import Path

import duckdb

from satsa.store import DATA

GUIDE = DATA / "guide"
AGG = GUIDE / "agg"
SPLITS = {"train": GUIDE / "GUIDE_Train.csv", "test": GUIDE / "GUIDE_Test.csv"}

SRC = """(SELECT '{split}' AS split,
        TRY_CAST(OrgId AS BIGINT) AS org, TRY_CAST(IncidentId AS BIGINT) AS inc, TRY_CAST(AlertId AS BIGINT) AS alert,
        TRY_CAST(Timestamp AS TIMESTAMP) AS ts, TRY_CAST(DetectorId AS BIGINT) AS det, Category AS cat,
        NULLIF(MitreTechniques, '') AS mitre, NULLIF(IncidentGrade, '') AS grade,
        NULLIF(ActionGrouped, '') AS action, EntityType AS etype, EvidenceRole AS role,
        NULLIF(SuspicionLevel, '') AS susp, NULLIF(LastVerdict, '') AS verdict
      FROM read_csv('{path}', header = true, all_varchar = true))"""


def aggregate(force: bool = False, log=print) -> dict:
    AGG.mkdir(parents=True, exist_ok=True)
    out = {}
    con = duckdb.connect(":memory:")
    con.execute("SET memory_limit = '8GB'")
    con.execute("SET preserve_insertion_order = false")
    for split, path in SPLITS.items():
        if not path.exists():
            log(f"missing {path}")
            continue
        f_inc, f_cat, f_det = (AGG / f"{split}_incidents.parquet", AGG / f"{split}_org_category.parquet",
                               AGG / f"{split}_org_detector.parquet")
        if f_inc.exists() and f_cat.exists() and f_det.exists() and not force:
            log(f"{split}: cached")
            continue
        t0 = time.time()
        src = SRC.format(split=split, path=Path(path).as_posix())
        con.execute(f"CREATE OR REPLACE TABLE ev AS SELECT * FROM {src}")
        log(f"{split}: loaded {con.execute('SELECT count(*) FROM ev').fetchone()[0]:,} evidence rows "
            f"in {time.time() - t0:.0f}s")
        con.execute(f"""COPY (
            SELECT org, inc, count(*) AS n_evidence, count(DISTINCT alert) AS n_alerts,
                   count(DISTINCT det) AS n_detectors, count(DISTINCT cat) AS n_categories,
                   count(DISTINCT etype) AS n_entity_types, min(ts) AS first_ts, max(ts) AS last_ts,
                   mode(grade) AS grade, mode(cat) AS top_category, mode(det) AS top_detector,
                   max(action) AS action, count(mitre) > 0 AS has_mitre,
                   count(*) FILTER (WHERE susp = 'Suspicious') AS n_suspicious,
                   count(*) FILTER (WHERE verdict = 'Malicious') AS n_malicious,
                   count(*) FILTER (WHERE verdict = 'Suspicious') AS n_verdict_suspicious,
                   count(*) FILTER (WHERE role = 'Impacted') AS n_impacted,
                   list(DISTINCT cat) AS categories
            FROM ev GROUP BY org, inc) TO '{f_inc.as_posix()}' (FORMAT parquet)""")
        con.execute(f"""COPY (
            SELECT org, cat, count(DISTINCT alert) AS n_alerts, count(DISTINCT inc) AS n_incidents
            FROM ev GROUP BY org, cat) TO '{f_cat.as_posix()}' (FORMAT parquet)""")
        con.execute(f"""COPY (
            SELECT org, det, count(DISTINCT alert) AS n_alerts, count(DISTINCT inc) AS n_incidents
            FROM ev GROUP BY org, det) TO '{f_det.as_posix()}' (FORMAT parquet)""")
        con.execute("DROP TABLE ev")
        out[split] = round(time.time() - t0, 1)
        log(f"{split}: aggregated in {time.time() - t0:.0f}s")
    rk = GUIDE / "GUIDE_Test_Queue_Rankings.csv"
    if rk.exists():
        con.execute(f"COPY (SELECT OrgId AS org, IncidentId AS inc, QueueRank AS queue_rank FROM read_csv_auto('{rk.as_posix()}')) "
                    f"TO '{(AGG / 'test_queue_rankings.parquet').as_posix()}' (FORMAT parquet)")
    con.close()
    return out


if __name__ == "__main__":
    aggregate()
