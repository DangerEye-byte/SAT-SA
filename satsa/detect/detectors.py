"""Detector bank. Each detector returns one result row per entity:

  {entity_id, detector_id, p_value, deterministic, severity, n, k, rate, peer_rate,
   effect, reason, evidence (list of ids), evidence_type, extra (dict)}

Statistical detectors carry a calibrated p-value (null = "behaves like its peers").
Deterministic detectors carry a documented fact (no statistics needed)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats

from satsa import taxonomy as tx
from satsa.stats.core import (PEER_INFLATE, acat, nb_lower_pvalue, nb_size_robust, random_effects_null_p, rate_test,
                              rate_test_expected,
                              robust_overdispersion)

MAX_EVIDENCE = 40


@dataclass
class Ctx:
    entities: pd.DataFrame
    assets: pd.DataFrame
    alerts: pd.DataFrame
    cf: pd.DataFrame          # case features
    escalations: pd.DataFrame
    submissions: pd.DataFrame
    redteam: pd.DataFrame
    period_end: pd.Timestamp


DETECTORS = {
    # id: (name, family, capability, short method)
    "EG1": ("Unusually fast high-severity closures", "Execution gap", "Investigation",
            "Leave-one-entity-out conformal p-value per case vs peer cases of the same severity and alert type; entity count tested with a beta-binomial peer model"),
    "EG2": ("Critical cases closed without escalation", "Execution gap", "Escalation",
            "Beta-binomial test of the unescalated share of closed critical cases vs peers"),
    "EG3": ("Template / copy-paste investigation notes", "Execution gap", "Operational Discipline",
            "Near-duplicate clustering (char 3-5-gram cosine >= 0.9, cluster >= 5); beta-binomial vs peers"),
    "EG4": ("Acknowledged but not investigated", "Execution gap", "Investigation",
            "Closed high/critical cases with no 'investigate' workflow event; beta-binomial vs peers"),
    "EG5": ("Workflow non-conformance", "Execution gap", "Governance & Oversight",
            "Declarative workflow constraints (triage before close, escalation recorded, containment for true positives, remediation recorded); beta-binomial vs peers"),
    "EG6": ("SLA-threshold bunching (metric gaming)", "Execution gap", "Operational Discipline",
            "Bunching estimator: excess mass of critical closures just below the SLA vs a polynomial counterfactual (Chetty et al. 2011; Kleven 2016)"),
    "EG7": ("Repeat alerts without remediation", "Execution gap", "Incident Response",
            "Share of true-positive cases whose asset+alert type recurs within 30 days; beta-binomial vs peers"),
    "EG11": ("24x7 claim vs night-time reality", "Execution gap", "Security Operations",
             "Share of night-opened (00-06h) high/critical cases acknowledged after > 60 min, for entities that declare 24x7 monitoring"),
    "EG12": ("Regulatory reporting beyond 6 hours", "Execution gap", "Governance & Oversight",
             "Share of high/critical true positives with no CERT-In report or a report > 6 h after the first alert"),
    "EG13": ("Threat intelligence not applied", "Execution gap", "Threat Detection",
             "Share of human-handled cases without IOC / threat-intel enrichment; beta-binomial vs peers"),
    "NS1": ("Silent critical assets", "Negative space", "Threat Detection",
            "Expected alerts per asset from peer rates of the same asset class (restricted to categories the entity's log sources can see); negative-binomial probability of the observed silence over the last quarter"),
    "NS2": ("Quiet ATT&CK tactics (visible but absent)", "Negative space", "Threat Detection",
            "Expected alert count per supportable tactic from peer tactic mix; Poisson probability of the observed absence"),
    "NS3": ("Blind ATT&CK tactics (cannot be seen)", "Negative space", "Cyber Resilience",
            "Deterministic: declared log sources cannot support any detection for tactics that most peers can see"),
    "NS5": ("Detector decay (exclusion ratchet)", "Negative space", "Threat Detection",
            "Per detection rule: late-vs-early volume collapse compared with the same rule at peers (conditional binomial)"),
    "NS7": ("Missing case records (submission completeness)", "Negative space", "Governance & Oversight",
            "Share of high/critical alerts with no case record; beta-binomial vs peers; late submissions reported"),
    "NS8": ("Log-retention gap", "Negative space", "Cyber Resilience",
            "Deterministic: submitted history shorter than 180 days or containing gaps > 7 days"),
    "NS9": ("Clock integrity violations", "Negative space", "Operational Discipline",
            "Deterministic: acknowledgements timestamped before the case was opened"),
    "TW1": ("Divergence from its synthetic twin", "Execution gap", "Governance & Oversight",
            "Synthetic control (Abadie et al. 2010): a weighted blend of peers that tracks the entity's monthly share of "
            "likely-superficial cases in the first half-year; the post-period gap is ranked against placebo twins of every peer"),
    "RT1": ("Red-team techniques missed", "Negative space", "Threat Detection",
            "Deterministic: techniques executed by the entity's own red-team exercise with no matching alert (known-positive miss)"),
}

DET_SCORE = {"high": 70.0, "medium": 45.0}


def _row(eid, did, p=np.nan, n=0, k=0, rate=np.nan, peer_rate=np.nan, effect="", reason="", evidence=None,
         evidence_type="case", deterministic=False, severity=None, extra=None):
    return dict(entity_id=eid, detector_id=did, p_value=p, n=int(n), k=int(k), rate=rate, peer_rate=peer_rate,
                effect=effect, reason=reason, evidence=list(evidence or [])[:MAX_EVIDENCE],
                evidence_type=evidence_type, deterministic=deterministic, severity=severity, extra=extra or {})


def _strata_expected(tab: pd.DataFrame, target: str, peers: list[str]) -> pd.Series:
    """Expected flagged count per entity given its case mix: stratum rates pooled over
    the target's peers, after dropping the peers with the most extreme observed/expected
    ratio (10% each side) so a few weak peers cannot shift the baseline."""
    pt = tab[tab.entity_id.isin(peers)]

    def rates(ents):
        g = pt[pt.entity_id.isin(ents)].groupby("stratum")[["k", "n"]].sum()
        return (g.k + 0.5) / (g.n + 1)

    r = rates(peers)
    e_all = tab.assign(e=tab.n * tab.stratum.map(r).fillna(0)).groupby("entity_id")[["k", "n", "e"]].sum()
    oe = (e_all.k / e_all.e.clip(lower=1e-9)).loc[[x for x in peers if x in e_all.index]]
    if len(oe) >= 10:
        lo, hi = oe.quantile([0.1, 0.9])
        r = rates(oe[(oe >= lo) & (oe <= hi)].index.tolist())
    e = tab.assign(e=tab.n * tab.stratum.map(r).fillna(0)).groupby("entity_id").e.sum()
    return e


def _rate_detector(did, ctx: Ctx, pop: pd.DataFrame, flag: pd.Series, tail, reason_fmt, order_col=None, ascending=True,
                   applicable=None, strata: list[str] | None = None):
    """Generic beta-binomial rate detector over a case population. With `strata`, the
    entity is compared with what its own case mix predicts (indirect standardisation),
    so an entity is not flagged merely for handling a different mix of cases."""
    fl = flag.astype(int).to_numpy()
    g = pd.DataFrame({"entity_id": pop.entity_id.to_numpy(), "flag": fl}).groupby("entity_id").flag.agg(["sum", "count"])
    tab = None
    if strata:
        key = pop[strata].astype(str).agg("|".join, axis=1).to_numpy()
        tab = (pd.DataFrame({"entity_id": pop.entity_id.to_numpy(), "stratum": key, "flag": fl})
               .groupby(["entity_id", "stratum"]).flag.agg(k="sum", n="count").reset_index())
    out = []
    for eid in ctx.entities.entity_id:
        if applicable is not None and not applicable(eid):
            out.append(_row(eid, did, reason="Not applicable"))
            continue
        if eid not in g.index or g.loc[eid, "count"] < 10:
            out.append(_row(eid, did, reason="Insufficient evidence (fewer than 10 relevant cases)"))
            continue
        k, n = int(g.loc[eid, "sum"]), int(g.loc[eid, "count"])
        peers = g.drop(index=eid)
        if applicable is not None:
            peers = peers[[applicable(x) for x in peers.index]]
        extra = {}
        if tab is not None:
            e = _strata_expected(tab, eid, peers.index.tolist())
            pe = e.reindex(peers.index).fillna(0).to_numpy()
            p = rate_test_expected(k, n, float(e.get(eid, 0.0)), peers["sum"].to_numpy(), peers["count"].to_numpy(), pe,
                                   tail=tail)
            extra["expected_rate_for_case_mix"] = float(e.get(eid, 0.0) / n)
        else:
            p = rate_test(k, n, peers["sum"].to_numpy(), peers["count"].to_numpy(), tail=tail)
        pr = float(np.median(peers["sum"] / peers["count"]))
        rate = k / n
        ev_df = pop[(pop.entity_id == eid) & flag.to_numpy()]
        if order_col:
            ev_df = ev_df.sort_values(order_col, ascending=ascending)
        out.append(_row(eid, did, p=p, n=n, k=k, rate=rate, peer_rate=pr,
                        effect=f"{rate:.0%} vs peer median {pr:.0%}",
                        reason=reason_fmt.format(k=k, n=n, rate=rate, pr=pr),
                        evidence=ev_df.case_id.head(MAX_EVIDENCE).tolist(), extra=extra))
    return out


def eg1(ctx):
    cf = ctx.cf
    pop = cf[cf.closed & ~cf.auto_closed & cf.severity.isin(["high", "critical"]) & cf.p_fast.notna()]
    return _rate_detector("EG1", ctx, pop, pop.p_fast <= 0.05, "upper",
                          "{k} of {n} high/critical cases ({rate:.0%}) were closed faster than 95% of comparable peer cases "
                          "(same severity and alert type); the peer median is {pr:.0%}. Automated SOAR closures are excluded.",
                          order_col="p_fast")


def eg2(ctx):
    cf = ctx.cf
    pop = cf[cf.closed & ~cf.auto_closed & (cf.severity == "critical")]
    return _rate_detector("EG2", ctx, pop, ~pop.escalated, "upper",
                          "{k} of {n} closed critical cases ({rate:.0%}) show no escalation; peer median {pr:.0%}.",
                          order_col="ttc_min", strata=["is_tp"])


def eg3(ctx):
    cf = ctx.cf
    pop = cf[~cf.auto_closed & cf.notes.notna()]
    out = _rate_detector("EG3", ctx, pop, pop.templated, "upper",
                         "{k} of {n} investigation notes ({rate:.0%}) are near-duplicates of a small set of templates; "
                         "peer median {pr:.0%}.", order_col="template_cluster", ascending=False, strata=["severity", "is_tp"])
    for r in out:
        if r["n"]:
            sub = pop[(pop.entity_id == r["entity_id"]) & pop.templated]
            top = sub.groupby("template_key").agg(count=("case_id", "size"), example=("notes", "first"),
                                                  cases=("case_id", lambda s: list(s[:5])))
            top = top.sort_values("count", ascending=False).head(5)
            r["extra"]["clusters"] = [{"count": int(c), "example": e, "cases": cs}
                                      for c, e, cs in zip(top["count"], top["example"], top["cases"])]
    return out


def eg4(ctx):
    cf = ctx.cf
    pop = cf[cf.closed & ~cf.auto_closed & cf.severity.isin(["high", "critical"])]
    return _rate_detector("EG4", ctx, pop, pop.n_investigate == 0, "upper",
                          "{k} of {n} high/critical cases ({rate:.0%}) were acknowledged and closed with no investigation "
                          "step recorded; peer median {pr:.0%}.", order_col="ttc_min", strata=["severity", "is_tp"])


def conformance_violations(cf: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({
        "no_triage": cf.n_triage == 0,
        "escalation_not_recorded": cf.escalated & (cf.n_escalate_ev == 0),
        "tp_without_containment": (cf.disposition == "TP") & (cf.n_contain == 0),
        "remediation_not_recorded": cf.remediated & (cf.n_remediate_ev == 0),
        "critical_not_escalated": (cf.severity == "critical") & ~cf.escalated,
        "no_investigation": cf.severity.isin(["high", "critical"]) & (cf.n_investigate == 0),
    }, index=cf.index)


def eg5(ctx):
    cf = ctx.cf
    pop = cf[cf.closed & ~cf.auto_closed]
    viol = conformance_violations(pop)
    nviol = viol.sum(axis=1)
    pop = pop.assign(n_viol=nviol)
    out = _rate_detector("EG5", ctx, pop, nviol > 0, "upper",
                         "{k} of {n} closed cases ({rate:.0%}) break at least one workflow rule "
                         "(triage before close, escalation recorded, containment for true positives, remediation recorded); "
                         "peer median {pr:.0%}.", order_col="n_viol", ascending=False, strata=["severity", "is_tp"])
    for r in out:
        m = (pop.entity_id == r["entity_id"]).to_numpy()
        if m.any():
            r["extra"]["violations"] = {k: int(v) for k, v in viol[m].sum().items()}
    return out


def _fit_var(xb: np.ndarray, cov: np.ndarray, deg: int) -> float:
    """Variance of the fitted counterfactual summed over the bins xb."""
    g = np.vander(xb, deg + 1).sum(axis=0)
    return float(max(g @ cov @ g, 0.0))


def bunching(ttc: np.ndarray, sla: float, width: float = 5.0, half: float = 30.0, lo: float = 60.0, hi: float = 720.0,
             deg: int = 6):
    """Bunching estimator around an SLA threshold. Returns dict with p-value and chart data."""
    edges = np.arange(0, hi + width, width)
    c, _ = np.histogram(ttc, edges)
    mid = (edges[:-1] + edges[1:]) / 2
    win = (mid >= sla - half) & (mid < sla + half)
    fitm = (mid >= lo) & ~win
    if c[fitm].sum() < 50:
        return None
    x = (mid - sla) / (hi - lo)
    coef, cov = np.polyfit(x[fitm], c[fitm], deg, cov=True)
    cf_ = np.clip(np.polyval(coef, x), 0.5, None)
    below = win & (mid < sla)
    above = win & (mid >= sla)
    obs_b, exp_b = c[below].sum(), cf_[below].sum()
    resid = (c[fitm] - cf_[fitm]) ** 2 / cf_[fitm]
    phi = max(1.0, float(np.mean(resid)))
    z = (obs_b - exp_b) / np.sqrt(phi * exp_b)
    p = float(max(stats.norm.sf(z), 1e-12))
    return {"p": p, "z": float(z), "obs_below": float(obs_b), "exp_below": float(exp_b),
            "log_ratio": float(np.log((obs_b + 0.5) / exp_b)),
            "log_ratio_var": float(1 / (obs_b + 0.5) + _fit_var(x[below], cov, deg) / exp_b ** 2),
            "excess": float(obs_b - exp_b), "missing_above": float(cf_[above].sum() - c[above].sum()),
            "ratio": float(obs_b / exp_b) if exp_b > 0 else np.nan, "phi": phi,
            "bins": mid.tolist(), "observed": c.tolist(), "counterfactual": cf_.round(2).tolist(),
            "sla": sla, "window": [sla - half, sla + half]}


def eg6(ctx):
    """Bunching per entity. The effect is the log ratio of observed to counterfactual
    closures just below the SLA. Its p-value uses a random-effects empirical null from
    the peers (common fit bias + between-entity variance, cf. Efron 2004), because the
    plain z ignores the error of the fitted counterfactual and is over-confident."""
    cf = ctx.cf
    stats_ = {}
    for eid, sla in zip(ctx.entities.entity_id, ctx.entities.sla_critical_min):
        t = cf[(cf.entity_id == eid) & cf.closed & ~cf.auto_closed & (cf.severity == "critical")].ttc_min.to_numpy()
        if len(t) < 150:
            stats_[eid] = "Insufficient evidence (fewer than 150 closed critical cases)"
            continue
        b = bunching(t, float(sla))
        stats_[eid] = b if b is not None else "Insufficient evidence"
    eff = {e: (b["log_ratio"], b["log_ratio_var"]) for e, b in stats_.items() if isinstance(b, dict)}
    out = []
    for eid, sla in zip(ctx.entities.entity_id, ctx.entities.sla_critical_min):
        b = stats_[eid]
        if not isinstance(b, dict):
            out.append(_row(eid, "EG6", reason=b))
            continue
        b["p_theoretical"] = b["p"]
        peers = [v for e, v in eff.items() if e != eid]
        b["p"] = random_effects_null_p(b["log_ratio"], b["log_ratio_var"], [y for y, _ in peers], [v for _, v in peers])
        if b["p"] < 0.01:
            t = cf[(cf.entity_id == eid) & cf.closed & ~cf.auto_closed & (cf.severity == "critical")].ttc_min.to_numpy()
            b["excess_ci90"] = bunching_ci(t, float(sla))
        near = cf[(cf.entity_id == eid) & cf.closed & ~cf.auto_closed & (cf.severity == "critical")
                  & cf.ttc_min.between(sla - 30, sla)].sort_values("ttc_min", ascending=False)
        out.append(_row(eid, "EG6", p=b["p"], n=int(sum(b["observed"])), k=int(max(b["excess"], 0)),
                        effect=f"{b['excess']:+.0f} closures just under the {sla:.0f}-min SLA ({b['ratio']:.1f}x expected)",
                        reason=f"{int(round(b['excess']))} more critical cases were closed in the 30 minutes before the "
                               f"{sla:.0f}-minute SLA than the smooth counterfactual predicts ({b['ratio']:.1f}x), with "
                               f"~{b['missing_above']:.0f} missing just after it - the signature of closures timed to the metric.",
                        evidence=near.case_id.head(MAX_EVIDENCE).tolist(), extra={"chart": b}))
    return out


def bunching_ci(ttc: np.ndarray, sla: float, n_boot: int = 200, seed: int = 0) -> list[float] | None:
    """Bootstrap 90% interval for the excess mass below the SLA (cases resampled)."""
    rng = np.random.default_rng(seed)
    ex = []
    for _ in range(n_boot):
        b = bunching(rng.choice(ttc, len(ttc), replace=True), sla)
        if b is not None:
            ex.append(b["excess"])
    return [float(np.quantile(ex, 0.05)), float(np.quantile(ex, 0.95))] if len(ex) >= 50 else None


def eg7(ctx):
    cf, al = ctx.cf, ctx.alerts
    tp = cf[cf.closed & (cf.disposition == "TP") & ~cf.redteam][["case_id", "entity_id", "asset_id", "category", "closed_ts"]]
    a = al[["asset_id", "category", "ts"]].sort_values("ts")
    tp = tp.sort_values("closed_ts")
    tp["search_from"] = tp.closed_ts + pd.Timedelta(days=1)
    m = pd.merge_asof(tp.sort_values("search_from"), a.rename(columns={"ts": "next_ts"}), left_on="search_from",
                      right_on="next_ts", by=["asset_id", "category"], direction="forward")
    m["recur"] = (m.next_ts - m.closed_ts) <= pd.Timedelta(days=30)
    m = m.set_index("case_id").reindex(tp.case_id).reset_index()
    return _rate_detector("EG7", ctx, m, m.recur.fillna(False), "upper",
                          "{k} of {n} closed true-positive cases ({rate:.0%}) saw the same alert type return on the same "
                          "asset within 30 days - evidence the root cause was not remediated; peer median {pr:.0%}.")


def eg11(ctx):
    cf = ctx.cf
    claims = dict(zip(ctx.entities.entity_id, ctx.entities.claims_24x7))
    pop = cf[~cf.auto_closed & cf.night & cf.severity.isin(["high", "critical"])]
    return _rate_detector("EG11", ctx, pop, pop.ack_min > 60, "upper",
                          "The entity declares 24x7 monitoring, yet {k} of {n} high/critical cases opened between 00:00 and "
                          "06:00 ({rate:.0%}) waited more than an hour for acknowledgement; peer median {pr:.0%}.",
                          order_col="ack_min", ascending=False, applicable=lambda e: bool(claims.get(e)))


def eg12(ctx):
    cf, es = ctx.cf, ctx.escalations
    pop = cf[(cf.disposition == "TP") & cf.severity.isin(["high", "critical"]) & ~cf.redteam]
    rep = es[es.to_level == "CERT-In"].groupby("case_id").ts.min()
    lat_h = (pop.case_id.map(rep) - pop.alert_ts).dt.total_seconds() / 3600
    late = lat_h.isna() | (lat_h > 6)
    pop = pop.assign(report_latency_h=lat_h)
    out = _rate_detector("EG12", ctx, pop, late, "upper",
                         "{k} of {n} high/critical true-positive incidents ({rate:.0%}) were reported to CERT-In late "
                         "(> 6 h after the first alert) or not at all; peer median {pr:.0%}.",
                         order_col="report_latency_h", ascending=False)
    for r in out:
        s = pop[pop.entity_id == r["entity_id"]].report_latency_h
        if len(s):
            r["extra"]["median_latency_h"] = float(s.median()) if s.notna().any() else None
            r["extra"]["unreported"] = int(s.isna().sum())
    return out


def eg13(ctx):
    cf = ctx.cf
    pop = cf[~cf.auto_closed]
    return _rate_detector("EG13", ctx, pop, ~pop.ioc_enriched, "upper",
                          "{k} of {n} human-handled cases ({rate:.0%}) show no threat-intelligence / IOC enrichment; "
                          "peer median {pr:.0%}.", strata=["severity", "is_tp"])


def _sources(ctx):
    return {e: set(s.split(",")) for e, s in zip(ctx.entities.entity_id, ctx.entities.declared_log_sources)}


def _nb_p(obs, lam, r, m):
    """Lower-tail NB mid-p with the finite-peer variance inflation (1 + 3/m)."""
    theta = 0.0 if r is None else 1.0 / r
    mult = (1 + lam * theta) * (1 + PEER_INFLATE / max(m, 1))
    theta2 = (mult - 1) / lam if lam > 0 else 0.0
    return nb_lower_pvalue(obs, lam, (1 / theta2) if theta2 > 0 else None)


def _exposure(ctx) -> dict:
    """Observed days per entity (first alert -> period end)."""
    first = ctx.alerts.groupby("entity_id").ts.min()
    return {e: max(1.0, (ctx.period_end - t).total_seconds() / 86400) for e, t in first.items()}


def _class_cat_rates(ctx) -> dict:
    """Peer alert rate per (asset class, category) per asset-day, computed only over
    assets whose entity's log sources can see that category."""
    al, assets = ctx.alerts, ctx.assets
    srcs = _sources(ctx)
    expo = _exposure(ctx)
    cnt = al.groupby(["asset_id", "category"]).size().rename("n").reset_index()
    cnt = cnt.merge(assets[["asset_id", "asset_class"]], on="asset_id")
    assets = assets.assign(days=assets.entity_id.map(expo).fillna(365.0))
    rates = {}
    for (cls, cat), g in cnt.groupby(["asset_class", "category"]):
        need = tx.CATEGORY_SOURCES[cat]
        elig = assets[(assets.asset_class == cls) & assets.entity_id.map(lambda e: bool(need & srcs[e]))]
        if len(elig):
            rates[(cls, cat)] = g.n.sum() / elig.days.sum()
    return rates


