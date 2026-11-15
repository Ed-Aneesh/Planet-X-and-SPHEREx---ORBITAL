"""One SPHEREx spectral image (Level 2 MEF cutout), read for PHOTOMETRY.

What is in the file (verified on real DR1/QR3 files, pipeline 7.0.5):
  IMAGE     surface brightness, MJy/sr (zodiacal light NOT yet removed)
  FLAGS     32-bit mask; bit names in the header as MSKNnnnn='OVERFLOW' + MSKMnnnn=bitmask
            (older QR files used MP_OVERFLOW=<bit> instead; both are read here)
  VARIANCE  per-pixel variance, (MJy/sr)^2: the pipeline's estimate of the random noise
  ZODI      model of zodiacal light (sunlight scattered by interplanetary dust: a smooth
            glow that changes with date and direction), MJy/sr, to subtract
  EPSF      (DR1/QR3) binary table, 441 rows = 21x21 zones across the 2040x2040 detector;
            each row a 33x33 effective PSF oversampled 5x (OVSMPX/OVSMPY), x-fastest,
            peak at the central sample, sum over the oversampled grid = 1.000
            (verified on a real file, 15 Nov 2026). Identical for every exposure of a
            detector and pipeline version (verified on three exposures, Apr 2025-Oct 2026).
  PSF       (older QR files) image cube 121 x 101 x 101, OVERSAMP=10, centres XCTR_i/YCTR_i.
            Files older than pipeline 6.5.6 have a known header error in this layer
            (IRSA notice, March 2026), so they are refused here.
  WCS-WAVE  lookup table: wavelength and bandwidth (um) on an 11x11 grid of detector pixels

PSF (point spread function): the pattern of light a perfect point (a star) makes on
the detector, set by the optics and the pixel size. An EFFECTIVE PSF (ePSF) already
includes the averaging over a pixel, so sampling it at pixel centres gives the
fraction of a star's light that falls in each pixel.
"""
import math
import re

import numpy as np

from lab import fitsx, units
from science import compat

# How each flag name is used. Names come from the file's own header.
BAD_FLAGS = {"TRANSIENT", "OVERFLOW", "SUR_ERROR", "NONFUNC", "DICHROIC", "MISSING_DATA", "MISSING",
             "HOT", "COLD", "NONLINEAR", "PERSIST", "OUTLIER", "BLOOM", "SNOWBALL"}
WARN_FLAGS = {"PHANMISS", "CROSSTALK", "GHOST", "GHOST_FPA", "GHOST_EXT", "STREAK", "HALO", "PHANTOM"}
SOURCE_FLAGS = {"SOURCE"}          # "pixel mapped to a known source": fine in an aperture, not in a background
INFO_FLAGS = {"FULLSAMPLE"}        # bookkeeping only
MIN_PSF_VERSION = (6, 5, 6)        # IRSA: PSF header error fixed in pipeline 6.5.6


def _version_tuple(text):
    nums = [int(n) for n in re.findall(r"\d+", str(text or ""))[:3]]
    return tuple(nums + [0] * (3 - len(nums)))


def flag_masks(header):
    """name -> bitmask, read from the FLAGS header (MSKN/MSKM style, or old MP_ style)."""
    masks = {}
    for key, value in header.items():
        m = re.fullmatch(r"MSKN(\d+)", key)
        if m:
            name = str(value).strip().upper()
            bit = header.get(f"MSKM{m.group(1)}")
            masks[name] = int(bit) if bit is not None else 1 << int(m.group(1))
        elif key.startswith("MP_"):
            masks[key[3:].strip().upper()] = 1 << int(value)
    return masks


