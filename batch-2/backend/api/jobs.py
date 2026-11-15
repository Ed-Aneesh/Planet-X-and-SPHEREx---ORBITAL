"""One request = one background job: search -> choose -> download -> clean -> align -> stretch -> PNGs.

Downloads take up to a minute, so the browser starts a job, gets an id at
once, and polls /api/jobs/<id> for progress. Finished results are saved in
cache/, so a target that worked once loads instantly next time, even offline
(the live demo cannot fail on venue Wi-Fi).
"""
import dataclasses
import hashlib
import json
import os
import threading
import time
import traceback
import uuid

import numpy as np
import requests

from api import fitsout, render
from archive import gdrive, irsa
from config import links, settings
from core import targets
from core.inputs import mjd_to_year
from science import features, motion, stretch

JOBS = {}
JOBS_LOCK = threading.Lock()
# IRSA code keeps module-level state, so IRSA work runs one at a time. Drive work
# is thread-safe and runs in parallel, so a slow IRSA search never blocks the vault.
IRSA_LOCK = threading.Lock()
JOB_SLOTS = threading.Semaphore(4)


# ---------------------------------------------------------------- helpers
def spread(rows, count):
    """Keep `count` rows evenly spaced in time, always the first and the last."""
    if len(rows) <= count:
        return rows
    return [rows[round(i * (len(rows) - 1) / (count - 1))] for i in range(count)]


def cache_file(query):
    key = json.dumps(query.cache_key())
    return settings.CACHE_DIR / ("r_" + hashlib.sha1(key.encode()).hexdigest()[:16] + ".json")


def _one_line(error):
    """'IRSA search failed.\n  TAP: ...\n  SIA: ...' -> one readable line with the real reasons."""
    return " · ".join(part.strip() for part in error.splitlines() if part.strip())[:600]


def _r(x, n):
    return None if x is None else round(float(x), n)


def wavelength_warnings(frames):
    waves = [f["wavelength"] for f in frames if f.get("wavelength")]
    if len(waves) < 2:
        return []
    lo, hi = min(waves), max(waves)
    mid = (lo + hi) / 2
    if (hi - lo) / mid <= settings.WAVELENGTH_WARN_FRACTION:
        return []
    return [f"Wavelength at the target ranges {lo:.3f}–{hi:.3f} µm across these frames "
            f"({100 * (hi - lo) / mid:.1f} %). SPHEREx filters change wavelength across the "
            "detector, so some brightness differences are COLOUR, not change over time. "
            "Compare frames with similar λ (shown on each frame) before claiming variability."]


# ---------------------------------------------------------------- data sources
LABEL = {"irsa": "NASA/IPAC IRSA (live)", "drive": "Google Drive copy of IRSA files"}


IRSA_DOWN_UNTIL = [0.0]          # after an IRSA failure, try Drive first for a while
IRSA_COOLDOWN_SECONDS = 300


def sources():
    """Order to try. ORBITAL_SOURCE =
         auto       Drive copy first (seconds), live IRSA for positions the copy doesn't cover
         irsa-first live IRSA first, Drive copy if IRSA fails
         drive      Drive copy only      |   irsa   live IRSA only"""
    mode = os.environ.get("ORBITAL_SOURCE", "auto").strip().lower()
    if mode == "drive":
        return ["drive"]
    if mode == "irsa" or not gdrive.configured():
        return ["irsa"]
    if mode == "irsa-first" and time.time() >= IRSA_DOWN_UNTIL[0]:
        return ["irsa", "drive"]
    return ["drive", "irsa"]


def gather(job, q, source):
    """Search -> date filter -> spread -> centre (proper motion) -> download+clean, from ONE source.
    Returns a dict; 'terminal' means a final honest answer with no frames (no coverage / no dates)."""
    if source == "irsa":
        with IRSA_LOCK:
            return _gather(job, q, source)
    return _gather(job, q, source)


