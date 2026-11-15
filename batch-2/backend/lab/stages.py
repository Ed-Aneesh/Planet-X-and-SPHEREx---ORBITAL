"""The concrete science stages, wired into one pipeline.

Each stage is a plain function f(ctx) -> dict. Read top to bottom it is the whole
analysis of one object:

  gaia         who is it? where is it at every exposure date? how far away?
  retrieve     which SPHEREx exposures cover it; download small cutouts (+ the ePSF once
               per detector and pipeline version)
  calibrate    turn each file into physical, masked data: IMAGE - ZODI (zodiacal light
               model removed), bad pixels masked BY FLAG NAME, pixel solid angle, wavelength
  measure      aperture AND ePSF photometry at the predicted position of every exposure
  uncertainty  error budgets: what dominates, aperture-vs-PSF consistency, astrometry check
  cube         the DR1 all-sky spectral cube at the same position (independent cross-check)
  sed          spectral energy distribution fits (SPHEREx + Gaia XP)
  variability  light curve, Lomb-Scargle periodogram, false-alarm probabilities
  visualise    one JSON document with everything the web page draws, plus provenance
"""

import math
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from lab import gaia, photometry, sed, units, variability
from lab import cube as cube_mod
from lab.pipeline import Pipeline, Skip, Stage
from lab.spectral_image import EPSF, SpectralImage
from lab import fitsx
from lab.uncertainty import Measured

SPHEREX_WCS_SIGMA_ARCSEC = 0.4   # our PSF positions matched Gaia to 0.06 px (0.37")
                                 # on 16 Tabby's Star exposures; not an official accuracy
SPHEREX_EPOCH = 2025.8           # middle of the DR1 survey year, for searches and the cube
EDGE_MARGIN_PX = 11              # the background annulus reaches 10 px: need this much image around

DEFAULT_PARAMS = {"name": "", "ra": None, "dec": None, "year": 2000.0, "pmra": 0.0, "pmdec": 0.0,
                  "bands": [1, 2, 3, 4, 5, 6], "max_per_band": 24, "cutout_deg": 0.1,
                  "use_gaia": True, "use_cube": True, "f_max": None}


# ---------------------------------------------------------------- helpers
def _position_function(ctx):
    """t (Julian year) -> (ra, dec, sigma_arcsec, source). Gaia if matched, else the user's motion."""
    p = ctx.params
    g = ctx.get("gaia")
    if g and g.get("ok"):
        row = g["source"]

        def at(year):
            pr = gaia.propagate(row, year, n_mc=600)
            return pr["ra"], pr["dec"], math.hypot(pr.get("sigma_pos_arcsec") or 0.0, SPHEREX_WCS_SIGMA_ARCSEC), "Gaia DR3"
        return at
    ra0, dec0, y0 = float(p["ra"]), float(p["dec"]), float(p["year"])
    pmra, pmdec = float(p.get("pmra") or 0.0), float(p.get("pmdec") or 0.0)
    cosd = math.cos(math.radians(dec0))

    def at(year):
        dt = year - y0
        return ((ra0 + pmra * dt / 3.6e6 / max(cosd, 1e-6)) % 360.0, dec0 + pmdec * dt / 3.6e6,
                math.hypot(1.0, SPHEREX_WCS_SIGMA_ARCSEC), "input coordinates + input motion")
    return at


def _independent_sigma(m):
    """Error that is NOT common to all exposures (what time variability has to beat)."""
    return math.sqrt(sum(t.sigma ** 2 for t in m.terms if not t.shared))


