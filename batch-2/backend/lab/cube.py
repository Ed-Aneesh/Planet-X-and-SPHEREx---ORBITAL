"""The SPHEREx DR1 all-sky spectral cube (Science/Data item: DR1 All-Sky Spectral Cube).

WHAT IT IS (verified 15 Nov 2026 from IRSA, live from the team PC):
 * 102 full-sky maps, one per nominal SPHEREx channel (6 bands x 17), 0.753-4.988 um,
   in MJy/sr, built by IRSA from DR1 spectral images (DOI 10.26131/IRSA679).
 * Served as a HiPS cube: the sky is cut into HEALPix tiles (HEALPix = Hierarchical
   Equal Area isoLatitude Pixelization: 12 x 4^k equal-area pieces at order k).
   Order 5 (12 288 tiles), each a FITS file of 512 x 512 x 102 float32:
     .../hips5_cube/hips_20261026/Norder5/Dir{D}/Npix{N}_cube.fits   (D = N // 10000 * 10000)
   HDUs: IMAGE (data), NHITS (input pixels per output pixel), FLAGS, SPECTRAL_CHANNELS, WCS-WAVE.
   IMAGE header: NAXIS1=NAXIS2=512, NAXIS3=102 (wavelength is the SLOWEST axis),
   CTYPE RA---HPX/DEC--HPX (HEALPix projection, H=4, K=3), PC = +-0.00274658203125 deg,
   CRPIX shifts the tile inside one common projection plane. Channels D3:17 and D4:01
   (dichroic edges) are written as all-NaN planes (BLANKCH).
 * Each file is 320.9 MB, but IRSA honours HTTP byte-range requests, including several
   ranges in one request (multipart/byteranges, verified). So a spectrum costs a few
   hundred kB, read straight from the archive.
 * IRSA's own words (HiPS properties): "for visualization". The cube's spectra are
   interpolated (spatially and spectrally) and come without error maps; IRSA recommends
   its spectrophotometry tool on the spectral images for science. We therefore measure
   errors EMPIRICALLY and label every cube spectrum as quick-look.

PIXELS. Every HEALPix pixel has the SAME area: at order 5 with 512-pixel tiles the
fine grid has Nside = 32 x 512 = 16384, so each cube pixel covers
4 pi / (12 x 16384^2) sr = 3.90e-9 sr (12.9 arcsec on a side).
"""
import math
import re
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests

from archive import fitsio
from lab import sed, stats
from lab.uncertainty import STATISTICAL, SYSTEMATIC, Measured

BASE = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/hips5_cube/hips_20261026"
PROPERTIES = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube/properties"
ORDER, TILE, DEPTH = 5, 512, 102
NSIDE_TILE = 2 ** ORDER
NSIDE_PIXEL = NSIDE_TILE * TILE
PIXEL_SR = 4.0 * math.pi / (12.0 * NSIDE_PIXEL ** 2)
PIXEL_ARCSEC = math.sqrt(PIXEL_SR) * 206264.80624709636
BLANK_PLANES = (50, 51)                # 0-based: D3 channel 17 and D4 channel 1 (verified BLANKCH)
MAX_RANGES_PER_REQUEST = 90            # Apache's default MaxRanges is 200: stay well below
WORKERS = 6
TIMEOUT = (15, 60)
HEADER_BYTES = 5 * 2880 * 4            # enough for the primary + IMAGE headers
_session_local = threading.local()


def _session():
    if not hasattr(_session_local, "s"):
        _session_local.s = requests.Session()
        _session_local.s.headers["User-Agent"] = "PlanetX-SPHEREx-lab/1.0 (NASA Space Apps 2026)"
    return _session_local.s


def tile_url(npix):
    return f"{BASE}/Norder{ORDER}/Dir{npix // 10000 * 10000}/Npix{npix}_cube.fits"


# ---------------------------------------------------------------- HEALPix (nested) — Gorski et al. 2005
def _spread_bits(v):
    v = int(v)
    out = 0
    for i in range(32):
        out |= ((v >> i) & 1) << (2 * i)
    return out


