"""Spectral energy distributions (Science item 1).

PHYSICAL IDEA. An SED (spectral energy distribution) is how an object's light
is shared out over wavelength. Its SHAPE tells you what the object is:
 * a star's photosphere is close to a blackbody (Planck curve) at its surface
   temperature, so the peak wavelength gives T (Wien: lambda_peak ~ 2898 um K / T);
 * a cool brown dwarf is NOT a blackbody: methane and water absorb deep
   bands (e.g. 1.6, 2.2, 3.3 um), so a blackbody fit fails, which is itself a result;
 * dust around a young star (a disc) adds a second, cooler hump: an infrared excess;
 * a quasar or blazar emits a power law F_nu ~ nu^alpha from relativistic electrons.

SPHEREx measures each exposure at a different wavelength (its filter is a
linear variable filter: wavelength changes across the detector), so the many
exposures of one object together sample its SED from 0.75 to 5 um.

FORMALISM. Points carry their full error budget. Errors that are SHARED
(e.g. one detector's absolute calibration) make points correlated, so fits use
generalised least squares with a covariance matrix
    C = diag(independent variances) + sum_g s_g s_g^T
(s_g = vector of the shared error g on each point), and
    chi2 = r^T C^-1 r,   r = data - model.
A common 5 % scale error then shifts the fitted size (solid angle) but does not
fake a temperature, which is physically right.
Models: blackbody (T, Omega), power law (A, beta), two blackbodies (star + dust).
Model choice by BIC (Bayesian information criterion) = chi2 + k ln N: lower is
better, and every extra parameter must earn its place.
"""
import math

import numpy as np

from lab import stats, units
from lab.uncertainty import Measured

T_GRID = np.geomspace(150.0, 60000.0, 700)          # K
BETA_GRID = np.linspace(-6.0, 6.0, 1201)            # F_nu ~ lambda^beta
WIEN_UM_K = 2897.771955                              # Wien displacement constant (lambda_max T), um K

# Nominal SPHEREx channel centres (um): 102 channels = 6 bands x 17. VERIFIED 15 Nov 2026
# from the DR1 all-sky cube properties file (data_cube_crval3_arr), IRSA.
SPHEREX_CHANNELS_UM = np.array([
    0.753, 0.771, 0.790, 0.809, 0.828, 0.848, 0.868, 0.889, 0.910, 0.932, 0.955, 0.978, 1.001, 1.025, 1.050,
    1.075, 1.102, 1.113, 1.139, 1.167, 1.195, 1.224, 1.254, 1.284, 1.315, 1.346, 1.378, 1.412, 1.446, 1.481,
    1.517, 1.554, 1.592, 1.631, 1.656, 1.695, 1.735, 1.775, 1.818, 1.861, 1.905, 1.949, 1.995, 2.041, 2.089,
    2.139, 2.189, 2.240, 2.292, 2.345, 2.399, 2.445, 2.506, 2.575, 2.646, 2.719, 2.794, 2.871, 2.951, 3.033,
    3.118, 3.204, 3.293, 3.383, 3.476, 3.570, 3.667, 3.768, 3.833, 3.867, 3.901, 3.935, 3.970, 4.005, 4.040,
    4.076, 4.112, 4.148, 4.184, 4.220, 4.257, 4.294, 4.331, 4.368, 4.405, 4.435, 4.467, 4.500, 4.533, 4.566,
    4.600, 4.635, 4.669, 4.704, 4.739, 4.773, 4.808, 4.843, 4.879, 4.915, 4.951, 4.988])


# ---------------------------------------------------------------- data handling
def points_from(items):
    """items: dicts with lam (um), flux (Measured, mJy), optional mjd, label, dlam.
    Returns (lam, value, covariance, meta) sorted by wavelength."""
    items = [it for it in items if it.get("flux") is not None and np.isfinite(it["flux"].value)
             and np.isfinite(it.get("lam", np.nan))]
    items.sort(key=lambda it: it["lam"])
    n = len(items)
    lam = np.array([it["lam"] for it in items], float)
    val = np.array([it["flux"].value for it in items], float)
    cov = np.zeros((n, n))
    groups = {}
    for i, it in enumerate(items):
        for t in it["flux"].terms:
            if t.shared:
                groups.setdefault(t.name, np.zeros(n))[i] = t.sigma
            else:
                cov[i, i] += t.sigma ** 2
    for vec in groups.values():
        cov += np.outer(vec, vec)
    return lam, val, cov, items, sorted(groups)


