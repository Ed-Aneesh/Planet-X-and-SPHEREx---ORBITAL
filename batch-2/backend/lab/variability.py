"""Time-domain variability (Science item 4).

PHYSICAL IDEA. Many objects change brightness: pulsating giants (Mira, R Dra:
months-long cycles of ~1-8 magnitudes in the visible, less in the infrared),
young stars (RW Aur: irregular dimming by dust), eclipsing binaries, blazars
(BL Lac: random flaring), supernovae (one-off transients). A LIGHT CURVE is
brightness against time; the questions are (1) does it vary more than the noise
allows? (2) is the change periodic, and with what period? (3) is any single
point a transient outlier?

SPHEREx TRAP. Every SPHEREx exposure sees a DIFFERENT wavelength (linear variable
filter), and most objects are brighter at some wavelengths than others. A raw
"flux vs time" plot therefore mixes colour with time. Two remedies:
  'sed'    divide every point by a smooth fit of the object's spectrum
           (ln F vs ln lambda, quadratic), leaving a relative light curve;
  'window' keep only exposures within +-1 % of one wavelength.

PERIODOGRAM. The generalised Lomb-Scargle periodogram (Zechmeister & Kuerster
2009, A&A 496, 577) fits a sine wave plus a constant at every trial frequency,
weighting each point by 1/sigma^2. Power p(f) in [0, 1] is the fraction of the
scatter the sine explains. Uneven sampling creates ALIASES (false peaks at
f +- the sampling frequency); the WINDOW FUNCTION (periodogram of the sampling
alone) shows where they will appear. The false-alarm probability (FAP: chance
that pure noise makes a peak this high anywhere in the searched range) uses
Baluev (2008, MNRAS 385, 1279), as implemented in astropy.
"""
import math

import numpy as np

from lab import stats

VISIT_GAP_DAYS = 30.0
MAX_FREQUENCIES = 100_000


# ---------------------------------------------------------------- periodogram
def gls(t, y, dy, freqs, chunk=4000):
    """Generalised Lomb-Scargle power (floating mean, 1/sigma^2 weights), 'standard' normalisation."""
    t, y, dy = (np.asarray(a, float) for a in (t, y, dy))
    w = 1.0 / dy ** 2
    w = w / w.sum()
    ybar = np.sum(w * y)
    yy = np.sum(w * (y - ybar) ** 2)
    out = np.empty(len(freqs))
    for i in range(0, len(freqs), chunk):
        f = np.asarray(freqs[i:i + chunk])[:, None]
        arg = 2.0 * np.pi * f * t[None, :]
        c, s = np.cos(arg), np.sin(arg)
        cbar, sbar = c @ w, s @ w
        yc = (c * (y - ybar)) @ w
        ys = (s * (y - ybar)) @ w
        cc = (c * c) @ w - cbar ** 2
        ss = (s * s) @ w - sbar ** 2
        cs = (c * s) @ w - cbar * sbar
        d = cc * ss - cs ** 2
        out[i:i + chunk] = (ss * yc ** 2 + cc * ys ** 2 - 2.0 * cs * yc * ys) / (yy * d)
    return out


def _wmean(v, dy):
    w = 1.0 / dy ** 2
    return np.sum(w * v) / np.sum(w)


def fap_baluev(z, fmax, t, dy):
    """False-alarm probability of the highest peak of power z ('standard' normalisation)."""
    n = len(t)
    nh, nk = n - 1, n - 3
    if nk <= 1 or not 0 < z < 1:
        return 1.0 if z <= 0 else 0.0
    var_t = _wmean(t ** 2, dy) - _wmean(t, dy) ** 2
    t_eff = math.sqrt(4.0 * math.pi * var_t)
    gamma = math.sqrt(2.0 / nh) * math.exp(math.lgamma(nh / 2.0) - math.lgamma((nh - 1) / 2.0))
    fap_single = (1.0 - z) ** (0.5 * nk)
    tau = gamma * fmax * t_eff * (1.0 - z) ** (0.5 * (nk - 1)) * math.sqrt(0.5 * nh * z)
    return float(1.0 - (1.0 - fap_single) * math.exp(-tau))


def power_at_fap(fap, fmax, t, dy):
    """Periodogram power at which the FAP equals `fap` (bisection)."""
    lo, hi = 0.0, 1.0
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        if fap_baluev(mid, fmax, t, dy) > fap:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def window_function(t, freqs, chunk=4000):
    """|sum exp(2 pi i f t)|^2 / N^2: 1 at f = 0; peaks show the sampling rhythm (aliases)."""
    t = np.asarray(t, float)
    out = np.empty(len(freqs))
    for i in range(0, len(freqs), chunk):
        arg = 2.0 * np.pi * np.asarray(freqs[i:i + chunk])[:, None] * t[None, :]
        out[i:i + chunk] = (np.cos(arg).sum(1) ** 2 + np.sin(arg).sum(1) ** 2) / len(t) ** 2
    return out