def _gather(job, q, source):
    t0 = time.perf_counter()
    module = gdrive if source == "drive" else irsa
    sra, sdec = motion.search_position(q)
    job.update(state="searching", message=f"Searching {LABEL[source]} for SPHEREx exposures of this position…")
    if source == "irsa":
        def waiting(seconds):
            job.update(message=f"Still waiting for IRSA to answer the position search ({seconds:.0f} s)… "
                               "the archive is slow at the moment; we give up after "
                               f"{settings.IRSA_SEARCH_BUDGET_SECONDS} s")
        rows, release = irsa.search(sra, sdec, q.band, on_wait=waiting)
    else:
        rows, release = module.search(sra, sdec, q.band)
    credit = ("SPHEREx data: NASA/IPAC Infrared Science Archive (IRSA)"
              + (f", DOI {links.RELEASE_DOI[release]}" if release in links.RELEASE_DOI else "")
              + (" — served from the team's Google Drive copy" if source == "drive" else ""))
    base = {"query": {"ra": q.ra, "dec": q.dec, "radiusArcmin": q.radius * 60, "band": f"D{q.band}",
                      "start": q.start_text or None, "end": q.end_text or None, "target": q.target or None},
            "source": source, "release": release, "doi": links.RELEASE_DOI.get(release),
            "pixelArcsec": settings.PIXEL_ARCSEC, "orientation": "north up, east left",
            "unit": "MJy/sr", "frames": [], "warnings": list(q.notes), "credit": credit}
    out = {"source": source, "base": base, "frames": [], "dropped": []}
    if not rows:
        note = (f"SPHEREx has no released exposure of this position in D{q.band} yet "
                "(data are released weekly). Try another band or a nearby position." if source == "irsa" else
                f"The Drive copy has no D{q.band} file covering this position (it only holds the curated targets).")
        base.update(found=0, note=note)
        return {**out, "terminal": source == "irsa", "message": "No SPHEREx coverage"}

    t_search = time.perf_counter() - t0
    irsa.group_visits(rows)                                   # numbers visits on ALL rows
    picked = [r for r in rows
              if (q.start_mjd is None or r["mjd"] >= q.start_mjd)
              and (q.end_mjd is None or r["mjd"] < q.end_mjd)]
    first, last = irsa.when(rows[0]["mjd"], "%Y-%m-%d"), irsa.when(rows[-1]["mjd"], "%Y-%m-%d")
    if not picked:
        base.update(found=len(rows), note=f"No exposures in that date range. Available: {first} to {last}.")
        return {**out, "terminal": True, "message": "Nothing in the date range"}

    wanted = q.max_frames or settings.MAX_EXPOSURES
    chosen = spread(picked, wanted)
    if len(chosen) < len(picked):
        base["warnings"].append(f"{len(picked)} exposures match; showing {len(chosen)} evenly spaced in time.")
    elif len(picked) < wanted:
        # Not a cap: this is all SPHEREx has. Each ~6-month pass sees a spot a few times per detector.
        base["warnings"].append(
            f"SPHEREx has {len(picked)} D{q.band} exposure{'s' if len(picked) != 1 else ''} of this position"
            + (" in your date range" if (q.start_mjd is not None or q.end_mjd is not None) else "")
            + f" so far, so all of them are shown (you allowed up to {wanted}). "
            "More arrive with each weekly release; other detectors (Colour, All 6) add more images of the same spot.")
    cra, cdec, cyear, note = motion.centre(q, [r["mjd"] for r in chosen])
    base["warnings"].append(note)
    request = dataclasses.replace(q, ra=cra, dec=cdec)

    job.update(state="downloading", total=len(chosen), done=0, found=len(rows),
               message=f"{len(rows)} D{q.band} exposures in total ({release.upper()}, {LABEL[source]}); "
                       f"downloading {len(chosen)}"
                       + (f" (all that match; you allowed up to {wanted})" if len(chosen) < wanted else "") + "…")

    def tick():
        job["done"] = min(job.get("done", 0) + 1, job["total"])

    if source == "drive":
        frames, dropped = gdrive.fetch(chosen, request, on_progress=tick)
    else:
        original = irsa._with_retries

        def counting(fetcher, url):
            if job.get("cancel"):                     # stop starting new downloads once cancelled
                raise Cancelled()
            try:
                return original(fetcher, url)
            finally:
                tick()

        irsa._with_retries = counting
        try:
            frames, dropped = irsa.fetch(chosen, request, quiet=True)
        finally:
            irsa._with_retries = original
    return {**out, "frames": frames, "dropped": dropped, "rows": rows, "picked": picked, "chosen": chosen,
            "request": request, "cra": cra, "cdec": cdec, "cyear": cyear, "first": first, "last": last,
            "t_search": t_search, "t_download": time.perf_counter() - t0 - t_search}


