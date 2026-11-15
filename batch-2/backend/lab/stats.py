"""Statistics in plain numpy/math (no scipy needed on the server).

Each function is checked against scipy/astropy in lab/selftest.py.
"""
import math

import numpy as np


# ---------------------------------------------------------------- incomplete gamma
def _gamma_series(a, x):
    """Regularized lower incomplete gamma P(a, x) by its power series (x < a + 1)."""
    term = total = 1.0 / a
    ap = a
    for _ in range(10000):
        ap += 1.0
        term *= x / ap
        total += term
        if abs(term) < abs(total) * 1e-16:
            break
    return total * math.exp(-x + a * math.log(x) - math.lgamma(a))


def _gamma_fraction(a, x):
    """Regularized upper incomplete gamma Q(a, x) by Lentz's continued fraction (x >= a + 1)."""
    tiny = 1e-300
    b = x + 1.0 - a
    c = 1.0 / tiny
    d = 1.0 / b
    h = d
    for i in range(1, 10000):
        an = -i * (i - a)
        b += 2.0
        d = an * d + b
        d = tiny if abs(d) < tiny else d
        c = b + an / c
        c = tiny if abs(c) < tiny else c
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-16:
            break
    return math.exp(-x + a * math.log(x) - math.lgamma(a)) * h


def gamma_q(a, x):
    """Regularized upper incomplete gamma function Q(a, x) = Gamma(a, x) / Gamma(a)."""
    if x <= 0:
        return 1.0
    if x < a + 1.0:
        return max(0.0, 1.0 - _gamma_series(a, x))
    return _gamma_fraction(a, x)


def chi2_sf(chi2, dof):
    """Probability that a chi-square variable with `dof` degrees of freedom exceeds chi2.

    Physics use: if the scatter of measurements around a model is only noise,
    chi2 ~ dof; a tiny p-value says the model (e.g. 'constant brightness') is wrong."""
    if dof <= 0 or not np.isfinite(chi2):
        return float("nan")
    return gamma_q(0.5 * dof, 0.5 * max(chi2, 0.0))


def normal_sf(z):
    """One-sided tail probability of a standard normal distribution."""
    return 0.5 * math.erfc(z / math.sqrt(2.0))


def p_to_sigma(p):
    """Two-sided p-value -> equivalent Gaussian 'n sigma' (bisection on erfc)."""
    if not (0 < p < 1):
        return float("inf") if p <= 0 else 0.0
    lo, hi = 0.0, 40.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if math.erfc(mid / math.sqrt(2.0)) > p:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# ---------------------------------------------------------------- robust statistics
def mad_std(values):
    """Standard deviation estimated from the median absolute deviation
    (1.4826 x MAD equals sigma for Gaussian noise but ignores outliers like stars)."""
    v = np.asarray(values, float)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return float("nan")
    return 1.482602218505602 * float(np.median(np.abs(v - np.median(v))))


def sigma_clip(values, sigma=3.0, iterations=10):
    """Boolean mask of values kept after iterative median/MAD sigma clipping."""
    v = np.asarray(values, float)
    keep = np.isfinite(v)
    for _ in range(iterations):
        if keep.sum() < 3:
            break
        med = np.median(v[keep])
        s = mad_std(v[keep])
        if not np.isfinite(s) or s == 0:
            break
        new = keep & (np.abs(v - med) <= sigma * s)
        if new.sum() == keep.sum():
            break
        keep = new
    return keep


def truncation_factor(k):
    """Ratio std(Gaussian truncated at +-k sigma) / sigma = sqrt(1 - 2k phi(k) / (2 Phi(k) - 1)).
    Clipping at 3 sigma removes the tails, so the clipped std is 1.3 % too small; we divide by this."""
    phi = math.exp(-0.5 * k * k) / math.sqrt(2.0 * math.pi)
    inside = math.erf(k / math.sqrt(2.0))
    return math.sqrt(1.0 - 2.0 * k * phi / inside)


def clipped_stats(values, sigma=3.0):
    """(median, standard deviation, number kept) after sigma clipping.

    The standard deviation of the kept values (ddof=1) is divided by the
    truncation factor of a Gaussian clipped at +-sigma, so it estimates the noise
    sigma without bias when the background is Gaussian noise plus a few stars."""
    v = np.asarray(values, float)
    keep = sigma_clip(v, sigma)
    kept = v[keep]
    if kept.size < 2:
        return float("nan"), float("nan"), int(kept.size)
    return (float(np.median(kept)), float(np.std(kept, ddof=1)) / truncation_factor(sigma),
            int(kept.size))


def weighted_mean(values, sigmas):
    """Inverse-variance weighted mean and its 1-sigma error, plus chi2 about it."""
    x = np.asarray(values, float)
    s = np.asarray(sigmas, float)
    good = np.isfinite(x) & np.isfinite(s) & (s > 0)
    if not good.any():
        return float("nan"), float("nan"), float("nan"), 0
    w = 1.0 / s[good] ** 2
    mean = float(np.sum(w * x[good]) / np.sum(w))
    err = float(1.0 / math.sqrt(np.sum(w)))
    chi2 = float(np.sum(w * (x[good] - mean) ** 2))
    return mean, err, chi2, int(good.sum())


def json_number(x, digits=None):
    """Plain float for JSON (NaN/inf -> None) so the browser never sees 'NaN'."""
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return round(f, digits) if digits is not None else f
