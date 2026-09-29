"""SAT-SA validation suite. Writes reports/validation.json (served by /api/validation).

Usage:  python -m satsa.eval.run_all [--jobs 4] [--fresh] [--quick]

Experiments (all numbers are on SYNTHETIC, seeded panels with a hidden answer key):
  V1  planted-weakness recovery over several seeds (+ per-detector ablation)
  V2  false-discovery calibration on healthy-only null panels (+ p-value uniformity)
  V3  prediction-powered inference: coverage, width and label savings vs the truth
  V4  examiner effort: weaknesses found per review, manual sampling vs SAT-SA
  V5  power: smallest planted effect detected, per weakness type
  V8  runtime and memory on this machine; API latency
  V9  reproducibility: same seed -> identical data and findings

Panel results are cached in reports/cache/ so an interrupted run resumes."""

from __future__ import annotations

import argparse
import json
import os
import pickle
import platform
import time
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

from satsa.eval.panels import DET_ARCH, HARD_NEG, POWER_GRID, STAT_ARCH, run_panel
from satsa.store import ROOT

REPORTS = ROOT / "reports"
CACHE = REPORTS / "cache"
QS = [0.05, 0.10, 0.20]
WEAK_PROVIDER = "MSSP-3"

DEMO_SEEDS = [7, 11, 23, 31, 47]
NULL_SEEDS = list(range(1000, 1040))
POWER_SEEDS = list(range(2000, 2006))


# ------------------------------------------------------------------ helpers
def _cp(k: int, n: int, alpha: float = 0.05):
    """Clopper-Pearson interval."""
    lo = stats.beta.ppf(alpha / 2, k, n - k + 1) if k > 0 else 0.0
    hi = stats.beta.ppf(1 - alpha / 2, k + 1, n - k) if k < n else 1.0
    return [float(lo), float(hi)]


def _r(x, d=4):
    if isinstance(x, (float, np.floating)):
        return None if not np.isfinite(x) else round(float(x), d)
    return x


def _clean(o):
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        return _r(float(o))
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def entity_class(arch: str, prov: str) -> str:
    if arch in STAT_ARCH:
        return "planted_statistical"
    if arch in DET_ARCH:
        return "planted_deterministic"
    if arch in HARD_NEG:
        return "hard_negative"
    if arch.startswith("pw_"):
        return "power_variant"
    if prov == WEAK_PROVIDER:
        return "weak_provider_client"
    return "healthy"


def annotate(s: dict) -> pd.DataFrame:
    sc = s["scores"].copy()
    sc["arch"] = sc.entity_id.map(lambda e: s["gt"][e]["archetype"])
    sc["prov"] = sc.entity_id.map(lambda e: s["gt"][e]["provider"])
    sc["cls"] = [entity_class(a, p) for a, p in zip(sc.arch, sc.prov)]
    sc["truly_weak"] = sc.cls.isin(["planted_statistical", "planted_deterministic", "weak_provider_client", "power_variant"])
    sc = sc.sort_values(["attention", "p_value"], ascending=[False, True]).reset_index(drop=True)
    sc["rank"] = np.arange(1, len(sc) + 1)
    return sc


def rescore(res: pd.DataFrame, drop: str | None = None) -> pd.DataFrame:
    """Entity p/q-values from detector rows, optionally without one detector."""
    from satsa.stats.core import acat, qvalues
    st = res[~res.deterministic & res.p_value.notna()]
    if drop:
        st = st[st.detector_id != drop]
    ents = sorted(res.entity_id.unique())
    p = [acat(st[st.entity_id == e].p_value.to_numpy()) if (st.entity_id == e).any() else 1.0 for e in ents]
    return pd.DataFrame({"entity_id": ents, "p_value": p, "q_value": qvalues(np.array(p))})


# ------------------------------------------------------------------ jobs
def _job(args):
    kind, seed, rate, keep, tag = args
    return run_panel(kind, seed, rate_scale=rate, keep_cases=keep, tag=tag)