def ns1(ctx, window_days: int = 90):
    """Silent critical assets: each critical asset is compared with (a) peer assets of
    the same class over the last quarter, (b) peers over the whole observed period and
    (c) its own history before the quarter. Over-dispersion for (a)/(b) is estimated
    per asset class from all assets of that class, and for (c) from every asset's own
    early/late split. Per asset the three p-values are combined with ACAT; per entity
    the assets are combined with ACAT. Silence after steady activity is the strongest
    signal (monitoring broke), silence all year is a coverage gap."""
    al, assets = ctx.alerts, ctx.assets
    srcs = _sources(ctx)
    expo = _exposure(ctx)
    rates = _class_cat_rates(ctx)
    qstart = ctx.period_end - pd.Timedelta(days=window_days)
    recent = al[al.ts >= qstart].groupby("asset_id").size()
    prior = al[al.ts < qstart].groupby("asset_id").size()
    total = al.groupby("asset_id").size()
    A = assets.assign(obs_q=assets.asset_id.map(recent).fillna(0), obs_prior=assets.asset_id.map(prior).fillna(0),
                      obs_y=assets.asset_id.map(total).fillna(0))
    per_day: dict = {}
    for (cls, cat), v in rates.items():
        per_day.setdefault(cls, {})[cat] = v
    A["days"] = A.entity_id.map(expo).fillna(365.0)
    A["per_day"] = [sum(v for cat, v in per_day.get(c, {}).items() if tx.CATEGORY_SOURCES[cat] & srcs[e])
                    for c, e in zip(A.asset_class, A.entity_id)]
    A["lam_y"] = A.per_day * A.days
    A["lam_q"] = A.per_day * window_days
    # peer over-dispersion per class (all assets of the class, any criticality)
    r_cls, m_cls = {}, {}
    for cls, g in A[A.lam_y >= 5].groupby("asset_class"):
        if len(g) >= 5:
            r_cls[cls] = nb_size_robust(g.obs_y.to_numpy(), g.lam_y.to_numpy())
            m_cls[cls] = len(g)
    # own-history over-dispersion (share of an asset's alerts falling in the last quarter)
    H = A[(A.days - window_days >= 180) & (A.obs_prior >= 20)]
    w_h = window_days / H.days
    N_h = H.obs_q + H.obs_prior
    rho_self = robust_overdispersion(((H.obs_q - N_h * w_h) ** 2 / (N_h * w_h * (1 - w_h))).to_numpy(),
                                     (N_h - 1).to_numpy()) if len(H) >= 10 else 0.0
    rho_self = float(np.clip(rho_self * (1 + PEER_INFLATE / max(len(H), 1)) + 1e-4, 1e-4, 0.5))
    out = []
    for eid, g in A[A.criticality >= 3].groupby("entity_id"):
        days = expo.get(eid, 365.0)
        prior_days = max(0.0, days - window_days)
        rows = []
        for a in g.itertuples():
            lam_q, lam_y = a.lam_q, a.lam_y
            if lam_q < 3:
                continue
            r, m = r_cls.get(a.asset_class), m_cls.get(a.asset_class, 5)
            p_q = _nb_p(a.obs_q, lam_q, r, m)
            p_y = _nb_p(a.obs_y, lam_y, r, m)
            ps = [p_q, p_y]
            p_self, lam_self = np.nan, np.nan
            if prior_days >= 180 and a.obs_prior >= 20:
                w = window_days / days
                N = int(a.obs_q + a.obs_prior)
                lam_self = a.obs_prior * window_days / prior_days
                sz = 1 / rho_self - 1
                bb = stats.betabinom(N, w * sz, (1 - w) * sz)
                p_self = float(np.clip(bb.cdf(a.obs_q - 1) + 0.5 * bb.pmf(a.obs_q), 1e-12, 1))
                ps.append(p_self)
            p = acat(ps)
            why = "stopped" if np.isfinite(p_self) and p_self <= min(p_q, p_y) else "peer"
            rows.append((a.asset_id, a.asset_class, int(a.obs_q), round(lam_q, 1), int(a.obs_prior),
                         round(lam_self, 1) if np.isfinite(lam_self) else None, p, why))
        if not rows:
            out.append(_row(eid, "NS1", reason="No critical assets with enough expected activity"))
            continue
        df_ = pd.DataFrame(rows, columns=["asset_id", "asset_class", "obs_quarter", "expected_quarter", "obs_prior",
                                          "expected_from_own_history", "p", "basis"]).sort_values("p")
        m = len(df_)
        p_ent = acat(df_.p.to_numpy())
        silent = df_[(df_.p < 0.001) & (df_.obs_quarter < 0.3 * df_.expected_quarter)]
        if len(silent):
            names = sorted({tx.ASSET_CLASSES[c][0] for c in silent.asset_class})
            stopped = silent[silent.basis == "stopped"]
            parts = [f"{len(silent)} critical asset(s) ({', '.join(names)}) produced {int(silent.obs_quarter.sum())} "
                     f"alerts in the last {window_days} days where comparable assets at peers produce "
                     f"~{silent.expected_quarter.sum():.0f}."]
            if len(stopped):
                parts.append(f"{len(stopped)} of them had been alerting normally ({int(stopped.obs_prior.sum())} alerts "
                             "earlier in the year) and then went silent - monitoring appears to have broken.")
            parts.append("Silence on a critical system is evidence of a gap, not of safety.")
            reason = " ".join(parts)
        elif p_ent < 0.01:
            low = df_[df_.p < 0.01]
            reason = (f"No critical asset is completely silent, but {len(low)} of {m} alert well below expectation "
                      f"(together {int(low.obs_quarter.sum())} alerts in the last {window_days} days vs ~"
                      f"{low.expected_quarter.sum():.0f} expected from peers and their own history). Reduced telemetry "
                      "on critical systems, for example from suppressed detection rules, weakens coverage.")
            silent = low
        else:
            reason = f"All {m} critical assets show activity consistent with peers and with their own history."
        quiet_only = len(silent) and not ((silent.obs_quarter < 0.3 * silent.expected_quarter).any())
        out.append(_row(eid, "NS1", p=p_ent, n=m, k=len(silent), evidence=silent.asset_id.tolist(), evidence_type="asset",
                        effect=(f"{len(silent)} critical asset(s) under-alerting" if quiet_only else
                                f"{len(silent)} critical asset(s) silent" if len(silent) else "no silent assets"),
                        reason=reason, extra={"assets": df_.head(15).to_dict("records")}))
    have = {r["entity_id"] for r in out}
    out += [_row(e, "NS1", reason="No critical assets") for e in ctx.entities.entity_id if e not in have]
    return out