def jsonable(x):
    """Python/numpy objects (Measured included) -> plain JSON values; NaN/inf -> None."""
    if isinstance(x, Measured):
        return x.to_json()
    if isinstance(x, dict):
        return {str(k): jsonable(v) for k, v in x.items() if not callable(v)}
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    if isinstance(x, np.ndarray):
        return [jsonable(v) for v in x.tolist()]
    if isinstance(x, (np.bool_, bool)):
        return bool(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        x = float(x)
        return x if math.isfinite(x) else None
    return x


# ---------------------------------------------------------------- stage: gaia
def stage_gaia(ctx):
    p = ctx.params
    if not p.get("use_gaia", True):
        raise Skip("switched off")
    ctx.log("gaia", "querying Gaia DR3 (ESA, then IRSA)")
    res = gaia.lookup(float(p["ra"]), float(p["dec"]), input_epoch=float(p["year"]),
                      target_epochs=(SPHEREX_EPOCH,))
    if not res.get("ok"):
        ctx.results["gaia"] = res
        raise Skip(res.get("reason", "no Gaia match") + (" (" + "; ".join(res.get("errors", [])[-2:]) + ")"
                                                          if res.get("errors") else ""))
    ctx.cite("gaia", "catalogue", "Gaia DR3 (Gaia Collaboration, Vallenari et al. 2023)", res.get("served_by", ""))
    if res.get("xp", {}).get("ok"):
        ctx.cite("gaia", "spectrum", res["xp"]["source"])
    ctx.log("gaia", f"{res['designation']} matched {res['match_sep_arcsec']:.2f}\" from the input")
    return res


# ---------------------------------------------------------------- stage: retrieve
_epsf_lock = threading.Lock()
_epsf_memory = {}


def _epsf_dir():
    from config import settings
    d = settings.CACHE_DIR / "lab" / "epsf"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _epsf_for(key, url, full_body=None):
    """The ePSF of one detector + pipeline version (identical for all its exposures:
    verified on DR1 and QR3 files). Memory -> disk -> one full download."""
    from archive import fitsio, irsa
    name = f"{key[0]}_D{key[1]}".replace("/", "_")
    with _epsf_lock:
        if name in _epsf_memory:
            return _epsf_memory[name], ""
    path = _epsf_dir() / f"{name}.fits"
    raw = path.read_bytes() if path.is_file() else None
    if raw is None:
        body = full_body
        if body is None or b"EPSF" not in body:
            body, reason, _ = irsa._with_retries(irsa._get_full, url)
            if body is None:
                return None, f"ePSF download failed ({reason})"
        spans = fitsio.spans(body)
        if "EPSF" not in spans:
            return None, "file has no EPSF layer (older pipeline): a Gaussian of the header FWHM is used"
        raw = body[slice(*spans["EPSF"])]
        try:
            path.write_bytes(raw)
        except OSError:
            pass
    hdu = fitsx.hdus(raw)[0]
    psf = EPSF.from_table(fitsx.table(hdu), hdu.header)
    with _epsf_lock:
        _epsf_memory[name] = psf
    return psf, ""


def stage_retrieve(ctx):
    from archive import irsa
    from config import links
    p = ctx.params
    at = _position_function(ctx)
    ra_s, dec_s, _, src = at(SPHEREX_EPOCH)
    ctx.log("retrieve", f"searching IRSA at ({ra_s:.5f}, {dec_s:+.5f}) [{src}]")
    plan, releases = [], set()
    for band in p["bands"]:
        ctx.check()
        try:
            rows, release = irsa.search(ra_s, dec_s, band)
        except Exception as e:
            ctx.log("retrieve", f"D{band}: search failed ({str(e)[:120]})")
            continue
        if not rows:
            ctx.log("retrieve", f"D{band}: no exposures cover this position")
            continue
        n = len(rows)
        if n > p["max_per_band"]:
            k = p["max_per_band"]
            rows = [rows[round(i * (n - 1) / (k - 1))] for i in range(k)] if k > 1 else rows[:1]
        releases.add(release)
        ctx.log("retrieve", f"D{band}: {n} exposures ({release}); using {len(rows)}")
        plan += [dict(r, band=band) for r in rows]
    if not plan:
        raise RuntimeError("no SPHEREx exposure could be found for this position")
    for r in releases:
        ctx.cite("retrieve", "data release", f"SPHEREx {r} (NASA/IPAC IRSA)")

    got, lock, done = [], threading.Lock(), [0]

    def one(row):
        ctx.check()
        ra, dec, _, _ = at(units.mjd_to_year(row["mjd"]))
        url = row["url"] + links.CUTOUT_QUERY.format(ra=ra, dec=dec, size=float(p["cutout_deg"]))
        key = irsa.table_key(row["url"])
        body, reason, _ = irsa.download(url, key)
        psf, psf_reason = (None, "")
        if body is not None:
            psf, psf_reason = _epsf_for(key, url, full_body=body)
        with lock:
            done[0] += 1
            got.append({"row": row, "url": url, "body": body, "reason": reason, "psf": psf, "psf_reason": psf_reason})
            if done[0] % 4 == 0 or done[0] == len(plan):
                ctx.log("retrieve", f"{done[0]}/{len(plan)} cutouts")

    # seed one exposure per detector/version first so its ePSF is cached before the rest
    seeds, seen = [], set()
    for r in plan:
        k = irsa.table_key(r["url"])
        if k not in seen:
            seen.add(k)
            seeds.append(r)
    rest = [r for r in plan if r not in seeds]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(one, seeds))
        list(pool.map(one, rest))
    ok = [g for g in got if g["body"] is not None]
    if not ok:
        raise RuntimeError("every download failed: " + "; ".join(sorted({g["reason"] or "?" for g in got}))[:300])
    ctx.cite("retrieve", "cutouts", f"{len(ok)} SPHEREx L2 spectral-image cutouts",
             "IRSA cutout service; URLs listed in the photometry table")
    return {"exposures": sorted(ok, key=lambda g: g["row"]["mjd"]),
            "failed": [{"url": g["url"], "reason": g["reason"]} for g in got if g["body"] is None],
            "releases": sorted(releases)}


