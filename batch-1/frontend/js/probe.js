/* =====================================================================
   probe.js — Sky Probe console. The same inputs as the desktop tool:
     Name (a known target, or "Type coordinates")
     RA, Dec            degrees, or 08h55m10.8s / −07d14m42.5s
     Motion east/north  proper motion in mas/yr
     Year               the epoch the RA/Dec refer to
     Radius             degrees, up to 0.25
     Detector band      1–6
   plus the time range and frames per second.
   Choosing a name fills everything from the catalogue and the backend uses
   the catalogue values; editing any number turns it back into "Type coordinates".
   ===================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  const targets = await API.targets();
  let named = "";                                   // id of the chosen target, "" = typed coordinates

  const read = () => ({ ra: parseRA($("#ra").value), dec: parseDec($("#dec").value) });
  const num = (id, d) => { const v = $(id).value.trim(); return v === "" ? d : +v; };

  /* F36 deep fields: SPHEREx's most-observed sky is around the ecliptic poles, where every orbit passes.
     Pole positions are the standard J2000 values. */
  const DEEP = [
    { id: "deep-nep", name: "North Ecliptic Pole deep field", kind: "SPHEREx deep field", ra: 270.0, dec: 66.56071, tags: ["deep"],
      why: "SPHEREx passes over the ecliptic poles on every orbit, so this patch has far more exposures and visits than anywhere else." },
    { id: "deep-sep", name: "South Ecliptic Pole deep field", kind: "SPHEREx deep field", ra: 90.0, dec: -66.56071, tags: ["deep"],
      why: "The southern deep field, next to the Large Magellanic Cloud: hundreds of exposures, ideal for stacking and for every multi-visit tool." }
  ];
  /* Known asteroids SPHEREx really photographed. VERIFIED 15 Nov 2026 with IRSA's Moving Object Search
     Tool (MOST, catalog=spherex): for each, the 2–3-day window and detector with the most images of it.
     Centre = middle of its track in that window; radius = half the track + margin, so it stays in view. */
  const ASTEROIDS = [
    { id: "ast-hekate", name: "100 Hekate", kind: "Main-belt asteroid · V 13", ra: 210.905, dec: -4.120, band: "D1",
      start: "2025-06-24", end: "2025-06-26", radius: 0.12,
      why: "SPHEREx caught it 32 times on 24 June 2025 alone, in all six detectors. It crawls about 0.1° south over these three days." },
    { id: "ast-eros", name: "433 Eros", kind: "Near-Earth asteroid · V 14", ra: 12.569, dec: 13.881, band: "D1",
      start: "2025-07-07", end: "2025-07-08", radius: 0.20,
      why: "A near-Earth asteroid (NASA's NEAR probe landed on it in 2001). Close to us, so it races 0.34° across the patch in two days." },
    { id: "ast-hygiea", name: "10 Hygiea", kind: "Large main-belt asteroid · V 12", ra: 95.613, dec: 25.046, band: "D6",
      start: "2025-09-29", end: "2025-10-01", radius: 0.19,
      why: "The fourth-largest asteroid, about 430 km across. 19 SPHEREx images at 4.4–5 µm, where it glows from its own warmth." },
    { id: "ast-europa", name: "52 Europa", kind: "Main-belt asteroid · V 12", ra: 50.764, dec: 11.843, band: "D1",
      start: "2026-02-13", end: "2026-02-15", radius: 0.17,
      why: "One of the larger asteroids (~300 km), seen by SPHEREx on three days in a row, drifting about 0.27°." },
    { id: "ast-themis", name: "24 Themis", kind: "Main-belt asteroid · V 13", ra: 251.325, dec: -22.572, band: "D2",
      start: "2026-03-05", end: "2026-03-07", radius: 0.19,
      why: "Water ice was found on its surface in 2010. 14 SPHEREx images over three days as it moves about 0.3°." }
  ];
  ASTEROIDS.forEach(a => { a.tags = ["asteroid"]; });
  const map = new SkyMap($("#skymap"), {
    onPick: (ra, dec) => { setNamed(""); setCoords(ra, dec); },
    onSelect: id => { const x = targets.find(t => t.id === id); if (x) fill(x); else { const d = DEEP.find(t => t.id === id); if (d) deep(d);
      else { const a = ASTEROIDS.find(t => t.id === id); if (a) asteroid(a); } } }
  });
  map.setTargets(targets.concat(DEEP, ASTEROIDS));             // all 19 targets + the 2 deep fields as clickable dots
  function asteroid(a) {
    setNamed(""); map.select(a.id);
    ["#pm-east", "#pm-north"].forEach(id => { $(id).value = 0; }); $("#epoch").value = 2000;
    $("#band").value = a.band; $("#radius").value = a.radius; $("#max-exp").value = "all";   // a 2-3-day window holds only ~10-20 images per detector: load them all
    $("#all-time").checked = false; $("#all-time").dispatchEvent(new Event("change"));
    $("#t-start").value = a.start; $("#t-end").value = a.end;
    $("#show-sso").checked = true;                 // the JPL check turns on as soon as the images load
    setCoords(a.ra, a.dec);
    $("#name").value = a.id;
    $("#sel-name").textContent = a.name;
    $("#pm-note").className = "pf-note";
    $("#pm-note").innerHTML = `<b>${a.name}</b> · ${a.kind}. ${a.why} <span class="muted">Set for you: ${a.band}, ${a.start} → ${a.end}, ` +
      `all exposures, Known asteroids on. SPHEREx sees a spot only a few times a day per detector, so a 2–3-day window holds about 10–20 images in one band — ` +
      `that is all there is, not a limit of this site. Confirmed in SPHEREx images by NASA/IRSA's Moving Object Search.</span>`;
  }
  function deep(d) {
    setNamed(""); map.select(d.id);
    ["#pm-east", "#pm-north"].forEach(id => { $(id).value = 0; }); $("#epoch").value = 2000;
    $("#max-exp").value = "24"; $("#radius").value = 0.08; $("#all-time").checked = true;
    $("#all-time").dispatchEvent(new Event("change"));
    setCoords(d.ra, d.dec);
    $("#name").value = d.id;
    $("#sel-name").textContent = d.name;
    $("#pm-note").className = "pf-note";
    $("#pm-note").innerHTML = `<b>${d.name}</b> · ${d.kind}. ${d.why} <span class="muted">Tip: pick more exposures (or All) to see more of its many visits; Difference, Trail and Measure all work here.</span>`;
  }

  await Explorer.init({
    getQuery: () => {
      const { ra, dec } = read();
      if (!validCoords(ra, dec)) throw new Error("RA must be 0–360° (or 0–24 h) and Dec −90…+90°.");
      // Sky Probe asks ONLY the live NASA/IPAC archive (IRSA); Star Vault is the place for the saved Drive copy
      const q = { ra: ra.toFixed(7), dec: dec.toFixed(7), source: "irsa" };              // Sky Probe: live NASA/IPAC IRSA only, never the Drive copy
      if (named) { q.target = named; return q; }     // catalogue position + motion
      const pe = num("#pm-east", 0), pn = num("#pm-north", 0), ep = num("#epoch", 2000);
      if (![pe, pn, ep].every(Number.isFinite)) throw new Error("Motion and year must be numbers.");
      if (Math.abs(pe) > 30000 || Math.abs(pn) > 30000) throw new Error("Motion must be within ±30 000 mas/yr.");
      if (ep < 1900 || ep > 2100) throw new Error("Year must be between 1900 and 2100.");
      Object.assign(q, { pm_east: pe, pm_north: pn, epoch: ep });
      return q;
    }
  });

  /* ---------- Name dropdown: all targets ---------- */
  const opt = x => `<option value="${x.id}">${x.name} — ${x.kind || ""}</option>`;
  const isCh = x => (x.tags || []).includes("challenge");
  $("#name").insertAdjacentHTML("beforeend",
    `<optgroup label="NASA challenge targets">${targets.filter(isCh).map(opt).join("")}</optgroup>` +
    `<optgroup label="More targets">${targets.filter(x => !isCh(x)).map(opt).join("")}</optgroup>` +
    `<optgroup label="Known asteroids caught by SPHEREx">${ASTEROIDS.map(opt).join("")}</optgroup>` +
    `<optgroup label="SPHEREx deep fields (most-observed sky)">${DEEP.map(opt).join("")}</optgroup>`);
  $("#name").addEventListener("change", e => {
    const d = DEEP.find(t => t.id === e.target.value); if (d) { deep(d); return; }
    const a = ASTEROIDS.find(t => t.id === e.target.value); if (a) { asteroid(a); return; }
    const x = targets.find(t => t.id === e.target.value);
    if (!x) { setNamed(""); echo(); return; }
    fill(x);
  });

  function fill(x) {
    $("#ra").value = (+x.ra).toFixed(6);
    $("#dec").value = (+x.dec).toFixed(6);
    $("#pm-east").value = x.pmEast || 0;
    $("#pm-north").value = x.pmNorth || 0;
    $("#epoch").value = x.epoch || 2000;
    $("#band").value = x.defaultBand || "D2";
    /* Fast movers: the patch must hold both the 1998-2000 (2MASS) position and today's, so the radius grows
       with the track: pm (″/yr) x 28 yr, plus 0.02° margin. Barnard's Star -> 0.10°, WISE 0855 -> 0.08°. */
    const pmYr = Math.hypot(x.pmEast || 0, x.pmNorth || 0) / 1000;
    $("#radius").value = Math.min(0.25, Math.max(0.05, +(pmYr * 28 / 3600 + 0.02).toFixed(2)));
    setNamed(x.id);
    if ((x.pmEast || x.pmNorth) && $("#motion-fold")) $("#motion-fold").open = true;
    const pm = Math.hypot(x.pmEast || 0, x.pmNorth || 0) / 1000;
    $("#pm-note").className = "pf-note";
    $("#pm-note").innerHTML = `<b>${x.name}</b> · ${x.kind || ""}. ${x.why || ""}` +
      (pm > 0.05 ? ` <span class="muted">${epochNote(x)}</span>` : "");
    echo();
  }

  function setNamed(id) {
    named = id;
    $("#name").value = id;
    map.select(id);
  }


  /* ---------- coordinates ---------- */
  function setCoords(ra, dec) {
    $("#ra").value = ra.toFixed(6);
    $("#dec").value = dec.toFixed(6);
    echo();
  }
  function echo() {
    const { ra, dec } = read();
    const ok = validCoords(ra, dec);
    const box = $("#coord-echo");
    box.classList.toggle("ok", ok);
    box.classList.toggle("bad", !ok && ($("#ra").value || $("#dec").value) !== "");
    const deg = ok ? `RA ${ra.toFixed(4)}° · Dec ${dec >= 0 ? "+" : ""}${dec.toFixed(4)}°` : "—";
    const pe = num("#pm-east", 0), pn = num("#pm-north", 0);
    const moving = !named && (pe || pn) ? ` · moving ${(Math.hypot(pe, pn) / 1000).toFixed(2)}″/yr` : "";
    const today = ok && !named && (pe || pn) ? (() => {
      const y = decimalYear(), q = positionAt(ra, dec, pe, pn, num("#epoch", 2000), y);
      return `<span class="mono today">Today (${y.toFixed(2)}): RA ${q.ra.toFixed(5)}° · Dec ${q.dec >= 0 ? "+" : ""}${q.dec.toFixed(5)}°, ${q.moved.toFixed(1)}″ from your ${num("#epoch", 2000)} position</span>`;
    })() : "";
    box.innerHTML = ok ? `<b>✓ Valid position</b><span class="mono">${deg}${moving}</span>${today}`
      : ($("#ra").value || $("#dec").value) ? `<b>✗ Not a valid position yet</b><span>RA 0–360° or hh:mm:ss · Dec −90…+90°</span>`
      : "Type a position, choose a name, or click the sky map.";
    if (!DEEP.concat(ASTEROIDS).some(d => d.id === $("#name").value)) $("#sel-name").textContent = named ? targets.find(t => t.id === named).name : "Typed coordinates";
    $("#sel-coords").textContent = deg;
    map.setCross(ok ? ra : NaN, ok ? dec : NaN);
  }
  const typed = () => {
    if (named || DEEP.concat(ASTEROIDS).some(d => d.id === $("#name").value)) setNamed("");
    $("#pm-note").className = "note-warn";
    $("#pm-note").textContent = "⚠ Any coordinates are allowed, but SPHEREx may not have imaged every spot yet. " +
      "Typed positions use the motion and year you enter (0 = fixed).";
    echo();
  };
  ["#ra", "#dec", "#pm-east", "#pm-north", "#epoch"].forEach(id => $(id).addEventListener("input", typed));

  /* ---------- map collapse ---------- */
  $("#map-toggle").addEventListener("click", e => {
    const open = $("#map-body").hidden;
    $("#map-body").hidden = !open;
    e.currentTarget.textContent = open ? "−" : "+";
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });

  /* the zoomable sky atlas lives in sky.js (Sky.atlas) */

  /* ---------- start: ?ra=&dec=&r=&band=&target= from the URL, else Barnard's Star ---------- */
  const q = new URLSearchParams(location.search);
  const fromUrl = q.get("target") && (targets.find(x => x.id === q.get("target")) ||
    DEEP.find(x => x.id === q.get("target")) || ASTEROIDS.find(x => x.id === q.get("target")));
  if (fromUrl) {                                       // ?target=crab (from the home page's "Open in explorer")
    if (DEEP.includes(fromUrl)) deep(fromUrl); else if (ASTEROIDS.includes(fromUrl)) asteroid(fromUrl); else fill(fromUrl);
  } else if (q.get("ra") && q.get("dec")) {
    setNamed(""); setCoords(parseRA(q.get("ra")), parseDec(q.get("dec")));
  } else {
    fill(targets.find(x => (x.tags || []).includes("challenge")) || targets[0]);
  }
  if (q.get("band")) $("#band").value = q.get("band");
  if (q.get("r")) { const r = +q.get("r"); $("#radius").value = r > 0.25 ? +(r / 60).toFixed(4) : r; }   // old links: arcmin
});
