/* =====================================================================
   content.js — ALL editable text and data for the site.
   Edit words here, not in the HTML. Elements with data-k="a.b.c"
   are filled from TEXT.a.b.c by core.js.
   ===================================================================== */

window.TEXT = {
  brand: "ORBITAL",
  navCta: "Launch explorer",
  nav: [
    { href: "index.html#idea", label: "Idea" },
    { href: "index.html#pipeline", label: "Pipeline" },
    { href: "index.html#targets", label: "Targets" },
    { href: "index.html#spectrum", label: "Spectrum" },
    { href: "index.html#glossary", label: "Glossary" },
    { href: "lab.html", label: "Science Lab" },
    { href: "science.html", label: "Science & credits" }
  ],

  hero: {
    eyebrow: "NASA Space Apps 2026 · SPHEREx challenge",
    line1: "Watch the infrared sky",
    line2Prefix: "and spot what",
    rotator: ["moves.", "flickers.", "brightens.", "fades."],
    subtitle: "Pick a target or type a sky position. ORBITAL lines up every SPHEREx near-infrared image of that patch and plays them like a short video, so moving and changing objects stand out.",
    primaryCta: "Open Star Vault",
    secondaryCta: "How it works",
    stats: [
      { value: "102", label: "wavelength channels (0.75–5.0 µm)" },
      { value: "6", label: "detectors" },
      { value: "19", label: "targets ready to play (5 challenge)" },
      { value: "All-sky", label: "coverage, repeated every ~6 months" }
    ]
  },

  marquee: ["Barnard's Star", "Epsilon Indi B", "WISE 0855−0714", "RW Aurigae", "R Draconis", "SPHEREx", "NASA/IPAC IRSA", "Aladin Lite"],

  portals: {
    num: "00", label: "Two doors",
    title: "Start from a famous object, or from anywhere",
    text: "Star Vault plays 19 curated targets from the team's copy of real SPHEREx files. Sky Probe lets you type any position and asks the live NASA archive.",
    vault: {
      name: "Star Vault",
      tagline: "Curated targets, ready to play.",
      points: ["The 5 challenge targets plus 14 more", "Filter by: moves, varies, exploded", "Real SPHEREx files from the team's Drive copy: fast, no live archive calls"],
      cta: "Enter the vault"
    },
    probe: {
      name: "Sky Probe",
      tagline: "Any RA / Dec, live from the archive.",
      points: ["Type coordinates or click the sky map", "Choose band, radius and dates", "Fetched live from NASA/IPAC IRSA by our Python backend"],
      cta: "Probe the sky"
    }
  },

  sections: {
    idea: {
      num: "01", label: "The idea",
      title: "Blink the sky, find what changed",
      text: "Astronomers have found moving and varying objects for a century by \"blinking\": flipping quickly between two pictures of the same patch of sky taken at different times. Anything fixed stays still; anything that moved jumps; anything that changed brightness flickers. SPHEREx images the whole sky every six months, so it is a natural blinking machine.",
      bullets: [
        "Fixed background stars stay in place, so the eye ignores them",
        "Nearby stars and brown dwarfs shift because of proper motion (their real motion across the sky)",
        "Variable stars and young stars change brightness between visits"
      ],
      demoTitle: "Blink demo",
      demoBadge: "Schematic",
      demoHint: "Drawn dots for explanation only. Real SPHEREx frames are in Star Vault and Sky Probe."
    },
    pipeline: {
      num: "02", label: "Pipeline",
      title: "From archive to video in five steps",
      text: "The Python backend does the science; the browser only plays the result.",
      steps: [
        { t: "Query", d: "Find every SPHEREx exposure that contains the position: in the team's Drive copy of IRSA files (Star Vault), or live from NASA/IPAC IRSA with a TAP query, a standard archive request written in ADQL, SQL with sky geometry (Sky Probe)." },
        { t: "Cut out", d: "Download only a small square around the target (a cutout) instead of the full 2040×2040 image." },
        { t: "Clean", d: "Subtract zodiacal light (glow from sunlit dust in the solar system), mask bad pixels using the flag image, and read the wavelength at the target." },
        { t: "Align", d: "Use the WCS (the header formula mapping pixels to sky coordinates) to put every image on the same north-up grid." },
        { t: "Play", d: "Apply ONE shared brightness scale to all frames, mark where a moving star should be, and play or blink in the browser." }
      ]
    },
    targets: {
      num: "03", label: "Targets",
      title: "Nineteen targets, one sky",
      text: "The five NASA challenge targets plus fourteen more that move, pulse, flare or exploded. Spin the ring, read the fun facts, then open any of them in the explorer."
    },
    spectrum: {
      num: "04", label: "Spectrum",
      title: "One telescope, 102 colours",
      text: "SPHEREx uses linear variable filters: filters whose transmitted wavelength changes smoothly across the detector. As the telescope steps across the sky, each object is measured at many wavelengths.",
      note: "Colours here are a false-colour mapping — infrared has no 'real' colour. Band edges and resolving power from NASA/IPAC IRSA (verified 15 Nov 2026); the 102 thin lines are the 17 channels of each detector, spaced at constant resolving power (approximate positions)."
    },
    tools: {
      num: "05", label: "Tools",
      title: "What you can do"
    },
    compare: {
      num: "06", label: "Compare",
      title: "Why SPHEREx for this?",
      text: "How SPHEREx compares with other all-sky infrared surveys for finding change over time."
    },
    glossary: {
      num: "07", label: "Glossary",
      title: "Words we use",
      text: "Every technical term on this site, explained in one or two sentences."
    },
    launch: {
      title: "Ready to blink the sky?",
      text: "Open the vault for a ready-made target, or probe any position yourself.",
      cta: "Open Star Vault",
      secondary: "Back to top"
    }
  },

  launchNote: "Data: NASA/IPAC Infrared Science Archive (IRSA), SPHEREx DR1 + Quick Release 3.",

  footer: {
    team: "ORBITAL · NASA Space Apps Challenge 2026",
    credits: "Images: NASA/JPL-Caltech/IPAC SPHEREx, 2MASS and WISE via NASA/IPAC IRSA · Gaia: ESA/Gaia/DPAC · Sky maps: Aladin Lite (CDS). Full credits and method: Science & credits page.",
    disclaimer: "Student project. Not an official NASA product."
  },

  tools: [
    { ico: "▶", t: "Time-lapse player", d: "Auto play every frame at the speed you choose (frames per second).", href: "vault.html" },
    { ico: "⇄", t: "Blink A ↔ B", d: "Flip between any two frames; shows time apart, wavelength apart and expected motion.", href: "vault.html" },
    { ico: "⌖", t: "Coordinate probe", d: "Type RA/Dec in degrees or hh:mm:ss / dd:mm:ss, or click the sky map.", href: "probe.html" },
    { ico: "◐", t: "Band and time", d: "Choose detector D1–D6 and all dates or a date range.", href: "probe.html" },
    { ico: "◎", t: "Proper-motion ring", d: "Optional yellow ring: where a moving star should be on each date. Off by default.", href: "vault.html" },
    { ico: "⊕", t: "Aladin sky map", d: "Context view with older surveys (2MASS, WISE, DSS).", href: "probe.html" }
  ],

  compare: {
    head: ["", "SPHEREx", "WISE / NEOWISE", "2MASS"],
    rows: [
      ["Wavelengths", "0.75–5.0 µm, 102 channels", "3.4, 4.6 (12, 22) µm", "1.2, 1.6, 2.2 µm"],
      ["Spectral info", "Low-res spectrum", "2–4 broad bands", "3 broad bands"],
      ["Repeat visits", "~every 6 months", "~every 6 months (2010–2024)", "Mostly single epoch"],
      ["Pixel size", "6.15″", "2.75″", "2″"],
      ["Best for", "Colour + time change", "Long time baseline", "Old reference epoch"]
    ],
    note: "Approximate values; see each mission's documentation for exact figures."
  },

  glossary: [
    { t: "Right ascension (RA)", d: "The sky's version of longitude, measured eastward along the celestial equator, in hours (0–24h) or degrees (0–360°)." },
    { t: "Declination (Dec)", d: "The sky's version of latitude: degrees north (+) or south (−) of the celestial equator." },
    { t: "Arcminute / arcsecond", d: "Small angles: 1° = 60′ (arcminutes) = 3600″ (arcseconds). One SPHEREx pixel is 6.15″." },
    { t: "Epoch", d: "The date at which a position is valid. Stars that move have different coordinates at different epochs." },
    { t: "Proper motion", d: "A star's real sideways motion across the sky, usually in milliarcseconds per year (mas/yr)." },
    { t: "Parallax", d: "The small yearly wobble of a nearby star caused by Earth orbiting the Sun; bigger wobble means closer star." },
    { t: "MJD", d: "Modified Julian Date: days counted since 17 Nov 1858, the standard astronomy clock." },
    { t: "FITS", d: "Flexible Image Transport System: the standard astronomy file format, a text header plus binary data." },
    { t: "MEF", d: "Multi-Extension FITS: one FITS file holding several images or tables." },
    { t: "HDU", d: "Header-Data Unit: one header-plus-data block inside a FITS file." },
    { t: "WCS", d: "World Coordinate System: header keywords that convert pixel (x, y) into sky (RA, Dec)." },
    { t: "HiPS", d: "Hierarchical Progressive Surveys: an all-sky image cut into tiles at many zoom levels, like Google Maps for the sky." },
    { t: "MOC", d: "Multi-Order Coverage map: a compact description of which parts of the sky a survey covers." },
    { t: "TAP", d: "Table Access Protocol: an IVOA standard for querying astronomy catalogues with SQL-like ADQL." },
    { t: "SIA", d: "Simple Image Access: an IVOA standard for asking \"which images cover this position?\"." },
    { t: "DataLink", d: "An IVOA standard that lists related files and services (like cutouts) for one data product." },
    { t: "Cutout", d: "A small sub-image cropped around a position, so you don't download the whole image." },
    { t: "PSF", d: "Point Spread Function: the blurred shape a point-like star makes on the detector." },
    { t: "Zodiacal light", d: "Infrared glow from dust in our solar system, lit by the Sun; a big smooth background in SPHEREx images." },
    { t: "Linear variable filter", d: "A filter whose passed wavelength changes along one direction, so each detector row sees a different colour." },
    { t: "Forced photometry", d: "Measuring brightness at a known position even if the object is too faint to be detected on its own." },
    { t: "Signal-to-noise ratio (SNR)", d: "How strong a signal is compared with random noise; SNR ≥ 5 is a common detection threshold." },
    { t: "Surface brightness", d: "Brightness per unit area of sky, used for extended sources like nebulae; SPHEREx images are in MJy/sr." },
    { t: "Brown dwarf", d: "An object too small to fuse hydrogen like a star, but bigger than a planet; cold ones glow mostly in the infrared." },
    { t: "Quasar", d: "A very distant, very bright galaxy core powered by a supermassive black hole; useful as a fixed reference point." },
    { t: "Saturation", d: "A star so bright that pixels hit their maximum; SPHEREx flags them (OVERFLOW) and we show them as missing." },
    { t: "Detector (D1–D6)", d: "SPHEREx has six detector arrays, each covering a different wavelength range." },
    { t: "Visit", d: "A group of SPHEREx exposures of the same place taken close together in time." },
    { t: "Stretch", d: "The mapping from pixel values to screen brightness. All frames share one stretch so brightness changes are real." }
  ]
};

