/* =====================================================================
   extras.js — features added on 15 Nov (feature-catalogue numbers):
     F6  Frame labels       band, wavelength, date, release burned onto every frame
     F10 Long-baseline blink  WISE 2010 / 2MASS 1999 ↔ SPHEREx, in the big view
     F22 Measure the motion   click the target in a 1999/2010 image and in SPHEREx:
                              proper motion in mas/yr with an uncertainty, vs the catalogue
     F37 Story mode           a five-step guided tour of the loaded target
     F39 Keyboard shortcuts   one key per common action, "?" lists them
     F41 Phone-friendly       swipe between frames, pinch to zoom in the big view
   Loaded after sky.js; it wraps Sky.draw / Sky.setMode / Sky.onResults.
   ===================================================================== */

const Extras = {
  mm: null,          // motion measurement state

  init() {
    if (typeof Sky === "undefined") return;
    const draw = Sky.draw, setMode = Sky.setMode, onResults = Sky.onResults;
    Sky.draw = function (ctx, f, s) { draw.call(this, ctx, f, s); Extras.draw(ctx, f, s); };
    Sky.setMode = async function (mode, first) { Extras.cancelMeasure(true); await setMode.call(this, mode, first); Extras.onMode(mode); };
    Sky.onResults = function (res, params) { onResults.call(this, res, params); Extras.onResults(res, params); };
    this.wireOnce();
  },

  wireOnce() {
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("#show-labels", "change", e => { document.body.classList.toggle("labels-on", e.target.checked); Explorer.player.render(); });
    document.body.classList.toggle("labels-on", !!($("#show-labels") || {}).checked);
    on("#lb-wise", "click", () => this.longBlink("W"));
    on("#lb-2mass", "click", () => this.longBlink("2M"));
    on("#mm-start", "click", () => this.startMeasure());
    on("#story-btn", "click", () => this.story());
    on("#keys-btn", "click", () => this.help(true));
    on("#keys-close", "click", () => this.help(false));
    on("#keys-modal", "click", e => { if (e.target.id === "keys-modal") this.help(false); });
    const c = $("#player");
    if (c) c.addEventListener("click", e => { if (this.mm && this.mm.step) { e.stopImmediatePropagation(); this.measureClick(e); } }, true);
    document.addEventListener("keydown", e => this.key(e));
    this.wireTouch();
  },

  onResults(res) {
    this.cancelMeasure(true);
    this.storyStop();
  },

  onMode(mode) {
    const lb = $("#mission-tools"); if (lb) lb.hidden = mode !== "mission";
  },

  /* ---------------- a short message on the picture (asteroid / Gaia checks) ---------------- */
  toast(text, sticky) {
    const stage = $(".stage") || document.body;
    let t = $("#stage-toast");
    if (!t) { t = document.createElement("div"); t.id = "stage-toast"; t.className = "stage-toast"; t.setAttribute("role", "status"); }
    if (t.parentNode !== stage) stage.appendChild(t);
    t.textContent = text; t.classList.add("on");
    clearTimeout(this.toastTimer);
    if (!sticky) this.toastTimer = setTimeout(() => t.classList.remove("on"), 7000);
  },

  /* ---------------- F6 frame labels ---------------- */
  draw(ctx, f, s) {
    const c = ctx.canvas;
    if (this.mm && this.mm.pts.length && Sky.mode === "mission") this.drawMeasure(ctx, f, s);
    if (!($("#show-labels") || {}).checked || !f) return;
    const r = Sky.res || {}, rel = (r.release || "").toUpperCase();
    const when = f.date ? String(f.date).replace("T", " ").slice(0, 16) : (f.year ? f.year.toFixed(1) : "");
    let text;
    if (Explorer.player.hudLabel) text = Explorer.player.hudLabel;
    else if (f.label && !String(f.label).startsWith("SPHEREx")) text = `${f.label}${f.wavelength ? " · " + (+f.wavelength).toFixed(2) + " µm" : ""} · ${when}`;
    else text = `SPHEREx ${r.query ? r.query.band : ""}${f.wavelength ? " · λ " + (+f.wavelength).toFixed(3) + " µm" : ""} · ${when}${f.date ? " UTC" : ""}` +
                (rel ? ` · ${rel}` : "");
    const h = Math.round(c.height * 0.05), fs = Math.max(11, Math.round(h * 0.55));
    ctx.save();
    ctx.fillStyle = "rgba(4, 8, 16, .72)"; ctx.fillRect(0, 0, c.width, h);
    ctx.fillStyle = "#e9eef7"; ctx.font = `600 ${fs}px ui-monospace, monospace`; ctx.textBaseline = "middle";
    ctx.fillText(text, 8, h / 2 + 1, c.width - 16);
    ctx.restore();
  },

  /* ---------------- F10 long-baseline blink ---------------- */
  async longBlink(which) {
    if (!Sky.res) return;
    if (Sky.mode !== "mission") await Sky.setMode("mission");
    const p = Explorer.player, fr = (p.res && p.res.frames) || [];
    const a = fr.findIndex(f => f.short === which), b = fr.length - 1;
    if (a < 0 || b <= a) { this.say(`${which === "W" ? "WISE" : "2MASS"} is unavailable for this patch right now.`, "warn"); return; }
    const yrs = (fr[b].year - fr[a].year), r = Sky.res, m = r.motion || {};
    const pm = Math.hypot(m.pmEast || 0, m.pmNorth || 0) / 1000, px = pm * yrs / (r.pixelArcsec || 6.15);
    this.say(`Blinking ${fr[a].label} (${fr[a].year.toFixed(1)}) ↔ ${fr[b].label} (${fr[b].year.toFixed(1)}): ${yrs.toFixed(1)} years apart.` +
      (pm > 0.05 ? ` The target should jump about ${px.toFixed(1)} SPHEREx pixels.` : " This target doesn't move measurably, so nothing should jump."));
    p.blink(a, b);
    Sky.theatre(true);
  },

  /* ---------------- F22 measure the motion (long baseline) ---------------- */
  async startMeasure() {
    if (!Sky.res) return;
    if (Sky.mode !== "mission") await Sky.setMode("mission");
    const p = Explorer.player, fr = (p.res && p.res.frames) || [];
    if (fr.length < 2 || !fr[0].short || fr[0].short === "S") {
      this.say("Measuring needs an older 2MASS or WISE image of this patch, and none loaded. Try again in a moment.", "warn"); return;
    }
    Sky.theatre(false);
    // start on the OLDEST image that actually contains the target (a fast star can be outside an old image:
    // Barnard's Star in 2000 lies 45 px south of a 0.05° patch centred on its 2026 position)
    const N = p.res.sizePixels, inside = f => !f.marker || (f.marker.x > 2 && f.marker.y > 2 && f.marker.x < N - 3 && f.marker.y < N - 3);
    let a = fr.findIndex((f, k) => k < fr.length - 1 && f.short !== "S" && f.short && inside(f));
    if (a < 0) {
      this.say("The target is outside every older image of this patch (it moves fast). Load a larger radius, then measure again.", "warn"); return;
    }
    p.stop(); p.all(); p.go(a);
    this.mm = { step: 1, pts: [], a, b: fr.length - 1 };
    $("#player").classList.add("measuring");
    const skipped = a > 0 ? ` (${fr.slice(0, a).map(f => f.label).join(", ")} skipped: the target was outside that image)` : "";
    this.say(`<b>Step 1 of 2.</b> Click the target in this <b>${fr[a].label}</b> image (${fr[a].year.toFixed(1)})${skipped}. ` +
      `The click snaps to the <b>centroid</b> (brightness-weighted centre). Press Esc to cancel.`);
  },

  cancelMeasure(quiet) {
    if (!this.mm) return;
    this.mm = null;
    const c = $("#player"); if (c) c.classList.remove("measuring");
    if (!quiet) this.say("Measurement cancelled.");
    Explorer.player.render();
  },

  measureClick(e) {
    const p = Explorer.player, c = $("#player"), rect = c.getBoundingClientRect(), mm = this.mm;
    const N = p.res.sizePixels, k = p.i, f = p.res.frames[k];
    const x = (e.clientX - rect.left) / rect.width * N - 0.5, y = (e.clientY - rect.top) / rect.height * N - 0.5;
    const cen = this.centroid(p.imgs[k], N, x, y);
    mm.pts.push({ x: cen.x, y: cen.y, year: f.year, label: f.label });
    if (mm.step === 1) {
      mm.step = 2; p.go(mm.b);
      const g = p.res.frames[mm.b];
      this.say(`<b>Step 2 of 2.</b> Now click the same object in this <b>${g.label}</b> image (${g.year.toFixed(2)}).`);
      return;
    }
    mm.step = 0; c.classList.remove("measuring");
    this.measureResult();
    p.render();
  },

  /* brightest pixel within ±3 px, then a background-subtracted 5×5 centroid */
  centroid(img, N, x0, y0) {
    const cv = document.createElement("canvas"); cv.width = cv.height = N;
    const g = cv.getContext("2d"); g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data, v = (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? 0 : d[(j * N + i) * 4];
    let bx = Math.round(x0), by = Math.round(y0), best = -1;
    for (let j = by - 3; j <= by + 3; j++) for (let i = bx - 3; i <= bx + 3; i++) if (v(i, j) > best) { best = v(i, j); bx = i; by = j; }
    const ring = []; for (let j = by - 4; j <= by + 4; j++) for (let i = bx - 4; i <= bx + 4; i++)
      if (Math.max(Math.abs(i - bx), Math.abs(j - by)) === 4) ring.push(v(i, j));
    ring.sort((a, b) => a - b); const bg = ring[ring.length >> 1] || 0;
    let sw = 0, sx = 0, sy = 0;
    for (let j = by - 2; j <= by + 2; j++) for (let i = bx - 2; i <= bx + 2; i++) {
      const w = Math.max(0, v(i, j) - bg); sw += w; sx += w * i; sy += w * j;
    }
    return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: bx, y: by };
  },

  measureResult() {
    const [a, b] = this.mm.pts, r = Sky.res, pix = r.pixelArcsec || 6.15, dt = b.year - a.year;
    const pmE = -(b.x - a.x) * pix * 1000 / dt, pmN = -(b.y - a.y) * pix * 1000 / dt;   // east is left, north is up
    const tot = Math.hypot(pmE, pmN);
    // Uncertainty: ±0.3 px per centroid, plus the date of the older image. AllWISE is a coadd of
    // 2010–11 scans, so its mean date is uncertain by ~±0.3 yr; 2MASS images are single epochs (±0.05 yr).
    // A star moving μ″/yr shifts μ·σ_t in that time. Parallax (Barnard: 0.55″ yearly wobble) is not modelled.
    const sigT = /WISE/i.test(a.label || "") ? 0.3 : /2MASS/i.test(a.label || "") ? 0.05 : 0;
    const sigPx = Math.sqrt(2 * 0.3 ** 2 + (tot / 1000 * sigT / pix) ** 2);
    const sig = sigPx * pix * 1000 / dt;
    const m = r.motion || {}, cat = Math.hypot(m.pmEast || 0, m.pmNorth || 0);
    const fmt = v => (v >= 0 ? "+" : "−") + Math.abs(Math.round(v)).toLocaleString("en-GB");
    let verdict = "";
    if (cat > 0) {
      const dE = pmE - m.pmEast, dN = pmN - m.pmNorth, off = Math.hypot(dE, dN) / sig;
      verdict = `<br>Catalogue (Gaia-based): ${fmt(m.pmEast)} east, ${fmt(m.pmNorth)} north = <b>${(cat / 1000).toFixed(2)}″/yr</b>. ` +
        (off < 2 ? `<span class="ok-t">Agrees within ${off.toFixed(1)}σ.</span>` : `<span class="warn">Differs by ${off.toFixed(1)}σ: check you clicked the same object.</span>`);
    } else verdict = `<br>The catalogue lists no measurable motion for this position, so anything above ~${(2 * sig / 1000).toFixed(2)}″/yr would be news.`;
    this.mm.result = { pmE, pmN, sig };
    this.say(`<b>Measured proper motion</b> over ${dt.toFixed(1)} years (${a.label} → ${b.label}): ` +
      `${fmt(pmE)} ± ${Math.round(sig)} mas/yr east, ${fmt(pmN)} ± ${Math.round(sig)} mas/yr north ` +
      `= <b>${(tot / 1000).toFixed(2)} ± ${(sig / 1000).toFixed(2)}″/yr</b>.${verdict}` +
      `<br><small class="muted">Proper motion: steady drift across the sky, in milliarcseconds per year. Uncertainty = ±0.3 px per click ` +
      `plus the older image's date (${sigT ? "±" + sigT + " yr for " + a.label.split(" ")[0] : "exact"}); parallax not modelled. Quick-look: centroids ` +
      `from display images of different telescopes. <button type="button" class="linkish" id="mm-again">Measure again</button></small>`);
    const again = $("#mm-again"); if (again) again.onclick = () => this.startMeasure();
  },

  drawMeasure(ctx, f, s) {
    const pts = this.mm.pts, col = ["#7fb8ff", "#a3f0c6"];
    ctx.save(); ctx.lineWidth = 2;
    pts.forEach((q, k) => {
      const x = (q.x + 0.5) * s, y = (q.y + 0.5) * s;
      ctx.strokeStyle = col[k]; ctx.beginPath(); ctx.arc(x, y, Math.max(8, 2 * s), 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
      ctx.fillStyle = col[k]; ctx.font = "600 12px ui-monospace, monospace"; ctx.fillText(q.year.toFixed(1), x + 12, y - 10);
    });
    if (pts.length === 2) {
      const [a, b] = pts.map(q => [(q.x + 0.5) * s, (q.y + 0.5) * s]);
      ctx.strokeStyle = "#ffd25e"; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.restore();
  },

  say(html, cls) {
    const el = $("#mm-status"); if (!el) return;
    el.innerHTML = html; el.className = "mm-status" + (cls ? " " + cls : "");
  },

  /* ---------------- F37 story mode ---------------- */
  storyDefs() {
    const r = Sky.res, c = r.centre || {}, m = r.motion || {};
    const t = (window.TARGETS || []).find(x => x.name === c.name || x.id === (Sky.params || {}).target) || null;
    const facts = t && window.FACTS && window.FACTS[t.id] ? window.FACTS[t.id].facts : [];
    const tags = t ? t.tags : [], pm = Math.hypot(m.pmEast || 0, m.pmNorth || 0) / 1000;
    const name = c.name || "this position", yrs = r.frames.length ? (r.frames[r.frames.length - 1].year - r.frames[0].year) : 0;
    const steps = [
      { title: `Meet ${name}`, spot: "#search-bar",
        text: t ? `<b>${t.kind}.</b> ${t.why}${facts[0] ? " " + facts[0] : ""}` :
          `A patch of sky you chose, ${r.sizePixels}×${r.sizePixels} SPHEREx pixels of ${r.pixelArcsec}″ each, centred on RA ${c.ra.toFixed(3)}°, Dec ${c.dec.toFixed(3)}°.`,
        go: () => {} },
      { title: "Watch it through time", spot: ".player-card .stage",
        text: `These are ${r.frames.length} real SPHEREx exposures from NASA/IPAC IRSA, ${yrs < 1 ? Math.round(yrs * 365) + " days" : yrs.toFixed(1) + " years"} apart from first to last, ` +
          `played like a flip-book. Anything that moves or changes brightness stands out against the still stars.`,
        go: async () => { await Sky.setMode("time"); Explorer.player.play(); } },
      { title: "Same colour only", spot: "#ctrl-time",
        text: `SPHEREx photographs through a <b>linear variable filter</b>: each frame sees a slightly different wavelength (colour of infrared light). ` +
          `A star can look brighter just because the colour changed. Ticking <b>Same colour only</b> blinks like with like, which is the honest comparison.`,
        go: async () => { Sky.theatre(false); Explorer.player.stop(); await Sky.setMode("time"); const sc = $("#same-colour"); sc.checked = true; Sky.applyTime(); } },
    ];
    if (pm > 0.05 || tags.includes("moves")) steps.push({ title: "Jump 27 years", spot: ".player-card .stage",
      text: `${name} drifts ${pm.toFixed(2)}″ a year: under one SPHEREx pixel between visits, so it hardly moves above. ` +
        `Older NASA images fix that: 2MASS (about 1999) and WISE (2010) on the same pixels. Watch it jump. Then try <b>Measure the motion</b> in the Mission tab.`,
      go: async () => { await this.longBlink("W"); } });
    else if (tags.includes("exploded")) steps.push({ title: "See it in colour", spot: ".player-card",
      text: `Each SPHEREx detector sees a different band of infrared. Put all six into one picture: blue for the shortest wavelengths, red for the longest. ` +
        `Hot gas, dust and stars separate by colour.`, go: async () => { await Sky.setMode("colour"); } });
    else steps.push({ title: "Its brightness, colour by colour", spot: "#more-tools",
      text: `${name} varies. The light curve plots brightness against date, and the spectrum against wavelength, from these same frames. ` +
        `Quick-look photometry: a 3×3 pixel box at its predicted position.`,
      go: async () => { Sky.theatre(false); if (typeof Features !== "undefined") { Features.picked = true; Features.open("spectrum"); } } });
    steps.push({ title: "Can I trust it?", spot: "#trust",
      text: `Every view lists what could fool you: colour changes, motion below one pixel, pixels the pipeline flagged. ` +
        `Then check us against NASA: the IRSA buttons open the official archive tools for this exact spot. Flag anything interesting with <b>F</b>.`,
      go: async () => { Sky.theatre(false); Explorer.player.stop(); await Sky.setMode("time"); } });
    return steps;
  },

  story() {
    if (!Sky.res) return;
    this.steps = this.storyDefs(); this.si = 0;
    let card = $("#story-card");
    if (!card) {
      card = document.createElement("aside"); card.id = "story-card"; card.className = "story-card"; card.setAttribute("aria-live", "polite");
      document.body.appendChild(card);
      card.addEventListener("click", e => {
        const b = e.target.closest("[data-st]"); if (!b) return;
        if (b.dataset.st === "close") return this.storyStop();
        this.storyGo(this.si + (b.dataset.st === "next" ? 1 : -1));
      });
    }
    card.hidden = false;
    this.storyGo(0);
  },

  async storyGo(k) {
    if (k < 0) return;
    if (k >= this.steps.length) return this.storyStop();
    this.si = k; const st = this.steps[k], card = $("#story-card");
    $$(".story-spot").forEach(el => el.classList.remove("story-spot"));
    card.innerHTML = `<div class="st-top"><span class="st-kicker">Story mode · ${k + 1} of ${this.steps.length}</span>` +
      `<button type="button" class="st-x" data-st="close" aria-label="End story">✕</button></div>` +
      `<h4>${st.title}</h4><p>${st.text}</p>` +
      `<div class="st-dots">${this.steps.map((_, j) => `<i class="${j === k ? "on" : j < k ? "done" : ""}"></i>`).join("")}</div>` +
      `<div class="st-nav"><button type="button" class="btn sm ghost" data-st="back" ${k ? "" : "disabled"}>← Back</button>` +
      `<button type="button" class="btn sm primary" data-st="next">${k === this.steps.length - 1 ? "Finish ✓" : "Next →"}</button></div>`;
    try { await st.go(); } catch (e) { console.error(e); }
    const spot = $(st.spot);
    if (spot && !spot.classList.contains("theatre")) { spot.classList.add("story-spot"); spot.scrollIntoView({ behavior: "smooth", block: "center" }); }
  },

  storyStop() {
    const card = $("#story-card"); if (card) card.hidden = true;
    $$(".story-spot").forEach(el => el.classList.remove("story-spot"));
  },

  /* ---------------- F39 keyboard shortcuts ---------------- */
  KEYS: [
    ["Space", "Play / pause"], ["← →", "Previous / next frame"], ["1 – 6", "Time, Colour, Mission, Compare, Trail, Grid"],
    ["B", "Blink the A/B pair"], ["L", "Long-baseline blink: WISE 2010 ↔ SPHEREx"], ["M", "Measure the motion (1999/2010 → SPHEREx)"],
    ["X", "Big view on / off"], ["G", "Gaia stars"], ["P", "Predicted position"], ["D", "Missing data"], ["A", "Known asteroids"],
    ["F", "Flag objects"], ["T", "Frame labels"], ["S", "Story mode"], ["?", "This list"], ["Esc", "Close / cancel"]
  ],
  help(open) {
    const m = $("#keys-modal"); if (!m) return;
    if (open && !$("#keys-list").innerHTML) $("#keys-list").innerHTML = this.KEYS.map(([k, d]) => `<dt><kbd>${k}</kbd></dt><dd>${d}</dd>`).join("");
    m.hidden = !open;
  },
  key(e) {
    if (e.target.matches("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      if (!$("#keys-modal").hidden) return this.help(false);
      if (this.mm && this.mm.step) return this.cancelMeasure();
      if ($("#story-card") && !$("#story-card").hidden && !document.body.classList.contains("theatre-open")) return this.storyStop();
      return;
    }
    if (e.key === "?") return this.help(true);
    if (!Sky.res) return;
    const pill = id => { const el = $(id); if (el) { el.checked = !el.checked; el.dispatchEvent(new Event("change", { bubbles: true })); } };
    const modes = ["time", "colour", "mission", "compare", "trail", "grid"], k = e.key.toLowerCase();
    if (/^[1-6]$/.test(e.key)) return Sky.setMode(modes[+e.key - 1]);
    const act = {
      b: async () => { await Sky.setMode("compare"); $("#blink-btn").click(); },
      l: () => this.longBlink("W"), m: () => this.startMeasure(),
      x: () => Sky.theatre(!document.body.classList.contains("theatre-open")),
      g: () => pill("#show-gaia"), p: () => pill("#show-marker"), d: () => pill("#show-missing"),
      a: () => pill("#show-sso"), f: () => pill("#flag-mode"), t: () => pill("#show-labels"), s: () => this.story()
    }[k];
    if (act) { e.preventDefault(); act(); }
  },

  /* ---------------- F41 phone: swipe between frames, pinch to zoom in the big view ---------------- */
  wireTouch() {
    const c = $("#player"); if (!c) return;
    let t0 = null, pinch = null, zoom = 1;
    const setZoom = z => { zoom = Math.max(1, Math.min(6, z)); c.style.transform = zoom > 1 ? `scale(${zoom})` : ""; };
    c.addEventListener("touchstart", e => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: zoom }; t0 = null;
      } else if (e.touches.length === 1) t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { passive: true });
    c.addEventListener("touchmove", e => {
      if (pinch && e.touches.length === 2 && document.body.classList.contains("theatre-open")) {
        const [a, b] = e.touches; setZoom(pinch.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d); e.preventDefault();
      }
    }, { passive: false });
    c.addEventListener("touchend", e => {
      if (pinch) { if (e.touches.length < 2) pinch = null; return; }
      if (!t0 || zoom > 1) return;
      const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy) && Date.now() - t0.t < 600) {
        const p = Explorer.player; p.stop(); dx < 0 ? p.next() : p.prev();
      }
      t0 = null;
    });
    c.addEventListener("dblclick", () => setZoom(1));
    // leaving the big view always resets the zoom
    new MutationObserver(() => { if (!document.body.classList.contains("theatre-open")) setZoom(1); })
      .observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
};