def tactic_matrix(ctx) -> pd.DataFrame:
    """Per entity x tactic: supportable?, observed, expected (from the entity's own asset
    mix x peer rates), p-value and state (covered / quiet / blind / not_applicable)."""
    al, assets = ctx.alerts, ctx.assets
    srcs = _sources(ctx)
    expo = _exposure(ctx)
    rates = _class_cat_rates(ctx)
    obs = al.groupby(["entity_id", "tactic"]).size()
    sup = {e: tx.supportable_tactics(s) for e, s in srcs.items()}
    n_sup = {t: sum(1 for e in sup if sup[e][t]) for t in tx.TACTICS}
    cls_count = assets.groupby(["entity_id", "asset_class"]).size()
    rows = []
    for e in ctx.entities.entity_id:
        days = expo.get(e, 365.0)
        mix = cls_count.loc[e] if e in cls_count.index.get_level_values(0) else pd.Series(dtype=float)
        for t in tx.TACTICS:
            o = int(obs.get((e, t), 0))
            if not sup[e][t]:
                peers_can = n_sup[t] / len(sup)
                rows.append((e, t, False, o, 0.0, np.nan, "blind" if peers_can >= 0.5 else "not_applicable", peers_can))
                continue
            lam = days * sum(n * v for cls, n in mix.items() for (c2, cat), v in rates.items()
                             if c2 == cls and tx.TACTIC_OF[cat] == t and tx.CATEGORY_SOURCES[cat] & srcs[e])
            rows.append((e, t, True, o, round(lam, 1), np.nan, None, n_sup[t] / len(sup)))
    df_ = pd.DataFrame(rows, columns=["entity_id", "tactic", "supportable", "observed", "expected", "p", "state",
                                      "peer_support_share"])
    # per-tactic over-dispersion, estimated from every entity that can see the tactic
    for t, g in df_[df_.supportable & (df_.expected >= 5)].groupby("tactic"):
        r = nb_size_robust(g.observed.to_numpy(), g.expected.to_numpy()) if len(g) >= 5 else 10.0
        for i in g.index:
            df_.at[i, "p"] = _nb_p(int(df_.at[i, "observed"]), float(df_.at[i, "expected"]), r, len(g) - 1)
    for i in df_.index[df_.supportable]:
        o, lam, pv = df_.at[i, "observed"], df_.at[i, "expected"], df_.at[i, "p"]
        if np.isfinite(pv) and pv < 0.001 and o < 0.3 * lam:
            df_.at[i, "state"] = "quiet"
        else:
            df_.at[i, "state"] = "covered" if (o > 0 or lam >= 1) else "not_applicable"
    return df_


