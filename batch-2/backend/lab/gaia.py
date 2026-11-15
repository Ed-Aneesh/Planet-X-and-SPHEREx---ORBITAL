"""Gaia DR3 for one target: astrometry, kinematics, epoch propagation and XP spectrum.

PHYSICAL PICTURE
Gaia measured, for ~1.5 billion stars, five numbers at the reference epoch 2016.0:
position (RA, Dec), parallax (the yearly back-and-forth wobble caused by Earth's orbit;
distance in parsec = 1000 / parallax in mas) and proper motion (the steady drift across
the sky, mas/yr). For ~34 million stars it also measured the radial velocity (motion
along the line of sight, km/s, from the Doppler shift). The six together are the
star's full 3-D position and velocity.

To find a star in a SPHEREx exposure taken in 2025 we must move it from 2016.0 to the
exposure date. For most stars "position + proper motion x time" is enough, but nearby
fast stars (Barnard's Star: 10.4"/yr, 1.83 pc, -110 km/s) need the RIGOROUS treatment:
as the star approaches us its proper motion grows (perspective acceleration). We
propagate the full 3-D motion (ESA 1997, Hipparcos vol. 1, sec. 1.2.8; Butkevich &
Lindegren 2014), and push the 6x6 covariance through it by Monte Carlo.

SOURCES (in order; the first that answers wins)
  astrometry: ESA Gaia archive TAP -> IRSA TAP -> IRSA Gator cone search
              (IRSA Gator verified live 15 Nov 2026 with every column used here, while
               IRSA TAP returned HTTP 502 and the ESA archive was unreachable from our test box)
  XP spectra: GAVO "Gaia DR3 XP MC sampled spectra" (verified live: 41 points, 400-800 nm,
              10 nm steps, W m^-2 nm^-1, errors decorrelated by Monte Carlo resampling)
              -> ESA DataLink XP_SAMPLED (343 points, 336-1020 nm, 2 nm steps).
              The ESA product's errors are STRONGLY correlated between neighbouring samples
              (they come from ~110 basis-function coefficients), so it is returned for
              plotting only and flagged errors_correlated=True; the SED fit skips it.

REFERENCES
  Column names and units checked on a live Gator query; GAVO format checked live; propagation
  formulas tested against astropy/ERFA in the self-test. Parallax zero point -17 uas (Lindegren
  et al. 2021, A&A 649, A4, quasar median); ICRS->Galactic matrix (Gaia DR3 documentation
  sec. 4.1.7). Estimates: +/-20 uas zero-point systematic (the full L21 recipe is not applied);
  a 2 % shared XP flux-calibration term.
"""

import csv
import io
import math
import time
import zipfile

import numpy as np

from lab import units
from lab.uncertainty import Measured, STATISTICAL, SYSTEMATIC

try:
    import requests
except ImportError:                              # the backend always has requests; keep import-safe
    requests = None

TIMEOUT = 40
A_KMS = units.KMS_PER_AU_YR                      # 4.74047046 km/s per (mas/yr)/(mas)
PLX_ZERO_POINT_MAS = -0.017                      # Lindegren+2021 global (quasar) median
PLX_ZERO_POINT_SYS_MAS = 0.020                   # estimate: spread of the L21 correction
XP_CAL_FRACTION = 0.02                           # estimate: shared XP calibration term
SOLAR_MOTION_KMS = (11.1, 12.24, 7.25)           # Schoenrich, Binney & Dehnen 2010 (U, V, W) w.r.t. LSR

