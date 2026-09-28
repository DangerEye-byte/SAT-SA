"""Developer check: detector -log10(p) matrix and entity ranking vs the answer key.

Usage:  python -m satsa.eval.quickcheck
"""

import json

import duckdb
import numpy as np
import pandas as pd

from satsa.store import DB_PATH
from satsa.pipeline import TRUTH_DIR


def main():
    pd.set_option("display.width", 250)
    pd.set_option("display.max_rows", 100)
    gt = json.loads((TRUTH_DIR / "ground_truth.json").read_text())["entities"]
    con = duckdb.connect(str(DB_PATH), read_only=True)
    r = con.execute("select entity_id, detector_id, p_value, deterministic, severity from detector_results").df()
    st = r[~r.deterministic].pivot(index="entity_id", columns="detector_id", values="p_value")
    lg = (-np.log10(st.clip(1e-12, 1))).round(1)
    det = r[r.deterministic & r.severity.notna()].groupby("entity_id").detector_id.apply(",".join)
    lg["det"] = lg.index.map(det).fillna("")
    lg["arch"] = lg.index.map(lambda e: gt[e]["archetype"][:12])
    lg["prov"] = lg.index.map(lambda e: gt[e]["provider"])
    print(lg.sort_values("arch").to_string())
    s = con.execute("select entity_id, p_value, q_value, attention from entity_scores order by attention desc, p_value").df()
    s["arch"] = s.entity_id.map(lambda e: gt[e]["archetype"])
    s["prov"] = s.entity_id.map(lambda e: gt[e]["provider"])
    print(s.to_string())


if __name__ == "__main__":
    main()
