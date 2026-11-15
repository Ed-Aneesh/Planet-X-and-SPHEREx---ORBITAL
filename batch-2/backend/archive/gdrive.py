"""Google Drive as a data source: real SPHEREx FITS files (downloaded earlier from
IRSA) read straight from a Drive folder, so the site works 24/7 even when IRSA is
down, with no PC involved.

HOW ACCESS WORKS (Google Drive API v3, plain HTTPS):
  * A "service account" is a robot Google account with a key file (JSON). You
    share the FITS folder with its e-mail address (Viewer), exactly like sharing
    with a person. The server proves who it is with the key; no human login.
  * The key is read from the environment variable GOOGLE_SERVICE_ACCOUNT_JSON
    (the whole JSON text, how Render stores secrets) or from a file named by
    GOOGLE_APPLICATION_CREDENTIALS. NEVER put the key file on GitHub.
  * DRIVE_FOLDER_ID = the long id at the end of the folder's Drive URL
    (https://drive.google.com/drive/folders/<THIS PART>).

HOW IT STAYS FAST AND SMALL (same idea as archive/irsa.py):
  A SPHEREx cutout file is IMAGE, FLAGS, VARIANCE, ZODI, PSF (~4.9 MB, unused),
  WCS-WAVE. Drive supports HTTP "Range" requests (download only bytes a..b),
  so per file we fetch (1) the start of the file up to the end of ZODI and
  (2) the last 128 KB, which holds the WCS-WAVE wavelength table. ~0.3 MB
  instead of ~5 MB, and EVERY file keeps its own wavelength table.

THE INDEX: to know which files cover a sky position, every file's header
(WCS, band, date) is read once (first 64 KB of each file) and saved to
cache/drive_index.json. `python main.py --drive-index` builds it; commit the
resulting backend/data/drive_index.json so a fresh server starts instantly.
"""
import csv
import io
import json
import os
import re
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import requests

from archive import fitsio
from archive import irsa
from config import settings
from science import clean
from science import compat as backend
from science.wcs import SkyWcs

API = "https://www.googleapis.com/drive/v3/files"
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
FOLDER = "application/vnd.google-apps.folder"
HEAD_BYTES = 64 * 1024
TAIL_BYTES = 128 * 1024
SHIPPED_INDEX = settings.BACKEND_DIR / "data" / "drive_index.json"   # commit this one

_local = threading.local()
_index = None
_index_lock = threading.Lock()
_credentials = None


class DriveError(RuntimeError):
    pass


# ---------------------------------------------------------------- configuration
def folder_id():
    return os.environ.get("DRIVE_FOLDER_ID", "").strip()


