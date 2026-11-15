"""Physical constants and unit conversions used by every lab module.

Values: SI 2019 exact constants (h, c, k_B), CODATA 2018 (sigma_SB), IAU 2012
(au), IAU 2015 Resolution B3 nominal solar values (R_sun, L_sun).
Units are written in the names (…_JY, …_SR, …_UM) so a reader always knows them.

Why units matter here: a SPHEREx pixel stores SURFACE BRIGHTNESS (MJy/sr, power
per area per frequency per solid angle: how bright each bit of sky is), but a
star is a point, so what we want is its FLUX DENSITY (Jy, power per area per
frequency). Summing surface brightness x the solid angle of each pixel (sr) over
the star's pixels converts one into the other.
"""
import numpy as np

H_PLANCK = 6.62607015e-34          # J s (exact)
C_LIGHT = 299_792_458.0            # m / s (exact)
K_BOLTZ = 1.380649e-23             # J / K (exact)
SIGMA_SB = 5.670374419e-8          # W m^-2 K^-4 (CODATA 2018)
AU_M = 1.495978707e11              # m (IAU 2012, exact)
PC_M = AU_M * 648000.0 / np.pi     # m: 1 parsec = distance at which 1 au subtends 1 arcsec
LY_M = C_LIGHT * 365.25 * 86400.0  # m (Julian year)
R_SUN_M = 6.957e8                  # m (IAU 2015 nominal)
L_SUN_W = 3.828e26                 # W (IAU 2015 nominal)
JY = 1e-26                         # W m^-2 Hz^-1
AB_ZERO_JY = 3631.0                # AB magnitude zero point: m_AB = -2.5 log10(F_nu / 3631 Jy)
# 1 au/yr in km/s: converts (proper motion in arcsec/yr) x (distance in pc) to km/s.
KMS_PER_AU_YR = AU_M / 1000.0 / (365.25 * 86400.0)      # = 4.7404704635 (IAU au, Julian year)
MAS_TO_RAD = np.pi / (180.0 * 3600.0 * 1000.0)
ARCSEC_TO_RAD = np.pi / (180.0 * 3600.0)
DEG_TO_RAD = np.pi / 180.0
MJD_J2000 = 51544.5
JULIAN_YEAR_DAYS = 365.25


def mjd_to_year(mjd):
    """Julian-year epoch (e.g. 2026.37) of a Modified Julian Date."""
    return 2000.0 + (np.asarray(mjd, float) - MJD_J2000) / JULIAN_YEAR_DAYS


def year_to_mjd(year):
    return MJD_J2000 + (np.asarray(year, float) - 2000.0) * JULIAN_YEAR_DAYS


def um_to_hz(wavelength_um):
    return C_LIGHT / (np.asarray(wavelength_um, float) * 1e-6)


def planck_nu(frequency_hz, temperature_k):
    """Planck's law B_nu(T): W m^-2 Hz^-1 sr^-1.

    Physics: a perfect absorber at temperature T glows with this spectrum.
    Written with expm1 so it stays accurate when h nu << k T (Rayleigh-Jeans
    limit), and the exponent is capped so cold/short-wavelength cases give a
    tiny number instead of an overflow."""
    nu = np.asarray(frequency_hz, float)
    x = np.minimum(H_PLANCK * nu / (K_BOLTZ * np.asarray(temperature_k, float)), 700.0)
    return 2.0 * H_PLANCK * nu ** 3 / C_LIGHT ** 2 / np.expm1(x)


def blackbody_fnu_jy(wavelength_um, temperature_k, solid_angle_sr):
    """Flux density (Jy) of a sphere of temperature T that covers solid_angle_sr of
    sky: F_nu = Omega * B_nu(T), with Omega = pi (R/d)^2 for a star of radius R at
    distance d (a uniformly bright disc)."""
    return solid_angle_sr * planck_nu(um_to_hz(wavelength_um), temperature_k) / JY


def flambda_to_fnu_jy(flux_w_m2_nm, wavelength_nm):
    """F_lambda (W m^-2 nm^-1, e.g. Gaia XP) -> F_nu (Jy): F_nu = F_lambda lambda^2 / c."""
    lam_m = np.asarray(wavelength_nm, float) * 1e-9
    flam_per_m = np.asarray(flux_w_m2_nm, float) * 1e9          # W m^-2 m^-1
    return flam_per_m * lam_m ** 2 / C_LIGHT / JY


def nu_fnu_w_m2(fnu_jy, wavelength_um):
    """nu F_nu = lambda F_lambda (W m^-2): power per logarithmic wavelength interval,
    the natural y-axis of a spectral energy distribution (equal areas = equal power)."""
    return np.asarray(fnu_jy, float) * JY * um_to_hz(wavelength_um)


def ab_magnitude(fnu_jy, sigma_jy=None):
    """AB magnitude and its 1-sigma error (first order: dm = 2.5/ln10 * dF/F)."""
    f = np.asarray(fnu_jy, float)
    with np.errstate(invalid="ignore", divide="ignore"):
        mag = np.where(f > 0, -2.5 * np.log10(f / AB_ZERO_JY), np.nan)
        if sigma_jy is None:
            return mag
        return mag, np.where(f > 0, 2.5 / np.log(10) * np.asarray(sigma_jy, float) / f, np.nan)


def pixel_solid_angle_sr(sky, x, y, step=0.5):
    """Solid angle (sr) of the detector pixel at (x, y) (0-based pixel coordinates).

    Physics: a pixel is a little patch of sky; its area on the celestial sphere
    is |det J| where J is the 2x2 matrix of derivatives of (RA cos Dec, Dec) with
    respect to (x, y) (the local Jacobian of the World Coordinate System, WCS, the
    header recipe that turns pixels into sky positions). Using the file's own WCS
    INCLUDING its SIP distortion terms means pixels near the detector edge, which
    are slightly larger on the sky, get their true area.
    """
    x, y = float(x), float(y)
    ra1, dec1 = sky.pix2world(np.array([x - step, x + step, x, x]), np.array([y, y, y - step, y + step]))
    ra1, dec1 = np.asarray(ra1, float), np.asarray(dec1, float)
    dra = (ra1[[1, 3]] - ra1[[0, 2]] + 540.0) % 360.0 - 180.0   # wrap-safe RA differences
    cosd = np.cos(np.radians(float(np.mean(dec1))))
    j = np.array([[dra[0] * cosd, dra[1] * cosd], [dec1[1] - dec1[0], dec1[3] - dec1[2]]]) / (2 * step)
    return abs(np.linalg.det(j)) * DEG_TO_RAD ** 2
