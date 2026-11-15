"""Aperture and PSF photometry on one SPHEREx spectral image (Science item 2).

PHYSICAL IDEA. A star is a point, but the telescope spreads its light over
several pixels (the PSF). Photometry adds that light back up:

 * APERTURE photometry: sum the pixels inside a circle around the star, subtract
   the sky level measured in a ring (annulus) further out, then correct for the
   light that fell OUTSIDE the circle (the aperture correction, computed from the
   ePSF). Simple and model-light, but it adds the noise of every pixel in the circle.
 * PSF photometry: fit the known ePSF shape (scaled by the star's flux, plus a flat
   background) to the pixels by weighted least squares. It weights each pixel by
   how much starlight it should hold, so it is less noisy for faint stars, but it
   depends on the PSF model being right.
 * FORCED photometry: the position is not fitted but fixed in advance (here from
   the catalogue or Gaia position moved to the exposure date), so even a source
   too faint to see can be measured without bias toward bright noise spikes.

UNITS. Pixels hold surface brightness (MJy/sr). Sum x pixel solid angle (sr) = MJy;
x 1e9 = mJy. The pixel solid angle comes from the file's own WCS at the source.

ERRORS (all 1-sigma, kept as separate budget terms; see uncertainty.py):
  statistical: pixel noise (VARIANCE layer), background-level uncertainty,
               aperture correction from the centroid uncertainty
  systematic : absolute flux calibration of the detector (shared by all exposures
               of a detector), ePSF zone-to-zone variation (PSF model error)
"""
import math

import numpy as np

from lab import stats, units
from lab.uncertainty import STATISTICAL, SYSTEMATIC, Measured

# Default settings; every one can be overridden per call and is echoed in the result.
DEFAULTS = {
    "aperture_px": 2.0,          # aperture radius in native pixels (1 px = 6.15 arcsec)
    "annulus_in_px": 6.0,        # sky ring, inner radius: beyond the ePSF core
    "annulus_out_px": 10.0,
    "fit_radius_px": 3.0,        # PSF fit uses pixels within this radius
    "abs_cal_fraction": 0.05,    # absolute calibration: ~5 % (SPHEREx Ultracool Dwarf Atlas, arXiv:2604.26771:
                                 # ~5 % flux dispersion vs external photometry, "broadly consistent" with the
                                 # Explanatory Supplement; mission design goal 2 %). Adjustable.
                                 # Shared by all exposures of a detector (fully correlated).
    "relative_cal_fraction": 0.02,  # exposure-to-exposure calibration (detector-position response, flat field):
                                    # NOT shared between exposures. Measured by us on 16 real DR1 exposures of
                                    # Tabby's Star: 2.5 % rms about a smooth spectrum vs 1.3 % expected from
                                    # noise -> ~2 % extra.
    "position_sigma_arcsec": 1.0,   # forced position uncertainty (catalogue+WCS) if nothing better:
                                    # conservative default when no catalogue position is available
    "subsample": 11,             # sub-pixels per side for exact aperture overlap
}


def _circle_weights(shape, x0, y0, radius, subsample):
    """Fraction of each pixel inside a circle (sub-pixel sampling; exact to ~0.1 %)."""
    ny, nx = shape
    yy, xx = np.mgrid[:ny, :nx].astype(float)
    d = np.hypot(xx - x0, yy - y0)
    w = (d <= radius - 0.75).astype(float)                      # fully inside
    edge = (d > radius - 0.75) & (d < radius + 0.75)
    if edge.any():
        offs = (np.arange(subsample) + 0.5) / subsample - 0.5
        sx, sy = np.meshgrid(offs, offs)
        for j, i in zip(*np.nonzero(edge)):
            inside = np.hypot(i + sx - x0, j + sy - y0) <= radius
            w[j, i] = inside.mean()
    return w


