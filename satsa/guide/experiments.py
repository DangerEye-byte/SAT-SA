"""Real-data validation on Microsoft GUIDE. Writes reports/guide.json (served by /api/guide).

Usage:  python -m satsa.guide.experiments        (needs satsa.guide.aggregate first)

GUIDE's train/test files are a random split of the same organisations' incidents over
the same period. That gives a real-data null with known truth: if each org's incidents
are pooled and randomly re-split into a "baseline" and a "current" half, nothing about
the org has changed, so every flag is a false alarm. Planting degradations into the
current half of a few real orgs then measures recall against real background noise.

  R1  real-data false-alarm calibration (random re-splits, 4,000+ real orgs)
  R2  semi-synthetic recall on real orgs: suppressed alert categories (negative space,
      V6) and true positives re-graded as false positives (degraded triage, V7)
  R3  peer comparison on real orgs: how many are flagged, and do flags replicate
      across independent halves of their incidents
  R4  prediction-powered inference on real analyst verdicts: coverage and savings
  R5  expert priority labels (V10): does model-guided sampling surface the incidents
      experts ranked top-20 in each org's queue, vs random / arrival / alert count
"""

from __future__ import annotations

import json
import time
import warnings

import duckdb
import numpy as np
import pandas as pd
from scipy import stats

from satsa.guide.aggregate import AGG
from satsa.stats.core import acat, ppi_mean_ci, qvalues, rate_test
from satsa.store import ROOT

REPORTS = ROOT / "reports"
FEATS = ["n_evidence", "n_alerts", "n_detectors", "n_categories", "n_entity_types", "duration_min", "has_mitre",
         "n_suspicious", "n_malicious", "n_verdict_suspicious", "n_impacted", "hour", "cat_code", "det_freq",
         "org_log_size"]


# ------------------------------------------------------------------ data
def load() -> pd.DataFrame:
    con = duckdb.connect()
    df = con.execute(f"""
        SELECT '{'train'}' AS split, * EXCLUDE (categories), array_to_string(categories, '|') AS cats
        FROM '{(AGG / 'train_incidents.parquet').as_posix()}'
        UNION ALL
        SELECT 'test' AS split, * EXCLUDE (categories), array_to_string(categories, '|') AS cats
        FROM '{(AGG / 'test_incidents.parquet').as_posix()}'""").df()
    rk = con.execute(f"SELECT * FROM '{(AGG / 'test_queue_rankings.parquet').as_posix()}'").df()
    con.close()
    df = df.merge(rk, on=["org", "inc"], how="left")
    df["expert_top20"] = df.queue_rank.notna()
    df["is_tp"] = df.grade == "TruePositive"
    df["graded"] = df.grade.notna()
    df["contained"] = df.action.notna()
    df["duration_min"] = (df.last_ts - df.first_ts).dt.total_seconds() / 60
    df["hour"] = df.first_ts.dt.hour
    df["cat_code"] = df.top_category.astype("category").cat.codes
    det_freq = df.top_detector.value_counts()
    df["det_freq"] = np.log1p(df.top_detector.map(det_freq).fillna(0))
    df["org_log_size"] = np.log1p(df.org.map(df.org.value_counts()))
    df["has_mitre"] = df.has_mitre.astype(float)
    return df