class EPSF:
    """Effective PSFs of one detector, one per zone, and how to draw them."""

    def __init__(self, centres_x, centres_y, stamps, oversample_x, oversample_y, wave=None, source=""):
        self.cx = np.asarray(centres_x, float)
        self.cy = np.asarray(centres_y, float)
        self.stamps = np.asarray(stamps, float)               # (zones, ny, nx), [y, x]
        self.ox, self.oy = int(oversample_x), int(oversample_y)
        self.wave = None if wave is None else np.asarray(wave, float)
        self.source = source
        n = self.stamps.shape[1]
        if self.stamps.shape[2] != n or n % 2 == 0:
            raise ValueError("ePSF stamps must be square with an odd size (centred on the middle sample)")
        self.half = (n - 1) / 2.0
        # normalisation: an ePSF sampled at native-pixel spacing must sum to 1;
        # the oversampled grid then sums to ox*oy. (Real DR1 tables sum to 1 -> factor 25.)
        sums = self.stamps.reshape(len(self.stamps), -1).sum(axis=1)
        if np.any(sums <= 0):
            raise ValueError("ePSF with non-positive total")
        self.scale = (self.ox * self.oy) / sums
        self.extent = self.half / max(self.ox, self.oy)       # native pixels from centre to edge

    @classmethod
    def from_table(cls, columns, header):
        stamps = np.asarray(columns["EPSF"], float)
        if stamps.ndim == 2:                                  # TDIM missing: square it
            side = int(round(math.sqrt(stamps.shape[1])))
            stamps = stamps.reshape(len(stamps), side, side)
        return cls(columns["XCENTER"], columns["YCENTER"], stamps,
                   header.get("OVSMPX", 5), header.get("OVSMPY", 5),
                   columns.get("CWAVE"), source="EPSF table (DR1/QR3)")

    @classmethod
    def from_cube(cls, cube, header):
        xs, ys = {}, {}
        for key, value in header.items():
            m = re.fullmatch(r"([XY])CTR_(\d+)", key)
            if m:
                (xs if m.group(1) == "X" else ys)[int(m.group(2))] = float(value)
        ids = sorted(set(xs) & set(ys))
        if len(ids) != cube.shape[0]:
            raise ValueError("PSF cube: zone-centre keywords do not match the number of planes")
        o = int(header.get("OVERSAMP", 10))
        return cls([xs[i] for i in ids], [ys[i] for i in ids], cube[[i - 1 for i in ids]], o, o,
                   source="PSF cube (QR, pipeline >= 6.5.6)")

    def zone(self, x_det, y_det):
        """Index of the zone whose centre is nearest to detector pixel (x_det, y_det)."""
        d2 = (self.cx - x_det) ** 2 + (self.cy - y_det) ** 2
        return int(np.argmin(d2))

    def neighbours(self, x_det, y_det, n=4):
        d2 = (self.cx - x_det) ** 2 + (self.cy - y_det) ** 2
        return [int(i) for i in np.argsort(d2)[:n]]

    def render(self, zone, xs, ys, x0, y0, flip_x=False, flip_y=False, transpose=False):
        """Fraction of a unit-flux point source at (x0, y0) landing in pixels centred at (xs, ys).

        xs, ys: arrays of pixel-centre coordinates (same shape). Bilinear interpolation of
        the oversampled ePSF; zero outside its extent."""
        stamp = self.stamps[zone]
        if transpose:
            stamp = stamp.T
        if flip_x:
            stamp = stamp[:, ::-1]
        if flip_y:
            stamp = stamp[::-1, :]
        u = self.half + (np.asarray(xs, float) - x0) * self.ox       # oversampled column
        v = self.half + (np.asarray(ys, float) - y0) * self.oy       # oversampled row
        n = stamp.shape[0]
        inside = (u >= 0) & (u <= n - 1) & (v >= 0) & (v <= n - 1)
        i0 = np.clip(np.floor(u).astype(int), 0, n - 2)
        j0 = np.clip(np.floor(v).astype(int), 0, n - 2)
        fu, fv = u - i0, v - j0
        val = (stamp[j0, i0] * (1 - fu) * (1 - fv) + stamp[j0, i0 + 1] * fu * (1 - fv)
               + stamp[j0 + 1, i0] * (1 - fu) * fv + stamp[j0 + 1, i0 + 1] * fu * fv)
        return np.where(inside, val * self.scale[zone], 0.0)


