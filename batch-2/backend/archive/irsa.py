"""Talks to NASA/IPAC IRSA (code from the team's spherex_explorer/archive.py): finds the exposures, groups them into visits, downloads cutouts into memory.

Speed: 97% of every cutout is the PSF layer (about 4.9 MB), which this tool
never uses. The wavelength table that comes after it is the same for every
exposure of a detector, so it is downloaded in full once per detector and
pipeline version. Every other download stops reading after the ZODI layer
(about 0.1 MB) and has the saved table attached in memory.
"""
import csv
import io
import json
import queue
from urllib.parse import urljoin
import re
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor

import requests

from archive import fitsio
from config import links, settings
from science import clean
from science import compat as backend

WORKERS = settings.DOWNLOAD_WORKERS
ATTEMPTS = settings.DOWNLOAD_ATTEMPTS
TIMEOUT = settings.TIMEOUT_SECONDS
VISIT_GAP_DAYS = settings.VISIT_GAP_DAYS
CHUNK = 32 * 1024
STOP_AFTER = "ZODI"

_local = threading.local()
_wave_tables = {}
_wave_lock = threading.Lock()
_search_cache = {}
LAST_STATS = {}          # filled by fetch(): seconds, MB, how many full (slow) downloads


# ---------------------------------------------------------------- SPEED: disk caches
# Both caches survive a restart of the server, so the slow steps happen once.
#  1. Wavelength tables. The WCS-WAVE table sits AFTER the ~4.9 MB PSF layer
#     in every file, so getting it costs one full download per detector and
#     pipeline version. It is identical for every exposure with that key, so
#     we save it to cache/wave/ and never download a whole file for it again.
#  2. Archive searches (TAP). The list of exposures only changes when IRSA
#     adds data (weekly releases), so a search is reused for SEARCH_TTL_HOURS.
def _wave_dir():
    return settings.CACHE_DIR / "wave"


def _search_dir():
    return settings.CACHE_DIR / "search"


def _wave_file(key):
    return _wave_dir() / ("__".join(re.sub(r"[^A-Za-z0-9_.-]", "_", part) for part in key) + ".bin")


def _wave_from_disk(key):
    if key in _wave_tables:
        return True
    path = _wave_file(key)
    try:
        data = path.read_bytes()
    except OSError:
        return False
    with _wave_lock:
        _wave_tables.setdefault(key, data)
    return True


def _search_file(key):
    return _search_dir() / ("s2_" + "_".join(str(k).replace("-", "m").replace(".", "p") for k in key) + ".json")


def when(mjd, fmt="%Y-%m-%d %H:%M"):
    return backend.when(mjd, fmt)


def year_of(mjd):
    return 2000.0 + (mjd - 51544.5) / 365.25


def _session():
    if not hasattr(_local, "session"):
        _local.session = requests.Session()
        _local.session.headers["User-Agent"] = "spherex-explorer (NASA Space Apps 2026)"
    return _local.session


def search(ra, dec, band, on_wait=None):
    """Exposures of band D<band> whose footprint contains (ra, dec), oldest first.
    Asks IRSA two ways AT THE SAME TIME (TAP and SIA) and uses the first useful answer,
    because either service can be slow or down on its own. on_wait(seconds) is called
    every few seconds while we wait, so the website can say we are still trying."""
    key = (round(ra, 6), round(dec, 6), band)
    if key in _search_cache:
        return _search_cache[key]
    path = _search_file(key)
    try:
        if time.time() - path.stat().st_mtime < settings.SEARCH_TTL_HOURS * 3600:
            saved = json.loads(path.read_text("utf-8"))
            _search_cache[key] = (saved["rows"], saved["release"])
            return _search_cache[key]
    except (OSError, ValueError, KeyError):
        pass

    t0 = time.time()
    deadline = t0 + settings.IRSA_SEARCH_BUDGET_SECONDS
    answers = queue.Queue()

    def attempt(name, method):
        try:
            answers.put((name, method(ra, dec, band, deadline), None))
        except Exception as error:                        # report, never crash the race
            answers.put((name, None, f"{name}: {_snippet(str(error), 300)}"))

    methods = {"TAP": _search_tap, "SIA": _search_sia}
    for name, method in methods.items():
        threading.Thread(target=attempt, args=(name, method), daemon=True).start()

    errors, empty_answer, pending = [], None, len(methods)
    while pending:
        left = deadline - time.time()
        if left <= 0:
            errors.append(f"no answer within {settings.IRSA_SEARCH_BUDGET_SECONDS} s")
            break
        try:
            name, rows, error = answers.get(timeout=min(5.0, left))
        except queue.Empty:
            if on_wait:
                on_wait(time.time() - t0)
            continue
        pending -= 1
        if error:
            errors.append(error)
        elif rows:
            return _remember(key, path, rows)
        else:
            empty_answer = rows                        # "no coverage": wait in case the other finds files
    if empty_answer is not None:
        return _remember(key, path, empty_answer)
    raise ArchiveError("IRSA search failed.\n  " + "\n  ".join(errors))