# ---------------------------------------------------------------- the job
def run(job):
    q = job["query"]
    cached = cache_file(q)
    prebuilt = settings.PREBUILT_DIR / cached.name
    for ready in (prebuilt, cached):                      # prebuilt (instant) -> local cache
        if q.fresh or not ready.exists():
            continue
        try:
            result = json.loads(ready.read_text("utf-8"))
            if q.source == "irsa" and result.get("source") not in (None, "irsa"):
                continue                                  # Sky Probe = live archive only, never a saved Drive copy
            result["fromCache"] = True
            result["prebuilt"] = ready == prebuilt
            job.update(state="done", result=result,
                       message="Loaded instantly (prebuilt)" if ready == prebuilt else "Loaded from the local cache")
            return
        except (OSError, ValueError):
            pass

    with JOB_SLOTS:
        t_start = time.perf_counter()
        errors, gathered = [], None
        if q.source == "drive" and not gdrive.configured():
            raise RuntimeError("Star Vault reads the team's Google Drive copy, but Drive is not set up on this "
                               "server (DRIVE_FOLDER_ID / key path in backend/local.settings).")
        order = _order(q)                                 # Sky Probe: IRSA first, Drive copy as backup
        for n, source in enumerate(order):
            try:
                gathered = gather(job, q, source)
                if gathered["frames"] or gathered.get("terminal") or n == len(order) - 1:
                    break
                errors.append(f"{LABEL[source]}: " + ("no file covers this position"
                              if "rows" not in gathered else "none of the files could be used"))
            except (irsa.ArchiveError, gdrive.DriveError, requests.RequestException, RuntimeError) as error:
                errors.append(f"{LABEL[source]}: {str(error)[:400]}")
                if source == "irsa":
                    IRSA_DOWN_UNTIL[0] = time.time() + IRSA_COOLDOWN_SECONDS
        if gathered is None and order == ["irsa"]:
            raise RuntimeError("NASA's live archive (IRSA) did not answer: " + "; ".join(_one_line(e) for e in errors)
                               + ". Sky Probe uses only the live archive, so nothing was substituted. "
                               "Try again in a minute; for the 19 curated targets, Star Vault plays the team's saved copy instantly.")
        if gathered is None:
            hint = " Run  python main.py --check" + (" / --check-drive" if "drive" in order else "")
            raise RuntimeError("No data source worked.\n" + "\n".join(errors) + "\n" + hint)
        if errors and "rows" in gathered:
            gathered["base"]["warnings"].insert(0, f"Using {LABEL[gathered['source']]} because "
                                                + "; ".join(_one_line(e) for e in errors) + ".")
        elif errors:                                   # no source had files: say what each one said
            gathered["base"]["note"] = (gathered["base"].get("note", "") + " Also tried: "
                                        + "; ".join(_one_line(e) for e in errors))
        if errors and gathered["source"] == "drive" and "rows" not in gathered and order[0] == "irsa":
            gathered["base"]["note"] = ("The live archive (IRSA) could not be searched: "
                                        + "; ".join(_one_line(e) for e in errors)
                                        + ". The team's Drive copy only covers the 19 curated targets. "
                                        "Try again in a minute, or pick one of the targets.")
        base, frames, dropped = gathered["base"], gathered["frames"], gathered["dropped"]
        if gathered.get("terminal") or "rows" not in gathered:
            job.update(state="done", result=base, message=gathered.get("message", "No SPHEREx coverage"))
            return
        rows, picked, chosen = gathered["rows"], gathered["picked"], gathered["chosen"]
        request, cra, cdec, cyear = gathered["request"], gathered["cra"], gathered["cdec"], gathered["cyear"]
        t_search, t_download = gathered["t_search"], gathered["t_download"]
        warnings = base["warnings"]
        first, last = gathered["first"], gathered["last"]

        if not frames:
            reasons = sorted({d["reason"] for d in dropped})
            raise RuntimeError("None of the exposures could be used: " + "; ".join(reasons[:3]))

        job.update(state="rendering", message="Aligning and rendering frames with one shared brightness scale…")
        frames.sort(key=lambda f: f["mjd"])
        limits = stretch.shared_limits([f["image"] for f in frames])
        size = int(frames[0]["image"].shape[0])

        out = []
        for i, f in enumerate(frames):
            missing = float(np.mean(~np.isfinite(f["image"])))
            flagged = float(np.mean(f["flagged"]))
            out.append({
                "index": i, "mjd": _r(f["mjd"], 5), "date": irsa.when(f["mjd"]),
                "year": _r(mjd_to_year(f["mjd"]), 4), "visit": int(f["visit"]),
                "wavelength": _r(f.get("wavelength"), 4),
                "coverage": _r(f["coverage"], 3), "flagged": _r(flagged, 4), "missing": _r(missing, 4),
                "noise": _r(f["noise"], 5), "maskIgnored": bool(f.get("mask_ignored")),
                "gapDays": _r(f["mjd"] - frames[i - 1]["mjd"], 3) if i else None,
                "marker": motion.marker(request, size, cyear, f["mjd"]),
                "png": render.data_uri(stretch.apply(f["image"], limits)),
            })
            if flagged > settings.FLAGGED_WARN_FRACTION:
                warnings.append(f"Frame {i + 1}: {100 * flagged:.0f}% of pixels flagged (e.g. saturated) "
                                "and shown as missing.")
            if f.get("mask_ignored"):
                warnings.append(f"Frame {i + 1}: over half the patch was flagged, so flags were ignored; "
                                "artefacts may be visible.")
        warnings += wavelength_warnings(frames)
        for k, f in enumerate(frames):
            out[k]["url"] = f.get("url", "")

        job.update(message="Computing stacks, differences, signal-to-noise, spectrum, 3D views…")
        extra, stacks = features.build(frames, q, limits)
        for problem in extra.pop("featureErrors", []):
            warnings.append("A feature could not be computed: " + problem)
        fits_name = cached.stem + ".fits"
        try:
            fitsout.write(settings.CACHE_DIR / "fits" / fits_name, frames, stacks, (cra, cdec),
                          settings.PIXEL_ARCSEC, base["credit"], base["release"])
        except Exception as error:                 # the FITS export must never stop the images showing
            fits_name = None
            warnings.append(f"FITS export unavailable for this result ({type(error).__name__}).")

        dropped_counts = {}
        for d in dropped:
            dropped_counts[d["reason"]] = dropped_counts.get(d["reason"], 0) + 1
        if dropped:
            warnings.append(f"{len(dropped)} exposure(s) skipped: "
                            + "; ".join(f"{n}× {r}" for r, n in dropped_counts.items()))

        t = targets.TARGETS.get(q.target) if q.target else None
        base.update(
            found=len(rows), available={"first": first, "last": last},
            matched=len(picked), requested=len(chosen), used=len(frames), dropped=dropped_counts,
            source=gathered["source"],
            centre={"ra": cra, "dec": cdec, "epoch": _r(cyear, 4), "name": t["title"] if t else None},
            sizePixels=size, frames=out, features=extra, fitsName=fits_name,
            motion={"pmEast": (motion.motion_of(q) or {}).get("pm_east", 0.0),
                    "pmNorth": (motion.motion_of(q) or {}).get("pm_north", 0.0),
                    "epoch": (motion.motion_of(q) or {}).get("epoch")},
            droppedList=[{"date": irsa.when(d["mjd"]), "reason": d["reason"]} for d in dropped],
            stretch={"low": limits["low"], "high": limits["high"], "top": limits["top"],
                     "method": "ZScale limits + asinh, shared by all frames"},
        )
        total = time.perf_counter() - t_start
        t_search = min(t_search, total)
        base["timing"] = {"searchSeconds": round(t_search, 1), "downloadAndCleanSeconds": round(t_download, 1),
                          "renderSeconds": round(total - t_search - t_download, 1), "totalSeconds": round(total, 1),
                          **{k: v for k, v in irsa.LAST_STATS.items() if k != "seconds"}}
        print(f"  TIMING  search {t_search:.1f} s | download+clean {t_download:.1f} s "
              f"({irsa.LAST_STATS.get('mb', 0)} MB, {irsa.LAST_STATS.get('full_downloads', 0)} full downloads) | "
              f"render {total - t_search - t_download:.1f} s | total {total:.1f} s")
        try:
            settings.CACHE_DIR.mkdir(exist_ok=True)
            cached.write_text(json.dumps(base), "utf-8")
        except OSError:
            pass
        job.update(state="done", result=base, message=f"{len(frames)} frames ready")


