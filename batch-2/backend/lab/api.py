"""HTTP endpoints of the Science Lab (all GET, JSON). Wired into api/server.py by ONE line.

  /api/lab/stages                       the pipeline: stage names, what each does, dependencies
  /api/lab/run?ra=&dec=&year=&pmra=&pmdec=&bands=1,2,3&max=&name=&gaia=1&cube=1&only=sed,variability
                                        starts a job -> 202 {"id": ...}
  /api/lab/jobs/<id>                    progress (stage table + log); when done also "result"
  /api/lab/jobs/<id>/cancel             stop at the next safe point
  /api/lab/download/<id>.json           the whole result (with provenance) as a file
  /api/lab/download/<id>.csv            the per-exposure photometry table as CSV
  /api/lab/gaia?ra=&dec=&year=          Gaia DR3 lookup only (fast)
  /api/lab/cube?ra=&dec=                DR1 all-sky cube spectrum only

handle(path, query) returns (status, payload) or (status, bytes, content_type, filename),
or None when the path is not a lab path (the server then carries on as before).
"""

import csv
import io
import json
import threading
import time
import uuid

from lab import LAB_VERSION, stages
from lab.pipeline import Context

JOBS, LOCK = {}, threading.Lock()
MAX_JOBS_RUNNING = 2


class BadInput(ValueError):
    pass


def _f(q, name, default=None, lo=None, hi=None):
    raw = (q.get(name) or [""])[0].strip()
    if raw == "":
        if default is None:
            raise BadInput(f"{name} is required")
        return default
    try:
        v = float(raw)
    except ValueError:
        raise BadInput(f"{name} must be a number") from None
    if v != v or (lo is not None and v < lo) or (hi is not None and v > hi):
        raise BadInput(f"{name} must be between {lo} and {hi}")
    return v


def read_params(q):
    p = dict(stages.DEFAULT_PARAMS)
    p["ra"] = _f(q, "ra", lo=0.0, hi=360.0) % 360.0
    p["dec"] = _f(q, "dec", lo=-90.0, hi=90.0)
    p["year"] = _f(q, "year", 2000.0, 1900.0, 2100.0)
    p["pmra"] = _f(q, "pmra", 0.0, -20000.0, 20000.0)
    p["pmdec"] = _f(q, "pmdec", 0.0, -20000.0, 20000.0)
    p["max_per_band"] = int(_f(q, "max", 24, 2, 120))
    p["cutout_deg"] = _f(q, "cutout", 0.1, 0.06, 0.25)
    fmax = (q.get("fmax") or [""])[0]
    p["f_max"] = _f(q, "fmax", None, 0.001, 10.0) if fmax else None
    bands = (q.get("bands") or ["1,2,3,4,5,6"])[0]
    try:
        p["bands"] = sorted({int(b) for b in bands.split(",") if b.strip()})
    except ValueError:
        raise BadInput("bands must look like 1,2,3") from None
    if not p["bands"] or not all(1 <= b <= 6 for b in p["bands"]):
        raise BadInput("bands are 1..6 (D1-D6)")
    p["use_gaia"] = (q.get("gaia") or ["1"])[0] not in ("0", "false", "no")
    p["use_cube"] = (q.get("cube") or ["1"])[0] not in ("0", "false", "no")
    p["name"] = (q.get("name") or [""])[0][:80]
    only = (q.get("only") or [""])[0]
    p["only"] = [s for s in only.split(",") if s.strip()] or None
    return p


def start(params, pipeline=None):
    pipe = pipeline or stages.build()
    job = {"id": uuid.uuid4().hex[:12], "state": "running", "started": time.time(), "params": params,
           "stages": [dict(s, status="pending") for s in pipe.describe()], "log": [], "cancel": False}
    with LOCK:
        running = sum(1 for j in JOBS.values() if j["state"] == "running")
        if running >= MAX_JOBS_RUNNING:
            raise BadInput("the lab is busy with other analyses; try again in a minute")
        for old in [k for k, v in JOBS.items() if time.time() - v["started"] > 3 * 3600]:
            del JOBS[old]
        JOBS[job["id"]] = job

    def progress(stage, text):
        for s in job["stages"]:
            if s["name"] == stage and text == "started":
                s["status"] = "running"
        job["log"].append(f"{time.strftime('%H:%M:%S')} [{stage}] {text}")
        del job["log"][:-200]

    def worker():
        ctx = Context(params=params, progress=progress, cancelled=lambda: job["cancel"])
        try:
            report = pipe.run(ctx, only=params.get("only"))
            job["stages"] = [dict(d, **{k: v for k, v in r.items() if k != "trace"})
                             for d, r in zip(pipe.describe(), report)]
            result = stages.jsonable(ctx.get("visualise") or {})
            result["stages"] = job["stages"]
            result["provenance"] = ctx.provenance
            result["lab_version"] = LAB_VERSION
            result["log"] = ctx.log_lines[-300:]
            job["result"] = result
            job["state"] = "cancelled" if any(r["status"] == "cancelled" for r in report) else "done"
        except Exception as error:
            job["state"] = "error"
            job["message"] = f"{type(error).__name__}: {error}"

    threading.Thread(target=worker, daemon=True).start()
    return job


