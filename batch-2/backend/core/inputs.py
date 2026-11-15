"""Everything the user sends, checked and held in one object.

Inputs (and ONLY these, for now):
    ra, dec   sky position. Right ascension = the sky's longitude (0–360°, or
              0–24 h with 1 h = 15°); declination = the sky's latitude (−90…+90°).
    radius    half-width of the square patch, in arcminutes (1′ = 1/60°).
    band      SPHEREx detector D1–D6 (D1 = shortest wavelength).
    start/end optional dates YYYY-MM-DD; both empty = all dates.
    target    optional known-target id (gives the proper motion).
FPS is display-only and never reaches the backend.
"""
import re
from dataclasses import dataclass, field
from datetime import date

from config import settings
from core import targets


class InputError(ValueError):
    """A problem with what the user typed; the message is shown to them as-is."""


def parse_angle(text, is_ra):
    """Reads 133.7951 | 08h55m10.831s | 08:55:10.831 | 08 55 10.8 | -07d14m42.53s | -07:14:42.5.

    For RA, sexagesimal (h, : or spaces) means HOURS; a plain number means degrees.
    """
    s = str(text).strip().lower().replace("−", "-").replace("°", "d").replace("′", "m") \
        .replace("'", "m").replace("″", "s").replace('"', "s")
    if not s:
        raise InputError(("RA" if is_ra else "Dec") + " is empty")
    if re.fullmatch(r"[+-]?\d+(\.\d*)?", s):
        value = float(s)
    else:
        sign = -1.0 if s.startswith("-") else 1.0
        parts = re.findall(r"\d+(?:\.\d+)?", s)
        if not 1 <= len(parts) <= 3 or re.search(r"[^0-9.\s:hdms+-]", s):
            raise InputError(f"cannot read '{text}'")
        nums = [float(p) for p in parts] + [0.0, 0.0]
        value = sign * (nums[0] + nums[1] / 60 + nums[2] / 3600)
        if is_ra and "d" not in s:          # hours -> degrees
            value *= 15
    if is_ra:
        if not 0 <= value < 360:
            raise InputError("RA must be 0–360° (or 0–24 h)")
    elif not -90 <= value <= 90:
        raise InputError("Dec must be between −90° and +90°")
    return value


def date_to_mjd(text):
    """'2025-06-01' -> MJD at 00:00 UTC that day."""
    try:
        d = date.fromisoformat(text)
    except ValueError:
        raise InputError(f"date '{text}' must be YYYY-MM-DD")
    return float((d - date(1858, 11, 17)).days)


def mjd_to_year(mjd):
    return 2000.0 + (mjd - settings.MJD_J2000) / settings.JULIAN_YEAR_DAYS


@dataclass
class Query:
    ra: float                    # position typed by the user (or the target's catalogue position)
    dec: float
    radius: float                # DEGREES (archive code works in degrees)
    band: int
    start_mjd: float = None
    end_mjd: float = None
    target: str = ""
    source: str = ""             # "drive" (Star Vault), "irsa-first" (Sky Probe), "irsa", or "" = server default
    start_text: str = ""
    end_text: str = ""
    notes: list = field(default_factory=list)
    # Motion typed by the user for a custom position (ignored for named targets,
    # which use their catalogue values). pm in mas/yr, epoch = year the RA/Dec refer to.
    pm_east: float = 0.0
    pm_north: float = 0.0
    epoch: float = 2000.0
    max_frames: int = 0          # 0 = settings.MAX_EXPOSURES
    centre_override: tuple = None  # (ra, dec, year): use this grid centre (colour composite)
    fresh: bool = False          # skip prebuilt/cached results (needed to write a FITS file)

    @property
    def size_pixels(self):
        """Odd width so one pixel sits exactly on the centre."""
        return int(round(2 * self.radius * 3600 / settings.PIXEL_ARCSEC)) | 1

    def cache_key(self):
        return ("v3", round(self.ra, 5), round(self.dec, 5), round(self.radius, 5), self.band,
                self.start_text or "all", self.end_text or "all", self.target or "-",
                self.max_frames or settings.MAX_EXPOSURES, self.source or "auto",
                round(self.pm_east, 2), round(self.pm_north, 2), round(self.epoch, 3) if self.has_custom_motion else "-") + \
            ((f"visitmax{settings.VISIT_MAX_DAYS}",) if self.source == "irsa" else ())   # live results made before the
        # 14-day visit cap are recomputed; the Star Vault's prebuilt (Drive) results keep their keys

    @property
    def has_custom_motion(self):
        return not self.target and bool(self.pm_east or self.pm_north)


