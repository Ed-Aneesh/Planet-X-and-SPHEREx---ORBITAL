"""Context layers drawn on top of / next to the SPHEREx frames.

1. GAIA STARS (ESA, partner agency). Gaia measured where ~1.8 billion stars were on
   2016.0 and how fast each one drifts (proper motion, mas/yr). We fetch the stars in
   the patch ONCE, keep them on disk, and the browser moves each one to the date of
   every frame. A circle that sits on a dot = a known star; a dot with no circle is
   worth a second look (brown dwarfs are too cold for Gaia's visible-light camera).

2. OLDER NASA IMAGES ("mission dial"). The same patch from 2MASS (NASA/NSF, about
   1997-2001, 1.2/1.6/2.2 µm) and AllWISE (NASA, 2010-11, 3.4/4.6 µm), cut by CDS
   hips2fits onto EXACTLY our grid: north up, east left, same pixel size, same
   centre. A 16-27 year baseline turns a sub-pixel drift into an obvious jump.
   Each survey keeps its own brightness stretch: positions compare across missions,
   brightness does not (different telescopes, different filters).

Everything is cached under data/context/ (small files; commit them so a server that
wipes its disk on restart still has them). Network failures never raise to the
page: the answer carries "ok": false and a reason.
"""
import base64
import csv
import hashlib
import io
import json
import time

import numpy as np
import requests

from config import links, settings

CONTEXT_DIR = settings.BACKEND_DIR / "data" / "context"
TIMEOUT = 25            # seconds per request; the page waits for at most two services

# Which older image best matches each SPHEREx detector (by wavelength).
# hips IDs: CDS names (a wrong id returns an error, shown on the page).
TWOMASS = {"J": ("J", 1.25), "H": ("H", 1.65), "K": ("K", 2.17)}
WISE = {"W1": ("W1", 3.4), "W2": ("W2", 4.6)}
MATCH = {"D1": ("J", "W1"), "D2": ("H", "W1"), "D3": ("K", "W1"),
         "D4": ("K", "W1"), "D5": ("K", "W2"), "D6": ("K", "W2")}
# Epochs. 2MASS observed each part of the sky once, somewhere in 1997-2001: we label
# it "about 1999" and draw Gaia circles for 1999.0 (an error of up to ~2 yr, i.e.
# up to ~20″ for Barnard's Star; the page says so). AllWISE stacks Jan 2010-Feb 2011.
EPOCH_2MASS, EPOCH_WISE = 1999.0, 2010.5


def _cache(name):
    CONTEXT_DIR.mkdir(parents=True, exist_ok=True)
    return CONTEXT_DIR / name


def _key(*parts):
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


# ---------------------------------------------------------------- Gaia
def _num(row, key):
    v = (row.get(key) or "").strip()
    try:
        return float(v) if v.lower() not in ("", "null", "nan", "--") else None
    except ValueError:
        return None


def _star(row):
    pmra, pmdec = _num(row, "pmra"), _num(row, "pmdec")
    plx = _num(row, "parallax")
    return {"id": str(row.get("source_id", "")).strip(),          # text: too long for a JS number
            "ra": _num(row, "ra"), "dec": _num(row, "dec"),
            "pmra": pmra or 0.0, "pmdec": pmdec or 0.0, "hasPm": pmra is not None,
            "plx": plx, "g": _num(row, "phot_g_mean_mag"), "epoch": _num(row, "ref_epoch") or 2016.0}