class GaussianPSF:
    """Fallback when the file has no usable PSF layer: a circular Gaussian with the
    FWHM given in the IMAGE header (PSF_FWHM, arcsec), INTEGRATED over each square
    pixel exactly with error functions (so it is an effective PSF too).
    FWHM (full width at half maximum) = 2 sqrt(2 ln 2) sigma = 2.3548 sigma."""

    source = "Gaussian from PSF_FWHM header (approximation: real SPHEREx PSFs are not Gaussian)"

    def __init__(self, fwhm_pixels):
        self.sigma = fwhm_pixels / (2.0 * math.sqrt(2.0 * math.log(2.0)))
        self.extent = 5.0 * self.sigma

    def zone(self, x_det, y_det):
        return 0

    def neighbours(self, x_det, y_det, n=4):
        return [0]

    def render(self, zone, xs, ys, x0, y0, **_):
        s = self.sigma * math.sqrt(2.0)
        dx, dy = np.asarray(xs, float) - x0, np.asarray(ys, float) - y0
        erf = np.vectorize(math.erf)
        fx = 0.5 * (erf((dx + 0.5) / s) - erf((dx - 0.5) / s))
        fy = 0.5 * (erf((dy + 0.5) / s) - erf((dy - 0.5) / s))
        return fx * fy