def ns2(ctx, tm):
    out = []
    for e, g in tm.groupby("entity_id"):
        g2 = g[g.supportable & g.p.notna()]
        if g2.empty:
            out.append(_row(e, "NS2", reason="Insufficient evidence"))
            continue
        m = len(g2)
        pmin = acat(g2.p.to_numpy())
        quiet = g2[g2.state == "quiet"].sort_values("p")
        out.append(_row(e, "NS2", p=pmin, n=m, k=len(quiet), evidence=quiet.tactic.tolist(), evidence_type="tactic",
                        effect=f"{len(quiet)} visible tactic(s) unexpectedly absent" if len(quiet) else "tactic mix normal",
                        reason=("The entity's log sources can see " + ", ".join(quiet.tactic) + ", but it reported "
                                + ", ".join(f"{o} (peers ~{x:.0f})" for o, x in zip(quiet.observed, quiet.expected))
                                + " alerts. Expected categories are missing." if len(quiet) else
                                "All supportable tactics appear at peer-consistent volumes.")))
    return out


def ns3(ctx, tm):
    srcs = _sources(ctx)
    all_src = set(tx.LOG_SOURCES)
    out = []
    for e, g in tm.groupby("entity_id"):
        blind = g[g.state == "blind"]
        if blind.empty:
            out.append(_row(e, "NS3", reason="No blind tactics relative to peers.", deterministic=True))
            continue
        fixes = {}
        for t in blind.tactic:
            cats = [c for c, tt in tx.TACTIC_OF.items() if tt == t]
            need = set().union(*(tx.CATEGORY_SOURCES[c] for c in cats)) & (all_src - srcs[e])
            fixes[t] = sorted(need)
        missing = sorted(set().union(*fixes.values()))
        sev = "high" if len(blind) >= 2 else "medium"
        out.append(_row(e, "NS3", n=len(g), k=len(blind), deterministic=True, severity=sev, evidence=blind.tactic.tolist(),
                        evidence_type="tactic", effect=f"blind to {len(blind)} ATT&CK tactic(s)",
                        reason=(f"The submitted log sources cannot support detection of {', '.join(blind.tactic)}, which "
                                f"most peers can see. Silence here means 'blind', not 'safe'. Missing sources: "
                                f"{', '.join(tx.LOG_SOURCES[s].split(' (')[0] for s in missing)}."),
                        extra={"restore_with": fixes, "missing_sources": missing}))
    return out


