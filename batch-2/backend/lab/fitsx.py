"""FITS helpers the lab needs beyond archive/fitsio.py.

FITS (Flexible Image Transport System) files are a sequence of HDUs (header +
data units). SPHEREx spectral images are MEF (multi-extension FITS) files:
IMAGE, FLAGS, VARIANCE, ZODI, then the PSF (DR1/QR3: a binary TABLE called
EPSF with one row per detector zone) and WCS-WAVE.

archive/fitsio.Hdu.table() reads only the FIRST row of a table (enough for the
one-row WCS-WAVE table). The ePSF table has 441 rows, so here is a general
row-wise binary-table reader built on the same header parser.
"""
import re

import numpy as np

from archive import fitsio

BLOCK = fitsio.BLOCK
_CODES = {"L": ("u1", 1), "B": ("u1", 1), "I": (">i2", 2), "J": (">i4", 4), "K": (">i8", 8),
          "E": (">f4", 4), "D": (">f8", 8), "A": ("S1", 1)}


def hdus(raw):
    """All HDUs of a FITS file in order: list of archive.fitsio.Hdu."""
    out, offset = [], 0
    while offset + BLOCK <= len(raw):
        header, start = fitsio._header(raw, offset)
        hdu = fitsio.Hdu(raw, header, start)
        if start + hdu.size > len(raw):
            raise ValueError(f"file ends inside the data of {hdu.name}")
        out.append(hdu)
        offset = start + -(-hdu.size // BLOCK) * BLOCK
    return out


def by_name(raw):
    found = {}
    for h in hdus(raw):
        found.setdefault(h.name, h)
    return found


def table(hdu):
    """Every row of a binary table: dict column -> numpy array of shape (nrows, *TDIM)."""
    h = hdu.header
    if str(h.get("XTENSION", "")).strip() != "BINTABLE":
        raise ValueError(f"{hdu.name} is not a binary table")
    row_bytes, nrows = int(h["NAXIS1"]), int(h["NAXIS2"])
    fields, names, offset = [], [], 0
    for n in range(1, int(h["TFIELDS"]) + 1):
        match = re.match(r"\s*(\d*)([A-Z])", str(h[f"TFORM{n}"]))
        repeat, code = int(match.group(1) or 1), match.group(2)
        if code not in _CODES:
            raise ValueError(f"unsupported column type {code} in {hdu.name}")
        dtype, size = _CODES[code]
        name = str(h.get(f"TTYPE{n}", f"COL{n}")).strip()
        dims = [int(d) for d in re.findall(r"\d+", str(h.get(f"TDIM{n}", "")))]
        shape = tuple(dims[::-1]) if dims else ((repeat,) if repeat > 1 else ())
        fields.append((name, dtype, shape) if shape else (name, dtype))
        names.append(name)
        offset += repeat * size
    if offset != row_bytes:
        raise ValueError(f"{hdu.name}: columns add up to {offset} bytes, header says {row_bytes}")
    data = np.frombuffer(hdu.raw, np.dtype(fields), nrows, hdu.start)
    return {name: np.asarray(data[name]).astype(data[name].dtype.newbyteorder("=")) for name in names}
