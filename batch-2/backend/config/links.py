"""Every web address (API) the backend uses, in one place, with what each is for.

Nothing else in the backend may contain a URL. If IRSA moves something, fix it here.
"""

# ---------------------------------------------------------------- NASA/IPAC IRSA
# Infrared Science Archive: the only source of SPHEREx pixels.
IRSA = "https://irsa.ipac.caltech.edu"

# TAP (Table Access Protocol): an IVOA standard web service. We POST a query
# written in ADQL (SQL plus sky geometry such as CONTAINS/POINT) and get back a
# table of every SPHEREx exposure whose footprint contains our position.
TAP_SYNC = IRSA + "/TAP/sync"
# Same service, but as a JOB: submit the query, poll until done, fetch the
# result. Slower to start, but survives queries the sync endpoint refuses or
# times out on. Used automatically as a fallback.
TAP_ASYNC = IRSA + "/TAP/async"
# SIA v2 (Simple Image Access, another IVOA standard): "which image files cover this
# point?". Used alongside TAP; whichever answers first wins.
# VERIFIED 15 Nov 2026 from the team PC: spherex_dr1 answers in ~1 s (258 exposures of
# WISE 0855, May 2025 - May 2026); spherex_qr and spherex_qr3 returned none there.
# IRSA's DR1 page: "DR1 spectral images are intended to be used together with the QR3
# spectral images as a uniformly processed set." So we ask BOTH and merge them; the older
# QR2 is only a last resort and is never mixed with them.
SIA = IRSA + "/SIA"
SIA_COLLECTIONS = ["spherex_dr1", "spherex_qr3"]
SIA_FALLBACK_COLLECTIONS = ["spherex_qr2", "spherex_qr"]
TAP_CAPABILITIES = IRSA + "/TAP/capabilities"     # used by --check to test the service

# TAP tables we query (joined on planeid):
TAP_TABLE_ARTIFACT = "spherex.artifact"    # one row per file: its path (uri)
TAP_TABLE_PLANE = "spherex.plane"          # one row per exposure: time, footprint, band

# Every SPHEREx image file lives under this address.
DATA_ROOT = IRSA + "/ibe/data/spherex/"

# Appended to an image address, this makes IRSA crop the image on its server
# (a "cutout") around a sky position. size is the full width in degrees.
# gzip=false asks for plain FITS (Flexible Image Transport System, the
# standard astronomy file: text header + binary data, in layers called HDUs).
CUTOUT_QUERY = "?center={ra:.7f},{dec:.7f}d&size={size:.6f}deg&gzip=false"

# Data releases, newest first. All frames of one request share one calibration:
# DR1 + QR3 together (IRSA: "a uniformly processed set"), otherwise QR2 alone.
RELEASES = ["dr1", "qr3", "qr2"]
COMPATIBLE = {"dr1": ("dr1", "qr3"), "qr3": ("dr1", "qr3"), "qr2": ("qr2",)}
RELEASE_DOI = {"dr1": "10.26131/IRSA678", "qr3": "10.26131/IRSA662", "qr2": "10.26131/IRSA652",
               "dr1+qr3": "10.26131/IRSA678 (DR1) and 10.26131/IRSA662 (QR3)"}
DOC_DR1_OVERVIEW = IRSA + "/data/SPHEREx/docs/overview_dr1.html"

# ---------------------------------------------------------------- documentation
# (Not called by the code; shown in /api/links and kept for credits.)
DOC_CUTOUT_PARAMETERS = IRSA + "/ibe/cutouts.html"
DOC_RELEASE_OVERVIEW = IRSA + "/data/SPHEREx/docs/overview_qr.html"
DOC_EXPLANATORY_SUPPLEMENT = IRSA + "/data/SPHEREx/docs/SPHEREx_Expsupp_QR.pdf"
DOC_DATA_PRODUCTS = "https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products"
DOC_DATA_ACCESS = "https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access"
DOC_CUTOUT_TUTORIAL = "https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts"

# ---------------------------------------------------------------- used by the frontend
# Aladin Lite v3 (CDS Strasbourg sky viewer) and SIMBAD (object catalogue used
# to check target positions and proper motions).
ALADIN_LITE_JS = "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js"
SIMBAD = "https://simbad.cds.unistra.fr/simbad/"

