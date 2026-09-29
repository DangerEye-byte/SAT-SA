"""Statistical primitives: conformal p-values, over-dispersed rate tests,
count tests, ACAT combination, Benjamini-Hochberg, e-values."""

from __future__ import annotations

import numpy as np
from scipy import stats

P_FLOOR = 1e-12


def conformal_left_pvalues(test: np.ndarray, calib_sorted: np.ndarray) -> np.ndarray:
    """p = (1 + #{calib <= x}) / (n + 1): small when x is unusually *small*
    (e.g. an unusually fast closure). calib_sorted must be ascending."""
    n = len(calib_sorted)
    if n == 0:
        return np.ones(len(test))
    k = np.searchsorted(calib_sorted, test, side="right")
    return (1 + k) / (n + 1)


# Robust dispersion: match the lower-80% trimmed mean of the scaled squared residuals
# to that of a chi-square(1). Resistant to a minority of genuinely weak peers.
_TRIM_Q = float(stats.chi2.ppf(0.8, 1))
_TRIM_CHI = float(stats.chi2.expect(lambda x: x, args=(1,), ub=_TRIM_Q) / 0.8)
RHO_FLOOR = 1e-4


def robust_overdispersion(z2: np.ndarray, a: np.ndarray, cap: float = 1e6) -> float:
    """Smallest theta >= 0 such that the trimmed mean of z2 / (1 + a*theta) is at most
    the chi-square(1) value. z2: squared Pearson residuals under the no-dispersion
    model; a: how each unit's variance multiplier grows with theta."""
    z2, a = np.asarray(z2, float), np.asarray(a, float)
    ok = np.isfinite(z2) & np.isfinite(a)
    z2, a = z2[ok], a[ok]
    if len(z2) < 3:
        return 0.0

    def tm(theta):
        v = np.sort(z2 / (1 + a * theta))
        return v[: max(1, int(np.ceil(0.8 * len(v))))].mean()

    if tm(0.0) <= _TRIM_CHI:
        return 0.0
    lo, hi = 0.0, 1.0
    while tm(hi) > _TRIM_CHI and hi < cap:
        hi *= 4
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if tm(mid) > _TRIM_CHI else (lo, mid)
    return hi


PEER_INFLATE = 3.0  # finite-peer correction: variance x (1 + 3/m), calibrated by simulation


def _beta_params(peer_k: np.ndarray, peer_n: np.ndarray, trim: float = 0.1, n_self: int | None = None):
    """Beta prior for an entity's rate, estimated from its peers.

    Mean: pooled rate after symmetric trimming of the most extreme peer rates (robust
    to a few weak peers without biasing the healthy centre). Intra-entity correlation
    rho: robust method of moments on the peers' Pearson residuals, so the test is as
    wide as real between-entity variation and no wider. With n_self, the variance for
    an entity of that size is inflated by (1 + 3/m) for the uncertainty of estimating
    the peer distribution from m peers (a prediction-interval correction; without it
    the plug-in test is slightly liberal, ~6% at the 5% level in simulation)."""
    ok = peer_n > 0
    k, n = peer_k[ok].astype(float), peer_n[ok].astype(float)
    if len(k) < 3:
        mu = (k.sum() + 0.5) / (n.sum() + 1)
        return mu * 50, (1 - mu) * 50
    r = k / n
    if trim and len(r) >= 10:
        lo_q, hi_q = np.quantile(r, [trim, 1 - trim])
        keep = (r >= lo_q) & (r <= hi_q)
        mu = float((k[keep].sum() + 0.5) / (n[keep].sum() + 1))
    else:
        mu = float((k.sum() + 0.5) / (n.sum() + 1))
    mu = float(np.clip(mu, 1e-4, 1 - 1e-4))
    z2 = (k - n * mu) ** 2 / (n * mu * (1 - mu))
    rho = float(np.clip(robust_overdispersion(z2, n - 1), RHO_FLOOR, 0.5))
    if n_self is not None and n_self > 1:
        mult = (1 + (n_self - 1) * rho) * (1 + PEER_INFLATE / len(k))
        rho = float(np.clip((mult - 1) / (n_self - 1), RHO_FLOOR, 0.5))
    s = 1 / rho - 1
    return mu * s, (1 - mu) * s


def rate_test(k: int, n: int, peer_k, peer_n, tail: str = "upper", midp: bool = True) -> float:
    """Beta-binomial test of an entity's rate k/n against its peers' rates.
    tail='upper': is k/n unusually high?  'lower': unusually low?
    midp: Lancaster mid-p, which removes the conservative bias of discrete tests."""
    if n <= 0:
        return np.nan
    a, b = _beta_params(np.asarray(peer_k), np.asarray(peer_n), n_self=n)
    half = 0.5 * stats.betabinom.pmf(k, n, a, b) if midp else 0.0
    if tail == "upper":
        p = stats.betabinom.sf(k, n, a, b) + (half if midp else stats.betabinom.pmf(k, n, a, b))
    else:
        p = stats.betabinom.cdf(k - 1, n, a, b) + (half if midp else stats.betabinom.pmf(k, n, a, b))
    return float(np.clip(p, P_FLOOR, 1.0))


