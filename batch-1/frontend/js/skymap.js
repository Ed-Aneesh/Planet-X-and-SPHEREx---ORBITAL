/* =====================================================================
   skymap.js — a whole-sky chart (no internet needed), drawn as SVG.

   ASTRONOMY:
   - Projection: plate carrée (RA across, Dec up). Like a real sky chart,
     RA INCREASES TO THE LEFT: we look UP at the sky, so east is on the
     left (a ground map seen from above has east on the right).
   - The Milky Way band is the GALACTIC PLANE (galactic latitude b = 0),
     converted to RA/Dec (J2000) with the standard IAU constants:
       north galactic pole  α = 192.85948°, δ = +27.12825°
       galactic longitude of the north celestial pole  l = 122.93192°
     The band is drawn wider near the galactic centre (l = 0, in
     Sagittarius), where the Milky Way really is brightest.
   - Background dots are decorative, not a star catalogue.
   ===================================================================== */

class SkyMap {
  constructor(el, { onPick, onSelect, crosshair = false } = {}) {
    this.el = el;
    this.onPick = onPick;
    this.onSelect = onSelect;
    this.crosshair = crosshair;
    this.W = 1000; this.H = 500;
    this.targets = [];
    this.selected = null;
    this.cross = null;
    this._draw();
  }

  /* ---------- coordinates ---------- */
  x(ra) { return this.W * (1 - ra / 360); }
  y(dec) { return this.H * (90 - dec) / 180; }
  toSky(px, py) { return { ra: ((1 - px / this.W) * 360 + 360) % 360, dec: 90 - (py / this.H) * 180 }; }

  static galToEq(l, b) {
    const r = Math.PI / 180;
    const aN = 192.85948 * r, dN = 27.12825 * r, lN = 122.93192 * r;
    l *= r; b *= r;
    const sd = Math.sin(b) * Math.sin(dN) + Math.cos(b) * Math.cos(dN) * Math.cos(lN - l);
    const dec = Math.asin(sd);
    const ra = aN + Math.atan2(Math.cos(b) * Math.sin(lN - l),
                              Math.sin(b) * Math.cos(dN) - Math.cos(b) * Math.sin(dN) * Math.cos(lN - l));
    return { ra: ((ra / r) % 360 + 360) % 360, dec: dec / r };
  }

  /* polyline points along galactic latitude b, split where RA wraps 0/360 */
  _bandPaths(b) {
    const segs = []; let cur = []; let prev = null;
    for (let l = 0; l <= 360; l += 2) {
      const p = SkyMap.galToEq(l, b);
      if (prev && Math.abs(p.ra - prev.ra) > 180) { segs.push(cur); cur = []; }
      cur.push(`${this.x(p.ra).toFixed(1)},${this.y(p.dec).toFixed(1)}`);
      prev = p;
    }
    segs.push(cur);
    return segs.filter(s => s.length > 1).map(s => "M" + s.join(" L"));
  }

