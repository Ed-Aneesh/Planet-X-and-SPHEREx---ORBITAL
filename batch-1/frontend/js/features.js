/* =====================================================================
   features.js — every analysis feature of the team's desktop tool
   (spherex_explorer), as tabs under the player on Star Vault and Sky Probe.

   The physics is computed in Python (backend/science/features.py). The
   browser only draws what the backend sends, except two things that need a
   human: marking the object to measure its motion (centroid + straight-line
   fit, done here on the RAW pixel values the backend sends), and choosing a
   wavelength window. Exports (GIF, video, CSV, report) are made here; the
   FITS file comes from the backend.
   ===================================================================== */

const Features = {
  res: null, params: null, el: null, panel: null, active: "gallery", cleanup: null,

  TABS: [
    ["View", [["gallery", "Gallery"], ["visits", "Visit stacks"], ["swipe", "Swipe"]]],
    ["Analyse", [["diff", "Difference"], ["trail", "Motion trail"], ["measure", "Measure motion"],
                 ["snr", "Signal-to-noise"], ["wave", "Wavelength window"], ["spectrum", "Spectrum & light curve"],
                 ["colour", "Colour picture"], ["flags", "Flags"]]],
    ["3D & sky", [["cube", "Spectral cube"], ["land", "Brightness landscape"], ["space", "Targets in 3D"],
                  ["sky", "Planetarium"]]],
    ["Save", [["report", "Report & export"]]],
  ],

  /* one line + a small line icon per tool, for the toolbox cards */
  META: {
    gallery:  ["Every frame, side by side", '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'],
    visits:   ["Stack each pass to beat the noise", '<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/>'],
    swipe:    ["Drag a line between two dates", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 2v20"/><path d="M9 12h-3m12 0h-3"/>'],
    diff:     ["Later minus earlier: only change survives", '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/><path d="M12 7.5v9"/>'],
    trail:    ["Each visit in its own colour", '<circle cx="5" cy="17" r="2"/><circle cx="11" cy="12" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6.5 15.5l3-2m3-2.5l4-3.5" stroke-dasharray="2 2"/>'],
    measure:  ["Click it, fit its speed and direction", '<path d="M4 20L20 4"/><path d="M14 4h6v6"/><path d="M4 14v6h6"/>'],
    snr:      ["What stands above the noise", '<path d="M2 14h3l2-6 3 12 3-16 3 10 2-4h4"/>'],
    wave:     ["Keep one slice of wavelengths", '<path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/><path d="M9 3v18M15 3v18" stroke-dasharray="2 2"/>'],
    spectrum: ["Brightness by colour and by date", '<path d="M3 3v18h18"/><path d="M6 15l4-5 3 3 5-7"/>'],
    colour:   ["Up to six detectors in one picture", '<circle cx="9" cy="9" r="5"/><circle cx="15" cy="9" r="5"/><circle cx="12" cy="15" r="5"/>'],
    flags:    ["Your flags, plus pixels the pipeline distrusts", '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'],
    cube:     ["The data as x · y · wavelength", '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12v10M12 12L3 7"/>'],
    land:     ["Brightness as mountains to spin", '<path d="M2 20l6-10 4 6 3-4 7 8z"/><circle cx="17" cy="6" r="2"/>'],
    space:    ["All 19 targets around the Sun, in 3D", '<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><circle cx="20" cy="10" r="1.2"/><circle cx="5" cy="15" r="1.2"/>'],
    sky:      ["This patch on a planetarium dome", '<path d="M3 18a9 9 0 0118 0"/><path d="M2 18h20"/><path d="M8 11l.5 1M15 8l.5 1M12 13l.5 1"/>'],
    report:   ["GIF, video, CSV, FITS and a report", '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>'],
  },
  GROUP_CLASS: { "View": "g-view", "Analyse": "g-analyse", "3D & sky": "g-3d", "Save": "g-save" },

  mount(after) {
    if (this.el) return;
    const sec = document.createElement("section");
    sec.className = "features tool-deck-wrap";
    sec.id = "features";
    const card = (id, label, group) => {
      const [blurb, icon] = this.META[id] || ["", ""];
      return `<button type="button" class="ftab tcard ${this.GROUP_CLASS[group]}" data-tab="${id}" role="tab" aria-selected="false">` +
        `<svg class="tc-ico" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` +
        `<span class="tc-txt"><b>${label}</b><small>${blurb}</small></span></button>`;
    };
    sec.innerHTML =
      `<div class="tool-deck" role="tablist" aria-label="Tools">` +
      this.TABS.map(([group, tabs]) => `<div class="tgroup ${this.GROUP_CLASS[group]}"><span class="tg-name">${group}</span>` +
        `<div class="tg-cards">${tabs.map(([id, label]) => card(id, label, group)).join("")}</div></div>`).join("") +
      `</div>` +
      `<div class="tool-stage" id="tool-stage" hidden>` +
        `<div class="ts-head"><button type="button" class="btn sm ghost" id="ts-all">← All tools</button>` +
        `<div class="ts-title" id="ts-title"></div>` +
        `<div class="ts-step"><button type="button" class="btn sm ghost" id="ts-prev" aria-label="Previous tool">‹</button>` +
        `<button type="button" class="btn sm ghost" id="ts-next" aria-label="Next tool">›</button></div></div>` +
        `<div class="feat-panel" id="feat-panel"></div></div>`;
    if (after.id === "more-tools-body") after.prepend(sec); else after.appendChild(sec);
    this.el = sec;
    this.panel = $("#feat-panel", sec);
    const order = this.TABS.flatMap(([, t]) => t.map(([id]) => id));
    sec.addEventListener("click", e => {
      const b = e.target.closest(".ftab");
      if (b) { this.picked = true; this.open(b.dataset.tab); return; }
      if (e.target.closest("#ts-all")) { this.close(); return; }
      const step = e.target.closest("#ts-prev, #ts-next");
      if (step) {
        const k = order.indexOf(this.active), d = step.id === "ts-next" ? 1 : -1;
        this.open(order[(k + d + order.length) % order.length]);
      }
    });
  },

  /* Tools that compare visits (passes of the survey, weeks apart) can't work with only one visit. */
  NEEDS2: {
    diff:    fx => fx.differences && fx.differences.pairs && fx.differences.pairs.length,
    trail:   fx => !!fx.trail,
    measure: fx => (fx.visits || []).length >= 2 && (fx.stackRaw || []).length === (fx.visits || []).length,
  },
  unavailable(id) {
    const t = this.NEEDS2[id], fx = (this.res && this.res.features) || {};
    return t && !t(fx) ? "needs 2+ visits" : "";
  },
  probeLink() {
    const c = (this.res && this.res.centre) || {}, t = (this.params && this.params.target) || "";
    return `probe.html?ra=${c.ra}&dec=${c.dec}${t ? "&target=" + encodeURIComponent(t) : ""}`;
  },
  markCards() {
    const vault = document.body.dataset.page === "vault";
    $$(".tcard", this.el).forEach(b => {
      const why = this.unavailable(b.dataset.tab);
      b.classList.toggle("disabled", !!why);
      b.setAttribute("aria-disabled", String(!!why));
      let tag = $(".tc-off", b);
      if (why && !tag) { tag = document.createElement("em"); tag.className = "tc-off"; $(".tc-txt", b).appendChild(tag); }
      if (why) tag.textContent = `Disabled · ${why}` + (vault ? " · use Sky Probe" : "");
      else if (tag) tag.remove();
    });
  },

  show(res, params) {
    this.res = res; this.params = params;
    this.mount($("#more-tools-body") || $("#results"));
    this.markCards();
    if (this.picked) this.open(this.active); else this.close();
  },

  close() {
    if (this.cleanup) { try { this.cleanup(); } catch (_) {} this.cleanup = null; }
    if (!this.el) return;
    this.el.classList.remove("tool-open");
    $("#tool-stage", this.el).hidden = true;
    $$(".ftab", this.el).forEach(b => { b.classList.remove("on"); b.setAttribute("aria-selected", "false"); });
    this.panel.innerHTML = "";
  },

  open(id) {
    if (this.cleanup) { try { this.cleanup(); } catch (_) {} this.cleanup = null; }
    this.active = id;
    $$(".ftab", this.el).forEach(b => { b.classList.toggle("on", b.dataset.tab === id); b.setAttribute("aria-selected", String(b.dataset.tab === id)); });
    this.el.classList.add("tool-open");
    $("#tool-stage", this.el).hidden = false;
    const label = this.TABS.flatMap(([g, t]) => t.map(x => [x, g])).find(([x]) => x[0] === id);
    if (label) $("#ts-title", this.el).innerHTML = `<span class="tg-chip ${this.GROUP_CLASS[label[1]]}">${label[1]}</span><b>${label[0][1]}</b>`;
    this.panel.innerHTML = "";
    const fx = (this.res && this.res.features) || {};
    const fn = this["tab_" + id];
    if (!this.res) return;
    const why = this.unavailable(id);
    if (why) {
      const vault = document.body.dataset.page === "vault";
      const visits = (fx.visits || []).length;
      this.panel.innerHTML = `<div class="tool-off"><b>Disabled for this result: it ${why}.</b>` +
        `<p>This tool compares <b>visits</b> (separate passes of SPHEREx over this spot, weeks or months apart). ` +
        `These frames come from ${visits <= 1 ? "a single visit" : visits + " visits"}, so there is nothing to compare yet.</p>` +
        (vault ? `<p>Star Vault plays the team's saved copy. <b>Sky Probe</b> asks the live NASA archive, which is updated every week and may have more visits.</p>` +
                 `<a class="btn sm primary" href="${this.probeLink()}">Open this target in Sky Probe ↗</a>`
               : `<p>Try <b>All dates</b> and more exposures (48, 96 or All) in Change search; SPHEREx revisits each spot about every six months.</p>`) +
        (id === "measure" || id === "trail" ? `<p class="tool-alt">Or use the <b>27-year baseline</b> instead: the Mission tab puts 2MASS (1999) and WISE (2010) ` +
          `on the same pixels as SPHEREx.</p><button type="button" class="btn sm ghost" id="tool-alt">` +
          (id === "measure" ? "📏 Measure the motion across 1999 → today" : "⇄ Long-baseline blink: WISE 2010 ↔ SPHEREx") + `</button>` : "") +
        `</div>`;
      const alt = $("#tool-alt", this.panel);
      if (alt) alt.onclick = () => { $(".player-card").scrollIntoView({ behavior: "smooth", block: "start" });
        id === "measure" ? Extras.startMeasure() : Extras.longBlink("W"); };
      return;
    }
    try { fn.call(this, this.panel, this.res, fx); }
    catch (e) { this.panel.innerHTML = `<p class="status error">This view failed: ${e.message}</p>`; console.error(e); }
  },

  /* ---------------- helpers ---------------- */
  fps() { return Math.max(0.25, +($("#fps") || {}).value || 2); },
  img(src) {
    return new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = src; });
  },
  canvas(size = 440, h) {
    const c = document.createElement("canvas");
    c.width = size; c.height = h || size; c.className = "feat-canvas";
    return c;
  },
  draw(ctx, im, w, h) {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    if (im) ctx.drawImage(im, 0, 0, w, h);
  },
  date(mjd) { return new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10); },
  year(mjd) { return 2000 + (mjd - 51544.5) / 365.25; },
  html(panel, s) { panel.insertAdjacentHTML("beforeend", s); return panel.lastElementChild; },
  explain(panel, s) { return this.html(panel, `<p class="feat-explain">${s}</p>`); },
  needs(panel, ok, msg) {
    if (!ok) this.html(panel, `<p class="status warn">${msg}</p>`);
    return ok;
  },

  /* A small player for any list of pictures: ← ▶ → and a label */
  flipbook(panel, items, { size = 440, onDraw } = {}) {
    const wrap = this.html(panel, `<div class="flip"></div>`);
    const c = this.canvas(size); wrap.appendChild(c);
    const bar = this.html(wrap, `<div class="controls"><button class="btn sm ghost" type="button">←</button>` +
      `<button class="btn sm primary" type="button">▶ Play</button><button class="btn sm ghost" type="button">→</button>` +
      `<span class="mono flip-label"></span></div>`);
    const [prev, play, next] = $$("button", bar), label = $(".flip-label", bar);
    const ctx = c.getContext("2d");
    let k = 0, timer = null, imgs = [];
    const render = () => {
      this.draw(ctx, imgs[k], c.width, c.height);
      if (onDraw) onDraw(ctx, k, c);
      label.textContent = `${k + 1}/${items.length} · ${items[k].label}`;
    };
    const stop = () => { clearInterval(timer); timer = null; play.textContent = "▶ Play"; };
    prev.onclick = () => { stop(); k = (k - 1 + items.length) % items.length; render(); };
    next.onclick = () => { stop(); k = (k + 1) % items.length; render(); };
    play.onclick = () => {
      if (timer) return stop();
      timer = setInterval(() => { k = (k + 1) % items.length; render(); }, 1000 / this.fps());
      play.textContent = "❚❚ Pause";
    };
    Promise.all(items.map(i => this.img(i.png))).then(list => { imgs = list; render(); });
    const old = this.cleanup;
    this.cleanup = () => { stop(); if (old) old(); };
    return { canvas: c, redraw: render, index: () => k };
  },

  /* ---------------- VIEW ---------------- */
  tab_gallery(panel, res) {
    this.explain(panel, "Every exposure side by side, on ONE brightness scale, north up and east left. " +
      "Click a picture to show it in the player above.");
    const grid = this.html(panel, `<div class="gallery"></div>`);
    grid.innerHTML = res.frames.map((f, k) =>
      `<figure data-k="${k}"><img src="${f.png}" alt="frame ${k + 1}"><figcaption class="mono">${k + 1}. ${f.date}` +
      `${f.wavelength ? ` · ${f.wavelength.toFixed(3)} µm` : ""}</figcaption></figure>`).join("");
    grid.addEventListener("click", e => {
      const fig = e.target.closest("figure"); if (!fig) return;
      Explorer.player.stop(); Explorer.player.all(); Explorer.player.go(+fig.dataset.k);
      $("#player").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  },

  tab_visits(panel, res, fx) {
    this.explain(panel, "A <b>visit</b> is one pass of the survey over this spot (exposures within 30 days). " +
      "The exposures of a visit are combined by their <b>median</b> (the middle value of each pixel), which removes " +
      "cosmic-ray hits and lowers the noise by about √N. Blinking the visits shows slow changes most clearly.");
    if (!this.needs(panel, fx.visits && fx.visits.length, "No visit stacks in this result (reload the images).")) return;
    this.flipbook(panel, fx.visits.map(v => ({ png: v.png,
      label: `visit ${v.visit} · ${this.date(v.mjd)} · ${v.count} exposure${v.count > 1 ? "s" : ""}` +
             (v.wavelength ? ` · λ ${v.wavelength.toFixed(3)} µm` : "") })));
  },

  tab_swipe(panel, res, fx) {
    this.explain(panel, "Two dates on top of each other with a divider you drag. Left of the line: the first picture; " +
      "right: the second. No flashing, so it is gentle on the eyes.");
    const items = fx.visits && fx.visits.length >= 2 ? fx.visits.map(v => ({ png: v.png, label: `visit ${v.visit} · ${this.date(v.mjd)}` }))
      : res.frames.map(f => ({ png: f.png, label: `frame ${f.index + 1} · ${f.date}` }));
    if (!this.needs(panel, items.length >= 2, "Swipe needs at least two pictures.")) return;
    const opts = items.map((it, k) => `<option value="${k}">${it.label}</option>`).join("");
    const bar = this.html(panel, `<div class="controls"><label>Left <select>${opts}</select></label>` +
      `<label>Right <select>${opts}</select></label></div>`);
    const [selA, selB] = $$("select", bar);
    selB.value = items.length - 1;
    const c = this.canvas(); panel.appendChild(c);
    const slider = this.html(panel, `<input type="range" class="swipe-range" min="0" max="1000" value="500" aria-label="Divider">`);
    const ctx = c.getContext("2d");
    let A = null, B = null;
    const render = () => {
      const x = c.width * slider.value / 1000;
      this.draw(ctx, B, c.width, c.height);
      if (A) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x, c.height); ctx.clip(); ctx.drawImage(A, 0, 0, c.width, c.height); ctx.restore(); }
      ctx.fillStyle = "#e0115f"; ctx.fillRect(x - 1, 0, 2, c.height);
    };
    const load = async () => { [A, B] = await Promise.all([this.img(items[selA.value].png), this.img(items[selB.value].png)]); render(); };
    selA.onchange = selB.onchange = load; slider.oninput = render;
    load();
  },

  /* ---------------- ANALYSE ---------------- */
  tab_diff(panel, res, fx) {
    this.explain(panel, "<b>Difference image</b>: later visit minus earlier visit, so only what CHANGED remains. " +
      "<span class='sw red'></span> red = got brighter, <span class='sw blue'></span> blue = got fainter, white = no change. " +
      "A moving star leaves a blue spot (where it was) beside a red spot (where it went); a star that only " +
      "changed brightness leaves one spot. Pictures are smoothed 3×3 first so a half-pixel shift is not mistaken for motion.");
    const d = fx.differences;
    if (!this.needs(panel, d && d.pairs.length, "Difference images need at least two visits (dates more than 30 days apart).")) return;
    this.flipbook(panel, d.pairs.map(p => ({ png: p.png,
      label: `visit ${p.to} − visit ${p.from} · ${p.days} days apart` })));
    this.html(panel, `<p class="muted">Colour scale: ±${d.limit.toPrecision(3)} ${d.unit} (same for every pair).</p>`);
  },

  tab_trail(panel, res, fx) {
    this.explain(panel, "Every visit gets its own colour, and the colours are added up. They are spread round the colour " +
      "wheel so together they make <b>white</b>: anything that stayed put is white; anything that moved or changed " +
      "leaves a coloured trail (earliest blue, then round the wheel).");
    const t = fx.trail;
    if (!this.needs(panel, t, "A motion trail needs at least two visits.")) return;
    const c = this.canvas(); panel.appendChild(c);
    this.img(t.png).then(im => this.draw(c.getContext("2d"), im, c.width, c.height));
    this.html(panel, `<div class="legend">${t.legend.map(l =>
      `<span><i style="background:${l.colour}"></i>visit ${l.visit}: ${this.date(l.mjd)}</span>`).join("")}</div>`);
  },

  /* F21 + F22: click the object on each visit; centroid; straight-line fit = proper motion */
  tab_measure(panel, res, fx) {
    this.explain(panel, "Click the object on each visit. Each click snaps to the <b>centroid</b> (brightness-weighted centre) " +
      "of the nearby pixels, measured on the real pixel values. With marks on two or more visits a straight line is fitted " +
      "to position against time: its slope is the <b>proper motion</b> (the object's drift across the sky) in " +
      "milliarcseconds per year (1 mas = 1/1000 of an arcsecond). The grid is fixed on the sky, so background stars do not move.");
    const vis = fx.visits || [], raw = (fx.stackRaw || []).map(b => {
      const bin = atob(b), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return new Float32Array(buf.buffer);
    });
    if (!this.needs(panel, vis.length >= 2 && raw.length === vis.length,
      "Measuring motion needs at least two visits (dates at least a few weeks apart). Load all dates.")) return;
    const N = res.sizePixels, pix = res.pixelArcsec, c0 = (N - 1) / 2;
    const marks = {};
    const book = this.flipbook(panel, vis.map(v => ({ png: v.png, label: `visit ${v.visit} · ${this.date(v.mjd)} — click the object` })), {
      onDraw: (ctx, k, cv) => {
        const s = cv.width / N;
        Object.entries(marks).forEach(([j, m]) => {
          const x = (m.col + 0.5) * s, y = (N - 1 - m.row + 0.5) * s;
          ctx.strokeStyle = +j === k ? "#e0115f" : "#ffd21f"; ctx.lineWidth = 2;
          if (+j === k) { ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke(); }
          else { ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke(); }
        });
      }
    });
    const out = this.html(panel, `<div class="measure-out"></div>`);
    const tools = this.html(panel, `<div class="controls"><button class="btn sm ghost" type="button">Remove mark on this visit</button></div>`);
    const centroid = (img, col, row, box = 2) => {
      let sw = 0, sc = 0, sr = 0;
      for (let r = row - box; r <= row + box; r++) for (let q = col - box; q <= col + box; q++) {
        if (r < 0 || q < 0 || r >= N || q >= N) continue;
        const v = img[r * N + q];
        const w = Number.isFinite(v) && v > 0 ? v : 0;
        sw += w; sc += w * q; sr += w * r;
      }
      return sw > 0 ? [sc / sw, sr / sw] : [col, row];
    };
    const fit = list => {
      if (list.length < 2) return null;
      const ys = list.map(m => this.year(m.mjd));
      const span = Math.max(...ys) - Math.min(...ys);
      if (span < 0.05) return null;
      const n = ys.length, ym = ys.reduce((a, b) => a + b) / n, sxx = ys.reduce((a, y) => a + (y - ym) ** 2, 0);
      const r = { span, count: n };
      for (const key of ["east", "north"]) {
        const v = list.map(m => m[key]), vm = v.reduce((a, b) => a + b) / n;
        const slope = ys.reduce((a, y, i) => a + (y - ym) * (v[i] - vm), 0) / sxx, icpt = vm - slope * ym;
        let scatter = 0.3 * pix;
        if (n > 2) scatter = Math.max(Math.sqrt(v.reduce((a, x, i) => a + (x - (slope * ys[i] + icpt)) ** 2, 0) / (n - 2)), 0.3 * pix);
        r[key] = slope * 1000; r[key + "Err"] = scatter / Math.sqrt(sxx) * 1000;
      }
      r.total = Math.hypot(r.east, r.north);
      return r;
    };
    const report = () => {
      const r = fit(Object.values(marks)), m = res.motion || {};
      let s = r ? `<b>Proper motion from ${r.count} marks over ${r.span.toFixed(2)} years:</b><br>` +
        `east ${r.east.toFixed(0)} ± ${r.eastErr.toFixed(0)} mas/yr · north ${r.north.toFixed(0)} ± ${r.northErr.toFixed(0)} mas/yr · ` +
        `total ${r.total.toFixed(0)} mas/yr`
        : "Mark the object on at least two visits taken at least a few weeks apart.";
      if (m.pmEast || m.pmNorth) s += `<br><span class="muted">Catalogue / typed value: east ${(+m.pmEast).toFixed(0)}, north ${(+m.pmNorth).toFixed(0)} mas/yr.</span>`;
      s += `<br><span class="muted">One pixel = ${pix}″ = ${pix * 1000} mas, so over a short time span the error bars are large: ` +
        `that is honest, not a bug.</span>`;
      out.innerHTML = s;
    };
    book.canvas.addEventListener("click", e => {
      const rect = book.canvas.getBoundingClientRect(), s = rect.width / N;
      const col = Math.round((e.clientX - rect.left) / s - 0.5), rowD = Math.round((e.clientY - rect.top) / s - 0.5);
      const k = book.index(), [cc, cr] = centroid(raw[k], col, N - 1 - rowD);
      marks[k] = { mjd: vis[k].mjd, col: cc, row: cr, east: (c0 - cc) * pix, north: (cr - c0) * pix };
      book.redraw(); report();
    });
    $("button", tools).onclick = () => { delete marks[book.index()]; book.redraw(); report(); };
    report();
  },

  tab_snr(panel, res, fx) {
    this.explain(panel, "<b>Signal-to-noise ratio</b> (SNR) = brightness ÷ typical random scatter (noise). Above 5 a spot is " +
      "very unlikely to be noise; those regions are outlined in <span class='kc-cyan'>cyan</span>. Stacking N exposures " +
      "lowers the noise by about √N, so the last view (all exposures together) reaches fainter objects.");
    const s = fx.snr;
    if (!this.needs(panel, s && s.views.length, "No signal-to-noise maps in this result.")) return;
    this.flipbook(panel, s.views.map(v => ({ png: v.png,
      label: `${v.name} (${v.count} exp.) · ${v.detected} pixels above ${s.detect}σ` })));
    this.html(panel, `<div class="cbar"><span>${s.low}</span><i class="cbar-magma"></i><span>${s.high}</span>` +
      `<span class="muted"> signal-to-noise</span></div>`);
  },

  tab_wave(panel, res) {
    this.explain(panel, "SPHEREx uses <b>linear variable filters</b>: the wavelength it records changes across the detector, " +
      "so each exposure sees the target at a slightly different wavelength (colour). Keep only exposures within a window " +
      "of wavelength, then blink them: a change that remains is variability, not colour.");
    const fr = res.frames.filter(f => f.wavelength);
    if (!this.needs(panel, fr.length, "No wavelengths could be read for these exposures.")) return;
    const ws = fr.map(f => f.wavelength), lo = Math.min(...ws), hi = Math.max(...ws);
    const box = this.html(panel, `<div class="controls">` +
      `<label>Centre (µm) <input type="number" step="0.001" value="${((lo + hi) / 2).toFixed(3)}"></label>` +
      `<label>Half-width (µm) <input type="number" step="0.005" min="0.001" value="0.03"></label>` +
      `<button class="btn sm primary" type="button">Play these in the player</button></div>`);
    this.html(panel, `<p class="muted">Wavelengths here run from ${lo.toFixed(3)} to ${hi.toFixed(3)} µm.</p>`);
    const list = this.html(panel, `<ul class="wave-list mono"></ul>`);
    const [cen, half] = $$("input", box);
    const pick = () => res.frames.filter(f => f.wavelength && Math.abs(f.wavelength - +cen.value) <= +half.value);
    const show = () => {
      const p = pick();
      list.innerHTML = p.length ? p.map(f => `<li>#${f.index + 1} · ${f.date} · λ ${f.wavelength.toFixed(3)} µm</li>`).join("")
        : "<li>No exposure falls inside that window.</li>";
    };
    cen.oninput = half.oninput = show; show();
    $("button", box).onclick = () => {
      const p = pick().map(f => f.index);
      if (!p.length) return;
      Explorer.player.custom(p);
      $("#player").scrollIntoView({ behavior: "smooth", block: "center" });
    };
  },

  /* F17 spectrum + F16 light curve as two SVG scatter charts */
  chart(points, xk, yk, ck, xl, yl, cl) {
    const W = 460, H = 300, L = 58, R = 12, T = 14, B = 44;
    const xs = points.map(p => p[xk]), ys = points.map(p => p[yk]), es = points.map(p => p.error), cs = points.map(p => p[ck]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 - x0 < 1e-9) { x0 -= 0.5; x1 += 0.5; }
    let y0 = Math.min(...ys.map((y, i) => y - es[i])), y1 = Math.max(...ys.map((y, i) => y + es[i]));
    if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
    const padX = (x1 - x0) * 0.06, padY = (y1 - y0) * 0.08; x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    const X = v => L + (v - x0) / (x1 - x0) * (W - L - R), Y = v => H - B - (v - y0) / (y1 - y0) * (H - T - B);
    const c0 = Math.min(...cs), c1 = Math.max(...cs);
    const col = v => `hsl(${260 - 200 * (c1 > c0 ? (v - c0) / (c1 - c0) : 0.5)},80%,60%)`;
    const ticks = (a, b) => [0, 0.25, 0.5, 0.75, 1].map(f => a + f * (b - a));
    let s = `<div class="chart-box"><svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${yl} against ${xl}">`;
    ticks(x0, x1).forEach(v => s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" class="grid"/><text x="${X(v)}" y="${H - B + 16}" text-anchor="middle">${(+v).toFixed(xk === "year" ? 2 : 3)}</text>`);
    ticks(y0, y1).forEach(v => s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${(+v).toPrecision(3)}</text>`);
    points.forEach((p, i) => {
      s += `<line x1="${X(xs[i])}" x2="${X(xs[i])}" y1="${Y(ys[i] - es[i])}" y2="${Y(ys[i] + es[i])}" class="err"/>`;
      s += `<circle cx="${X(xs[i])}" cy="${Y(ys[i])}" r="4" fill="${col(cs[i])}"><title>${xl} ${(+xs[i]).toFixed(3)}, ${(+ys[i]).toFixed(3)} mJy</title></circle>`;
    });
    s += `<text x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle" class="lab">${xl}</text>`;
    s += `<text x="14" y="${(T + H - B) / 2}" text-anchor="middle" class="lab" transform="rotate(-90 14 ${(T + H - B) / 2})">${yl}</text>`;
    s += `</svg><div class="muted chart-key">colour = ${cl}: purple ${c0.toFixed(ck === "year" ? 2 : 3)} → yellow ${c1.toFixed(ck === "year" ? 2 : 3)}</div></div>`;
    return s;
  },

  tab_spectrum(panel, res, fx) {
    this.explain(panel, "Quick-look brightness of the target in every exposure: the sum of a 3×3 pixel box at its predicted " +
      "position, on the original pixels, in <b>millijansky</b> (mJy, a unit of brightness used in radio and infrared astronomy). " +
      "Each exposure sees a different wavelength, so against wavelength this is a rough <b>spectrum</b>; against time it is a " +
      "<b>light curve</b>. Error bars = 1σ. Not calibrated photometry: use it to look, not to publish.");
    const sp = fx.spectrum;
    if (!this.needs(panel, sp && sp.points.length, "No exposure had a clean 3×3 box and a known wavelength at the target.")) return;
    this.html(panel, `<div class="charts">${this.chart(sp.points, "wavelength", "flux", "year", "wavelength (µm)", "brightness (mJy)", "year observed")}` +
      `${this.chart(sp.points, "year", "flux", "wavelength", "year observed", "brightness (mJy)", "wavelength (µm)")}</div>`);
    if (res.query && res.query.band) this.html(panel, `<p class="muted">Only band ${res.query.band} is loaded, so the spectrum covers that band's wavelength range. Load other bands to extend it.</p>`);
  },

  tab_colour(panel, res) {
    this.explain(panel, "Every SPHEREx image is one brightness per pixel: no colour. Giving two or three bands to the " +
      "blue, green and red channels (shortest wavelength → blue) makes an <b>infrared colour picture</b>: a translation into " +
      "visible colours, not what an eye would see. With four to six bands each band gets its own hue from blue to red, " +
      "and the hues are added. The bands are fetched and stacked now, on the same grid as above.");
    const cur = +String(res.query.band).replace("D", "");
    const picks = [cur, cur < 6 ? cur + 1 : cur - 2, cur < 5 ? cur + 2 : cur - 1].filter((v, i, a) => v >= 1 && v <= 6 && a.indexOf(v) === i);
    const box = this.html(panel, `<div class="controls">${[1, 2, 3, 4, 5, 6].map(b =>
      `<label class="toggle"><input type="checkbox" value="${b}" ${picks.includes(b) ? "checked" : ""}> D${b}</label>`).join("")}` +
      `<button class="btn sm ghost" type="button" data-all>All six</button>` +
      `<button class="btn sm primary" type="button" data-make>Make colour picture</button></div>`);
    const status = this.html(panel, `<p class="status"></p>`);
    const out = this.html(panel, `<div></div>`);
    $("[data-all]", box).onclick = () => { $$("input", box).forEach(i => { i.checked = true; }); $("[data-make]", box).click(); };
    $("[data-make]", box).onclick = async () => {
      const bands = $$("input:checked", box).map(i => i.value);
      if (bands.length < 2) return setStatus(status, "Tick at least two bands.", "warn");
      const c = res.centre || {}, f = res.frames;
      const p = Object.assign({}, this.params, { bands: bands.join(","), cra: c.ra, cdec: c.dec, cyear: c.epoch || "" });
      if (!p.start && !p.end && f.length) {            // stay close in time to the loaded images (±20 days)
        p.start = this.date(f[0].mjd - 20); p.end = this.date(f[f.length - 1].mjd + 20);
      }
      $("[data-make]", box).disabled = true;
      try {
        const r = await API.colour(p, s => setStatus(status, `${s.message} · ${Math.round(s.elapsed)} s`));
        if (!r.png) { setStatus(status, r.note || "No picture.", "warn"); out.innerHTML = `<ul class="warnings">${(r.notes || []).map(n => `<li>${n}</li>`).join("")}</ul>`; return; }
        setStatus(status, "Colour picture ready.", "ok");
        out.innerHTML = `<canvas class="feat-canvas" width="440" height="440"></canvas>` +
          (r.key ? Sky.keyHtml(r.key) : `<p><b>${r.legend}</b></p>`) + `<p class="muted">${r.caveat}</p><ul class="warnings">${r.notes.map(n => `<li>${n}</li>`).join("")}</ul>`;
        const cv = $("canvas", out);
        this.draw(cv.getContext("2d"), await this.img(r.png), cv.width, cv.height);
      } catch (e) { setStatus(status, e.message, "error"); }
      finally { $("[data-make]", box).disabled = false; }
    };
  },

  tab_flags(panel, res) {
    if (typeof Sky !== "undefined") {
      const n = (Sky.flags || []).length;
      this.html(panel, `<div class="uflags"><div class="uf-head"><b>Your flags (${n})</b>` +
        `<span class="muted">Click anything interesting on the picture; flags are kept on this computer, on every frame.</span></div>` +
        `<div class="uf-actions"><button type="button" class="btn sm primary" data-uf="big">⤢ Flag on the big picture</button>` +
        `<button type="button" class="btn sm ghost" data-uf="here">Flag on the player</button>` +
        `<button type="button" class="btn sm ghost" data-uf="csv" ${n ? "" : "disabled"}>Download CSV</button>` +
        `<button type="button" class="btn sm ghost" data-uf="copy" ${n ? "" : "disabled"}>Copy report</button></div>` +
        `<ol class="flags-list">${$("#flags-list") ? $("#flags-list").innerHTML.replace(/data-(go|del)/g, "data-uf-$1") : ""}</ol></div>` +
        `<h4 class="uf-sub">Pixels the pipeline doesn't trust</h4>`);
      panel.querySelector(".uflags").addEventListener("click", e => {
        const b = e.target.closest("[data-uf], [data-uf-go], [data-uf-del]"); if (!b) return;
        const on = () => { const m = $("#flag-mode"); if (!m.checked) { m.checked = true; m.dispatchEvent(new Event("change")); } };
        if (b.dataset.uf === "big") { on(); Sky.theatre(true); }
        else if (b.dataset.uf === "here") { on(); $("#player").scrollIntoView({ behavior: "smooth", block: "center" }); }
        else if (b.dataset.uf === "csv") $("#flags-csv").click();
        else if (b.dataset.uf === "copy") $("#flags-copy").click();
        else {   // show / delete reuse the side panel's handlers
          const k = b.closest("li").dataset.k, src = $(`#flags-list li[data-k="${k}"] [data-${"ufGo" in b.dataset ? "go" : "del"}]`);
          if (src) src.click();
          if ("ufGo" in b.dataset) $("#player").scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
    this.explain(panel, "SPHEREx's pipeline marks pixels it does not trust (cosmic-ray hits, saturation, hot pixels, " +
      "ghosts…). We blank them (no data) instead of pretending they are dark sky. Tick “Missing data in pink” under the " +
      "player to see them.");
    const rows = res.frames.filter(f => f.flagged > 0);
    this.html(panel, rows.length ? `<table class="kv">${rows.map(f =>
      `<tr><th>Frame ${f.index + 1} · ${f.date}</th><td>${(100 * f.flagged).toFixed(1)} % of pixels flagged and blanked</td></tr>`).join("")}</table>`
      : `<p>No flagged pixels in these frames.</p>`);
    if (res.droppedList && res.droppedList.length) this.html(panel, `<p class="muted">Exposures skipped: ` +
      res.droppedList.map(d => `${d.date} (${d.reason})`).join("; ") + `</p>`);
  },

  /* ---------------- 3D & SKY (views3d.js) ---------------- */
  tab_cube(panel, res, fx) { Views3D.cube(this, panel, res, fx); },
  tab_land(panel, res, fx) { Views3D.landscape(this, panel, res, fx); },
  tab_space(panel, res) { Views3D.space(this, panel, res); },
  tab_sky(panel, res, fx) { Views3D.planetarium(this, panel, res, fx); },

  /* ---------------- SAVE ---------------- */
  reportText(res) {
    const q = res.query || {}, c = res.centre || {}, f = res.frames || [];
    const lines = [
      "SPHEREx session report — Planet X and SPHERE x (NASA Space Apps 2026)",
      `Position: RA ${(+c.ra).toFixed(6)}  Dec ${(+c.dec >= 0 ? "+" : "")}${(+c.dec).toFixed(6)} deg` + (c.name ? `  (${c.name})` : "") +
        (c.epoch ? `  at epoch ${(+c.epoch).toFixed(2)}` : ""),
      `Patch: ${(2 * q.radiusArcmin).toFixed(1)} arcmin across (${res.sizePixels} x ${res.sizePixels} pixels of ${res.pixelArcsec}"), band ${q.band}`,
      `Data release: ${(res.release || "?").toUpperCase()}  (DOI ${res.doi || "see IRSA"}); source: ${res.source === "drive" ? "team's Google Drive copy of IRSA files" : "NASA/IPAC IRSA (live)"}`,
      `Exposures used: ${f.length} of ${res.found} found; dropped: ${(res.droppedList || []).length}`,
    ];
    if (res.motion && (res.motion.pmEast || res.motion.pmNorth))
      lines.push(`Proper motion used: east ${res.motion.pmEast} mas/yr, north ${res.motion.pmNorth} mas/yr (position epoch ${res.motion.epoch})`);
    if (f.length) lines.push(`Dates: ${f[0].date} to ${f[f.length - 1].date} UTC`);
    (res.droppedList || []).forEach(d => lines.push(`  dropped ${d.date}: ${d.reason}`));
    lines.push("Files used:");
    f.forEach(x => lines.push(`  ${x.date}  λ ${x.wavelength ? x.wavelength.toFixed(4) + " um" : "?"}  ${x.url || ""}`));
    lines.push("Processing: bad-pixel flags blanked, zodiacal-light model and residual background subtracted,",
      "every exposure resampled onto one north-up grid, one brightness scale for all frames.",
      ...(res.warnings || []).map(w => "Note: " + w),
      res.credit || "Credit: SPHEREx data from the NASA/IPAC Infrared Science Archive (IRSA).");
    return lines.join("\n");
  },

  stem(res) {
    const c = res.centre || {};
    return (c.name ? c.name.replace(/[^\w]+/g, "_") : `ra${(+c.ra).toFixed(3)}_dec${(+c.dec).toFixed(3)}`) + `_${res.query.band}`;
  },

  /* draws one picture + caption for GIF / video, the way the desktop export did */
  async renderFrames(res, which) {
    const items = which === "visits" && res.features && res.features.visits.length
      ? res.features.visits.map(v => ({ png: v.png, label: `visit ${v.visit} · ${this.date(v.mjd)} · ${v.count} exp.` }))
      : res.frames.map(f => ({ png: f.png, marker: f.marker, label: `${f.date}${f.wavelength ? ` · λ ${f.wavelength.toFixed(3)} µm` : ""}` }));
    const S = 480, cv = this.canvas(S, S + 56), ctx = cv.getContext("2d"), N = res.sizePixels, title = (res.centre && res.centre.name) || "Custom position";
    const out = [];
    for (const it of items) {
      const im = await this.img(it.png);
      ctx.fillStyle = "#0c1424"; ctx.fillRect(0, 0, S, S + 56);
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, S, S);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(im, 0, 0, S, S);
      if (it.marker && res.motion && (res.motion.pmEast || res.motion.pmNorth)) {
        const s = S / N; ctx.strokeStyle = "#ffd400"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc((it.marker.x + 0.5) * s, (it.marker.y + 0.5) * s, Math.max(8, 2.2 * s), 0, 7); ctx.stroke();
      }
      ctx.fillStyle = "#fff"; ctx.font = "bold 14px monospace"; ctx.fillText(`${title} · ${res.query.band}`, 10, S + 20);
      ctx.font = "13px monospace"; ctx.fillText(it.label, 10, S + 38);
      ctx.fillStyle = "#aab"; ctx.font = "10px monospace"; ctx.fillText("SPHEREx data: NASA/IPAC IRSA · north up, east left", 10, S + 52);
      out.push(ctx.getImageData(0, 0, S, S + 56));
    }
    return { frames: out, canvas: cv };
  },

  tab_report(panel, res) {
    this.explain(panel, "Everything about this result, and files to keep. The FITS file holds the real numbers " +
      "(MJy/sr, NaN = no data) with a WCS header, so astronomy software (DS9, Aladin, astropy) can open it.");
    const box = this.html(panel, `<div class="exports">` +
      `<label>Animate <select><option value="frames">all exposures</option><option value="visits">visit stacks</option></select></label>` +
      `<button class="btn sm primary" type="button" data-x="gif">GIF animation</button>` +
      `<button class="btn sm primary" type="button" data-x="video">Video (WebM)</button>` +
      `<button class="btn sm ghost" type="button" data-x="png">Current frame (PNG)</button>` +
      `<button class="btn sm ghost" type="button" data-x="csv">Table of frames (CSV)</button>` +
      `<button class="btn sm ghost" type="button" data-x="fits">Aligned frames (FITS)</button>` +
      `<button class="btn sm ghost" type="button" data-x="txt">Report (text)</button></div>`);
    const status = this.html(panel, `<p class="status"></p>`);
    this.html(panel, `<pre class="report">${this.reportText(res).replace(/[<&]/g, ch => ch === "<" ? "&lt;" : "&amp;")}</pre>`);
    const which = $("select", box);
    box.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b) return;
      const kind = b.dataset.x, stem = this.stem(res);
      b.disabled = true;
      try {
        if (kind === "txt") downloadBlob(new Blob([this.reportText(res)], { type: "text/plain" }), stem + "_report.txt");
        if (kind === "png") $("#player").toBlob(bl => downloadBlob(bl, stem + "_frame.png"));
        if (kind === "csv") {
          const head = "index,date_utc,mjd,visit,wavelength_um,days_since_previous,coverage,flagged_fraction,missing_fraction,file";
          const rows = res.frames.map(f => [f.index + 1, f.date, f.mjd, f.visit, f.wavelength ?? "", f.gapDays ?? "",
            f.coverage ?? "", f.flagged ?? "", f.missing ?? "", f.url || ""].join(","));
          downloadBlob(new Blob([head + "\n" + rows.join("\n") + "\n"], { type: "text/csv" }), stem + "_frames.csv");
        }
        if (kind === "gif") {
          setStatus(status, "Making the GIF…");
          const { frames } = await this.renderFrames(res, which.value);
          downloadBlob(GIF.encode(frames, 1000 / this.fps()), stem + "_blink.gif");
          setStatus(status, `GIF saved (${frames.length} frames at ${this.fps()} per second).`, "ok");
        }
        if (kind === "video") {
          if (!window.MediaRecorder) throw new Error("This browser cannot record video; use the GIF instead.");
          setStatus(status, "Recording the video…");
          const { frames, canvas } = await this.renderFrames(res, which.value);
          const ctx = canvas.getContext("2d"), stream = canvas.captureStream(30), chunks = [];
          const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" });
          rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
          const done = new Promise(r => rec.onstop = r);
          rec.start();
          for (const f of frames) { ctx.putImageData(f, 0, 0); await new Promise(r => setTimeout(r, 1000 / this.fps())); }
          rec.stop(); await done;
          downloadBlob(new Blob(chunks, { type: "video/webm" }), stem + "_blink.webm");
          setStatus(status, "Video saved (WebM: plays in browsers and VLC).", "ok");
        }
        if (kind === "fits") {
          setStatus(status, "Fetching the FITS file…");
          let blob = await API.fits(res.fitsName);
          if (!blob) {                      // prebuilt / cached result: process once more on this server
            setStatus(status, "This result was prebuilt, so the server makes the FITS file now…");
            const fresh = await API.search(Object.assign({}, this.params, { fresh: 1 }),
              s => setStatus(status, `${s.message} · ${Math.round(s.elapsed)} s`));
            blob = await API.fits(fresh.fitsName);
          }
          if (!blob) throw new Error("The server could not make the FITS file.");
          downloadBlob(blob, stem + "_aligned.fits");
          setStatus(status, "FITS saved: HDU 0 = aligned exposures, HDU 1 = visit stacks, MJy/sr.", "ok");
        }
      } catch (err) { setStatus(status, err.message, "error"); }
      finally { b.disabled = false; }
    });
  },
};