def ang2pix_nest(nside, ra_deg, dec_deg):
    """Nested-scheme HEALPix pixel containing (RA, Dec). Same algorithm as healpix_base.cc."""
    z = math.sin(math.radians(dec_deg))
    za = abs(z)
    tt = (math.radians(ra_deg) % (2 * math.pi)) / (math.pi / 2)        # in [0, 4)
    if za <= 2.0 / 3.0:
        temp1 = nside * (0.5 + tt)
        temp2 = nside * z * 0.75
        jp, jm = int(temp1 - temp2), int(temp1 + temp2)
        ifp, ifm = jp // nside, jm // nside
        face = (ifp | 4) if ifp == ifm else (ifp if ifp < ifm else ifm + 8)
        ix = jm & (nside - 1)
        iy = nside - (jp & (nside - 1)) - 1
    else:
        ntt = min(3, int(tt))
        tp = tt - ntt
        tmp = nside * math.sqrt(3.0 * (1.0 - za))
        jp, jm = min(int(tp * tmp), nside - 1), min(int((1.0 - tp) * tmp), nside - 1)
        if z > 0:
            face, ix, iy = ntt, nside - jm - 1, nside - jp - 1
        else:
            face, ix, iy = ntt + 8, jp, jm
    return face * nside * nside + _spread_bits(ix) + (_spread_bits(iy) << 1)


# ---------------------------------------------------------------- HPX projection (Calabretta & Roukema 2007)
H_HPX, K_HPX = 4, 3


def hpx_forward(phi_deg, theta_deg):
    """Native (phi, theta) -> projection-plane (x, y) in degrees, H=4, K=3."""
    phi = (phi_deg + 180.0) % 360.0 - 180.0
    s = math.sin(math.radians(theta_deg))
    if abs(s) <= 2.0 / 3.0:
        return phi, 90.0 * K_HPX / H_HPX * s
    sigma = math.sqrt(K_HPX * (1.0 - abs(s)))
    phi_c = -180.0 + (2.0 * math.floor((phi + 180.0) * H_HPX / 360.0) + 1.0) * 180.0 / H_HPX
    x = phi_c + (phi - phi_c) * sigma
    y = math.copysign(180.0 / H_HPX * ((K_HPX + 1) / 2.0 - sigma), theta_deg)
    return x, y


def hpx_inverse(x, y):
    """Projection plane (x, y) degrees -> native (phi, theta) degrees, or None in the polar gaps."""
    x = (x + 180.0) % 360.0 - 180.0
    if abs(y) <= 90.0 * (K_HPX - 1) / H_HPX:
        s = y / (90.0 * K_HPX / H_HPX)
        return x, math.degrees(math.asin(max(-1.0, min(1.0, s))))
    sigma = (K_HPX + 1) / 2.0 - abs(y) * H_HPX / 180.0
    if sigma <= 0:
        return x, math.copysign(90.0, y)
    phi_c = -180.0 + (2.0 * math.floor((x + 180.0) * H_HPX / 360.0) + 1.0) * 180.0 / H_HPX
    if abs(x - phi_c) > 180.0 / H_HPX * sigma + 1e-9:
        return None                                                     # in an interruption of the plane
    phi = phi_c + (x - phi_c) / sigma
    s = 1.0 - sigma * sigma / K_HPX
    return phi, math.copysign(math.degrees(math.asin(max(-1.0, min(1.0, s)))), y)


class TileWcs:
    """Pixel <-> sky for one cube tile, from its IMAGE header (identity native rotation)."""

    def __init__(self, header):
        for key, want in (("CTYPE1", "RA---HPX"), ("CTYPE2", "DEC--HPX")):
            if str(header.get(key, "")).strip() != want:
                raise ValueError(f"unexpected {key}={header.get(key)!r} (expected {want})")
        if float(header.get("CRVAL1", 0)) != 0 or float(header.get("CRVAL2", 0)) != 0 \
                or float(header.get("LONPOLE", 0)) != 0 or float(header.get("PV2_1", 4)) != 4 \
                or float(header.get("PV2_2", 3)) != 3:
            raise ValueError("cube tile WCS differs from the verified layout (CRVAL 0,0; LONPOLE 0; H=4, K=3)")
        cd = np.array([[float(header["PC1_1"]), float(header["PC1_2"])],
                       [float(header["PC2_1"]), float(header["PC2_2"])]])
        cd = cd * np.array([[float(header.get("CDELT1", 1.0))], [float(header.get("CDELT2", 1.0))]])
        self.cd, self.cd_inv = cd, np.linalg.inv(cd)
        self.crpix = np.array([float(header["CRPIX1"]), float(header["CRPIX2"])])

    def world2pix(self, ra, dec):
        """0-based pixel coordinates (x, y) of (RA, Dec)."""
        u = self.cd_inv @ np.array(hpx_forward(ra, dec))
        p = u + self.crpix - 1.0
        return float(p[0]), float(p[1])

    def pix2world(self, x, y):
        xy = self.cd @ (np.array([x, y], float) + 1.0 - self.crpix)
        out = hpx_inverse(float(xy[0]), float(xy[1]))
        if out is None:
            return None
        return out[0] % 360.0, out[1]