def _background(img, ok, x0, y0, r_in, r_out):
    """Sky level per pixel from the annulus (sigma-clipped median) and its uncertainty.

    Uncertainty of a MEDIAN of N Gaussian values: sigma * sqrt(pi / 2N)."""
    ny, nx = img.shape
    yy, xx = np.mgrid[:ny, :nx]
    d = np.hypot(xx - x0, yy - y0)
    ring = ok & (d >= r_in) & (d <= r_out) & np.isfinite(img)
    values = img[ring]
    level, sigma, n = stats.clipped_stats(values, 3.0)
    if n < 8 or not np.isfinite(level):
        return None
    return {"level": level, "sigma_pixel": sigma, "n": n,
            "sigma_level": sigma * math.sqrt(math.pi / (2.0 * n)), "ring": ring}


def _usable(spec):
    """Pixels usable for the background ring: not bad, not near a known source, no ghost/streak."""
    img = spec.calibrated()
    return img, np.isfinite(img) & ~spec.source & ~spec.warn


def aperture(spec, x0, y0, opts=None, position_sigma_px=None):
    """Aperture photometry at (x0, y0) (0-based pixel coordinates of this image)."""
    o = dict(DEFAULTS, **(opts or {}))
    img, ring_ok = _usable(spec)
    r = float(o["aperture_px"])
    w = _circle_weights(img.shape, x0, y0, r, int(o["subsample"]))
    inside = w > 0
    if not inside.any():
        raise ValueError("aperture lies outside the image")
    bg = _background(img, ring_ok, x0, y0, o["annulus_in_px"], o["annulus_out_px"])
    bg_note = ""
    ny_, nx_ = img.shape
    yy_, xx_ = np.mgrid[:ny_, :nx_]
    ring_all = (np.hypot(xx_ - x0, yy_ - y0) >= o["annulus_in_px"]) & (np.hypot(xx_ - x0, yy_ - y0) <= o["annulus_out_px"])
    if bg is None or bg["n"] < 0.3 * ring_all.sum():
        # Crowded field: the SOURCE flag ("pixel mapped to a known source") can cover almost the
        # whole cutout (seen on real data: 98.6 %). Then rely on sigma-clipping to reject stars.
        covered = float(spec.source[ring_all].mean()) if ring_all.any() else 0.0
        bg = _background(img, np.isfinite(img) & ~spec.warn, x0, y0, o["annulus_in_px"], o["annulus_out_px"])
        bg_note = (f"SOURCE flag covers {100 * covered:.0f} % of the sky ring (crowded field): sky level from "
                   "the sigma-clipped ring instead (stars rejected by clipping)")
    if bg is None:
        raise ValueError("too few clean background pixels in the annulus")
    var = spec.variance if spec.variance is not None else np.full(img.shape, bg["sigma_pixel"] ** 2)
    good = inside & np.isfinite(img) & np.isfinite(var)
    lost = inside & ~good
    # VARIANCE sanity check: empirical scatter in the ring vs the pipeline's variance there
    var_ring = np.median(var[bg["ring"] & np.isfinite(var)]) if np.isfinite(var[bg["ring"]]).any() else np.nan
    var_ratio = bg["sigma_pixel"] ** 2 / var_ring if var_ring and np.isfinite(var_ring) else np.nan
    var_scale = var_ratio if np.isfinite(var_ratio) and var_ratio > 1.3 else 1.0

    wg = np.where(good, w, 0.0)
    signal_sb = float(np.sum(wg * np.nan_to_num(img - bg["level"])))      # MJy/sr x pixel
    var_pixels = float(np.sum(wg ** 2 * np.nan_to_num(var))) * var_scale
    area = float(np.sum(wg))
    var_bg = (area * bg["sigma_level"]) ** 2

    omega = spec.solid_angle_sr(x0, y0)
    to_mjy = omega * 1e9                                       # (MJy/sr x px) -> mJy

    # aperture correction from the ePSF, with the SAME lost pixels removed
    psf = spec.psf
    ee, ee_terms, zone_note = None, {}, ""
    if psf is not None:
        ny, nx = img.shape
        yy, xx = np.mgrid[:ny, :nx].astype(float)
        xd, yd = spec.detector_xy(x0, y0)
        zone = psf.zone(xd, yd)

        def enclosed(zone_index, xs0, ys0):
            model = psf.render(zone_index, xx, yy, xs0, ys0)
            return float(np.sum(wg * model))

        ee = enclosed(zone, x0, y0)
        if not ee > 0.05:
            raise ValueError("aperture captures under 5 % of the PSF (source off the image?)")
        sig = position_sigma_px if position_sigma_px is not None else (
            o["position_sigma_arcsec"] / (math.sqrt(omega) / units.ARCSEC_TO_RAD))
        shifts = [enclosed(zone, x0 + dx, y0 + dy) for dx, dy in
                  ((sig, 0), (-sig, 0), (0, sig), (0, -sig))]
        # EE peaks at the true centre, so a centring error lowers it: rms change over 4 directions
        ee_terms["centroid"] = float(np.sqrt(np.mean((np.array(shifts) - ee) ** 2)))
        others = [enclosed(z, x0, y0) for z in psf.neighbours(xd, yd, 4)]
        ee_terms["zone"] = float(np.std(others, ddof=1)) if len(others) > 1 else 0.0
        zone_note = getattr(psf, "source", "")
    flux_ap = signal_sb * to_mjy
    result = Measured(flux_ap / ee if ee else flux_ap, "mJy",
                      label="aperture flux" + (" (aperture-corrected)" if ee else " (NOT aperture-corrected)"))
    corr = 1.0 / ee if ee else 1.0
    result.add("pixel noise (VARIANCE layer)", math.sqrt(var_pixels) * to_mjy * corr, STATISTICAL,
               note=("scaled up to the measured ring scatter, which also contains faint unresolved stars "
                     "(confusion noise)") if var_scale > 1 else "")
    result.add("background level", math.sqrt(var_bg) * to_mjy * corr, STATISTICAL)
    if ee:
        result.add("aperture correction: centring", abs(result.value) * ee_terms["centroid"] / ee, STATISTICAL)
        result.add("aperture correction: PSF zone", abs(result.value) * ee_terms["zone"] / ee, SYSTEMATIC,
                   note="spread between the 4 nearest ePSF zones")
    result.add(f"absolute calibration D{spec.detector}", abs(result.value) * o["abs_cal_fraction"], SYSTEMATIC,
               shared=True, note=f"{100 * o['abs_cal_fraction']:.1f} % (adjustable)")
    result.add("exposure-to-exposure calibration", abs(result.value) * o["relative_cal_fraction"], SYSTEMATIC,
               note=f"{100 * o['relative_cal_fraction']:.1f} %, independent per exposure")

    core = _circle_weights(img.shape, x0, y0, 1.0, 5) > 0
    quality = [bg_note] if bg_note else []
    if lost.any():
        quality.append(f"{int(lost.sum())} flagged/blank pixel(s) inside the aperture: their light is "
                       "restored by the aperture correction (computed with the same pixels removed)")
    sat = spec._mask({"OVERFLOW", "NONLINEAR"}) & core
    if sat.any():
        quality.append("saturated or non-linear pixels in the core: flux is a LOWER LIMIT")
    if (spec.warn & inside).any():
        quality.append("ghost/streak/crosstalk/halo flag inside the aperture")
    if np.isfinite(var_ratio) and var_ratio > 1.3:
        quality.append(f"ring scatter is {math.sqrt(var_ratio):.2f}x the VARIANCE-layer noise: errors scaled up")
    return {"method": "aperture", "flux": result, "aperture_px": r,
            "encircled_energy": stats.json_number(ee, 5), "psf": zone_note or "none",
            "background_mjy_sr": stats.json_number(bg["level"]), "background_sigma_mjy_sr": stats.json_number(bg["sigma_pixel"]),
            "n_background": bg["n"], "variance_ratio": stats.json_number(var_ratio, 3),
            "pixel_solid_angle_sr": omega, "quality": quality, "saturated": bool(sat.any()),
            "settings": {k: o[k] for k in ("aperture_px", "annulus_in_px", "annulus_out_px", "abs_cal_fraction",
                                          "relative_cal_fraction")}}