def ns5(ctx, early=(0, 5), late=(8, 12)):
    al = ctx.alerts
    mi = ((al.ts.dt.year - 2025) * 12 + al.ts.dt.month - 10)
    a = al.assign(m=mi)
    monthly = a.groupby(["entity_id", "detector_id", "m"]).size().unstack(fill_value=0)
    for m in range(12):
        if m not in monthly.columns:
            monthly[m] = 0
    monthly = monthly[sorted(monthly.columns)]
    e_len, l_len = early[1] - early[0], late[1] - late[0]
    E = monthly.loc[:, early[0]:early[1] - 1].sum(axis=1)
    L = monthly.loc[:, late[0]:late[1] - 1].sum(axis=1)
    ok = E / e_len >= 15
    ratio = (L / l_len) / (E / e_len)
    ents = monthly.index.get_level_values(0).unique()
    out = []
    for eid in ctx.entities.entity_id:
        if eid not in monthly.index.get_level_values(0):
            out.append(_row(eid, "NS5", reason="No alerts"))
            continue
        rows = []
        for det in monthly.loc[eid].index:
            key = (eid, det)
            if not ok.get(key, False):
                continue
            peer_keys = [(e2, det) for e2 in ents if e2 != eid and ok.get((e2, det), False)]
            if len(peer_keys) < 5:
                continue
            rho = float(np.median([ratio[k2] for k2 in peer_keys]))
            pk = np.array([L[k2] for k2 in peer_keys])
            pn = np.array([E[k2] + L[k2] for k2 in peer_keys])
            p = rate_test(int(L[key]), int(E[key] + L[key]), pk, pn, tail="lower")
            rows.append((det, p, ratio[key], rho))
        if not rows:
            out.append(_row(eid, "NS5", reason="Insufficient evidence"))
            continue
        d = pd.DataFrame(rows, columns=["detector", "p", "ratio", "peer_ratio"]).sort_values("p")
        m = len(d)
        pe = acat(d.p.to_numpy())
        bad = d[(d.p < 0.001) & (d.ratio < 0.3 * d.peer_ratio)]
        series = {det: monthly.loc[(eid, det)].tolist() for det in bad.detector.head(3)}
        cats = {v: k for k, vs in _det_cats().items() for v in vs}
        out.append(_row(eid, "NS5", p=pe, n=m, k=len(bad), evidence=bad.detector.tolist(), evidence_type="detector",
                        effect=(f"{len(bad)} rule(s) collapsed to {bad.ratio.iloc[0]:.0%} of earlier volume" if len(bad)
                                else "rule volumes stable"),
                        reason=(f"Detection rule {bad.detector.iloc[0]} ({cats.get(bad.detector.iloc[0], '?').replace('_', ' ')}) "
                                f"fell to {bad.ratio.iloc[0]:.0%} of its earlier monthly volume while the same rule at peers "
                                f"stayed at {bad.peer_ratio.iloc[0]:.0%}. Consistent with an accumulated suppression "
                                "('exclusion ratchet') silently removing coverage." if len(bad) else
                                "No detection rule shows an unexplained collapse."),
                        extra={"series": series, "rules": d.head(10).round(4).to_dict("records")}))
    return out