def _order(q):
    if q.source == "irsa-first":
        return ["irsa", "drive"] if gdrive.configured() else ["irsa"]
    return [q.source] if q.source else sources()


COLOUR_FRAMES_PER_BAND = 8


def run_colour(job):
    """F34 infrared colour composite: fetch up to 8 exposures in each chosen band (within
    the date window the page sends), stack each band, and map them to blue/green/red.
    All bands are resampled onto the SAME grid (centre sent by the page)."""
    q, bands = job["query"], job["bands"]
    key = json.dumps(["colour", q.cache_key(), bands, repr(q.centre_override)])
    cached = settings.CACHE_DIR / ("c_" + hashlib.sha1(key.encode()).hexdigest()[:16] + ".json")
    if cached.exists():
        try:
            job.update(state="done", result=json.loads(cached.read_text("utf-8")), message="Loaded from the local cache")
            return
        except (OSError, ValueError):
            pass
    with JOB_SLOTS:
        stacks, notes = [], []
        for band in bands:
            qb = dataclasses.replace(q, band=band, max_frames=COLOUR_FRAMES_PER_BAND, notes=[])
            got = None
            for source in _order(q):
                try:
                    got = gather(job, qb, source)
                except (irsa.ArchiveError, gdrive.DriveError, requests.RequestException, RuntimeError) as error:
                    notes.append(f"D{band} from {LABEL[source]}: {_one_line(str(error))[:200]}")
                    continue
                if got["frames"]:
                    break
            if got and got["frames"]:
                s = features.stack(got["frames"], visit=0)
                stacks.append(s)
                notes.append(f"D{band}: {len(got['frames'])} exposures stacked, "
                             f"{irsa.when(min(f['mjd'] for f in got['frames']), '%Y-%m-%d')} to "
                             f"{irsa.when(max(f['mjd'] for f in got['frames']), '%Y-%m-%d')}"
                             + (f", λ ≈ {s['wavelength']:.3f} µm" if s["wavelength"] else ""))
            else:
                notes.append(f"D{band}: no usable exposures" + (f" ({got['base'].get('note')})" if got else ""))
        if len(stacks) < 2:
            job.update(state="done", result={"png": None, "notes": notes,
                                             "note": "Fewer than two bands had data, so no colour picture can be made."},
                       message="Not enough bands")
            return
        rgb, legend = features.composite(stacks)
        result = {"png": render.data_uri_rgb(rgb), "legend": legend, "notes": notes,
                  "bands": [s["band"] for s in stacks], "key": features.composite_key(stacks),
                  "caveat": "Bands were observed at different times; colours are representative "
                            "(an infrared translation, not what an eye would see)."
                            + (" SPHEREx photographs detectors 1+4, 2+5 and 3+6 together, but these pairs "
                               "at different moments, so anything that moved between them gets coloured fringes."
                               if len(stacks) > 3 else "")}
        try:
            settings.CACHE_DIR.mkdir(exist_ok=True)
            cached.write_text(json.dumps(result), "utf-8")
        except OSError:
            pass
        job.update(state="done", result=result, message="Colour picture ready")