def job_list(quick: bool):
    demo = DEMO_SEEDS[:2] if quick else DEMO_SEEDS
    null = NULL_SEEDS[:6] if quick else NULL_SEEDS
    power = POWER_SEEDS[:2] if quick else POWER_SEEDS
    jobs = [("demo", s, 0.5, s == 7, "") for s in demo]
    jobs.append(("demo", 7, 0.5, False, "_repeat"))
    jobs += [("null", s, 0.25, False, "") for s in null]
    jobs += [("power", s, 0.5, False, "") for s in power]
    return jobs


def run_jobs(jobs, n_workers: int, fresh: bool, log) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    results, todo = {}, []
    for j in jobs:
        key = f"{j[0]}_{j[1]}{j[4]}"
        f = CACHE / f"{key}.pkl"
        if f.exists() and not fresh:
            results[key] = pickle.loads(f.read_bytes())
        else:
            todo.append((key, j))
    log(f"{len(results)} panels cached, {len(todo)} to run on {n_workers} workers")
    if todo:
        t0 = time.time()
        with ProcessPoolExecutor(max_workers=n_workers) as ex:
            futs = {ex.submit(_job, j): key for key, j in todo}
            for i, fu in enumerate(as_completed(futs), 1):
                key = futs[fu]
                r = fu.result()
                (CACHE / f"{key}.pkl").write_bytes(pickle.dumps(r))
                results[key] = r
                log(f"  [{i}/{len(todo)}] {key} done ({time.time() - t0:.0f}s elapsed)")
    return results