def public(job):
    out = {k: job.get(k) for k in ("id", "state", "message", "stages")}
    out["elapsed"] = round(time.time() - job["started"], 1)
    out["log"] = job["log"][-40:]
    if job["state"] in ("done", "cancelled") and "result" in job:
        out["result"] = job["result"]
    return out


def photometry_csv(result):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["mjd", "date_utc", "band", "lambda_um", "dlambda_um", "method", "flux_mJy", "sigma_mJy",
                "sigma_stat_mJy", "sigma_sys_mJy", "aperture_mJy", "aperture_sigma_mJy", "psf_mJy", "psf_sigma_mJy",
                "psf_chi2_red", "detector", "x_det", "y_det", "pipeline", "quality", "url"])
    for r in result.get("photometry") or []:
        f, a, p = r.get("flux") or {}, r.get("aperture_flux") or {}, r.get("psf_flux") or {}
        w.writerow([r.get("mjd"), r.get("date"), r.get("band"), r.get("lam_um"), r.get("dlam_um"), r.get("method"),
                    f.get("value"), f.get("sigma"), f.get("stat"), f.get("sys"), a.get("value"), a.get("sigma"),
                    p.get("value"), p.get("sigma"), r.get("psf_chi2_red"), r.get("detector"), r.get("x_det"),
                    r.get("y_det"), r.get("pipeline"), " | ".join(r.get("quality") or []), r.get("url")])
    return buf.getvalue().encode("utf-8")


def handle(path, query):
    if not path.startswith("/api/lab/"):
        return None
    try:
        if path == "/api/lab/stages":
            return 200, {"version": LAB_VERSION, "stages": stages.build().describe(), "defaults": {
                k: v for k, v in stages.DEFAULT_PARAMS.items() if k not in ("ra", "dec")}}
        if path == "/api/lab/run":
            job = start(read_params(query))
            return 202, {"id": job["id"]}
        if path.startswith("/api/lab/jobs/"):
            parts = path.split("/")
            job = JOBS.get(parts[4] if len(parts) > 4 else "")
            if not job:
                return 404, {"error": "unknown job (the server may have restarted)"}
            if path.endswith("/cancel"):
                job["cancel"] = True
                return 200, {"ok": True}
            return 200, public(job)
        if path.startswith("/api/lab/download/"):
            name = path.rsplit("/", 1)[-1]
            jid, _, ext = name.partition(".")
            job = JOBS.get(jid)
            if not job or "result" not in job:
                return 404, {"error": "no finished analysis with that id"}
            stem = (job["params"].get("name") or "object").replace(" ", "_")[:40] or "object"
            if ext == "json":
                body = json.dumps(job["result"], indent=1).encode("utf-8")
                return 200, body, "application/json", f"orbital_lab_{stem}.json"
            if ext == "csv":
                return 200, photometry_csv(job["result"]), "text/csv", f"orbital_lab_{stem}_photometry.csv"
            return 404, {"error": "use .json or .csv"}
        if path == "/api/lab/gaia":
            from lab import gaia
            ra, dec = _f(query, "ra", lo=0, hi=360), _f(query, "dec", lo=-90, hi=90)
            res = gaia.lookup(ra, dec, input_epoch=_f(query, "year", 2000.0, 1900, 2100),
                              target_epochs=(stages.SPHEREX_EPOCH,))
            res.pop("xp", None) if not res.get("ok") else None
            if res.get("xp"):
                res["xp"] = {k: v for k, v in res["xp"].items() if k != "items"}
            return 200, stages.jsonable(res)
        if path == "/api/lab/cube":
            from lab import cube
            ra, dec = _f(query, "ra", lo=0, hi=360), _f(query, "dec", lo=-90, hi=90)
            return 200, stages.jsonable(cube.spectrum(ra, dec))
        return 404, {"error": "no such lab endpoint"}
    except BadInput as e:
        return 400, {"error": str(e)}
    except Exception as e:                                  # never let the server thread die
        return 500, {"error": f"{type(e).__name__}: {str(e)[:300]}"}