class Cancelled(Exception):
    """The page asked to stop this job (Cancel button, refresh or closed tab)."""


class Job(dict):
    """A job dict that stops itself at the next progress update once cancel is requested."""
    def update(self, *args, **kwargs):
        if self.get("cancel") and kwargs.get("state") not in ("cancelled", "error"):
            raise Cancelled()
        super().update(*args, **kwargs)


def cancel(job_id):
    job = JOBS.get(job_id)
    if not job or job.get("state") in ("done", "error", "cancelled"):
        return False
    job["cancel"] = True
    job["message"] = "Cancelling…"
    return True


def start(query, kind="images", bands=None):
    job = Job({"id": uuid.uuid4().hex[:10], "state": "queued", "message": "Waiting for the previous search to finish…",
           "query": query, "started": time.time(), "done": 0, "total": 0, "kind": kind, "bands": bands or []})
    with JOBS_LOCK:
        for old in [k for k, v in JOBS.items() if time.time() - v["started"] > 3600]:
            del JOBS[old]
        JOBS[job["id"]] = job

    def worker():
        try:
            (run_colour if kind == "colour" else run)(job)
        except Cancelled:
            job.update(state="cancelled", message="Search cancelled; nothing was saved.")
        except Exception as error:
            job.update(state="error", message=str(error) or type(error).__name__)
            traceback.print_exc()

    threading.Thread(target=worker, daemon=True).start()
    return job


