"""Independent checks of the Science Lab. Offline; about 30 s.

    python main.py --lab-selftest

Each check compares our code against something it did not compute itself:
an exact physical law, a synthetic image with a known answer, a published
astropy/ERFA routine (only if astropy is installed), or real data saved from
a live archive query (lab/fixtures/, fetched 15 Nov 2026).
"""

import base64
import json
import math
import struct
import time
from pathlib import Path

import numpy as np

FIX = Path(__file__).resolve().parent / "fixtures"
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f"   ({detail})" if detail else ""))


# ---------------------------------------------------------------- tiny FITS writer (no astropy)
def _card(k, v):
    if isinstance(v, bool):
        s = f"{k:<8}= {'T' if v else 'F':>20}"
    elif isinstance(v, str):
        s = f"{k:<8}= '{v:<8}'"
    elif isinstance(v, int):
        s = f"{k:<8}= {v:>20d}"
    else:
        s = f"{k:<8}= {v:>20.12E}"
    return s.ljust(80)


def _hdu(cards, data=None):
    text = "".join(_card(k, v) for k, v in cards) + "END".ljust(80)
    text += " " * (-len(text) % 2880)
    raw = text.encode("ascii")
    if data is not None:
        b = data.tobytes()
        raw += b + b"\0" * (-len(b) % 2880)
    return raw


def synthetic_mef(flux_mjy, x0, y0, psf, n=59, noise=0.05, bg=0.3, zodi=1.5, seed=0, pix_arcsec=6.15):
    """A SPHEREx-like cutout: star rendered with the real ePSF, zodi, noise, flags with names."""
    rng = np.random.default_rng(seed)
    pix = pix_arcsec / 3600.0
    omega = math.radians(pix) ** 2
    yy, xx = np.mgrid[:n, :n].astype(float)
    star = flux_mjy / 1e9 / omega * psf.render(0, xx, yy, x0, y0)
    img = (star + bg + zodi + rng.normal(0, noise, (n, n))).astype(">f4")
    wcs = [("CTYPE1", "RA---TAN"), ("CTYPE2", "DEC--TAN"), ("CRVAL1", 180.0), ("CRVAL2", 10.0),
           ("CRPIX1", (n + 1) / 2), ("CRPIX2", (n + 1) / 2), ("CD1_1", -pix), ("CD1_2", 0.0), ("CD2_1", 0.0),
           ("CD2_2", pix), ("BUNIT", "MJy/sr"), ("DETECTOR", 2), ("MJD-AVG", 61000.0), ("CRPIX1A", -990.0),
           ("CRPIX2A", -990.0), ("PSF_FWHM", 7.46)]
    ext = lambda name, arr, extra=(): _hdu([("XTENSION", "IMAGE"), ("BITPIX", -32 if arr.dtype.kind == "f" else 32),
                                            ("NAXIS", 2), ("NAXIS1", n), ("NAXIS2", n), ("PCOUNT", 0), ("GCOUNT", 1),
                                            ("EXTNAME", name)] + list(extra), arr)
    flags = [(f"MSKN{b:04d}", nm) for nm, b in (("OVERFLOW", 1), ("NONLINEAR", 15), ("SOURCE", 21), ("GHOST", 22))]
    flags += [(f"MSKM{b:04d}", 1 << b) for b in (1, 15, 21, 22)]
    return (_hdu([("SIMPLE", True), ("BITPIX", 8), ("NAXIS", 0), ("EXTEND", True), ("VERSION", "7.0.5")]) +
            ext("IMAGE", img, wcs) + ext("FLAGS", np.zeros((n, n), ">i4"), flags) +
            ext("VARIANCE", np.full((n, n), noise ** 2, ">f4")) + ext("ZODI", np.full((n, n), zodi, ">f4"))), omega


def _real_epsf():
    from lab.spectral_image import EPSF
    raw = base64.b64decode((FIX / "epsf_d2_zone220.b64").read_text().strip())
    return EPSF([1019.5], [1019.5], np.frombuffer(raw, "<f8").reshape(1, 33, 33), 5, 5, source="real D2 zone 220")


