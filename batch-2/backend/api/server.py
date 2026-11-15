"""HTTP server: serves the website AND the JSON API from one address.

Endpoints (all GET, all JSON):
  /api/health                 is the server up? which libraries are in use?
  /api/settings               limits and choices for the form (bands, radius, FPS)
  /api/targets                named targets with proper motions
  /api/links                  every external address the backend uses
  /api/search?ra=&dec=&radius=&band=&start=&end=&target=
                              starts a job, answers 202 {"id": ...} at once
                              radius in arcmin, band D1–D6, dates YYYY-MM-DD (both empty = all)
  /api/jobs/<id>              progress; when state == "done" also "result"
  /api/colour?<same as search>&bands=1,3,5&cra=&cdec=&cyear=
                              infrared colour composite job (2-6 bands on the same grid)
  /api/fits/<name>.fits       the aligned frames + visit stacks as a FITS file (binary)
  /api/gaia?ra=&dec=&radius=  Gaia DR3 stars in the patch (radius in arcmin), cached on disk
  /api/asteroids?ra=&dec=&hw=&times=YYYY-MM-DD_hh:mm:ss,...
                              known asteroids/comets in the field (NASA/JPL), cached
  /api/lab/...                Science Lab: photometry, SED, variability, Gaia, DR1 cube (see lab/api.py)
  /api/survey?ra=&dec=&size=&band=
                              2MASS + AllWISE pictures of the patch on the SPHEREx grid (cached)

Uses only the Python standard library (no Flask/FastAPI), matching the team's
web_server.py, so nothing extra has to be installed or unblocked on Windows.
"""
import json
import mimetypes
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from api import jobs
from config import links, settings
from core import inputs, targets
from science import compat


def settings_payload():
    return {
        "bands": [{"id": f"D{k}", "min": v[0], "max": v[1], "R": {1: 41, 2: 41, 3: 41, 4: 35, 5: 110, 6: 130}[k]}
                  for k, v in settings.BANDS.items()],
        "radiusArcmin": {"min": settings.RADIUS_MIN_ARCMIN, "max": settings.RADIUS_MAX_ARCMIN,
                         "default": settings.RADIUS_DEFAULT_ARCMIN},
        "vaultRadiiArcmin": settings.VAULT_RADII_ARCMIN,
        "fps": settings.FPS_CHOICES, "maxExposures": settings.MAX_EXPOSURES,
        "exposureChoices": settings.EXPOSURE_CHOICES, "maxExposuresAll": settings.MAX_EXPOSURES_ALL,
        "pixelArcsec": settings.PIXEL_ARCSEC, "wavelengthWarnFraction": settings.WAVELENGTH_WARN_FRACTION,
    }