def fit_tp_model(df: pd.DataFrame):
    """P(analyst verdict = TruePositive) from incident metadata, trained on the train split only."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score
    tr = df[(df.split == "train") & df.graded]
    te = df[(df.split == "test") & df.graded]
    m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.1, max_leaf_nodes=63,
                                       categorical_features=[FEATS.index("cat_code")], random_state=0)
    m.fit(tr[FEATS], tr.is_tp)
    df["p_tp"] = m.predict_proba(df[FEATS])[:, 1]
    return {"train_incidents": int(len(tr)), "test_incidents": int(len(te)),
            "test_auc": float(roc_auc_score(te.is_tp, df.loc[te.index, "p_tp"]))}


# ------------------------------------------------------------------ self-history tests
def _hyper_lower_midp(k1, K, n1, N):
    """Lower mid-p of k1 ~ Hypergeometric(N total, K successes, n1 drawn)."""
    k1, K, n1, N = (np.asarray(x, int) for x in (k1, K, n1, N))
    p = stats.hypergeom.cdf(k1 - 1, N, K, n1) + 0.5 * stats.hypergeom.pmf(k1, N, K, n1)
    return np.clip(p, 1e-12, 1.0)


def org_pvalues(inc: pd.DataFrame, cat_long: pd.DataFrame, cur: np.ndarray, min_graded: int = 30,
                min_cat: int = 10) -> pd.DataFrame:
    """Per org: TP-share test and category-incidence tests of the current half against
    the org's own baseline half, combined with ACAT."""
    d = inc.assign(cur=cur)
    g = d[d.graded].groupby("org").agg(N=("is_tp", "size"), K=("is_tp", "sum"))
    gc = d[d.graded & d.cur].groupby("org").agg(n1=("is_tp", "size"), k1=("is_tp", "sum"))
    g = g.join(gc, how="inner")
    g = g[(g.n1 >= min_graded) & (g.N - g.n1 >= min_graded)]
    g["p_tp"] = _hyper_lower_midp(g.k1, g.K, g.n1, g.N)
    tot = d.groupby("org").agg(M=("cur", "size"), m1=("cur", "sum"))
    cl = cat_long.assign(cur=cur[cat_long.row.to_numpy()])
    cc = cl.groupby(["org", "cat"]).agg(A=("cur", "size"), a1=("cur", "sum")).reset_index()
    cc = cc[cc.A >= min_cat].merge(tot, left_on="org", right_index=True)
    cc["p"] = _hyper_lower_midp(cc.a1, cc.A, cc.m1, cc.M)
    p_cat = cc.groupby("org").p.apply(lambda x: acat(x.to_numpy()))
    g["p_cat"] = p_cat.reindex(g.index)
    g["p"] = [acat([a, b]) if np.isfinite(b) else a for a, b in zip(g.p_tp, g.p_cat)]
    g["q"] = qvalues(g.p.to_numpy())
    return g


def explode_categories(inc: pd.DataFrame) -> pd.DataFrame:
    s = inc.cats.fillna("").str.split("|")
    long = pd.DataFrame({"row": np.repeat(np.arange(len(inc)), s.str.len()), "cat": np.concatenate(s.to_numpy())})
    long = long[long.cat != ""]
    long["org"] = inc.org.to_numpy()[long.row.to_numpy()]
    return long