document.addEventListener("DOMContentLoaded", () => Extras.init());

/* =====================================================================
   Band advisor — "Which band?" next to Dates.
   Known target: the best detector bands for it, with the reason.
   Anything else: what each band is good for, plus hints from where the
   position is (galactic plane = dust, so go long).
   SPHEREx band edges come from the backend settings.
   ===================================================================== */
const BandAdvisor = {
  USES: {
    D1: ["Ordinary and hot stars, galaxies' starlight", "Sharpest detail and the most stars. Red dwarfs like Proxima are near their peak here, so very bright ones may saturate (the detector fills up and the centre goes flat)."],
    D2: ["Most stars at their brightest; shocked iron gas", "Covers the classic J and H bands. Includes the 1.26 and 1.64 µm lines of iron (Fe II) that glow in supernova shocks. A safe default."],
    D3: ["Seeing through dust; hot dust around young stars", "Dust dims light about 10× less here than in visible light, and the inner discs of young stars (T Tauri) start to glow."],
    D4: ["Water ice, methane and organic molecules", "3.0 µm water ice and 3.3 µm methane / PAH (sooty organic molecules). Brown dwarfs go dark in methane, which itself is a test of what they are. Ices are a main SPHEREx science goal."],
    D5: ["Cold brown dwarfs; CO₂ ice; warm dust", "The coldest brown dwarfs give out most of their light near 4–4.5 µm, and dust heated to a few hundred degrees glows. 4.27 µm carbon-dioxide ice."],
    D6: ["The coldest objects; least dust; CO ice", "Y dwarfs like WISE 0855 are brightest here; dust barely dims it. With D5, the finest wavelength steps of the six bands (resolving power about 110–130, vs about 40 in D1–D4). 4.67 µm CO ice."]
  },
  REC: {
    barnard:   [["D1", "D2"], "A cool red dwarf peaks near 1 µm. It is bright, so if the core looks flat (saturated), step up to D3."],
    epsindib:  [["D5", "D2"], "T-type brown dwarfs are brightest near 4–4.5 µm (D5). D2 shows the methane-free window at 1.2–1.3 µm; D4 is where methane makes them go dark."],
    wise0855:  [["D6", "D5"], "The coldest known brown dwarf (about 250–285 K, near the freezing point of water): almost invisible below 3 µm. Only D5–D6 show it."],
    rwaur:     [["D3", "D5", "D2"], "D2 follows the star; D3–D5 follow the hot dust of its disc, where the dimming and brightening happen."],
    rdra:      [["D5", "D6"], "Physics: a ~2,500 K giant gives out most light per µm near 1–2 µm, so D1–D3 are where it is most likely to saturate; at 4–5 µm it is roughly half as bright. Rule of thumb, not yet checked on these files: open the Flags view — if the core is marked OVERFLOW or NONLINEAR, use D5–D6."],
    wr140:     [["D5", "D6", "D4"], "Its dust shell, made every 7.9 years, is warm: it shines at the long wavelengths."],
    etacar:    [["D3", "D4"], "Very bright (core saturates) and buried in dust; mid bands see through the nebula while keeping detail."],
    bllac:     [["D2", "D1"], "A blazar is smooth, featureless light; the short bands have the best signal for tracking flares."],
    "3c273":   [["D1", "D2"], "Bright and blue for an infrared source; the short bands give the best signal-to-noise for its slow variations."],
    luhman16:  [["D2", "D5"], "L/T brown dwarfs: bright at 1.2–1.6 µm (D2) and again near 4.5 µm (D5)."],
    sn2023ixf: [["D5", "D6", "D2"], "New dust forming after the explosion glows at long wavelengths; D2 tracks the fading hot gas."],
    proxima:   [["D1", "D2"], "A red dwarf peaks near 1 µm. Flares are brightest at short wavelengths."],
    crab:      [["D2", "D3"], "Shocked iron (Fe II, 1.26 and 1.64 µm) and the pulsar's synchrotron glow."],
    sn1987a:   [["D5", "D6"], "Dust made by the supernova is warm and glows at the long wavelengths."],
    mira:      [["D5", "D6"], "The prototype pulsating giant: brightest near 1–2 µm, where it may saturate; D5–D6 see it about half as bright (check the Flags view for OVERFLOW/NONLINEAR). Its cycle is 332 days."],
    betelgeuse:[["D6", "D5"], "One of the brightest infrared stars in the sky: expect saturation everywhere; D6 is the least bad."],
    sgra:      [["D5", "D6", "D4"], "The galactic centre is behind about 30 magnitudes of visible-light dust; only the longest bands get through."],
    tabby:     [["D2", "D6"], "D2 for the dips in starlight; D6 to test for warm dust (none has been found so far)."],
    casa:      [["D5", "D6", "D2"], "Warm dust from the explosion at long wavelengths; Fe II shock gas in D2."]
  },

  init() {
    const b = $("#band-rec"); if (!b) return;
    b.addEventListener("click", () => this.open());
    $("#band-close").addEventListener("click", () => this.close());
    $("#band-modal").addEventListener("click", e => {
      if (e.target.id === "band-modal") return this.close();
      const u = e.target.closest("[data-use]"); if (!u) return;
      $("#band").value = u.dataset.use; $("#band").dispatchEvent(new Event("change", { bubbles: true }));
      this.close();
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#band-modal").hidden) this.close(); });
  },
  close() { $("#band-modal").hidden = true; },

  current() {
    const id = ($("#name") && $("#name").value) || new URLSearchParams(location.search).get("target") || "";
    const t = (window.TARGETS || []).find(x => x.id === id);
    return { t, id, ra: parseRA(($("#ra") || {}).value), dec: parseDec(($("#dec") || {}).value) };
  },
  galLat(ra, dec) {            // galactic latitude from RA/Dec (J2000 north galactic pole)
    const r = Math.PI / 180, a0 = 192.85948 * r, d0 = 27.12825 * r;
    return Math.asin(Math.sin(dec * r) * Math.sin(d0) + Math.cos(dec * r) * Math.cos(d0) * Math.cos(ra * r - a0)) / r;
  },
  range(id) { const b = (window.BANDS || []).find(x => x.id === id); return b ? `${b.min}–${b.max} µm` : ""; },
  chip(id, star) {
    const now = ($("#band") || {}).value === id;
    return `<button type="button" class="bchip ${star ? "best" : ""} ${now ? "now" : ""}" data-use="${id}">` +
      `<b>${id}</b><small>${this.range(id)}</small>${now ? "<em>selected</em>" : "<em>use</em>"}</button>`;
  },
  table(hi) {
    return `<div class="btable">${Object.entries(this.USES).map(([id, [what, why]]) =>
      `<div class="brow ${hi && hi.includes(id) ? "hi" : ""}">${this.chip(id)}<div><b>${what}</b><p>${why}</p></div></div>`).join("")}</div>`;
  },

  open() {
    const { t, id, ra, dec } = this.current();
    let html = "";
    if (t && this.REC[t.id]) {
      const [best, why] = this.REC[t.id];
      html = `<p class="b-for">For <b>${t.name}</b> <span class="muted">· ${t.kind}</span></p>` +
        `<div class="b-best">${best.map((b, k) => this.chip(b, k === 0)).join("")}</div>` +
        `<p class="b-why">${why}</p>` +
        `<details class="b-all"><summary>What every band is for</summary>${this.table(best)}</details>`;
    } else {
      let hint = "";
      if (Number.isFinite(ra) && Number.isFinite(dec)) {
        const b = this.galLat(ra, dec), deep = /^deep-/.test(id);
        hint = deep ? `<p class="b-why"><b>Deep field:</b> hundreds of exposures here, so any band works. D1–D2 show the most galaxies; D4 is the ice band SPHEREx was built for.</p>`
          : Math.abs(b) < 5 ? `<p class="b-why"><b>This spot is in the Milky Way's plane</b> (galactic latitude ${b.toFixed(1)}°): thick dust. Prefer <b>D3–D6</b>, which see through it.</p>` +
              `<div class="b-best">${["D5", "D3", "D6"].map((x, k) => this.chip(x, k === 0)).join("")}</div>`
          : Math.abs(b) > 30 ? `<p class="b-why"><b>High above the Milky Way</b> (galactic latitude ${b.toFixed(1)}°): little dust, many distant galaxies. <b>D1–D2</b> give the most sources and sharpest detail; use <b>D5–D6</b> to hunt cold brown dwarfs.</p>` +
              `<div class="b-best">${["D2", "D1", "D6"].map((x, k) => this.chip(x, k === 0)).join("")}</div>`
          : `<p class="b-why">Galactic latitude ${b.toFixed(1)}°: some dust. <b>D2</b> is a safe start; pick by what you're looking for below.</p>`;
        hint = `<p class="b-for">For <span class="mono">RA ${ra.toFixed(3)}° · Dec ${dec.toFixed(3)}°</span></p>` + hint;
      }
      html = hint + `<p class="b-intro">SPHEREx splits 0.75–5 µm infrared light over six detectors. Each band suits different objects:</p>` + this.table();
    }
    $("#band-body").innerHTML = html + `<p class="muted b-note">Tip: within any band every frame is a slightly different wavelength (linear variable filter); ` +
      `tick “Same colour only” to compare like with like.</p>`;
    $("#band-modal").hidden = false;
  }
};
document.addEventListener("DOMContentLoaded", () => BandAdvisor.init());

/* ⓘ buttons: a small explanation bubble next to a field label. Click again, click elsewhere or Esc closes it. */
document.addEventListener("click", e => {
  const b = e.target.closest(".info-i");
  $$(".info-pop").forEach(p => { if (!b || p !== b.nextElementSibling) p.hidden = true; });
  if (!b) return;
  e.preventDefault();
  const pop = b.nextElementSibling; pop.hidden = !pop.hidden;
  b.setAttribute("aria-expanded", String(!pop.hidden));
});
document.addEventListener("keydown", e => { if (e.key === "Escape") $$(".info-pop").forEach(p => { p.hidden = true; }); });

/* ---------------- IRSA hand-off pop-up ----------------
   Shows what IRSA gets from the link (filled) or what to type where (not filled), animates for 4.5 s,
   then opens IRSA in a new tab. Browsers allow a tab to open for about 5 s after a click; if it is
   blocked anyway, an "Open IRSA" button stays in the pop-up. */
Extras.handoff = function ({ tool, filled, url, intro, steps, note }) {
  let m = $("#handoff");
  if (!m) {
    m = document.createElement("div"); m.id = "handoff"; m.className = "keys-modal handoff"; m.setAttribute("role", "dialog");
    m.setAttribute("aria-modal", "true"); document.body.appendChild(m);
    m.addEventListener("click", e => {
      if (e.target === m || e.target.closest("[data-ho=close]")) { clearTimeout(Extras.hoTimer); m.hidden = true; return; }
      const cp = e.target.closest("[data-copy]");
      if (cp) { navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy).then(() => { cp.textContent = "Copied ✓"; setTimeout(() => { cp.textContent = "Copy"; }, 1500); }); }
      if (e.target.closest("[data-ho=now]")) { e.preventDefault(); clearTimeout(Extras.hoTimer); Extras.hoOpen(true); }
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !m.hidden) { clearTimeout(Extras.hoTimer); m.hidden = true; } });
  }
  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  m.innerHTML = `<div class="keys-box ho-box">
    <div class="keys-head"><div><span class="ho-kicker ${filled ? "ok" : "warn"}">${filled ? "✓ Filled in for you" : "✎ Can't be filled in from a link"}</span>
      <b class="ho-title">NASA/IRSA · ${tool}</b></div><button class="btn sm ghost" type="button" data-ho="close">✕</button></div>
    <p class="ho-intro">${intro}</p>
    <ol class="ho-steps">${steps.map(st => `<li><span class="ho-k">${st.k}</span><span class="ho-v mono">${esc(st.v)}</span>` +
      (st.copy ? `<button type="button" class="btn sm ghost ho-copy" data-copy="${esc(st.v)}">Copy</button>` : "") +
      (st.hint ? `<small>${st.hint}</small>` : "") + `</li>`).join("")}</ol>
    ${note ? `<p class="ho-note">${note}</p>` : ""}
    <div class="ho-bar"><i></i></div>
    <div class="ho-foot"><span class="muted" id="ho-msg">Opening IRSA in a new tab…</span>
      <a class="btn sm primary" data-ho="now" href="${esc(url)}" target="_blank" rel="noopener">Open IRSA now ↗</a></div></div>`;
  m.hidden = false;
  const bar = $(".ho-bar i", m); bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
  Extras.hoUrl = url;
  Extras.hoOpen = manual => {
    const w = manual ? null : window.open(url, "_blank", "noopener");
    const msg = $("#ho-msg");
    if (manual) { window.open(url, "_blank", "noopener"); msg.textContent = "IRSA opened in a new tab. Keep this list handy."; }
    else msg.textContent = w === null && !document.hidden ? "IRSA opened in a new tab (or your browser blocked it: use the button)." : "IRSA opened in a new tab. Keep this list handy.";
  };
  clearTimeout(Extras.hoTimer);
  Extras.hoTimer = setTimeout(() => Extras.hoOpen(false), 4500);
};
