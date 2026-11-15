/* =====================================================================
   sky.js — the four ways to look at one patch of sky, the Gaia overlay,
   and the honesty card. Shared by Star Vault and Sky Probe.

   SPHEREx gives every patch three "addresses": WHERE, WHEN, and WHICH COLOUR
   (each detector sits behind a linear variable filter, so where a star lands
   on the detector decides the wavelength it is measured at). A plain video
   mixes time and colour and can invent changes. So the player has dials:
     Time     same patch, frames in date order (optionally: same colour only)
     Colour   one visit, frames in wavelength order: what is it made of?
     Mission  2MASS (~1999) → AllWISE (2010) → SPHEREx: 16–27 years of motion
     Compare  two frames: blink them, or subtract one from the other
   and a card that says, for what is on screen, whether a change can be trusted.
   ===================================================================== */

const Sky = {
  mode: "time", res: null, params: null,
  gaia: null, gaiaFor: "", mission: null, missionFor: "", subtract: null,
  RAD: Math.PI / 180,

  HINTS: {
    time: "Same patch, in date order. Things that really change or move stand out.",
    colour: "One visit, in wavelength order. Brightness changes here show what the object is made of, not variability.",
    mission: "Older NASA images on the same pixels: 2MASS (about 1999), AllWISE (2010–11), then SPHEREx. Slow movers jump.",
    compare: "Pick two frames. Blink flips between them; Subtract shows only what changed.",
    grid: "Every image of this patch arranged by date (rows) and colour (columns): what SPHEREx saw, and what it hasn't seen yet.",
    trail: "Chosen images in one picture, coloured by date (blue = earliest, red = latest). Still things look white; a mover leaves a rainbow trail."
  },

  /* ---------- set-up (once, when the first results arrive) ---------- */
  wire() {
    if (this.wired) return;
    this.wired = true;
    const p = Explorer.player;
    p.drawExtra = (ctx, f, s) => this.draw(ctx, f, s);
    const old = p.onChange;
    p.onChange = i => { old(i); this.updateTrust(); };

    $("#modes").addEventListener("click", e => {
      const b = e.target.closest("[data-mode]"); if (b) this.setMode(b.dataset.mode);
    });
    $("#same-colour").addEventListener("change", () => this.applyTime());
    $("#colour-visit").addEventListener("change", () => this.applyColour());
    $("#colour-all").addEventListener("click", () => this.sixBand());
    $("#atlas-fly").addEventListener("click", () => this.fly());
    $("#atlas-open").addEventListener("click", () => this.initAtlas());
    this.wireFlags();
    this.wireTrail();
    $("#grid-one").addEventListener("click", () => this.gridOne());
    $("#grid-six").addEventListener("click", () => this.gridSix());
    $("#show-sso").addEventListener("change", e => this.toggleSso(e.target.checked));
    $$("[data-irsa]").forEach(b => b.addEventListener("click", () => this.toIrsa(b.dataset.irsa)));
    $("#survey").addEventListener("change", async e => {
      if (!this.al) return;
      try { this.al.setImageSurvey(await this.hipsUrl(e.target.value)); }
      catch (err) { $("#aladin-msg").textContent = "That survey could not load: " + err; }
    });
    $("#subtract-btn").addEventListener("click", () => this.toggleSubtract());
    // Blink / play / step always leave the difference picture first
    ["#blink-btn", "#play", "#prev", "#next", "#dots"].forEach(id =>
      $(id).addEventListener("click", () => {
        this.clearSubtract();
        if (this.mode === "trail" && id !== "#blink-btn") this.setMode("time");
      }, true));
    $("#blink-a").addEventListener("change", () => this.subtract && this.toggleSubtract(true));
    $("#blink-b").addEventListener("change", () => this.subtract && this.toggleSubtract(true));
    $("#show-gaia").addEventListener("change", e => this.toggleGaia(e.target.checked));
    $("#copy-link").addEventListener("click", () => this.copyLink());
    $("#search-edit").addEventListener("click", () => this.foldSearch(!$("#controls").classList.contains("folded")));
    addEventListener("resize", () => this.fit());
    this.wireTheatre();
    $("#player").addEventListener("click", e => ($("#flag-mode").checked ? this.flagAt(e) : this.pickStar(e)));
    $("#player").addEventListener("mouseleave", () => { $("#star-tip").hidden = true; });
  },

  onResults(res, params) {
    this.wire();
    this.foldSearch(true);
    this.res = res; this.params = params;
    this.mission = null; this.missionFor = ""; this.subtract = null; this.colourPic = null;
    Explorer.player.override = null;
    $("#colour-key").innerHTML = ""; setStatus($("#colour-status"), "");
    this.atlasFor(res, params);
    const key = `${res.centre.ra.toFixed(4)},${res.centre.dec.toFixed(4)}`;
    if (key !== this.gaiaFor) { this.gaia = null; this.gaiaFor = ""; }
    // visits for the Colour dial: the busiest visit first
    const visits = {};
    res.frames.forEach(f => { visits[f.visit] = (visits[f.visit] || 0) + 1; });
    const order = Object.keys(visits).sort((a, b) => visits[b] - visits[a]);
    $("#colour-visit").innerHTML = order.map(v => {
      const fr = res.frames.filter(f => String(f.visit) === v);
      return `<option value="${v}">Visit ${v} · ${fr[0].date.slice(0, 10)} · ${fr.length} frames</option>`;
    }).join("");
    $("#same-colour").checked = false;
    this.trailItems = null; this.loadFlags(); this.sso = null; this.six = null;
    $("#irsa-pos").textContent = `${res.centre.ra.toFixed(5)} ${res.centre.dec >= 0 ? "+" : ""}${res.centre.dec.toFixed(5)}`;
    if ($("#show-sso").checked) this.toggleSso(true);
    if ($("#show-gaia").checked) this.toggleGaia(true);
    const want = new URLSearchParams(location.search).get("mode");
    this.setMode(this.pendingMode || want || "time", true);
    this.pendingMode = null;
  },

  /* ---------- the search form folds into a one-line bar once there are results ---------- */
  foldSearch(fold) {
    const form = $("#controls"), bar = $("#search-bar"), btn = $("#search-edit");
    bar.hidden = false;
    form.classList.toggle("folded", fold);
    document.body.classList.toggle("searched", fold);
    btn.setAttribute("aria-expanded", String(!fold));
    btn.textContent = fold ? "Change search" : "Hide search";
    btn.classList.toggle("on", !fold);
    this.fit();
    if (!fold) {   // the bar is sticky, so scroll to the form itself, just under the nav + bar
      const nav = $(".nav"), y = form.getBoundingClientRect().top + scrollY - (nav ? nav.offsetHeight : 0) - bar.offsetHeight - 16;
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    }
  },

  /* The workbench fills the window under the sticky nav + bar, so nothing needs page scrolling. */
  fit() {
    const nav = $(".nav"), bar = $("#search-bar");
    const top = (nav ? nav.offsetHeight : 0) + (bar && !bar.hidden ? bar.offsetHeight : 0);
    document.documentElement.style.setProperty("--wb-top", top + "px");
    if (nav) document.documentElement.style.setProperty("--nav-h", nav.offsetHeight + "px");
  },

  /* ---------- big view: the stage pops out over the page while playing or blinking ---------- */
  wireTheatre() {
    const p = Explorer.player, stage = this.stageEl = $(".player-card .stage");
    this.stageHome = document.createComment("stage");
    try { $("#th-auto").checked = localStorage.getItem("orbital.popout") !== "0"; } catch (_) {}
    $("#th-auto").addEventListener("change", e => { try { localStorage.setItem("orbital.popout", e.target.checked ? "1" : "0"); } catch (_) {} });
    $("#stage-expand").addEventListener("click", () => this.theatre(true));
    $("#th-close").addEventListener("click", () => this.theatre(false));
    $("#th-play").addEventListener("click", () => p.toggle());
    $("#th-prev").addEventListener("click", () => { p.stop(); p.prev(); });
    $("#th-next").addEventListener("click", () => { p.stop(); p.next(); });
    stage.addEventListener("click", e => { if (e.target === stage && stage.classList.contains("theatre")) this.theatre(false); });
    addEventListener("keydown", e => { if (e.key === "Escape" && stage.classList.contains("theatre")) this.theatre(false); });
    p.onPlayState = on => {
      $("#th-play").textContent = on ? "❚❚ Pause" : "▶ Play";
      if (on && $("#th-auto").checked && this.mode !== "grid") this.theatre(true);
    };
    const prevChange = p.onChange;
    p.onChange = i => { if (prevChange) prevChange.call(p, i); this.theatreCount(); };
  },

  theatre(on) {
    const stage = this.stageEl;
    if (!stage || on === stage.classList.contains("theatre")) return;
    const ov = $(".overlays");
    if (on) {               // move it to <body> so no card's overflow or filter can clip it
      stage.parentNode.insertBefore(this.stageHome, stage);
      document.body.appendChild(stage);
      if (ov) { this.ovHome = document.createComment("overlays"); ov.parentNode.insertBefore(this.ovHome, ov); stage.appendChild(ov); }
      document.body.classList.add("theatre-open");
    } else {
      this.stageHome.parentNode.insertBefore(stage, this.stageHome);
      this.stageHome.remove();
      if (ov && this.ovHome) { this.ovHome.parentNode.insertBefore(ov, this.ovHome); this.ovHome.remove(); this.ovHome = null; }
      document.body.classList.remove("theatre-open");
    }
    stage.classList.toggle("theatre", on);
    $("#star-tip").hidden = true;
    this.theatreCount();
    if (on) $("#th-close").focus({ preventScroll: true });
  },

  theatreCount() {
    const p = Explorer.player, el = $("#th-count");
    if (!el || !p.res) return;
    const n = p.seq && p.seq.length ? p.seq.length : p.res.frames.length;
    el.textContent = p.blinking ? `Blink · showing ${p.pos === 0 ? "A" : "B"}` : `${(p.pos ?? p.i) + 1} / ${n}`;
  },

  /* ---------- the dials ---------- */
  async setMode(mode, first) {
    if (!this.res) return;
    const p = Explorer.player;
    this.mode = mode;
    $$("#modes [data-mode]").forEach(b => {
      b.classList.toggle("on", b.dataset.mode === mode);
      b.setAttribute("aria-selected", String(b.dataset.mode === mode));
    });
    $("#mode-hint").textContent = this.HINTS[mode];
    ["time", "colour", "mission", "compare", "trail", "grid"].forEach(m => { $("#ctrl-" + m).hidden = m !== mode; });
    $(".player-card").classList.toggle("grid-on", mode === "grid");
    this.clearSubtract();
    this.clearColourPic();
    this.clearTrail();
    p.stop();
    if (mode !== "mission" && p.res !== this.res) await p.load(this.res);
    if (mode === "time") this.applyTime(first);
    if (mode === "colour") this.applyColour();
    if (mode === "mission") await this.applyMission();
    if (mode === "compare") { p.all(); p.go(+$("#blink-a").value || 0); }
    if (mode === "trail") await this.applyTrail(true);
    if (mode === "grid") this.gridOne();
    this.updateTrust();
  },

  applyTime() {
    const p = Explorer.player, fr = this.res.frames;
    p.stop();
    if (!$("#same-colour").checked) { p.all(); p.render(); return; }
    const ref = fr[p.i] && fr[p.i].wavelength ? fr[p.i] : fr.find(f => f.wavelength);
    if (!ref) { p.all(); p.render(); return; }
    const tol = Explorer.warnFraction || 0.01;
    const idx = fr.map((f, k) => [f, k])
      .filter(([f]) => f.wavelength && Math.abs(f.wavelength - ref.wavelength) / ref.wavelength <= tol)
      .map(([, k]) => k);
    if (idx.length < 2) {
      $("#same-colour").checked = false;
      setStatus($("#mode-hint"), `No other frame is within ${tol * 100}% of λ ${ref.wavelength.toFixed(3)} µm. ` +
        "SPHEREx needs more visits here; showing all frames.", "warn");
      p.all(); p.render(); return;
    }
    p.seq = idx; p.pos = 0; p.render();
  },

  applyColour() {
    const p = Explorer.player, v = $("#colour-visit").value;
    const idx = this.res.frames.map((f, k) => [f, k])
      .filter(([f]) => String(f.visit) === v && f.wavelength)
      .sort((a, b) => a[0].wavelength - b[0].wavelength).map(([, k]) => k);
    p.stop();
    p.seq = idx.length ? idx : this.res.frames.map((_, k) => k);
    p.pos = 0; p.render();
  },

  /* Colour dial: all six detectors in ONE picture, one hue per detector (blue = shortest
     wavelength … red = longest). Fetched and stacked by the backend on this exact grid. */
  async sixBand() {
    const p = Explorer.player, res = this.res, btn = $("#colour-all");
    if (this.colourPic) { this.clearColourPic(); p.render(); return; }
    const c = res.centre || {}, f = res.frames;
    const prm = Object.assign({}, this.params, { bands: "1,2,3,4,5,6", cra: c.ra, cdec: c.dec, cyear: c.epoch || "" });
    if (!prm.start && !prm.end && f.length) {              // stay close in time to the loaded images (±20 days)
      prm.start = this.date(f[0].mjd - 20); prm.end = this.date(f[f.length - 1].mjd + 20);
    }
    btn.disabled = true;
    try {
      const r = await API.colour(prm, st => setStatus($("#colour-status"), `${st.message} · ${Math.round(st.elapsed)} s`));
      if (this.mode !== "colour") return;
      if (!r.png) { setStatus($("#colour-status"), r.note || "Not enough bands had data here.", "warn"); return; }
      const im = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = r.png; });
      p.stop();
      this.colourPic = r;
      p.override = (ctx, cv) => { ctx.imageSmoothingEnabled = false; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cv.width, cv.height);
                                  ctx.drawImage(im, 0, 0, cv.width, cv.height); };
      p.hudLabel = `${r.bands.length}-DETECTOR COLOUR PICTURE · blue = short λ, red = long λ`;
      p.render();
      $("#colour-key").innerHTML = (r.key ? this.keyHtml(r.key) : `<b>${r.legend}</b>`) + `<p class="muted">${r.caveat}</p>`;
      btn.textContent = "Back to the frames";
      setStatus($("#colour-status"), r.bands.length < 6 ? `Only ${r.bands.length} detectors had data near these dates.` : "", "warn");
    } catch (e) {
      setStatus($("#colour-status"), e.message, "error");
    } finally { btn.disabled = false; }
  },

  clearColourPic() {
    if (!this.colourPic) return;
    this.colourPic = null;
    Explorer.player.override = null;
    Explorer.player.hudLabel = null;
    $("#colour-key").innerHTML = "";
    $("#colour-all").textContent = "All 6 detectors in one picture";
  },

  keyHtml(key) {
    return `<div class="ckey">` + key.map(k => `<span><i style="background:${k.colour}"></i>${k.band}` +
      (k.wavelength ? ` <small>${(+k.wavelength).toFixed(2)} µm</small>` : "") + `</span>`).join("") + `</div>`;
  },

  /* ---------- the sky atlas (Aladin Lite, CDS Strasbourg) ----------
     Starts as the whole sky (Aitoff projection, Milky Way across the middle) and flies in
     to the patch the first time it scrolls into view. */
  atlasFor(res, params) {
    this.atlasTarget = { ra: res.centre.ra, dec: res.centre.dec, name: res.centre.name || "Search region",
      rDeg: (params.radius || 2) / 60, side: res.sizePixels * res.pixelArcsec / 3600 };
    if (this.al) { this.drawAtlasMarks(); this.al.gotoRaDec(res.centre.ra, res.centre.dec); this.al.setFoV(this.atlasFov()); }
    else this.initAtlas();            // mirrors answer in < 1 s, so open it straight away, like IRSA's own pages
  },

  /* CDS stopped serving 2MASS/WISE/DSS from its own server in Nov 2026; use the first mirror
     (from /api/links, fastest first) that answers within 4 s. */
  async hipsUrl(key) {
    const fallback = { "2mass": ["https://casda.csiro.au/hips/2MASS/Color", "https://skies.esac.esa.int/2MASSColor"],
                       allwise: ["https://skies.esac.esa.int/AllWISEColor", "https://hips.china-vo.org/m/CDS_P_allWISE_color"],
                       dss: ["https://casda.csiro.au/hips/DSS2/color", "https://skies.esac.esa.int/DSSColor"] };
    if (!this.mirrors) { try { this.mirrors = (await API._get("/api/links", null, 5000)).hips_mirrors; } catch (_) {} }
    const list = (this.mirrors && this.mirrors[key]) || fallback[key] || fallback["2mass"];
    this.hipsOk = this.hipsOk || {};
    if (this.hipsOk[key]) return this.hipsOk[key];
    for (const url of list) {
      try { const r = await fetchTimeout(url + "/properties", 4000); if (r.ok) { this.hipsOk[key] = url; return url; } } catch (_) {}
    }
    return list[0];
  },

  atlasFov() { return Math.max(0.05, (this.atlasTarget ? this.atlasTarget.rDeg : 0.03) * 3.2); },

  /* Only when asked: Aladin pulls sky images from CDS Strasbourg, which can be slow from far away. */
  async initAtlas() {
    const msg = $("#aladin-msg"), view = $("#aladin-view");
    if (this.al || !this.atlasTarget) return;
    msg.textContent = "Starting the sky atlas…";
    $("#atlas-open").disabled = true;
    await waitForAladin();
    if (!window.A || !A.init) { msg.textContent = "The sky atlas could not load (vendor/aladin-lite-3.8.2.js missing?)."; $("#atlas-open").disabled = false; return; }
    try {
      await A.init;
      view.classList.remove("atlas-idle"); view.innerHTML = "";
      const t = this.atlasTarget;
      const survey = await this.hipsUrl($("#survey").value);
      this.al = A.aladin("#aladin-view", {
        survey,
        projection: "TAN", cooFrame: "ICRS", fov: this.atlasFov(), target: `${t.ra} ${t.dec}`,
        showReticle: false, showZoomControl: true, showFullscreenControl: true, showLayersControl: true,
        showProjectionControl: true, showFrame: true, showCooLocation: true, showFov: true,
        showSettingsControl: true, showSimbadPointerControl: true, showCooGridControl: true,
        showContextMenu: true, showShareControl: false
      });
      this.drawAtlasMarks();
      $("#atlas-fly").disabled = false;
      msg.textContent = "Drag to pan, scroll to zoom. Cyan circle = the SPHEREx patch; dashed square = the exact picture above.";
    } catch (e) {
      $("#atlas-open").disabled = false;
      msg.textContent = "The sky atlas could not start: " + (e && e.message ? e.message : e) +
        (String(e).includes("WebGL") ? " (this browser has WebGL2 switched off)." : "");
    }
  },

  drawAtlasMarks() {
    const al = this.al, t = this.atlasTarget;
    if (!al || !t) return;
    try {
      if (this.atlasLayers) this.atlasLayers.forEach(l => { try { l.removeAll(); } catch (_) {} });
      const ring = A.graphicOverlay({ name: "SPHEREx patch", color: "#70d6ff", lineWidth: 2 });
      al.addOverlay(ring);
      ring.add(A.circle(t.ra, t.dec, t.rDeg));
      const h = t.side / 2, k = 1 / Math.cos(t.dec * this.RAD);
      ring.add(A.polygon([[t.ra - h * k, t.dec - h], [t.ra + h * k, t.dec - h], [t.ra + h * k, t.dec + h], [t.ra - h * k, t.dec + h]],
                         { color: "rgba(112,214,255,.6)", lineWidth: 1, lineDash: [4, 4] }));
      const label = A.catalog({ name: "Search region", shape: "circle", sourceSize: 14, color: "#70d6ff",
                                displayLabel: true, labelColumn: "name", labelColor: "#70d6ff", labelFont: "600 13px sans-serif" });
      al.addCatalog(label);
      label.addSources([A.source(t.ra, t.dec, { name: t.name })]);
      this.atlasLayers = [ring, label];
      this.atlasGaia();
    } catch (e) { console.warn("atlas marks", e); }
  },

  /* Our Gaia stars as a clickable catalogue layer in the atlas too (positions at Gaia's 2016 epoch). */
  atlasGaia() {
    if (!this.al || !this.gaia || !this.gaia.ok || this.atlasGaiaFor === this.gaiaFor) return;
    try {
      const cat = A.catalog({ name: "Gaia DR3 (2016 positions)", shape: "circle", sourceSize: 10, color: "#70d6ff" });
      this.al.addCatalog(cat);
      cat.addSources(this.gaia.stars.map(s => A.source(s.ra, s.dec, { name: "Gaia DR3 " + s.id, G: s.g,
        pm_mas_yr: Math.hypot(s.pmra, s.pmdec).toFixed(1) })));
      this.atlasGaiaFor = this.gaiaFor;
      (this.atlasLayers = this.atlasLayers || []).push(cat);
    } catch (e) { console.warn("atlas gaia", e); }
  },

  /* Whole sky → constellation → field → patch, about six seconds (button only). */
  async fly() {
    const al = this.al, t = this.atlasTarget;
    if (!al || !t) return;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const zoom = (fov, sec) => new Promise(done => {
      let finished = false; const end = () => { if (!finished) { finished = true; done(); } };
      try { if (al.zoomToFoV) al.zoomToFoV(fov, sec, end); else al.setFoV(fov); } catch (_) { al.setFoV(fov); }
      setTimeout(end, sec * 1000 + 250);
    });
    $("#atlas-fly").disabled = true;
    try {
      al.gotoRaDec(t.ra, t.dec);
      try { al.setProjection("AIT"); } catch (_) {}
      al.setFoV(300);
      await wait(1200);
      for (const [fov, sec] of [[60, 1.4], [10, 1.3]]) await zoom(fov, sec);
      try { al.setProjection("TAN"); } catch (_) {}
      for (const [fov, sec] of [[1.4, 1.3], [this.atlasFov(), 1.2]]) await zoom(fov, sec);
    } finally { $("#atlas-fly").disabled = false; }
  },

  /* ---------- flags: the user's own marks ----------
     Click a spot with "Flag objects" on, say what you think it is. Each flag remembers the
     sky position (RA/Dec, computed back from the pixel through the same TAN grid), the frame
     it was made on, and the data release, so it can be reported and checked later. */
  FLAG_TYPES: { mover: ["Possible mover", "#ff8a5c"], variable: ["Brightness change", "#f5d04e"],
                nogaia: ["Bright, no Gaia star", "#b18cff"], artefact: ["Artefact", "#9aa4b2"],
                known: ["Known object", "#70d6ff"], other: ["Other", "#ffffff"] },

  flagKey() {
    const r = this.res, q = (r && r.query) || {};
    return "orbital.flags." + (q.target || `${(+q.ra).toFixed(4)},${(+q.dec).toFixed(4)}`);
  },
  loadFlags() {
    this.flags = [];
    try { this.flags = JSON.parse(localStorage.getItem(this.flagKey()) || "[]"); } catch (_) { this.flags = []; }
    this.renderFlags();
  },
  saveFlags() {
    try { localStorage.setItem(this.flagKey(), JSON.stringify(this.flags)); } catch (_) { /* private mode: keep in memory */ }
    this.renderFlags();
  },

  /* pixel (grid x, y) -> RA, Dec: inverse of project() (gnomonic / TAN projection) */
  skyAt(x, y) {
    const r = this.res, R = this.RAD, c = (r.sizePixels - 1) / 2, k = r.pixelArcsec / 206264.806;
    const xi = (c - x) * k, eta = (c - y) * k;
    const d0 = r.centre.dec * R, a0 = r.centre.ra * R;
    const den = Math.cos(d0) - eta * Math.sin(d0);
    const ra = a0 + Math.atan2(xi, den);
    const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den));
    return { ra: ((ra / R) % 360 + 360) % 360, dec: dec / R };
  },

  wireFlags() {
    $("#flag-mode").addEventListener("change", e => {
      $("#player").classList.toggle("flagging", e.target.checked);
      if (e.target.checked) { $("#flags-card").open = true; Explorer.player.stop(); }
      $("#flag-pop").hidden = true;
    });
    $("#flag-cancel").addEventListener("click", () => { $("#flag-pop").hidden = true; this.pending = null; Explorer.player.render(); });
    $("#flag-pop").addEventListener("submit", e => {
      e.preventDefault();
      if (!this.pending) return;
      const f = Object.assign(this.pending, { type: $("#flag-type").value, note: $("#flag-note").value.trim(),
                                              made: new Date().toISOString().slice(0, 16).replace("T", " ") });
      this.flags.push(f); this.pending = null;
      $("#flag-pop").hidden = true; $("#flag-note").value = "";
      this.saveFlags(); Explorer.player.render();
    });
    $("#flags-list").addEventListener("click", e => {
      const li = e.target.closest("li"); if (!li) return;
      const k = +li.dataset.k;
      if (e.target.closest("[data-del]")) { this.flags.splice(k, 1); this.saveFlags(); Explorer.player.render(); return; }
      if (e.target.closest("[data-go]")) {
        const f = this.flags[k], p = Explorer.player;
        if (this.mode !== "time") this.setMode("time");
        if (f.frame != null && this.res.frames[f.frame]) { p.stop(); p.all(); p.go(f.frame); }
        $("#player").scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    $("#flags-csv").addEventListener("click", () => this.flagsCsv());
    $("#flags-copy").addEventListener("click", () => this.flagsCopy());
  },

  flagAt(e) {
    const p = Explorer.player, c = $("#player"), rect = c.getBoundingClientRect();
    if (!this.res || !p.res) return;
    const sc = c.width / rect.width, s = c.width / this.res.sizePixels;
    const x = ((e.clientX - rect.left) * sc) / s - 0.5, y = ((e.clientY - rect.top) * sc) / s - 0.5;
    const sky = this.skyAt(x, y), f = p.res.frames[p.i] || {};
    const real = p.res === this.res;
    this.pending = { x: +x.toFixed(2), y: +y.toFixed(2), ra: +sky.ra.toFixed(6), dec: +sky.dec.toFixed(6),
                     frame: real ? p.i : null, date: f.date || "", wavelength: f.wavelength || null,
                     view: this.mode, band: this.res.query.band };
    const pop = $("#flag-pop");
    const sr = c.parentNode.getBoundingClientRect();   // the stage (also in the big view)
    pop.style.left = Math.min(sr.width - 230, (e.clientX - sr.left) + 12) + "px";
    pop.style.top = Math.min(sr.height - 150, (e.clientY - sr.top) + 12) + "px";
    pop.hidden = false; $("#flag-type").focus();
    p.render();
  },

  drawFlags(ctx, s) {
    const list = (this.flags || []).slice();
    if (this.pending) list.push(Object.assign({ type: "other", pendingMark: true }, this.pending));
    if (!list.length) return;
    ctx.save(); ctx.font = "700 11px system-ui, sans-serif"; ctx.textBaseline = "middle";
    list.forEach((f, k) => {
      const col = (this.FLAG_TYPES[f.type] || this.FLAG_TYPES.other)[1];
      const x = (f.x + 0.5) * s, y = (f.y + 0.5) * s, h = Math.max(9, 1.5 * s);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(f.pendingMark ? [3, 3] : []);
      ctx.strokeRect(x - h, y - h, 2 * h, 2 * h);
      if (!f.pendingMark) {
        ctx.fillStyle = col; ctx.fillRect(x + h - 1, y - h - 14, 16, 14);
        ctx.fillStyle = "#0b1322"; ctx.fillText(String(k + 1), x + h + 3, y - h - 7);
      }
    });
    ctx.restore();
  },

  renderFlags() {
    const list = this.flags || [];
    $("#flags-count").textContent = `(${list.length})`;
    $("#flags-list").innerHTML = list.map((f, k) => {
      const [name, col] = this.FLAG_TYPES[f.type] || this.FLAG_TYPES.other;
      return `<li data-k="${k}"><i style="background:${col}"></i><div><b>${k + 1}. ${name}</b>` +
        `<span class="mono">RA ${f.ra.toFixed(5)}° · Dec ${f.dec >= 0 ? "+" : ""}${f.dec.toFixed(5)}°</span>` +
        `<span>${f.date ? "on " + f.date : ""}${f.wavelength ? " · λ " + (+f.wavelength).toFixed(3) + " µm" : ""}</span>` +
        (f.note ? `<span class="fnote">“${f.note.replace(/</g, "&lt;")}”</span>` : "") +
        `</div><span class="factions"><button type="button" class="linkish" data-go>show</button>` +
        `<button type="button" class="linkish" data-del>delete</button></span></li>`;
    }).join("") || `<li class="muted empty">No flags yet.</li>`;
    // keep the Toolbox's Flags tool in step
    if (typeof Features !== "undefined" && Features.active === "flags" && Features.el && Features.el.classList.contains("tool-open")) Features.open("flags");
  },

  flagsCsv() {
    const r = this.res, rows = [["n", "type", "ra_deg", "dec_deg", "frame_date_utc", "wavelength_um", "band", "note",
                                 "target", "release", "doi", "flagged_at"]];
    (this.flags || []).forEach((f, k) => rows.push([k + 1, (this.FLAG_TYPES[f.type] || [f.type])[0], f.ra, f.dec, f.date,
      f.wavelength || "", f.band, f.note || "", (r.centre && r.centre.name) || "", r.release || "", r.doi || "", f.made || ""]));
    const csv = rows.map(row => row.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `flags_${(r.query.target || "position")}_${r.query.band}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  flagsCopy() {
    const r = this.res, list = this.flags || [];
    const lines = [`SPHEREx flags — ${(r.centre && r.centre.name) || "custom position"} (${r.query.band})`,
      `Data: SPHEREx ${String(r.release || "").toUpperCase()} from NASA/IPAC IRSA${r.doi ? ", DOI " + r.doi : ""}`, ""]
      .concat(list.map((f, k) => `${k + 1}. ${(this.FLAG_TYPES[f.type] || [f.type])[0]} at RA ${f.ra.toFixed(5)}, Dec ${f.dec.toFixed(5)}` +
        `${f.date ? ", seen on " + f.date : ""}${f.note ? " — " + f.note : ""}`));
    const text = lines.join("\n");
    const btn = $("#flags-copy");
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      () => { btn.textContent = "Copied ✓"; setTimeout(() => { btn.textContent = "Copy report"; }, 1600); },
      () => prompt("Copy this report:", text));
  },

  /* ---------- Trail: chosen images in one picture, coloured by date ----------
     Each chosen image gets a hue from blue (earliest) to red (latest); the picture keeps the
     brightest value of each colour channel. Something that stayed put is bright in every
     image, so all hues add up to white; something that moved is bright in a different place
     in each, so it leaves a rainbow of dots in date order. */
  wireTrail() {
    $("#trail-group").addEventListener("change", () => this.applyTrail(true));
    $("#trail-n").addEventListener("change", () => this.pickEvenly());
    $("#trail-all").addEventListener("click", () => { $$("#trail-list input").forEach(i => { i.checked = true; }); this.drawTrail(); });
    $("#trail-none").addEventListener("click", () => { $$("#trail-list input").forEach(i => { i.checked = false; }); this.drawTrail(); });
    $("#trail-old").addEventListener("change", () => this.applyTrail(false));
    $("#trail-list").addEventListener("change", () => this.drawTrail());
  },

  trailGroups() {
    const r = this.res, fx = r.features || {}, how = $("#trail-group").value;
    if (how === "visit" && fx.visits && fx.visits.length >= 2) {
      return fx.visits.map(v => ({ png: v.png, year: this.year(v.mjd), date: this.date(v.mjd),
                                   label: `Visit ${v.visit} · ${this.date(v.mjd)} · ${v.count} exp.` }));
    }
    if (how === "visit" || how === "day") {          // one group per calendar day (median of PNG not needed: show first)
      const byDay = {};
      r.frames.forEach((f, k) => { const d = f.date.slice(0, 10); (byDay[d] = byDay[d] || []).push(k); });
      return Object.entries(byDay).map(([d, ks]) => ({ frames: ks, png: r.frames[ks[Math.floor(ks.length / 2)]].png,
        year: this.frameYear(r.frames[ks[0]]), date: d, label: `${d} · ${ks.length} exp.` }));
    }
    return r.frames.map((f, k) => ({ png: f.png, year: this.frameYear(f), date: f.date,
                                     label: `#${k + 1} · ${f.date}${f.wavelength ? " · " + f.wavelength.toFixed(3) + " µm" : ""}` }));
  },

  async applyTrail(fresh) {
    const res = this.res;
    let groups = this.trailGroups();
    if ($("#trail-old").checked) {
      if (!this.mission) {
        setStatus($("#trail-status"), "Fetching 2MASS and AllWISE images…");
        try { this.mission = await API._get("/api/survey", { ra: res.centre.ra, dec: res.centre.dec, size: res.sizePixels, band: res.query.band }, 60000); }
        catch (e) { this.mission = { ok: false, frames: [], error: e.message }; }
      }
      const old = (this.mission.frames || []).filter(f => f.ok)
        .map(f => ({ png: f.png, year: f.year, date: f.when, label: `${f.label} · ${f.when}`, old: true }));
      if (!old.length) setStatus($("#trail-status"), "Older images unavailable right now; showing SPHEREx only.", "warn");
      else setStatus($("#trail-status"), "");
      groups = old.concat(groups);
    }
    groups.sort((a, b) => a.year - b.year);
    if ($("#trail-group").value === "visit" && !((res.features || {}).visits || []).filter(Boolean)[1])
      setStatus($("#trail-status"), "Only one SPHEREx visit here so far, so the images are grouped by day instead.", "warn");
    this.trailItems = groups;
    $("#trail-list").innerHTML = groups.map((g, k) =>
      `<label class="tchip"><input type="checkbox" value="${k}"><i></i>${g.label}</label>`).join("");
    if (this.mode === "trail") (fresh || $("#trail-old").checked ? this.pickEvenly() : this.drawTrail());
  },

  pickEvenly() {
    const items = this.trailItems || [], n = Math.max(2, Math.min(items.length, +$("#trail-n").value || 6));
    const keep = new Set();
    for (let k = 0; k < n; k++) keep.add(Math.round(k * (items.length - 1) / Math.max(1, n - 1)));
    items.forEach((it, k) => { if (it.old) keep.add(k); });            // older surveys stay in when asked for
    $$("#trail-list input").forEach(i => { i.checked = keep.has(+i.value); });
    this.drawTrail();
  },

  async drawTrail() {
    const p = Explorer.player, res = this.res, items = this.trailItems || [];
    const chosen = $$("#trail-list input:checked").map(i => items[+i.value]).sort((a, b) => a.year - b.year);
    $$("#trail-list label").forEach(l => { const it = items[+$("input", l).value]; $("i", l).style.background = "transparent"; });
    if (chosen.length < 2) { this.clearTrail(); p.render(); setStatus($("#trail-status"), "Tick at least two images.", "warn"); return; }
    if (p.res !== res) await p.load(res);
    const N = res.sizePixels, n = chosen.length;
    const out = document.createElement("canvas"); out.width = out.height = N;
    const ox = out.getContext("2d"), img = ox.createImageData(N, N);
    const scratch = document.createElement("canvas"); scratch.width = scratch.height = N;
    const sx = scratch.getContext("2d");
    const hue = k => { const h = 240 * (1 - k / Math.max(1, n - 1)) / 60, c = 1, x = 1 - Math.abs(h % 2 - 1);
      const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.min(5, Math.floor(h))]; return t; };
    for (let k = 0; k < n; k++) {
      const im = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = chosen[k].png; });
      sx.clearRect(0, 0, N, N); sx.drawImage(im, 0, 0, N, N);
      const d = sx.getImageData(0, 0, N, N).data, [cr, cg, cb] = hue(k);
      chosen[k].colour = `rgb(${cr * 255},${cg * 255},${cb * 255})`;
      for (let q = 0; q < N * N; q++) {
        if (d[4 * q + 3] === 0) continue;
        const v = d[4 * q];
        img.data[4 * q] = Math.max(img.data[4 * q], v * cr);
        img.data[4 * q + 1] = Math.max(img.data[4 * q + 1], v * cg);
        img.data[4 * q + 2] = Math.max(img.data[4 * q + 2], v * cb);
        img.data[4 * q + 3] = 255;
      }
    }
    ox.putImageData(img, 0, 0);
    $$("#trail-list label").forEach(l => { const it = items[+$("input", l).value]; if (it.colour && $("input", l).checked) $("i", l).style.background = it.colour; });
    p.stop();
    this.trail = { canvas: out, chosen };
    p.override = (ctx, cv) => { ctx.imageSmoothingEnabled = false; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cv.width, cv.height);
                                ctx.drawImage(out, 0, 0, cv.width, cv.height); };
    p.hudLabel = `MOTION TRAIL · ${n} images · ${chosen[0].date.slice(0, 10)} (blue) → ${chosen[n - 1].date.slice(0, 10)} (red)`;
    p.seq = [0]; p.pos = 0; p.render();
    const span = chosen[n - 1].year - chosen[0].year;
    const m = res.motion, px = m ? Math.hypot(m.pmEast || 0, m.pmNorth || 0) / 1000 * span / res.pixelArcsec : 0;
    setStatus($("#trail-status"), `${span.toFixed(span < 2 ? 2 : 0)} years from first to last image` +
      (m && (m.pmEast || m.pmNorth) ? `: the target should move ${px.toFixed(1)} px.` +
        (px < 1 ? " Under one pixel, so its trail will look like one white dot. Tick “Add 2MASS + WISE”." : "") : "."),
      px >= 1 || !m ? "ok" : "warn");
    this.updateTrust();
  },

  clearTrail() {
    if (!this.trail) return;
    this.trail = null;
    const p = Explorer.player;
    p.override = null; p.hudLabel = null;
  },

  /* ---------- Grid: the time × colour picture of one patch ----------
     Rows are dates (visits, or days when there is only one visit); columns are colours.
     With one detector the columns are slices of its wavelength range; with all six they are
     the six detectors. Empty cells are honest: SPHEREx has not imaged that colour then yet. */
  groupsOf(frames) {
    const visits = [...new Set(frames.map(f => f.visit))];
    if (visits.length >= 2) return visits.map(v => ({ key: "Visit " + v, frames: frames.filter(f => f.visit === v) }));
    const days = {};
    frames.forEach(f => { (days[f.date.slice(0, 10)] = days[f.date.slice(0, 10)] || []).push(f); });
    return Object.entries(days).map(([d, fr]) => ({ key: d, frames: fr }));
  },

  gridOne() {
    $("#grid-one").className = "btn sm primary"; $("#grid-six").className = "btn sm ghost";
    const res = this.res, fr = res.frames.filter(f => f.wavelength);
    if (!fr.length) { $("#grid-view").innerHTML = `<p class="muted">No wavelength information in these frames.</p>`; return; }
    const lo = Math.min(...fr.map(f => f.wavelength)), hi = Math.max(...fr.map(f => f.wavelength));
    const K = Math.max(1, Math.min(6, new Set(fr.map(f => f.wavelength.toFixed(2))).size));
    const edges = Array.from({ length: K + 1 }, (_, k) => lo + (hi - lo) * k / K);
    const bin = l => Math.min(K - 1, Math.floor((l - lo) / ((hi - lo) / K || 1)));
    const groups = this.groupsOf(fr);
    const cols = edges.slice(0, K).map((e, k) => `${e.toFixed(2)}–${edges[k + 1].toFixed(2)} µm`);
    const cell = (g, k) => {
      const inBin = g.frames.filter(f => bin(f.wavelength) === k);
      if (!inBin.length) return `<td class="gcell empty"><span>not observed</span></td>`;
      const mid = (edges[k] + edges[k + 1]) / 2, f = inBin.sort((a, b) => Math.abs(a.wavelength - mid) - Math.abs(b.wavelength - mid))[0];
      return `<td class="gcell"><button type="button" data-frame="${f.index}" title="${f.date} · λ ${f.wavelength.toFixed(3)} µm">` +
        `<img src="${f.png}" alt=""><small>${f.wavelength.toFixed(3)}</small></button></td>`;
    };
    $("#grid-view").innerHTML = `<table class="tgrid"><thead><tr><th></th>${cols.map((c, k) =>
      `<th><button type="button" class="linkish" data-col="${k}">${c}</button></th>`).join("")}</tr></thead><tbody>` +
      groups.map((g, r) => `<tr><th><button type="button" class="linkish" data-row="${r}">${g.key}</button>` +
        `<small>${g.frames.length} exp.</small></th>${cols.map((_, k) => cell(g, k)).join("")}</tr>`).join("") + `</tbody></table>` +
      `<p class="muted grid-note">${res.query.band}: each column is a slice of this detector's colour range. ` +
      `“All 6 detectors” gives the full 0.75–5 µm picture.</p>`;
    this.gridData = { kind: "one", groups, bin, K };
    setStatus($("#grid-status"), "");
    this.wireGridClicks();
  },

  wireGridClicks() {
    const view = $("#grid-view");
    view.onclick = e => {
      const p = Explorer.player, d = this.gridData;
      const fb = e.target.closest("[data-frame]"), cb = e.target.closest("[data-col]"), rb = e.target.closest("[data-row]");
      if (d.kind === "six") {
        if (fb) { const [b, k] = fb.dataset.frame.split(":"); this.gridZoom(this.six[b].frames[+k], b); }
        return;
      }
      if (fb) { this.setMode("time").then(() => { p.stop(); p.all(); p.go(+fb.dataset.frame); }); return; }
      if (cb) {                                  // one colour, changing date
        const k = +cb.dataset.col, idx = this.res.frames.filter(f => f.wavelength && d.bin(f.wavelength) === k).map(f => f.index);
        this.setMode("time").then(() => { if (idx.length) { p.seq = idx; p.pos = 0; p.render(); p.play(); } });
        return;
      }
      if (rb) {                                  // one date, changing colour
        const g = d.groups[+rb.dataset.row], idx = g.frames.slice().sort((a, b) => a.wavelength - b.wavelength).map(f => f.index);
        this.setMode("colour").then(() => { p.seq = idx; p.pos = 0; p.render(); p.play(); });
      }
    };
  },

  async gridSix() {
    $("#grid-six").className = "btn sm primary"; $("#grid-one").className = "btn sm ghost";
    const btn = $("#grid-six"); btn.disabled = true;
    const cur = this.res.query.band;
    this.six = this.six || {};
    this.six[cur] = this.res;
    try {
      for (let b = 1; b <= 6; b++) {
        const id = "D" + b;
        if (this.six[id]) continue;
        setStatus($("#grid-status"), `Loading ${id} (${b} of 6)…`);
        try {
          const prm = Object.assign({}, this.params, { band: id });
          this.six[id] = await API.search(prm, st => setStatus($("#grid-status"), `Loading ${id} (${b} of 6): ${st.message}`));
        } catch (e) { this.six[id] = { frames: [], error: e.message }; }
        if (this.mode !== "grid") return;
      }
    } finally { btn.disabled = false; }
    // visits: cluster every exposure of every detector by date (a gap > 5 days starts a new visit)
    const all = [];
    Object.entries(this.six).forEach(([b, r]) => (r.frames || []).forEach((f, k) => all.push({ b, k, mjd: f.mjd })));
    all.sort((a, b) => a.mjd - b.mjd);
    const visits = [];
    all.forEach(x => { const v = visits[visits.length - 1]; if (!v || x.mjd - v.end > 5) visits.push({ start: x.mjd, end: x.mjd, items: [x] }); else { v.end = x.mjd; v.items.push(x); } });
    const bands = ["D1", "D2", "D3", "D4", "D5", "D6"];
    const cell = (v, b) => {
      const its = v.items.filter(x => x.b === b);
      if (!its.length) return `<td class="gcell empty"><span>${(this.six[b] || {}).error ? "failed" : "not observed"}</span></td>`;
      const fr = its.map(x => this.six[b].frames[x.k]).sort((a, c) => (a.wavelength || 0) - (c.wavelength || 0));
      const f = fr[Math.floor(fr.length / 2)], k = this.six[b].frames.indexOf(f);
      return `<td class="gcell"><button type="button" data-frame="${b}:${k}" title="${b} · ${f.date}${f.wavelength ? " · λ " + f.wavelength.toFixed(3) + " µm" : ""}">` +
        `<img src="${f.png}" alt=""><small>${f.wavelength ? f.wavelength.toFixed(2) : ""}</small></button></td>`;
    };
    const B = (window.BANDS || []).reduce((o, x) => (o[x.id] = x, o), {});
    $("#grid-view").innerHTML = `<table class="tgrid six"><thead><tr><th></th>${bands.map(b =>
      `<th>${b}<small>${B[b] ? B[b].min + "–" + B[b].max + " µm" : ""}</small></th>`).join("")}</tr></thead><tbody>` +
      visits.map((v, r) => `<tr><th>Visit ${r + 1}<small>${this.date(v.start)}${v.end - v.start > 1 ? " → " + this.date(v.end) : ""}</small></th>` +
        `${bands.map(b => cell(v, b)).join("")}</tr>`).join("") + `</tbody></table><div class="grid-zoom" id="grid-zoom"></div>` +
      `<p class="muted grid-note">Each detector keeps its own brightness scale. Middle-wavelength exposure of each visit shown. ` +
      `Detectors 1+4, 2+5 and 3+6 are photographed together; other pairs at different moments.</p>`;
    this.gridData = { kind: "six" };
    const failed = bands.filter(b => (this.six[b] || {}).error);
    setStatus($("#grid-status"), failed.length ? `Could not load ${failed.join(", ")}.` : "", failed.length ? "warn" : "ok");
    this.wireGridClicks();
  },

  gridZoom(f, b) {
    const z = $("#grid-zoom"); if (!z || !f) return;
    z.innerHTML = `<figure><img src="${f.png}" alt=""><figcaption class="mono">${b} · ${f.date}` +
      `${f.wavelength ? " · λ " + f.wavelength.toFixed(3) + " µm" : ""}</figcaption></figure>`;
  },

  /* ---------- hand-off to IRSA's own tools ----------
     VERIFIED 15 Nov 2026 on IRSA (…/applications/spherex/?api lists the Web API):
       SPHEREx Data Explorer: ?api=spectral-images&ra=&dec=&spatialRegionOperation=contains_point
         &obsCoreWavelengthRangeType=overlaps&obsCoreWavelengthMinRange=&…MaxRange=&execute=true
         → opens AND runs the image search for this spot, this detector's wavelengths, these dates.
       MOST (Moving Object Search Tool): /cgi-bin/MOST/nph-most?catalog=spherex&input_type=name_input
         &obj_name=433:AST&output_mode=Regular → SPHEREx images that caught that asteroid.
       Spectrophotometry Tool: has no Web API command, so it cannot be pre-filled from a link;
         we copy the position for the user to paste. */
  /* Hand-off to IRSA's own tools, always through a short pop-up (Extras.handoff): it says what is filled in
     for you, or exactly what to type where when IRSA can't take it from a link, then opens IRSA after 4.5 s.
     VERIFIED 15 Nov 2026 on IRSA: Data Explorer runs a search from ?api=spectral-images (it may sit "Queued"
     while IRSA is busy); MOST wants an object NAME (not a position) with Image Dataset = spherex; the
     Spectrophotometry Tool has no link API: Single Object · position box · Point Source · Wavelength Bands ·
     Time Range · Submit (jobs take minutes, shown in Job Monitor). */
  async toIrsa(which) {
    const r = this.res, c = r && r.centre;
    if (!c) return;
    const links = this.irsaLinks || {};
    if (!this.irsaLinks) API._get("/api/links", null, 5000).then(l => { this.irsaLinks = l; }).catch(() => {});
    const base = { spectrophotometry: "https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry",
                   spherex_explorer: "https://irsa.ipac.caltech.edu/applications/spherex/",
                   most: "https://irsa.ipac.caltech.edu/applications/MOST/" };
    const band = (window.BANDS || []).find(x => x.id === r.query.band);
    const bandNo = (r.query.band || "").replace("D", "");
    const pos = `${c.ra.toFixed(6)} ${c.dec.toFixed(6)}`;
    const days = r.frames.map(f => f.date.slice(0, 10)).sort(), d0 = days[0], d1 = days[days.length - 1];
    const moving = c.epoch && r.motion && (r.motion.pmEast || r.motion.pmNorth);
    const movingNote = moving ? `This is where the target was in ${c.epoch.toFixed(2)}, the date of these images; ` +
      `it moves ${(Math.hypot(r.motion.pmEast, r.motion.pmNorth) / 1000).toFixed(2)}″/yr, so keep the Start/End Time above.` : "";

    if (which === "spherex_explorer") {
      const q = new URLSearchParams({ api: "spectral-images", ra: c.ra.toFixed(6), dec: c.dec.toFixed(6), spatialRegionOperation: "contains_point" });
      if (band) { q.set("obsCoreWavelengthRangeType", "overlaps"); q.set("obsCoreWavelengthMinRange", band.min); q.set("obsCoreWavelengthMaxRange", band.max); }
      const prm = this.params || {};
      if (prm.start || prm.end) {
        q.set("exposureTimeMode", "iso");
        q.set("exposureMin", (prm.start || "2025-03-11") + "T00:00:00Z"); q.set("exposureMax", (prm.end || "2030-01-01") + "T23:59:59Z");
      }
      q.set("execute", "true");
      return Extras.handoff({
        tool: "SPHEREx Data Explorer", filled: true, url: (links.spherex_explorer || base.spherex_explorer) + "?" + q.toString(),
        intro: "IRSA takes this search straight from the link and runs it for you:",
        steps: [{ k: "Position", v: pos }, band && { k: "Wavelength", v: `${band.min}–${band.max} µm (${r.query.band})` },
                (prm.start || prm.end) && { k: "Dates", v: `${prm.start || "start"} → ${prm.end || "now"}` }].filter(Boolean),
        note: "If IRSA shows “Queued…”, it is busy: leave the tab open and the images appear in a minute or two. " + movingNote
      });
    }

    if (which === "most") {
      const most = links.most || base.most;
      const mostUrl = n => "https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most?" + new URLSearchParams({
        catalog: "spherex", input_type: "name_input", obj_name: this.mostName(n), output_mode: "Regular",
        ephem_step: "0.25", obs_begin: d0, obs_end: d1 }).toString();
      if (!this.sso || !this.sso.ok) {                 // ask NASA/JPL first, with the pop-up saying so
        Extras.handoff({ tool: "Moving Object Search Tool (MOST)", filled: false, url: most, steps: [],
          intro: "☄ Asking NASA/JPL which known asteroids crossed this patch, to fill MOST in for you… (up to a minute when JPL is busy)" });
        clearTimeout(Extras.hoTimer); $(".ho-bar i").style.animationPlayState = "paused";
        $("#show-sso").checked = true; await this.toggleSso(true);
        if ($("#handoff").hidden) return;                // closed while waiting
      }
      const names = this.sso && this.sso.ok ? this.ssoNames() : [];
      if (names.length) {
        return Extras.handoff({
          tool: "Moving Object Search Tool (MOST)", filled: true, url: mostUrl(names[0]),
          intro: `NASA/JPL says <b>${names.length}</b> known asteroid${names.length > 1 ? "s" : ""} crossed this patch. MOST is filled in for the first one:`,
          steps: [{ k: "Image Dataset", v: "spherex" }, { k: "Object", v: `${names[0]} (${this.mostName(names[0])})` }, { k: "Dates", v: `${d0} → ${d1}` }],
          note: names.length > 1 ? "Others here: " + names.slice(1).map(n => `<a href="${mostUrl(n)}" target="_blank" rel="noopener">${n}</a>`).join(", ") : ""
        });
      }
      return Extras.handoff({
        tool: "Moving Object Search Tool (MOST)", filled: false, url: most,
        intro: (this.sso && this.sso.ok
          ? "NASA/JPL found <b>no known asteroid</b> crossing this patch on these dates, so there is no name to fill in. "
          : "NASA/JPL's asteroid service didn't answer just now, so there is no name to fill in. ") +
          "MOST searches by an object's <b>name</b>, not by a position. To check a specific object, enter:",
        steps: [{ k: "Image Dataset", v: "spherex", hint: "pick it in the list at the top" },
                { k: "Observation Begin (UTC)", v: d0, copy: true }, { k: "Observation End (UTC)", v: d1, copy: true },
                { k: "Solar System Object Name Input", v: "a name or number, e.g. 433 or Eros", hint: "then press Search at the bottom" }],
        note: "An unexplained mover here is not a known asteroid: flag it with Flag objects."
      });
    }

    // Spectrophotometry Tool: no link API, so guide the user through IRSA's own form
    try { await navigator.clipboard.writeText(pos); } catch (_) {}
    return Extras.handoff({
      tool: "SPHEREx Spectrophotometry Tool", filled: false, url: links.spectrophotometry || base.spectrophotometry,
      intro: "IRSA's spectrum tool can't be filled in from a link. When it opens, enter:",
      steps: [{ k: "Tab", v: "Single Object", hint: "already selected" },
              { k: "Position box", v: pos, copy: true, hint: "already on your clipboard: click the box, Ctrl+V" },
              { k: "Intrinsic morphology model", v: "Point Source" },
              band && { k: "Wavelength Bands", v: `Band ${bandNo} (${band.min}-${band.max} µm)`, hint: "or leave all unticked for every band" },
              { k: "Start Time", v: d0 + "T00:00:00Z", copy: true }, { k: "End Time", v: d1 + "T23:59:59Z", copy: true },
              { k: "Then", v: "Submit", hint: "a job takes several minutes; follow it in the Job Monitor tab" }].filter(Boolean),
      note: movingNote
    });
  },

  /* JPL name -> what MOST understands: numbered asteroids as "433:AST", others by designation. */
  mostName(name) {
    const n = String(name).trim(), num = n.match(/^\(?(\d+)\)?\s/);
    if (num) return `${num[1]}:AST`;
    return n.replace(/\s*\(.*\)\s*$/, "");
  },

  /* ---------- known asteroids (NASA/JPL Small-Body Identification) ---------- */
  async toggleSso(on) {
    const p = Explorer.player;
    if (!on) { p.render(); this.updateTrust(); return; }
    if (!this.res) return;
    if (this.sso && !this.sso.ok) this.sso = null;          // a failed check (JPL busy) is retried next time
    if (!this.sso) {
      const days = {};
      this.res.frames.forEach(f => { const d = f.date.slice(0, 10); if (!days[d]) days[d] = f; });
      const firsts = Object.values(days).slice(0, 8);
      const times = firsts.map(f => new Date((f.mjd - 40587) * 86400000).toISOString().slice(0, 19).replace("T", "_"));
      const hw = this.res.sizePixels * this.res.pixelArcsec / 3600 / 2 * 1.2;
      Extras.toast("☄ Asking NASA/JPL which known asteroids crossed this patch… (up to a minute when JPL is busy)", true);
      try { this.sso = await API._get("/api/asteroids", { ra: this.res.centre.ra, dec: this.res.centre.dec, hw, times: times.join(",") }, 240000); }
      catch (e) { this.sso = { ok: false, results: [], error: e.message }; }
    }
    if (!$("#show-sso").checked) return;
    const names = this.sso.ok ? this.ssoNames() : [];
    Extras.toast(!this.sso.ok ? "☄ NASA/JPL's asteroid service didn't answer (busy or offline). Switch it off and on again in a minute to retry."
      : names.length ? `☄ ${names.length} known asteroid${names.length > 1 ? "s" : ""} here (orange ◇): ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`
      : "☄ Checked with NASA/JPL: no known asteroid crossed this patch on these dates. A moving dot here would be unexplained, so flag it.");
    p.render(); this.updateTrust();
  },

  ssoNames() {
    const names = new Set();
    ((this.sso && this.sso.results) || []).forEach(r => (r.objects || []).forEach(o => {
      const N = this.res.sizePixels, q = this.project({ ra: o.ra, dec: o.dec, pmra: 0, pmdec: 0, epoch: 0 }, 0);
      if (q.x > -2 && q.y > -2 && q.x < N + 1 && q.y < N + 1) names.add(o.name);
    }));
    return [...names];
  },

  /* Each object is moved from JPL's time to this exposure's time with its RA/Dec rates
     (VERIFIED 15 Nov 2026: JPL's RA rate is on-sky, dRA·cos(Dec)/dt — 8 asteroids at Dec ≈ +35°, 2 h apart: cos-scaled shift matched the rate to 2.6″, plain dRA missed by 9.8″). */
  drawSso(ctx, f, s) {
    if (!this.sso || !this.sso.ok || f.mjd == null) return;
    const R = this.RAD, t = (f.mjd - 40587) * 86400000;
    // nearest date JPL was asked about (within 3 days); positions are moved to this frame's time with JPL's rates
    let entry = null, best = 3 * 86400000;
    for (const r of this.sso.results || []) {
      if (!r.ok) continue;
      const d = Math.abs(Date.parse(r.time.replace("_", "T") + "Z") - t);
      if (d <= best) { best = d; entry = r; }
    }
    if (!entry) return;
    const t0 = Date.parse(entry.time.replace("_", "T") + "Z");
    const dt = (t - t0) / 1000;
    ctx.save(); ctx.strokeStyle = ctx.fillStyle = "#ff9f43"; ctx.lineWidth = 1.8; ctx.font = "600 11px system-ui, sans-serif";
    for (const o of entry.objects || []) {
      const dec = o.dec + (o.decRate || 0) * dt, ra = o.ra + (o.raRate || 0) * dt / Math.cos(o.dec * R);
      const q = this.project({ ra, dec, pmra: 0, pmdec: 0, epoch: 0 }, 0);
      if (q.x < -1 || q.y < -1 || q.x > this.res.sizePixels || q.y > this.res.sizePixels) continue;
      const x = (q.x + 0.5) * s, y = (q.y + 0.5) * s, h = Math.max(8, 1.3 * s);
      ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + h, y); ctx.lineTo(x, y + h); ctx.lineTo(x - h, y); ctx.closePath(); ctx.stroke();
      ctx.fillText(o.name + (o.vmag ? ` (V ${(+o.vmag).toFixed(1)})` : "") +
        (o.errArcsec > (this.res.pixelArcsec || 6.15) ? ` ±${Math.round(o.errArcsec)}″` : ""), x + h + 4, y - h);
    }
    ctx.restore();
  },

  /* Mission dial: older NASA pictures fetched (and cached) by the backend on our exact grid. */
  async applyMission() {
    const p = Explorer.player, res = this.res;
    const key = `${res.centre.ra.toFixed(5)},${res.centre.dec.toFixed(5)},${res.sizePixels},${res.query.band}`;
    if (this.missionFor !== key) {
      $("#mission-status").textContent = "Fetching 2MASS and AllWISE images of this patch…";
      let r = null;
      try {
        r = await API._get("/api/survey", { ra: res.centre.ra, dec: res.centre.dec,
          size: res.sizePixels, band: res.query.band }, 60000);
      } catch (e) { r = { ok: false, frames: [], error: e.message }; }
      if (this.mode !== "mission") return;
      this.mission = r; this.missionFor = key;
    }
    const r = this.mission;
    const old = (r.frames || []).filter(f => f.ok);
    const failed = (r.frames || []).filter(f => !f.ok);
    $("#mission-status").innerHTML = old.length
      ? `${old.map(f => f.label).join(" · ")} · then SPHEREx` +
        (failed.length ? ` <span class="warn">(${failed.map(f => f.label).join(", ")} unavailable)</span>` : "")
      : `<span class="warn">Older images unavailable right now${r.error ? ": " + r.error : ""}.</span> Showing SPHEREx only.`;
    const visits = (res.features && res.features.visits && res.features.visits.length) ? res.features.visits : null;
    const sx = visits
      ? visits.map(v => ({ png: v.png, mjd: v.mjd, year: this.year(v.mjd), wavelength: v.wavelength,
                           date: this.date(v.mjd), label: `SPHEREx visit ${v.visit}`, short: "S" + v.visit }))
      : [Object.assign({}, res.frames[0], { label: "SPHEREx", short: "S" })];
    const frames = old.map(f => ({ png: f.png, year: f.year, wavelength: f.wavelength, date: f.when,
                                   label: f.label, short: f.label.startsWith("2MASS") ? "2M" : "W", credit: f.credit }))
      .concat(sx);
    frames.forEach((f, k) => { f.index = k; f.marker = this.markerAt(f.year); });
    const syn = { frames, sizePixels: res.sizePixels, pixelArcsec: res.pixelArcsec, centre: res.centre, mission: true };
    await p.load(syn);
    p.render();
  },

  /* Predicted pixel of the target in a year (same formula as backend/science/motion.py). */
  markerAt(year) {
    const r = this.res, c = (r.sizePixels - 1) / 2, m = r.motion, ep = r.centre && r.centre.epoch;
    if (!m || ep == null || year == null) return { x: c, y: c };
    const dt = year - ep;
    return { x: c - (m.pmEast || 0) * dt / 1000 / r.pixelArcsec, y: c - (m.pmNorth || 0) * dt / 1000 / r.pixelArcsec };
  },

  /* ---------- Compare: subtract B from A ---------- */
  pair() { return [+$("#blink-a").value, +$("#blink-b").value]; },

  toggleSubtract(refresh) {
    const p = Explorer.player;
    if (this.subtract && !refresh) return this.clearSubtract(true);
    const [a, b] = this.pair(), fr = this.res.frames;
    if (a === b) return setStatus($("#blink-status"), "Choose two different frames.", "warn");
    const A = fr[a], B = fr[b], tol = Explorer.warnFraction || 0.01;
    if (A.wavelength && B.wavelength) {
      const frac = Math.abs(A.wavelength - B.wavelength) / ((A.wavelength + B.wavelength) / 2);
      if (frac > tol) {
        this.clearSubtract(true);
        const best = this.matchingPair();
        $("#blink-status").innerHTML = `These two frames are ${(frac * 100).toFixed(1)}% apart in wavelength, ` +
          `so a difference would mostly show the star's colour, not a change. ` +
          (best ? `<button class="linkish" type="button" id="use-pair">Use frames ${best[0] + 1} and ${best[1] + 1}</button> ` +
                  `(same colour, ${((fr[best[1]].mjd - fr[best[0]].mjd)).toFixed(0)} days apart).`
                : "No pair of frames here matches within 1%; SPHEREx needs more visits.");
        $("#blink-status").className = "status warn";
        const u = $("#use-pair");
        if (u) u.onclick = () => { $("#blink-a").value = best[0]; $("#blink-b").value = best[1];
                                   Explorer._blinkInfo(); this.toggleSubtract(true); };
        return;
      }
    }
    p.stop();
    const N = this.res.sizePixels;
    const read = im => { const c = document.createElement("canvas"); c.width = c.height = N;
      const x = c.getContext("2d"); x.drawImage(im, 0, 0, N, N); return x.getImageData(0, 0, N, N).data; };
    const da = read(p.imgs[a]), db = read(p.imgs[b]);
    const out = document.createElement("canvas"); out.width = out.height = N;
    const ox = out.getContext("2d"), img = ox.createImageData(N, N);
    let peak = 1;
    for (let k = 0; k < N * N; k++) if (da[4 * k + 3] > 0 && db[4 * k + 3] > 0) peak = Math.max(peak, Math.abs(da[4 * k] - db[4 * k]));
    for (let k = 0; k < N * N; k++) {
      const ok = da[4 * k + 3] > 0 && db[4 * k + 3] > 0;
      const v = ok ? (da[4 * k] - db[4 * k]) / peak : 0, t = Math.min(1, Math.abs(v));
      // diverging: A brighter = warm, B brighter = cool, no change = dark grey
      const base = 22;
      img.data[4 * k]     = ok ? (v > 0 ? base + t * 233 : base + t * 60) : 0;
      img.data[4 * k + 1] = ok ? (v > 0 ? base + t * 150 : base + t * 150) : 0;
      img.data[4 * k + 2] = ok ? (v > 0 ? base + t * 60 : base + t * 233) : 0;
      img.data[4 * k + 3] = ok ? 255 : 0;
    }
    ox.putImageData(img, 0, 0);
    this.subtract = { a, b, canvas: out };
    p.override = (ctx, c) => { ctx.imageSmoothingEnabled = false; ctx.drawImage(out, 0, 0, c.width, c.height); };
    p.seq = [a]; p.pos = 0; p.render();
    $("#subtract-btn").classList.add("on");
    $("#blink-status").innerHTML = `Frame ${a + 1} minus frame ${b + 1}. <span class="warm">Warm</span> = brighter in ${a + 1}, ` +
      `<span class="cool">cool</span> = brighter in ${b + 1}. Quick look: the difference of displayed brightness.`;
    $("#blink-status").className = "status";
    this.updateTrust();
  },

  clearSubtract(render) {
    if (!this.subtract) return;
    this.subtract = null;
    const p = Explorer.player;
    p.override = null;
    $("#subtract-btn").classList.remove("on");
    setStatus($("#blink-status"), "");
    if (render) { p.all(); p.render(); }
  },

  /* The pair with the longest time between them whose wavelengths agree within 1 %. */
  matchingPair() {
    const fr = this.res.frames, tol = Explorer.warnFraction || 0.01;
    let best = null, gap = 0;
    for (let i = 0; i < fr.length; i++) for (let j = i + 1; j < fr.length; j++) {
      const A = fr[i], B = fr[j];
      if (!A.wavelength || !B.wavelength) continue;
      if (Math.abs(A.wavelength - B.wavelength) / A.wavelength > tol) continue;
      const g = Math.abs(B.mjd - A.mjd);
      if (g > gap) { gap = g; best = [i, j]; }
    }
    return best && gap > 0.5 ? best : null;
  },

  /* ---------- Gaia overlay ---------- */
  async toggleGaia(on) {
    const p = Explorer.player;
    if (!on) { $("#gaia-status").textContent = ""; p.render(); this.updateTrust(); return; }
    if (!this.res) return;
    const c = this.res.centre, key = `${c.ra.toFixed(4)},${c.dec.toFixed(4)}`;
    if (this.gaiaFor !== key) {
      Extras.toast("✦ Asking ESA's Gaia catalogue for the stars in this patch…", true);
      const radius = this.res.sizePixels * this.res.pixelArcsec / 120;      // half-width, arcmin
      try { this.gaia = await API._get("/api/gaia", { ra: c.ra, dec: c.dec, radius }, 70000); }
      catch (e) { this.gaia = { ok: false, stars: [], reason: e.message }; }
      this.gaiaFor = key;
      if (!this.gaia.ok) this.gaiaFor = "";          // retry next time if Gaia didn't answer
    }
    const g = this.gaia;
    this.atlasGaia();
    if ($("#show-gaia").checked) Extras.toast(g.ok ? `✦ ${this.inView().length} Gaia DR3 stars (blue rings) · click one for its motion and distance`
      : "✦ Gaia didn't answer: " + (g.reason || "no answer").slice(0, 90) + ". Switch it off and on again to retry.");
    p.render();
    this.updateTrust();
  },

  /* Where is a Gaia star on our picture, on the date of this frame?
     Move it from Gaia's epoch (2016.0) by its proper motion, then project onto the
     north-up TAN grid centred on res.centre (the same grid the backend resamples onto). */
  project(star, year) {
    const r = this.res, R = this.RAD, dt = year - star.epoch;
    const dec = star.dec + star.pmdec * dt / 3.6e6;
    const ra = star.ra + star.pmra * dt / 3.6e6 / Math.cos(star.dec * R);   // pmra already includes cos(dec)
    const dra = (ra - r.centre.ra) * R, d = dec * R, d0 = r.centre.dec * R;
    const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(dra);
    const xi = Math.cos(d) * Math.sin(dra) / cosc;
    const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(dra)) / cosc;
    const k = 206264.806 / r.pixelArcsec, c = (r.sizePixels - 1) / 2;
    return { x: c - xi * k, y: c - eta * k };
  },

  frameYear(f) { return f.year != null ? f.year : f.mjd != null ? this.year(f.mjd) : 2026; },

  inView(f) {
    if (!this.gaia || !this.gaia.ok || !this.res) return [];
    const yr = f ? this.frameYear(f) : (this.res.centre.epoch || 2026), N = this.res.sizePixels;
    return this.gaia.stars.map(s => ({ s, p: this.project(s, yr) }))
      .filter(({ p }) => p.x >= -0.5 && p.y >= -0.5 && p.x <= N - 0.5 && p.y <= N - 0.5);
  },

  /* Everything Sky draws on top of a frame: the target's motion track, Gaia stars with
     drift arrows, and the user's flags. */
  draw(ctx, f, s) {
    if ($("#show-marker").checked) this.drawTrack(ctx, f, s);
    if ($("#show-sso").checked) this.drawSso(ctx, f, s);
    if ($("#show-gaia").checked && this.gaia && this.gaia.ok) this.drawGaia(ctx, f, s);
    this.drawFlags(ctx, s);
  },

  arrow(ctx, x0, y0, x1, y1, head = 7) {
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45));
    ctx.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45));
    ctx.closePath(); ctx.fill();
  },

  /* The target's path: solid over the dates on screen, dots at each image, dashed arrow to
     where it will be in 10 years. Within SPHEREx's ~1 year a target moves under ~2 pixels,
     which is why a lone ring looks "stuck": the track makes the direction and speed visible. */
  drawTrack(ctx, f, s) {
    const r = this.res, m = r && r.motion, p = Explorer.player;
    if (!m || !(m.pmEast || m.pmNorth) || r.centre.epoch == null) return;
    const ys = ((p.res && p.res.frames) || []).map(x => this.frameYear(x)).filter(Number.isFinite);
    if (!ys.length) return;
    const y0 = Math.min(...ys), y1 = Math.max(...ys), px = q => [(q.x + 0.5) * s, (q.y + 0.5) * s];
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = "rgba(255, 210, 94, .95)"; ctx.lineWidth = 2;
    const [ax, ay] = px(this.markerAt(y0)), [bx, by] = px(this.markerAt(y1));
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ys.forEach(y => { const [x, yy] = px(this.markerAt(y)); ctx.beginPath(); ctx.arc(x, yy, 2.5, 0, 2 * Math.PI); ctx.fill(); });
    const [cx, cy] = px(this.markerAt(y1 + 10));
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    this.arrow(ctx, bx, by, cx, cy, 8);
    ctx.setLineDash([]);
    const speed = Math.hypot(m.pmEast || 0, m.pmNorth || 0) / 1000;
    ctx.font = "600 12px system-ui, sans-serif"; ctx.textBaseline = "middle";
    const label = `${speed.toFixed(2)}″/yr · in 10 yr`;
    const lx = Math.min(ctx.canvas.width - ctx.measureText(label).width - 6, Math.max(6, cx + 8));
    ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(lx - 3, cy - 9, ctx.measureText(label).width + 6, 18);
    ctx.fillStyle = "#ffd25e"; ctx.fillText(label, lx, cy);
    ctx.restore();
  },

  drawGaia(ctx, f, s) {
    const list = this.inView(f), yr = this.frameYear(f);
    const big = list.length > 60;
    let arrows = 0;
    ctx.save();
    for (const { s: st, p } of list) {
      const x = (p.x + 0.5) * s, y = (p.y + 0.5) * s;
      const g = st.g != null ? st.g : 17;
      const r = Math.max(6, s * Math.max(0.85, Math.min(1.9, 1.9 - 0.09 * (g - 8))));
      ctx.lineWidth = big ? 1 : 1.4;
      ctx.strokeStyle = st.hasPm ? "rgba(112, 214, 255, .9)" : "rgba(170, 170, 170, .7)";
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
      // drift arrow: where this star will be in 100 years (only stars that move > 0.5 px in that time)
      const pm = Math.hypot(st.pmra, st.pmdec);
      if (st.hasPm && pm * 100 / 1000 / this.res.pixelArcsec > 0.5) {
        const q = this.project(st, yr + 100);
        let dx = (q.x - p.x) * s, dy = (q.y - p.y) * s;
        const cap = ctx.canvas.width * 0.35, len = Math.hypot(dx, dy);
        if (len > cap) { dx *= cap / len; dy *= cap / len; }
        ctx.strokeStyle = ctx.fillStyle = "rgba(112, 214, 255, .95)"; ctx.lineWidth = 1.6;
        this.arrow(ctx, x, y, x + dx, y + dy, 7);
        arrows++;
      }
    }
    if (this.picked) {
      const p = this.project(this.picked, yr);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc((p.x + 0.5) * s, (p.y + 0.5) * s, 16, 0, 2 * Math.PI); ctx.stroke();
    }
    if (arrows) {
      const t = "Cyan arrows: drift over the next 100 years";
      ctx.font = "11px monospace"; ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(6, 6, ctx.measureText(t).width + 10, 18);
      ctx.fillStyle = "rgba(112, 214, 255, .95)"; ctx.textBaseline = "middle"; ctx.fillText(t, 11, 15);
    }
    ctx.restore();
  },

  pickStar(e) {
    if (!$("#show-gaia").checked || !this.gaia || !this.gaia.ok) return;
    const p = Explorer.player, c = $("#player"), rect = c.getBoundingClientRect();
    const sc = c.width / rect.width, s = c.width / this.res.sizePixels;
    const x = (e.clientX - rect.left) * sc, y = (e.clientY - rect.top) * sc;
    const f = p.res.frames[p.i];
    let best = null, dmin = 18;
    for (const { s: st, p: q } of this.inView(f)) {
      const d = Math.hypot((q.x + 0.5) * s - x, (q.y + 0.5) * s - y);
      if (d < dmin) { dmin = d; best = st; }
    }
    const tip = $("#star-tip");
    this.picked = best;
    if (!best) {
      tip.innerHTML = `<b>No Gaia star here.</b> Something bright at this spot with no circle is not in Gaia's ` +
        `visible-light catalogue: possibly a cold brown dwarf, a galaxy, or an artefact. Worth a second look.`;
    } else {
      const pm = Math.hypot(best.pmra, best.pmdec) / 1000;
      const pc = best.plx > 0 ? 1000 / best.plx : null;
      tip.innerHTML = `<b>Gaia DR3 ${best.id}</b>` +
        `<span>Brightness G ${best.g != null ? best.g.toFixed(1) : "—"} mag</span>` +
        `<span>Moves ${best.hasPm ? pm.toFixed(3) + "″ per year" : "unknown"}</span>` +
        `<span>Distance ${pc && best.plx > 0.5 ? (pc < 1000 ? pc.toFixed(1) + " pc ≈ " + (pc * 3.2616).toFixed(1) + " light-years"
                                                  : (pc / 1000).toFixed(1) + " kpc") : "too far to measure well"}</span>`;
    }
    const sr = c.parentNode.getBoundingClientRect();
    tip.style.left = Math.min(sr.width - 220, (e.clientX - sr.left) + 12) + "px";
    tip.style.top = Math.min(sr.height - 120, (e.clientY - sr.top) + 12) + "px";
    tip.hidden = false;
    p.render();
  },

  /* ---------- the honesty card ---------- */
  updateTrust() {
    const el = $("#trust");
    if (!el || !this.res) return;
    const p = Explorer.player, res = this.res, tol = Explorer.warnFraction || 0.01;
    const rows = [];
    const row = (state, title, text) => rows.push(`<li class="t-${state}"><i></i><div><b>${title}</b><span>${text}</span></div></li>`);
    const frames = (p.res && p.res.frames) || [];
    const seq = p.seq.map(k => frames[k]).filter(Boolean);

    if (this.mode === "trail" && this.trail) {
      const ch = this.trail.chosen, span = ch[ch.length - 1].year - ch[0].year, m = res.motion;
      const px = m ? Math.hypot(m.pmEast || 0, m.pmNorth || 0) / 1000 * span / res.pixelArcsec : 0;
      row(px >= 1 ? "ok" : "info", "Motion", `${ch.length} images over ${span.toFixed(span < 2 ? 2 : 0)} years; ` +
        `the target should move ${px.toFixed(1)} px.` + (px < 1 ? " Too little to separate the colours." : ""));
      const lams = ch.map(c => c.wavelength).filter(Boolean);
      row("info", "Reading it", "White = in every image. A row of blue→red dots = something that moved, in date order. " +
        "A single coloured dot = something that appeared or brightened once (or an artefact).");
      if (ch.some(c => c.old)) row("info", "Older images", "2MASS and WISE have their own brightness scales and colours of light; trust positions, not brightness.");
    } else if (this.mode === "mission" && p.res && p.res.mission) {
      const yrs = seq.map(f => f.year).filter(v => v != null);
      const span = yrs.length ? Math.max(...yrs) - Math.min(...yrs) : 0;
      const a = seq[0], b = seq[seq.length - 1];
      const px = a && b ? Math.hypot(b.marker.x - a.marker.x, b.marker.y - a.marker.y) : 0;
      row(px >= 1 ? "ok" : "info", "Motion", `${span.toFixed(0)} years between first and last image: the target should move ` +
        `${px.toFixed(1)} pixels (${(px * res.pixelArcsec).toFixed(0)}″).` + (px >= 1 ? " Big enough to see." : " Too small to see even here."));
      row("info", "Brightness", "Each survey has its own camera, filter and brightness scale. Compare positions across missions, not brightness.");
      row("info", "Dates", "2MASS scanned the sky between 1997 and 2001, so its date here is approximate (±2 years).");
    } else {
      // colour
      const lams = seq.map(f => f.wavelength).filter(Boolean);
      if (this.subtract || (this.mode === "compare")) {
        const [a, b] = this.pair(), A = res.frames[a], B = res.frames[b];
        if (A && B && A.wavelength && B.wavelength) {
          const frac = Math.abs(A.wavelength - B.wavelength) / ((A.wavelength + B.wavelength) / 2);
          row(frac <= tol ? "ok" : "warn", "Colour",
            frac <= tol ? `A and B are within 1% in wavelength (${A.wavelength.toFixed(3)} and ${B.wavelength.toFixed(3)} µm). A brightness change is real.`
                        : `A and B differ by ${(frac * 100).toFixed(1)}% in wavelength. A brightness change may just be the star's colour.`);
        }
        if (A && B) {
          const days = Math.abs(B.mjd - A.mjd);
          const px = A.marker && B.marker ? Math.hypot(B.marker.x - A.marker.x, B.marker.y - A.marker.y) : 0;
          row(px >= 1 ? "ok" : "info", "Motion", `${days.toFixed(0)} days apart; expected shift ${px.toFixed(2)} px.` +
            (px < 1 ? " Under one pixel: no visible jump expected. Try the Mission dial." : ""));
        }
      } else if (this.mode === "colour" && this.colourPic) {
        row("warn", "Times", "The detectors photographed this patch in pairs (1+4, 2+5, 3+6) at different moments. " +
          "Anything that moved or varied between them shows coloured fringes.");
        row("info", "Colours", "Each detector has its own brightness scale, so colour shows where a band is relatively bright, " +
          "not true brightness. Something red here is bright only at long wavelengths: cold, or dusty.");
      } else if (this.mode === "colour") {
        row("info", "Colour", lams.length ? `Sorted from ${Math.min(...lams).toFixed(3)} to ${Math.max(...lams).toFixed(3)} µm on purpose. ` +
          "Changes here are the spectrum, not variability." : "No wavelength information for these frames.");
      } else if (lams.length) {
        const lo = Math.min(...lams), hi = Math.max(...lams), frac = (hi - lo) / ((hi + lo) / 2);
        row(frac <= tol ? "ok" : "warn", "Colour", frac <= tol
          ? `All ${seq.length} frames within 1% in wavelength (${lo.toFixed(3)}–${hi.toFixed(3)} µm).`
          : `Frames span ${lo.toFixed(3)}–${hi.toFixed(3)} µm (${(frac * 100).toFixed(0)}%). Flicker can be colour, not change. ` +
            `Tick “Same colour only”.`);
      }
      if (!this.subtract && this.mode !== "compare" && seq.length > 1) {
        const byDate = seq.slice().sort((x, y) => x.mjd - y.mjd), a = byDate[0], b = byDate[byDate.length - 1];
        const days = b.mjd - a.mjd;
        const px = a.marker && b.marker ? Math.hypot(b.marker.x - a.marker.x, b.marker.y - a.marker.y) : 0;
        row(px >= 1 ? "ok" : "info", "Motion", `${days.toFixed(0)} days from first to last frame; expected shift ${px.toFixed(2)} px.` +
          (px < 1 ? " Under one pixel, so nothing will visibly jump. The Mission dial adds 16–27 years." : ""));
      }
      const f = frames[p.i];
      if (f && f.flagged != null) {
        const bad = (f.flagged || 0) > 0.05 || (f.missing || 0) > 0.2;
        row(bad ? "warn" : "ok", "This frame", `${((f.flagged || 0) * 100).toFixed(1)}% of pixels flagged by the pipeline, ` +
          `${((f.missing || 0) * 100).toFixed(1)}% missing.` + (bad ? " Treat spots here with care." : ""));
      }
    }
    if ($("#show-gaia").checked && this.gaia) {
      row(this.gaia.ok ? "ok" : "warn", "Gaia",
        this.gaia.ok ? `${this.inView(frames[p.i]).length} known stars circled at this frame's date. A bright dot with no circle deserves a look.`
                     : "Gaia could not be reached, so known stars are not marked.");
    }
    if ($("#show-sso").checked && this.sso) {
      const n = this.ssoNames().length;
      row(this.sso.ok ? (n ? "warn" : "ok") : "warn", "Asteroids", !this.sso.ok ? "NASA/JPL could not be reached, so known asteroids are not marked."
        : n ? `${n} known asteroid${n > 1 ? "s" : ""} crossed this patch on these dates (orange): a “mover” there is probably not new.`
            : "No known asteroid or comet in this patch on these dates (to magnitude 22).");
    }
    const drop = res.droppedList ? res.droppedList.length : 0;
    if (res.used < res.found && this.mode !== "mission")
      row("info", "Sample", `Showing ${res.used} of ${res.found} exposures, spread evenly in time. ` +
        `“Exposures to use” loads more (slower), which fills more of the Grid and colour views.`);
    row("info", "Data", `SPHEREx ${String(res.release || "").toUpperCase()} from NASA/IPAC IRSA` +
      `${res.doi ? ` (DOI ${res.doi})` : ""}. ${res.used} of ${res.found} exposures shown${drop ? `, ${drop} dropped (see Notes)` : ""}.`);

    el.innerHTML = `<div class="trust-head">Can I trust a change here?</div><ul class="trust-list">${rows.join("")}</ul>` +
      `<details class="trust-more"><summary>What this view can’t tell you</summary><ul>` +
      `<li>It can’t prove a discovery. A candidate needs follow-up by professional astronomers.</li>` +
      `<li>Pictures are stretched for the eye. For real brightness measurements use IRSA’s Spectrophotometry Tool.</li>` +
      `<li>One SPHEREx pixel is ${res.pixelArcsec}″ wide, so two objects closer than that look like one.</li>` +
      `<li>A missing circle is a hint, not proof: Gaia also misses very faint and very crowded stars.</li></ul></details>`;
  },

  /* ---------- share ---------- */
  copyLink() {
    const q = new URLSearchParams(), prm = this.params || {}, page = document.body.dataset.page;
    if (prm.target) q.set("target", prm.target);
    if (page === "probe" || !prm.target) { q.set("ra", (+prm.ra).toFixed(6)); q.set("dec", (+prm.dec).toFixed(6)); }
    q.set("band", prm.band);
    q.set("r", page === "probe" ? +(prm.radius / 60).toFixed(4) : prm.radius);
    if (prm.max) q.set("max", prm.max);
    q.set("mode", this.mode);
    if (this.mode === "compare") { q.set("a", $("#blink-a").value); q.set("b", $("#blink-b").value); }
    if ($("#show-gaia").checked) q.set("gaia", "1");
    q.set("load", "1");
    const url = location.origin + location.pathname + "?" + q.toString();
    const done = () => { $("#copy-link").textContent = "Link copied ✓"; setTimeout(() => { $("#copy-link").textContent = "Copy link"; }, 1800); };
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(done, () => prompt("Copy this link:", url));
  },

  /* A shared link (…&load=1) reopens the same view: band, radius, overlays, then loads. */
  async fromUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get("gaia") === "1") $("#show-gaia").checked = true;
    if (!q.get("load")) return;
    for (let k = 0; k < 60 && !(Explorer.player && $("#band").options.length); k++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 150));              // let the page fill the form from the URL first
    if (q.get("band")) $("#band").value = q.get("band");
    if (q.get("max") && $("#max-exp")) $("#max-exp").value = q.get("max");
    const r = $("#radius");
    if (q.get("r") && r.tagName === "SELECT") {
      const want = +q.get("r");
      const opt = [...r.options].find(o => Math.abs(+o.value - want) < 1e-6);
      if (opt) r.value = opt.value;
    }
    this.pendingMode = q.get("mode");
    await Explorer.load();
    if (this.mode === "compare" && q.get("a") && q.get("b")) {
      $("#blink-a").value = q.get("a"); $("#blink-b").value = q.get("b"); Explorer._blinkInfo();
    }
  },

  date(mjd) { return new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10); },
  year(mjd) { return 2000 + (mjd - 51544.5) / 365.25; }
};

document.addEventListener("DOMContentLoaded", () => { Sky.fromUrl(); });
