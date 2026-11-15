/* =====================================================================
   explorer.js — shared by vault.html and probe.html.

   Inputs (only these): RA, Dec (from the page), radius (arcmin), band,
   time range or "all", and FPS (display only, never sent to the backend).
   Shows: all frames on auto play, clickable frame buttons, and a blink
   between two frames chosen from dropdowns, at the chosen FPS.
   ===================================================================== */

const Explorer = {
  player: null,
  res: null,
  getQuery: null,
  limits: { min: 0.3, max: 15, default: 3 },
  fpsChoices: [0.5, 1, 2, 3, 4, 6, 8, 12],
  warnFraction: 0.01,

  async init({ getQuery, fileName, radiusChoices }) {
    this.getQuery = getQuery;
    this.fileName = fileName || (() => "frames");
    this.player = new Player({
      canvas: $("#player"), hud: $("#hud"), dots: $("#dots"), info: $("#frame-info"),
      playBtn: $("#play"), onChange: () => {}
    });
    this.player.render();

    /* settings from the backend (falls back to defaults) */
    const s = await API.settings();
    if (s) {
      this.limits = s.radiusArcmin;
      this.fpsChoices = s.fps;
      this.warnFraction = s.wavelengthWarnFraction;
      this.vaultRadii = s.vaultRadiiArcmin;
      window.BANDS = s.bands;
    }
    $("#band").innerHTML = window.BANDS
      .map(b => `<option value="${b.id}">Band ${b.id.slice(1)} · ${b.min}–${b.max} µm</option>`).join("");
    const r = $("#radius");
    if (r.dataset.unit === "deg") {
      /* Sky Probe: radius typed in DEGREES like the desktop tool (0.005–0.25°, default 0.08°) */
      r.min = (this.limits.min / 60).toFixed(3); r.max = (this.limits.max / 60).toFixed(2);
    } else if (r.tagName === "SELECT") {
      /* Cutout radius as a dropdown. 2′ is the default: the team's Drive cutouts
         are ~6′ wide and tilted, so 2′ fits inside every one of them. */
      /* Star Vault offers only the radii the Drive cutouts can fill (all prebuilt = instant);
         Sky Probe asks the live archive, so it goes up to 15′. */
      const all = [0.5, 1, 1.5, 2, 3, 5, 10, 15];
      const choices = (radiusChoices === "vault" ? (this.vaultRadii || [0.5, 1, 1.5, 2, 3, 5]) : all)
        .filter(v => v >= this.limits.min && v <= this.limits.max);
      r.innerHTML = choices.map(v => `<option value="${v}" ${v === 2 ? "selected" : ""}>` +
        `${(v / 60).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}° (${v}′)</option>`).join("");
    } else {
      r.min = this.limits.min; r.max = this.limits.max; r.value = this.limits.default;
    }
    const hint = $("#radius-hint");
    if (hint) hint.textContent = `${this.limits.min}–${this.limits.max}′ (1′ = 1/60°). Bigger = slower download.`;
    $("#fps").innerHTML = this.fpsChoices
      .map(f => `<option value="${f}" ${f === 2 ? "selected" : ""}>${f} frame${f === 1 ? "" : "s"}/s</option>`).join("");

    this._wire();
    API.health().then(ok => {
      const el = $("#backend-status");
      if (ok && API.staleBackend) {
        el.textContent = "⚠ The backend is running old code (it knows fewer targets). Stop it with Ctrl+C and start it again: python main.py";
        el.className = "mono status warn";
        return;
      }
      el.textContent = ok
        ? (document.body.dataset.page === "probe" ? "● Backend connected — every image comes live from NASA/IPAC IRSA" : "● Backend connected")
        : "○ " + API.offlineText();
      el.className = "mono status " + (ok ? "ok" : "error");
    });
  },

  _wire() {
    const p = this.player;
    $("#all-time").addEventListener("change", e => {
      $("#t-start").disabled = $("#t-end").disabled = e.target.checked;
    });
    $("#fps").addEventListener("change", e => p.setFps(e.target.value));
    $("#show-missing").addEventListener("change", e => { p.showMissing = e.target.checked; p.render(); });
    $("#show-marker").addEventListener("change", e => { p.showMarker = e.target.checked; p.render(); });

    $("#play").addEventListener("click", () => {
      if (p.blinking) { p.stop(); p.all(); }                 // leaving blink -> back to all frames
      p.toggle();
      this._blinkUi();
    });
    $("#prev").addEventListener("click", () => { p.stop(); p.prev(); });
    $("#next").addEventListener("click", () => { p.stop(); p.next(); });

    $("#blink-a").addEventListener("change", () => this._blinkInfo());
    $("#blink-b").addEventListener("change", () => this._blinkInfo());
    $("#blink-btn").addEventListener("click", () => {
      if (!this.res) return;
      if (p.blinking && p.timer) { p.stop(); p.all(); this._blinkUi(); return; }
      const a = +$("#blink-a").value, b = +$("#blink-b").value;
      if (a === b) return setStatus($("#blink-status"), "Choose two different frames.", "warn");
      setStatus($("#blink-status"), "");
      p.blink(a, b);
      this._blinkUi();
    });

    $("#controls").addEventListener("submit", e => { e.preventDefault(); this.load(); });
    if ($("#cancel-btn")) $("#cancel-btn").addEventListener("click", () => {
      if (API.cancelAll()) setStatus($("#status"), "Cancelling…", "warn");
    });

    document.addEventListener("keydown", e => {
      if (e.target.matches("input, textarea, select")) return;
      if (e.key === "ArrowRight") { p.stop(); p.next(); }
      if (e.key === "ArrowLeft") { p.stop(); p.prev(); }
      if (e.key === " ") { e.preventDefault(); $("#play").click(); }
    });
  },

  /* ---------- read + check the form ---------- */
  _params() {
    const base = this.getQuery();                    // page gives {ra, dec} and/or {target}
    const el = $("#radius"), deg = el.dataset.unit === "deg";
    const r = deg ? +el.value * 60 : +el.value;                 // backend works in arcminutes
    if (!(r >= this.limits.min - 1e-9 && r <= this.limits.max + 1e-9))
      throw new Error(deg ? `Radius must be ${(this.limits.min / 60).toFixed(3)}–${(this.limits.max / 60).toFixed(2)}° ` +
                            `(1° = 60′).` : `Radius must be ${this.limits.min}–${this.limits.max} arcmin.`);
    const all = $("#all-time").checked;
    const start = all ? "" : $("#t-start").value, end = all ? "" : $("#t-end").value;
    if (!all && !start && !end) throw new Error("Pick a start and/or end date, or tick “All dates”.");
    if (start && end && start > end) throw new Error("Start date is after end date.");
    const max = $("#max-exp") ? $("#max-exp").value : "";
    return Object.assign(base, { radius: r, band: $("#band").value, start, end }, max && max !== "24" ? { max } : {});
  },

  /* ---------- load from the backend ---------- */
  async load() {
    let params;
    try { params = this._params(); }
    catch (e) { return setStatus($("#status"), e.message, "error"); }

    this.player.clear();
    this.res = null;
    this.params = params;
    $("#warnings").innerHTML = ""; $("#summary").textContent = "";
    if ($("#notes")) $("#notes").hidden = true;
    this._blinkOptions([]);
    $("#load-btn").disabled = true;
    if ($("#cancel-btn")) $("#cancel-btn").hidden = false;
    setStatus($("#status"), "Starting…");
    try {
      const res = await API.search(params, s => {
        const bar = s.total ? ` ${s.done}/${s.total}` : "";
        setStatus($("#status"), `${s.message}${bar} · ${Math.round(s.elapsed)} s`);
      });
      const notes = (res.warnings || []).filter(Boolean);
      $("#warnings").innerHTML = notes.map(w => `<li>${w}</li>`).join("");
      if ($("#notes")) {
        $("#notes").hidden = notes.length === 0;
        $("#notes-sum").textContent = `Notes on these frames (${notes.length})`;
      }
      if (!res.frames || !res.frames.length) {
        setStatus($("#status"), res.note || "No frames.", "warn");
        return;
      }
      this.res = res;
      const results = $("#results");
      if (results && results.hidden) { results.hidden = false; }
      await this.player.load(res);
      if (this.onResults) this.onResults(res);
      if (typeof Sky !== "undefined") Sky.onResults(res, params);
      if (typeof Features !== "undefined") Features.show(res, params);
      if (results) window.scrollTo({ top: Math.max(0, ($("#search-bar") || results).getBoundingClientRect().top + scrollY - ($(".nav") ? $(".nav").offsetHeight : 0) - 8), behavior: "smooth" });
      this.player.setFps($("#fps").value);
      this._summary(res);
      this._blinkOptions(res.frames);
      const cap = params && params.max && params.max !== "all" ? +params.max : null;
      const allOfThem = res.matched !== undefined && res.requested !== undefined && res.requested >= res.matched;
      const fewer = cap && res.frames.length < cap && allOfThem
        ? ` That is every ${res.query && res.query.band ? res.query.band + " " : ""}image SPHEREx took of this spot` +
          `${res.query && (res.query.start || res.query.end) ? " in your dates" : ""} (not a limit of this site). Try another band or wider dates for more.`
        : "";
      setStatus($("#status"), `${res.frames.length} frames ready${res.fromCache ? " (from cache)" : ""}. Press Auto play or click a frame.${fewer}`, "ok");
    } catch (e) {
      setStatus($("#status"), e.message, e.cancelled ? "warn" : "error");
    } finally {
      $("#load-btn").disabled = false;
      if ($("#cancel-btn")) $("#cancel-btn").hidden = true;
    }
  },

  _summary(r) {
    const c = r.centre || {}, f = r.frames || [];
    const src = r.source === "drive" ? "team's Drive copy of IRSA data" : "NASA/IPAC IRSA (live)";
    const span = f.length ? `${f[0].date.slice(0, 10)} → ${f[f.length - 1].date.slice(0, 10)}` : "";
    const t = r.timing;
    $("#summary").innerHTML =
      `<b>${c.name || "Custom position"}</b><span class="muted"> · ${r.query.band} · ${f.length} frames · ${span}</span>` +
      `<details class="sum-more"><summary>Details</summary><dl>` +
      `<dt>Centre</dt><dd class="mono">${fmtRA(c.ra)} ${fmtDec(c.dec)}${c.epoch ? ` (position at ${c.epoch.toFixed(2)})` : ""}</dd>` +
      `<dt>Patch</dt><dd>${r.sizePixels}×${r.sizePixels} pixels of ${r.pixelArcsec}″, north up, east left</dd>` +
      `<dt>Exposures</dt><dd>${r.used} shown of ${r.found} found, spread evenly in time` +
        `${r.used < r.found ? " (choose more under “Exposures to use”)" : ""}${r.available ? ` · data ${r.available.first} → ${r.available.last}` : ""}</dd>` +
      `<dt>Source</dt><dd>${src}, release ${(r.release || "?").toUpperCase()}${r.doi ? `, DOI ${r.doi}` : ""}</dd>` +
      `<dt>Brightness</dt><dd>${r.stretch ? r.stretch.method : "—"}, in ${r.unit || "MJy/sr"}</dd>` +
      (t ? `<dt>Time</dt><dd>${t.totalSeconds} s (${t.mb} MB)${r.fromCache ? ", now cached" : ""}</dd>` : "") +
      `</dl></details>`;
  },


  /* ---------- blink ---------- */
  _blinkOptions(frames) {
    const opts = frames.map((f, k) =>
      `<option value="${k}">#${k + 1} · ${f.date}${f.wavelength ? " · λ " + f.wavelength.toFixed(3) : ""}</option>`).join("");
    $("#blink-a").innerHTML = opts; $("#blink-b").innerHTML = opts;
    $("#blink-a").disabled = $("#blink-b").disabled = $("#blink-btn").disabled = frames.length < 2;
    if ($("#subtract-btn")) $("#subtract-btn").disabled = frames.length < 2;
    if (frames.length >= 2) { $("#blink-a").value = 0; $("#blink-b").value = frames.length - 1; }
    this._blinkInfo();
    this._blinkUi();
  },

  /* Physics shown for the chosen pair: time apart, wavelength apart, expected motion. */
  _blinkInfo() {
    if (typeof Sky !== "undefined") Sky.updateTrust();
    const el = $("#blink-info");
    if (!el) return;                                   // the honesty card shows this now
    if (!this.res || this.res.frames.length < 2) { el.innerHTML = ""; return; }
    const A = this.res.frames[+$("#blink-a").value], B = this.res.frames[+$("#blink-b").value];
    const days = Math.abs(B.mjd - A.mjd);
    let html = `<tr><th>Time apart</th><td>${days.toFixed(1)} days (${(days / 365.25).toFixed(2)} yr)</td></tr>`;
    if (A.wavelength && B.wavelength) {
      const dl = Math.abs(B.wavelength - A.wavelength), frac = dl / ((A.wavelength + B.wavelength) / 2);
      const bad = frac > this.warnFraction;
      html += `<tr><th>Wavelength apart</th><td class="${bad ? "warn" : "ok"}">${dl.toFixed(3)} µm (${(frac * 100).toFixed(1)} %)` +
        (bad ? " ⚠ different colours: a brightness change may be spectral, not variability" : " ✓ same colour within 1 %") + `</td></tr>`;
    }
    if (A.marker && B.marker) {
      const px = Math.hypot(B.marker.x - A.marker.x, B.marker.y - A.marker.y);
      const arcsec = px * this.res.pixelArcsec;
      html += `<tr><th>Expected target motion</th><td>${arcsec.toFixed(1)}″ = ${px.toFixed(2)} px` +
        (px < 0.5 ? " (less than half a pixel: no visible shift expected)" : "") + `</td></tr>`;
    }
    el.innerHTML = html;
  },

  _blinkUi() {
    const p = this.player;
    $("#blink-btn").textContent = p.blinking && p.timer ? "■ Stop" : "Blink";
  }
};
