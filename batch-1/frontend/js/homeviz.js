/* =====================================================================
   homeviz.js — home-page visuals:
     doorVault()   mini whole-sky plot of the 19 targets (real positions)
     doorProbe()   radar-style header for the Sky Probe card
     BlinkDemo     "Try it — hover the sky" simulator (NOT SPHEREx data)
     Carousel      revolving 3-D target cards + detail panel with fun facts
   Motion is gentle and switches off for prefers-reduced-motion.
   ===================================================================== */

const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const TAGS = {
  moves:    { label: "Moves",    cls: "tg-moves" },
  pulses:   { label: "Pulses",   cls: "tg-pulses" },
  dims:     { label: "Dims",     cls: "tg-dims" },
  flares:   { label: "Flares",   cls: "tg-flares" },
  exploded: { label: "Exploded", cls: "tg-exploded" }
};
const tagOf = t => (window.FACTS[t.id] || {}).tag || (t.tags.includes("moves") ? "moves" : "pulses");

/* ---------- door headers ---------- */
function doorVault(el, targets) {
  const W = 800, H = 200;
  const dots = targets.map(t => {
    const x = W * (1 - t.ra / 360), y = H * (90 - t.dec) / 180;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" class="dv-dot ${TAGS[tagOf(t)].cls}"><title>${t.name}</title></circle>`;
  }).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><filter id="dvglow"><feGaussianBlur stdDeviation="3"/></filter></defs>
      <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="dv-eq"/>
      <g filter="url(#dvglow)" opacity=".7">${dots}</g><g>${dots}</g></svg>
    <span class="door-cap mono">${targets.length} objects · real sky positions</span>`;
}

function doorProbe(el) {
  el.innerHTML = `<svg viewBox="0 0 800 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g transform="translate(400 30)">
        <circle r="60" class="pr-ring"/><circle r="120" class="pr-ring"/><circle r="190" class="pr-ring dash"/>
        <g class="pr-sweep"><path d="M0 0 L0 -260 A260 260 0 0 1 120 -230 Z" class="pr-wedge"/></g>
        <circle cx="-105" cy="55" r="4" class="pr-blip"/><circle cx="70" cy="110" r="3" class="pr-blip"/>
      </g>
      <line x1="0" x2="800" y1="30" y2="30" class="pr-cross"/><line x1="400" x2="400" y1="0" y2="200" class="pr-cross"/>
    </svg><span class="door-cap mono probe-cap" id="probe-cap">RA 016.115° · Dec +32.919°</span>`;
  if (REDUCED) return;
  const cap = el.querySelector("#probe-cap");
  setInterval(() => {                       // a new random sky position, uniform on the sphere
    const ra = Math.random() * 360, dec = Math.asin(2 * Math.random() - 1) * 180 / Math.PI;
    cap.textContent = `RA ${ra.toFixed(3).padStart(7, "0")}° · Dec ${dec >= 0 ? "+" : "−"}${Math.abs(dec).toFixed(3).padStart(6, "0")}°`;
  }, 2600);
}

/* ---------- "Try it — hover the sky" simulator ---------- */
class BlinkDemo {
  constructor({ canvas, hud, dots, playBtn, trail, probe }) {
    Object.assign(this, { canvas, hud, dotsEl: dots, playBtn, trailBox: trail, probe });
    this.ctx = canvas.getContext("2d");
    this.W = 96; this.H = 60; this.n = 6; this.i = 3; this.timer = null;
    this.dates = ["2025-05", "2025-11", "2026-05", "2026-11", "2027-05", "2027-11"];
    let seed = 42; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.stars = Array.from({ length: 70 }, () => ({ x: rnd() * this.W, y: rnd() * this.H, f: 0.25 + rnd() ** 3 * 1.6 }));
    this.noise = Array.from({ length: this.n }, () => Float32Array.from({ length: this.W * this.H }, () => rnd()));
    this.mover = v => ({ x: 30 + v * 5.5, y: 22 + v * 2.2 });           // a nearby star walking across
    this.pulser = v => 0.35 + 0.9 * (0.5 + 0.5 * Math.sin(v * 1.9));   // a variable star
    this.hover = null;
    this.dotsEl.innerHTML = this.dates.map((_, k) => `<button type="button" aria-label="Visit ${k + 1}"></button>`).join("");
    this.dotsEl.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { this.stop(); this.go([...this.dotsEl.children].indexOf(b)); } });
    canvas.addEventListener("mousemove", e => this._hover(e));
    canvas.addEventListener("mouseleave", () => { this.hover = null; this.probe.textContent = this.probe.dataset.idle; this.draw(); });
    this.trailBox.addEventListener("change", () => this.draw());
    this.draw();
    if (!REDUCED) this.play();
  }
  pixel(v, x, y) {
    let s = 0.05 + 0.06 * this.noise[v][y * this.W + x];
    const add = (sx, sy, f) => { const d2 = (x + .5 - sx) ** 2 + (y + .5 - sy) ** 2; s += f * Math.exp(-d2 / 1.1); };
    for (const st of this.stars) add(st.x, st.y, st.f);
    const m = this.mover(v); add(m.x, m.y, 1.5);
    add(72, 40, this.pulser(v));
    return Math.min(1, s);
  }
  colour(s) {                                   // navy -> blue -> white, like the screenshot
    const r = Math.round(20 + 235 * Math.max(0, s - .55) / .45), g = Math.round(28 + 227 * Math.max(0, s - .4) / .6),
          b = Math.round(70 + 185 * Math.min(1, s / .55));
    return `rgb(${r},${g},${b})`;
  }
  draw() {
    const c = this.canvas, ctx = this.ctx, px = c.width / this.W, v = this.i;
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      ctx.fillStyle = this.colour(this.pixel(v, x, y)); ctx.fillRect(x * px, y * px, Math.ceil(px), Math.ceil(px));
    }
    if (this.trailBox.checked) {                // motion trail: where the mover was on earlier visits
      ctx.strokeStyle = "rgba(163,240,198,.9)"; ctx.setLineDash([4, 5]); ctx.lineWidth = 2; ctx.beginPath();
      for (let k = 0; k <= v; k++) { const m = this.mover(k); k ? ctx.lineTo(m.x * px, m.y * px) : ctx.moveTo(m.x * px, m.y * px); }
      ctx.stroke(); ctx.setLineDash([]);
      for (let k = 0; k < v; k++) { const m = this.mover(k); ctx.fillStyle = "rgba(163,240,198,.55)"; ctx.beginPath(); ctx.arc(m.x * px, m.y * px, 3, 0, 7); ctx.fill(); }
    }
    if (this.hover) {
      ctx.strokeStyle = "#a3f0c6"; ctx.lineWidth = 2;
      ctx.strokeRect(this.hover.x * px - px * 2, this.hover.y * px - px * 2, px * 5, px * 5);
    }
    this.hud.textContent = `VISIT ${v + 1} / ${this.n} · ${this.dates[v]} (sim.)`;
    [...this.dotsEl.children].forEach((b, k) => b.classList.toggle("on", k === v));
  }
  _hover(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * this.W), y = Math.floor((e.clientY - r.top) / r.height * this.H);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    this.hover = { x, y };
    const m = this.mover(this.i), what = Math.hypot(x + .5 - m.x, y + .5 - m.y) < 2.5 ? "the moving star"
      : Math.hypot(x + .5 - 72, y + .5 - 40) < 2.5 ? "the pulsing star" : null;
    this.probe.textContent = `pixel (${x}, ${y}) · brightness ${(this.pixel(this.i, x, y) * 100).toFixed(0)} %` +
      (what ? ` · ${what}` : "") + ` · 1 pixel ≈ 6.15″`;
    this.draw();
  }
  go(k) { this.i = (k + this.n) % this.n; this.draw(); }
  play() { if (this.timer) return; this.timer = setInterval(() => this.go(this.i + 1), 900); this.playBtn.innerHTML = "❚❚ Pause"; }
  stop() { clearInterval(this.timer); this.timer = null; this.playBtn.innerHTML = "▶ Play"; }
  toggle() { this.timer ? this.stop() : this.play(); }
}

/* ---------- revolving target carousel (a drum, like the reference) ----------
   Cards sit on a drum 60° apart: the front card faces you, its neighbours
   turn steeply away at ±60°, the rest are hidden behind. θ shows the true
   angle of the selected target around the full 19-card ring. */
class Carousel {
  constructor({ stage, ring, angle, autoBtn, jump, detail, targets }) {
    Object.assign(this, { stage, ring, angleEl: angle, autoBtn, jumpEl: jump, detail, targets });
    this.n = targets.length; this.i = 0; this.timer = null;
    this.face = 60;                                        // degrees between neighbouring faces
    this.cardW = 300;
    this.radius = Math.round((this.cardW / 2) / Math.tan((this.face / 2) * Math.PI / 180));   // 260 px
    ring.innerHTML = targets.map((t, k) => this._card(t, k)).join("");
    this.cards = [...ring.children];
    this.cards.forEach((c, k) => c.addEventListener("click", () => { this.stopAuto(); this.go(k); }));
    const challenge = targets.map((t, k) => [t, k]).filter(([t]) => t.tags.includes("challenge"));
    jump.innerHTML = `<span class="mono">Direct jump</span>` +
      challenge.map(([t, k]) => `<button type="button" class="jbtn" data-k="${k}">${t.name.split(/[ ’']/)[0]}</button>`).join("") +
      `<select class="jsel" aria-label="Jump to any target">${targets.map((t, k) => `<option value="${k}">${String(t.n).padStart(2, "0")} · ${t.name}</option>`).join("")}</select>`;
    jump.addEventListener("click", e => { const b = e.target.closest(".jbtn"); if (b) { this.stopAuto(); this.go(+b.dataset.k); } });
    jump.querySelector(".jsel").addEventListener("change", e => { this.stopAuto(); this.go(+e.target.value); });
    stage.addEventListener("keydown", e => {
      if (e.key === "ArrowRight") { this.stopAuto(); this.next(); }
      if (e.key === "ArrowLeft") { this.stopAuto(); this.prev(); }
    });
    this.go(0);
  }
  _art(t) {
    const f = window.FACTS[t.id] || {}, tag = tagOf(t);
    if (f.image) {
      // ours: a figure made from SPHEREx + WISE data (python main.py --figure); if it is missing, fall back to the drawn art
      const fallback = this._drawn(t, tag).replace(/"/g, "&quot;");
      return `<div class="c-art photo"><img src="${f.image}" alt="${t.name} (${f.ours ? "SPHEREx and WISE data" : "image from another telescope"})" ` +
             `loading="lazy" decoding="async" onerror="this.parentNode.outerHTML='${fallback.replace(/'/g, "\\'")}'">` +
             `<span class="not-sx mono">${f.ours ? "SPHEREx + WISE" : "Not SPHEREx"}</span></div>`;
    }
    return this._drawn(t, tag);
  }
  _drawn(t, tag) {
    const trail = tag === "moves" ? `<span class="art-trail"></span>` : "";
    const rings = tag === "pulses" ? `<span class="art-ring r1"></span><span class="art-ring r2"></span>` : "";
    const rays = tag === "exploded" ? `<span class="art-rays"></span>` : "";
    const spikes = tag === "flares" ? `<span class="art-spikes"></span>` : "";
    const veil = tag === "dims" ? `<span class="art-veil"></span>` : "";
    return `<div class="c-art ${TAGS[tag].cls}">${trail}${rings}${rays}${spikes}<span class="art-star"></span>${veil}</div>`;
  }
  _card(t, k) {
    const f = window.FACTS[t.id] || {}, tag = tagOf(t);
    return `<button type="button" class="c-card" aria-label="${t.name}">
      <span class="c-top"><span class="pill ${TAGS[tag].cls}">${TAGS[tag].label}</span><span class="mono c-num">${String(t.n).padStart(2, "0")}</span></span>
      ${this._art(t)}
      <b>${t.name}</b><span class="c-sub">${f.subtitle || t.kind}</span></button>`;
  }
  go(k) {
    const prev = this.i;
    this.i = (k + this.n) % this.n;
    this.cards.forEach((c, j) => {
      let off = j - this.i;                                // shortest way round the ring
      if (off > this.n / 2) off -= this.n;
      if (off < -this.n / 2) off += this.n;
      const vis = Math.abs(off) <= 1;
      let prevOff = j - prev; if (prevOff > this.n / 2) prevOff -= this.n; if (prevOff < -this.n / 2) prevOff += this.n;
      // cards that wrap from one hidden side to the other must not sweep across the front
      c.style.transition = Math.abs(off - prevOff) > 2 ? "none" : "";
      const ang = Math.max(-2, Math.min(2, off)) * this.face;
      c.style.transform = `rotateY(${ang}deg) translateZ(${this.radius}px)`;
      c.style.opacity = off === 0 ? 1 : vis ? .55 : 0;
      c.style.pointerEvents = vis ? "auto" : "none";
      c.tabIndex = off === 0 ? 0 : -1;
      c.classList.toggle("front", off === 0);
    });
    this.angleEl.textContent = `${Math.round(this.i * 360 / this.n)}°`;
    this.jumpEl.querySelectorAll(".jbtn").forEach(b => b.classList.toggle("on", +b.dataset.k === this.i));
    this.jumpEl.querySelector(".jsel").value = this.i;
    this._detail(this.targets[this.i]);
  }
  _detail(t) {
    const f = window.FACTS[t.id] || {}, tag = tagOf(t);
    const sexRA = deg => { const h = deg / 15, hh = Math.floor(h), m = (h - hh) * 60, mm = Math.floor(m), s = (m - mm) * 60;
      return `${hh}h ${String(mm).padStart(2, "0")}m ${s.toFixed(1).padStart(4, "0")}s`; };
    const sexDec = deg => { const sg = deg < 0 ? "−" : "+", a = Math.abs(deg), d = Math.floor(a), m = (a - d) * 60, mm = Math.floor(m), s = Math.round((m - mm) * 60);
      return `${sg}${String(d).padStart(2, "0")}° ${String(mm).padStart(2, "0")}′ ${String(s).padStart(2, "0")}″`; };
    const ep = t.epoch && t.epoch !== 2000 ? `ICRS, epoch ${t.epoch}` : "J2000";
    const credit = f.credit ? `<p class="d-credit">Picture: ${f.creditUrl ? `<a href="${f.creditUrl}" target="_blank" rel="noopener">${f.credit}</a>` : f.credit}${f.ours ? "" : " · not SPHEREx data"}</p>` : "";
    this.detail.innerHTML = `
      <div class="d-top"><span class="pill ${TAGS[tag].cls}">${TAGS[tag].label}</span><span class="mono muted">Target ${String(t.n).padStart(2, "0")} / ${String(this.n).padStart(2, "0")}</span></div>
      <h3>${t.name}</h3><p class="d-sub">${f.subtitle || t.kind}</p>
      <div class="d-grid">
        <div><span class="mono">RA (${ep})</span><b>${sexRA(t.ra)}</b></div>
        <div><span class="mono">Dec (${ep})</span><b>${sexDec(t.dec)}</b></div>
        <div><span class="mono">Distance</span><b>${f.distance || "—"}</b></div>
        <div><span class="mono">Proper motion</span><b>${f.properMotion || "—"}</b></div>
      </div>
      <p class="d-why">${t.why}</p>
      ${f.facts ? `<div class="d-facts"><span class="mono">Fun facts</span><ul>${f.facts.map(x => `<li>${x}</li>`).join("")}</ul>
        ${f.source ? `<a class="d-src" href="${f.source}" target="_blank" rel="noopener">Source ↗</a>` : ""}</div>` : ""}
      ${credit}
      <div class="d-go"><a class="btn go-btn" href="vault.html?target=${encodeURIComponent(t.id)}" data-choose="${t.id}">Open in explorer ↗</a>
        <span class="mono muted">${t.ra.toFixed(3)}°, ${t.dec >= 0 ? "+" : ""}${t.dec.toFixed(3)}°</span></div>`;
  }
  next() { this.go(this.i + 1); }
  prev() { this.go(this.i - 1); }
  auto() {
    if (this.timer) return this.stopAuto();
    this.timer = setInterval(() => this.next(), 4500); this.autoBtn.classList.add("on");
  }
  stopAuto() { clearInterval(this.timer); this.timer = null; this.autoBtn.classList.remove("on"); }
}


/* ---------- "Open in explorer": choose Star Vault or Sky Probe ---------- */
(function () {
  let box = null;
  function close() { if (box) box.hidden = true; document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  function open(id) {
    const t = (window.TARGETS || []).find(x => x.id === id) || { id, name: id };
    const pm = Math.hypot(t.pmEast || 0, t.pmNorth || 0) / 1000;
    if (!box) {
      box = document.createElement("div"); box.className = "choose-modal"; box.hidden = true;
      box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      box.addEventListener("click", e => { if (e.target === box || e.target.closest(".ch-x")) close(); });
      document.body.appendChild(box);
    }
    const q = encodeURIComponent(id);
    box.innerHTML = `<div class="ch-card">
      <button type="button" class="ch-x" aria-label="Close">✕</button>
      <span class="mono muted">OPEN ${String(t.name).toUpperCase()} IN…</span>
      <div class="ch-opts">
        <a class="ch-opt" href="vault.html?target=${q}">
          <b>✦ Star Vault</b><em>Instant · no IRSA needed</em>
          <p>Plays the team's saved copy of the NASA/IPAC IRSA files. Built as a safety net, so the demo never depends on
             IRSA's servers being fast or up — just in case.</p>
          <ul class="ch-cons">
            <li>Frozen copy: the newest weekly SPHEREx images are not in it.</li>
            <li>Only about 3′ of sky around the target and the bands we saved.</li>
            ${pm > 1 ? `<li>${t.name} moves ${pm.toFixed(1)}″/yr: its 1999 and 2010 positions fall off this small patch, so the long-baseline blink and Measure need the Sky Probe.</li>` : `<li>Tools that need several visits or a wider patch point you to the Sky Probe.</li>`}
          </ul>
        </a>
        <a class="ch-opt" href="probe.html?target=${q}">
          <b>⌖ Sky Probe</b><em>Live from NASA's archive</em>
          <p>Searches IRSA now: every SPHEREx image of this position, any radius, older 2MASS/WISE images, known asteroids
             and the Measure tool.</p>
          <ul class="ch-pros">
            <li>Newest data, wider patch${pm > 1 ? " (radius set for the star's motion)" : ""}.</li>
            <li class="con">Needs IRSA to answer: a search takes ~10 s to 2 min; if IRSA is down, use the Star Vault.</li>
          </ul>
        </a>
        <a class="ch-opt" href="lab.html?target=${q}">
          <b>⚗ Science Lab</b><em>Measure it, with errors</em>
          <p>Brightness in every SPHEREx image, spectrum (SED), light curve and period search, Gaia distance and motion —
             each number with its error budget.</p>
          <ul class="ch-pros">
            <li>Real measurements you can download (CSV/JSON).</li>
            <li class="con">Live from IRSA too: the first run takes a few minutes.</li>
          </ul>
        </a>
      </div></div>`;
    box.hidden = false; document.addEventListener("keydown", onKey);
    box.querySelector(".ch-opt").focus();
  }
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-choose]"); if (!a) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;     // let people open the Vault in a new tab
    e.preventDefault(); open(a.dataset.choose);
  });
})();