def bin_channels(items, centres=SPHEREX_CHANNELS_UM, min_points=1):
    """Average exposures falling in the same nominal SPHEREx channel.

    Bin edges are midpoints between neighbouring channel centres. Inside a bin the
    INDEPENDENT errors are combined by inverse-variance weighting; shared terms are
    kept as they are (averaging cannot reduce a common calibration error). If the
    points scatter more than their errors allow (chi2_red > 1: variability, or
    calibration scatter), the independent error is inflated by sqrt(chi2_red)."""
    edges = np.concatenate([[centres[0] - (centres[1] - centres[0]) / 2],
                            (centres[1:] + centres[:-1]) / 2,
                            [centres[-1] + (centres[-1] - centres[-2]) / 2]])
    out = []
    for k in range(len(centres)):
        sel = [it for it in items if edges[k] <= it["lam"] < edges[k + 1] and it.get("flux") is not None]
        if len(sel) < min_points:
            continue
        indep = np.array([math.sqrt(sum(t.sigma ** 2 for t in it["flux"].terms if not t.shared)) for it in sel])
        vals = np.array([it["flux"].value for it in sel])
        mean, err, chi2, n = stats.weighted_mean(vals, indep)
        if n == 0:
            continue
        inflate = math.sqrt(chi2 / (n - 1)) if n > 1 and chi2 > (n - 1) else 1.0
        m = Measured(mean, "mJy", label=f"channel {k + 1}")
        m.add("independent errors (weighted mean)", err * inflate, "statistical",
              note=f"x{inflate:.2f} for scatter between exposures" if inflate > 1 else "")
        shared = {}
        for it in sel:
            for t in it["flux"].terms:
                if t.shared:
                    shared.setdefault(t.name, []).append(t.sigma / abs(it["flux"].value) if it["flux"].value else 0)
        for name, fracs in shared.items():
            m.add(name, abs(mean) * float(np.mean(fracs)), "systematic", shared=True)
        out.append({"lam": float(centres[k]), "flux": m, "n": n, "chi2_red": chi2 / (n - 1) if n > 1 else None,
                    "mjd": float(np.mean([it.get("mjd", np.nan) for it in sel])), "channel": k + 1})
    return out


# ---------------------------------------------------------------- generalised least squares
def _gls_scale(templates, data, cinv):
    """Best non-negative amplitudes a for model = templates.T @ a, and chi2."""
    t = np.atleast_2d(templates)
    a_mat = t @ cinv @ t.T
    b = t @ cinv @ data
    try:
        amp = np.linalg.solve(a_mat, b)
    except np.linalg.LinAlgError:
        return None, np.inf
    if np.any(amp < 0) and t.shape[0] > 1:                    # tiny NNLS: drop negative ones
        best = (None, np.inf)
        for k in range(t.shape[0]):
            sub = t[k:k + 1]
            a1 = float((sub[0] @ cinv @ data) / (sub[0] @ cinv @ sub[0]))
            if a1 < 0:
                continue
            amp1 = np.zeros(t.shape[0])
            amp1[k] = a1
            r = data - t.T @ amp1
            chi = float(r @ cinv @ r)
            if chi < best[1]:
                best = (amp1, chi)
        return best
    if np.any(amp < 0):
        return None, np.inf
    r = data - t.T @ amp
    return amp, float(r @ cinv @ r)


def _profile_interval(grid, chi2_curve, best_chi2):
    """1-sigma interval from where chi2 rises by 1 above its minimum (profile likelihood)."""
    k = int(np.argmin(chi2_curve))
    target = best_chi2 + 1.0

    def crossing(indices):
        prev = k
        for i in indices:
            if chi2_curve[i] >= target:
                x0, x1 = grid[prev], grid[i]
                y0, y1 = chi2_curve[prev], chi2_curve[i]
                return float(x0 + (target - y0) * (x1 - x0) / (y1 - y0)) if y1 != y0 else float(x1)
            prev = i
        return None

    lo = crossing(range(k - 1, -1, -1))
    hi = crossing(range(k + 1, len(grid)))
    return lo, hi


