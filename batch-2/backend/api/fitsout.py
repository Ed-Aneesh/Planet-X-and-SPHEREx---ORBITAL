"""Writes the aligned frames as a FITS file (feature F28), with no extra libraries.

FITS (Flexible Image Transport System) is astronomy's standard file format: an
ASCII header of 80-character "cards" (KEY = value / comment) in 2880-byte blocks,
followed by the pixel values as big-endian numbers. Any astronomy program
(DS9, astropy, Aladin) can open it.

Layout written here:
  primary HDU  ALIGNED  cube NAXIS3 = frames, in MJy/sr, NaN = no data
  extension 1  STACKS   cube of one median image per visit
Both carry a WCS (World Coordinate System: the header recipe that converts a
pixel to RA/Dec) for the shared north-up grid: TAN projection, east left.
Each frame's date and wavelength are header cards (MJD_001, WAVE_001, ...).
"""
import numpy as np

BLOCK = 2880


_ASCII = str.maketrans({"—": "-", "–": "-", "′": "'", "″": '"', "µ": "u", "λ": "lambda", "°": " deg", "…": "..."})


def _ascii(text):
    """FITS headers may hold only plain ASCII: swap common symbols, drop anything else."""
    return str(text).translate(_ASCII).encode("ascii", "replace").decode("ascii")


def _card(key, value=None, comment=""):
    comment = _ascii(comment)
    if isinstance(value, str):
        value = _ascii(value)
    if value is None:
        text = f"{key:<8s}" + (" " + comment if comment else "")
    else:
        if isinstance(value, bool):
            v = "T" if value else "F"
            v = f"{v:>20s}"
        elif isinstance(value, (int, np.integer)):
            v = f"{int(value):>20d}"
        elif isinstance(value, (float, np.floating)):
            v = f"{float(value):>20.12G}"
        else:
            v = "'" + str(value).replace("'", "''")[:66] + "'"
            v = f"{v:<20s}"
        text = f"{key:<8s}= {v}" + (f" / {comment}" if comment else "")
    return text[:80].ljust(80)


def _hdu(cards, data):
    header = "".join(cards) + "END".ljust(80)
    header += " " * (-len(header) % BLOCK)
    raw = np.ascontiguousarray(data, dtype=">f4").tobytes()
    raw += b"\0" * (-len(raw) % BLOCK)
    return header.encode("ascii", "replace") + raw


def _wcs(size, ra, dec, pixel_arcsec):
    c = (size + 1) / 2.0                                    # FITS pixels start at 1
    d = pixel_arcsec / 3600.0
    return [_card("CTYPE1", "RA---TAN"), _card("CTYPE2", "DEC--TAN"),
            _card("CRVAL1", float(ra), "RA of the grid centre (deg)"),
            _card("CRVAL2", float(dec), "Dec of the grid centre (deg)"),
            _card("CRPIX1", c), _card("CRPIX2", c),
            _card("CDELT1", -d, "deg/pixel; negative = east is left"),
            _card("CDELT2", d, "deg/pixel"),
            _card("CUNIT1", "deg"), _card("CUNIT2", "deg"), _card("RADESYS", "ICRS")]


def write(path, frames, stacks, centre, pixel_arcsec, credit, release):
    """frames/stacks: dicts with 'image' (row 0 = SOUTH, FITS convention), 'mjd', 'wavelength'."""
    size = frames[0]["image"].shape[0]
    ra, dec = centre

    def header(kind, items, primary):
        cards = ([_card("SIMPLE", True, "standard FITS")] if primary else
                 [_card("XTENSION", "IMAGE", "image extension")])
        cards += [_card("BITPIX", -32, "32-bit floating point"), _card("NAXIS", 3),
                  _card("NAXIS1", size), _card("NAXIS2", size), _card("NAXIS3", len(items))]
        cards += ([_card("EXTEND", True)] if primary else [_card("PCOUNT", 0), _card("GCOUNT", 1)])
        cards += [_card("EXTNAME", kind), _card("BUNIT", "MJy/sr", "surface brightness")]
        cards += _wcs(size, ra, dec, pixel_arcsec)
        cards += [_card("TELESCOP", "SPHEREx"), _card("RELEASE", str(release).upper()),
                  _card("ORIGIN", "Planet X and SPHERE x (NASA Space Apps 2026)")]
        for k, f in enumerate(items[:999], 1):
            cards.append(_card(f"MJD_{k:03d}", float(f["mjd"]), "mid-exposure date (MJD)"))
            if f.get("wavelength"):
                cards.append(_card(f"WAVE_{k:03d}", float(f["wavelength"]), "wavelength at target (um)"))
        cards += [_card("COMMENT", comment=line) for line in (
            "Zodiacal light and background removed; bad pixels = NaN;",
            "all frames resampled (nearest pixel) onto this one grid.",
            credit[:70])]
        return cards

    body = _hdu(header("ALIGNED", frames, True), np.array([f["image"] for f in frames]))
    if stacks:
        body += _hdu(header("STACKS", stacks, False), np.array([s["image"] for s in stacks]))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(body)
    tmp.replace(path)
    return path