def public(job):
    out = {k: job.get(k) for k in ("id", "state", "message", "done", "total", "found")}
    out["elapsed"] = round(time.time() - job["started"], 1)
    if job["state"] == "done":
        out["result"] = job["result"]
    return out


def warm(radius_arcmin=None):
    """SPEED for demo day: fetch the challenge targets in the background so
    they load instantly (from cache/) when a judge clicks them."""
    from core import inputs
    radius = radius_arcmin or settings.RADIUS_DEFAULT_ARCMIN
    started = []
    for key, t in targets.TARGETS.items():
        if "challenge" in t["tags"]:
            q = inputs.read({"target": key, "radius": str(radius), "band": f"D{t['band']}"})
            started.append((t["title"], start(q)))
    print(f"  Warming the cache for {len(started)} challenge targets in the background…")

    def report():
        for title, job in started:
            while job["state"] not in ("done", "error"):
                time.sleep(2)
            print(f"  warm: {title:<16s} {job['state']}: {job['message']}")
    threading.Thread(target=report, daemon=True).start()


def prebuild(all_bands=False, only=None, force=False, radii=None):
    """Build Star Vault results once (Drive source, default radius, all dates) and save
    them in data/prebuilt/. Afterwards the vault answers instantly, with no Drive calls."""
    from core import inputs
    settings.PREBUILT_DIR.mkdir(parents=True, exist_ok=True)
    plan = []
    for key, t in targets.TARGETS.items():
        if only and key not in only:
            continue
        for band in (range(1, 7) if all_bands else [t["band"]]):
            for radius in (radii or settings.VAULT_RADII_ARCMIN):
                plan.append((key, t["title"], band, radius))
    print(f"  Prebuilding {len(plan)} result(s) into {settings.PREBUILT_DIR}")
    done = failed = skipped = 0
    started = time.time()
    for n, (key, title, band, radius) in enumerate(plan, 1):
        q = inputs.read({"target": key, "radius": str(radius), "band": f"D{band}", "source": "drive"})
        out = settings.PREBUILT_DIR / cache_file(q).name
        if out.exists() and not force:
            skipped += 1
            print(f"  [{n}/{len(plan)}] {title:<18s} D{band} {radius:>4}′  already built")
            continue
        job = {"id": "pre", "state": "queued", "message": "", "query": q, "started": time.time(), "done": 0, "total": 0}
        t0 = time.time()
        try:
            run(job)
        except Exception as error:
            job.update(state="error", message=str(error).splitlines()[0])
        res = job.get("result") or {}
        if job["state"] == "done" and res.get("frames"):
            res.pop("fromCache", None); res.pop("prebuilt", None)
            out.write_text(json.dumps(res), "utf-8")
            done += 1
            print(f"  [{n}/{len(plan)}] {title:<18s} D{band} {radius:>4}′  {len(res['frames'])} frames  {time.time() - t0:5.1f} s  "
                  f"{out.stat().st_size / 1024:.0f} KB")
        else:
            failed += 1
            print(f"  [{n}/{len(plan)}] {title:<18s} D{band} {radius:>4}′  no frames: {job.get('message') or res.get('note')}")
    print(f"\n  built {done}, skipped {skipped}, failed {failed} in {time.time() - started:.0f} s")
    return 0 if failed == 0 else 1