# ---------------------------------------------------------------- checks
def physics():
    from lab import units
    T = 5772.0
    lam = np.geomspace(0.05, 2000, 200000)
    nu = units.um_to_hz(lam)
    f = units.planck_nu(nu, T)
    integral = np.trapezoid(f[::-1], nu[::-1]) * math.pi
    check("Planck law integrates to Stefan-Boltzmann (pi * int B_nu = sigma T^4)",
          abs(integral / (units.SIGMA_SB * T ** 4) - 1) < 1e-3, f"ratio {integral / (units.SIGMA_SB * T ** 4):.6f}")
    check("4.74047 km/s per (mas/yr)/mas (1 au per Julian year)", abs(units.KMS_PER_AU_YR - 149597870.7 / 31557600.0) < 1e-12)
    check("F_lambda -> F_nu: AB zero point (3631 Jy) at 550 nm",
          abs(units.flambda_to_fnu_jy(3631e-26 * units.C_LIGHT / (550e-9) ** 2 * 1e-9, 550.0) - 3631) < 1e-6)


def statistics():
    from lab import stats
    check("chi2 survival function: P(chi2 > 3.841 | 1 dof) = 0.05", abs(stats.chi2_sf(3.841458820694124, 1) - 0.05) < 1e-9)
    check("chi2 survival function: P(chi2 > 18.307 | 10 dof) = 0.05", abs(stats.chi2_sf(18.307038053275146, 10) - 0.05) < 1e-9)
    check("p -> sigma: 0.0026998 two-sided = 3 sigma", abs(stats.p_to_sigma(0.0026997960632601866) - 3.0) < 1e-6)


def uncertainty():
    from lab.uncertainty import Measured, monte_carlo, propagate_linear, SYSTEMATIC
    a = Measured(10.0).add("noise", 0.3).add("cal", 0.5, SYSTEMATIC, shared=True)
    b = Measured(5.0).add("noise", 0.4).add("cal", 0.25, SYSTEMATIC, shared=True)
    r = propagate_linear(lambda x, y: x / y, {"x": a, "y": b})
    # shared fractional calibration cancels exactly in a ratio: only the noise remains
    expect = 2.0 * math.hypot(0.3 / 10, 0.4 / 5)
    check("linear propagation: shared calibration cancels in a ratio", abs(r.sigma - expect) < 1e-6 * expect,
          f"{r.sigma:.6f} vs {expect:.6f}")
    mc = monte_carlo(lambda x, y: x / y, {"x": a, "y": b}, n=40000)
    check("Monte Carlo agrees with linear propagation (small errors)", mc["ok"] and abs(mc["half_width_68"] / expect - 1) < 0.03,
          f"MC {mc['half_width_68']:.4f}")


def photometry_pulls():
    from lab import photometry
    from lab.spectral_image import SpectralImage
    psf = _real_epsf()
    for flux, trials in ((20.0, 60), (2.0, 60)):
        za, zp = [], []
        for s in range(trials):
            rng = np.random.default_rng(int(1000 * flux) + s)
            x0, y0 = 29 + rng.uniform(-0.5, 0.5), 29 + rng.uniform(-0.5, 0.5)
            body, _ = synthetic_mef(flux, x0, y0, psf, seed=int(1000 * flux) + s)
            spec = SpectralImage(body, psf=psf)
            opts = {"abs_cal_fraction": 0.0, "relative_cal_fraction": 0.0}
            a = photometry.aperture(spec, x0, y0, opts=opts, position_sigma_px=1e-6)
            p = photometry.psf_fit(spec, x0, y0, opts=opts, fit_position=False, position_sigma_px=1e-6)
            za.append((a["flux"].value - flux) / a["flux"].sigma)
            zp.append((p["flux"].value - flux) / p["flux"].sigma)
        for name, z in (("aperture", za), ("PSF (forced)", zp)):
            z = np.array(z)
            ok = abs(z.mean()) < 4 / math.sqrt(len(z)) and 0.75 < z.std() < 1.3
            check(f"{name} photometry unbiased with honest errors at {flux} mJy", ok,
                  f"pull mean {z.mean():+.2f}, std {z.std():.2f}, n {len(z)}")