def _det_cats():
    from satsa.gen.generator import DETECTORS as D
    return D


def ns7(ctx):
    al, cf, subs = ctx.alerts, ctx.cf, ctx.submissions
    hc = al[al.severity.isin(["high", "critical"]) & ~al.redteam]
    has_case = hc.alert_id.isin(cf.alert_id)
    pop = hc.assign(case_id=hc.alert_id)  # evidence = alert ids
    out = _rate_detector("NS7", ctx, pop, ~has_case, "upper",
                         "{k} of {n} high/critical alerts ({rate:.0%}) have no corresponding case record in the "
                         "submission; peer median {pr:.0%}. Expected evidence is missing.")
    late = subs[subs.received_ts > subs.due_ts]
    for r in out:
        r["evidence_type"] = "alert"
        lt = late[late.entity_id == r["entity_id"]]
        r["extra"]["late_submissions"] = lt.period.tolist()
        if len(lt) and r["n"]:
            r["reason"] += f" {len(lt)} monthly submission(s) arrived after the due date ({', '.join(lt.period)})."
    return out


def ns8(ctx):
    al = ctx.alerts
    out = []
    for eid, g in al.groupby("entity_id"):
        days = pd.Series(g.ts.dt.normalize().unique()).sort_values()
        span = (days.iloc[-1] - days.iloc[0]).days + 1
        gaps = days.diff().dt.days.fillna(1)
        big = gaps[gaps > 7]
        issues = []
        if span < 180:
            issues.append(f"only {span} days of history (CERT-In requires a rolling 180 days)")
        if len(big):
            i = big.index[0]
            issues.append(f"a {int(big.iloc[0]) - 1}-day gap ending {days[i].date()}")
        if issues:
            out.append(_row(eid, "NS8", deterministic=True, severity="high" if span < 180 else "medium", n=span,
                            evidence_type="period", evidence=[str(days[i].date()) for i in big.index],
                            effect="; ".join(issues), reason="Submitted history has " + " and ".join(issues) + "."))
        else:
            out.append(_row(eid, "NS8", deterministic=True, reason=f"{span} days of continuous history."))
    return out