def release_of(url):
    for candidate in links.RELEASES:
        if f"/spherex/{candidate}/" in url:
            return candidate
    return "unknown"


def _pick_release(rows):
    """One calibration per request: DR1 and QR3 together (IRSA calls them one uniformly
    processed set), else QR2 alone. Never QR2 mixed with the newer processing. If the same
    exposure appears in two releases, the newest copy is kept."""
    for candidate in links.RELEASES:
        allowed = links.COMPATIBLE.get(candidate, (candidate,))
        chosen = [r for r in rows if release_of(r["url"]) in allowed]
        if chosen:
            best = {}
            rank = {name: k for k, name in enumerate(links.RELEASES)}
            for r in chosen:                                  # de-duplicate by exposure name
                name = r["url"].rsplit("/", 1)[-1].split("_spx_")[0]
                if name not in best or rank[release_of(r["url"])] < rank[release_of(best[name]["url"])]:
                    best[name] = r
            chosen = sorted(best.values(), key=lambda r: r["mjd"])
            used = sorted({release_of(r["url"]) for r in chosen}, key=lambda x: rank[x])
            return chosen, "+".join(used)
    return rows, "unknown"


def _remember(key, path, rows):
    rows = sorted(rows, key=lambda r: r["mjd"])
    rows, release = _pick_release(rows)
    _search_cache[key] = (rows, release)
    if rows:                                   # never save "no coverage": new data may arrive
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"rows": rows, "release": release}), "utf-8")
        except OSError:
            pass
    return rows, release


def _search_tap(ra, dec, band, deadline):
    """TAP (Table Access Protocol): an SQL-like query on IRSA's SPHEREx tables."""
    query = (
        "SELECT a.uri AS uri, p.time_bounds_lower AS mjd "
        f"FROM {links.TAP_TABLE_ARTIFACT} a JOIN {links.TAP_TABLE_PLANE} p ON a.planeid = p.planeid "
        f"WHERE 1 = CONTAINS(POINT('ICRS', {ra:.7f}, {dec:.7f}), p.poly) "
        f"AND p.energy_bandpassname = 'SPHEREx-D{band}' ORDER BY p.time_bounds_lower"
    )
    text = tap_query(query, budget_end=deadline)
    rows, seen = [], set()
    for row in csv.DictReader(io.StringIO(text)):
        try:
            uri, mjd = row["uri"].strip().lstrip("/"), float(row["mjd"])
        except (KeyError, ValueError, AttributeError):
            continue
        if uri and uri not in seen:
            seen.add(uri)
            rows.append({"url": f"{links.IRSA}/{uri}", "mjd": mjd, "band": band})
    return rows