def sed_recovery():
    from lab import sed, units
    from lab.uncertainty import Measured, SYSTEMATIC
    rng = np.random.default_rng(3)
    lam = np.array(sed.SPHEREX_CHANNELS_UM)[::3]
    omega = math.pi * (units.R_SUN_M * 0.3 / (10 * units.PC_M)) ** 2
    true = units.blackbody_fnu_jy(lam, 3000.0, omega) * 1000
    items = []
    for l, f in zip(lam, true):
        s = 0.02 * f
        m = Measured(f + rng.normal(0, s), "mJy").add("noise", s).add("abs cal", 0.01 * f, SYSTEMATIC, shared=True)
        items.append({"lam": float(l), "flux": m})
    r = sed.analyse(items, binned=False, distance_pc=10.0, distance_sigma_pc=0.01)
    bb = next(f for f in r["fits"] if f["model"] == "blackbody")
    check("SED: blackbody fit recovers T = 3000 K", abs(bb["T_K"] - 3000) < 3 * max(1.0, (bb["T_hi"] - bb["T_lo"]) / 2),
          f"T = {bb['T_K']:.0f} [{bb['T_lo']:.0f}, {bb['T_hi']:.0f}] K")
    R = r["physical"]["radius_Rsun_p16_p50_p84"]
    check("SED: radius from Omega and distance (0.30 Rsun)", R[0] - 0.02 < 0.30 < R[2] + 0.02, f"{R[1]:.3f} Rsun")


def variability_checks():
    from lab import variability
    rng = np.random.default_rng(5)
    t = np.sort(rng.uniform(0, 300, 120))
    y = 1 + 0.05 * np.sin(2 * np.pi * t / 17.3) + rng.normal(0, 0.01, len(t))
    dy = np.full(len(t), 0.01)
    r = variability.analyse(t, np.full(len(t), 2.0), y, dy, mode="none")
    best = r["periodogram"]["best_period_days"]
    check("Lomb-Scargle recovers an injected 17.3 d period", abs(best - 17.3) < 0.2, f"{best:.2f} d, FAP {r['periodogram']['fap']:.1e}")
    try:
        from astropy.timeseries import LombScargle
        f = np.linspace(0.01, 0.5, 2000)
        ours = variability.gls(t, y, dy, f)
        ref = LombScargle(t, y, dy).power(f)
        check("GLS power equals astropy LombScargle", np.max(np.abs(ours - ref)) < 1e-9, f"max diff {np.max(np.abs(ours - ref)):.1e}")
    except ImportError:
        print("  skip GLS vs astropy (astropy not installed)")


def gaia_checks():
    from lab import gaia
    raw = json.loads((FIX / "barnard_gaia_dr3.json").read_text())
    row = gaia._clean({k: (str(v) if v is not None else None) for k, v in raw.items()})
    p = gaia.propagate(row, 2000.0)
    best, _ = gaia.identify(p["ra"] + 0.5 / 3600, p["dec"], 2000.0, [row])
    check("target identification across 16 years of 10.4\"/yr motion", best is not None)
    try:
        import astropy.units as u
        from astropy.coordinates import SkyCoord, Distance
        from astropy.time import Time
        c = SkyCoord(ra=row["ra"] * u.deg, dec=row["dec"] * u.deg, distance=Distance(parallax=row["parallax"] * u.mas),
                     pm_ra_cosdec=row["pmra"] * u.mas / u.yr, pm_dec=row["pmdec"] * u.mas / u.yr,
                     radial_velocity=row["radial_velocity"] * u.km / u.s, obstime=Time(2016.0, format="jyear", scale="tcb"))
        for ep in (1991.25, 2000.0, 2025.5):
            a = c.apply_space_motion(new_obstime=Time(ep, format="jyear", scale="tcb"))
            q = gaia.propagate(row, ep)
            d = SkyCoord(q["ra"] * u.deg, q["dec"] * u.deg).separation(SkyCoord(a.ra, a.dec)).to(u.mas).value
            check(f"rigorous propagation equals astropy/ERFA at {ep}", d < 0.1,
                  f"{d:.3f} mas; perspective term {q['perspective_effect_mas']:.0f} mas")
        g = c.galactic.velocity
        U, V, W = gaia.galactic_velocity(row["ra"], row["dec"], row["parallax"], row["pmra"], row["pmdec"], row["radial_velocity"])
        dv = max(abs(U - g.d_x.to(u.km / u.s).value), abs(V - g.d_y.to(u.km / u.s).value), abs(W - g.d_z.to(u.km / u.s).value))
        check("UVW space velocity equals astropy's Galactic transform", dv < 1e-3, f"max diff {dv:.1e} km/s")
    except ImportError:
        print("  skip propagation vs astropy (astropy not installed)")
    xp = gaia.xp_spectrum(row["source_id"], fetch_text=lambda: (FIX / "barnard_xp_gavo.txt").read_text())
    check("Gaia XP spectrum (real GAVO reply) -> 41 F_nu points", xp["ok"] and len(xp["items"]) == 41)