# ---------------------------------------------------------------- stage: calibrate
def stage_calibrate(ctx):
    images, dropped, notes = [], [], set()
    for g in ctx.get("retrieve")["exposures"]:
        try:
            spec = SpectralImage(g["body"], g["url"], psf=g["psf"])
        except Exception as e:
            dropped.append({"url": g["url"], "reason": f"unreadable ({type(e).__name__}: {str(e)[:100]})"})
            continue
        if spec.zodi is None:
            notes.add("Some files have no ZODI layer: zodiacal light is then removed by the local background only.")
        if g["psf_reason"]:
            notes.add(g["psf_reason"])
        notes.update(spec.notes)
        images.append({"spec": spec, "row": g["row"], "url": g["url"]})
    if not images:
        raise RuntimeError("no exposure could be read")
    ctx.log("calibrate", f"{len(images)} images: IMAGE - ZODI, flags masked by name")
    return {"images": images, "dropped": dropped, "notes": sorted(notes)}


# ---------------------------------------------------------------- stage: measure
def _choose(ap, ps):
    """Prefer PSF photometry (optimal weighting, ~1.3-2x smaller noise) unless the fit is
    doubtful; then use the aperture value."""
    if ps is None or ps.get("error"):
        return "aperture", ap["flux"]
    if not ps.get("converged", True) or (ps.get("chi2_red") or 0) > 3 or any("saturat" in q for q in ps.get("quality", [])):
        return "aperture", ap["flux"]
    return "psf", ps["flux"]