def _peaks(freqs, power, n=5, exclude_below=0.0):
    """Indices of the n highest local maxima above exclude_below."""
    p = np.asarray(power)
    is_peak = np.r_[False, (p[1:-1] > p[:-2]) & (p[1:-1] >= p[2:]), False] & (np.asarray(freqs) > exclude_below)
    idx = np.nonzero(is_peak)[0]
    return idx[np.argsort(p[idx])[::-1][:n]]


def harmonic_fit(t, y, dy, freq):
    """y = a + b cos(2 pi f t) + c sin(2 pi f t): semi-amplitude, phase and their 1-sigma errors."""
    a = np.column_stack([np.ones_like(t), np.cos(2 * np.pi * freq * t), np.sin(2 * np.pi * freq * t)])
    w = 1.0 / dy ** 2
    cov = np.linalg.inv(a.T @ (a * w[:, None]))
    p = cov @ (a.T @ (w * y))
    amp = math.hypot(p[1], p[2])
    j = np.array([p[1], p[2]]) / amp if amp > 0 else np.zeros(2)
    amp_sigma = math.sqrt(max(float(j @ cov[1:, 1:] @ j), 0.0))
    return {"mean": float(p[0]), "semi_amplitude": amp, "semi_amplitude_sigma": amp_sigma,
            "phase_rad": float(math.atan2(-p[2], p[1]))}


# ---------------------------------------------------------------- statistics
def excess_variance(x, sx):
    """Normalised excess variance and fractional rms variability F_var with its error
    (Vaughan et al. 2003, MNRAS 345, 1271, eqs. 8 and B2)."""
    x, sx = np.asarray(x, float), np.asarray(sx, float)
    n = len(x)
    mean = float(np.mean(x))
    s2 = float(np.var(x, ddof=1))
    err2 = float(np.mean(sx ** 2))
    sigma_xs2 = s2 - err2
    out = {"sigma_xs2": sigma_xs2, "nxs": sigma_xs2 / mean ** 2 if mean else None}
    if sigma_xs2 > 0 and mean != 0:
        fvar = math.sqrt(sigma_xs2) / abs(mean)
        e1 = math.sqrt(1.0 / (2.0 * n)) * err2 / (mean ** 2 * fvar)
        e2 = math.sqrt(err2 / n) / abs(mean)
        out.update(fvar=fvar, fvar_sigma=math.hypot(e1, e2))
    else:
        out.update(fvar=None, fvar_sigma=None,
                   note="scatter not larger than the errors: no measurable variability")
    return out


def colour_correct(lam, flux, sigma, mode="sed", lam_window=None, window_fraction=0.01):
    """Remove the spectral shape so only time variation remains. Returns (keep, rel, rel_sigma, info)."""
    lam, flux, sigma = (np.asarray(a, float) for a in (lam, flux, sigma))
    if mode == "none":                                  # already divided by the spectral shape (per band)
        keep = np.isfinite(flux) & np.isfinite(sigma) & (sigma > 0)
        return keep, flux, sigma, {"mode": "per-band", "note": "each band divided by its own smooth fit "
                                                               "of ln F vs ln lambda, then combined"}
    if mode == "window":
        centre = float(lam_window if lam_window is not None else np.median(lam))
        keep = np.abs(lam / centre - 1.0) <= window_fraction
        if keep.sum() < 2:
            raise ValueError(f"fewer than 2 exposures within +-{100 * window_fraction:.1f} % of {centre:.3f} um")
        ref, _, _, _ = stats.weighted_mean(flux[keep], sigma[keep])
        return keep, flux / ref, sigma / ref, {"mode": "window", "centre_um": centre,
                                                 "half_width_fraction": window_fraction}
    good = (flux > 0) & np.isfinite(flux) & (sigma > 0)
    if good.sum() < 4:
        raise ValueError("need at least 4 positive fluxes to model the spectral shape")
    x = np.log(lam[good])
    yl = np.log(flux[good])
    wl = (flux[good] / sigma[good]) ** 2               # sigma of ln F = sigma_F / F
    order = 2 if good.sum() >= 8 else 1
    coef = np.polyfit(x, yl, order, w=np.sqrt(wl))
    model = np.exp(np.polyval(coef, np.log(lam)))
    return good, flux / model, sigma / model, {"mode": "sed", "polynomial_order": order,
                                               "note": "divided by a smooth fit of ln F vs ln lambda; "
                                                       "sharp spectral features are not removed"}


def visits(t, gap=VISIT_GAP_DAYS):
    """Number of separate visits (groups of exposures closer than `gap` days)."""
    t = np.sort(np.asarray(t, float))
    return int(1 + np.sum(np.diff(t) > gap)) if len(t) else 0