def ns9(ctx):
    cf = ctx.cf
    out = []
    for eid, g in cf.groupby("entity_id"):
        bad = g[g.ack_min < 0]
        share = len(bad) / len(g)
        if share > 0.005:
            med = float(-bad.ack_min.median())
            out.append(_row(eid, "NS9", deterministic=True, severity="high" if share > 0.05 else "medium", n=len(g),
                            k=len(bad), rate=share, evidence=bad.case_id.tolist(),
                            effect=f"{share:.0%} of cases acknowledged before they were opened",
                            reason=(f"{len(bad)} cases ({share:.0%}) record an acknowledgement a median {med:.0f} minutes "
                                    "before the case was opened - a clock-synchronisation fault (CERT-In requires NTP sync "
                                    "to NIC/NPL). Every time-based metric for this entity is unreliable until fixed.")))
        else:
            out.append(_row(eid, "NS9", deterministic=True, n=len(g), k=len(bad), reason="Timestamps are consistent."))
    return out


def rt1(ctx):
    rt, al, cf = ctx.redteam, ctx.alerts, ctx.cf
    out = []
    for eid in ctx.entities.entity_id:
        r = rt[rt.entity_id == eid] if len(rt) else rt
        if r is None or len(r) == 0:
            out.append(_row(eid, "RT1", reason="No red-team report submitted"))
            continue
        funnel = []
        for x in r.itertuples():
            m = al[(al.entity_id == eid) & (al.category == x.category)
                   & (al.ts >= x.start_ts - pd.Timedelta(hours=1)) & (al.ts <= x.start_ts + pd.Timedelta(hours=24))]
            alerted = len(m) > 0
            cs = cf[cf.alert_id.isin(m.alert_id)]
            funnel.append({"technique_id": x.technique_id, "technique": x.technique, "tactic": x.tactic,
                           "target_asset": x.target_asset, "executed": True, "alerted": alerted,
                           "cased": len(cs) > 0, "escalated": bool(cs.escalated.any()) if len(cs) else False})
        f = pd.DataFrame(funnel)
        missed = f[~f.alerted]
        summary = {k: int(f[k].sum()) for k in ["executed", "alerted", "cased", "escalated"]}
        sev = "high" if len(missed) >= 2 else ("medium" if len(missed) else None)
        out.append(_row(eid, "RT1", deterministic=True, severity=sev, n=len(f), k=len(missed),
                        evidence=missed.technique_id.tolist(), evidence_type="technique",
                        effect=f"{len(missed)} of {len(f)} red-team techniques never alerted",
                        reason=(f"The entity's own red-team exercise executed {len(f)} techniques; {len(missed)} "
                                f"({', '.join(missed.technique.head(4))}) produced no alert at all. These are known "
                                "positives the SOC did not see." if len(missed) else
                                f"All {len(f)} red-team techniques were detected."),
                        extra={"funnel": summary, "techniques": funnel}))
    return out