# ------------------------------------------------------------------ V1
def v1_recovery(demo: list[dict]) -> dict:
    per_seed, arch_rows, abl_rows, pk_rows = [], [], [], []
    for s in demo:
        sc = annotate(s)
        res = s["res"]
        fired = res[(res.p_value <= 0.01) | res.severity.notna()].groupby("entity_id").detector_id.apply(set)
        for q in QS:
            stat = sc.q_value <= q
            det = sc.det_severity > 0
            anyf = stat | det
            ps = sc[sc.cls == "planted_statistical"]
            pdt = sc[sc.cls == "planted_deterministic"]
            det_hit = [DET_ARCH[a] in fired.get(e, set()) for e, a in zip(pdt.entity_id, pdt.arch)]
            planted = sc.cls.isin(["planted_statistical", "planted_deterministic"])
            planted_hit = int(stat[sc.cls == "planted_statistical"].sum()) + int(sum(det_hit))
            false_stat = int((stat & sc.cls.isin(["healthy", "hard_negative"])).sum())
            per_seed.append({
                "seed": s["seed"], "q": q,
                "planted_statistical_recall": float(stat[ps.index].mean()),
                "planted_deterministic_recall": float(np.mean(det_hit)) if det_hit else None,
                "planted_recall_any_lane": planted_hit / int(planted.sum()),
                "weak_provider_client_recall": float(stat[sc.cls == "weak_provider_client"].mean()),
                "hard_negative_flags": int(anyf[sc.cls == "hard_negative"].sum()),
                "healthy_statistical_flags": false_stat,
                "healthy_deterministic_flags": int((det & sc.cls.isin(["healthy", "hard_negative"])).sum()),
                "statistical_flags": int(stat.sum()),
                "false_discovery_proportion": false_stat / max(int(stat.sum()), 1),
            })
        for k in (5, 10, 15, 20):
            pk_rows.append({"seed": s["seed"], "k": k, "precision": float(sc.head(k).truly_weak.mean())})
        for r in sc.itertuples():
            if r.cls in ("planted_statistical", "planted_deterministic", "hard_negative", "weak_provider_client"):
                exp = set(s["gt"][r.entity_id]["expected_detectors"])
                got = fired.get(r.entity_id, set())
                flagged = (r.q_value <= 0.1) or (r.det_severity > 0 and (r.cls != "planted_deterministic"
                                                                         or DET_ARCH[r.arch] in got))
                if r.cls == "planted_deterministic":
                    flagged = DET_ARCH[r.arch] in got
                arch_rows.append({"seed": s["seed"], "entity_id": r.entity_id, "archetype": r.arch, "class": r.cls,
                                  "flagged": bool(flagged), "rank": int(r.rank), "q_value": float(r.q_value),
                                  "expected_fired": (len(exp & got) / len(exp)) if exp else None})
        base = rescore(res)
        cls = sc.set_index("entity_id").cls
        for d in sorted(res[~res.deterministic].detector_id.unique()):
            rs = rescore(res, drop=d)
            rs["cls"] = rs.entity_id.map(cls)
            ps_ = rs[rs.cls == "planted_statistical"]
            lost = sorted(set(base[(base.q_value <= 0.1) & base.entity_id.isin(ps_.entity_id)].entity_id)
                          - set(ps_[ps_.q_value <= 0.1].entity_id))
            abl_rows.append({"seed": s["seed"], "detector": d, "recall": float((ps_.q_value <= 0.1).mean()),
                             "lost": [s["gt"][e]["archetype"] for e in lost],
                             "healthy_flags": int(((rs.q_value <= 0.1) & rs.cls.isin(["healthy", "hard_negative"])).sum())})
    ps = pd.DataFrame(per_seed)
    summary = ps.groupby("q").agg(["mean", "min", "max"]).drop(columns="seed")
    summ = {}
    for q in QS:
        row = summary.loc[q]
        summ[str(q)] = {c: {"mean": row[(c, "mean")], "min": row[(c, "min")], "max": row[(c, "max")]}
                        for c in ps.columns if c not in ("seed", "q")}
    ar = pd.DataFrame(arch_rows)
    by_arch = ar.groupby(["archetype", "class"]).agg(entities=("entity_id", "size"), detected=("flagged", "mean"),
                                                     median_rank=("rank", "median"),
                                                     expected_detectors_fired=("expected_fired", "mean")).reset_index()
    ab = pd.DataFrame(abl_rows)
    abl = ab.groupby("detector").agg(recall=("recall", "mean"), healthy_flags=("healthy_flags", "mean")).reset_index()
    abl["archetypes_lost"] = abl.detector.map(
        lambda d: sorted({a for L in ab[ab.detector == d].lost for a in L}))
    return {
        "description": "Recovery of planted weaknesses on the 42-entity demo roster, repeated over independently "
                       "seeded panels. Statistical lane: flagged when q <= level. Deterministic lane: documented facts "
                       "(blind tactic, clock violation, retention gap, red-team miss).",
        "seeds": [s["seed"] for s in demo], "levels": QS, "summary": summ,
        "per_seed": ps.to_dict("records"),
        "by_archetype": by_arch.to_dict("records"),
        "precision_at_k": pd.DataFrame(pk_rows).groupby("k").precision.agg(["mean", "min"]).reset_index().to_dict("records"),
        "ablation": abl.sort_values("recall").to_dict("records"),
        "note": "Weak-provider (MSSP-3) clients are degraded by only +7 pp superficial handling each, by design "
                "individually borderline; they are meant to be caught at provider level (D11, see providers).",
    }