def _search_sia(ra, dec, band, deadline):
    """SIA v2 (Simple Image Access): 'which image files overlap this tiny circle?'.
    A 1″ circle is used, so 'overlaps' is the same as 'contains the point'."""
    problems, merged, answered, seen_all = [], [], False, set()
    for collection in links.SIA_COLLECTIONS + ["--"] + links.SIA_FALLBACK_COLLECTIONS:
        if collection == "--":
            if merged or answered:                     # DR1/QR3 answered: never fall back to QR2
                return merged
            continue
        left = deadline - time.time()
        if left < 3:
            break
        params = {"COLLECTION": collection, "POS": f"CIRCLE {ra:.7f} {dec:.7f} 0.0003", "MAXREC": "20000"}
        # IRSA's front proxy sometimes answers 502/503/504 for a few seconds (seen at the ecliptic poles, where
        # the answer is large): try again after 4 s and 10 s before giving up on this collection.
        response, failure = None, ""
        for pause in (0, 4, 10):
            if pause:
                if deadline - time.time() < pause + 5:
                    break
                time.sleep(pause)
            try:
                response = _session().get(links.SIA, params=params, timeout=(10, max(5, deadline - time.time())))
            except requests.RequestException as error:
                response, failure = None, f"{collection}: {type(error).__name__}"
                continue
            if response.status_code in (429, 500, 502, 503, 504):
                failure, response = f"{collection}: {describe(response)}", None
                continue
            break
        if response is None:
            problems.append(failure or f"{collection}: no answer")
            continue
        if not response.ok:
            problems.append(f"{collection}: {describe(response)}")
            continue
        try:
            table = _votable_rows(response.content)
        except ValueError as error:
            problems.append(f"{collection}: {error}")
            continue
        rows, seen = [], set()
        for row in table:
            if str(row.get("energy_bandpassname", "")).strip() != f"SPHEREx-D{band}":
                continue
            url = str(row.get("access_url") or "").strip()
            try:
                mjd = float(row.get("t_min"))
            except (TypeError, ValueError):
                continue
            if url.startswith("http") and ".fits" in url and url not in seen:
                seen.add(url)
                rows.append({"url": url.split("?")[0], "mjd": mjd, "band": band})
        if collection in links.SIA_COLLECTIONS:
            merged += [r for r in rows if r["url"] not in seen_all]
            seen_all.update(r["url"] for r in rows)
            answered = answered or bool(table)
            if not table:
                problems.append(f"{collection}: empty answer")
            continue
        if rows or table:                       # a fallback collection exists and answered
            return rows
        problems.append(f"{collection}: empty answer")
    if merged:
        return merged
    if problems and not answered:
        raise ArchiveError("; ".join(problems))
    return []


def _votable_rows(body):
    """VOTable (the XML table format of the Virtual Observatory) -> list of dicts.
    Handles plain TABLEDATA ourselves; BINARY encodings go through astropy if installed."""
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(body)
    except ET.ParseError as error:
        raise ValueError(f"reply is not a VOTable ({_snippet(body.decode('latin-1'), 80)})") from error
    strip = lambda tag: tag.rsplit("}", 1)[-1]
    for info in root.iter():
        if strip(info.tag) == "INFO" and info.get("name") == "QUERY_STATUS" and info.get("value") == "ERROR":
            raise ValueError("IRSA said: " + _snippet((info.text or "") + " " + (info.get("content") or ""), 200))
    names = [f.get("name") for f in root.iter() if strip(f.tag) == "FIELD"]
    if any(strip(e.tag) in ("BINARY", "BINARY2") for e in root.iter()):
        try:
            from astropy.io.votable import parse_single_table
            table = parse_single_table(io.BytesIO(body)).to_table()
            return [{n: (row[n] if n in table.colnames else None) for n in names} for row in table]
        except ImportError as error:
            raise ValueError("binary VOTable needs astropy") from error
    rows = []
    for tr in root.iter():
        if strip(tr.tag) == "TR":
            cells = [td.text for td in tr if strip(td.tag) == "TD"]
            rows.append(dict(zip(names, cells)))
    return rows


# ---------------------------------------------------------------- TAP with clear errors + fallback
class ArchiveError(RuntimeError):
    """IRSA answered, but not with data. The message says exactly what it said."""


def _snippet(text, n=300):
    """First words of an HTML/XML error page, without the tags."""
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", text).strip()[:n]


def describe(response):
    """'HTTP 503 Service Unavailable from irsa.ipac.caltech.edu/TAP/sync: <IRSA's own words>'"""
    where = re.sub(r"^https?://", "", response.url.split("?")[0])
    return f"HTTP {response.status_code} {response.reason or ''} from {where}: {_snippet(response.text) or '(empty reply)'}"


def _votable_error(text):
    """TAP reports a bad query as a VOTable (XML) with <INFO name="QUERY_STATUS" value="ERROR">."""
    match = re.search(r'QUERY_STATUS"\s+value="ERROR"[^>]*>(.*?)</INFO>', text, re.S)
    return _snippet(match.group(1) if match else text)


TAP_PARAMS = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "CSV", "MAXREC": "100000"}
RETRY_STATUS = {429, 500, 502, 503, 504}


