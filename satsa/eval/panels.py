"""Panel jobs for the validation suite.

Each job generates one seeded panel into a temporary folder, analyses it in an
in-memory DuckDB (the main database is never touched) and returns a compact,
picklable summary. Jobs run in worker processes, so everything a job needs
(including extra archetypes for the power study) is set up inside the job."""

from __future__ import annotations

import hashlib
import json
import shutil
import time
import warnings
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from satsa.store import DATA

TMP = DATA / "tmp_eval"

# Archetype classes used by the metrics
STAT_ARCH = {"utility_p", "quick_closer", "template_writer", "unescalated", "sla_gamer", "silent_asset", "ratchet",
             "slow_decay", "attrition", "night_gap", "late_reporter"}
DET_ARCH = {"blind": "NS3", "clock_skew": "NS9", "retention_gap": "NS8"}
HARD_NEG = {"hard_neg_soar", "hard_neg_small"}

# Graded effect sizes for the power study (V5). Healthy values: sup_base 0.03,
# esc_rate 0.93, sla_gamer 0.
POWER_GRID = {
    "superficial": ("sup_base", [0.05, 0.07, 0.10, 0.14, 0.20], ["EG1", "EG4"]),
    "escalation": ("esc_rate", [0.85, 0.75, 0.65, 0.50, 0.35], ["EG2"]),
    "sla_gaming": ("sla_gamer", [0.10, 0.20, 0.30, 0.50, 0.75], ["EG6"]),
}


def null_roster():
    """The demo roster with every entity made healthy (hard negatives kept, since
    they are healthy too) and the weak provider replaced by a normal one."""
    from satsa.gen import archetypes as ar
    out = []
    for eid, name, arch, size, prov in ar.ROSTER:
        arch = arch if arch in HARD_NEG else "healthy"
        out.append((eid, name, arch, size, "MSSP-2" if prov == ar.WEAK_PROVIDER else prov))
    return out


def power_roster():
    """Null roster with 15 medium-size healthy entities replaced by graded variants."""
    from satsa.gen import archetypes as ar
    base = null_roster()
    slots = [i for i, r in enumerate(base) if r[2] == "healthy" and r[3] == "M"]
    k = 0
    for fam, (param, levels, expected) in POWER_GRID.items():
        for lv in levels:
            name = f"pw_{fam}_{lv}"
            ar.ARCHETYPES[name] = {param: lv}
            ar.EXPECTED[name] = expected
            i = slots[k]
            eid, nm, _, size, prov = base[i]
            base[i] = (eid, nm, name, size, prov)
            k += 1
    return base


def _frame_hash(df: pd.DataFrame) -> str:
    h = hashlib.sha256()
    h.update(pd.util.hash_pandas_object(df.round(12), index=False).to_numpy().tobytes())
    return h.hexdigest()


def _dir_hash(folder: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(folder.glob("*.parquet")):
        # hash table contents, not file bytes (parquet footers carry writer metadata)
        df = pd.read_parquet(p)
        h.update(p.name.encode())
        h.update(pd.util.hash_pandas_object(df.astype(str), index=False).to_numpy().tobytes())
    return h.hexdigest()


def run_panel(kind: str, seed: int, rate_scale: float = 0.5, keep_cases: bool = False, tag: str = "") -> dict:
    """Generate + analyse one panel and summarise it."""
    warnings.filterwarnings("ignore")
    import psutil

    from satsa.gen.generator import generate
    from satsa.pipeline import analyze

    roster = {"demo": None, "null": null_roster, "power": power_roster}[kind]
    roster = roster() if roster else None
    out = TMP / f"{kind}_{seed}{tag}"
    shutil.rmtree(out, ignore_errors=True)
    t0 = time.time()
    generate(out, seed, roster=roster, rate_scale=rate_scale)
    t_gen = time.time() - t0
    con = duckdb.connect(":memory:")
    t1 = time.time()
    a = analyze(con, out, quarters=True)
    t_an = time.time() - t1
    gt = json.loads((out / "_truth" / "ground_truth.json").read_text())["entities"]
    res = a["res"][["entity_id", "detector_id", "p_value", "deterministic", "severity"]].copy()
    sc = a["scores"][["entity_id", "p_value", "q_value", "attention", "det_severity"]].copy()
    summary = {
        "kind": kind, "seed": seed, "rate_scale": rate_scale, "gt": gt,
        "entities": a["ctx"].entities[["entity_id", "sector", "size_band", "soc_provider"]].copy(),
        "res": res, "scores": sc, "counts": a["counts"],
        "seconds_generate": t_gen, "seconds_analyze": t_an,
        "peak_rss_gb": getattr(psutil.Process().memory_info(), "peak_wset", psutil.Process().memory_info().rss) / 1e9,
        "quarterly": a["quarterly"][["entity_id", "look", "p_value", "cum_e", "ebh_flag", "naive_bh_flag"]],
        "input_hash": _dir_hash(out),
        "result_hash": _frame_hash(sc.sort_values("entity_id")[["p_value", "q_value", "attention"]]) + ":" +
                       _frame_hash(res.sort_values(["entity_id", "detector_id"])[["p_value"]].fillna(-1)),
    }
    if keep_cases:
        truth = pd.read_parquet(out / "_truth" / "case_truth.parquet")
        cf = a["cf"]
        pop = cf[cf.closed & ~cf.auto_closed][["entity_id", "case_id", "severity", "yhat", "opened_ts"]]
        pop = pop.merge(truth, on="case_id")
        from satsa.pipeline import prior_labels
        train = set(prior_labels(cf, truth_dir=out / "_truth").case_id)
        pop["train"] = pop.case_id.isin(train)
        summary["pop"] = pop.reset_index(drop=True)
    con.close()
    shutil.rmtree(out, ignore_errors=True)
    return summary
