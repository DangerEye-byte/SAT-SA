"""Write a ready-to-upload submission bundle to data/samples/ for the Ingest demo.

  data/samples/submission/   a new entity (HLT-07, Hospital Network G) with a planted
                             weakness (quick, uninvestigated closures), split across
                             CSV (vendor-style column names), JSON-lines and SQLite
  data/samples/broken/       the same alerts file with unparseable timestamps and a
                             missing column, to show rejection with row numbers
  data/samples/redteam/      a red-team exercise report for TEL-03 (upload on its dossier)

Usage:  python -m satsa.gen.samples
"""

from __future__ import annotations

import sqlite3

import numpy as np
import pandas as pd

from satsa.gen import generator as G
from satsa.store import DATA

OUT = DATA / "samples"


def main(seed: int = 99):
    rng = np.random.default_rng(seed)
    G.RATE_SCALE = 0.5
    res = G.gen_entity("HLT-07", "Hospital Network G", "quick_closer", "M", "INHOUSE", rng)
    sub = OUT / "submission"
    sub.mkdir(parents=True, exist_ok=True)
    res["entities"].to_csv(sub / "entities.csv", index=False)
    res["assets"].to_csv(sub / "asset_inventory.csv", index=False)
    al = res["alerts"].rename(columns={"alert_id": "AlertId", "ts": "Timestamp", "detector_id": "Rule ID",
                                       "asset_id": "Hostname", "severity": "Priority"})
    al.to_csv(sub / "alerts.csv", index=False)
    cs = res["cases"].copy()
    cs.to_json(sub / "cases.jsonl", orient="records", lines=True, date_format="iso")
    esc = res["escalations"].copy()
    esc.to_csv(sub / "escalations.csv", index=False)
    res["submissions"].to_csv(sub / "submissions.csv", index=False)
    db = sub / "workflow.sqlite"
    if db.exists():
        db.unlink()
    con = sqlite3.connect(db)
    ev = res["case_events"].copy()
    ev["ts"] = ev.ts.astype(str)
    ev.to_sql("case_events", con, index=False)
    con.close()

    broken = OUT / "broken"
    broken.mkdir(parents=True, exist_ok=True)
    b = al.head(500).copy()
    b["Timestamp"] = b["Timestamp"].astype(str)
    b.loc[[3, 17, 42], "Timestamp"] = ["31/02/2026 25:61", "yesterday", "N/A-time"]
    b.loc[[100, 101], "AlertId"] = b.loc[99, "AlertId"]
    b.to_csv(broken / "alerts.csv", index=False)
    cs.head(200).to_json(broken / "cases.jsonl", orient="records", lines=True, date_format="iso")

    rt = OUT / "redteam"
    rt.mkdir(parents=True, exist_ok=True)
    t0 = pd.Timestamp(G.START) + pd.Timedelta(days=240, hours=11)
    cats = ["phishing", "credential_dump", "lateral_rdp_smb", "dns_tunnel", "c2_beacon", "exfil_large_upload",
            "priv_escalation", "sched_task"]
    pd.DataFrame({"exercise_id": "RT-TEL-03-2026Q3", "category": cats,
                  "start_ts": [t0 + pd.Timedelta(hours=2 * i) for i in range(len(cats))],
                  "target_asset": [f"TEL-03-A{i + 3:04d}" for i in range(len(cats))]}).to_csv(rt / "tel03_exercise.csv", index=False)
    sizes = {f.name: f.stat().st_size for f in sub.iterdir()}
    print("wrote", OUT, {k: f"{v / 1e6:.1f} MB" for k, v in sizes.items()})


if __name__ == "__main__":
    main()
