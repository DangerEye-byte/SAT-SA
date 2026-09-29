"""Red-Team Lab (D4): can a SOC game its regulator?

A stylised, fast simulation (numbers are SYNTHETIC). One entity, 12 monthly
submissions of ~300 human-handled cases (30% medium, 70% high/critical). A healthy SOC
handles 3% of cases superficially, a weak one 15%. The auditee picks a strategy to hide
the weakness; the auditor picks a policy. Every policy gets the same budget: 60 human
case reviews per year. Detection rules are set so an honest SOC is almost never
flagged (the false-alarm rate is reported for every policy).

Strategies
  honest           healthy all year (measures false alarms)
  delay            healthy for six months, weak afterwards
  drift            slides from healthy to weak over the year
  cherry_pick      weak only on medium-severity cases, which fixed audits never sample
  off_audit_drift  weak except in the months it expects to be audited (quarter ends)
  attrition        weak, but drops 80% of its superficial cases from the submission
  metadata_masking weak, but pads the paper trail so analytics see nothing unusual

Policies
  annual_audit     60 reviews of high/critical cases in month 12
  quarterly_audit  15 reviews of high/critical cases at each quarter end
  unannounced      15 reviews in one random month per quarter, all severities
  satsa_analytics  SAT-SA every month: analytics on all submitted cases (anytime-valid
                   e-process), completeness check, 5 targeted reviews/month (confirm only)
  satsa_with_floor SAT-SA analytics + completeness, 2 targeted + 3 uniform-random
                   reviews per month (the randomised floor)

Usage:  python -m satsa.eval.gaming
"""

from __future__ import annotations

import numpy as np
from scipy import stats

MONTHS, N_CASES, MED_SHARE = 12, 300, 0.30
HEALTHY, WEAK = 0.03, 0.15
ALPHA = 0.01
STRATEGIES = ["honest", "delay", "drift", "cherry_pick", "off_audit_drift", "attrition", "metadata_masking"]
POLICIES = ["annual_audit", "quarterly_audit", "unannounced", "satsa_analytics", "satsa_with_floor"]
QUARTER_ENDS = {2, 5, 8, 11}
DROP = 0.8          # attrition: share of superficial cases left out of the submission
MISSING_BASE = 0.005  # healthy share of alerts with no case record (clerical)
# model score of a case (SAT-SA's superficiality predictor): superficial ~ Beta(6, 2), otherwise Beta(1.2, 10)
SUP_A, SUP_B, OK_A, OK_B = 6.0, 2.0, 1.2, 10.0


def _rates(strategy: str) -> tuple[np.ndarray, np.ndarray, bool, bool]:
    """Per-month superficial rate for medium and for high/critical cases, plus flags."""
    t = np.arange(MONTHS)
    med = np.full(MONTHS, HEALTHY)
    hc = np.full(MONTHS, HEALTHY)
    if strategy == "delay":
        med[6:] = hc[6:] = WEAK
    elif strategy == "drift":
        med = hc = HEALTHY + (WEAK - HEALTHY) * t / (MONTHS - 1)
    elif strategy == "cherry_pick":
        med = np.full(MONTHS, min(1.0, WEAK / MED_SHARE * 0.6))
    elif strategy == "off_audit_drift":
        med = np.where(np.isin(t, list(QUARTER_ENDS)), HEALTHY, WEAK)
        hc = med.copy()
    elif strategy in ("attrition", "metadata_masking"):
        med[:] = hc[:] = WEAK
    return med, hc, strategy == "attrition", strategy == "metadata_masking"


def onset(strategy: str) -> int:
    return 6 if strategy == "delay" else 0


def _binom_detect(k: int, n: int, p0: float = HEALTHY) -> bool:
    return n > 0 and stats.binom.sf(k - 1, n, p0) < ALPHA