def _refine(f, a, b, tol=1e-6):
    """Golden-section minimisation of f on [a, b]."""
    g = (math.sqrt(5) - 1) / 2
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = f(c), f(d)
    for _ in range(200):
        if abs(b - a) < tol * (abs(a) + abs(b)):
            break
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = f(d)
    return (a + b) / 2


# ---------------------------------------------------------------- models
def fit_blackbody(lam, val, cov):
    """F_nu = Omega B_nu(T). Returns T, Omega with profile-likelihood 1-sigma intervals."""
    cinv = np.linalg.inv(cov)
    data = val / 1000.0                                          # mJy -> Jy

    def chi_at(temp):
        tmpl = units.blackbody_fnu_jy(lam, temp, 1.0)[None, :]
        amp, chi = _gls_scale(tmpl, data, cinv / 1e-6)         # cov in mJy^2 -> Jy^2
        return chi, (amp[0] if amp is not None else np.nan)

    curve = np.array([chi_at(t)[0] for t in T_GRID])
    k = int(np.argmin(curve))
    lo_t, hi_t = T_GRID[max(k - 1, 0)], T_GRID[min(k + 1, len(T_GRID) - 1)]
    t_best = _refine(lambda tt: chi_at(tt)[0], lo_t, hi_t) if hi_t > lo_t else T_GRID[k]
    chi_best, omega = chi_at(t_best)
    fine = np.geomspace(max(T_GRID[0], t_best / 3), min(T_GRID[-1], t_best * 3), 2001)
    fine_curve = np.array([chi_at(t)[0] for t in fine])
    t_lo, t_hi = _profile_interval(fine, fine_curve, chi_best)
    # Joint covariance of (ln T, ln Omega) from the curvature of chi2 (Fisher matrix):
    # cov = 2 H^-1, H = Hessian of chi2. Needed because T and Omega are correlated
    # (a hotter fit needs a smaller star to give the same flux).
    ci = cinv / 1e-6

    def chi2_full(lt, lo):
        r = data - units.blackbody_fnu_jy(lam, math.exp(lt), math.exp(lo))
        return float(r @ ci @ r)

    p0 = np.array([math.log(t_best), math.log(omega)])
    h = np.array([1e-4, 1e-4])
    hess = np.zeros((2, 2))
    for i in range(2):
        for j in range(2):
            e_i, e_j = np.eye(2)[i] * h[i], np.eye(2)[j] * h[j]
            hess[i, j] = (chi2_full(*(p0 + e_i + e_j)) - chi2_full(*(p0 + e_i - e_j))
                          - chi2_full(*(p0 - e_i + e_j)) + chi2_full(*(p0 - e_i - e_j))) / (4 * h[i] * h[j])
    try:
        cov_log = 2.0 * np.linalg.inv(hess)
        if np.any(np.diag(cov_log) <= 0):
            raise np.linalg.LinAlgError
    except np.linalg.LinAlgError:
        cov_log = None
    at_edge = k in (0, len(T_GRID) - 1)
    return {"model": "blackbody", "params": 2, "chi2": chi_best, "T_K": t_best,
            "T_lo": t_lo, "T_hi": t_hi, "omega_sr": omega,
            "omega_sigma_sr": omega * math.sqrt(cov_log[1, 1]) if cov_log is not None else None,
            "cov_lnT_lnOmega": cov_log.tolist() if cov_log is not None else None,
            "wien_peak_um": WIEN_UM_K / t_best, "at_grid_edge": bool(at_edge),
            "curve": lambda w: units.blackbody_fnu_jy(w, t_best, omega) * 1000.0}