def stage_measure(ctx):
    at = _position_function(ctx)
    have_gaia = bool(ctx.get("gaia") and ctx.get("gaia").get("ok"))
    rows, skipped = [], []
    for item in ctx.get("calibrate")["images"]:
        ctx.check()
        spec, row = item["spec"], item["row"]
        mjd = spec.mjd if math.isfinite(spec.mjd) else row["mjd"]
        ra, dec, sig_arcsec, src = at(units.mjd_to_year(mjd))
        x, y = (float(v) for v in spec.to_pixel(ra, dec))
        ny, nx = spec.image.shape
        if not (EDGE_MARGIN_PX <= x <= nx - 1 - EDGE_MARGIN_PX and EDGE_MARGIN_PX <= y <= ny - 1 - EDGE_MARGIN_PX):
            skipped.append({"url": item["url"], "reason": "target too close to the cutout edge"})
            continue
        pix_arcsec = math.sqrt(spec.solid_angle_sr(x, y)) / units.ARCSEC_TO_RAD
        lam, dlam = spec.wavelength_bandwidth(x, y)
        try:
            ap = photometry.aperture(spec, x, y, position_sigma_px=sig_arcsec / pix_arcsec)
        except Exception as e:
            skipped.append({"url": item["url"], "reason": f"aperture failed: {str(e)[:100]}"})
            continue
        try:
            ps = photometry.psf_fit(spec, x, y, fit_position=not have_gaia,
                                    position_sigma_px=sig_arcsec / pix_arcsec)
        except Exception as e:
            ps = {"error": str(e)[:120]}
        method, flux = _choose(ap, ps)
        xd, yd = spec.detector_xy(x, y)
        rec = {"mjd": mjd, "year": units.mjd_to_year(mjd), "band": row["band"], "detector": spec.detector,
               "lam": float(lam), "dlam": float(dlam), "x": x, "y": y, "x_det": float(xd), "y_det": float(yd),
               "pixel_arcsec": pix_arcsec, "position_source": src, "position_sigma_arcsec": sig_arcsec,
               "aperture": ap, "psf": ps, "method": method, "flux": flux, "url": item["url"],
               "pipeline": spec.version}
        if not have_gaia and isinstance(ps, dict) and ps.get("ra") is not None:
            cosd = math.cos(math.radians(dec))
            rec["offset_arcsec"] = [((ps["ra"] - ra + 180) % 360 - 180) * cosd * 3600, (ps["dec"] - dec) * 3600]
        rows.append(rec)
    if not rows:
        raise RuntimeError("no exposure could be measured: " + "; ".join(sorted({s["reason"] for s in skipped}))[:200])
    ctx.log("measure", f"{len(rows)} exposures measured ({sum(r['method'] == 'psf' for r in rows)} with the ePSF fit)")
    return {"rows": rows, "skipped": skipped, "forced_at_gaia": have_gaia}


# ---------------------------------------------------------------- stage: uncertainty
def stage_uncertainty(ctx):
    rows = ctx.get("measure")["rows"]
    out = {}
    # 1. which terms dominate, in the median exposure
    shares = {}
    for r in rows:
        for b in r["flux"].budget():
            shares.setdefault((b["term"], b["kind"], b["shared"]), []).append(b["share_pct"] or 0.0)
    out["photometric_budget"] = sorted(
        [{"term": t, "kind": k, "shared": s, "median_share_pct": float(np.median(v)), "n": len(v)}
         for (t, k, s), v in shares.items()], key=lambda d: -d["median_share_pct"])
    rel = [r["flux"].sigma / abs(r["flux"].value) for r in rows if r["flux"].value]
    out["median_relative_error_pct"] = float(100 * np.median(rel)) if rel else None
    # 2. two independent methods on the same pixels: does aperture agree with PSF?
    pairs = [(r["aperture"]["flux"], r["psf"]["flux"]) for r in rows
             if isinstance(r.get("psf"), dict) and isinstance(r["psf"].get("flux"), Measured)
             and r["aperture"]["flux"].value > 0 and r["psf"]["flux"].value > 0]
    if len(pairs) >= 3:
        ratio = np.array([b.value / a.value for a, b in pairs])
        z = np.array([(b.value - a.value) / math.hypot(_independent_sigma(a), _independent_sigma(b)) for a, b in pairs])
        out["aperture_vs_psf"] = {"n": len(pairs), "median_ratio_psf_over_aperture": float(np.median(ratio)),
                                  "scatter_pct": float(100 * np.std(ratio)), "rms_z": float(np.sqrt(np.mean(z ** 2))),
                                  "note": "The two methods share pixels, so their errors are correlated; "
                                          "rms_z well below 1 is expected. A median ratio far from 1 means an "
                                          "aperture-correction or PSF-model problem."}
    # 3. astrometry: measured position vs prediction (only when not forced at Gaia)
    offs = np.array([r["offset_arcsec"] for r in rows if r.get("offset_arcsec")])
    if len(offs) >= 2:
        out["astrometry"] = {"n": len(offs), "mean_offset_arcsec": offs.mean(axis=0).tolist(),
                             "rms_offset_arcsec": float(np.sqrt((offs ** 2).sum(axis=1).mean())),
                             "note": "Measured ePSF centroid minus predicted position. A steady offset growing "
                                     "with time means the input proper motion is wrong (or the object moves)."}
    g = ctx.get("gaia")
    if g and g.get("ok"):
        pos = g["positions"][0] if g.get("positions") else None
        out["gaia_position_at_spherex_epoch"] = pos
        out["astrometric_budget_arcsec"] = [
            {"term": "Gaia DR3 propagated to the exposure date", "sigma": (pos or {}).get("sigma_pos_arcsec")},
            {"term": "SPHEREx WCS (measured on Tabby's Star)", "sigma": SPHEREX_WCS_SIGMA_ARCSEC}]
    out["spectral_note"] = ("Wavelength of each exposure comes from the WCS-WAVE lookup table at the source's detector "
                            "position (interpolated); its calibration is better than ~10 nm (Hui et al. 2026). For a smooth "
                            "SED that shifts the flux by < 1 %; narrow spectral features would be more sensitive.")
    return out