class Handler(SimpleHTTPRequestHandler):
    site = settings.FRONTEND_DIR

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(self.site), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")     # page may be opened from another port
        # the shipped Aladin library (2.4 MB) never changes: let browsers keep it a day
        self.send_header("Cache-Control", "public, max-age=86400" if "/vendor/" in self.path else "no-store")
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_lab(self, path, query):
        from lab import api as lab_api
        reply = lab_api.handle(path, query)
        if len(reply) == 2:
            return self.send_json(reply[1], reply[0])
        status, body, ctype, filename = reply
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        """Only one POST: cancel a search. Browsers send it with navigator.sendBeacon while a page
        is being refreshed or closed (a normal request may not survive the page going away)."""
        path = urlparse(self.path).path
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if path.startswith("/api/jobs/") and path.endswith("/cancel"):
            return self.send_json({"ok": jobs.cancel(path.split("/")[3])})
        return self.send_json({"error": "not found"}, 404)

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        if path == "/api/health":
            from archive import gdrive
            return self.send_json({"ok": True, "version": 2, "libraries": compat.ROUTES,
                                   "sources": jobs.sources(), "driveConfigured": gdrive.configured(),
                                   "targets": len(targets.TARGETS)})
        if path == "/api/settings":
            return self.send_json(settings_payload())
        if path == "/api/targets":
            return self.send_json(targets.public())
        if path == "/api/links":
            return self.send_json(links.public())
        if path == "/api/search":
            try:
                query = inputs.read(parse_qs(url.query))
            except inputs.InputError as error:
                return self.send_json({"error": str(error)}, 400)
            job = jobs.start(query)
            return self.send_json({"id": job["id"]}, 202)
        if path == "/api/colour":
            params = parse_qs(url.query)
            try:
                query = inputs.read(params)
                bands = sorted({int(b) for b in (params.get("bands", [""])[0]).split(",") if b.strip()})
                if not 2 <= len(bands) <= 6 or not all(1 <= b <= 6 for b in bands):
                    raise inputs.InputError("choose 2 to 6 different bands from D1–D6")
                if params.get("cra") and params.get("cdec"):
                    year = params.get("cyear", [""])[0]
                    query.centre_override = (float(params["cra"][0]), float(params["cdec"][0]),
                                             float(year) if year else None)
            except (inputs.InputError, ValueError) as error:
                return self.send_json({"error": str(error)}, 400)
            job = jobs.start(query, kind="colour", bands=bands)
            return self.send_json({"id": job["id"]}, 202)
        if path == "/api/asteroids":
            from api import context
            p = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                times = [t for t in p.get("times", "").split(",") if re.fullmatch(r"\d{4}-\d\d-\d\d_\d\d:\d\d:\d\d", t)]
                if not times:
                    raise ValueError
                return self.send_json(context.asteroids(float(p["ra"]), float(p["dec"]), float(p.get("hw", 0.05)), times))
            except (KeyError, ValueError):
                return self.send_json({"error": "need ra, dec (degrees), hw (degrees) and times=YYYY-MM-DD_hh:mm:ss,..."}, 400)
        if path in ("/api/gaia", "/api/survey"):
            from api import context
            p = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                ra, dec = float(p["ra"]), float(p["dec"])
                if not (0 <= ra < 360 and -90 <= dec <= 90):
                    raise ValueError
                if path == "/api/gaia":
                    return self.send_json(context.gaia(ra, dec, float(p.get("radius", 3))))
                return self.send_json(context.survey(ra, dec, int(float(p.get("size", 40))), p.get("band", "D2")))
            except (KeyError, ValueError):
                return self.send_json({"error": "need ra (0-360), dec (-90..90) in degrees"}, 400)
        if path.startswith("/api/fits/"):
            name = path.rsplit("/", 1)[-1]
            target = settings.CACHE_DIR / "fits" / name
            if not re.fullmatch(r"r_[0-9a-f]{16}\.fits", name) or not target.is_file():
                return self.send_json({"error": "FITS file not on this server yet; reload the images "
                                                "with 'fresh' processing to make it"}, 404)
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/fits")
            self.send_header("Content-Disposition", f'attachment; filename="spherex_{name}"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/api/jobs/") and path.endswith("/cancel"):
            return self.send_json({"ok": jobs.cancel(path.split("/")[3])})
        if path.startswith("/api/jobs/"):
            job = jobs.JOBS.get(path.rsplit("/", 1)[-1])
            if not job:
                return self.send_json({"error": "unknown job (the server may have restarted)"}, 404)
            return self.send_json(jobs.public(job))
        if path.startswith("/api/lab/"):                 # Science Lab (lab/api.py), separate pipeline
            return self.send_lab(path, parse_qs(url.query))
        if path.startswith("/api/"):
            return self.send_json({"error": "no such endpoint"}, 404)
        return super().do_GET()

    def log_message(self, fmt, *args):
        if "/api/jobs/" not in self.path:          # don't print every progress poll
            sys.stderr.write("  " + (fmt % args) + "\n")


def serve(host, port, site):
    Handler.site = site
    mimetypes.add_type("text/javascript", ".js")
    try:
        server = ThreadingHTTPServer((host, port), Handler)
    except OSError:
        print(f"\n  ERROR: port {port} is already in use: another ORBITAL server is still running"
              "\n  (maybe in another window). Stop it first, then start this one again. In PowerShell:"
              "\n      Get-Process python* | Stop-Process -Force"
              f"\n  Or start this one on another port:  python main.py --port {port + 1}\n")
        raise SystemExit(1)
    print(f"\n  Open  http://{host}:{port}/   (Ctrl+C to stop)\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