# ------------------------------------------------------------------ V2
def v2_calibration(null: list[dict], demo: list[dict]) -> dict:
    fdr = []
    for q in QS:
        R = [int((s["scores"].q_value <= q).sum()) for s in null]
        k = sum(r > 0 for r in R)
        fdr.append({"q": q, "panels": len(R), "panels_with_any_flag": k, "realized_fdr": k / len(R),
                    "ci95": _cp(k, len(R)), "mean_false_flags_per_panel": float(np.mean(R))})
    # mixed panels (planted + healthy): realized FDP averaged over seeds
    mixed = []
    for q in QS:
        fdps = []
        for s in demo:
            sc = annotate(s)
            flag = sc.q_value <= q
            fdps.append(int((flag & sc.cls.isin(["healthy", "hard_negative"])).sum()) / max(int(flag.sum()), 1))
        mixed.append({"q": q, "realized_fdr": float(np.mean(fdps)), "max_fdp": float(np.max(fdps))})
    ent_p = np.concatenate([s["scores"].p_value.to_numpy() for s in null])
    det = pd.concat([s["res"].assign(seed=s["seed"]) for s in null])
    st = det[~det.deterministic & det.p_value.notna()]
    per_det = []
    for d, g in st.groupby("detector_id"):
        n = len(g)
        k1, k5 = int((g.p_value <= 0.01).sum()), int((g.p_value <= 0.05).sum())
        per_det.append({"detector": d, "tests": n, "rate_at_0.01": k1 / n, "ci_0.01": _cp(k1, n),
                        "rate_at_0.05": k5 / n, "ci_0.05": _cp(k5, n), "mean_p": float(g.p_value.mean())})
    grid = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5]
    ecdf = [{"t": t, "entity_rate": float((ent_p <= t).mean()),
             "detector_rate": float((st.p_value <= t).mean())} for t in grid]
    qs = np.linspace(0.005, 0.995, 100)
    qq = {"expected": qs.round(4).tolist(), "entity": np.quantile(ent_p, qs).round(4).tolist(),
          "detector": np.quantile(st.p_value, qs).round(4).tolist()}
    dl = det[det.deterministic & det.severity.notna()]
    n_ent = sum(len(s["scores"]) for s in null)
    return {
        "description": f"{len(null)} independently seeded null panels of 42 entities where every entity is healthy "
                       "(hard negatives included). Any statistical flag is a false discovery, so the realized FDR is "
                       "the share of panels with at least one flag. Mixed panels: the demo-roster seeds, where "
                       "planted weaknesses are present.",
        "null_panels": fdr, "mixed_panels": mixed, "entity_pvalue_ecdf": ecdf,
        "ks_uniform_entity": {"stat": float(stats.kstest(ent_p, "uniform").statistic),
                              "p": float(stats.kstest(ent_p, "uniform").pvalue)},
        "per_detector_type1": per_det, "qq": qq,
        "deterministic_on_null": {"entities": n_ent, "flags": int(len(dl)),
                                  "by_detector": dl.detector_id.value_counts().to_dict(),
                                  "by_severity": dl.severity.value_counts().to_dict(),
                                  "note": "Deterministic findings are facts, not statistical claims. On healthy panels "
                                          "they are red-team techniques that a healthy SOC missed (5% per-technique "
                                          "miss rate in the simulator): real misses, rated medium."},
    }