# ---------------------------------------------------------------- stage: cube
def stage_cube(ctx):
    p = ctx.params
    if not p.get("use_cube", True):
        raise Skip("switched off")
    ra, dec, _, src = _position_function(ctx)(SPHEREX_EPOCH)
    res = cube_mod.spectrum(ra, dec, progress=lambda t: ctx.log("cube", t))
    ctx.cite("cube", "data", "SPHEREx DR1 all-sky spectral cube (HiPS order 5), doi:10.26131/IRSA679", res.get("tile_url", ""))
    return res


# ---------------------------------------------------------------- stage: sed
def stage_sed(ctx):
    rows = ctx.get("measure")["rows"]
    items = [{"lam": r["lam"], "flux": r["flux"], "mjd": r["mjd"], "label": f"D{r['band']}", "source": "spherex"}
             for r in rows]
    extra = []
    g = ctx.get("gaia")
    dist = dsig = None
    if g and g.get("ok"):
        extra += (g.get("xp") or {}).get("items", []) if (g.get("xp") or {}).get("ok") else []
        d = g["kinematics"].get("distance_pc")
        if d is not None:
            dist, dsig = d.value, d.sigma
    c = ctx.get("cube")
    if c and c.get("ok"):
        for ch in c["channels"]:
            if ch.get("flux") is not None:
                extra.append({"lam": ch["lam_um"], "flux": ch["flux"], "label": "DR1 cube", "source": "cube", "fit": False})
    res = sed.analyse(items, distance_pc=dist, distance_sigma_pc=dsig, extra=extra)
    if c and c.get("ok"):
        res["caveats"].append("DR1 cube points are shown for comparison only (quick-look product, not fitted).")
    return res


# ---------------------------------------------------------------- stage: variability
def stage_variability(ctx):
    rows = ctx.get("measure")["rows"]
    p = ctx.params
    per_band, t_all, y_all, s_all, lam_all = {}, [], [], [], []
    for band in sorted({r["band"] for r in rows}):
        sel = [r for r in rows if r["band"] == band]
        if len(sel) < 4:
            per_band[f"D{band}"] = {"n": len(sel), "note": "fewer than 4 exposures: no analysis"}
            continue
        mjd = [r["mjd"] for r in sel]
        lam = [r["lam"] for r in sel]
        flux = [r["flux"].value for r in sel]
        sig = [_independent_sigma(r["flux"]) for r in sel]
        try:
            res = variability.analyse(mjd, lam, flux, sig, mode="sed", f_max=p.get("f_max"))
        except ValueError as e:
            per_band[f"D{band}"] = {"n": len(sel), "note": str(e)}
            continue
        per_band[f"D{band}"] = res
        keep, rel, rsig, _ = variability.colour_correct(lam, flux, sig, "sed")
        for i in np.nonzero(keep)[0]:
            t_all.append(mjd[i]); y_all.append(rel[i]); s_all.append(rsig[i]); lam_all.append(lam[i])
    out = {"per_band": per_band,
           "sigma_note": "Light-curve errors exclude the absolute-calibration term (common to all exposures); "
                         "they include the ~2 % per-exposure calibration scatter we measured."}
    if len(t_all) >= 6:
        out["combined"] = variability.analyse(t_all, lam_all, y_all, s_all, mode="none", f_max=p.get("f_max"))
    elif not per_band:
        raise Skip("no band has 4 or more exposures")
    return out