def _synth_weights(y_pre: np.ndarray, donors_pre: np.ndarray) -> np.ndarray:
    """Non-negative weights summing to one that best reproduce y_pre from the donors
    (NNLS with a heavily weighted sum-to-one row)."""
    from scipy.optimize import nnls
    big = 1e3 * max(1.0, float(np.abs(donors_pre).max()))
    A = np.vstack([donors_pre, np.full(donors_pre.shape[1], big)])
    b = np.append(y_pre, big)
    w, _ = nnls(A, b)
    return w / w.sum() if w.sum() > 0 else np.full(len(w), 1 / len(w))


def synthetic_twins(ctx, split: int = 6):
    """Monthly share of likely-superficial cases (yhat > 0.5) per entity; each entity's
    twin is fitted on months [0, split) and the standardised post-period gap is ranked
    against the same statistic for every peer (placebo inference)."""
    cf = ctx.cf
    h = cf[cf.closed & ~cf.auto_closed]
    m = h.assign(w=h.yhat > 0.5).groupby(["entity_id", "month_idx"]).w.mean().unstack()
    m = m.reindex(columns=range(12)).dropna()
    if len(m) < 10:
        return {}
    Y = m.to_numpy()
    ents = m.index.tolist()
    res = {}
    for i, e in enumerate(ents):
        d = np.delete(np.arange(len(ents)), i)
        w = _synth_weights(Y[i, :split], Y[d, :split].T)
        twin = Y[d].T @ w
        gap = Y[i] - twin
        pre_rmse = float(np.sqrt(np.mean(gap[:split] ** 2)))
        stat = float(np.mean(gap[split:]) / max(pre_rmse, 0.005))
        res[e] = {"stat": stat, "actual": Y[i].round(4).tolist(), "twin": twin.round(4).tolist(),
                  "gap": gap.round(4).tolist(), "pre_rmse": pre_rmse,
                  "donors": {ents[d[j]]: round(float(w[j]), 3) for j in np.argsort(-w)[:5] if w[j] > 0.01}}
    stats_all = np.array([r["stat"] for r in res.values()])
    gaps = np.array([r["gap"] for r in res.values()])
    band = np.quantile(gaps, [0.05, 0.95], axis=0).round(4).tolist()
    for e, r in res.items():
        others = stats_all[[x != e for x in res]]
        r["p"] = float((1 + np.sum(others >= r["stat"])) / (len(others) + 1))
        r["placebo_band"] = band
    return res


def tw1(ctx):
    tw = synthetic_twins(ctx)
    out = []
    for eid in ctx.entities.entity_id:
        r = tw.get(eid)
        if r is None:
            out.append(_row(eid, "TW1", reason="Insufficient monthly history"))
            continue
        post = float(np.mean(r["gap"][6:]))
        out.append(_row(eid, "TW1", p=r["p"], n=12, k=0, rate=float(np.mean(r["actual"][6:])),
                        peer_rate=float(np.mean(r["twin"][6:])),
                        effect=f"{post * 100:+.1f} pp vs its twin after month 6",
                        reason=(f"A blend of peers ({', '.join(r['donors'])}) matched this entity's monthly share of "
                                f"likely-superficial cases for six months (error {r['pre_rmse'] * 100:.1f} pp). Afterwards the "
                                f"entity ran {post * 100:+.1f} pp from its twin, larger than {100 * (1 - r['p']):.0f}% of the same "
                                "gaps computed for every peer (placebo test)."),
                        evidence=[], evidence_type="series", extra={"twin": r}))
    return out


def run_all(ctx: Ctx) -> tuple[pd.DataFrame, pd.DataFrame]:
    tm = tactic_matrix(ctx)
    results = []
    for fn in (eg1, eg2, eg3, eg4, eg5, eg6, eg7, eg11, eg12, eg13, ns1, ns5, ns7, ns8, ns9, rt1, tw1):
        results += fn(ctx)
    results += ns2(ctx, tm)
    results += ns3(ctx, tm)
    return pd.DataFrame(results), tm