def tap_query(query, budget_end=None):
    """Runs an ADQL query. Sync first (fast), retrying on overload; async job as fallback.
    Returns CSV text, or raises ArchiveError listing every attempt."""
    attempts = []
    budget_end = budget_end or time.time() + settings.TAP_BUDGET_SECONDS
    for attempt in range(2):
        if time.time() > budget_end:
            break
        # one long sync try is better than two short ones: a slow query is not a broken one
        tap_timeout = (10, max(5.0, min(settings.TAP_TIMEOUT_SECONDS, budget_end - time.time() - 15)))
        try:
            response = _session().post(links.TAP_SYNC, timeout=tap_timeout, data={**TAP_PARAMS, "QUERY": query})
        except requests.Timeout:
            attempts.append(f"sync try {attempt + 1}: no answer within {tap_timeout[1]:.0f} s")
            break                                         # slow, not broken: let IRSA finish it as an async job
        except requests.RequestException as error:
            attempts.append(f"sync try {attempt + 1}: {type(error).__name__}: {_snippet(str(error), 200)}")
            time.sleep(2 ** attempt)
            continue
        kind = response.headers.get("Content-Type", "").lower()
        if response.ok and "xml" not in kind:
            return response.text
        if response.ok:                                   # 200 but an XML error: IRSA rejected the query
            raise ArchiveError("IRSA rejected the search query: " + _votable_error(response.text))
        attempts.append(f"sync try {attempt + 1}: {describe(response)}")
        if response.status_code not in RETRY_STATUS:
            break                                         # 4xx: retrying the same request won't help
        time.sleep(min(float(response.headers.get("Retry-After", 2)), 3))
    if time.time() > budget_end - 10:                     # no time left for the slower async route
        raise ArchiveError("IRSA search failed.\n  " + "\n  ".join(attempts + ["(time budget used up)"]))
    try:
        return _tap_async(query, budget_end)
    except ArchiveError as error:
        attempts.append(f"async job: {error}")
    except requests.RequestException as error:
        attempts.append(f"async job: {type(error).__name__}: {_snippet(str(error), 200)}")
    raise ArchiveError("IRSA search failed.\n  " + "\n  ".join(attempts))


def _tap_async(query, budget_end=None):
    """TAP async (UWS job): POST -> 303 to job URL -> poll /phase -> GET /results/result."""
    session = _session()
    budget_end = budget_end or time.time() + settings.TAP_BUDGET_SECONDS
    t = (10, settings.TAP_TIMEOUT_SECONDS)
    response = session.post(links.TAP_ASYNC, timeout=t, allow_redirects=False,
                            data={**TAP_PARAMS, "QUERY": query, "PHASE": "RUN"})
    if response.status_code not in (200, 201, 303):
        raise ArchiveError(describe(response))
    job = urljoin(response.url, response.headers.get("Location", "")) or response.url
    deadline = budget_end
    while True:
        phase_reply = session.get(job + "/phase", timeout=t)
        if not phase_reply.ok:
            raise ArchiveError(describe(phase_reply))
        phase = phase_reply.text.strip().upper()
        if phase == "COMPLETED":
            break
        if phase in ("ERROR", "ABORTED"):
            raise ArchiveError(f"job {phase}: {_votable_error(session.get(job + '/error', timeout=30).text)}")
        if phase == "PENDING":
            session.post(job + "/phase", data={"PHASE": "RUN"}, timeout=30)
        if time.time() > deadline:
            raise ArchiveError(f"job still {phase} when the time budget ran out")
        time.sleep(1.5)
    result = session.get(job + "/results/result", timeout=t)
    if not result.ok:
        raise ArchiveError(describe(result))
    if "xml" in result.headers.get("Content-Type", "").lower():
        raise ArchiveError("IRSA rejected the search query: " + _votable_error(result.text))
    return result.text


def group_visits(rows):
    """Number the survey passes. Exposures closer than VISIT_GAP_DAYS join one visit, but a visit
    never lasts longer than VISIT_MAX_DAYS: at the ecliptic poles (the deep fields) SPHEREx looks
    every day all year, so without that cap everything chained into ONE visit and every
    'needs 2+ visits' tool switched off."""
    visits = []
    for row in rows:
        if (visits and row["mjd"] - visits[-1][-1]["mjd"] <= VISIT_GAP_DAYS
                and row["mjd"] - visits[-1][0]["mjd"] <= settings.VISIT_MAX_DAYS):
            visits[-1].append(row)
        else:
            visits.append([row])
    for number, visit in enumerate(visits, 1):
        for row in visit:
            row["visit"] = number
    return visits


