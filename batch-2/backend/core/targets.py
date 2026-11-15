"""Named targets and proper motion.

PHYSICS — proper motion. Nearby stars really move across the sky. A position in
a catalogue is only true at its EPOCH (the date it refers to). Barnard's Star
moves 10.4″ per year, so its J2000 position is about 4.5′ away from where it is
in 2026: with a 3′ radius it would be OFF the picture. So for every target with
a known motion we move the catalogue position forward in time:

    Δδ  = μ_δ · Δt                      (north, straight)
    Δα  = μ_α* · Δt / cos δ             (east; μ_α* already includes cos δ,
                                         and we divide it back out to get Δα)

μ in milliarcseconds per year, 1° = 3.6e6 mas. This straight-line formula is
accurate to far below one 6.15″ pixel over a few decades for these targets.
Parallax (the yearly wobble from Earth's orbit, ≤ 0.55″ here) is less than
1/10 of a pixel, so it is ignored.

All values from SIMBAD.
"""
import numpy as np

from config import settings

# ra, dec: degrees (ICRS) at `epoch`. pm_east = μ_α* and pm_north = μ_δ in mas/yr.
TARGETS = {
    "barnard": dict(n=1, title="Barnard's Star", ra=269.45208, dec=4.69336, epoch=2000.0,
                    pm_east=-802.8, pm_north=10362.5, band=2, tags=["challenge", "moves"],
                    kind="Red dwarf", note="Fastest proper motion of any star; may saturate."),
    "epsindib": dict(n=2, title="Epsilon Indi B", ra=331.04380, dec=-56.78280, epoch=2000.0,
                     pm_east=3960.0, pm_north=-2539.0, band=5, tags=["challenge", "moves"],
                     kind="Brown dwarf pair", note="Two brown dwarfs, seen as one dot."),
    "wise0855": dict(n=3, title="WISE 0855−0714", ra=133.79513, dec=-7.24515, epoch=2010.4,
                     pm_east=-8123.7, pm_north=673.2, band=6, tags=["challenge", "moves"],
                     kind="Coldest known brown dwarf", note="Visible only at the longest wavelengths (D5–D6)."),
    "rwaur": dict(n=4, title="RW Aurigae", ra=76.95640, dec=30.40140, epoch=2000.0,
                  pm_east=2.6, pm_north=-27.4, band=2, tags=["challenge", "varies"],
                  kind="Young T Tauri star", note="Dims irregularly behind dust from its disk."),
    "rdra": dict(n=5, title="R Draconis", ra=248.16750, dec=66.75500, epoch=2000.0,
                 band=2, tags=["challenge", "varies"],
                 kind="Mira variable", note="Pulsating red giant (~245-day period); may saturate."),
    "wr140": dict(n=6, title="WR 140", ra=305.11657, dec=43.85452, epoch=2000.0,
                  pm_east=-4.3, pm_north=-1.9, band=4, tags=["varies"],
                  kind="Wolf-Rayet binary", note="Makes a new dust shell every 7.9 years."),
    "etacar": dict(n=7, title="Eta Carinae", ra=161.26496, dec=-59.68452, epoch=2000.0,
                   band=3, tags=["varies", "exploded"],
                   kind="Luminous blue variable", note="Survivor of a giant 1840s eruption; core saturates."),
    "bllac": dict(n=8, title="BL Lacertae", ra=330.68038, dec=42.27777, epoch=2000.0,
                  band=2, tags=["varies"],
                  kind="Blazar", note="Black-hole jet pointed at us; varies within days."),
    "3c273": dict(n=9, title="3C 273", ra=187.27792, dec=2.05239, epoch=2000.0,
                  band=1, tags=["varies"],
                  kind="Quasar", note="First quasar identified (1963); varies over months."),
    "luhman16": dict(n=10, title='Luhman 16', ra=162.31488, dec=-53.31833, epoch=2010.5, pm_east=-2759.0, pm_north=354.0, band=6, tags=['moves'], kind='Nearest brown-dwarf pair', note='Two brown dwarfs 6.5 light-years away; moves ~2.8″/yr.'),
    "sn2023ixf": dict(n=11, title='SN 2023ixf', ra=210.910674, dec=54.3117, epoch=2000.0, band=2, tags=['exploded', 'varies'], kind='Supernova in M101', note='Nearby 2023 supernova, still fading in the infrared.', pm_east=0.0, pm_north=0.0),
    "proxima": dict(n=12, title='Proxima Centauri', ra=217.42896, dec=-62.67947, epoch=2000.0, pm_east=-3781.3, pm_north=769.8, band=2, tags=['moves', 'varies'], kind='Nearest star (red dwarf)', note='Closest star to the Sun; moves ~3.9″/yr and flares.'),
    "crab": dict(n=13, title='Crab Nebula', ra=83.63308, dec=22.0145, epoch=2000.0, band=3, tags=['exploded'], kind='Supernova remnant (1054)', note='Debris of the supernova seen in 1054, with a pulsar inside.', pm_east=0.0, pm_north=0.0),
    "sn1987a": dict(n=14, title='SN 1987A', ra=83.86675, dec=-69.26974, epoch=2000.0, band=3, tags=['exploded'], kind='Supernova in the Large Magellanic Cloud', note='Nearest supernova seen in modern times (1987).', pm_east=0.0, pm_north=0.0),
    "mira": dict(n=15, title='Mira', ra=34.83663, dec=-2.97764, epoch=2000.0, pm_east=9.3, pm_north=-237.4, band=2, tags=['varies'], kind='Mira variable (prototype)', note='First known variable star (1596); 332-day cycle. Will saturate.'),
    "betelgeuse": dict(n=16, title='Betelgeuse', ra=88.79294, dec=7.40706, epoch=2000.0, pm_east=27.5, pm_north=10.9, band=1, tags=['varies'], kind='Red supergiant', note='Great Dimming of 2019–20. Saturated in SPHEREx: shows as missing.'),
    "sgra": dict(n=17, title='Sagittarius A*', ra=266.41684, dec=-29.00781, epoch=2000.0, band=4, tags=['varies'], kind="Milky Way's central black hole", note='Behind thick dust: invisible in visible light, seen in the infrared.', pm_east=0.0, pm_north=0.0),
    "tabby": dict(n=18, title="Tabby's Star", ra=301.56443, dec=44.45697, epoch=2000.0, pm_east=-10.4, pm_north=-10.3, band=2, tags=['varies'], kind='Mystery dimming star', note='KIC 8462852: irregular dips of up to 22 %.'),
    "casa": dict(n=19, title='Cassiopeia A', ra=350.85, dec=58.815, epoch=2000.0, band=3, tags=['exploded'], kind='Supernova remnant (~1680)', note='Youngest known remnant in our galaxy; bright in the infrared.', pm_east=0.0, pm_north=0.0),
}

