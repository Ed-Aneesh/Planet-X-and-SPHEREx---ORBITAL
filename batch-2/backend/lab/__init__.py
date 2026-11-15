"""Science Lab: a modular, stand-alone scientific pipeline for SPHEREx data.

This package is deliberately SEPARATE from the image-blinking pipeline in
api/, archive/ and science/: nothing there imports from here, so the main
website keeps working exactly as before. The lab re-uses the existing archive
code (IRSA search, downloads, FITS reader) but never changes it.

Modules (each one stage of the work, usable on its own):
  units.py          physical constants (CODATA 2018 / IAU 2015) and unit conversions
  stats.py          special functions and statistical tests (numpy only)
  uncertainty.py    error propagation: linear (Jacobian) + Monte Carlo + error budgets
  fitsx.py          FITS reader for multi-row binary tables (the SPHEREx ePSF table)
  spectral_image.py one SPHEREx spectral image: flags by NAME, ZODI, VARIANCE, ePSF,
                    wavelength + bandwidth, pixel solid angle
  photometry.py     aperture photometry and ePSF-fitting (PSF) photometry
  sed.py            spectral energy distributions: binning, blackbody / power-law fits
  variability.py    light curves, Lomb-Scargle periodogram, false-alarm probability
  cube.py           the SPHEREx DR1 all-sky spectral cube (HiPS, read by byte ranges)
  gaia.py           Gaia DR3 astrometry, astrophysics, XP spectra, rigorous epoch propagation
  pipeline.py       the stage framework: provenance, timing, failure isolation
  stages.py         the concrete stages wired into pipelines
  api.py            /api/lab/... HTTP endpoints (a job runner of its own)
  selftest.py       independent checks (python main.py --lab-selftest)

Only numpy and requests are required. astropy/scipy are used, if installed,
ONLY by the self-test as independent references.
"""
LAB_VERSION = "1.0.0"