def configured():
    return bool(folder_id() and (os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
                                 or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")))


def _creds():
    global _credentials
    if _credentials is None:
        try:
            from google.oauth2 import service_account
        except ImportError:
            raise DriveError("Google Drive needs the 'google-auth' package:  pip install google-auth")
        text = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        try:
            if text:
                info = json.loads(text)
                _credentials = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
            else:
                path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
                _credentials = service_account.Credentials.from_service_account_file(path, scopes=SCOPES)
        except (ValueError, OSError, KeyError) as error:
            raise DriveError(f"Could not read the service-account key: {error}")
    return _credentials


def _session():
    """One authorised HTTPS session per thread (it adds and refreshes the access token)."""
    if not hasattr(_local, "session"):
        from google.auth.transport.requests import AuthorizedSession
        _local.session = AuthorizedSession(_creds())
    return _local.session


def _get(params=None, file_id=None, headers=None, stream=False, timeout=60):
    url = f"{API}/{file_id}" if file_id else API
    for attempt in range(4):
        try:
            r = _session().get(url, params=params, headers=headers or {}, stream=stream, timeout=timeout)
        except requests.RequestException as error:
            if attempt == 3:
                raise DriveError(f"Drive unreachable: {type(error).__name__}")
            time.sleep(2 ** attempt)
            continue
        if r.status_code in (429, 500, 502, 503, 504) and attempt < 3:     # Drive asks us to slow down
            r.close()
            time.sleep(2 ** (attempt + 1))
            continue
        if r.status_code == 404:
            raise DriveError("Drive file/folder not found — is it shared with the service account e-mail?")
        if r.status_code == 403:
            raise DriveError("Drive refused access (403): " + irsa._snippet(r.text, 200))
        if r.status_code >= 400:
            raise DriveError(irsa.describe(r))
        return r
    raise DriveError("Drive kept asking us to slow down (rate limit)")


def _range(file_id, start=None, end=None, suffix=None):
    """Bytes start..end (inclusive), or the last `suffix` bytes. Drive returns 206 for ranges."""
    rng = f"bytes=-{suffix}" if suffix else f"bytes={start}-{end}"
    r = _get({"alt": "media", "supportsAllDrives": "true"}, file_id, {"Range": rng}, timeout=(15, 120))
    return r.content


# ---------------------------------------------------------------- listing
def _list_children(parent):
    items, token = [], None
    while True:
        params = {"q": f"'{parent}' in parents and trashed = false", "pageSize": 1000,
                  "fields": "nextPageToken, files(id, name, mimeType, size, modifiedTime)",
                  "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}
        if token:
            params["pageToken"] = token
        data = _get(params).json()
        items += data.get("files", [])
        token = data.get("nextPageToken")
        if not token:
            return items


def walk(root):
    """Every FITS file and manifest.csv under the folder, with its path inside the folder."""
    files, manifests, stack = [], [], [(root, "")]
    while stack:
        parent, path = stack.pop()
        for item in _list_children(parent):
            here = f"{path}/{item['name']}" if path else item["name"]
            if item["mimeType"] == FOLDER:
                stack.append((item["id"], here))
            elif re.search(r"\.fits?(\.gz)?$", item["name"], re.I):
                files.append({**item, "path": here})
            elif item["name"].lower() == "manifest.csv":
                manifests.append({**item, "path": here})
    return files, manifests


# ---------------------------------------------------------------- headers -> index entry
MJD_KEYS = ("MJD-AVG", "MJD-OBS", "MJD-MID", "MJDMID", "MJD_AVG", "MJD-BEG", "MJD")
DATE_KEYS = ("DATE-AVG", "DATE-OBS", "DATE-BEG")


def _iso_to_mjd(text):
    try:
        t = datetime.fromisoformat(str(text).replace("Z", "")).replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return (t - datetime(1858, 11, 17, tzinfo=timezone.utc)).total_seconds() / 86400


def _headers_from_prefix(raw):
    """Primary + IMAGE headers from the first bytes of a file (ValueError if more bytes are needed)."""
    primary, offset = fitsio._header(raw, 0)
    image, _ = fitsio._header(raw, offset + -(-fitsio.Hdu(b"", primary, 0).size // fitsio.BLOCK) * fitsio.BLOCK)
    return primary, image


def _band_of(path, headers):
    for h in headers:
        v = h.get("DETECTOR")
        if isinstance(v, int) and 1 <= v <= 6:
            return v
    m = re.search(r"(?:^|[/_\\])D([1-6])(?:[/_\\]|$)", path) or re.search(r"D([1-6])_spx", path)
    return int(m.group(1)) if m else None


def _entry(f, manifest):
    """Reads the first 64 KB (128 KB if the header is long) and keeps what the search needs."""
    raw = b""
    for size in (HEAD_BYTES, 4 * HEAD_BYTES):
        raw = _range(f["id"], 0, size - 1)
        if raw[:2] == b"\x1f\x8b":                          # gzipped file: unzip the prefix
            raw = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(raw)
        try:
            primary, image = _headers_from_prefix(raw)
            break
        except ValueError:
            continue
    else:
        raise DriveError("header longer than 256 KB")
    extra = manifest.get(f["name"], {})
    mjd = extra.get("mjd")
    for h in (image, primary):
        for k in MJD_KEYS:
            if mjd is None and isinstance(h.get(k), (int, float)):
                mjd = float(h[k])
        for k in DATE_KEYS:
            if mjd is None and h.get(k):
                mjd = _iso_to_mjd(h[k])
    wcs_keys = {k: v for k, v in image.items()
                if re.fullmatch(r"(CRVAL|CRPIX|CDELT|CTYPE|NAXIS)[12]|CD\d_\d|PC\d_\d|[AB]_\d_\d|[AB]_ORDER", k)}
    release = extra.get("release") or next((r for r in ("qr3", "qr2", "qr1") if r in f["path"].lower()), "drive")
    return {"id": f["id"], "name": f["name"], "path": f["path"], "size": int(f.get("size", 0)),
            "modified": f.get("modifiedTime"), "gz": f["name"].lower().endswith(".gz"),
            "band": _band_of(f["path"], (image, primary)), "mjd": mjd, "release": release, "wcs": wcs_keys}


def _read_manifest(item):
    """manifest.csv written by download_spherex.py: maps file name -> mjd (and release from the url)."""
    out = {}
    try:
        text = _get({"alt": "media", "supportsAllDrives": "true"}, item["id"]).text
        rows = list(csv.DictReader(io.StringIO(text)))
    except (DriveError, csv.Error):
        return out
    for row in rows:
        low = {k.lower().strip(): (v or "").strip() for k, v in row.items() if k}
        name_col = next((v for k, v in low.items() if k in ("file", "filename", "name", "path", "local", "url", "uri")), "")
        name = re.split(r"[/\\?]", name_col.split("?")[0])[-1] if name_col else ""
        mjd = next((v for k, v in low.items() if "mjd" in k), "")
        url = " ".join(low.values()).lower()
        if name:
            out[name] = {"mjd": float(mjd) if re.fullmatch(r"[\d.]+", mjd or "x") else None,
                         "release": next((r for r in ("qr3", "qr2", "qr1") if f"/{r}/" in url), None)}
    return out


def build_index(save_to=None, workers=8, quiet=False):
    """Walks the Drive folder and reads every header once. Returns the index dict."""
    if not configured():
        raise DriveError("Drive not configured: set DRIVE_FOLDER_ID and GOOGLE_SERVICE_ACCOUNT_JSON")
    started = time.perf_counter()
    files, manifests = walk(folder_id())
    manifest = {}
    for m in manifests:
        manifest.update(_read_manifest(m))
    entries, failed = [], []

    def one(f):
        try:
            return _entry(f, manifest)
        except Exception as error:
            failed.append(f"{f['path']}: {error}")
            return None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, e in enumerate(pool.map(one, files), 1):
            if e:
                entries.append(e)
            if not quiet and (i % 25 == 0 or i == len(files)):
                print(f"\r  indexed {i}/{len(files)} files", end="", flush=True)
    index = {"folder": folder_id(), "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "files": entries, "failed": failed, "seconds": round(time.perf_counter() - started, 1)}
    if not quiet:
        print(f"\n  {len(entries)} files indexed, {len(failed)} failed, in {index['seconds']} s")
    for path in filter(None, [save_to, settings.CACHE_DIR / "drive_index.json"]):
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(index), "utf-8")
        except OSError:
            pass
    return index


def index():
    """The index: memory -> cache/ -> shipped data/drive_index.json -> build from Drive."""
    global _index
    with _index_lock:
        if _index is None:
            for path in (settings.CACHE_DIR / "drive_index.json", SHIPPED_INDEX):
                try:
                    data = json.loads(path.read_text("utf-8"))
                    if data.get("folder") == folder_id():
                        _index = data
                        break
                except (OSError, ValueError):
                    pass
            if _index is None:
                _index = build_index(quiet=True)
        return _index


def available():
    return configured()


# ---------------------------------------------------------------- search + fetch (same shapes as irsa.py)
def search(ra, dec, band, margin_pixels=2):
    """Index entries of this band whose image contains (ra, dec). Returns (rows, release)."""
    rows = []
    for e in index()["files"]:
        if e["band"] != band or e["mjd"] is None or "CRVAL1" not in e["wcs"]:
            continue
        try:
            x, y = SkyWcs.from_header(e["wcs"]).world2pix(ra, dec)
        except (KeyError, ValueError, np.linalg.LinAlgError):
            continue
        nx, ny = e["wcs"].get("NAXIS1", 0), e["wcs"].get("NAXIS2", 0)
        if np.isfinite(x) and margin_pixels <= x <= nx - 1 - margin_pixels and margin_pixels <= y <= ny - 1 - margin_pixels:
            rows.append({"url": f"gdrive://{e['id']}", "id": e["id"], "path": e["path"], "gz": e["gz"],
                         "mjd": e["mjd"], "band": band, "release": e["release"], "size": e["size"]})
    rows.sort(key=lambda r: r["mjd"])
    releases = [r["release"] for r in rows]
    for candidate in ("qr3", "qr2", "qr1"):                  # one release per request, never mixed
        if candidate in releases:
            rows = [r for r in rows if r["release"] == candidate]
            return rows, candidate
    return rows, (releases[0] if releases else "drive")


def _wave_hdu_from_tail(tail, file_size):
    """Finds the WCS-WAVE layer inside the last bytes of the file (headers start on 2880-byte blocks)."""
    start = file_size - len(tail)
    first = (-start) % fitsio.BLOCK
    for k in range(first, len(tail) - 80, fitsio.BLOCK):
        if tail[k:k + 8] == b"XTENSION":
            try:
                header, _ = fitsio._header(tail, k)
            except ValueError:
                continue
            if header.get("EXTNAME") == "WCS-WAVE":
                return tail[k:]
    return None


def download(row):
    """(body, reason, bytes received). Start-of-file + tail; full file only if that fails."""
    if not row.get("gz") and row.get("size"):
        r = _get({"alt": "media", "supportsAllDrives": "true"}, row["id"], stream=True, timeout=(15, 120))
        try:
            stream = irsa._Stream(r)
            early = irsa._read_until(stream, irsa.STOP_AFTER)
            wire = stream.wire
        finally:
            r.close()
        if early:
            tail = _range(row["id"], suffix=min(TAIL_BYTES, row["size"]))
            wave = _wave_hdu_from_tail(tail, row["size"])
            if wave:
                return early + wave, None, wire + len(tail)
    r = _get({"alt": "media", "supportsAllDrives": "true"}, row["id"], timeout=(15, 180))
    body = r.content
    if body[:2] == b"\x1f\x8b":
        body = zlib.decompress(body, 16 + zlib.MAX_WBITS)
    return body, None, len(r.content)


def _body_file(row):
    return settings.CACHE_DIR / "drive_bodies" / (re.sub(r"[^\w-]", "_", row["id"]) + ".fits")


def cached_download(row):
    """SPEED: the useful part of a Drive file (≈ 100 KB: image, flags, variance, zodi,
    wavelength map) is kept on disk, so other radii and bands of the same target, and
    later restarts, never download it again. Delete cache/drive_bodies to refresh."""
    path = _body_file(row)
    try:
        return path.read_bytes(), None, 0
    except OSError:
        pass
    body, reason, n = download(row)
    if body is not None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".part")
            tmp.write_bytes(body)
            os.replace(tmp, path)
        except OSError:
            pass
    return body, reason, n


def fetch(rows, request, quiet=True, on_progress=None):
    """Same contract as irsa.fetch: returns (frames, dropped)."""
    grid = backend.make_grid(request.ra, request.dec, request.size_pixels)
    started = time.perf_counter()
    received, bodies, reasons = [0], {}, {}
    lock = threading.Lock()

    def one(i):
        try:
            body, reason, n = cached_download(rows[i])
        except Exception as error:
            body, reason, n = None, f"Drive: {error}"[:120], 0
        with lock:
            received[0] += n
            if body is None:
                reasons[i] = reason
            else:
                bodies[i] = body
            if on_progress:
                on_progress()

    with ThreadPoolExecutor(max_workers=settings.DOWNLOAD_WORKERS) as pool:
        list(pool.map(one, range(len(rows))))

    frames, dropped = [], []
    for i, row in enumerate(rows):
        if i in bodies:
            try:
                frame = clean.process(bodies[i], request.ra, request.dec, grid)
                frame.update(mjd=row["mjd"], visit=row.get("visit", 1), band=row["band"], url=row["url"])
                frames.append(frame)
                continue
            except Exception as error:
                text = str(error)
                reasons[i] = ("skipped: patch mostly off this file (cutout smaller than the radius?)"
                              if "edge" in text or "cover" in text else f"{type(error).__name__}: {text}")
        dropped.append({**row, "reason": reasons[i]})
    irsa.LAST_STATS.clear()
    irsa.LAST_STATS.update(seconds=round(time.perf_counter() - started, 1), mb=round(received[0] / 1e6, 2),
                           exposures=len(rows), full_downloads=0, workers=settings.DOWNLOAD_WORKERS, source="drive")
    return frames, dropped