# ------------------------------------------------------------------ R1 / R2
def r1_r2(df: pd.DataFrame, repeats: int = 20, seed: int = 0, log=print) -> tuple[dict, dict]:
    rng = np.random.default_rng(seed)
    inc = df.reset_index(drop=True)
    cat_long = explode_categories(inc)
    null_rows = []
    all_p = []
    for r in range(repeats):
        cur = rng.random(len(inc)) < 0.5
        g = org_pvalues(inc, cat_long, cur)
        all_p.append(g.p.to_numpy())
        null_rows.append({"repeat": r, "orgs": len(g), **{f"flags_q{q}": int((g.q <= q).sum()) for q in (0.05, 0.1, 0.2)}})
    nr = pd.DataFrame(null_rows)
    ps = np.concatenate(all_p)
    r1 = {
        "description": "Each org's incidents (train + test pooled) are randomly re-split into baseline and current "
                       "halves. Nothing changed, so every flag is false. SAT-SA's self-history tests (true-positive "
                       "share and per-category incidence of the current half vs the org's own baseline, combined "
                       "with ACAT, BH across orgs).",
        "repeats": repeats, "orgs_tested": int(nr.orgs.mean()),
        "realized_fdr": {str(q): {"value": float((nr[f"flags_q{q}"] > 0).mean()),
                                  "ci95": _cp(int((nr[f"flags_q{q}"] > 0).sum()), repeats),
                                  "mean_false_flags": float(nr[f"flags_q{q}"].mean())} for q in (0.05, 0.1, 0.2)},
        "pvalue_rate": {str(t): float((ps <= t).mean()) for t in (0.001, 0.01, 0.05, 0.1)},
        "ks_uniform": float(stats.kstest(ps, "uniform").statistic),
    }
    log("  R1 done", r1["realized_fdr"]["0.1"])

    # R2: plant degradations in the current half of 5% of eligible orgs
    rows = []
    for kind, levels in (("category_suppressed", [0.5, 0.75, 1.0]), ("tp_regraded_fp", [0.2, 0.35, 0.5])):
        for lv in levels:
            for r in range(max(5, repeats // 2)):
                cur = rng.random(len(inc)) < 0.5
                g0 = org_pvalues(inc, cat_long, cur)
                elig = g0.index.to_numpy()
                chosen = rng.choice(elig, max(1, int(0.05 * len(elig))), replace=False)
                work = inc.copy()
                keep = np.ones(len(work), bool)
                if kind == "category_suppressed":
                    cl = cat_long.assign(cur=cur[cat_long.row.to_numpy()])
                    cnt = cl.groupby(["org", "cat"]).size()
                    for o in chosen:
                        cats = cnt.loc[o][cnt.loc[o] >= 20].index.tolist() if o in cnt.index.get_level_values(0) else []
                        if not cats:
                            continue
                        c = cats[rng.integers(len(cats))]
                        rows_c = cl[(cl.org == o) & (cl.cat == c) & cl.cur].row.to_numpy()
                        drop = rows_c[rng.random(len(rows_c)) < lv]
                        keep[drop] = False
                else:
                    for o in chosen:
                        idx = np.where((work.org.to_numpy() == o) & cur & work.is_tp.to_numpy())[0]
                        flip = idx[rng.random(len(idx)) < lv]
                        work.loc[flip, "is_tp"] = False
                w2 = work[keep].reset_index(drop=True)
                cur2 = cur[keep]
                cl2 = explode_categories(w2)
                g = org_pvalues(w2, cl2, cur2)
                inj = g.index.isin(chosen)
                flag = (g.q <= 0.1).to_numpy()
                rows.append({"kind": kind, "level": lv, "repeat": r, "injected": int(inj.sum()),
                             "detected": int((flag & inj).sum()), "false_flags": int((flag & ~inj).sum()),
                             "flags": int(flag.sum())})
            log(f"  R2 {kind} {lv} done")
    rr = pd.DataFrame(rows)
    agg = rr.groupby(["kind", "level"]).agg(injected=("injected", "sum"), detected=("detected", "sum"),
                                            false_flags=("false_flags", "sum"), flags=("flags", "sum"),
                                            repeats=("repeat", "size")).reset_index()
    agg["recall"] = agg.detected / agg.injected
    agg["precision"] = agg["detected"] / agg["flags"].clip(lower=1)
    r2 = {
        "description": "Degradations planted into the current half of a random 5% of eligible real orgs. "
                       "category_suppressed: a share of the incidents of one alert category the org really uses "
                       "(>= 20 incidents) disappears, as if a detection rule were silently excluded (negative space). "
                       "tp_regraded_fp: a share of true positives is re-graded as false positive (superficial triage). "
                       "Detection at q <= 0.10; precision counts every flag on an untouched org as false.",
        "rows": agg.to_dict("records"),
    }
    return r1, r2


# ------------------------------------------------------------------ R3
def r3_peers(df: pd.DataFrame, min_n: int = 50) -> dict:
    """Real orgs vs peers, raw and case-mix adjusted, on the two independent halves."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from satsa.stats.core import rate_test_expected
    g_all = df[df.graded].copy()
    # cross-fitted expected TP probability: each half scored by a model trained on the other half
    g_all["p_cross"] = np.nan
    for sp, other in (("train", "test"), ("test", "train")):
        tr = g_all[g_all.split == other]
        m = HistGradientBoostingClassifier(max_iter=200, categorical_features=[FEATS.index("cat_code")], random_state=0)
        m.fit(tr[FEATS], tr.is_tp)
        idx = g_all.index[g_all.split == sp]
        g_all.loc[idx, "p_cross"] = m.predict_proba(g_all.loc[idx, FEATS])[:, 1]
    out = {}
    for adjusted in (False, True):
        halves = {}
        for sp in ("train", "test"):
            d = g_all[g_all.split == sp]
            g = d.groupby("org").agg(k=("is_tp", "sum"), n=("is_tp", "size"), e=("p_cross", "sum"))
            halves[sp] = g[g.n >= min_n]
        common = halves["train"].index.intersection(halves["test"].index)
        res = {}
        for sp, g in halves.items():
            g = g.loc[common]
            k, n, e = g.k.to_numpy(), g.n.to_numpy(), g.e.to_numpy()
            if adjusted:
                p = np.array([rate_test_expected(int(k[i]), int(n[i]), float(e[i]), np.delete(k, i), np.delete(n, i),
                                                 np.delete(e, i), tail="lower") for i in range(len(g))])
            else:
                p = np.array([rate_test(int(k[i]), int(n[i]), np.delete(k, i), np.delete(n, i), tail="lower")
                              for i in range(len(g))])
            res[sp] = pd.Series(p, index=common)
        qa, qb = pd.Series(qvalues(res["train"].to_numpy()), index=common), pd.Series(qvalues(res["test"].to_numpy()), index=common)
        a_, b_ = qa <= 0.1, qb <= 0.1
        both = int((a_ & b_).sum())
        top_a, top_b = set(res["train"].nsmallest(20).index), set(res["test"].nsmallest(20).index)
        out["case_mix_adjusted" if adjusted else "raw_peer_rate"] = {
            "orgs": int(len(common)), "flagged_train_half_q10": int(a_.sum()), "flagged_test_half_q10": int(b_.sum()),
            "flagged_both_q10": both,
            "top20_overlap": len(top_a & top_b), "top20_overlap_by_chance": round(20 * 20 / len(common), 2),
            "spearman_between_halves": float(stats.spearmanr(res["train"], res["test"]).statistic)}
    return {"description": "Metric: share of an org's graded incidents that analysts called true positive, tested on "
                           "the low side (possible over-dismissal). Raw: vs peers' rates. Case-mix adjusted: vs what "
                           "the org's own incident mix predicts (a model of real analyst verdicts, cross-fitted so each "
                           "half is scored by a model trained on the other half), like a hospital standardised mortality "
                           "ratio. Each org is tested separately on the two independent halves of its incidents; flags "
                           "that replicate reflect persistent behaviour, not noise. Flags mean 'unusual, examine', "
                           "not proven weakness.", "min_graded_incidents": min_n, **out}


def _kappa(a, b):
    po = np.mean(a == b)
    pe = a.mean() * b.mean() + (1 - a.mean()) * (1 - b.mean())
    return (po - pe) / (1 - pe) if pe < 1 else 1.0


def _cp(k, n, alpha=0.05):
    lo = stats.beta.ppf(alpha / 2, k, n - k + 1) if k > 0 else 0.0
    hi = stats.beta.ppf(1 - alpha / 2, k + 1, n - k) if k < n else 1.0
    return [float(lo), float(hi)]


# ------------------------------------------------------------------ R4
def r4_ppi(df: pd.DataFrame, reps: int = 100, ns=(20, 40), seed: int = 2) -> dict:
    rng = np.random.default_rng(seed)
    te = df[(df.split == "test") & df.graded]
    rows = []
    z = stats.norm.ppf(0.95)
    for org, g in te.groupby("org"):
        if len(g) < 150:
            continue
        y, yh = g.is_tp.to_numpy(float), g.p_tp.to_numpy(float)
        theta = y.mean()
        for n in ns:
            for _ in range(reps):
                m = np.zeros(len(g), bool)
                m[rng.choice(len(g), n, replace=False)] = True
                r = ppi_mean_ci(y[m], yh[m], yh[~m], alpha=0.1)
                k = y[m].sum()
                c = (k + z * z / 2) / (n + z * z)
                h = z * np.sqrt(k * (n - k) / n + z * z / 4) / (n + z * z)
                rows.append((org, n, theta, r["lo"] <= theta <= r["hi"], r["hi"] - r["lo"],
                             max(0, c - h) <= theta <= min(1, c + h), min(1, c + h) - max(0, c - h)))
    d = pd.DataFrame(rows, columns=["org", "n", "theta", "ppi_cover", "ppi_width", "cls_cover", "cls_width"])
    agg = d.groupby("n").agg(ppi_coverage=("ppi_cover", "mean"), classical_coverage=("cls_cover", "mean"),
                             ppi_width=("ppi_width", "mean"), classical_width=("cls_width", "mean")).reset_index()
    agg["label_saving"] = 1 - (agg.ppi_width / agg.classical_width) ** 2
    return {"description": "Target: each real org's true-positive share among its test-split incidents (real analyst "
                           "verdicts). Random samples of n labels + the model's predictions on the org's other "
                           "incidents; the model was trained on the train split only. 90% intervals.",
            "orgs": int(d.org.nunique()), "reps_per_org": reps, "by_n": agg.to_dict("records")}


# ------------------------------------------------------------------ R5 (V10)
def r5_expert(df: pd.DataFrame, seed: int = 3) -> dict:
    from sklearn.ensemble import HistGradientBoostingClassifier
    te = df[(df.split == "test") & df.org.isin(df.loc[df.expert_top20, "org"].unique())].copy()
    orgs = te.org.unique()
    rng = np.random.default_rng(seed)
    # cross-fitted model of the experts' own labels (half the orgs train, the other half is scored)
    fold = dict(zip(orgs, rng.integers(0, 2, len(orgs))))
    te["fold"] = te.org.map(fold)
    te["p_expert"] = np.nan
    for f in (0, 1):
        tr, sc = te[te.fold != f], te[te.fold == f]
        m = HistGradientBoostingClassifier(max_iter=200, categorical_features=[FEATS.index("cat_code")], random_state=0)
        m.fit(tr[FEATS + ["p_tp"]], tr.expert_top20)
        te.loc[sc.index, "p_expert"] = m.predict_proba(sc[FEATS + ["p_tp"]])[:, 1]
    te["jit"] = rng.random(len(te))
    orders = {
        "random": ["jit"],
        "arrival_latest_first": ["first_ts"],
        "most_alerts_first": ["n_alerts"],
        "satsa_tp_model": ["p_tp"],
        "satsa_learned_from_examiners": ["p_expert"],
    }
    rows = []
    for name, cols in orders.items():
        s = te.sort_values(["org"] + cols + ["jit"], ascending=[True] + [False] * len(cols) + [True])
        s["pos"] = s.groupby("org").cumcount()
        for B in (5, 10, 20):
            top = s[s.pos < B]
            prec = top.groupby("org").expert_top20.mean()
            rows.append({"strategy": name, "budget": B, "precision": float(prec.mean())})
    # the Review Lab sampler: half targeted (examiner-trained model), half uniform random
    for B in (10, 20):
        s1 = te.sort_values(["org", "p_expert"], ascending=[True, False])
        s1["pos"] = s1.groupby("org").cumcount()
        tgt = s1[s1.pos < B // 2]
        rest = te.drop(tgt.index)
        rnd = rest.sort_values(["org", "jit"]).groupby("org").head(B - B // 2)
        both = pd.concat([tgt, rnd])
        rows.append({"strategy": "satsa_review_lab_half_targeted", "budget": B,
                     "precision": float(both.groupby("org").expert_top20.mean().mean())})
    sizes = te.groupby("org").size()
    return {"description": "Expert priority labels from a full-queue sweep of 499 real org queues (top-20 per queue; "
                           "Freitas et al. 2026, released with GUIDE). Precision@B = share of the first B incidents "
                           "reviewed that experts ranked in the org's top 20. 'satsa_learned_from_examiners' is trained "
                           "on the experts' labels of one half of the orgs and scored on the other half, as SAT-SA's "
                           "predictor learns from earlier examiner verdicts. For reference, the paper's production "
                           "ranker (which uses far richer features) reaches P@10 = 92.8%.",
            "orgs": int(len(orgs)), "incidents": int(len(te)), "median_queue_size": float(sizes.median()),
            "rows": rows}


def main():
    warnings.filterwarnings("ignore")
    t0 = time.time()
    log = lambda *x: print(*x, flush=True)  # noqa: E731
    df = load()
    log(f"loaded {len(df):,} incidents from {df.org.nunique():,} orgs ({time.time() - t0:.0f}s)")
    model = fit_tp_model(df)
    log("TP model", model, f"{time.time() - t0:.0f}s")
    out = {"generated": pd.Timestamp.now().isoformat(timespec="seconds"), "real_data": True,
           "dataset": {"name": "Microsoft GUIDE", "licence": "CDLA-Permissive-2.0", "citation": "Freitas et al., arXiv 2407.09017",
                       "incidents": int(len(df)), "orgs": int(df.org.nunique()),
                       "graded_incidents": int(df.graded.sum()), "period": [str(df.first_ts.min().date()),
                                                                            str(df.first_ts.max().date())]},
           "tp_model": model}
    out["R5_expert_priority"] = r5_expert(df)
    log("R5 done", f"{time.time() - t0:.0f}s")
    out["R4_ppi_real"] = r4_ppi(df)
    log("R4 done", f"{time.time() - t0:.0f}s")
    out["R3_peer_flags"] = r3_peers(df)
    log("R3 done", f"{time.time() - t0:.0f}s")
    out["R1_null_calibration"], out["R2_injected_recall"] = r1_r2(df, log=log)
    log("R1/R2 done", f"{time.time() - t0:.0f}s")
    out["seconds"] = round(time.time() - t0, 1)
    REPORTS.mkdir(exist_ok=True)
    from satsa.eval.run_all import _clean
    (REPORTS / "guide.json").write_text(json.dumps(_clean(out), indent=1))
    log(f"wrote reports/guide.json in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