class SpectralImage:
    """A SPHEREx spectral image with everything photometry needs, in physical units."""

    def __init__(self, body, url="", psf=None):
        self.url = url
        self.cutout = compat.Cutout(body)
        layers = fitsx.by_name(body)
        self.layers = layers
        self.header = dict(self.cutout.header("IMAGE"))
        primary = layers.get("PRIMARY")
        self.version = str((primary.header if primary else {}).get("VERSION", self.header.get("VERSION", "")))
        self.image = np.asarray(self.cutout.data("IMAGE"), float)
        self.zodi = np.asarray(self.cutout.data("ZODI"), float) if self.cutout.has("ZODI") else None
        self.variance = np.asarray(self.cutout.data("VARIANCE"), float) if self.cutout.has("VARIANCE") else None
        self.sky = self.cutout.sky()
        self.mjd = float(self.header.get("MJD-AVG") or self.header.get("MJD-OBS") or "nan")
        self.mjd_begin = float(self.header.get("MJD-BEG") or self.mjd)
        self.mjd_end = float(self.header.get("MJD-END") or self.mjd)
        self.detector = int(str(self.header.get("DETECTOR", "0")).strip() or 0)
        self.crpix_a = (float(self.header.get("CRPIX1A", 0.0)), float(self.header.get("CRPIX2A", 0.0)))
        self.notes = []

        # ---- flags, by name
        self.flag_names = {}
        flags = np.zeros(self.image.shape, np.int64)
        if self.cutout.has("FLAGS"):
            flags = np.asarray(self.cutout.data("FLAGS")).astype(np.int64) & 0xFFFFFFFF
            self.flag_names = flag_masks(dict(self.cutout.header("FLAGS")))
        self.flags = flags
        unknown = [n for n in self.flag_names if n not in BAD_FLAGS | WARN_FLAGS | SOURCE_FLAGS | INFO_FLAGS]
        if unknown:
            self.notes.append("Flag names not in our table (treated as warnings): " + ", ".join(sorted(unknown)))
        self.bad = self._mask(BAD_FLAGS)
        self.warn = self._mask(WARN_FLAGS | set(unknown))
        self.source = self._mask(SOURCE_FLAGS)
        if not self.flag_names and self.cutout.has("FLAGS"):
            self.notes.append("FLAGS layer has no bit names: no pixel was masked.")

        # ---- PSF
        self.psf, self.psf_reason = psf, ""
        if self.psf is None:
            self.psf, self.psf_reason = self._read_psf()

    def _mask(self, names):
        bits = 0
        for name, value in self.flag_names.items():
            if name in names:
                bits |= int(value)
        return (self.flags & bits) != 0

    def _read_psf(self):
        try:
            if "EPSF" in self.layers:
                hdu = self.layers["EPSF"]
                return EPSF.from_table(fitsx.table(hdu), hdu.header), ""
            if "PSF" in self.layers:
                if _version_tuple(self.version) < MIN_PSF_VERSION:
                    reason = (f"PSF layer of pipeline {self.version} has the known header error "
                              "(fixed in 6.5.6); not used")
                    return self._gaussian(), reason
                hdu = self.layers["PSF"]
                return EPSF.from_cube(np.asarray(hdu.image(), float), hdu.header), ""
        except (ValueError, KeyError) as error:
            return self._gaussian(), f"PSF layer unreadable ({error})"
        return self._gaussian(), "file has no PSF layer (downloaded without it)"

    def _gaussian(self):
        fwhm_arcsec = float(self.header.get("PSF_FWHM", 0) or 0)
        if not fwhm_arcsec > 0:
            return None
        cy, cx = (np.array(self.image.shape) - 1) / 2.0
        pix = math.sqrt(units.pixel_solid_angle_sr(self.sky, cx, cy)) / units.ARCSEC_TO_RAD
        return GaussianPSF(fwhm_arcsec / pix)

    # ---- geometry
    def to_pixel(self, ra, dec):
        x, y = self.sky.world2pix(ra, dec)
        return float(np.asarray(x)), float(np.asarray(y))

    def detector_xy(self, x, y):
        """0-based pixel on the full 2040x2040 detector (IRSA PSF tutorial: 1 + x - CRPIX1A)."""
        return 1.0 + x - self.crpix_a[0], 1.0 + y - self.crpix_a[1]

    def solid_angle_sr(self, x, y):
        return units.pixel_solid_angle_sr(self.sky, x, y)

    def wavelength_bandwidth(self, x, y):
        """(wavelength, bandwidth) in um at cutout pixel (x, y), from the WCS-WAVE table.

        Coordinate convention verified against astropy's WAVE-TAB evaluation on a real
        file (agreement 2e-16 um): table coordinate = CRVALiW + CDELTiW * ((x+1) - CRPIXiW)."""
        if "WCS-WAVE" not in self.layers:
            return None, None
        t = fitsx.table(self.layers["WCS-WAVE"])
        gx, gy = np.asarray(t["X"][0], float), np.asarray(t["Y"][0], float)
        values = np.asarray(t["VALUES"][0], float)                 # [iy, ix, (wave, band)]
        h = self.header
        px = float(h.get("CRVAL1W", 1)) + float(h.get("CDELT1W", 1)) * ((x + 1) - float(h.get("CRPIX1W", 0)))
        py = float(h.get("CRVAL2W", 1)) + float(h.get("CDELT2W", 1)) * ((y + 1) - float(h.get("CRPIX2W", 0)))
        i = int(np.clip(np.searchsorted(gx, px) - 1, 0, len(gx) - 2))
        j = int(np.clip(np.searchsorted(gy, py) - 1, 0, len(gy) - 2))
        fx = (px - gx[i]) / (gx[i + 1] - gx[i])
        fy = (py - gy[j]) / (gy[j + 1] - gy[j])
        out = []
        for k in range(values.shape[2]):
            g = values[:, :, k]
            out.append(float(g[j, i] * (1 - fx) * (1 - fy) + g[j, i + 1] * fx * (1 - fy)
                             + g[j + 1, i] * (1 - fx) * fy + g[j + 1, i + 1] * fx * fy))
        return (out[0], out[1]) if len(out) > 1 else (out[0], None)

    def calibrated(self):
        """IMAGE minus the zodiacal-light model, MJy/sr; bad pixels NaN."""
        img = self.image - (self.zodi if self.zodi is not None else 0.0)
        img = np.where(self.bad, np.nan, img)
        return img