def fit_power_law(lam, val, cov):
    """F_nu = A (lambda / lambda0)^beta, lambda0 = geometric mean wavelength.
    beta = -alpha where F_nu ~ nu^alpha (alpha: the usual quasar/blazar spectral index)."""
    cinv = np.linalg.inv(cov)
    lam0 = float(np.exp(np.mean(np.log(lam))))

    def chi_at(beta):
        t = (lam / lam0) ** beta
        amp = float((t @ cinv @ val) / (t @ cinv @ t))
        r = val - amp * t
        return float(r @ cinv @ r), amp

    curve = np.array([chi_at(b)[0] for b in BETA_GRID])
    k = int(np.argmin(curve))
    b_best = _refine(lambda bb: chi_at(bb)[0], BETA_GRID[max(k - 1, 0)], BETA_GRID[min(k + 1, len(BETA_GRID) - 1)])
    chi_best, amp = chi_at(b_best)
    fine = np.linspace(b_best - 1.5, b_best + 1.5, 3001)
    b_lo, b_hi = _profile_interval(fine, np.array([chi_at(b)[0] for b in fine]), chi_best)
    return {"model": "power law", "params": 2, "chi2": chi_best, "beta": b_best, "beta_lo": b_lo, "beta_hi": b_hi,
            "alpha_nu": -b_best, "A_mJy": amp, "lambda0_um": lam0,
            "at_grid_edge": bool(k in (0, len(BETA_GRID) - 1)),
            "curve": lambda w: amp * (np.asarray(w, float) / lam0) ** b_best}


def fit_two_blackbodies(lam, val, cov, n_grid=70):
    """Hot photosphere + cool dust: Omega1 B(T1) + Omega2 B(T2), T2 < T1, both Omegas >= 0."""
    cinv = np.linalg.inv(cov) / 1e-6
    data = val / 1000.0
    grid = np.geomspace(150.0, 30000.0, n_grid)
    best = (np.inf, None)
    for i, t1 in enumerate(grid):
        b1 = units.blackbody_fnu_jy(lam, t1, 1.0)
        for t2 in grid[:i]:
            amp, chi = _gls_scale(np.vstack([b1, units.blackbody_fnu_jy(lam, t2, 1.0)]), data, cinv)
            if amp is not None and chi < best[0]:
                best = (chi, (t1, t2, amp))
    if best[1] is None:
        return None
    chi, (t1, t2, amp) = best
    return {"model": "two blackbodies", "params": 4, "chi2": chi, "T1_K": t1, "T2_K": t2,
            "omega1_sr": float(amp[0]), "omega2_sr": float(amp[1]),
            "note": "grid search (70 x 70 temperatures); errors not computed for this model",
            "curve": lambda w: (units.blackbody_fnu_jy(w, t1, amp[0]) + units.blackbody_fnu_jy(w, t2, amp[1])) * 1000.0}


def jitter(lam, val, cov, model_curve, dof):
    """Extra fractional scatter s (same for all points) that makes chi2_red = 1:
    C -> C + diag((s F)^2). Returns 0 when the errors already explain the scatter."""
    model = model_curve(lam)
    r = val - model

    def chi_red(s):
        c = cov + np.diag((s * np.abs(model)) ** 2)
        return float(r @ np.linalg.inv(c) @ r) / max(dof, 1)

    if chi_red(0.0) <= 1.0:
        return 0.0
    lo, hi = 0.0, 1.0
    if chi_red(hi) > 1.0:
        return float("inf")
    for _ in range(80):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if chi_red(mid) > 1.0 else (lo, mid)
    return (lo + hi) / 2


