/* =====================================================================
   player.js — shows the backend's frames: auto play, step, click any
   frame, and BLINK between two chosen frames, at a user-chosen FPS.

   Physics is done in Python. The browser only draws:
   - every PNG already shares ONE brightness stretch (set in the backend);
   - all frames sit on ONE north-up grid, so pixel (x, y) is the same sky
     position in every frame; we draw them at the same place and scale;
   - transparent pixels = no data (flagged/saturated/outside the exposure);
   - the yellow ring is the target's predicted position for that frame's
     date (proper motion), computed by the backend.
   ===================================================================== */

class Player {
  constructor(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.hud = opts.hud;
    this.dots = opts.dots;
    this.info = opts.info;
    this.playBtn = opts.playBtn;
    this.onChange = opts.onChange || (() => {});
    this.res = null;
    this.imgs = [];
    this.seq = [];          // frame indices being cycled (all frames, or the blink pair)
    this.pos = 0;           // position inside seq
    this.fps = 2;
    this.timer = null;
    this.showMissing = false;   // off by default (switch on under the player)
    this.showMarker = false;
  }

  get i() { return this.seq[this.pos] ?? 0; }
  get blinking() { return !!this.res && this.seq.length === 2 && this.res.frames.length > 2; }

  async load(res) {
    this.stop();
    this.res = res;
    this.imgs = await Promise.all(res.frames.map(f => new Promise((ok, bad) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => bad(new Error("could not decode a frame image"));
      im.src = f.png;
    })));
    this.all();
    this._buildDots();
    this.render();
  }

  clear() {
    this.stop();
    this.res = null; this.imgs = []; this.seq = []; this.pos = 0;
    if (this.dots) this.dots.innerHTML = "";
    if (this.info) this.info.innerHTML = "";
    this.render();
  }

  /* ---------- sequences ---------- */
  all() { this.seq = this.res ? this.res.frames.map((_, k) => k) : []; this.pos = 0; }
  blink(a, b) { this.stop(); this.seq = [a, b]; this.pos = 0; this.render(); this.play(); }
  /* play only these frames (e.g. a wavelength window) */
  custom(indices) { this.stop(); this.seq = indices.slice(); this.pos = 0; this.render(); this.play(); }

  /* ---------- drawing ---------- */
  render() {
    const c = this.canvas, ctx = this.ctx;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
    if (!this.res || !this.imgs.length) {
      ctx.fillStyle = "#888"; ctx.font = "14px monospace";
      ctx.fillText("No frames loaded", 16, 28);
      if (this.hud) this.hud.textContent = "—";
      return;
    }
    const f = this.res.frames[this.i], im = this.imgs[this.i];
    const N = this.res.sizePixels || im.width, s = c.width / N;

    if (this.override) {                                  // e.g. a difference image (sky.js)
      this.override(ctx, c, s);
    } else {
      if (this.showMissing) { ctx.fillStyle = "#ff3caa"; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.imageSmoothingEnabled = false;                  // show real pixels, no blurring
      ctx.drawImage(im, 0, 0, c.width, c.height);
    }
    if (this.drawExtra) this.drawExtra(ctx, f, s);        // Gaia stars (sky.js)

    if (this.showMarker && f.marker) {                    // predicted target position
      const x = (f.marker.x + 0.5) * s, y = (f.marker.y + 0.5) * s;
      ctx.strokeStyle = "#ffd25e"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(x, y, Math.max(7, 2.2 * s), 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
    }

    // compass and a 1-arcminute scale bar
    ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.font = "11px monospace";
    ctx.fillText("N ↑   E ←", 8, c.height - 10);
    if (this.res.pixelArcsec) {
      const bar = (60 / this.res.pixelArcsec) * s;
      if (bar < c.width * 0.6) {
        ctx.fillRect(c.width - 12 - bar, c.height - 16, bar, 3);
        ctx.fillText("1′", c.width - 12 - bar / 2 - 6, c.height - 22);
      }
    }
    if (this.res.schematic) {
      ctx.fillStyle = "#ff5050"; ctx.font = "bold 13px monospace";
      ctx.fillText("SCHEMATIC — NOT REAL DATA", 8, 18);
    }
    if (this.blinking) {
      ctx.fillStyle = "#ffd400"; ctx.font = "bold 14px monospace";
      ctx.fillText(this.pos === 0 ? "A" : "B", c.width - 22, 20);
    }

    const n = this.res.frames.length;
    const lam = f.wavelength ? ` · λ ${(+f.wavelength).toFixed(f.wavelength < 2 && f.label ? 2 : 3)} µm` : "";
    const head = this.override ? "DIFFERENCE · " : this.blinking ? "BLINK · " : "";
    if (this.hud && this.hudLabel) this.hud.textContent = this.hudLabel;
    else if (this.hud) this.hud.textContent = f.label
      ? `${head}${f.label} · ${f.date || ""}${lam}`
      : `${head}FRAME ${this.i + 1} / ${n} · ${f.date || ""}${lam}`;
    if (this.info) this._info(f);
    if (this.dots) $$("button", this.dots).forEach((b, k) => {
      b.classList.toggle("on", k === this.i);
      b.classList.toggle("in-seq", this.blinking && this.seq.includes(k));
      // keep the current frame visible in a one-line strip, without moving the page
      if (k === this.i && this.dots.scrollHeight > this.dots.clientHeight) {
        const t = b.offsetTop, h = this.dots.clientHeight;
        if (t < this.dots.scrollTop || t + b.offsetHeight > this.dots.scrollTop + h) this.dots.scrollTop = t - 4;
      }
    });
    this.onChange(this.i);
  }

  _info(f) {
    const pct = v => v == null ? "—" : `${(v * 100).toFixed(1)} %`;
    this.info.innerHTML =
      (f.label ? `<tr><th>Image</th><td>${f.label}</td></tr>` :
      `<tr><th>Frame</th><td>${f.index + 1} (visit ${f.visit ?? "—"})</td></tr>`) +
      `<tr><th>Date (UTC)</th><td>${f.date || "—"}</td></tr>` +
      `<tr><th>MJD</th><td>${f.mjd ?? "—"}</td></tr>` +
      `<tr><th>Wavelength at target</th><td>${f.wavelength ? f.wavelength.toFixed(4) + " µm" : "—"}</td></tr>` +
      `<tr><th>Days since previous</th><td>${f.gapDays ?? "—"}</td></tr>` +
      `<tr><th>Patch covered</th><td>${pct(f.coverage)}</td></tr>` +
      `<tr><th>Flagged pixels</th><td>${pct(f.flagged)}</td></tr>` +
      `<tr><th>Missing pixels</th><td>${pct(f.missing)}</td></tr>`;
  }

  _buildDots() {
    if (!this.dots) return;
    this.dots.innerHTML = "";
    this.res.frames.forEach((f, k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.short || k + 1;
      b.title = `${f.date || ""}${f.wavelength ? " · λ " + f.wavelength.toFixed(3) + " µm" : ""}`;
      b.addEventListener("click", () => { this.stop(); this.all(); this.go(k); });
      this.dots.appendChild(b);
    });
  }

  /* ---------- stepping & playing ---------- */
  go(k) {                                  // absolute frame index
    if (!this.res) return;
    const at = this.seq.indexOf(k);
    if (at === -1) { this.all(); this.pos = k; } else this.pos = at;
    this.render();
  }
  step(d) {
    if (!this.seq.length) return;
    this.pos = (this.pos + d + this.seq.length) % this.seq.length;
    this.render();
  }
  next() { this.step(1); }
  prev() { this.step(-1); }

  play() {
    if (!this.res || this.timer) return;
    this.timer = setInterval(() => this.next(), 1000 / this.fps);
    if (this.playBtn) this.playBtn.textContent = "❚❚ Pause";
    if (this.onPlayState) this.onPlayState(true);
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.playBtn) this.playBtn.textContent = "▶ Auto play";
    if (this.onPlayState) this.onPlayState(false);
  }
  toggle() { this.timer ? this.stop() : this.play(); }
  setFps(f) {
    this.fps = Math.max(0.25, Math.min(30, +f || 2));
    if (this.timer) { this.stop(); this.play(); }
  }
}