/* ---------------------------------------------------------------------
   TARGETS — OFFLINE FALLBACK ONLY. The real list (with proper motions) comes
   from the backend: GET /api/targets (backend/core/targets.py). Keep ids equal.
   ra/dec in degrees at `epoch`; pmEast/pmNorth in mas/yr.
   Values from SIMBAD.
   --------------------------------------------------------------------- */
window.TARGETS = [
  {"id": "barnard", "n": 1, "name": "Barnard's Star", "ra": 269.45208, "dec": 4.69336, "epoch": 2000.0, "pmEast": -802.8, "pmNorth": 10362.5, "tags": ["challenge", "moves"], "kind": "Red dwarf", "defaultBand": "D2", "why": "Fastest proper motion of any star; may saturate."},
  {"id": "epsindib", "n": 2, "name": "Epsilon Indi B", "ra": 331.0438, "dec": -56.7828, "epoch": 2000.0, "pmEast": 3960.0, "pmNorth": -2539.0, "tags": ["challenge", "moves"], "kind": "Brown dwarf pair", "defaultBand": "D5", "why": "Two brown dwarfs, seen as one dot."},
  {"id": "wise0855", "n": 3, "name": "WISE 0855−0714", "ra": 133.79513, "dec": -7.24515, "epoch": 2010.4, "pmEast": -8123.7, "pmNorth": 673.2, "tags": ["challenge", "moves"], "kind": "Coldest known brown dwarf", "defaultBand": "D6", "why": "Visible only at the longest wavelengths (D5–D6)."},
  {"id": "rwaur", "n": 4, "name": "RW Aurigae", "ra": 76.9564, "dec": 30.4014, "epoch": 2000.0, "pmEast": 2.6, "pmNorth": -27.4, "tags": ["challenge", "varies"], "kind": "Young T Tauri star", "defaultBand": "D2", "why": "Dims irregularly behind dust from its disk."},
  {"id": "rdra", "n": 5, "name": "R Draconis", "ra": 248.1675, "dec": 66.755, "epoch": 2000.0, "pmEast": 0.0, "pmNorth": 0.0, "tags": ["challenge", "varies"], "kind": "Mira variable", "defaultBand": "D2", "why": "Pulsating red giant (~245-day period); may saturate."},
  {"id": "wr140", "n": 6, "name": "WR 140", "ra": 305.11657, "dec": 43.85452, "epoch": 2000.0, "pmEast": -4.3, "pmNorth": -1.9, "tags": ["varies"], "kind": "Wolf-Rayet binary", "defaultBand": "D4", "why": "Makes a new dust shell every 7.9 years."},
  {"id": "etacar", "n": 7, "name": "Eta Carinae", "ra": 161.26496, "dec": -59.68452, "epoch": 2000.0, "pmEast": 0.0, "pmNorth": 0.0, "tags": ["varies", "exploded"], "kind": "Luminous blue variable", "defaultBand": "D3", "why": "Survivor of a giant 1840s eruption; core saturates."},
  {"id": "bllac", "n": 8, "name": "BL Lacertae", "ra": 330.68038, "dec": 42.27777, "epoch": 2000.0, "pmEast": 0.0, "pmNorth": 0.0, "tags": ["varies"], "kind": "Blazar", "defaultBand": "D2", "why": "Black-hole jet pointed at us; varies within days."},
  {"id": "3c273", "n": 9, "name": "3C 273", "ra": 187.27792, "dec": 2.05239, "epoch": 2000.0, "pmEast": 0.0, "pmNorth": 0.0, "tags": ["varies"], "kind": "Quasar", "defaultBand": "D1", "why": "First quasar identified (1963); varies over months."},
  {"id": "luhman16", "n": 10, "name": "Luhman 16", "ra": 162.31488, "dec": -53.31833, "epoch": 2010.5, "pmEast": -2759.0, "pmNorth": 354.0, "tags": ["moves"], "kind": "Nearest brown-dwarf pair", "defaultBand": "D6", "why": "Two brown dwarfs 6.5 light-years away; moves ~2.8″/yr."},
  {"id": "sn2023ixf", "n": 11, "name": "SN 2023ixf", "ra": 210.910674, "dec": 54.3117, "epoch": 2000.0, "pmEast": 0.0, "pmNorth": 0.0, "tags": ["exploded", "varies"], "kind": "Supernova in M101", "defaultBand": "D2", "why": "Nearby 2023 supernova, still fading in the infrared."},
  {"id": "proxima", "n": 12, "name": "Proxima Centauri", "ra": 217.42896, "dec": -62.67947, "epoch": 2000.0, "pmEast": -3781.3, "pmNorth": 769.8, "tags": ["moves", "varies"], "kind": "Nearest star (red dwarf)", "defaultBand": "D2", "why": "Closest star to the Sun; moves ~3.9″/yr and flares."},
  {"id": "crab", "n": 13, "name": "Crab Nebula", "ra": 83.63308, "dec": 22.0145, "epoch": 2000.0, "pmEast": 0.0, "pmNorth": 0.0, "tags": ["exploded"], "kind": "Supernova remnant (1054)", "defaultBand": "D3", "why": "Debris of the supernova seen in 1054, with a pulsar inside."},
  {"id": "sn1987a", "n": 14, "name": "SN 1987A", "ra": 83.86675, "dec": -69.26974, "epoch": 2000.0, "pmEast": 0.0, "pmNorth": 0.0, "tags": ["exploded"], "kind": "Supernova in the Large Magellanic Cloud", "defaultBand": "D3", "why": "Nearest supernova seen in modern times (1987)."},
  {"id": "mira", "n": 15, "name": "Mira", "ra": 34.83663, "dec": -2.97764, "epoch": 2000.0, "pmEast": 9.3, "pmNorth": -237.4, "tags": ["varies"], "kind": "Mira variable (prototype)", "defaultBand": "D2", "why": "First known variable star (1596); 332-day cycle. Will saturate."},
  {"id": "betelgeuse", "n": 16, "name": "Betelgeuse", "ra": 88.79294, "dec": 7.40706, "epoch": 2000.0, "pmEast": 27.5, "pmNorth": 10.9, "tags": ["varies"], "kind": "Red supergiant", "defaultBand": "D1", "why": "Great Dimming of 2019–20. Saturated in SPHEREx: shows as missing."},
  {"id": "sgra", "n": 17, "name": "Sagittarius A*", "ra": 266.41684, "dec": -29.00781, "epoch": 2000.0, "pmEast": 0.0, "pmNorth": 0.0, "tags": ["varies"], "kind": "Milky Way's central black hole", "defaultBand": "D4", "why": "Behind thick dust: invisible in visible light, seen in the infrared."},
  {"id": "tabby", "n": 18, "name": "Tabby's Star", "ra": 301.56443, "dec": 44.45697, "epoch": 2000.0, "pmEast": -10.4, "pmNorth": -10.3, "tags": ["varies"], "kind": "Mystery dimming star", "defaultBand": "D2", "why": "KIC 8462852: irregular dips of up to 22 %."},
  {"id": "casa", "n": 19, "name": "Cassiopeia A", "ra": 350.85, "dec": 58.815, "epoch": 2000.0, "pmEast": 0.0, "pmNorth": 0.0, "tags": ["exploded"], "kind": "Supernova remnant (~1680)", "defaultBand": "D3", "why": "Youngest known remnant in our galaxy; bright in the infrared."}
];