def _bolometric(lam, val, cov, curve, distance_pc, distance_sigma_pc, mc, seed):
    """Bolometric flux by integrating the MEASURED SED (model-light), plus model tails.

    F_bol = integral F_lambda d lambda. Inside the observed range we integrate the data
    (trapezoid rule on F_lambda = F_nu c / lambda^2), so molecular bands are counted as
    they are. Outside it we integrate the best-fitting model from 0.1 to 100 um and
    report how much of F_bol that extrapolation supplies. L = 4 pi d^2 F_bol."""
    if len(lam) < 3:
        return None
    to_flam = lambda fnu_mjy, l_um: fnu_mjy * 1e-3 * units.JY * units.C_LIGHT / (l_um * 1e-6) ** 2   # W m^-2 m^-1
    order = np.argsort(lam)
    l_sorted = lam[order]
    rng = np.random.default_rng(seed)
    try:
        draws = rng.multivariate_normal(val, cov, mc, method="eigh")[:, order]
    except np.linalg.LinAlgError:
        return None
    inside = np.trapezoid(to_flam(draws, l_sorted), l_sorted * 1e-6, axis=1)
    blue = np.geomspace(0.1, l_sorted[0], 200)
    red = np.geomspace(l_sorted[-1], 100.0, 400)
    tails = float(np.trapezoid(to_flam(np.clip(curve(blue), 0, None), blue), blue * 1e-6) +
                  np.trapezoid(to_flam(np.clip(curve(red), 0, None), red), red * 1e-6))
    fbol = inside + tails
    q = lambda a: [float(x) for x in np.percentile(a, [15.865525393145707, 50, 84.13447460685429])]
    res = {"F_bol_W_m2_p16_p50_p84": q(fbol), "observed_range_um": [float(l_sorted[0]), float(l_sorted[-1])],
           "model_tail_fraction": float(tails / np.median(fbol)) if np.median(fbol) > 0 else None,
           "note": "Data integrated inside the observed range; best-fit model outside (0.1-100 um)."}
    if distance_pc and distance_sigma_pc is not None:
        d = rng.normal(distance_pc, distance_sigma_pc, mc) * units.PC_M
        lum = 4 * math.pi * d ** 2 * fbol / units.L_SUN_W
        res["L_bol_Lsun_p16_p50_p84"] = q(lum[np.isfinite(lum)])
        res["L_lower_limit_Lsun"] = float(np.median(4 * math.pi * d ** 2 * inside) / units.L_SUN_W)
    res["F_bol_lower_limit_W_m2"] = float(np.median(inside))
    if res["model_tail_fraction"] and res["model_tail_fraction"] > 0.5:
        res.pop("F_bol_W_m2_p16_p50_p84")
        res.pop("L_bol_Lsun_p16_p50_p84", None)
        res["warning"] = (f"{100 * res['model_tail_fraction']:.0f} % of the flux would come from extrapolating the "
                          "model beyond the data, so no total is given; the measured part is a strict lower limit.")
    elif res["model_tail_fraction"] and res["model_tail_fraction"] > 0.3:
        res["warning"] = (f"{100 * res['model_tail_fraction']:.0f} % of F_bol comes from the model outside the "
                          "measured range: the luminosity depends on that extrapolation.")
    return res