def read(params):
    """params: dict of strings (from the URL). Returns a Query or raises InputError."""
    def one(name, default=""):
        v = params.get(name, default)
        return (v[0] if isinstance(v, list) else v) or default

    target = one("target").strip().lower()
    if target and target not in targets.TARGETS:
        if not (one("ra") and one("dec")):
            raise InputError(f"unknown target '{target}'")
        target = ""                       # not in our list: use the position sent with it

    if target:
        t = targets.TARGETS[target]
        ra, dec = t["ra"], t["dec"]
    else:
        if not one("ra") or not one("dec"):
            raise InputError("RA and Dec are required")
        ra, dec = parse_angle(one("ra"), True), parse_angle(one("dec"), False)

    try:
        radius_arcmin = float(one("radius", str(settings.RADIUS_DEFAULT_ARCMIN)))
    except ValueError:
        raise InputError("radius must be a number (arcminutes)")
    if not settings.RADIUS_MIN_ARCMIN <= radius_arcmin <= settings.RADIUS_MAX_ARCMIN:
        raise InputError(f"radius must be {settings.RADIUS_MIN_ARCMIN}–{settings.RADIUS_MAX_ARCMIN} arcmin")

    band_text = one("band", "D2").upper().lstrip("D")
    if band_text not in {"1", "2", "3", "4", "5", "6"}:
        raise InputError("band must be D1–D6")

    start, end = one("start").strip(), one("end").strip()
    start_mjd = date_to_mjd(start) if start else None
    end_mjd = date_to_mjd(end) + 1.0 if end else None          # end date is inclusive
    if start_mjd is not None and end_mjd is not None and start_mjd >= end_mjd:
        raise InputError("start date must be before end date")

    source = one("source").strip().lower()
    if source in ("", "auto"):
        source = ""
    elif source not in ("drive", "irsa", "irsa-first"):
        raise InputError("source must be drive, irsa, irsa-first or auto")
    def number(name, default, low, high, label):
        text = one(name).strip()
        if not text:
            return default
        try:
            value = float(text)
        except ValueError:
            raise InputError(f"{label} must be a number")
        if not low <= value <= high:
            raise InputError(f"{label} must be between {low:g} and {high:g}")
        return value

    # Proper motion: 10 000 mas/yr ≈ Barnard's Star; the fastest known objects are < 20 000.
    pm_east = number("pm_east", 0.0, -30000, 30000, "Motion east (mas/yr)")
    pm_north = number("pm_north", 0.0, -30000, 30000, "Motion north (mas/yr)")
    epoch = number("epoch", 2000.0, 1900, 2100, "Year the position refers to")
    q = Query(ra, dec, radius_arcmin / 60.0, int(band_text), start_mjd, end_mjd,
              target, source, start, end)
    if not target:
        q.pm_east, q.pm_north, q.epoch = pm_east, pm_north, epoch
    q.fresh = one("fresh") in ("1", "true", "yes")
    # How many exposures to use, spread evenly in time: a number, or "all" (0) up to the ceiling.
    how_many = one("max").strip().lower()
    if how_many:
        if how_many in ("all", "0"):
            q.max_frames = settings.MAX_EXPOSURES_ALL
        else:
            try:
                q.max_frames = int(how_many)
            except ValueError:
                raise InputError("max must be a whole number or 'all'")
            if not 2 <= q.max_frames <= settings.MAX_EXPOSURES_ALL:
                raise InputError(f"max must be between 2 and {settings.MAX_EXPOSURES_ALL}, or 'all'")
    if not target and (pm_east or pm_north):
        q.notes.append(f"Using the motion you typed: {pm_east:g} mas/yr east, {pm_north:g} mas/yr north, "
                       f"position at {epoch:g}.")
    elif not target:
        found = targets.match(ra, dec)
        if found:
            q.target = found
            q.notes.append(f"Position matches {targets.TARGETS[found]['title']}; "
                           "using its catalogue proper motion.")
    return q