def gaia(ra, dec, radius_arcmin, g_limit=19.0, top=400):
    """Gaia DR3 stars within radius_arcmin of (ra, dec). Cached per position."""
    # round the position so neighbouring requests share one cache file; fetch a bit wider
    radius = max(1.0, min(20.0, float(radius_arcmin))) * 1.45
    path = _cache(f"gaia_{_key(round(ra, 3), round(dec, 3), round(radius, 1), g_limit)}.json")
    if path.is_file():
        return json.loads(path.read_text("utf-8"))
    errors = []
    for name, url, table in links.GAIA_TAP:
        adql = (f"SELECT TOP {top} source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag, ref_epoch "
                f"FROM {table} WHERE 1=CONTAINS(POINT('ICRS', ra, dec), "
                f"CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius / 60:.6f})) "
                f"AND phot_g_mean_mag < {g_limit} ORDER BY phot_g_mean_mag")
        for attempt in range(2):
            try:
                r = requests.get(url, timeout=TIMEOUT, params={
                    "REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql})
                r.raise_for_status()
                rows = list(csv.DictReader(io.StringIO(r.text)))
                if rows and "ra" not in rows[0]:
                    raise ValueError("unexpected reply: " + r.text[:160].replace("\n", " "))
                stars = [s for s in (_star(x) for x in rows) if s["ra"] is not None and s["dec"] is not None]
                out = {"ok": True, "catalogue": "Gaia DR3", "servedBy": name, "epoch": 2016.0,
                       "radiusArcmin": round(radius, 2), "gLimit": g_limit, "stars": stars,
                       "fetched": time.strftime("%Y-%m-%d")}
                path.write_text(json.dumps(out, allow_nan=False), "utf-8")
                return out
            except Exception as error:                       # timeout, 5xx, bad table name…
                errors.append(f"{name}: {str(error)[:160]}")
                time.sleep(1.5 * (attempt + 1))
    return {"ok": False, "stars": [], "reason": "Gaia did not answer. " + " | ".join(errors[-2:])}


# ---------------------------------------------------------------- older NASA images (from IRSA)
def _year(mjd):
    return 2000.0 + (float(mjd) - 51544.5) / 365.25


def _irsa_science(collection, band, ra, dec):
    """Science images of `band` covering (ra, dec) in an IRSA SIA collection: [(url, mjd_mid)]."""
    from archive import irsa
    r = requests.get(links.SIA, params={"COLLECTION": collection, "POS": f"CIRCLE {ra:.7f} {dec:.7f} 0.0003",
                                        "MAXREC": "500"}, timeout=TIMEOUT)
    r.raise_for_status()
    out = []
    for row in irsa._votable_rows(r.content):
        if str(row.get("energy_bandpassname", "")).strip() != band:
            continue
        if str(row.get("dataproduct_subtype", "")).strip() != "science":
            continue
        url = str(row.get("access_url") or "").split("?")[0]
        if ".fits" not in url:
            continue
        try:
            t0 = float(row.get("t_min")); t1 = float(row.get("t_max") or t0)
        except (TypeError, ValueError):
            continue
        out.append((url, (t0 + t1) / 2))
    return out


def _source_world2pix(body):
    """(image, world2pix) of a FITS cutout. astropy when it loads (handles SIN and the 2MASS
    twist); otherwise our numpy TAN code (SIN and TAN differ by < 0.05″ over these fields)."""
    from archive import fitsio
    from science import compat, wcs as numpy_wcs
    hdu = fitsio.read(body)["PRIMARY"]
    image = np.asarray(hdu.image(), float)
    h = hdu.header
    W = compat._wcs()
    if W is not None:
        try:
            from astropy.io import fits as afits
            astro = W(afits.Header.fromstring(body[:hdu.start].decode("latin-1")), naxis=2)
            return image, (lambda ra, dec: astro.all_world2pix(ra, dec, 0, quiet=True))
        except Exception:
            pass
    rot = np.radians(float(h.get("CROTA2", 0.0)))
    d1, d2 = float(h.get("CDELT1", 1)), float(h.get("CDELT2", 1))
    h2 = dict(h)
    if "CD1_1" not in h2:
        h2.update(CD1_1=d1 * np.cos(rot), CD1_2=-d2 * np.sin(rot), CD2_1=d1 * np.sin(rot), CD2_2=d2 * np.cos(rot))
    sky = numpy_wcs.SkyWcs.from_header(h2)
    return image, sky.world2pix


def _onto_grid(body, ra, dec, size, sub=5):
    """Average the finer source pixels inside each 6.15″ SPHEREx-grid pixel (sub × sub samples).
    Returns the image on our grid (row 0 = south) and the covered fraction."""
    from science import wcs as numpy_wcs
    image, world2pix = _source_world2pix(body)
    step = settings.PIXEL_ARCSEC / 3600
    grid = numpy_wcs.SkyWcs((ra, dec), ((size + 1) / 2, (size + 1) / 2), [[-step, 0.0], [0.0, step]])
    offs = (np.arange(sub) + 0.5) / sub - 0.5
    yy, xx = np.mgrid[:size, :size]
    acc = np.zeros((size, size)); cnt = np.zeros((size, size))
    for dy in offs:
        for dx in offs:
            wra, wdec = grid.pix2world(xx + dx, yy + dy)
            px, py = world2pix(wra, wdec)
            col = np.rint(np.nan_to_num(px, nan=-9)).astype(int); row = np.rint(np.nan_to_num(py, nan=-9)).astype(int)
            ok = (col >= 0) & (col < image.shape[1]) & (row >= 0) & (row < image.shape[0])
            vals = np.full((size, size), np.nan)
            vals[ok] = image[row[ok], col[ok]]
            good = np.isfinite(vals)
            acc[good] += vals[good]; cnt[good] += 1
    out = np.where(cnt > 0, acc / np.maximum(cnt, 1), np.nan)
    return out, float(np.isfinite(out).mean())


def _older(collection, band, ra, dec, size):
    """Best-covered IRSA image of `band` cut out, resampled onto our grid and stretched on its own."""
    from science import stretch
    from api import render
    width = size * settings.PIXEL_ARCSEC / 3600 * 1.5 + 0.01
    best = None
    for url, mjd in _irsa_science(collection, band, ra, dec)[:4]:
        r = requests.get(f"{url}?center={ra:.6f},{dec:.6f}&size={width:.5f}&gzip=false", timeout=TIMEOUT)
        if r.status_code != 200 or r.content[:6] != b"SIMPLE":
            continue
        img, cover = _onto_grid(r.content, ra, dec, size)
        if best is None or cover > best[1]:
            best = (img, cover, mjd, url)
        if cover > 0.97:
            break
    if best is None:
        raise RuntimeError(f"IRSA has no {band} image covering this position")
    img, cover, mjd, url = best
    shade = stretch.apply(img, stretch.shared_limits([img]))
    return render.data_uri(shade), cover, mjd, url


def survey(ra, dec, size, band):
    """The 2MASS and AllWISE pictures that best match SPHEREx `band`, on our exact grid, from IRSA."""
    band = band if band in MATCH else "D2"
    size = max(8, min(400, int(size)))
    two, wise = MATCH[band]
    plan = [("2MASS " + two, links.SIA_2MASS, two, TWOMASS[two][1], "NASA/NSF 2MASS, from NASA/IPAC IRSA"),
            ("AllWISE " + wise, links.SIA_ALLWISE, wise, WISE[wise][1], "NASA WISE, from NASA/IPAC IRSA")]
    frames = []
    for label, collection, b, wave, credit in plan:
        meta = _cache(f"old_{_key(collection, b, round(ra, 6), round(dec, 6), size)}.json")
        try:
            if meta.is_file():
                frames.append(json.loads(meta.read_text("utf-8")))
                continue
            png, cover, mjd, url = _older(collection, b, ra, dec, size)
            y = _year(mjd)
            when = time.strftime("%Y-%m-%d", time.gmtime((mjd - 40587) * 86400))
            entry = {"ok": True, "label": label, "wavelength": wave, "year": round(y, 3), "when": when,
                     "credit": credit, "source": url, "coverage": round(cover, 3), "png": png}
            meta.write_text(json.dumps(entry), "utf-8")
            frames.append(entry)
        except Exception as error:
            frames.append({"ok": False, "label": label, "wavelength": wave, "credit": credit,
                           "year": EPOCH_2MASS if "2MASS" in label else EPOCH_WISE, "when": "",
                           "reason": str(error)[:200]})
    return {"ok": any(f["ok"] for f in frames), "band": band, "size": size, "frames": frames,
            "note": "Cut out by NASA/IPAC IRSA and resampled onto the SPHEREx grid. Each survey has its own brightness scale."}


def bake(results):
    """Fetch Gaia + older images for every finished result (dicts as sent to the page).
    Run once with internet:  python main.py --context   then commit data/context/."""
    done = failed = 0
    for res in results:
        c, size, band = res.get("centre") or {}, res.get("sizePixels"), (res.get("query") or {}).get("band")
        if c.get("ra") is None or not size:
            continue
        g = gaia(c["ra"], c["dec"], size * settings.PIXEL_ARCSEC / 120.0)
        s = survey(c["ra"], c["dec"], size, band)
        ok = g["ok"] and s["ok"]
        done += ok
        failed += not ok
        print(f"  {c.get('name') or 'position'} {band} {size}px: Gaia {len(g['stars'])} stars"
              f"{'' if g['ok'] else ' (FAILED: ' + g['reason'][:80] + ')'}, "
              f"images {sum(f['ok'] for f in s['frames'])}/{len(s['frames'])}")
    print(f"\n  context ready for {done} results, {failed} with a problem. Commit backend/data/context/.")
    return 0 if failed == 0 else 1


# ---------------------------------------------------------------- known asteroids (NASA/JPL)
def _sexa(deg, hours):
    """Degrees -> 'hh-mm-ss.ss' (RA) or 'dd-mm-ss.s' with 'M' for minus (Dec), as JPL wants."""
    v = deg / 15.0 if hours else abs(deg)
    h = int(v); m = int((v - h) * 60); s = (v - h - m / 60) * 3600
    text = f"{h:02d}-{m:02d}-{s:05.2f}"
    return text if hours or deg >= 0 else "M" + text


def _parse_ra(text):
    h, m, s = (float(x) for x in text.replace(":", " ").split())
    return 15 * (h + m / 60 + s / 3600)


def _parse_dec(text):
    t = text.replace("'", " ").replace('"', " ").replace(":", " ").strip()
    sign = -1 if t.startswith("-") else 1
    d, m, s = (abs(float(x)) for x in t.lstrip("+-").split()[:3])
    return sign * (d + m / 60 + s / 3600)


def asteroids(ra, dec, half_width_deg, times):
    """Known asteroids and comets in the field at each time (ISO 'YYYY-MM-DD_hh:mm:ss').
    Observer: a point on Earth's surface at 0°N 0°E (JPL refuses the geocentre). SPHEREx orbits
    ~700 km up, so for a main-belt asteroid the position error from this is ~1-4″, under one
    6.15″ pixel; for a very near-Earth object it can be larger (the page says so).
    First-pass (fast two-body) positions; RA/Dec rates let the page move each object to the
    exact time of every exposure on that day.
    VERIFIED 15 Nov 2026 against a live JPL answer: rates come as arcseconds per HOUR ("RA rate ("/h)"),
    positions as "12:00:38" / "+00 11'43\"". We convert rates to degrees per second for the page.
    VERIFIED 15 Nov 2026: the RA rate is on-sky (dRA·cos Dec), as in JPL Horizons: for 8 asteroids at Dec ≈ +35°
    two answers 2 h apart moved by the rate x 2 h only after the cos(Dec) scaling. The page divides by cos Dec."""
    hw = max(0.01, min(1.0, float(half_width_deg)))
    out = []
    # JPL throttles bursts (it answers with an HTML error page instead of JSON) and can be slow for
    # crowded fields, so: at most 4 dates spread over the list, a pause between calls, a longer timeout,
    # and up to 2 polite retries on "busy" answers. Successful answers are cached for good.
    times = list(times)
    if len(times) > 4:
        times = [times[round(k * (len(times) - 1) / 3)] for k in range(4)]
    asked = 0
    for when in times:
        path = _cache(f"sb2_{_key(round(ra, 4), round(dec, 4), round(hw, 3), when)}.json")
        if path.is_file():
            out.append(json.loads(path.read_text("utf-8")))
            continue
        params = {"lat": "0", "lon": "0", "alt": "0", "obs-time": when,
                  "fov-ra-center": _sexa(ra, True), "fov-dec-center": _sexa(dec, False),
                  "fov-ra-hwidth": f"{hw:.4f}", "fov-dec-hwidth": f"{hw:.4f}",
                  "two-pass": "false", "mag-required": "false", "vmag-lim": "22"}
        entry = {"time": when, "ok": False, "objects": []}
        try:
            r = None
            for attempt in range(3):
                if asked:
                    time.sleep(1.5 if attempt == 0 else 4 * attempt)     # be gentle with JPL
                asked += 1
                r = requests.get(links.JPL_SB_IDENT, params=params, timeout=(10, 60))
                if r.status_code in (429, 500, 502, 503, 504) or not r.text.lstrip().startswith("{"):
                    continue                                              # busy: wait and ask again
                break
            if r.status_code != 200 and not r.text.lstrip().startswith("{"):
                raise RuntimeError(f"JPL answered HTTP {r.status_code} (busy); try again in a minute")
            body = r.json()
            if r.status_code != 200 or "fields_first" not in body and "n_first_pass" not in body:
                raise RuntimeError(str(body.get("message") or body)[:200])
            fields = body.get("fields_first") or []
            col = {name: k for k, name in enumerate(fields)}
            def pick(row, *names):
                for n in names:
                    for f, k in col.items():
                        if f.lower().startswith(n):
                            return row[k]
                return None
            for row in body.get("data_first_pass") or []:
                try:
                    obj = {"name": str(row[0]).strip(), "ra": _parse_ra(row[1]), "dec": _parse_dec(row[2]),
                           "vmag": None, "raRate": None, "decRate": None}
                    v = pick(row, "visual", "v mag", "vmag")
                    obj["vmag"] = float(v) if v not in (None, "", "n.a.") else None
                    rr, dr = pick(row, "ra rate"), pick(row, "dec rate")
                    ahs = 1 / 3600 / 3600                                    # arcsec/hour -> degrees/second
                    obj["raRate"] = float(rr) * ahs if rr not in (None, "", "n.a.") else None
                    obj["decRate"] = float(dr) * ahs if dr not in (None, "", "n.a.") else None
                    er = pick(row, "est. error ra", "est error ra")
                    obj["errArcsec"] = float(er) if er not in (None, "", "n.a.") else None
                    # first pass also lists objects whose orbits are so poorly known they could be anywhere:
                    # drop anything with a position uncertainty above 10 arcminutes
                    if obj["errArcsec"] is not None and obj["errArcsec"] > 600:
                        continue
                    out_obj = obj
                except (ValueError, IndexError):
                    continue
                entry["objects"].append(out_obj)
            entry.update(ok=True, fields=fields)
            path.write_text(json.dumps(entry), "utf-8")
        except Exception as error:
            entry["reason"] = str(error)[:200]
        out.append(entry)
    return {"ok": any(e["ok"] for e in out), "results": out, "observer": "Earth surface, 0°N 0°E (approximation for SPHEREx)",
            "source": "NASA/JPL Small-Body Identification API", "rateUnit": "deg/s"}