/* Detector bands. VERIFIED 15 Nov 2026 against the IRSA SPHEREx data-products page and spherex.caltech.edu:
   D1 0.75–1.09 µm, D2 1.10–1.62, D3 1.63–2.41, D4 2.42–3.82, D5 3.83–4.41, D6 4.42–5.00. Each band = 17 channels,
   6 × 17 = 102. R = λ/Δλ (resolving power: how finely the band splits colours). The tiny gaps are real: the
   neighbouring detectors overlap by design and the archive quotes the core ranges. Replaced by /api/settings. */
window.BANDS = [
  { id: "D1", min: 0.75, max: 1.09, R: 41 },
  { id: "D2", min: 1.10, max: 1.62, R: 41 },
  { id: "D3", min: 1.63, max: 2.41, R: 41 },
  { id: "D4", min: 2.42, max: 3.82, R: 35 },
  { id: "D5", min: 3.83, max: 4.41, R: 110 },
  { id: "D6", min: 4.42, max: 5.00, R: 130 }
];

/* Spectral features drawn on the home-page band. Wavelengths are textbook values; the three ices are the
   SPHEREx Ices Investigation targets (H₂O 3.0, CO₂ 4.27, CO 4.67 µm). "range" = a window, not a line. */
window.SPEC_FEATURES = [
  { at: 1.40, label: "H₂O", d: "Water vapour absorption: deep dips in cool brown dwarfs and M stars." },
  { at: 1.60, label: "Starlight bump", d: "Most stars give out the most light per frequency near 1.6 µm (the H⁻ opacity minimum), so galaxies of old stars peak here." },
  { at: 2.29, label: "CO bands", d: "Carbon monoxide absorption bands, strong in red giants like Mira and Betelgeuse." },
  { at: 3.05, label: "Water ice", d: "Water ice on dust grains in cold molecular clouds — a core SPHEREx science goal." },
  { at: 3.30, label: "Methane / PAH", d: "Methane absorption in brown dwarfs; 'organic glow' from PAHs (sooty carbon molecules) in dusty galaxies." },
  { at: 4.27, label: "CO₂ ice", d: "Carbon-dioxide ice — only measurable from space, because Earth's air blocks 4.3 µm." },
  { at: 4.67, label: "CO ice", d: "Carbon-monoxide ice in the coldest clouds (below about 20 K)." },
  { at: 3.9, to: 4.5, label: "Brown-dwarf window", d: "Between methane (3.3 µm) and CO (4.6 µm) absorption, cold brown dwarfs like WISE 0855 escape their light: brightest here." }
];

/* Backend address. Leave "" : api.js finds the backend automatically
   (same server, else http://127.0.0.1:8765). Set only if you move it. */
if (window.API_BASE === undefined) window.API_BASE = "";   // set in js/config.js for hosted copies
