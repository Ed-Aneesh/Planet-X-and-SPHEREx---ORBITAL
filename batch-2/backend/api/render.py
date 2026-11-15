"""Turns a stretched frame into a PNG image the browser can show.

The stretch itself (science/stretch.py) is chosen ONCE for all frames of a
request, so equal brightness on screen means equal surface brightness in
MJy/sr in every frame: a change between frames is a real change in the sky
(or a change of wavelength — see the λ warnings), never a display artefact.

Pixels with no data (flagged, or outside the exposure) are made fully
transparent (alpha = 0), so the browser can paint them a warning colour
instead of pretending they are dark sky.
"""
import base64
import struct
import zlib

import numpy as np


def png_gray_alpha(shade):
    """shade: 2-D array 0..1 with NaN for 'no data', row 0 = SOUTH. Returns PNG bytes, north up."""
    shade = np.flipud(np.asarray(shade, float))          # PNG row 0 is the top -> north up
    valid = np.isfinite(shade)
    gray = np.where(valid, np.clip(shade, 0, 1) * 255, 0).round().astype(np.uint8)
    alpha = np.where(valid, 255, 0).astype(np.uint8)
    pixels = np.dstack([gray, alpha])                     # PNG colour type 4: grey + alpha
    height, width = gray.shape
    raw = b"".join(b"\x00" + pixels[row].tobytes() for row in range(height))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 4, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def data_uri(shade):
    return "data:image/png;base64," + base64.b64encode(png_gray_alpha(shade)).decode()


# ---------------------------------------------------------------- colour pictures
def png_rgba(rgb, valid=None):
    """rgb: H x W x 3 array 0..1, row 0 = SOUTH; valid: H x W bool (False = transparent)."""
    rgb = np.flipud(np.nan_to_num(np.asarray(rgb, float)))
    valid = np.ones(rgb.shape[:2], bool) if valid is None else np.flipud(np.asarray(valid, bool))
    pixels = np.dstack([np.clip(rgb, 0, 1) * 255, valid * 255.0]).round().astype(np.uint8)
    height, width = pixels.shape[:2]
    raw = b"".join(b"\x00" + pixels[row].tobytes() for row in range(height))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def data_uri_rgb(rgb, valid=None):
    return "data:image/png;base64," + base64.b64encode(png_rgba(rgb, valid)).decode()


# Colour maps as a few anchor colours, linearly interpolated (no matplotlib needed on the server).
COLOURMAPS = {
    # "magma": dark purple -> orange -> pale yellow (perceptually uniform; good for SNR)
    "magma": [(0.0, (0, 0, 4)), (0.25, (81, 18, 124)), (0.5, (183, 55, 121)),
              (0.75, (252, 137, 97)), (1.0, (252, 253, 191))],
    # "RdBu_r": blue (faded) -> white (no change) -> red (brightened), for difference images
    "diverging": [(0.0, (5, 48, 97)), (0.25, (67, 147, 195)), (0.5, (247, 247, 247)),
                  (0.75, (214, 96, 77)), (1.0, (103, 0, 31))],
}


def colourmap(values, name):
    """values 0..1 (NaN allowed) -> H x W x 3 RGB 0..1."""
    stops = COLOURMAPS[name]
    x = np.clip(np.nan_to_num(np.asarray(values, float), nan=0.5), 0, 1)
    pos = np.array([p for p, _ in stops])
    cols = np.array([c for _, c in stops], float) / 255
    return np.dstack([np.interp(x, pos, cols[:, k]) for k in range(3)])


def f32_base64(image):
    """Raw float32 pixels (row 0 = SOUTH, NaN = no data) for in-browser measuring."""
    return base64.b64encode(np.ascontiguousarray(image, dtype="<f4").tobytes()).decode()
