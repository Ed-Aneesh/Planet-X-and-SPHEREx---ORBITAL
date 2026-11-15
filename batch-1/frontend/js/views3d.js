/* =====================================================================
   views3d.js — the rotatable 3D views and the planetarium of the desktop
   tool (cube3d.py, surface3d.py, targets3d.py, planetarium.py), drawn on a
   plain <canvas>. Drag to rotate (or pan the sky); wheel to zoom.
   ===================================================================== */

/* Minimal 3D scene: lines, points and labels, painted far-to-near. */
class Scene3D {
  constructor(canvas, build) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.build = build;
    this.yaw = -0.6; this.pitch = 0.5; this.zoom = 1; this.span = 1;
    let drag = null;
    canvas.addEventListener("pointerdown", e => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", e => {
      if (!drag) return;
      this.yaw += (e.clientX - drag[0]) * 0.01;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (e.clientY - drag[1]) * 0.01));
      drag = [e.clientX, e.clientY]; this.render();
    });
    canvas.addEventListener("pointerup", () => drag = null);
    canvas.addEventListener("wheel", e => { e.preventDefault(); this.zoom *= e.deltaY > 0 ? 0.9 : 1.1; this.render(); }, { passive: false });
  }
  /* world: x right(east on the sky is shown LEFT by the callers), y depth, z up */
  p(x, y, z) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
    const y2 = y1 * cp - z * sp, z2 = y1 * sp + z * cp;
    const f = Math.min(this.c.width, this.c.height) * 0.42 * this.zoom / this.span;
    const persp = 1 / (1 + y2 / (this.span * 6));
    return [this.c.width / 2 + x1 * f * persp, this.c.height / 2 - z2 * f * persp, y2];
  }
  render() {
    const ctx = this.ctx, items = [];
    ctx.fillStyle = "#05080f"; ctx.fillRect(0, 0, this.c.width, this.c.height);
    this.build({
      line: (a, b, colour, w = 1) => { const A = this.p(...a), B = this.p(...b); items.push([(A[2] + B[2]) / 2, () => {
        ctx.strokeStyle = colour; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); }]); },
      dot: (a, r, colour) => { const A = this.p(...a); items.push([A[2], () => {
        ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(A[0], A[1], r, 0, 7); ctx.fill(); }]); },
      text: (a, s, colour = "#cdd", size = 11) => { const A = this.p(...a); items.push([A[2] - 1e6, () => {
        ctx.fillStyle = colour; ctx.font = `${size}px monospace`; ctx.fillText(s, A[0] + 4, A[1] - 4); }]); },
    });
    items.sort((a, b) => b[0] - a[0]).forEach(([, draw]) => draw());
  }
}

/* inferno-like colour 0..1 */
function heat(v) {
  const stops = [[0, [0, 0, 4]], [0.25, [87, 16, 110]], [0.5, [188, 55, 84]], [0.75, [249, 142, 9]], [1, [252, 255, 164]]];
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [p0, c0] = stops[i - 1], [p1, c1] = stops[i], f = (v - p0) / (p1 - p0);
    return `rgb(${c0.map((c, k) => Math.round(c + f * (c1[k] - c))).join(",")})`;
  }
  return "rgb(252,255,164)";
}

