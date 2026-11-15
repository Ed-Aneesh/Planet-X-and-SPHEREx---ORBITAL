/* =====================================================================
   facts.js — fun facts and quick numbers for the 19 targets (home page
   carousel). Facts from the team's "target_facts" document, checked and
   reworded where the original overstated something.
   distance / properMotion: from SIMBAD.
   change: what SPHEREx should show  ·  tag: the badge on the card.
   image/credit: pictures from the team's document, from OTHER telescopes
   (shown with a "Not SPHEREx" label). Only NASA / ESA / ESO / Creative-Commons
   images are used; Eps Indi B, R Dra, BL Lac, SN 2023ixf and RW Aur have none
   (no clear licence, wrong object, or no picture) and keep drawn art.
   ===================================================================== */
window.FACTS = {
  barnard: {
    image: "img/targets/barnard.svg", ours: true,
    credit: 'Our figure from NASA/IPAC IRSA data: AllWISE (NASA/JPL-Caltech/UCLA, 2010) vs SPHEREx D2 (NASA/JPL-Caltech/IPAC, 2026)', creditUrl: 'science.html#subpix',
    tag: "moves", subtitle: "Red dwarf · position", distance: "5.96 ly", properMotion: "10.4″ / yr",
    facts: [
      "Nicknamed the “runaway star”: it has the largest proper motion of any known star, crossing the width of the full Moon in about 180 years.",
      "It is heading towards us at about 110 km/s and will pass closest, about 3.8 light-years away, in roughly 9,800 years.",
      "It is older than the Sun, perhaps around twice its age."
    ],
    source: "https://astrobiology.nasa.gov/news/barnards-star/"
  },
  epsindib: {
    tag: "moves", subtitle: "Brown-dwarf pair · position", distance: "11.8 ly", properMotion: "4.7″ / yr",
    facts: [
      "Really two brown dwarfs, Ba and Bb (types T1 and T6), orbiting each other about every 11 years.",
      "Among the closest brown dwarfs to Earth.",
      "Their parent star, Epsilon Indi A, has a cold giant planet that JWST imaged directly in 2024."
    ]
  },
  wise0855: {
    image: "img/targets/wise0855.jpg", credit: 'NASA/ESA/CSA JWST NIRCam; Alves de Oliveira et al.; processing Melina Thévenot — CC BY-SA 4.0', creditUrl: 'https://commons.wikimedia.org/w/index.php?curid=149159405',
    tag: "moves", subtitle: "Coldest brown dwarf · position", distance: "7.4 ly", properMotion: "8.1″ / yr",
    facts: [
      "One of the coldest known brown dwarfs: about 250–285 K, like Earth's polar regions.",
      "About the size of Jupiter but roughly 3–10 times its mass.",
      "The first object outside the Solar System with evidence of water-ice clouds.",
      "Nearly invisible in visible light, so it is studied in the infrared — exactly where SPHEREx looks."
    ]
  },
  rwaur: {
    tag: "dims", subtitle: "Young star · brightness", distance: "≈ 510 ly", properMotion: "negligible",
    facts: [
      "Famous for dramatic dimming episodes as dust passes in front of it.",
      "In 2017 X-ray data showed a huge spike in iron: it may have swallowed a baby planet.",
      "It gives its name to an old class of irregular young variable stars."
    ]
  },
  rdra: {
    tag: "pulses", subtitle: "Mira variable · brightness", distance: "—", properMotion: "negligible",
    facts: [
      "A dying red giant that swells and shrinks about every 245 days.",
      "Its brightness swings from an easy binocular target to up to a few hundred times dimmer.",
      "A preview of our Sun's own far future."
    ]
  },
  wr140: {
    image: "img/targets/wr140.jpg", credit: 'ESA/Webb, NASA, CSA — CC BY 4.0', creditUrl: 'https://esawebb.org/images/weic2307d/',
    tag: "pulses", subtitle: "Wolf-Rayet binary · dust", distance: "≈ 5,400 ly", properMotion: "negligible",
    facts: [
      "JWST captured 17 nested dust rings around it — one new shell each time the stars swing close, every 7.9 years.",
      "Its Wolf-Rayet star is extremely hot: tens of thousands of kelvin."
    ],
    source: "https://esawebb.org/images/weic2307d/"
  },
  etacar: {
    image: "img/targets/etacar.jpg", credit: 'NASA, ESA (Hubble)', creditUrl: 'https://science.nasa.gov/image-detail/stsci-h-p1918a-f-2000x2000-1/',
    tag: "flares", subtitle: "Luminous blue variable · brightness", distance: "≈ 7,500 ly", properMotion: "negligible",
    facts: [
      "In the 1840s a giant eruption briefly made it the second-brightest star in the night sky.",
      "That eruption threw off the gas and dust of the Homunculus Nebula.",
      "A binary of very massive stars — the larger about 100 times the Sun's mass — expected to explode one day."
    ],
    source: "https://science.nasa.gov/image-detail/stsci-h-p1918a-f-2000x2000-1/"
  },
  bllac: {
    tag: "flares", subtitle: "Blazar · brightness", distance: "≈ 900 million ly", properMotion: "0 (distant galaxy)",
    facts: [
      "First catalogued as a variable star, later found to be an active galaxy.",
      "A blazar: a jet of high-energy plasma pointed almost straight at Earth."
    ]
  },
  "3c273": {
    image: "img/targets/3c273.jpg", credit: 'ESA/Hubble & NASA — CC BY 4.0', creditUrl: 'https://www.flickr.com/photos/hubble_esa/10953173335/',
    tag: "flares", subtitle: "Quasar · brightness", distance: "≈ 2.4 billion ly", properMotion: "0 (distant galaxy)",
    facts: [
      "The first quasar ever identified (1963).",
      "The brightest quasar in our sky — visible in a backyard telescope despite being billions of light-years away."
    ]
  },
  luhman16: {
    image: "img/targets/luhman16.jpg", credit: 'ESO VLT/MUSE; processing Melina Thévenot — CC BY-SA 4.0', creditUrl: 'https://commons.wikimedia.org/w/index.php?curid=192765943',
    tag: "moves", subtitle: "Brown-dwarf pair · position", distance: "6.5 ly", properMotion: "2.8″ / yr",
    facts: [
      "The third-closest system to the Sun, only 6.5 light-years away.",
      "Not found until 2013 (in WISE data): it hid in the crowded band of the Milky Way."
    ]
  },
  sn2023ixf: {
    tag: "exploded", subtitle: "Supernova in M101 · brightness", distance: "≈ 21 million ly", properMotion: "0 (other galaxy)",
    facts: [
      "Discovered in May 2023 in the Pinwheel Galaxy, about 21 million light-years away.",
      "The nearest supernova seen since 2014."
    ]
  },
  proxima: {
    image: "img/targets/proxima.jpg", credit: 'ESA/Hubble & NASA — CC BY 4.0', creditUrl: 'https://commons.wikimedia.org/w/index.php?curid=29263039',
    tag: "moves", subtitle: "Nearest star · position", distance: "4.25 ly", properMotion: "3.9″ / yr",
    facts: [
      "The closest star to the Sun.",
      "Its planet Proxima b orbits in the habitable zone, once every 11 days.",
      "It often unleashes huge flares that may strip the atmospheres of nearby planets."
    ]
  },
  crab: {
    image: "img/targets/crab.jpg", credit: 'NASA, ESA (Hubble)', creditUrl: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-1/',
    tag: "exploded", subtitle: "Supernova remnant · structure", distance: "≈ 6,500 ly", properMotion: "negligible",
    facts: [
      "The remnant of a supernova recorded in 1054, bright enough to see in daylight for weeks.",
      "Entry number 1 (M1) in Charles Messier's famous catalogue of 1771.",
      "At its heart a pulsar spins about 30 times every second."
    ],
    source: "https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-1/"
  },
  sn1987a: {
    image: "img/targets/sn1987a.jpg", credit: 'NASA, ESA, A. Angelich (NRAO/AUI/NSF); Hubble: R. Kirshner; Chandra: NASA/CXC/Penn State/K. Frank et al.; ALMA (ESO/NAOJ/NRAO), R. Indebetouw',
    tag: "exploded", subtitle: "Supernova · brightness", distance: "≈ 168,000 ly", properMotion: "0 (other galaxy)",
    facts: [
      "The nearest supernova seen since the telescope was invented, in the Large Magellanic Cloud.",
      "Detectors on Earth caught neutrinos from the blast hours before its light arrived."
    ]
  },
  mira: {
    image: "img/targets/mira.jpg", credit: 'ESO — CC BY 4.0', creditUrl: 'https://commons.wikimedia.org/w/index.php?curid=194203906',
    tag: "pulses", subtitle: "Mira variable · brightness", distance: "≈ 300 ly", properMotion: "0.24″ / yr",
    facts: [
      "The first periodic variable star ever found; its name means “wonderful”.",
      "It drags a comet-like tail of gas about 13 light-years long.",
      "Over its 332-day cycle it goes from naked-eye bright to invisible without a telescope."
    ]
  },
  betelgeuse: {
    image: "img/targets/betelgeuse.jpg", credit: 'ESO — CC BY 4.0', creditUrl: 'https://commons.wikimedia.org/w/index.php?curid=198070819',
    tag: "dims", subtitle: "Red supergiant · brightness", distance: "≈ 550 ly", properMotion: "0.03″ / yr",
    facts: [
      "So big that in the Sun's place it would reach past Mars, nearly to Jupiter.",
      "Its “Great Dimming” of 2019–20 was caused by a cloud of dust it threw off.",
      "It could explode as a supernova any time in the next 100,000 years."
    ]
  },
  sgra: {
    image: "img/targets/sgra.jpg", credit: 'EHT Collaboration / ESO — CC BY 4.0', creditUrl: 'https://commons.wikimedia.org/w/index.php?curid=117933557',
    tag: "flares", subtitle: "Central black hole · flares", distance: "≈ 26,700 ly", properMotion: "negligible",
    facts: [
      "The supermassive black hole at the centre of our galaxy: about 4 million Suns packed into a space smaller than Mercury's orbit.",
      "The Event Horizon Telescope released the first image of it in 2022."
    ]
  },
  tabby: {
    image: "img/targets/tabby.jpg", credit: "NASA/JPL-Caltech — artist's illustration", creditUrl: 'https://science.nasa.gov/photojournal/tabbys-star-illustration/',
    tag: "dims", subtitle: "Mystery dimming star · brightness", distance: "≈ 1,470 ly", properMotion: "negligible",
    facts: [
      "Shows irregular dips of up to about 20 % in brightness.",
      "Different colours of light dimmed by different amounts — the sign of uneven dust, not a solid object."
    ],
    source: "https://science.nasa.gov/photojournal/tabbys-star-illustration/"
  },
  casa: {
    image: "img/targets/casa.jpg", credit: 'NASA and The Hubble Heritage Team (STScI/AURA); ack. R. Fesen & J. Morse',
    tag: "exploded", subtitle: "Supernova remnant · structure", distance: "≈ 11,000 ly", properMotion: "negligible",
    facts: [
      "Light from this explosion reached Earth about 340 years ago, in the late 1600s.",
      "Its expanding debris spreads heavy elements like iron and calcium — raw material for future planets."
    ]
  }
};