# ------------------------------------------------------------------ V3
def v3_ppi(pop: pd.DataFrame, reps: int = 200, ns=(10, 20, 30, 50, 100), seed: int = 0) -> dict:
    from satsa.stats.core import ppi_mean_ci
    rng = np.random.default_rng(seed)
    z = stats.norm.ppf(0.95)
    rows = []
    for eid, g in pop.groupby("entity_id"):
        g = g[~g.train]
        y = g.superficial.to_numpy(float)
        yh = g.yhat.to_numpy(float)
        theta = y.mean()
        for n in ns:
            if len(g) < 5 * n:
                continue
            for _ in range(reps):
                idx = rng.choice(len(g), n, replace=False)
                mask = np.zeros(len(g), bool)
                mask[idx] = True
                Y, Yh, U = y[mask], yh[mask], yh[~mask]
                r = ppi_mean_ci(Y, Yh, U, alpha=0.1)
                lo, hi = r["lo"], r["hi"]
                k = Y.sum()
                c = (k + z * z / 2) / (n + z * z)
                h = z * np.sqrt(k * (n - k) / n + z * z / 4) / (n + z * z)
                clo, chi = max(0.0, c - h), min(1.0, c + h)
                rows.append((eid, n, theta, lo <= theta <= hi, hi - lo, clo <= theta <= chi, chi - clo))
    df = pd.DataFrame(rows, columns=["entity_id", "n", "theta", "ppi_cover", "ppi_width", "cls_cover", "cls_width"])
    df["weak"] = df.theta >= 0.10
    agg = df.groupby("n").agg(ppi_coverage=("ppi_cover", "mean"), classical_coverage=("cls_cover", "mean"),
                              ppi_width=("ppi_width", "mean"), classical_width=("cls_width", "mean")).reset_index()
    agg["label_saving"] = 1 - (agg.ppi_width / agg.classical_width) ** 2
    by_type = df.groupby(["n", "weak"]).agg(ppi_coverage=("ppi_cover", "mean"), ppi_width=("ppi_width", "mean"),
                                            classical_width=("cls_width", "mean")).reset_index()
    by_type["label_saving"] = 1 - (by_type.ppi_width / by_type.classical_width) ** 2
    per_ent = df[df.n == 30].groupby("entity_id").agg(theta=("theta", "first"), coverage=("ppi_cover", "mean"),
                                                      saving=("ppi_width", "mean")).reset_index()
    per_ent["saving"] = 1 - (per_ent.saving / df[df.n == 30].groupby("entity_id").cls_width.mean().values) ** 2
    return {
        "description": "For every entity, repeated uniform random samples of n examiner labels (the hidden answer "
                       "key plays the examiner). Target: the entity's true share of superficially handled cases. "
                       "90% intervals: PPI++ with power tuning and a Wilson-regularised variance (labels + model predictions "
                       "on all other cases) vs classical Wilson "
                       "(labels only). Label saving = 1 - (PPI width / classical width)^2, i.e. the share of labels "
                       "PPI saves for the same precision.",
        "alpha": 0.1, "reps_per_entity": reps, "entities": int(df.entity_id.nunique()),
        "by_n": agg.to_dict("records"), "by_type": by_type.to_dict("records"),
        "per_entity_n30": per_ent.sort_values("theta", ascending=False).to_dict("records"),
        "min_labels_shown_in_app": 20,
    }


