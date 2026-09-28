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


def _beta_params(peer_k: np.ndarray, peer_n: np.ndarray, trim: float = 0.15):
    """Robust beta prior from peer rates.

    Mean: pooled rate of the peers after trimming the highest-rate peers (so a few
    weak peers cannot make weakness look normal). Spread: MAD-based between-peer
    variance minus binomial noise (method of moments), with a floor so the test is
    never a naive binomial."""
    ok = peer_n > 0
    k, n = peer_k[ok].astype(float), peer_n[ok].astype(float)
    if len(k) < 3:
        mu = (k.sum() + 0.5) / (n.sum() + 1)
        return mu * 50, (1 - mu) * 50
    r = k / n
    if trim and len(r) >= 8:
        keep = r <= np.quantile(r, 1 - trim)
        k, n, r = k[keep], n[keep], r[keep]
    mu = float(np.clip((k.sum() + 0.5) / (n.sum() + 1), 1e-4, 1 - 1e-4))
    mad = float(np.median(np.abs(r - np.median(r)))) * 1.4826
    var_obs = max(mad ** 2, float(np.var(r, ddof=1)) * 0.25 if len(r) > 1 else 0.0)
    var_bin = float(np.mean(mu * (1 - mu) / n))
    rho = np.clip((var_obs - var_bin) / (mu * (1 - mu) - var_bin + 1e-12), 2e-3, 0.5)
    s = 1 / rho - 1
    return mu * s, (1 - mu) * s


def rate_test(k: int, n: int, peer_k, peer_n, tail: str = "upper") -> float:
    """Beta-binomial test of an entity's rate k/n against its peers' rates.
    tail='upper': is k/n unusually high?  'lower': unusually low?"""
    if n <= 0:
        return np.nan
    a, b = _beta_params(np.asarray(peer_k), np.asarray(peer_n))
    if tail == "upper":
        p = stats.betabinom.sf(k - 1, n, a, b)
    else:
        p = stats.betabinom.cdf(k, n, a, b)
    return float(np.clip(p, P_FLOOR, 1.0))


def nb_lower_pvalue(obs: float, lam: float, r: float | None = None) -> float:
    """P(X <= obs) for X ~ NegBin(mean=lam, size=r); Poisson if r is None."""
    if lam <= 0:
        return 1.0
    if r is None or r <= 0 or not np.isfinite(r):
        return float(max(stats.poisson.cdf(obs, lam), P_FLOOR))
    p = r / (r + lam)
    return float(max(stats.nbinom.cdf(obs, r, p), P_FLOOR))


def nb_size_from_counts(counts: np.ndarray) -> float | None:
    counts = np.asarray(counts, float)
    if len(counts) < 3:
        return None
    m, v = counts.mean(), counts.var(ddof=1)
    if v <= m or m <= 0:
        return None
    return m * m / (v - m)


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