def rate_test_expected(k: int, n: int, e: float, peer_k, peer_n, peer_e, tail: str = "upper",
                       midp: bool = True) -> float:
    """Beta-binomial test of k/n against an entity-specific expected count e (indirect
    standardisation for case mix). Over-dispersion is estimated from the peers'
    observed-vs-expected residuals, with the finite-peer inflation."""
    if n <= 0 or e <= 0:
        return np.nan
    pk, pn, pe = (np.asarray(x, float) for x in (peer_k, peer_n, peer_e))
    ok = (pn > 0) & (pe > 0)
    pk, pn, pe = pk[ok], pn[ok], pe[ok]
    mu = float(np.clip(e / n, 1e-4, 1 - 1e-4))
    rho = RHO_FLOOR
    if len(pk) >= 3:
        pm = np.clip(pe / pn, 1e-4, 1 - 1e-4)
        z2 = (pk - pe) ** 2 / (pn * pm * (1 - pm))
        rho = float(np.clip(robust_overdispersion(z2, pn - 1), RHO_FLOOR, 0.5))
        if n > 1:
            mult = (1 + (n - 1) * rho) * (1 + PEER_INFLATE / len(pk))
            rho = float(np.clip((mult - 1) / (n - 1), RHO_FLOOR, 0.5))
    sz = 1 / rho - 1
    a, b = mu * sz, (1 - mu) * sz
    pmf = stats.betabinom.pmf(k, n, a, b)
    if tail == "upper":
        p = stats.betabinom.sf(k, n, a, b) + (0.5 if midp else 1.0) * pmf
    else:
        p = stats.betabinom.cdf(k - 1, n, a, b) + (0.5 if midp else 1.0) * pmf
    return float(np.clip(p, P_FLOOR, 1.0))


def ppi_mean_ci(Y, Yhat, Yhat_unl, alpha: float = 0.1, z_reg: float | None = None) -> dict:
    """Prediction-powered mean estimate with power tuning (PPI++, Angelopoulos et al.
    2023) for a binary outcome. The variance of Y is regularised with the Wilson
    pseudo-count p~ = (k + z^2/2)/(n + z^2) so that a small sample with no (or all)
    positives cannot produce a falsely tiny interval - the failure mode of the plain
    CLT interval for rare outcomes. lambda = 0 reduces to the classical estimate."""
    Y, Yhat, U = (np.asarray(x, float) for x in (Y, Yhat, Yhat_unl))
    n, N = len(Y), len(U)
    z = stats.norm.ppf(1 - alpha / 2)
    zr = z if z_reg is None else z_reg
    k = Y.sum()
    pt = (k + zr * zr / 2) / (n + zr * zr)
    var_y = max(pt * (1 - pt), float(np.var(Y)))
    var_f = float(np.var(Yhat)) if n > 1 else 0.0
    cov = float(np.mean((Y - Y.mean()) * (Yhat - Yhat.mean()))) if n > 1 else 0.0
    var_u = float(np.var(U)) if N > 1 else 0.0
    denom = (1 + n / max(N, 1)) * var_f
    lam = float(np.clip(cov / denom, 0.0, 1.0)) if denom > 0 else 0.0
    est = float(Y.mean() + lam * (U.mean() - Yhat.mean())) if N else float(Y.mean())
    var = (var_y + lam * lam * var_f - 2 * lam * cov) / n + lam * lam * var_u / max(N, 1)
    se = float(np.sqrt(max(var, 0.0)))
    return {"estimate": est, "lo": max(0.0, est - z * se), "hi": min(1.0, est + z * se), "se": se, "lambda": lam}


def nb_lower_pvalue(obs: float, lam: float, r: float | None = None, midp: bool = True) -> float:
    """P(X < obs) + 0.5 P(X = obs) for X ~ NegBin(mean=lam, size=r) (Poisson if r is None)."""
    if lam <= 0:
        return 1.0
    if r is None or r <= 0 or not np.isfinite(r):
        d = stats.poisson(lam)
    else:
        d = stats.nbinom(r, r / (r + lam))
    p = d.cdf(obs - 1) + (0.5 if midp else 1.0) * d.pmf(obs)
    return float(np.clip(p, P_FLOOR, 1.0))


def nb_size_robust(obs, lam) -> float | None:
    """Negative-binomial size r from observed vs expected counts across units
    (robust method of moments). None means no over-dispersion (Poisson)."""
    obs, lam = np.asarray(obs, float), np.asarray(lam, float)
    ok = lam > 0
    theta = robust_overdispersion((obs[ok] - lam[ok]) ** 2 / lam[ok], lam[ok])
    return None if theta <= 0 else 1 / theta