# ------------------------------------------------------------------ V4
def v4_effort(pop: pd.DataFrame, sc: pd.DataFrame, budgets=(60, 120, 240, 480), reps: int = 200, seed: int = 1,
              per_entity: int = 20, confirm: int = 3) -> dict:
    rng = np.random.default_rng(seed)
    pop = pop[~pop.train].reset_index(drop=True)
    rate = pop.groupby("entity_id").superficial.mean()
    weak = set(rate[rate >= 2 * rate.median()].index)
    ents = rate.index.to_numpy()
    by_ent = {e: g for e, g in pop.groupby("entity_id")}
    sev_rank = pop.severity.map({"critical": 0, "high": 1, "medium": 2, "low": 3}).to_numpy()

    def score(sample: pd.DataFrame):
        found = sample.superficial.sum()
        per = sample[sample.superficial].groupby("entity_id").size()
        conf = {e for e, c in per.items() if c >= confirm and e in weak}
        return found, len(conf)

    def take_entities(order, B, targeted):
        parts, left = [], B
        for e in order:
            if left <= 0:
                break
            g = by_ent[e]
            k = min(per_entity, left, len(g))
            if targeted:
                top = g.nlargest(k // 2, "yhat")
                rest = g.drop(top.index)
                parts.append(pd.concat([top, rest.sample(k - len(top), random_state=int(rng.integers(1e9)))]))
            else:
                parts.append(g.sample(k, random_state=int(rng.integers(1e9))))
            left -= k
        return pd.concat(parts)

    queue = sc.sort_values(["attention", "p_value"], ascending=[False, True]).entity_id.tolist()
    rows = []
    for B in budgets:
        res = {"random_cases": [], "random_entities": [], "severity_first": [], "satsa": []}
        for _ in range(reps):
            res["random_cases"].append(score(pop.sample(B, random_state=int(rng.integers(1e9)))))
            res["random_entities"].append(score(take_entities(rng.permutation(ents), B, False)))
            jitter = rng.random(len(pop))
            order = np.lexsort((jitter, sev_rank))[:B]
            res["severity_first"].append(score(pop.iloc[order]))
        for _ in range(20):
            res["satsa"].append(score(take_entities(queue, B, True)))
        for strat, v in res.items():
            v = np.array(v, float)
            rows.append({"budget": B, "strategy": strat, "superficial_found_per_100": float(v[:, 0].mean() / B * 100),
                         "weak_entities_confirmed": float(v[:, 1].mean()), "weak_entities_total": len(weak)})
    return {
        "description": "Equal examiner budgets (cases reviewed across the whole panel). A weak entity is 'confirmed' "
                       f"when the reviewed sample contains >= {confirm} superficially handled cases from it. Strategies: "
                       "random cases; random entities (20 cases each); severity-first (critical cases first); SAT-SA "
                       "(entities in queue order, 20 cases each: 10 highest-risk by the model + 10 uniform random so "
                       "the PPI estimate stays valid).",
        "weak_definition": "true superficial-handling rate at least twice the panel median",
        "rows": rows,
    }


# ------------------------------------------------------------------ V5
def v5_power(power: list[dict]) -> dict:
    rows = []
    for s in power:
        sc = annotate(s)
        for r in sc[sc.cls == "power_variant"].itertuples():
            fam, lv = r.arch[3:].rsplit("_", 1)
            rows.append({"seed": s["seed"], "family": fam, "level": float(lv), "detected": bool(r.q_value <= 0.1)})
        fp = int(((sc.q_value <= 0.1) & sc.cls.isin(["healthy", "hard_negative"])).sum())
        rows.append({"seed": s["seed"], "family": "_healthy_false_flags", "level": fp, "detected": fp > 0})
    df = pd.DataFrame(rows)
    fams = df[df.family != "_healthy_false_flags"].groupby(["family", "level"]).detected.agg(["mean", "size"]).reset_index()
    healthy = {"superficial": 0.03, "escalation": 0.93, "sla_gaming": 0.0}
    labels = {"superficial": "share of cases handled superficially", "escalation": "share of critical cases escalated",
              "sla_gaming": "share of over-SLA critical closures pulled under the SLA"}
    out = {}
    for fam, g in fams.groupby("family"):
        out[fam] = {"parameter": labels[fam], "healthy_value": healthy[fam],
                    "levels": g.level.tolist(), "detection_rate": g["mean"].round(3).tolist(), "panels": int(g["size"].iloc[0])}
    hf = df[df.family == "_healthy_false_flags"].level
    return {"description": "Graded weaknesses planted into otherwise healthy panels (one entity per level per panel); "
                           "detection = flagged at q <= 0.10. Shows the smallest effect SAT-SA reliably sees, and what "
                           "it cannot see.", "families": out,
            "healthy_false_flags_per_panel": float(hf.mean()), "panels": int(len(hf))}


# ------------------------------------------------------------------ V12
def v12_anytime(null: list[dict], demo: list[dict], q: float = 0.10) -> dict:
    """Four quarterly looks. Naive: flag an entity if per-quarter BH flags it at any look.
    Anytime-valid: e-BH on the running product of quarterly e-values."""
    naive = [bool(s["quarterly"].groupby("entity_id").naive_bh_flag.any().any()) for s in null]
    ev = [bool(s["quarterly"].groupby("entity_id").ebh_flag.any().any()) for s in null]
    rec_naive, rec_e = [], []
    for s in demo:
        sc = annotate(s)
        planted = set(sc[sc.cls == "planted_statistical"].entity_id)
        qd = s["quarterly"]
        final = qd[qd.look == qd.look.max()]
        rec_e.append(len(planted & set(final[final.ebh_flag].entity_id)) / len(planted))
        rec_naive.append(len(planted & set(qd[qd.naive_bh_flag].entity_id)) / len(planted))
    return {"description": "Four quarterly looks at the same entities. Naive: flag when BH on that quarter's p-values "
                           "flags it at any look (repeated looks inflate false alarms). SAT-SA: e-BH on the running "
                           "product of quarterly e-values (valid at any look).",
            "q": q, "null_panels": len(null),
            "naive_realized_fdr": float(np.mean(naive)), "naive_ci95": _cp(int(np.sum(naive)), len(naive)),
            "ebh_realized_fdr": float(np.mean(ev)), "ebh_ci95": _cp(int(np.sum(ev)), len(ev)),
            "planted_recall_by_look4_ebh": float(np.mean(rec_e)), "planted_recall_any_look_naive": float(np.mean(rec_naive))}


# ------------------------------------------------------------------ V8 / V9
def v8_runtime(demo7: dict, log) -> dict:
    import psutil
    from fastapi.testclient import TestClient

    from satsa import pipeline
    t0 = time.time()
    pipeline.run(regen=True, seed=7, verbose=False)
    t_pipe = time.time() - t0
    from satsa.api.main import app
    c = TestClient(app)
    top = c.get("/api/queue").json()
    eid = top["entities"][0]["entity_id"]
    paths = ["/api/meta", "/api/queue?fdr=0.1", "/api/entities", f"/api/entities/{eid}", f"/api/entities/{eid}/hourly",
             f"/api/entities/{eid}/regulatory", f"/api/entities/{eid}/evidence", f"/api/entities/{eid}/survival",
             f"/api/review/{eid}", "/api/blindspot", "/api/providers", "/api/ledger", "/api/gaming/run"]
    lat = []
    for pth in paths:
        ts = []
        status = None
        for _ in range(15):
            a = time.perf_counter()
            r = c.post(pth) if pth.endswith("verify") else c.get(pth)
            ts.append((time.perf_counter() - a) * 1000)
            status = r.status_code
        lat.append({"path": pth, "status": status, "p50_ms": float(np.median(ts)), "p95_ms": float(np.quantile(ts, 0.95))})
    vm = psutil.virtual_memory()
    return {
        "machine": {"os": f"{platform.system()} {platform.release()}", "cpu": platform.processor(),
                    "logical_cores": os.cpu_count(), "ram_gb": round(vm.total / 1e9, 1),
                    "python": platform.python_version()},
        "demo_panel": {"alerts": demo7["counts"].get("alerts"), "cases": demo7["counts"].get("cases"),
                       "workflow_events": demo7["counts"].get("case_events"),
                       "generate_seconds": demo7["seconds_generate"], "analyze_seconds": demo7["seconds_analyze"],
                       "peak_memory_gb": demo7["peak_rss_gb"]},
        "full_pipeline_seconds_including_generation_and_db_write": round(t_pipe, 1),
        "api_latency": lat,
        "note": "CPU only, no GPU, fully offline.",
    }


def v9_repro(a: dict, b: dict) -> dict:
    return {"description": "The demo panel generated and analysed twice from seed 7 in separate processes.",
            "input_hash_equal": a["input_hash"] == b["input_hash"], "result_hash_equal": a["result_hash"] == b["result_hash"],
            "input_hash": a["input_hash"][:16], "result_hash": a["result_hash"][:16]}


# ------------------------------------------------------------------ main
def headline(v: dict) -> dict:
    v1 = v["V1_recovery"]["summary"]["0.1"]
    v2 = {r["q"]: r for r in v["V2_calibration"]["null_panels"]}
    v3 = {r["n"]: r for r in v["V3_ppi"]["by_n"]}
    v4 = [r for r in v["V4_effort"]["rows"] if r["budget"] == 240]
    v4d = {r["strategy"]: r for r in v4}
    return {
        "synthetic": True,
        "planted_statistical_recall_q10": v1["planted_statistical_recall"]["mean"],
        "planted_recall_any_lane_q10": v1["planted_recall_any_lane"]["mean"],
        "hard_negative_flags_q10": v1["hard_negative_flags"]["max"],
        "healthy_statistical_flags_q10_mean": v1["healthy_statistical_flags"]["mean"],
        "null_realized_fdr_q10": v2[0.1]["realized_fdr"], "null_realized_fdr_q10_ci": v2[0.1]["ci95"],
        "null_panels": v2[0.1]["panels"],
        "ppi_coverage_n30": v3.get(30, {}).get("ppi_coverage"), "ppi_label_saving_n30": v3.get(30, {}).get("label_saving"),
        "weak_found_per_100_satsa_b240": v4d["satsa"]["superficial_found_per_100"],
        "weak_found_per_100_random_b240": v4d["random_cases"]["superficial_found_per_100"],
        "weak_entities_confirmed_satsa_b240": v4d["satsa"]["weak_entities_confirmed"],
        "weak_entities_confirmed_random_b240": v4d["random_cases"]["weak_entities_confirmed"],
        "weak_entities_total": v4d["satsa"]["weak_entities_total"],
    }


def main():
    warnings.filterwarnings("ignore")
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--quick", action="store_true", help="fewer panels, for development")
    ap.add_argument("--skip-runtime", action="store_true", help="skip V8 (which rewrites the main database)")
    a = ap.parse_args()
    log = lambda *x: print(*x, flush=True)  # noqa: E731
    t0 = time.time()
    R = run_jobs(job_list(a.quick), a.jobs, a.fresh, log)
    demo = [R[k] for k in sorted(R) if k.startswith("demo_") and not k.endswith("_repeat")]
    null = [R[k] for k in sorted(R) if k.startswith("null_")]
    power = [R[k] for k in sorted(R) if k.startswith("power_")]
    d7 = R["demo_7"]
    log("computing metrics ...")
    v = {"generated": pd.Timestamp.now().isoformat(timespec="seconds"), "synthetic": True,
         "disclaimer": "All numbers in this report are measured on SYNTHETIC, seeded panels with a hidden answer key. "
                       "Real-data results (Microsoft GUIDE) are in reports/guide.json."}
    v["V1_recovery"] = v1_recovery(demo)
    v["V2_calibration"] = v2_calibration(null, demo)
    log("  V3 PPI ...")
    v["V3_ppi"] = v3_ppi(d7["pop"])
    log("  V4 examiner effort ...")
    v["V4_effort"] = v4_effort(d7["pop"], d7["scores"])
    v["V5_power"] = v5_power(power)
    v["V9_reproducibility"] = v9_repro(d7, R["demo_7_repeat"])
    log("  D4 gaming lab ...")
    from satsa.eval.gaming import matrix
    v["D4_gaming"] = matrix(400)
    if all("quarterly" in s for s in null + demo):
        v["V12_anytime"] = v12_anytime(null, demo)
    if not a.skip_runtime:
        log("  V8 runtime (reruns the main pipeline) ...")
        v["V8_runtime"] = v8_runtime(d7, log)
    else:
        old = REPORTS / "validation.json"
        if old.exists():
            prev = json.loads(old.read_text())
            if "V8_runtime" in prev:
                v["V8_runtime"] = prev["V8_runtime"]
    v["headline"] = headline(v)
    v["suite_seconds"] = round(time.time() - t0, 1)
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "validation.json").write_text(json.dumps(_clean(v), indent=1))
    log(json.dumps(_clean(v["headline"]), indent=1))
    log(f"wrote reports/validation.json in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