  _draw() {
    const W = this.W, H = this.H, ns = "http://www.w3.org/2000/svg";
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const parts = [];
    parts.push(`<defs><filter id="mwblur" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="9"/></filter></defs>`);
    parts.push(`<rect width="${W}" height="${H}" class="sm-bg"/>`);
    // grid: Dec every 30°, RA every 2 h
    for (let d = -60; d <= 60; d += 30)
      parts.push(`<line class="sm-grid ${d === 0 ? "sm-eq" : ""}" x1="0" x2="${W}" y1="${this.y(d)}" y2="${this.y(d)}"/>` +
                 `<text class="sm-lab" x="8" y="${this.y(d) - 6}">${d > 0 ? "+" : ""}${d}°</text>`);
    for (let h = 2; h < 24; h += 2)
      parts.push(`<line class="sm-grid" y1="0" y2="${H}" x1="${this.x(h * 15)}" x2="${this.x(h * 15)}"/>` +
                 `<text class="sm-lab" x="${this.x(h * 15) + 5}" y="${H - 8}">${h}h</text>`);
    // Milky Way: soft wide band + core
    for (const d of this._bandPaths(0)) parts.push(`<path class="sm-mw" d="${d}" filter="url(#mwblur)"/>`);
    for (const d of this._bandPaths(0)) parts.push(`<path class="sm-mw-core" d="${d}"/>`);
    // decorative stars, denser near the galactic plane
    for (let i = 0; i < 520; i++) {
      let p;
      if (i < 260) { const g = (rnd() + rnd() + rnd() - 1.5) * 14; p = SkyMap.galToEq(rnd() * 360, g); }
      else p = { ra: rnd() * 360, dec: Math.asin(2 * rnd() - 1) * 180 / Math.PI };   // uniform on the sphere
      parts.push(`<circle class="sm-star" cx="${this.x(p.ra).toFixed(1)}" cy="${this.y(p.dec).toFixed(1)}" r="${(0.5 + rnd() * 1.1).toFixed(2)}" opacity="${(0.25 + rnd() * 0.6).toFixed(2)}"/>`);
    }
    parts.push(`<g class="sm-targets"></g><g class="sm-cross"></g>`);
    this.el.innerHTML = `<svg xmlns="${ns}" viewBox="0 0 ${W} ${H}" class="skymap-svg" role="img" aria-label="Whole-sky chart">${parts.join("")}</svg>`;
    this.svg = this.el.querySelector("svg");
    this.gT = this.svg.querySelector(".sm-targets");
    this.gX = this.svg.querySelector(".sm-cross");

    this.svg.addEventListener("click", e => {
      const dot = e.target.closest("[data-id]");
      if (dot && this.onSelect) { this.onSelect(dot.dataset.id); return; }
      if (!this.onPick) return;
      const pt = this.svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(this.svg.getScreenCTM().inverse());
      const s = this.toSky(p.x, p.y);
      this.onPick(s.ra, Math.max(-90, Math.min(90, s.dec)));
    });
  }

  static colour(t) {
    const tags = t.tags || [];
    if (tags.includes("deep")) return "sm-c-deep";
    if (tags.includes("asteroid")) return "sm-c-ast";
    return tags.includes("challenge") ? "sm-c-challenge" : tags.includes("moves") ? "sm-c-moves"
         : tags.includes("exploded") ? "sm-c-exploded" : "sm-c-varies";
  }

  setTargets(list) { this.targets = list; this._drawTargets(); }
  select(id) { this.selected = id; this._drawTargets(); }

  _drawTargets() {
    const out = [];
    for (const t of this.targets) {
      const ra = t.raNow ?? t.ra, dec = t.decNow ?? t.dec;
      const x = this.x(ra), y = this.y(dec), on = t.id === this.selected;
      out.push(`<g data-id="${t.id}" class="sm-t ${SkyMap.colour(t)} ${on ? "on" : ""}" tabindex="0">` +
        `<title>${t.name}</title><circle cx="${x}" cy="${y}" r="14" class="sm-hit"/>` +
        (on ? `<circle cx="${x}" cy="${y}" r="13" class="sm-ring"/>` : "") +
        `<circle cx="${x}" cy="${y}" r="${on ? 6.5 : 5}" class="sm-dot"/>` +
        (on ? `<text x="${x + (x > this.W - 170 ? -20 : 20)}" y="${y - 12}" class="sm-name" text-anchor="${x > this.W - 170 ? "end" : "start"}">${t.name}</text>` : "") +
        `</g>`);
    }
    this.gT.innerHTML = out.join("");
  }

  setCross(ra, dec) {
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) { this.gX.innerHTML = ""; return; }
    const x = this.x(ra), y = this.y(dec);
    this.gX.innerHTML = `<circle cx="${x}" cy="${y}" r="16" class="sm-xring"/>` +
      `<path class="sm-xline" d="M${x - 30} ${y} H${x - 8} M${x + 8} ${y} H${x + 30} M${x} ${y - 30} V${y - 8} M${x} ${y + 8} V${y + 30}"/>` +
      `<circle cx="${x}" cy="${y}" r="3" class="sm-xdot"/>`;
  }
}