def nb_size_from_counts(counts: np.ndarray) -> float | None:
    counts = np.asarray(counts, float)
    if len(counts) < 3:
        return None
    m, v = counts.mean(), counts.var(ddof=1)
    if v <= m or m <= 0:
        return None
    return m * m / (v - m)


def random_effects_null_p(y: float, v: float, y_peers, v_peers, min_peers: int = 8) -> float:
    """Upper-tail p-value for an entity's effect estimate y (sampling variance v) against
    its peers, allowing a common bias mu0 and between-entity variance tau^2, both
    estimated robustly from the peers (a random-effects empirical null)."""
    yp, vp = np.asarray(y_peers, float), np.asarray(v_peers, float)
    ok = np.isfinite(yp) & np.isfinite(vp) & (vp > 0)
    yp, vp = yp[ok], vp[ok]
    if len(yp) < min_peers:
        return float(np.clip(stats.norm.sf(y / np.sqrt(v)), P_FLOOR, 1.0))
    mu0 = float(np.median(yp))
    tau2 = robust_overdispersion((yp - mu0) ** 2 / vp, 1 / vp)
    sd = np.sqrt((v + tau2) * (1 + PEER_INFLATE / len(yp)))
    return float(np.clip(stats.norm.sf((y - mu0) / sd), P_FLOOR, 1.0))


def empirical_null_p(z: float, z_peers, min_peers: int = 8, sd_floor: float = 0.5) -> float:
    """Upper-tail p-value of z against an empirical null fitted robustly to the peers'
    statistics (median, MAD) - Efron (2004). Falls back to N(0,1) with few peers."""
    zp = np.asarray([x for x in z_peers if np.isfinite(x)], float)
    if len(zp) < min_peers:
        return float(np.clip(stats.norm.sf(z), P_FLOOR, 1.0))
    mu = float(np.median(zp))
    sd = max(float(np.median(np.abs(zp - mu)) * 1.4826), sd_floor)
    return float(np.clip(stats.norm.sf((z - mu) / sd), P_FLOOR, 1.0))


def acat(pvals, weights=None) -> float:
    """Cauchy combination test (Liu & Xie, JASA 2020): valid under arbitrary dependence."""
    p = np.asarray([x for x in pvals if x is not None and np.isfinite(x)], float)
    if len(p) == 0:
        return 1.0
    # p-values at (or extremely near) 1 map to -inf under tan() and would swamp the
    # statistic; capping at 0.99 is the usual truncation and changes nothing for
    # small p-values, which are what drive a flag.
    p = np.clip(p, 1e-15, 0.99)
    w = np.full(len(p), 1 / len(p)) if weights is None else np.asarray(weights, float) / np.sum(weights)
    t = np.sum(w * np.tan((0.5 - p) * np.pi))
    if t > 1e15:
        return float(max(1 / (t * np.pi), P_FLOOR))
    return float(np.clip(0.5 - np.arctan(t) / np.pi, P_FLOOR, 1.0))


def bh(pvals, q: float) -> np.ndarray:
    """Benjamini-Hochberg selection mask at FDR level q."""
    p = np.asarray(pvals, float)
    m = len(p)
    if m == 0:
        return np.zeros(0, bool)
    order = np.argsort(p)
    passed = p[order] <= q * np.arange(1, m + 1) / m
    sel = np.zeros(m, bool)
    if passed.any():
        k = np.max(np.where(passed)[0]) + 1
        sel[order[:k]] = True
    return sel


def qvalues(pvals) -> np.ndarray:
    """BH-adjusted p-values (q-values): the smallest FDR level at which each is selected."""
    p = np.asarray(pvals, float)
    m = len(p)
    order = np.argsort(p)
    ranked = p[order] * m / np.arange(1, m + 1)
    q = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(m)
    out[order] = np.minimum(q, 1.0)
    return out


def p_to_e(p: float, kappa: float = 0.5) -> float:
    """Vovk-Wang calibrator: e = kappa * p^(kappa-1) is a valid e-value."""
    p = max(float(p), P_FLOOR)
    return kappa * p ** (kappa - 1)


def ebh(evals, q: float) -> np.ndarray:
    """e-BH (Wang & Ramdas, JRSS-B 2022): FDR control under arbitrary dependence."""
    e = np.asarray(evals, float)
    m = len(e)
    order = np.argsort(-e)
    ok = e[order] >= m / (q * np.arange(1, m + 1))
    sel = np.zeros(m, bool)
    if ok.any():
        k = np.max(np.where(ok)[0]) + 1
        sel[order[:k]] = True
    return sel


def attention_index(q: float) -> float:
    """0-100 manager-facing index derived from the calibrated q-value."""
    return float(np.clip(20 * -np.log10(max(q, 1e-5)), 0, 100))
