"""Numbers and paths that control the backend. Change behaviour here, not in the code."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
# The website folder. Default: the "frontend" folder next to "backend".
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
CACHE_DIR = BACKEND_DIR / "cache"
# SPEED: finished Star Vault results built once with  python main.py --prebuild.
# Small JSON files (frames as PNG); commit them so the vault is instant everywhere.
PREBUILT_DIR = BACKEND_DIR / "data" / "prebuilt"
PREBUILD_RADIUS_ARCMIN = 2.0          # used by older code paths; the list below is what gets built
# Every radius the Star Vault offers is prebuilt. The Drive files are cutouts about
# 58 pixels (≈ 6′) wide, so they hold sky only out to ≈ 3′ from the target: at 5′
# the cutout fills the middle and the border is shown as "no data". Bigger radii
# would be almost all border, so the vault stops at 5′ (Sky Probe goes to 15′ via IRSA).
VAULT_RADII_ARCMIN = [0.5, 1, 1.5, 2, 3, 5]

# On a server (Render) set HOST=0.0.0.0; Render gives the port in $PORT.
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8765"))

# ---------------------------------------------------------------- physics constants
# Angular size of one SPHEREx pixel on the sky, arcseconds (1° = 3600″).
PIXEL_ARCSEC = 6.15

# Year that catalogue positions are moved to before searching the archive.
# SPHEREx survey began May 2025, so 2026.0 is close to the middle of the data.
SEARCH_EPOCH = 2026.0

# Julian year in days, and the MJD of J2000.0 (2000-01-01 12:00 TT).
# MJD = Modified Julian Date: days since 1858-11-17 00:00, the standard
# astronomy clock that avoids calendar arithmetic.
JULIAN_YEAR_DAYS = 365.25
MJD_J2000 = 51544.5

# ---------------------------------------------------------------- input limits
RADIUS_MIN_ARCMIN = 0.3      # 0.005°: about 3 pixels either side of the target
RADIUS_MAX_ARCMIN = 15.0     # 0.25°: download time grows with radius squared
RADIUS_DEFAULT_ARCMIN = 3.0
BANDS = {                    # detector -> wavelength range, µm. VERIFIED 15 Nov 2026: IRSA SPHEREx data-products page
    1: (0.75, 1.09), 2: (1.10, 1.62), 3: (1.63, 2.41),
    4: (2.42, 3.82), 5: (3.83, 4.41), 6: (4.42, 5.00),
}
FPS_CHOICES = [0.5, 1, 2, 3, 4, 6, 8, 12]

# ---------------------------------------------------------------- archive behaviour
# SPEED: download time grows linearly with this. 24 evenly spaced exposures
# still sample every visit; raise it for more frames, lower it for speed.
MAX_EXPOSURES = 24           # was 40; the page now lets the user choose (24 / 48 / 96 / all)
# "All" still has a ceiling so one request can never pull thousands of files (deep fields
# near the ecliptic poles have hundreds of exposures per detector).
MAX_EXPOSURES_ALL = 400
EXPOSURE_CHOICES = [24, 48, 96, 0]   # 0 = all (up to MAX_EXPOSURES_ALL)
# SPEED: parallel downloads. Each short download is ~0.1 MB, so the wait is
# mostly network round-trips; more workers overlap them. Keep <= 12 to be
# polite to IRSA (watch for HTTP 429/503 errors).
DOWNLOAD_WORKERS = 10        # was 6
# SPEED: reuse an archive search (TAP) for this long. New SPHEREx data arrive
# weekly, so a day-old exposure list is still correct for a demo.
SEARCH_TTL_HOURS = 24
# SPEED: an IRSA search that hangs must not block the site. Each search request
# waits at most TAP_TIMEOUT_SECONDS; all tries together (sync retries + async job)
# stop after TAP_BUDGET_SECONDS, then the next data source is used.
TAP_TIMEOUT_SECONDS = 45
TAP_BUDGET_SECONDS = 45
# Sky Probe: IRSA's position search can take over a minute when the archive is busy.
# We run TAP and SIA (two IRSA search services) at the same time and use whichever
# answers first; give up on both after this many seconds.
IRSA_SEARCH_BUDGET_SECONDS = 150
DOWNLOAD_ATTEMPTS = 3
TIMEOUT_SECONDS = 120
VISIT_GAP_DAYS = 30          # exposures closer than this belong to the same visit
VISIT_MAX_DAYS = 14          # ...but one visit never spans more than this (deep fields are observed daily)

# ---------------------------------------------------------------- warnings
# Relative wavelength difference above which two frames are "different colours".
# SPHEREx resolving power R = λ/Δλ is about 35–130, i.e. one spectral channel
# is roughly 1–3 % wide, so 1 % is a conservative threshold.
WAVELENGTH_WARN_FRACTION = 0.01
FLAGGED_WARN_FRACTION = 0.20