def analyse(mjd, lam, flux, sigma, mode="sed", lam_window=None, f_max=None, oversample=10, fap_levels=(0.01, 0.001)):
    """Full variability analysis of per-exposure photometry. Returns a JSON-ready dict."""
    keep, rel, rel_sigma, colour = colour_correct(lam, flux, sigma, mode, lam_window)
    t = np.asarray(mjd, float)[keep]
    y = rel[keep]
    dy = rel_sigma[keep]
    order = np.argsort(t)
    t, y, dy = t[order], y[order], dy[order]
    n = len(t)
    out = {"n": n, "colour_correction": colour, "baseline_days": float(t[-1] - t[0]) if n > 1 else 0.0,
           "n_visits": visits(t), "light_curve": {"mjd": t.tolist(), "rel_flux": y.tolist(), "sigma": dy.tolist()}}
    mean, err, chi2, ngood = stats.weighted_mean(y, dy)
    dof = ngood - 1
    p = stats.chi2_sf(chi2, dof) if dof > 0 else None
    out["constant_model"] = {"weighted_mean": mean, "chi2": chi2, "dof": dof, "chi2_red": chi2 / dof if dof else None,
                             "p_value": p, "significance_sigma": stats.p_to_sigma(p) if p is not None else None,
                             "verdict": ("variable (constant brightness rejected at > 3 sigma)" if p is not None and p < 0.0027
                                         else "consistent with constant within the errors")}
    out["excess_variance"] = excess_variance(y, dy)
    snr_ok = y / dy > 3
    if snr_ok.sum() >= 2:
        out["peak_to_peak_fraction"] = float((y[snr_ok].max() - y[snr_ok].min()) / abs(mean))
    z = (y - np.median(y)) / np.sqrt(dy ** 2 + (stats.mad_std(y) if n > 5 else 0.0) ** 2)
    out["outliers"] = [{"mjd": float(t[i]), "z": float(z[i])} for i in np.nonzero(np.abs(z) > 5)[0]]

    # ---- periodogram
    per = {"meaningful": True, "notes": []}
    out["n_epochs"] = visits(t, gap=0.5)              # separate nights (exposures > 12 h apart)
    if n < 6 or out["n_epochs"] < 5:
        per["meaningful"] = False
        per["notes"].append(f"only {n} exposures on {out['n_epochs']} separate night(s): a period cannot be "
                            "measured (SPHEREx revisits most of the sky every ~6 months; the deep fields near "
                            "the ecliptic poles are observed almost daily)")
    elif out["baseline_days"] > 0 and n >= 6:
        per["notes"].append(f"periods longer than ~{out['baseline_days'] / 2:.0f} d (half the baseline) "
                            "cannot be confirmed with this data")
    if n >= 4 and out["baseline_days"] > 0:
        span = out["baseline_days"]
        f_min = 1.0 / span
        dts = np.diff(t)
        dts = dts[dts > 1e-4]
        nyquist_like = 0.5 / np.percentile(dts, 5) if len(dts) else 1.0
        fmax = float(min(f_max or nyquist_like, 10.0))
        if fmax <= f_min:
            fmax = 2 * f_min
        n_f = int(min(MAX_FREQUENCIES, max(200, oversample * span * (fmax - f_min))))
        if n_f == MAX_FREQUENCIES:
            per["notes"].append("frequency grid capped at 100 000 points: very short periods may be under-resolved")
        freqs = np.linspace(f_min, fmax, n_f)
        power = gls(t, y, dy, freqs)
        win = window_function(t, freqs)
        k = int(np.argmax(power))
        best_f = float(freqs[k])
        fap = fap_baluev(float(power[k]), fmax, t, dy)
        per.update(f_min=f_min, f_max=fmax, n_freq=n_f, best_frequency=best_f, best_period_days=1.0 / best_f,
                   best_power=float(power[k]), fap=fap,
                   fap_levels={str(l): power_at_fap(l, fmax, t, dy) for l in fap_levels})
        per["harmonic"] = harmonic_fit(t, y, dy, best_f)
        wpk = _peaks(freqs, win, 3, exclude_below=1.5 * f_min)
        per["window_peaks"] = [{"frequency": float(freqs[i]), "period_days": float(1 / freqs[i]),
                                "power": float(win[i])} for i in wpk]
        df = freqs[1] - freqs[0]
        for i in wpk:
            if abs(best_f - freqs[i]) < 3 * df:
                per["notes"].append(f"best period ({1 / best_f:.3g} d) coincides with a peak of the sampling "
                                    "window: it is probably the observing rhythm, not the star")
        if fap > 0.01:
            per["notes"].append(f"highest peak has a false-alarm probability of {fap:.2g}: not significant")
        stride = max(1, n_f // 1500)
        per["plot"] = {"frequency": freqs[::stride].tolist(), "power": power[::stride].tolist(),
                       "window": win[::stride].tolist()}
        phase = ((t - t[0]) * best_f) % 1.0
        per["folded"] = {"phase": phase.tolist(), "rel_flux": y.tolist(), "sigma": dy.tolist()}
    out["periodogram"] = per
    return out