# ---------------------------------------------------------------- stage: visualise
def stage_visualise(ctx):
    p = ctx.params
    m = ctx.get("measure") or {}
    table = []
    for r in m.get("rows", []):
        ap, ps = r["aperture"], r["psf"] if isinstance(r["psf"], dict) else {}
        table.append({"mjd": r["mjd"], "date": _date(r["mjd"]), "band": r["band"], "lam_um": r["lam"],
                      "dlam_um": r["dlam"], "method": r["method"], "flux": r["flux"],
                      "aperture_flux": ap["flux"], "psf_flux": ps.get("flux"),
                      "psf_chi2_red": ps.get("chi2_red"), "quality": list(ap.get("quality", [])) + list(ps.get("quality", [])),
                      "x_det": r["x_det"], "y_det": r["y_det"], "detector": r["detector"],
                      "position_source": r["position_source"], "url": r["url"], "pipeline": r["pipeline"],
                      "offset_arcsec": r.get("offset_arcsec")})
    g = ctx.get("gaia")
    gaia_panel = None
    if g and g.get("ok"):
        k = g["kinematics"]
        gaia_panel = {"designation": g["designation"], "served_by": g.get("served_by"), "match_sep_arcsec": g["match_sep_arcsec"],
                      "source": g["source"], "kinematics": k, "stellar_parameters": g["stellar_parameters"],
                      "position_at_spherex_epoch": (g.get("positions") or [None])[0], "notes": g["notes"],
                      "xp": {kk: v for kk, v in (g.get("xp") or {}).items() if kk != "items"}}
    elif g:
        gaia_panel = {"ok": False, "reason": g.get("reason"), "errors": g.get("errors"), "nearest": g.get("nearest")}
    cal = ctx.get("calibrate") or {}
    ret = ctx.get("retrieve") or {}
    return {"target": {"name": p.get("name"), "ra": p["ra"], "dec": p["dec"], "year": p["year"],
                       "pmra": p.get("pmra"), "pmdec": p.get("pmdec")},
            "gaia": gaia_panel, "photometry": table,
            "dropped": (ret.get("failed") or []) + (cal.get("dropped") or []) + (m.get("skipped") or []),
            "calibration_notes": cal.get("notes", []), "releases": ret.get("releases", []),
            "uncertainty": ctx.get("uncertainty"), "sed": ctx.get("sed"), "variability": ctx.get("variability"),
            "cube": ctx.get("cube")}


def _date(mjd):
    import datetime
    return (datetime.datetime(1858, 11, 17) + datetime.timedelta(days=float(mjd))).strftime("%Y-%m-%d %H:%M")


# ---------------------------------------------------------------- the pipeline
def build():
    return Pipeline([
        Stage("gaia", stage_gaia, title="Gaia DR3",
              what="Identify the object; parallax, motion and XP spectrum; position at every exposure date"),
        Stage("retrieve", stage_retrieve, optional=("gaia",), title="Retrieve",
              what="Find the SPHEREx exposures (IRSA) and download cutouts; ePSF once per detector"),
        Stage("calibrate", stage_calibrate, needs=("retrieve",), title="Calibrate",
              what="Subtract the zodiacal-light model, mask bad pixels by flag name, attach wavelengths"),
        Stage("measure", stage_measure, needs=("calibrate",), optional=("gaia",), title="Measure",
              what="Aperture and ePSF-fit photometry at the predicted position"),
        Stage("uncertainty", stage_uncertainty, needs=("measure",), optional=("gaia",), title="Uncertainty",
              what="Error budgets; aperture-vs-PSF and astrometric consistency checks"),
        Stage("cube", stage_cube, optional=("gaia",), title="DR1 cube",
              what="Spectrum from the all-sky spectral cube at the same position (cross-check)"),
        Stage("sed", stage_sed, needs=("measure",), optional=("gaia", "cube"), title="SED",
              what="Blackbody, power-law and two-component fits with full covariance"),
        Stage("variability", stage_variability, needs=("measure",), title="Variability",
              what="Colour-corrected light curve, Lomb-Scargle periodogram, false-alarm probability"),
        Stage("visualise", stage_visualise, optional=("gaia", "measure", "uncertainty", "cube", "sed", "variability"),
              title="Report", what="Assemble everything the page draws, with provenance"),
    ])