# ---------------------------------------------------------------- context layers (api/context.py)
# Gaia (ESA, a 2026 Space Agency Partner): positions, proper motions and parallaxes of
# ~1.8 billion stars, measured at epoch 2016.0. Queried with ADQL over TAP. ESA's own
# archive first; IRSA keeps a copy (table gaia_dr3_source).
GAIA_TAP = [
    ("ESA Gaia Archive", "https://gea.esac.esa.int/tap-server/tap/sync", "gaiadr3.gaia_source"),
    ("IRSA copy of Gaia DR3", IRSA + "/TAP/sync", "gaia_dr3_source"),
]
# OLDER NASA IMAGES of the same patch, from IRSA itself (VERIFIED 15 Nov 2026 from the team PC:
# SIA answers in ~2 s, server-side cutouts in ~1.3 s, ~145 KB). Each image comes with its exact
# observation date. (CDS hips2fits, used before, was withdrawn in Nov 2026.)
#   2MASS All-Sky Atlas images (NASA/NSF, 1997-2001): 1.0″ pixels, J/H/K, SIN projection
#   AllWISE Atlas images (NASA, 2010-11): 1.375″ pixels, W1-W4, SIN projection
SIA_2MASS = "twomass_allsky"
SIA_ALLWISE = "wise_allwise"

# Sky atlas backgrounds (Aladin). CDS stopped serving these from alasky in Nov 2026; its list
# (https://cds.unistra.fr/hips_available_20261109.html) names these mirrors. The page tries
# them in order and keeps the first that answers.
HIPS_MIRRORS = {
    # order = fastest first, measured from the team PC in India on 15 Nov (0.43 s CSIRO, 0.58 s ESA, 1.0-1.3 s China-VO)
    "2mass": ["https://casda.csiro.au/hips/2MASS/Color", "https://skies.esac.esa.int/2MASSColor",
              "https://hips.china-vo.org/m/CDS_P_2MASS_color"],
    "allwise": ["https://skies.esac.esa.int/AllWISEColor", "https://hips.china-vo.org/m/CDS_P_allWISE_color"],
    "dss": ["https://casda.csiro.au/hips/DSS2/color", "https://skies.esac.esa.int/DSSColor",
            "https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/DSSColor",
            "https://hips.china-vo.org/m/CDS_P_DSS2_color"],
}

# JPL Small-Body Identification (NASA/JPL Solar System Dynamics): "which known asteroids and
# comets were inside this field of view at this time?" Docs: https://ssd-api.jpl.nasa.gov/doc/sb_ident.html
JPL_SB_IDENT = "https://ssd-api.jpl.nasa.gov/sb_ident.api"
# IRSA tools we hand users over to (they need the coordinates typed in; we copy them for the user)
IRSA_SPECTROPHOTOMETRY = IRSA + "/applications/spherex/tool-spectrophotometry"
IRSA_SPHEREX_EXPLORER = IRSA + "/applications/spherex/"
IRSA_MOST = IRSA + "/applications/MOST/"


def public():
    """The list served at /api/links, so the website can show its sources."""
    return {
        "irsa": IRSA, "tap": TAP_SYNC, "cutouts": DOC_CUTOUT_PARAMETERS,
        "release_overview": DOC_RELEASE_OVERVIEW,
        "explanatory_supplement": DOC_EXPLANATORY_SUPPLEMENT,
        "data_products": DOC_DATA_PRODUCTS, "data_access": DOC_DATA_ACCESS,
        "cutout_tutorial": DOC_CUTOUT_TUTORIAL,
        "aladin": ALADIN_LITE_JS, "simbad": SIMBAD,
        "release_doi": RELEASE_DOI,
        "spectrophotometry": IRSA_SPECTROPHOTOMETRY, "spherex_explorer": IRSA_SPHEREX_EXPLORER,
        "most": IRSA_MOST, "dr1_overview": DOC_DR1_OVERVIEW,
        "hips_mirrors": HIPS_MIRRORS,
    }