def cube_geometry():
    from lab import cube
    base = [(45, 41.8103149), (135, 41.8103149), (225, 41.8103149), (315, 41.8103149), (0, 0), (90, 0), (180, 0),
            (270, 0), (45, -41.8103149), (135, -41.8103149), (225, -41.8103149), (315, -41.8103149)]
    got = [cube.ang2pix_nest(1, ra, dec) for ra, dec in base]
    check("HEALPix nested index: the 12 base-pixel centres map to 0..11", got == list(range(12)), str(got))
    sub = [cube.ang2pix_nest(32, 45.0 + dx, 41.8103149 + dy) // 1024 for dx in (-1, 1) for dy in (-1, 1)]
    check("HEALPix nested index: sub-pixels stay inside their base pixel", sub == [0, 0, 0, 0], str(sub))
    hdr = {"CTYPE1": "RA---HPX", "CTYPE2": "DEC--HPX", "CRPIX1": -18943.5, "CRPIX2": -1535.5, "CRVAL1": 0.0,
           "CRVAL2": 0.0, "PC1_1": -0.00274658203125, "PC1_2": -0.00274658203125, "PC2_1": 0.00274658203125,
           "PC2_2": -0.00274658203125, "CDELT1": 1.0, "CDELT2": 1.0, "PV2_1": 4.0, "PV2_2": 3.0, "LONPOLE": 0.0,
           "NAXIS1": 512, "NAXIS2": 512, "NAXIS3": 102, "BITPIX": -32, "NPIX": 3698}
    w = cube.TileWcs(hdr)
    x, y = w.world2pix(301.5644, 44.4568)
    back = w.pix2world(x, y)
    check("HPX projection round trip on the real tile-3698 header", back is not None and
          max(abs(back[0] - 301.5644), abs(back[1] - 44.4568)) < 1e-9, f"pixel ({x:.2f}, {y:.2f})")
    check("Tabby's Star falls inside tile 3698 (verified live)", 0 <= x < 512 and 0 <= y < 512 and
          cube.ang2pix_nest(32, 301.5644, 44.4568) == 3698)


def pipeline_isolation():
    from lab.pipeline import Context, Pipeline, Skip, Stage

    def boom(ctx):
        raise RuntimeError("archive down")
    pipe = Pipeline([Stage("a", boom), Stage("b", lambda c: {"x": 1}), Stage("c", lambda c: 1, needs=("a",)),
                     Stage("d", lambda c: (_ for _ in ()).throw(Skip("nothing to do")))])
    rep = {r["name"]: r["status"] for r in pipe.run(Context(params={}))}
    check("pipeline: a failing stage is isolated; dependants skipped; others run",
          rep == {"a": "failed", "b": "ok", "c": "skipped", "d": "skipped"}, str(rep))


def run():
    print("Science Lab self-test")
    t0 = time.time()
    for f in (physics, statistics, uncertainty, photometry_pulls, sed_recovery, variability_checks, gaia_checks,
              cube_geometry, pipeline_isolation):
        try:
            f()
        except Exception as e:
            import traceback
            traceback.print_exc()
            check(f"{f.__name__} raised {type(e).__name__}: {e}", False)
    n, bad = len(RESULTS), RESULTS.count(False)
    print(f"{n - bad}/{n} checks passed in {time.time() - t0:.0f} s")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(run())