# Distance from Earth in light years, from published catalogues (Gaia parallaxes for
# stars, redshift for the blazar/quasar/galaxy). NOT from SPHEREx: an image records
# direction only. Used only by the 3D "where are they in space" map.
# Approximate (SIMBAD / NED).
DISTANCE_LY = {
    "barnard": 5.96, "epsindib": 11.87, "wise0855": 7.43, "rwaur": 509, "rdra": 2160,
    "wr140": 5350, "etacar": 7500, "bllac": 9.3e8, "3c273": 2.1e9, "luhman16": 6.5,
    "sn2023ixf": 2.1e7, "proxima": 4.25, "crab": 6500, "sn1987a": 1.68e5, "mira": 300,
    "betelgeuse": 548, "sgra": 26700, "tabby": 1470, "casa": 11000,
}

MATCH_RADIUS_DEG = 2.0 / 60     # typed position within 2′ of a known target -> use its motion


def has_motion(t):
    return bool(t.get("pm_east") or t.get("pm_north"))


def propagate(t, year):
    """(ra, dec) of target t at decimal `year`, moved along its proper motion."""
    dt = year - t["epoch"]
    dec = t["dec"] + t.get("pm_north", 0.0) * dt / 3.6e6
    ra = t["ra"] + t.get("pm_east", 0.0) * dt / 3.6e6 / np.cos(np.radians(dec))
    return float(ra % 360), float(dec)


def separation_deg(ra1, dec1, ra2, dec2):
    """Great-circle angle between two sky positions (haversine, stable for tiny angles)."""
    r1, d1, r2, d2 = map(np.radians, (ra1, dec1, ra2, dec2))
    h = np.sin((d2 - d1) / 2) ** 2 + np.cos(d1) * np.cos(d2) * np.sin((r2 - r1) / 2) ** 2
    return float(np.degrees(2 * np.arcsin(np.sqrt(h))))


def match(ra, dec):
    """Id of a known moving target whose catalogue OR present-day position is near (ra, dec)."""
    best = None
    for key, t in TARGETS.items():
        if not has_motion(t):
            continue
        for pos in ((t["ra"], t["dec"]), propagate(t, settings.SEARCH_EPOCH)):
            sep = separation_deg(ra, dec, *pos)
            if sep <= MATCH_RADIUS_DEG and (best is None or sep < best[1]):
                best = (key, sep)
    return best[0] if best else None


def public():
    """The list served at /api/targets (positions as stored, plus the 2026 position)."""
    out = []
    for key, t in TARGETS.items():
        now = propagate(t, settings.SEARCH_EPOCH)
        out.append({
            "id": key, "n": t["n"], "name": t["title"], "ra": t["ra"], "dec": t["dec"],
            "epoch": t["epoch"], "pmEast": t.get("pm_east", 0.0), "pmNorth": t.get("pm_north", 0.0),
            "raNow": now[0], "decNow": now[1], "nowEpoch": settings.SEARCH_EPOCH,
            "defaultBand": f"D{t['band']}", "tags": t["tags"], "kind": t["kind"], "why": t["note"],
            "distanceLy": DISTANCE_LY.get(key),
        })
    return out