# ---------------------------------------------------------------- byte-range reading
def _parse_multipart(body, content_type):
    m = re.search(r'boundary="?([^";]+)"?', content_type or "")
    if not m:
        raise ValueError("multipart reply without a boundary")
    boundary = b"--" + m.group(1).encode()
    out = {}
    pos = 0
    while True:
        start = body.find(boundary, pos)
        if start < 0:
            break
        head_start = start + len(boundary)
        if body[head_start:head_start + 2] == b"--":
            break
        head_end = body.find(b"\r\n\r\n", head_start)
        if head_end < 0:
            break
        headers = body[head_start:head_end].decode("latin-1")
        cr = re.search(r"Content-Range:\s*bytes\s+(\d+)-(\d+)/", headers, re.I)
        if not cr:
            raise ValueError("multipart part without Content-Range")
        a, b = int(cr.group(1)), int(cr.group(2))
        data_start = head_end + 4
        out[a] = body[data_start:data_start + (b - a + 1)]
        pos = data_start + (b - a + 1)
    return out


def read_ranges(url, ranges):
    """{start: bytes} for [(start, end_inclusive), ...] using as few requests as possible.
    Refuses a whole-file reply (HTTP 200): that would be a 320 MB download."""
    ranges = sorted(set(ranges))
    batches = [ranges[i:i + MAX_RANGES_PER_REQUEST] for i in range(0, len(ranges), MAX_RANGES_PER_REQUEST)]

    def one(batch):
        spec = ",".join(f"{a}-{b}" for a, b in batch)
        for attempt in range(3):
            try:
                with _session().get(url, headers={"Range": "bytes=" + spec}, timeout=TIMEOUT, stream=True) as r:
                    if r.status_code == 200:
                        raise RuntimeError("server ignored the byte ranges (would send the whole 320 MB file)")
                    if r.status_code == 404:
                        raise FileNotFoundError(f"no cube tile at {url}")
                    if r.status_code != 206:
                        raise requests.HTTPError(f"HTTP {r.status_code}")
                    body = r.content
                    ctype = r.headers.get("Content-Type", "")
                    if "multipart/byteranges" in ctype:
                        return _parse_multipart(body, ctype)
                    cr = re.search(r"bytes\s+(\d+)-(\d+)/", r.headers.get("Content-Range", ""))
                    if not cr:
                        raise ValueError("206 reply without Content-Range")
                    return {int(cr.group(1)): body}
            except (requests.RequestException, ValueError) as error:
                last = error
        raise RuntimeError(f"byte-range read failed after 3 tries: {last}")

    out = {}
    with ThreadPoolExecutor(min(WORKERS, len(batches) or 1)) as pool:
        for part in pool.map(one, batches):
            out.update(part)
    return out