def analyse(items, distance_pc=None, distance_sigma_pc=None, binned=True, mc=3000, seed=7, extra=()):
    """Full SED analysis. items: per-exposure SPHEREx points (see points_from).

    extra: points from other instruments (e.g. Gaia XP). They are never binned into
    SPHEREx channels. Those with fit=False (correlated errors) are only plotted.
    Returns a JSON-ready dict."""
    used = bin_channels(items) if binned else list(items)
    used = used + [it for it in extra if it.get("fit", True)]
    plotted = [it for it in extra if not it.get("fit", True)]
    lam, val, cov, kept, shared = points_from(used)
    n = len(lam)
    out = {"n_points": n, "binned": binned, "shared_error_groups": shared, "fits": [], "caveats": [
        "Interstellar extinction is NOT corrected (it matters in the Galactic plane, e.g. Sgr A*).",
        "Exposures from different dates are combined: a variable object's SED mixes epochs.",
        "Brown dwarfs and AGN are not blackbodies: a bad blackbody fit is a physical result, not a bug."]}
    out["points"] = [{"lam": float(l), "flux_mJy": float(v), "sigma_mJy": float(math.sqrt(cov[i, i])),
                      "nu_fnu_W_m2": float(units.nu_fnu_w_m2(v / 1000.0, l)), "n": it.get("n", 1),
                      "label": it.get("label", ""), "source": it.get("source", "spherex")}
                     for i, (l, v, it) in enumerate(zip(lam, val, kept))]
    out["plot_only_points"] = [{"lam": float(it["lam"]), "flux_mJy": float(it["flux"].value),
                                "sigma_mJy": float(it["flux"].sigma), "label": it.get("label", ""),
                                "source": it.get("source", "")} for it in plotted]
    if any(it.get("source") == "gaia_xp" for it in kept):
        out["caveats"].append("Gaia XP (2015-2017) and SPHEREx (2025-) were observed years apart; "
                              "a variable star's two parts of the SED may not match.")
    if n < 3:
        out["error"] = "at least 3 wavelengths are needed for a fit"
        return out
    fits = [fit_blackbody(lam, val, cov), fit_power_law(lam, val, cov)]
    if n >= 6:
        two = fit_two_blackbodies(lam, val, cov)
        if two:
            fits.append(two)
    wave_plot = np.geomspace(max(0.3, lam.min() / 1.5), min(30.0, lam.max() * 1.5), 160)
    for f in fits:
        dof = n - f["params"]
        f["dof"] = dof
        f["chi2_red"] = f["chi2"] / dof if dof > 0 else None
        f["p_value"] = stats.chi2_sf(f["chi2"], dof) if dof > 0 else None
        f["bic"] = f["chi2"] + f["params"] * math.log(n)
        f["jitter_fraction"] = jitter(lam, val, cov, f["curve"], dof) if dof > 0 else None
        f["plot"] = {"lam": [float(w) for w in wave_plot], "flux_mJy": [float(x) for x in f["curve"](wave_plot)]}
    fits.sort(key=lambda f: f["bic"])
    best = fits[0]
    out["bolometric"] = _bolometric(lam, val, cov, best["curve"], distance_pc, distance_sigma_pc, mc, seed)
    out["preferred"] = best["model"]
    for f in fits:
        f["delta_bic"] = f["bic"] - best["bic"]
        f.pop("curve")
    out["fits"] = [{k: (stats.json_number(v) if isinstance(v, (float, np.floating)) else v) for k, v in f.items()}
                   for f in fits]

    # physical size and luminosity from the blackbody fit + a distance (Monte Carlo)
    bb = next(f for f in fits if f["model"] == "blackbody")
    if distance_pc and distance_sigma_pc is not None and bb.get("cov_lnT_lnOmega") is not None:
        rng = np.random.default_rng(seed)
        draw = rng.multivariate_normal([math.log(bb["T_K"]), math.log(bb["omega_sr"])],
                                       np.array(bb["cov_lnT_lnOmega"]), mc)
        temp, omega = np.exp(draw[:, 0]), np.exp(draw[:, 1])
        dist = rng.normal(distance_pc, distance_sigma_pc, mc)
        ok = (temp > 0) & (omega > 0) & (dist > 0)
        radius_m = dist[ok] * units.PC_M * np.sqrt(omega[ok] / math.pi)          # Omega = pi R^2 / d^2
        lum = 4 * math.pi * radius_m ** 2 * units.SIGMA_SB * temp[ok] ** 4        # Stefan-Boltzmann
        q = lambda a: [float(x) for x in np.percentile(a, [15.865525393145707, 50, 84.13447460685429])]
        out["physical"] = {"radius_Rsun_p16_p50_p84": q(radius_m / units.R_SUN_M),
                           "luminosity_Lsun_p16_p50_p84": q(lum / units.L_SUN_W), "samples": int(ok.sum()),
                           "note": "Only meaningful if the blackbody describes a stellar photosphere. "
                                   "L uses Stefan-Boltzmann L = 4 pi R^2 sigma T^4 with the fitted T."}
    if out.get("physical") and bb.get("chi2_red") is not None and bb["chi2_red"] > 3:
        out["physical"]["warning"] = (f"The blackbody fits badly (chi2_red = {bb['chi2_red']:.0f}): R and L are "
                                      "biased. Cool stars and brown dwarfs have deep molecular bands (TiO, H2O, CH4) "
                                      "and are not blackbodies; use them as order-of-magnitude values only.")
    pl = next((f for f in fits if f["model"] == "power law"), None)
    if pl and pl.get("at_grid_edge"):
        out["caveats"].append("The power-law slope hit the edge of its range (|beta| = 6): a power law does "
                              "not describe this SED.")
    if best["model"] == "blackbody" and bb.get("at_grid_edge"):
        out["caveats"].append("Blackbody temperature hit the edge of the search grid: the data do not "
                              "constrain T (the SED may be on the Rayleigh-Jeans tail).")
    return out