# ICRS -> Galactic rotation (rows = Galactic x, y, z unit vectors in ICRS); Gaia DR3 doc eq. 4.62
A_G = np.array([[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
                [+0.4941094278755837, -0.4448296299600112, +0.7469822444972189],
                [-0.8676661490190047, -0.1980763734312015, +0.4559837761750669]])

ESA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
IRSA_TAP = "https://irsa.ipac.caltech.edu/TAP/sync"
IRSA_GATOR = "https://irsa.ipac.caltech.edu/cgi-bin/Gator/nph-query"
GAVO_XP = "https://dc.zah.uni-heidelberg.de/gaia/s3/sdl/dlget"
ESA_DATALINK = "https://gea.esac.esa.int/data-server/data"          # fallback only

COLUMNS = ["source_id", "ref_epoch", "ra", "ra_error", "dec", "dec_error", "parallax", "parallax_error",
           "pmra", "pmra_error", "pmdec", "pmdec_error", "ra_dec_corr", "ra_parallax_corr", "ra_pmra_corr",
           "ra_pmdec_corr", "dec_parallax_corr", "dec_pmra_corr", "dec_pmdec_corr", "parallax_pmra_corr",
           "parallax_pmdec_corr", "pmra_pmdec_corr", "ruwe", "astrometric_params_solved",
           "nu_eff_used_in_astrometry", "pseudocolour", "ecl_lat", "phot_g_mean_mag", "phot_bp_mean_mag",
           "phot_rp_mean_mag", "phot_g_mean_flux_over_error", "bp_rp", "radial_velocity",
           "radial_velocity_error", "phot_variable_flag", "teff_gspphot", "logg_gspphot", "mh_gspphot",
           "distance_gspphot", "ag_gspphot", "has_xp_sampled", "has_xp_continuous", "non_single_star",
           "classprob_dsc_combmod_star"]
TEXT_COLUMNS = {"phot_variable_flag"}


# ---------------------------------------------------------------- parsing
def _num(v):
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s.lower() in ("null", "nan", "--", "none"):
        return None
    if s.lower() in ("true", "t"):
        return 1
    if s.lower() in ("false", "f"):
        return 0
    try:
        x = float(s)
    except ValueError:
        return s
    return int(x) if x.is_integer() and abs(x) < 2 ** 63 and "." not in s and "e" not in s.lower() else x


def _clean(row):
    out = {}
    for k in COLUMNS:
        v = row.get(k)
        out[k] = (str(v).strip() if v not in (None, "") else None) if k in TEXT_COLUMNS else _num(v)
    if out.get("source_id") is not None:
        out["source_id"] = int(str(row.get("source_id")).strip().split(".")[0])   # keep all 19 digits
    return out


def parse_ipac(text):
    """Rows of an IPAC ASCII table (Gator outfmt=1): '|'-delimited header, fixed-width data."""
    lines = text.splitlines()
    heads = [i for i, l in enumerate(lines) if l.startswith("|")]
    if not heads:
        raise ValueError("not an IPAC table: " + text[:160].replace("\n", " "))
    bars = [i for i, ch in enumerate(lines[heads[0]]) if ch == "|"]
    names = [lines[heads[0]][a + 1:b].strip() for a, b in zip(bars, bars[1:])]
    rows = []
    for l in lines[heads[-1] + 1:]:
        if not l.strip() or l.startswith("\\"):
            continue
        rows.append({n: l[a + 1:b + 1].strip() if b + 1 <= len(l) else l[a + 1:].strip()
                     for n, a, b in zip(names, bars, bars[1:])})
    return rows


# ---------------------------------------------------------------- archive access
def _cone_sources(ra, dec, radius_arcsec, g_max):
    r_deg = radius_arcsec / 3600.0
    cols = ", ".join(COLUMNS)
    cond = f" AND phot_g_mean_mag < {g_max}" if g_max else ""
    for name, url, table in (("ESA Gaia archive (TAP)", ESA_TAP, "gaiadr3.gaia_source"),
                             ("IRSA (TAP)", IRSA_TAP, "gaia_dr3_source")):
        adql = (f"SELECT TOP 500 {cols} FROM {table} WHERE 1=CONTAINS(POINT('ICRS', ra, dec), "
                f"CIRCLE('ICRS', {ra:.8f}, {dec:.8f}, {r_deg:.8f})){cond}")
        yield name, (lambda u=url, q=adql: _tap(u, q))
    constraints = f"phot_g_mean_mag<{g_max}" if g_max else ""
    yield "IRSA (Gator)", lambda: _gator(ra, dec, radius_arcsec, constraints)


def _tap(url, adql):
    r = requests.get(url, timeout=TIMEOUT, params={"REQUEST": "doQuery", "LANG": "ADQL",
                                                   "FORMAT": "csv", "QUERY": adql})
    r.raise_for_status()
    rows = list(csv.DictReader(io.StringIO(r.text)))
    if rows and "source_id" not in rows[0]:
        raise ValueError("unexpected TAP reply: " + r.text[:160].replace("\n", " "))
    return rows


def _gator(ra, dec, radius_arcsec, constraints):
    params = {"catalog": "gaia_dr3_source", "spatial": "cone", "objstr": f"{ra:.8f} {dec:+.8f}",
              "radius": f"{radius_arcsec:.3f}", "radunits": "arcsec", "outfmt": "1",
              "selcols": ",".join(COLUMNS)}
    if constraints:
        params["constraints"] = constraints
    r = requests.get(IRSA_GATOR, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    if "[struct stat=\"ERROR\"" in r.text[:400]:
        raise ValueError(r.text[:200])
    return parse_ipac(r.text)


def cone(ra, dec, radius_arcsec, g_max=None, retries=2):
    """Gaia DR3 sources within radius_arcsec of (ra, dec) [ICRS, the 2016.0 positions]."""
    if requests is None:
        return {"ok": False, "rows": [], "errors": ["python 'requests' is not installed"]}
    errors = []
    for name, call in _cone_sources(ra, dec, radius_arcsec, g_max):
        for attempt in range(retries):
            try:
                rows = [_clean(r) for r in call()]
                return {"ok": True, "rows": rows, "served_by": name, "errors": errors}
            except Exception as e:                          # timeout, 5xx, bad table name ...
                errors.append(f"{name}: {str(e)[:160]}")
                time.sleep(1.0 * (attempt + 1))
    return {"ok": False, "rows": [], "errors": errors}


# ---------------------------------------------------------------- covariance and propagation
def covariance(row):
    """6x6 covariance of (ra* [mas], dec [mas], parallax, pmra, pmdec [mas, mas/yr], v_r [km/s]).

    ra* means the RA offset multiplied by cos(dec) - a true angle on the sky. Gaia's
    ra_error is already in that form. Missing correlations (2-parameter solutions)
    become zero; a missing radial velocity gets sigma = 0 and is handled by the caller."""
    names = ["ra", "dec", "parallax", "pmra", "pmdec"]
    sig = [row.get(f"{n}_error") or 0.0 for n in names] + [row.get("radial_velocity_error") or 0.0]
    C = np.diag(np.square(np.array(sig, float)))
    for i in range(5):
        for j in range(i + 1, 5):
            rho = row.get(f"{names[i]}_{names[j]}_corr")
            if rho is not None:
                C[i, j] = C[j, i] = rho * sig[i] * sig[j]
    return C


def propagate_arrays(ra, dec, plx, pmra, pmdec, rv, tau):
    """Rigorous space-motion propagation (vectorised).

    Inputs: degrees, mas, mas/yr, km/s; tau in Julian years. Returns ra, dec (deg),
    parallax, pmra, pmdec (mas, mas/yr) and rv (km/s) at the new epoch.

    The star moves in a straight line in 3-D. In units of the initial distance its
    position is r0 + v tau, where v has a transverse part (the proper motion vector)
    and a radial part mu_r = v_r * parallax / A (the 'radial proper motion', mas/yr).
    Normalising r0 + v tau gives the new direction; the 1/|r| factor f changes the
    parallax (closer -> larger) and the proper motion (closer -> faster)."""
    a, d = np.radians(ra), np.radians(dec)
    r0 = np.stack([np.cos(d) * np.cos(a), np.cos(d) * np.sin(a), np.sin(d)])
    p = np.stack([-np.sin(a), np.cos(a), np.zeros_like(a)])
    q = np.stack([-np.sin(d) * np.cos(a), -np.sin(d) * np.sin(a), np.cos(d)])
    mas = units.MAS_TO_RAD
    pm0 = (p * pmra + q * pmdec) * mas                      # rad/yr
    mu_r = rv * plx / A_KMS * mas                          # rad/yr
    mu2 = (pmra ** 2 + pmdec ** 2) * mas ** 2
    w = 1.0 + mu_r * tau
    f2 = 1.0 / (1.0 + 2.0 * mu_r * tau + (mu2 + mu_r ** 2) * tau ** 2)
    f = np.sqrt(f2)
    u = (r0 * w + pm0 * tau) * f
    pm_vec = (pm0 * w - r0 * mu2 * tau) * f * f2
    mu_r_new = (mu_r + (mu2 + mu_r ** 2) * tau) * f2
    ra_new = np.degrees(np.arctan2(u[1], u[0])) % 360.0
    dec_new = np.degrees(np.arctan2(u[2], np.hypot(u[0], u[1])))
    a1, d1 = np.radians(ra_new), np.radians(dec_new)
    p1 = np.stack([-np.sin(a1), np.cos(a1), np.zeros_like(a1)])
    q1 = np.stack([-np.sin(d1) * np.cos(a1), -np.sin(d1) * np.sin(a1), np.cos(d1)])
    pmra_new = np.sum(p1 * pm_vec, axis=0) / mas
    pmdec_new = np.sum(q1 * pm_vec, axis=0) / mas
    plx_new = plx * f
    rv_new = np.where(plx_new != 0, mu_r_new / mas * A_KMS / np.where(plx_new != 0, plx_new, 1.0), rv)
    return ra_new, dec_new, plx_new, pmra_new, pmdec_new, rv_new


def _usable(row):
    return all(row.get(k) is not None for k in ("ra", "dec", "parallax", "pmra", "pmdec"))


def propagate(row, epoch, n_mc=4000, seed=2016):
    """Position of a Gaia source at `epoch` (Julian year) with its uncertainty ellipse."""
    t0 = float(row.get("ref_epoch") or 2016.0)
    tau = float(epoch) - t0
    if not _usable(row):
        return {"ok": False, "reason": "2-parameter Gaia solution: no parallax or proper motion; "
                                       "the 2016.0 position is used without propagation",
                "ra": row.get("ra"), "dec": row.get("dec"), "epoch": epoch}
    rv = row.get("radial_velocity")
    rv_known = rv is not None
    rv = float(rv) if rv_known else 0.0
    args = [np.array(float(row[k])) for k in ("ra", "dec", "parallax", "pmra", "pmdec")] + [np.array(rv)]
    ra1, dec1, plx1, pmra1, pmdec1, rv1 = (float(x) for x in propagate_arrays(*args, tau))
    C = covariance(row)
    if not rv_known:
        C[5, 5] = 0.0
    rng = np.random.default_rng(seed)
    try:
        dev = rng.multivariate_normal(np.zeros(6), C, size=n_mc, method="cholesky")
    except np.linalg.LinAlgError:
        dev = rng.multivariate_normal(np.zeros(6), C, size=n_mc, method="eigh")
    cosd = math.cos(math.radians(float(row["dec"])))
    ra_s = float(row["ra"]) + dev[:, 0] / 3.6e6 / cosd
    dec_s = float(row["dec"]) + dev[:, 1] / 3.6e6
    out = propagate_arrays(ra_s, dec_s, float(row["parallax"]) + dev[:, 2], float(row["pmra"]) + dev[:, 3],
                           float(row["pmdec"]) + dev[:, 4], rv + dev[:, 5], tau)
    dra = ((out[0] - ra1 + 180.0) % 360.0 - 180.0) * math.cos(math.radians(dec1)) * 3.6e6
    ddec = (out[1] - dec1) * 3.6e6
    cov = np.cov(np.vstack([dra, ddec]))
    sx, sy = math.sqrt(cov[0, 0]), math.sqrt(cov[1, 1])
    linear_ra = float(row["ra"]) + float(row["pmra"]) * tau / 3.6e6 / cosd
    linear_dec = float(row["dec"]) + float(row["pmdec"]) * tau / 3.6e6
    persp = math.hypot((linear_ra - ra1) * math.cos(math.radians(dec1)), linear_dec - dec1) * 3.6e6
    notes = []
    if not rv_known:
        notes.append("No Gaia radial velocity: v_r = 0 assumed (perspective acceleration ignored).")
    return {"ok": True, "epoch": float(epoch), "from_epoch": t0, "tau_yr": tau,
            "ra": ra1, "dec": dec1, "parallax": plx1, "pmra": pmra1, "pmdec": pmdec1, "rv": rv1 if rv_known else None,
            "sigma_ra_star_mas": sx, "sigma_dec_mas": sy,
            "corr_ra_dec": float(cov[0, 1] / (sx * sy)) if sx > 0 and sy > 0 else 0.0,
            "sigma_pos_arcsec": math.hypot(sx, sy) / 1000.0 / math.sqrt(2.0),
            "perspective_effect_mas": persp,
            "notes": notes + ([f"Perspective acceleration moves the star {persp:.1f} mas away from the "
                               "straight-line (position + proper motion x time) prediction."] if persp > 1 else [])}


# ---------------------------------------------------------------- kinematics and luminosity
def _parallax_corrected(row):
    plx = float(row["parallax"])
    m = Measured(plx - PLX_ZERO_POINT_MAS, "mas", label="parallax (zero-point corrected)")
    m.add("Gaia formal error", row.get("parallax_error") or 0.0, STATISTICAL)
    m.add("zero-point residual (L21 recipe not applied)", PLX_ZERO_POINT_SYS_MAS, SYSTEMATIC, shared=True,
          note="global -17 uas used; the true offset depends on G, colour, ecliptic latitude")
    return m


def galactic_velocity(ra, dec, plx, pmra, pmdec, rv):
    """Heliocentric (U, V, W) in km/s; U to the Galactic centre, V along rotation, W to the NGP.
    Arrays allowed. Velocity = v_r * r_hat + (A / parallax) * (pmra * p_hat + pmdec * q_hat)."""
    ra, dec, plx, pmra, pmdec, rv = np.broadcast_arrays(*(np.asarray(x, float) for x in (ra, dec, plx, pmra, pmdec, rv)))
    a, d = np.radians(ra), np.radians(dec)
    r0 = np.stack([np.cos(d) * np.cos(a), np.cos(d) * np.sin(a), np.sin(d)])
    p = np.stack([-np.sin(a), np.cos(a), np.zeros_like(a)])
    q = np.stack([-np.sin(d) * np.cos(a), -np.sin(d) * np.sin(a), np.cos(d)])
    v = rv * r0 + (A_KMS / plx) * (pmra * p + pmdec * q)
    return np.tensordot(A_G, v, axes=1)


def kinematics(row, n_mc=4000, seed=7):
    """Distance, tangential and space velocity, absolute magnitude - each as Measured."""
    out = {"notes": []}
    if not _usable(row):
        out["notes"].append("No parallax/proper motion in Gaia DR3 for this source.")
        return out
    plx = _parallax_corrected(row)
    out["parallax_corrected_mas"] = plx
    snr = plx.value / plx.sigma if plx.sigma > 0 else float("inf")
    out["parallax_over_error"] = snr
    rng = np.random.default_rng(seed)
    C = covariance(row)
    C[2, 2] += PLX_ZERO_POINT_SYS_MAS ** 2
    rv_known = row.get("radial_velocity") is not None
    if not rv_known:
        C[5, 5] = 0.0
    try:
        dev = rng.multivariate_normal(np.zeros(6), C, size=n_mc, method="cholesky")
    except np.linalg.LinAlgError:
        dev = rng.multivariate_normal(np.zeros(6), C, size=n_mc, method="eigh")
    plx_s = plx.value + dev[:, 2]
    pmra_s = float(row["pmra"]) + dev[:, 3]
    pmdec_s = float(row["pmdec"]) + dev[:, 4]
    rv_s = (float(row["radial_velocity"]) if rv_known else 0.0) + dev[:, 5]
    if snr >= 5.0:
        d = 1000.0 / plx.value
        ds = 1000.0 / plx_s
        m = Measured(d, "pc", label="distance = 1 / parallax")
        m.add("parallax (incl. zero point)", float(np.std(ds)), STATISTICAL)
        out["distance_pc"] = m
        out["distance_ly"] = Measured(d * units.PC_M / units.LY_M, "ly", label="distance").add(
            "parallax", float(np.std(ds)) * units.PC_M / units.LY_M)
        mu = math.hypot(float(row["pmra"]), float(row["pmdec"]))
        vt = A_KMS * np.hypot(pmra_s, pmdec_s) / plx_s
        out["v_tan_kms"] = Measured(A_KMS * mu / plx.value, "km/s", label="tangential velocity = 4.74 mu / parallax").add(
            "parallax + proper motion", float(np.std(vt)))
        G = row.get("phot_g_mean_mag")
        if G is not None:
            foe = row.get("phot_g_mean_flux_over_error") or 0
            MG_s = G + 5.0 * np.log10(plx_s) - 10.0
            M = Measured(G + 5.0 * math.log10(plx.value) - 10.0, "mag", label="absolute G magnitude (no extinction)")
            M.add("parallax", float(np.std(MG_s)))
            if foe:
                M.add("G photometry", 2.5 / math.log(10) / foe)
            M.add("Gaia G zero point", 0.0027, SYSTEMATIC, shared=True)
            out["abs_mag_G"] = M
        if rv_known:
            U, V, W = galactic_velocity(float(row["ra"]), float(row["dec"]), plx.value, float(row["pmra"]),
                                        float(row["pmdec"]), float(row["radial_velocity"]))
            Us, Vs, Ws = galactic_velocity(float(row["ra"]), float(row["dec"]), plx_s, pmra_s, pmdec_s, rv_s)
            for name, val, smp in (("U", U, Us), ("V", V, Vs), ("W", W, Ws)):
                out[f"{name}_kms"] = Measured(float(val), "km/s", label=f"{name} (heliocentric)").add("MC", float(np.std(smp)))
            lsr = (U + SOLAR_MOTION_KMS[0], V + SOLAR_MOTION_KMS[1], W + SOLAR_MOTION_KMS[2])
            sp = math.sqrt(sum(x * x for x in lsr))
            sps = np.sqrt((Us + SOLAR_MOTION_KMS[0]) ** 2 + (Vs + SOLAR_MOTION_KMS[1]) ** 2 + (Ws + SOLAR_MOTION_KMS[2]) ** 2)
            out["v_lsr_kms"] = Measured(sp, "km/s", label="speed relative to the local standard of rest").add("MC", float(np.std(sps)))
            out["population_hint"] = ("halo-like (v_LSR > 180 km/s)" if sp > 180 else
                                      "thick-disc-like (70 < v_LSR < 180 km/s)" if sp > 70 else "thin-disc-like")
        else:
            out["notes"].append("No radial velocity: only the tangential (sky-plane) velocity is known.")
    else:
        out["notes"].append(f"parallax / error = {snr:.1f} < 5: 1/parallax is a biased distance; not reported. "
                            "Use a prior-based distance (e.g. Bailer-Jones et al. 2021) instead.")
        if row.get("distance_gspphot"):
            out["notes"].append(f"Gaia GSP-Phot model distance: {row['distance_gspphot']:.0f} pc (model-dependent).")
    ruwe = row.get("ruwe")
    if ruwe is not None and ruwe > 1.4:
        out["notes"].append(f"RUWE = {ruwe:.2f} > 1.4: the single-star astrometric model fits poorly "
                            "(often an unresolved binary); treat parallax and proper motion with caution.")
    G = row.get("phot_g_mean_mag")
    if G is not None and G < 13:
        out["notes"].append("Bright star (G < 13): Gaia DR3 formal errors are underestimated by ~30 % "
                            "(El-Badry, Rix & Heintz 2021). Not inflated here.")
    if row.get("astrometric_params_solved") == 95:
        out["notes"].append("6-parameter solution (colour estimated by Gaia): slightly larger systematics.")
    return out


# ---------------------------------------------------------------- target identification
def identify(ra, dec, epoch, rows, max_sep_arcsec=3.0):
    """Choose the Gaia source that is at (ra, dec) at the given epoch.

    Each candidate is first moved from 2016.0 to `epoch` (the epoch of the input
    coordinates, e.g. 2000.0 for SIMBAD's J2000 positions), so a fast star whose 2016
    position is far from the input is still found."""
    cands = []
    for row in rows:
        if row.get("ra") is None:
            continue
        if _usable(row):
            rv = row.get("radial_velocity") or 0.0
            r1, d1, *_ = propagate_arrays(np.array(row["ra"]), np.array(row["dec"]), np.array(row["parallax"]),
                                          np.array(row["pmra"]), np.array(row["pmdec"]), np.array(rv),
                                          float(epoch) - float(row.get("ref_epoch") or 2016.0))
            r1, d1 = float(r1), float(d1)
        else:
            r1, d1 = row["ra"], row["dec"]
        sep = _sep_arcsec(ra, dec, r1, d1)
        cands.append((sep, row.get("phot_g_mean_mag") if row.get("phot_g_mean_mag") is not None else 99, row))
    cands.sort(key=lambda c: (c[0], c[1]))
    close = [c for c in cands if c[0] <= max_sep_arcsec]
    if not close:
        return None, cands[:5]
    # among sources inside the match radius prefer the brightest unless one is much closer
    best = min(close, key=lambda c: c[0] + 0.3 * max(0.0, c[1] - close[0][1]))
    return best, cands[:5]


def _sep_arcsec(ra1, dec1, ra2, dec2):
    a1, d1, a2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    s = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((a2 - a1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(s)))) * 3600.0


# ---------------------------------------------------------------- XP spectrum
def parse_gavo_xp(text):
    rows = []
    for line in text.splitlines():
        parts = line.replace(",", " ").split()
        if len(parts) >= 3 and not line.lstrip().startswith("#"):
            try:
                rows.append([float(x) for x in parts[:3]])
            except ValueError:
                continue
    if len(rows) < 5:
        raise ValueError("XP reply has no spectrum rows")
    return np.array(rows)


def _esa_xp(source_id):
    """ESA DataLink XP_SAMPLED (ZIP of CSV/ECSV). Fallback after GAVO."""
    r = requests.get(ESA_DATALINK, timeout=TIMEOUT, params={
        "RETRIEVAL_TYPE": "XP_SAMPLED", "ID": f"Gaia DR3 {source_id}", "DATA_STRUCTURE": "INDIVIDUAL",
        "FORMAT": "CSV", "RELEASE": "Gaia DR3"})
    r.raise_for_status()
    blob = r.content
    texts = []
    if blob[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            texts = [z.read(n).decode("utf-8", "replace") for n in z.namelist() if n.lower().endswith((".csv", ".ecsv"))]
    else:
        texts = [blob.decode("utf-8", "replace")]
    for t in texts:
        rows = list(csv.DictReader(line for line in io.StringIO(t) if not line.startswith("#")))
        if not rows:
            continue
        flux = _array(rows[0].get("flux"))
        err = _array(rows[0].get("flux_error"))
        if flux is None or len(flux) != 343:
            continue
        lam = 336.0 + 2.0 * np.arange(343)
        return np.column_stack([lam, flux, err if err is not None and len(err) == 343 else np.full(343, np.nan)])
    raise ValueError("no XP_SAMPLED table in the ESA reply")


def _array(s):
    if not s:
        return None
    try:
        return np.array([float(x) for x in str(s).strip("()[] ").split(",") if x.strip()])
    except ValueError:
        return None


def xp_spectrum(source_id, fetch_text=None):
    """Gaia DR3 BP/RP (XP) spectrum as F_nu points in mJy, ready for the SED stage."""
    errors = []
    if fetch_text is None and requests is None:
        return {"ok": False, "errors": ["python 'requests' is not installed"]}
    try:
        text = fetch_text() if fetch_text else requests.get(
            GAVO_XP, params={"ID": str(source_id), "FORMAT": "text/plain"}, timeout=TIMEOUT).text
        arr = parse_gavo_xp(text)
        src, correlated = "GAVO Gaia DR3 XP MC-sampled (400-800 nm, decorrelated errors)", False
    except Exception as e:
        errors.append(f"GAVO: {str(e)[:160]}")
        try:
            arr = _esa_xp(source_id)
            src, correlated = "ESA DataLink XP_SAMPLED (336-1020 nm; errors correlated)", True
        except Exception as e2:
            errors.append(f"ESA DataLink: {str(e2)[:160]}")
            return {"ok": False, "errors": errors}
    lam_nm, flam, eflam = arr[:, 0], arr[:, 1], arr[:, 2]
    fnu_mjy = units.flambda_to_fnu_jy(flam, lam_nm) * 1000.0
    efnu_mjy = units.flambda_to_fnu_jy(eflam, lam_nm) * 1000.0
    items = []
    for l, f, e in zip(lam_nm, fnu_mjy, efnu_mjy):
        if not (np.isfinite(f) and np.isfinite(e) and e > 0):
            continue
        m = Measured(float(f), "mJy", label=f"Gaia XP {l:.0f} nm")
        m.add("XP sampling noise", float(e), STATISTICAL)
        m.add("Gaia XP absolute calibration", abs(float(f)) * XP_CAL_FRACTION, SYSTEMATIC, shared=True,
              note="2 % common to all XP points")
        items.append({"lam": float(l) / 1000.0, "flux": m, "label": "Gaia XP", "source": "gaia_xp",
                      "fit": not correlated})
    return {"ok": True, "source": src, "errors_correlated": correlated, "errors": errors,
            "lam_nm": lam_nm.tolist(), "flambda_W_m2_nm": flam.tolist(), "sigma_flambda": eflam.tolist(),
            "fnu_mJy": fnu_mjy.tolist(), "sigma_fnu_mJy": efnu_mjy.tolist(), "items": items}


# ---------------------------------------------------------------- one-call summary
def lookup(ra, dec, input_epoch=2000.0, target_epochs=(), radius_arcsec=None, with_xp=True, cone_result=None):
    """Everything Gaia knows about the object at (ra, dec, input_epoch)."""
    radius = radius_arcsec or 30.0
    res = cone_result or cone(ra, dec, radius)
    if res["ok"] and not res["rows"] and cone_result is None and radius < 400:
        # a nearby fast star may be > 30" from its 2016 position: widen, bright stars only
        res = cone(ra, dec, 400.0, g_max=17)
    if not res["ok"]:
        return {"ok": False, "reason": "Gaia did not answer", "errors": res["errors"]}
    best, near = identify(ra, dec, input_epoch, res["rows"])
    if best is None and cone_result is None and radius < 400:
        wide = cone(ra, dec, 400.0, g_max=17)
        if wide["ok"]:
            best, near = identify(ra, dec, input_epoch, wide["rows"])
            res = wide
    if best is None:
        return {"ok": False, "reason": f"no Gaia DR3 source within 3\" of the input at epoch {input_epoch}",
                "nearest": [{"source_id": c[2]["source_id"], "sep_arcsec": c[0], "G": c[1]} for c in near],
                "served_by": res.get("served_by")}
    sep, _, row = best
    out = {"ok": True, "served_by": res.get("served_by"), "source": row, "match_sep_arcsec": sep,
           "input_epoch": input_epoch, "designation": f"Gaia DR3 {row['source_id']}",
           "kinematics": kinematics(row),
           "positions": [propagate(row, e) for e in target_epochs],
           "stellar_parameters": {k: row.get(k) for k in ("teff_gspphot", "logg_gspphot", "mh_gspphot",
                                                           "distance_gspphot", "ag_gspphot")},
           "notes": ["GSP-Phot parameters come from fitting the low-resolution XP spectrum with stellar "
                     "models; for cool M dwarfs their metallicity is known to be biased low.",
                     f"Parallax zero point: {PLX_ZERO_POINT_MAS * 1000:.0f} uas global value (Lindegren et al. 2021)."]}
    others = [c for c in near if c[2] is not row and c[0] < 10.0]
    if others:
        out["notes"].append(f"{len(others)} other Gaia source(s) within 10\" - check the photometry aperture.")
    if with_xp and row.get("has_xp_sampled"):
        out["xp"] = xp_spectrum(row["source_id"])
    elif with_xp:
        out["xp"] = {"ok": False, "errors": ["Gaia DR3 published no XP spectrum for this source (G > 17.65 or not selected)"]}
    return out