class CubeTile:
    """Header + data offsets of one tile; reads pixels of the IMAGE/NHITS/FLAGS cubes."""
    _cache = {}
    _lock = threading.Lock()

    @classmethod
    def get(cls, npix):
        with cls._lock:
            if npix in cls._cache:
                return cls._cache[npix]
        tile = cls(npix)
        with cls._lock:
            cls._cache[npix] = tile
        return tile

    def __init__(self, npix):
        self.npix, self.url = npix, tile_url(npix)
        head = read_ranges(self.url, [(0, HEADER_BYTES - 1)])[0]
        self.layers = {}
        offset = 0
        primary, start = fitsio._header(head, offset)                     # PRIMARY
        self.primary = primary
        offset = start
        image, start = fitsio._header(head, offset)
        if str(image.get("EXTNAME", "")).strip() != "IMAGE":
            raise ValueError("second HDU of the tile is not IMAGE")
        self.header = image
        self.wcs = TileWcs(image)
        nx, ny, nz = int(image["NAXIS1"]), int(image["NAXIS2"]), int(image["NAXIS3"])
        if (nx, ny, nz) != (TILE, TILE, DEPTH) or int(image["BITPIX"]) != -32:
            raise ValueError(f"unexpected cube layout {nx}x{ny}x{nz}, BITPIX {image['BITPIX']}")
        self.shape = (nz, ny, nx)
        self.layers["IMAGE"] = (start, ">f4")
        size = nx * ny * nz * 4
        nxt = start + -(-size // fitsio.BLOCK) * fitsio.BLOCK
        # NHITS and FLAGS follow, same shape (verified HDU list); read their headers
        for name in ("NHITS", "FLAGS"):
            raw = read_ranges(self.url, [(nxt, nxt + 8 * fitsio.BLOCK - 1)])[nxt]
            h, s = fitsio._header(raw, 0)
            if str(h.get("EXTNAME", "")).strip() != name:
                raise ValueError(f"expected {name} after IMAGE, found {h.get('EXTNAME')}")
            dtype = {32: ">i4", -32: ">f4", 16: ">i2", 64: ">i8"}[int(h["BITPIX"])]
            self.layers[name] = (nxt + s, dtype)
            if name == "FLAGS":
                self.flag_header = h
            nbytes = nx * ny * nz * abs(int(h["BITPIX"])) // 8
            nxt = nxt + s + -(-nbytes // fitsio.BLOCK) * fitsio.BLOCK

    def read(self, layer, pixels, planes):
        """Values at [(x, y), ...] (0-based) for each plane -> array (len(planes), len(pixels))."""
        start, dtype = self.layers[layer]
        size = np.dtype(dtype).itemsize
        nz, ny, nx = self.shape
        rows = {}
        for k, (x, y) in enumerate(pixels):
            rows.setdefault(y, []).append((x, k))
        ranges, index = [], []
        for p in planes:
            for y, cols in rows.items():
                xs = sorted(c for c, _ in cols)
                x0, x1 = xs[0], xs[-1]
                a = start + size * ((p * ny + y) * nx + x0)
                ranges.append((a, a + size * (x1 - x0 + 1) - 1))
                index.append((p, y, x0, cols))
        got = read_ranges(self.url, ranges)
        out = np.full((len(planes), len(pixels)), np.nan if dtype.endswith("f4") else -1, float)
        plane_pos = {p: i for i, p in enumerate(planes)}
        for (a, _), (p, y, x0, cols) in zip(ranges, index):
            vals = np.frombuffer(got[a], dtype).astype(float)
            for x, k in cols:
                out[plane_pos[p], k] = vals[x - x0]
        return out


# ---------------------------------------------------------------- spectrum extraction
def _circle_weights(dx, dy, radius, sub=11):
    d = np.hypot(dx, dy)
    w = (d <= radius - 0.75).astype(float)
    offs = (np.arange(sub) + 0.5) / sub - 0.5
    sx, sy = np.meshgrid(offs, offs)
    for i in np.nonzero((d > radius - 0.75) & (d < radius + 0.75))[0]:
        w[i] = (np.hypot(dx[i] + sx, dy[i] + sy) <= radius).mean()
    return w


def spectrum(ra, dec, aperture_px=1.5, annulus=(6.0, 11.0), half_size=13, abs_cal_fraction=0.05,
             growth_radii=(1, 2, 3, 4, 5, 6), progress=None, planes=None):
    """Aperture-photometry spectrum (102 channels) at (RA, Dec) from the DR1 all-sky cube."""
    npix = ang2pix_nest(NSIDE_TILE, ra, dec)
    main = CubeTile.get(npix)
    x0, y0 = main.wcs.world2pix(ra, dec)
    xc, yc = int(round(x0)), int(round(y0))
    if progress:
        progress(f"cube tile {npix}: pixel ({x0:.1f}, {y0:.1f})")
    # stamp pixels in the main tile's frame; find the sky position of each and its tile
    offsets = [(dx, dy) for dy in range(-half_size, half_size + 1) for dx in range(-half_size, half_size + 1)]
    owners, missing = {}, 0
    for k, (dx, dy) in enumerate(offsets):
        px, py = xc + dx, yc + dy
        if 0 <= px < TILE and 0 <= py < TILE:
            owners.setdefault(npix, []).append((k, px, py))
            continue
        sky = main.wcs.pix2world(px, py)
        if sky is None:
            missing += 1
            continue
        other = CubeTile.get(ang2pix_nest(NSIDE_TILE, *sky))
        qx, qy = other.wcs.world2pix(*sky)
        ix, iy = int(round(qx)), int(round(qy))
        if abs(qx - ix) > 0.02 or abs(qy - iy) > 0.02 or not (0 <= ix < TILE and 0 <= iy < TILE):
            missing += 1                     # across an interruption of the HPX plane: not stitched
            continue
        owners.setdefault(other.npix, []).append((k, ix, iy))
    planes = [p for p in (planes if planes is not None else range(DEPTH)) if p not in BLANK_PLANES]
    n = len(offsets)
    stamp = np.full((DEPTH, n), np.nan)
    hits = np.full((DEPTH, n), -1.0)
    dx = np.array([o[0] for o in offsets], float) + (xc - x0)
    dy = np.array([o[1] for o in offsets], float) + (yc - y0)
    core = np.hypot(dx, dy) <= aperture_px + 1.0
    for tile_id, members in owners.items():
        tile = CubeTile.get(tile_id)
        if progress:
            progress(f"reading {len(members)} pixels x {len(planes)} channels from tile {tile_id}")
        vals = tile.read("IMAGE", [(x, y) for _, x, y in members], planes)
        stamp[np.ix_(planes, [k for k, _, _ in members])] = vals
        inner = [(k, x, y) for k, x, y in members if core[k]]
        if inner:
            h = tile.read("NHITS", [(x, y) for _, x, y in inner], planes)
            hits[np.ix_(planes, [k for k, _, _ in inner])] = h

    w_ap = _circle_weights(dx, dy, aperture_px)
    r = np.hypot(dx, dy)
    ring = (r >= annulus[0]) & (r <= annulus[1])
    # empty apertures for the empirical error: same radius, centred on a circle in the ring
    r_mid = 0.5 * (annulus[0] + annulus[1])
    n_empty = max(6, int(2 * math.pi * r_mid / (2 * aperture_px + 0.5)))
    empty_w = [_circle_weights(dx - r_mid * math.cos(a), dy - r_mid * math.sin(a), aperture_px)
               for a in np.linspace(0, 2 * math.pi, n_empty, endpoint=False)]
    wl = sed.SPHEREX_CHANNELS_UM
    to_mjy = PIXEL_SR * 1e9
    chans, growth, neighbours = [], None, []
    for p in planes:
        img = stamp[p]
        good = np.isfinite(img)
        level, sigma_pix, n_ring = stats.clipped_stats(img[ring & good], 3.0)
        if not np.isfinite(level) or n_ring < 10 or not good[w_ap > 0].all():
            chans.append({"plane": p, "lam_um": float(wl[p]), "flux": None,
                          "reason": "no data in the aperture or too few sky pixels"})
            continue
        sub = img - level
        flux_sb = float(np.sum(w_ap * sub))
        sums = [float(np.sum(w * sub)) for w in empty_w if np.all(good[w > 0])]
        sums = np.array(sums)
        sigma_empty = stats.mad_std(sums) if len(sums) >= 6 else float("nan")
        area = float(np.sum(w_ap))
        sigma_naive = sigma_pix * math.sqrt(area)
        sigma_bg = area * sigma_pix * math.sqrt(math.pi / (2 * n_ring))
        use_empty = bool(np.isfinite(sigma_empty) and sigma_empty > sigma_naive)
        sigma_use = sigma_empty if use_empty else sigma_naive
        m = Measured(flux_sb * to_mjy, "mJy", label=f"cube channel {p + 1}")
        m.add("sky noise (empty apertures)" if use_empty else "sky noise (pixel scatter)",
              sigma_use * to_mjy, STATISTICAL,
              note="empty-aperture scatter captures interpolation-correlated noise and faint stars")
        m.add("background level", sigma_bg * to_mjy, STATISTICAL)
        m.add(f"absolute calibration D{p // 17 + 1}", abs(m.value) * abs_cal_fraction, SYSTEMATIC, shared=True)
        nh = hits[p][w_ap > 0]
        chans.append({"plane": p, "channel": p % 17 + 1, "band": p // 17 + 1, "lam_um": float(wl[p]),
                      "flux": m, "nhits_min": float(np.nanmin(nh)) if np.isfinite(nh).any() else None,
                      "correlation_factor": float(sigma_empty / sigma_naive) if np.isfinite(sigma_empty) and sigma_naive > 0 else None})
        if not neighbours and p == planes[min(len(planes) - 1, len(planes) // 3)]:
            neighbours = _neighbours(sub, dx, dy, aperture_px, sigma_pix)
        if growth is None and p == planes[min(len(planes) - 1, len(planes) // 3)]:
            growth = {"plane": p, "lam_um": float(wl[p]),
                      "radius_px": list(growth_radii),
                      "flux_mJy": [float(np.sum(_circle_weights(dx, dy, gr) * sub) * to_mjy) for gr in growth_radii]}
    return {"ok": True, "tile": npix, "tile_url": main.url, "pixel": [x0, y0],
            "pixel_arcsec": PIXEL_ARCSEC, "pixel_sr": PIXEL_SR, "aperture_px": aperture_px,
            "aperture_arcsec": aperture_px * PIXEL_ARCSEC, "annulus_px": list(annulus),
            "unstitched_pixels": missing, "tiles_used": sorted(owners), "channels": chans,
            "curve_of_growth": growth, "neighbours": neighbours,
            "caveats": ([f"A neighbouring source peaks {n['offset_arcsec']:.0f}\" from the target on the cube grid ({n['peak_ratio']:.1f}x the target's peak pixel) "
                         "and sits in or next to the aperture: the cube flux includes some of "
                         "its light. Use the per-exposure photometry (6.2\" pixels) for this object."
                         for n in neighbours if n["contaminates"]] +
                        ["IRSA labels the DR1 all-sky cube 'for visualization': fluxes are quick-look.",
                        "No aperture correction (the cube's effective PSF is not published): fluxes are "
                        "the light inside the aperture. Compare the curve of growth.",
                        "The cube has no error maps; errors come from the scatter of empty apertures "
                        "(this includes noise correlated by the map interpolation and faint stars)."])}


def _neighbours(sub, dx, dy, aperture_px, sigma_pix, reach=2.0):
    """Bright pixels near (not at) the target: a crude deblending check on the coarse cube grid.

    The cube pixel is 12.9", so a star 30-40" away puts light into pixels only ~2.5 px from the
    target (verified on Tabby's Star, whose brighter neighbour 36" north lands 1.8 px away).
    A pixel counts as a separate source if it is a local maximum, lies more than 1.2 px from the
    target, is within aperture + reach px, and is above 5 sigma of the sky.
    """
    r = np.hypot(dx, dy)
    side = int(round(math.sqrt(len(sub))))
    img = sub.reshape(side, side)
    rr = r.reshape(side, side)
    centre = np.nanmax(np.where(rr <= 1.0, img, np.nan)) if np.any(rr <= 1.0) else np.nan
    out = []
    for j in range(1, side - 1):
        for i in range(1, side - 1):
            v = img[j, i]
            if not np.isfinite(v) or rr[j, i] <= 1.2 or rr[j, i] > aperture_px + reach:
                continue
            if v < 5 * sigma_pix or v < np.nanmax(img[j - 1:j + 2, i - 1:i + 2]):
                continue
            ratio = float(v / centre) if np.isfinite(centre) and centre > 0 else float("inf")
            out.append({"offset_px": float(rr[j, i]), "offset_arcsec": float(rr[j, i] * PIXEL_ARCSEC),
                        "peak_ratio": ratio,
                        "contaminates": bool(ratio > 0.2 and rr[j, i] <= aperture_px + 1.5)})
    return sorted(out, key=lambda n: n["offset_px"])