const Views3D = {
  canvas(F, panel, w = 640, h = 460) {
    const c = F.canvas(w, h); c.classList.add("scene3d"); panel.appendChild(c);
    F.html(panel, `<p class="muted">Drag to rotate · mouse wheel to zoom</p>`);
    return c;
  },

  /* cube3d.py: exposures sorted by wavelength = layers; bright pixels as points */
  cube(F, panel, res, fx) {
    F.explain(panel, "<b>Spectral cube</b>: each exposure sees the target at a different wavelength, so sorting them by " +
      "wavelength stacks them into a cube (sky position × wavelength). Points are pixels above 5× the noise; height is " +
      "wavelength. Layers come from different dates, so changes over time are mixed in.");
    const cb = fx.cube;
    if (!F.needs(panel, cb && cb.points.length, "A cube needs at least two exposures with a known wavelength and pixels above 5× noise.")) return;
    const h = cb.halfArcmin, w0 = cb.waves[0], w1 = cb.waves[cb.waves.length - 1], dz = (w1 - w0) || 1;
    const Z = k => -h + 2 * h * (cb.waves[k] - w0) / dz;
    const smax = Math.log10(Math.max(...cb.points.map(p => p[3])));
    const c = this.canvas(F, panel);
    const sc = new Scene3D(c, s => {
      const box = [[-h, -h], [h, -h], [h, h], [-h, h]];
      box.forEach((a, i) => { const b = box[(i + 1) % 4];
        s.line([a[0], a[1], -h], [b[0], b[1], -h], "#3a4660"); s.line([a[0], a[1], h], [b[0], b[1], h], "#3a4660");
        s.line([a[0], a[1], -h], [a[0], a[1], h], "#26304a"); });
      s.text([h, -h, -h], "E ←", "#9ab"); s.text([-h, h, -h], "N", "#9ab");
      s.text([-h, -h, -h], `${w0.toFixed(3)} µm`, "#ffb000"); s.text([-h, -h, h], `${w1.toFixed(3)} µm`, "#ffb000");
      cb.points.forEach(([e, n, k, snr]) => {
        const v = Math.log10(snr) / smax;
        s.dot([-e, n, Z(k)], 1.2 + 2.5 * v, heat(0.25 + 0.75 * v));
      });
    });
    sc.span = h; sc.render();
    /* layer slider: the exposures sorted by wavelength */
    const layers = res.frames.filter(f => f.wavelength).sort((a, b) => a.wavelength - b.wavelength);
    if (layers.length > 1) {
      const wrap = F.html(panel, `<div class="cube-layer"><input type="range" min="0" max="${layers.length - 1}" value="0" aria-label="Layer"><span class="mono"></span></div>`);
      const cv = F.canvas(260); wrap.prepend(cv);
      const [range, lab] = [$("input", wrap), $("span", wrap)];
      const show = async () => { const f = layers[+range.value];
        F.draw(cv.getContext("2d"), await F.img(f.png), cv.width, cv.height);
        lab.textContent = `layer ${+range.value + 1}: ${f.wavelength.toFixed(3)} µm, taken ${f.date}`; };
      range.oninput = show; show();
    }
  },

  /* surface3d.py: brightness as height */
  landscape(F, panel, res, fx) {
    F.explain(panel, "<b>Brightness landscape</b>: the median of all exposures drawn as a surface. Height is BRIGHTNESS " +
      "(stretched), not distance: stars become peaks you can walk around.");
    const L = fx.landscape;
    if (!F.needs(panel, L && L.side > 1, "No landscape in this result.")) return;
    const n = L.side, h = L.halfArcmin, step = Math.max(1, Math.round(n / 70));
    const X = i => h - (i + 0.5) * 2 * h / n, Y = j => -h + (j + 0.5) * 2 * h / n, z = (i, j) => L.z[j * n + i] * h * 0.8;
    const c = this.canvas(F, panel);
    const sc = new Scene3D(c, s => {
      for (let j = 0; j < n; j += step) for (let i = 0; i + step < n; i += step) {
        const a = z(i, j), b = z(i + step, j);
        s.line([-X(i), Y(j), a], [-X(i + step), Y(j), b], heat((a + b) / (1.6 * h)), 1);
      }
      for (let i = 0; i < n; i += step) for (let j = 0; j + step < n; j += step) {
        const a = z(i, j), b = z(i, j + step);
        s.line([-X(i), Y(j), a], [-X(i), Y(j + step), b], heat((a + b) / (1.6 * h)), 1);
      }
      s.text([h, -h, 0], "E ←", "#9ab"); s.text([-h, h, 0], "N", "#9ab");
    });
    sc.span = h; sc.pitch = 0.7; sc.render();
    F.html(panel, `<p class="muted">Median of ${L.count} exposures, band ${res.query.band}.</p>`);
  },

  /* targets3d.py: where the targets are in space, log distance */
  async space(F, panel, res) {
    F.explain(panel, "Where the targets are in space, with Earth at the centre. Direction comes from RA and Dec; " +
      "<b>distance comes from published catalogues</b> (Gaia parallaxes for stars, redshift for the quasar and blazar), " +
      "not from SPHEREx: a telescope image records direction only. Distances span a factor of about 500 million, so the " +
      "distance axis is <b>logarithmic</b>: each ring is 1000× farther than the one inside it.");
    const list = (await API.targets()).filter(t => t.distanceLy);
    const nice = d => d < 1e3 ? `${+d.toPrecision(3)} ly` : d < 1e6 ? `${+(d / 1e3).toPrecision(3)} thousand ly`
      : d < 1e9 ? `${+(d / 1e6).toPrecision(3)} million ly` : `${+(d / 1e9).toPrecision(3)} billion ly`;
    const cur = (res.centre && res.centre.name) || "";
    const vec = (ra, dec, r) => { const a = ra * Math.PI / 180, d = dec * Math.PI / 180;
      return [r * Math.cos(d) * Math.cos(a), r * Math.cos(d) * Math.sin(a), r * Math.sin(d)]; };
    const c = this.canvas(F, panel);
    const sc = new Scene3D(c, s => {
      [[1, "10 ly"], [4, "10 thousand ly"], [7, "10 million ly"], [10, "10 billion ly"]].forEach(([r, lab]) => {
        for (let k = 0; k < 72; k++) {
          const a = k / 72 * 2 * Math.PI, b = (k + 1) / 72 * 2 * Math.PI;
          s.line([r * Math.cos(a), r * Math.sin(a), 0], [r * Math.cos(b), r * Math.sin(b), 0], "#2b3550");
        }
        s.text([r, 0, 0], lab, "#6c7a96", 10);
      });
      s.dot([0, 0, 0], 5, "#2a7fff"); s.text([0, 0, 0.3], "Earth", "#5aa0ff");
      list.forEach(t => {
        const p = vec(t.raNow ?? t.ra, t.decNow ?? t.dec, Math.log10(t.distanceLy));
        const me = t.name === cur;
        s.line([0, 0, 0], p, "#3d4766");
        s.dot(p, me ? 6 : 4, me ? "#e0115f" : "#ffb000");
        s.text(p, `${t.name} · ${nice(t.distanceLy)}`, me ? "#ff7aa8" : "#dde", 10);
      });
    });
    sc.span = 10; sc.render();
    const bar = F.html(panel, `<div class="controls"><button class="btn sm ghost" type="button">Nearby stars</button>` +
      `<button class="btn sm ghost" type="button">Everything</button></div>`);
    const [near, all] = $$("button", bar);
    near.onclick = () => { sc.zoom = 4; sc.render(); };
    all.onclick = () => { sc.zoom = 1; sc.render(); };
    F.html(panel, `<p class="muted">Distances are approximate catalogue values (to verify in SIMBAD).</p>`);
  },

  /* planetarium.py: stereographic chart of the whole sky, drag to look around */
  async planetarium(F, panel, res, fx) {
    F.explain(panel, "The whole sky around Earth as a chart (not a photograph). Lines: the coordinate grid (RA every 2 h, Dec every 30°), " +
      "the <span class='kc-amber'>ecliptic</span> (the plane of Earth's orbit, where planets and most asteroids move), " +
      "the <span class='kc-violet'>Milky Way's plane</span>, SPHEREx's two <span class='kc-cyan'>deep fields</span> " +
      "(near the ecliptic poles, observed every orbit), the named targets, and your patch (pink) with its real SPHEREx image " +
      "when you zoom in. Drag to look around, mouse wheel to zoom. North up, east LEFT, as when you look up at the sky.");
    const D = Math.PI / 180, OBL = 23.4393 * D;
    const M = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
               [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
               [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];   // ICRS -> galactic
    const unit = (ra, dec) => [Math.cos(dec * D) * Math.cos(ra * D), Math.cos(dec * D) * Math.sin(ra * D), Math.sin(dec * D)];
    const ecl = (lon, lat) => { const v = unit(lon, lat), c = Math.cos(OBL), s = Math.sin(OBL);
      return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; };
    const gal = (l, b) => { const g = unit(l, b); return [0, 1, 2].map(j => g[0] * M[0][j] + g[1] * M[1][j] + g[2] * M[2][j]); };
    const radec = v => [((Math.atan2(v[1], v[0]) / D) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, v[2]))) / D];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cent = res.centre || { ra: 0, dec: 0 };
    const st = { ra: cent.ra, dec: cent.dec, scale: 260 };     // scale: pixels per radian at the centre
    const targets = await API.targets();
    const patch = fx.visits && fx.visits.length ? await F.img(fx.visits[fx.visits.length - 1].png) : null;
    const c = F.canvas(700, 480); c.classList.add("scene3d"); panel.appendChild(c);
    const ctx = c.getContext("2d");
    const basis = () => { const f = unit(st.ra, st.dec), e = [-Math.sin(st.ra * D), Math.cos(st.ra * D), 0];
      const n = [f[1] * e[2] - f[2] * e[1], f[2] * e[0] - f[0] * e[2], f[0] * e[1] - f[1] * e[0]]; return [f, e, n]; };
    const proj = (v, B) => { const [f, e, n] = B, z = dot(v, f); if (z < -0.3) return null;
      const k = 2 / (1 + z); return [c.width / 2 - dot(v, e) * k * st.scale, c.height / 2 - dot(v, n) * k * st.scale]; };
    const path = (vs, B, colour, w = 1) => {
      ctx.strokeStyle = colour; ctx.lineWidth = w; ctx.beginPath(); let on = false;
      vs.forEach(v => { const p = proj(v, B);
        if (!p) { on = false; return; } on ? ctx.lineTo(...p) : ctx.moveTo(...p); on = true; });
      ctx.stroke();
    };
    const around = (ra, dec, r) => {      // small circle of angular radius r (deg) round a point
      const [f0, e0, n0] = [unit(ra, dec), [-Math.sin(ra * D), Math.cos(ra * D), 0], null];
      const n1 = [f0[1] * e0[2] - f0[2] * e0[1], f0[2] * e0[0] - f0[0] * e0[2], f0[0] * e0[1] - f0[1] * e0[0]];
      return Array.from({ length: 121 }, (_, k) => { const a = k / 120 * 2 * Math.PI, cr = Math.cos(r * D), sr = Math.sin(r * D);
        return [0, 1, 2].map(i => f0[i] * cr + sr * (Math.cos(a) * e0[i] + Math.sin(a) * n1[i])); });
    };
    const draw = () => {
      const B = basis();
      ctx.fillStyle = "#04060c"; ctx.fillRect(0, 0, c.width, c.height);
      for (let h = 0; h < 24; h += 2) path(Array.from({ length: 91 }, (_, k) => unit(h * 15, -90 + 2 * k)), B, "#1c2740");
      for (let d = -60; d <= 60; d += 30) path(Array.from({ length: 181 }, (_, k) => unit(2 * k, d)), B, d === 0 ? "#2f3d62" : "#1c2740");
      path(Array.from({ length: 181 }, (_, k) => ecl(2 * k, 0)), B, "#ffb000", 1.5);
      path(Array.from({ length: 181 }, (_, k) => gal(2 * k, 0)), B, "#b48cff", 1.5);
      path(around(270, 66.56, 5.64), B, "#39d0ff", 1.5);       // north ecliptic pole deep field
      path(around(90, -66.56, 5.64), B, "#39d0ff", 1.5);       // south ecliptic pole deep field
      ctx.font = "11px monospace";
      for (let h = 0; h < 24; h += 2) { const p = proj(unit(h * 15, 0), B); if (p) { ctx.fillStyle = "#56668a"; ctx.fillText(`${h}h`, p[0] + 3, p[1] - 3); } }
      targets.forEach(t => { const p = proj(unit(t.raNow ?? t.ra, t.decNow ?? t.dec), B); if (!p) return;
        ctx.fillStyle = "#ffd21f"; ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, 7); ctx.fill();
        ctx.fillStyle = "#e8e3c8"; ctx.fillText(t.name, p[0] + 5, p[1] - 5); });
      /* the loaded patch: a square of side 2r, north up, east left */
      const r = (res.query.radiusArcmin || 3) / 60, fc = unit(cent.ra, cent.dec);
      const e0 = [-Math.sin(cent.ra * D), Math.cos(cent.ra * D), 0];
      const n0 = [fc[1] * e0[2] - fc[2] * e0[1], fc[2] * e0[0] - fc[0] * e0[2], fc[0] * e0[1] - fc[1] * e0[0]];
      const corner = (de, dn) => [0, 1, 2].map(i => fc[i] + Math.tan(de * D) * e0[i] + Math.tan(dn * D) * n0[i]);
      const norm = v => { const m = Math.hypot(...v); return v.map(x => x / m); };
      const pts = [[r, r], [-r, r], [-r, -r], [r, -r]].map(([de, dn]) => proj(norm(corner(de, dn)), B));
      if (pts.every(Boolean)) {
        const size = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
        if (patch && size > 24) {           // map the image onto the square: top-left = north-east corner
          const [ne, nw, , se] = pts;
          ctx.save(); ctx.imageSmoothingEnabled = false;
          ctx.setTransform((nw[0] - ne[0]) / patch.width, (nw[1] - ne[1]) / patch.width,
                           (se[0] - ne[0]) / patch.height, (se[1] - ne[1]) / patch.height, ne[0], ne[1]);
          ctx.drawImage(patch, 0, 0); ctx.restore();
        }
        ctx.strokeStyle = "#ff4fa0"; ctx.lineWidth = 2; ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(...p) : ctx.moveTo(...p));
        ctx.closePath(); ctx.stroke();
        if (size <= 24) { const m = pts[0]; ctx.fillStyle = "#ff4fa0"; ctx.fillText("your patch", m[0] + 6, m[1]); }
      }
      const fov = 2 * Math.atan(c.width / 2 / st.scale / 2) * 2 / D;
      ctx.fillStyle = "#8f99ab"; ctx.fillText(`centre RA ${st.ra.toFixed(2)}° Dec ${st.dec.toFixed(2)}° · view ≈ ${fov < 1 ? (fov * 60).toFixed(1) + "′" : fov.toFixed(1) + "°"} wide · N ↑ E ←`, 10, c.height - 10);
    };
    let drag = null;
    c.addEventListener("pointerdown", e => { drag = [e.clientX, e.clientY]; c.setPointerCapture(e.pointerId); });
    c.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; drag = [e.clientX, e.clientY];
      st.dec = Math.max(-89.9, Math.min(89.9, st.dec + dy / st.scale / D));
      st.ra = ((st.ra + dx / st.scale / D / Math.max(0.05, Math.cos(st.dec * D))) % 360 + 360) % 360;
      draw();
    });
    c.addEventListener("pointerup", () => drag = null);
    c.addEventListener("wheel", e => { e.preventDefault(); st.scale = Math.max(80, Math.min(4e6, st.scale * (e.deltaY > 0 ? 0.8 : 1.25))); draw(); }, { passive: false });
    const bar = F.html(panel, `<div class="controls"><button class="btn sm ghost" type="button">Whole sky</button>` +
      `<button class="btn sm ghost" type="button">Zoom to my patch</button></div>`);
    const [wide, near] = $$("button", bar);
    wide.onclick = () => { st.scale = 260; draw(); };
    near.onclick = () => { st.ra = cent.ra; st.dec = cent.dec; st.scale = c.width / (4 * (res.query.radiusArcmin || 3) / 60 * D) / 2; draw(); };
    draw();
  },
};