def table_key(url):
    match = re.search(r"/(l2b-v[^/]+)/(\d)/", url)
    return match.groups() if match else (url, "")


class _Stream:
    """Hands out the bytes of a reply as they arrive, unzipping if needed."""

    def __init__(self, response):
        self.chunks = response.iter_content(CHUNK)
        self.buffer = bytearray()
        self.inflate = None
        self.first = True
        self.wire = 0

    def need(self, size):
        while len(self.buffer) < size:
            chunk = next(self.chunks, None)
            if chunk is None:
                raise EOFError("reply ended early")
            self.wire += len(chunk)
            if self.first:
                self.first = False
                if chunk[:2] == b"\x1f\x8b":
                    self.inflate = zlib.decompressobj(16 + zlib.MAX_WBITS)
            self.buffer += self.inflate.decompress(chunk) if self.inflate else chunk


def _read_until(stream, stop_name):
    """Reads whole layers until stop_name is complete; returns those bytes, or None at the end."""
    offset = 0
    while True:
        end = offset
        while True:
            try:
                stream.need(end + fitsio.BLOCK)
            except EOFError:
                return None
            block = bytes(stream.buffer[end:end + fitsio.BLOCK])
            end += fitsio.BLOCK
            if any(block[i:i + 3] == b"END" and not block[i + 3:i + 80].strip()
                   for i in range(0, fitsio.BLOCK, 80)):
                break
        header, start = fitsio._header(bytes(stream.buffer[offset:end]), 0)
        hdu = fitsio.Hdu(b"", header, 0)
        offset += start + -(-hdu.size // fitsio.BLOCK) * fitsio.BLOCK
        if hdu.name == stop_name:
            stream.need(offset)
            return bytes(stream.buffer[:offset])
        if hdu.name == "PSF":
            return None


def _get_early(url):
    """Reads up to the end of the ZODI layer, then hangs up. Returns (body, reason, bytes)."""
    response = _session().get(url, stream=True, timeout=(15, TIMEOUT))
    try:
        if response.status_code == 400:
            return None, "HTTP 400: our request was malformed", 0
        if response.status_code == 500:
            return None, "skipped: position is off this exposure", 0
        if response.status_code != 200:
            raise requests.HTTPError(f"HTTP {response.status_code}")
        stream = _Stream(response)
        body = _read_until(stream, STOP_AFTER)
        return body, None if body else "layers not in the expected order", stream.wire
    finally:
        response.close()


def _get_full(url):
    response = _session().get(url, timeout=(15, TIMEOUT))
    if response.status_code == 400:
        return None, "HTTP 400: our request was malformed", 0
    if response.status_code == 500:
        return None, "skipped: position is off this exposure", 0
    if response.status_code != 200:
        raise requests.HTTPError(f"HTTP {response.status_code}")
    body = response.content
    if body[:2] == b"\x1f\x8b":
        body = zlib.decompress(body, 16 + zlib.MAX_WBITS)
    return body, None, len(response.content)


def _with_retries(fetcher, url):
    delay, reason = 1.0, "unknown"
    for attempt in range(ATTEMPTS):
        try:
            body, reason, size = fetcher(url)
            if body is not None or reason.startswith(("skipped", "HTTP 400")):
                return body, reason, size
        except (requests.RequestException, EOFError, zlib.error, ValueError) as error:
            reason = str(error)[:80] if isinstance(error, requests.HTTPError) else type(error).__name__
        if attempt < ATTEMPTS - 1:
            time.sleep(delay)
            delay *= 2
    return None, reason, 0


def _remember_table(key, body):
    spans = fitsio.spans(body)
    if "WCS-WAVE" in spans:
        with _wave_lock:
            _wave_tables.setdefault(key, body[slice(*spans["WCS-WAVE"])])
        try:                                   # SPEED: keep it for the next server run
            path = _wave_file(key)
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(_wave_tables[key])
        except OSError:
            pass


def download(url, key):
    """One cutout with its wavelength table. Returns (body, reason, bytes received)."""
    if _wave_from_disk(key):
        body, reason, size = _with_retries(_get_early, url)
        if body is not None:
            return body + _wave_tables[key], None, size
        if reason.startswith(("skipped", "HTTP 400")):
            return None, reason, size
    body, reason, size = _with_retries(_get_full, url)
    if body is not None:
        _remember_table(key, body)
    return body, reason, size


def fetch(rows, request, quiet=False):
    """Downloads and cleans the chosen exposures. Returns (frames, dropped).

    For each detector and pipeline version without a saved wavelength table,
    one exposure is downloaded whole; at the same time all the others are
    downloaded short. Tables are attached once everything has arrived.
    """
    grid = backend.make_grid(request.ra, request.dec, request.size_pixels)
    size = 2 * request.radius * 1.5
    started = time.perf_counter()
    bodies, reasons, received = {}, {}, [0]
    lock = threading.Lock()

    def url_of(index):
        return rows[index]["url"] + links.CUTOUT_QUERY.format(ra=request.ra, dec=request.dec,
                                                              size=size)

    def progress():
        if not quiet:
            print(f"\r  {len(bodies) + len(reasons)}/{len(rows)} downloaded   "
                  f"{time.perf_counter() - started:4.0f} s   {received[0] / 1e6:5.1f} MB",
                  end="", flush=True)

    def job(index, whole):
        try:
            fetch_one(index, whole)
        except Exception as error:
            with lock:
                reasons[index] = f"unexpected {type(error).__name__}: {error}"

    def fetch_one(index, whole):
        key = table_key(rows[index]["url"])
        if whole:
            body, reason, nbytes = _with_retries(_get_full, url_of(index))
            if body is not None:
                _remember_table(key, body)
        else:
            body, reason, nbytes = _with_retries(_get_early, url_of(index))
        with lock:
            received[0] += nbytes
            if body is None:
                reasons[index] = reason
            else:
                bodies[index] = (body, whole)
            progress()

    seeds, seen = [], set()
    for index, row in enumerate(rows):
        key = table_key(row["url"])
        if key not in seen and not _wave_from_disk(key):     # SPEED: disk cache first
            seen.add(key)
            seeds.append(index)
    plan = [(i, True) for i in seeds] + [(i, False) for i in range(len(rows)) if i not in seeds]
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(lambda item: job(*item), plan))

    retry = [i for i, r in reasons.items() if not r.startswith(("skipped", "HTTP 400"))]
    if retry:
        for index in retry:
            del reasons[index]
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda i: job(i, table_key(rows[i]["url"]) not in _wave_tables), retry))

    for index, (body, whole) in list(bodies.items()):
        key = table_key(rows[index]["url"])
        if whole:
            continue
        if key not in _wave_tables:
            full, reason, nbytes = download(url_of(index), key)
            received[0] += nbytes
            if full is None:
                del bodies[index]
                reasons[index] = reason
                continue
            bodies[index] = (full, True)
        else:
            bodies[index] = (body + _wave_tables[key], True)

    frames, dropped = [], []
    for index, row in enumerate(rows):
        if index in bodies:
            try:
                frame = clean.process(bodies[index][0], request.ra, request.dec, grid)
                frame.update(mjd=row["mjd"], visit=row.get("visit", 1), band=row["band"],
                             url=row["url"])
                frames.append(frame)
                continue
            except Exception as error:
                text = str(error)
                reasons[index] = ("skipped: patch mostly off this exposure" if "edge" in text
                                  else f"{type(error).__name__}: {text}")
        dropped.append({**row, "reason": reasons[index]})

    LAST_STATS.clear()
    LAST_STATS.update(seconds=round(time.perf_counter() - started, 1), mb=round(received[0] / 1e6, 2),
                      exposures=len(rows), full_downloads=len(seeds), workers=WORKERS)
    if not quiet:
        print(f"\n  {len(frames)} frames ready in {time.perf_counter() - started:.0f} s, "
              f"{received[0] / 1e6:.1f} MB received")
        counts = {}
        for item in dropped:
            counts[item["reason"]] = counts.get(item["reason"], 0) + 1
        for reason, count in counts.items():
            print(f"  {count} x {reason}")
    return frames, dropped