def run_once(strategy: str, policy: str, rng) -> dict:
    """Simulate one year. Returns the detection month (or None) and a monthly trace."""
    med, hc, attrition, masking = _rates(strategy)
    n_med, n_hc = int(N_CASES * MED_SHARE), N_CASES - int(N_CASES * MED_SHARE)
    mu_h = HEALTHY * SUP_A / (SUP_A + SUP_B) + (1 - HEALTHY) * OK_A / (OK_A + OK_B)
    # variance of a healthy case score (mixture)
    m2 = (HEALTHY * stats.beta(SUP_A, SUP_B).moment(2) + (1 - HEALTHY) * stats.beta(OK_A, OK_B).moment(2))
    sd_h = np.sqrt(m2 - mu_h ** 2)
    review_k = review_n = 0
    cum_e = 1.0
    unannounced_months = {3 * qq + int(rng.integers(3)) for qq in range(4)}
    trace = []
    detected, first_why = None, None
    for m in range(MONTHS):
        sup_med = rng.random(n_med) < med[m]
        sup_hc = rng.random(n_hc) < hc[m]
        sup = np.concatenate([sup_med, sup_hc])
        is_hc = np.concatenate([np.zeros(n_med, bool), np.ones(n_hc, bool)])
        keep = np.ones(N_CASES, bool)
        if attrition:
            keep = ~(sup & (rng.random(N_CASES) < DROP))
        missing = int((~keep).sum()) + int(rng.binomial(N_CASES, MISSING_BASE))
        s_sub, hc_sub = sup[keep], is_hc[keep]
        score = np.where(s_sub & (not masking), rng.beta(SUP_A, SUP_B, len(s_sub)), rng.beta(OK_A, OK_B, len(s_sub)))
        why = None

        def review(mask_pool, n, targeted=False):
            idx = np.where(mask_pool)[0]
            if not len(idx):
                return 0, 0
            if targeted:
                pick = idx[np.argsort(-score[idx])[:n]]
            else:
                pick = rng.choice(idx, min(n, len(idx)), replace=False)
            return int(s_sub[pick].sum()), len(pick)

        if policy == "annual_audit" and m == 11:
            k, n = review(hc_sub, 60)
            review_k += k
            review_n += n
            if _binom_detect(review_k, review_n):
                why = "manual review"
        elif policy == "quarterly_audit" and m in QUARTER_ENDS:
            k, n = review(hc_sub, 15)
            review_k += k
            review_n += n
            if _binom_detect(review_k, review_n):
                why = "manual review"
        elif policy == "unannounced" and m in unannounced_months:
            k, n = review(np.ones(len(s_sub), bool), 15)
            review_k += k
            review_n += n
            if _binom_detect(review_k, review_n):
                why = "manual review"
        elif policy in ("satsa_analytics", "satsa_with_floor"):
            z = (score.mean() - mu_h) / (sd_h / np.sqrt(len(score)))
            p = max(float(stats.norm.sf(z)), 1e-15)
            cum_e *= 0.5 * p ** -0.5
            if cum_e >= 1 / ALPHA:
                why = "analytics (anytime-valid e-process)"
            elif stats.binom.sf(missing - 1, N_CASES, MISSING_BASE) < ALPHA / MONTHS:
                why = "completeness: case records missing"
            if policy == "satsa_with_floor":
                k, n = review(np.ones(len(s_sub), bool), 3)
                review_k += k
                review_n += n
                if why is None and _binom_detect(review_k, review_n):
                    why = "random-floor review"
        trace.append({"month": m + 1, "true_rate": float(sup.mean()), "submitted_rate": float(s_sub.mean()),
                      "missing": missing, "mean_score": float(score.mean()), "cum_e": float(cum_e),
                      "reviews": review_n, "found": review_k, "detected": why})
        if why and detected is None:
            detected, first_why = m, why
    return {"detected_month": detected, "why": first_why if detected is not None else None, "trace": trace}


def matrix(n_sims: int = 400, seed: int = 0) -> dict:
    rng = np.random.default_rng(seed)
    cells = []
    for s in STRATEGIES:
        for pol in POLICIES:
            det, lat, why = 0, [], {}
            for _ in range(n_sims):
                r = run_once(s, pol, rng)
                if r["detected_month"] is not None:
                    det += 1
                    lat.append(r["detected_month"] - onset(s) + 1)
                    why[r["why"]] = why.get(r["why"], 0) + 1
            cells.append({"strategy": s, "policy": pol, "detection_rate": det / n_sims,
                          "median_months_to_detect": float(np.median(lat)) if lat else None,
                          "detected_by": why})
    return {"description": __doc__.split("Usage:")[0].strip(), "sims_per_cell": n_sims, "review_budget_per_year": 60,
            "alpha": ALPHA, "strategies": STRATEGIES, "policies": POLICIES, "cells": cells}


def timeline(strategy: str, policy: str, seed: int = 1) -> dict:
    r = run_once(strategy, policy, np.random.default_rng(seed))
    return {"strategy": strategy, "policy": policy, "onset_month": onset(strategy) + 1,
            "detected_month": None if r["detected_month"] is None else r["detected_month"] + 1, "why": r["why"],
            "trace": r["trace"], "synthetic": True}


if __name__ == "__main__":
    import pandas as pd
    m = matrix(200)
    df = pd.DataFrame(m["cells"])
    print(df.pivot(index="strategy", columns="policy", values="detection_rate").round(2).to_string())
    print(df.pivot(index="strategy", columns="policy", values="median_months_to_detect").to_string())