def psf_fit(spec, x0, y0, opts=None, fit_position=True, position_sigma_px=None, background=None):
    """Weighted least-squares fit of flux x ePSF + constant background.

    fit_position=False -> forced photometry at (x0, y0)."""
    o = dict(DEFAULTS, **(opts or {}))
    psf = spec.psf
    if psf is None:
        raise ValueError("no PSF available for this image")
    img = spec.calibrated()
    var = spec.variance
    if var is None:
        raise ValueError("PSF fitting needs the VARIANCE layer")
    ny, nx = img.shape
    yy, xx = np.mgrid[:ny, :nx].astype(float)
    xd, yd = spec.detector_xy(x0, y0)
    zone = psf.zone(xd, yd)
    rfit = float(o["fit_radius_px"])
    use = (np.hypot(xx - x0, yy - y0) <= rfit) & np.isfinite(img) & np.isfinite(var) & (var > 0)
    if use.sum() < 6:
        raise ValueError("fewer than 6 clean pixels to fit")
    data, sig2 = img[use], var[use]
    px, py = xx[use], yy[use]
    weights = 1.0 / sig2

    def linear(xc, yc, zone_index=zone, **variant):
        model = psf.render(zone_index, px, py, xc, yc, **variant)
        a = np.column_stack([model, np.ones_like(model)])
        ata = a.T @ (a * weights[:, None])
        coeffs = np.linalg.solve(ata, a.T @ (weights * data))
        resid = data - a @ coeffs
        return coeffs, float(np.sum(weights * resid ** 2)), model

    xc, yc = float(x0), float(y0)
    converged, iterations = not fit_position, 0
    if fit_position:
        for iterations in range(1, 41):
            (flux, sky), chi2, model = linear(xc, yc)
            h = 1e-3
            dmx = (psf.render(zone, px, py, xc + h, yc) - psf.render(zone, px, py, xc - h, yc)) / (2 * h)
            dmy = (psf.render(zone, px, py, xc, yc + h) - psf.render(zone, px, py, xc, yc - h)) / (2 * h)
            jac = np.column_stack([model, np.ones_like(model), flux * dmx, flux * dmy])
            resid = data - (flux * model + sky)
            jtj = jac.T @ (jac * weights[:, None])
            step = np.linalg.lstsq(jtj, jac.T @ (weights * resid), rcond=None)[0]
            dx, dy = float(np.clip(step[2], -0.5, 0.5)), float(np.clip(step[3], -0.5, 0.5))
            xc, yc = xc + dx, yc + dy
            if math.hypot(xc - x0, yc - y0) > 1.5:          # wandered off: refuse, use forced
                xc, yc, fit_position = float(x0), float(y0), False
                break
            if math.hypot(dx, dy) < 1e-4:
                converged = True
                break
    (flux, sky), chi2, model = linear(xc, yc)
    params = 4 if fit_position else 2
    dof = max(int(use.sum()) - params, 1)
    if fit_position:
        h = 1e-3
        dmx = (psf.render(zone, px, py, xc + h, yc) - psf.render(zone, px, py, xc - h, yc)) / (2 * h)
        dmy = (psf.render(zone, px, py, xc, yc + h) - psf.render(zone, px, py, xc, yc - h)) / (2 * h)
        jac = np.column_stack([model, np.ones_like(model), flux * dmx, flux * dmy])
    else:
        jac = np.column_stack([model, np.ones_like(model)])
    cov = np.linalg.inv(jac.T @ (jac * weights[:, None]))
    chi2_red = chi2 / dof
    inflate = math.sqrt(chi2_red) if chi2_red > 1 else 1.0     # model/noise mismatch: widen errors
    cov_used = cov * inflate ** 2

    omega = spec.solid_angle_sr(xc, yc)
    to_mjy = omega * 1e9
    result = Measured(flux * to_mjy, "mJy", label="PSF-fit flux" + ("" if fit_position else " (forced position)"))
    result.add("pixel noise (fit covariance)", math.sqrt(cov_used[0, 0]) * to_mjy, STATISTICAL,
               note=f"includes x{inflate:.2f} for chi2_red={chi2_red:.2f}" if inflate > 1 else "")
    # PSF model error: refit with the neighbouring zones' ePSFs at the same position
    alt = [linear(xc, yc, zone_index=z)[0][0] for z in psf.neighbours(xd, yd, 4)]
    if len(alt) > 1:
        result.add("PSF model (zone-to-zone)", float(np.std(alt, ddof=1)) * to_mjy, SYSTEMATIC)
    if not fit_position:
        sig = position_sigma_px if position_sigma_px is not None else (
            o["position_sigma_arcsec"] / (math.sqrt(omega) / units.ARCSEC_TO_RAD))
        shifted = [linear(xc + dx, yc + dy)[0][0] for dx, dy in ((sig, 0), (-sig, 0), (0, sig), (0, -sig))]
        result.add("forced position uncertainty", float(np.sqrt(np.mean((np.array(shifted) - flux) ** 2))) * to_mjy,
                   STATISTICAL)
    result.add(f"absolute calibration D{spec.detector}", abs(result.value) * o["abs_cal_fraction"], SYSTEMATIC,
               shared=True, note=f"{100 * o['abs_cal_fraction']:.1f} % (adjustable)")
    result.add("exposure-to-exposure calibration", abs(result.value) * o["relative_cal_fraction"], SYSTEMATIC,
               note=f"{100 * o['relative_cal_fraction']:.1f} %, independent per exposure")

    out = {"method": "psf", "flux": result, "x": xc, "y": yc, "fit_position": bool(fit_position),
           "converged": bool(converged), "iterations": iterations, "chi2_red": chi2_red, "dof": dof,
           "n_pixels": int(use.sum()), "background_mjy_sr": float(sky), "psf": getattr(psf, "source", ""),
           "pixel_solid_angle_sr": omega, "quality": []}
    if fit_position:
        out["x_sigma"] = math.sqrt(cov_used[2, 2])
        out["y_sigma"] = math.sqrt(cov_used[3, 3])
        ra, dec = spec.sky.pix2world(np.array([xc]), np.array([yc]))
        out["ra"], out["dec"] = float(np.asarray(ra)[0]), float(np.asarray(dec)[0])
    if chi2_red > 3:
        out["quality"].append(f"poor fit (chi2_red={chi2_red:.1f}): blended, extended or saturated source?")
    if spec._mask({"OVERFLOW", "NONLINEAR"})[use].any():
        out["quality"].append("saturated or non-linear pixels in the fit: flux unreliable")
    snr = flux / math.sqrt(cov_used[0, 0]) if cov_used[0, 0] > 0 else 0
    if snr > 50 and hasattr(psf, "stamps"):
        # orientation self-check: is the ePSF's x/y convention right? (bright stars only)
        variants = {"as stored": {}, "flip x": {"flip_x": True}, "flip y": {"flip_y": True},
                    "transpose": {"transpose": True}}
        chis = {k: linear(xc, yc, **v)[1] for k, v in variants.items()}
        best = min(chis, key=chis.get)
        out["orientation_check"] = {k: round(v, 2) for k, v in chis.items()}
        if best != "as stored" and chis["as stored"] - chis[best] > 25:
            out["quality"].append(f"ePSF fits better '{best}' (delta chi2={chis['as stored'] - chis[best]:.0f}): "
                                  "check the PSF orientation convention")
    return out
