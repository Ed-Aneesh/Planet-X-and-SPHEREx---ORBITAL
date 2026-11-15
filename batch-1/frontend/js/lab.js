/* =====================================================================
   lab.js — the Science Lab page. Talks to /api/lab/... (backend/lab/api.py).
   Draws every chart as plain SVG (no library): log/linear axes, error bars,
   hover tooltips, reference lines. Nothing here does science: all numbers,
   errors and verdicts come from the backend, which explains itself.
   ===================================================================== */
(function () {
  "use strict";
  const BANDS = [[1, "0.75–1.09"], [2, "1.10–1.62"], [3, "1.63–2.41"], [4, "2.42–3.82"], [5, "3.83–4.41"], [6, "4.42–5.00"]];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (x, d = 3) => (x === null || x === undefined || !isFinite(x)) ? "—" : (Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-3 && x !== 0)) ? Number(x).toExponential(2) : Number(x).toFixed(d);
  const sig = (x, n = 3) => (x === null || x === undefined || !isFinite(x)) ? "—" : Number(x).toPrecision(n);
  const pm = m => m && m.value !== null && m.value !== undefined ? `${sig(m.value, 4)} ± ${sig(m.sigma, 2)}${m.unit ? " " + esc(m.unit) : ""}` : "—";
  let job = null, polling = null;

  /* ---------------------------------------------------------------- form */
  function initForm() {
    const sel = $("#lab-preset");
    (window.TARGETS || []).forEach(t => {
      const o = document.createElement("option"); o.value = t.id; o.textContent = `${t.name} — ${t.kind || ""}`; sel.appendChild(o);
    });
    sel.addEventListener("change", () => {
      const t = (window.TARGETS || []).find(x => x.id === sel.value);
      if (!t) return;
      $("#lab-name").value = t.name; $("#lab-ra").value = t.ra; $("#lab-dec").value = t.dec;
      $("#lab-year").value = (t.epoch || 2000).toFixed(1); $("#lab-pmra").value = t.pmEast || 0; $("#lab-pmdec").value = t.pmNorth || 0;
    });
    $("#lab-bands").innerHTML = BANDS.map(([b, r]) =>
      `<label title="${r} µm"><input type="checkbox" value="${b}" checked>D${b}</label>`).join("");
    $("#lab-form").addEventListener("submit", e => { e.preventDefault(); run(); });
    $("#lab-cancel").addEventListener("click", cancel);
    const q = new URLSearchParams(location.search);
    const fromUrl = q.get("target") && (window.TARGETS || []).find(t => t.id === q.get("target"));
    if (fromUrl) { sel.value = fromUrl.id; sel.dispatchEvent(new Event("change")); }      // ?target=etacar from the home page
    else if (q.get("ra") && q.get("dec")) {
      $("#lab-ra").value = q.get("ra"); $("#lab-dec").value = q.get("dec"); $("#lab-name").value = q.get("name") || "";
    }
  }

  function readForm() {
    const ra = parseRA($("#lab-ra").value), dec = parseDec($("#lab-dec").value);
    if (!validCoords(ra, dec)) throw new Error("Check RA (0–360° or hh:mm:ss) and Dec (−90…+90° or ±dd:mm:ss).");
    const year = parseFloat($("#lab-year").value), pmra = parseFloat($("#lab-pmra").value || "0"), pmdec = parseFloat($("#lab-pmdec").value || "0");
    if (!(year >= 1900 && year <= 2100)) throw new Error("Epoch must be a year between 1900 and 2100 (catalogues usually use 2000.0).");
    if (!isFinite(pmra) || !isFinite(pmdec)) throw new Error("Motions must be numbers in milli-arcseconds per year.");
    const bands = $$("#lab-bands input:checked").map(i => i.value);
    if (!bands.length) throw new Error("Choose at least one band.");
    return { ra: ra.toFixed(7), dec: dec.toFixed(7), year, pmra, pmdec, bands: bands.join(","),
             max: $("#lab-max").value || 24, gaia: $("#lab-gaia").checked ? 1 : 0, cube: $("#lab-cube").checked ? 1 : 0,
             name: $("#lab-name").value.trim() };
  }

  async function run() {
    let params;
    try { params = readForm(); } catch (e) { return setStatus($("#lab-status"), e.message, "error"); }
    setStatus($("#lab-status"), "Starting…", "info");
    $("#lab-run").disabled = true; $("#lab-cancel").disabled = false;
    $("#lab-results").hidden = true;
    try {
      const r = await API._get("/api/lab/run", params);
      job = r.id; $("#lab-pipeline").hidden = false; poll();
    } catch (e) { done(); setStatus($("#lab-status"), e.message, "error"); }
  }

  async function cancel() {
    if (!job) return;
    try { await API._get(`/api/lab/jobs/${job}/cancel`); } catch (_) {}
    setStatus($("#lab-status"), "Cancelling at the next safe point…", "warn");
  }

  function done() { $("#lab-run").disabled = false; $("#lab-cancel").disabled = true; clearTimeout(polling); }

  async function poll() {
    let j;
    try { j = await API._get(`/api/lab/jobs/${job}`); }
    catch (e) { setStatus($("#lab-status"), e.message + " — retrying", "warn"); polling = setTimeout(poll, 3000); return; }
    drawStages(j.stages || []);
    $("#lab-log").textContent = (j.log || []).join("\n");
    if (j.state === "running") {
      const running = (j.stages || []).find(s => s.status === "running");
      setStatus($("#lab-status"), `${running ? running.title : "Working"}… ${Math.round(j.elapsed)} s`, "info");
      polling = setTimeout(poll, 1500); return;
    }
    done();
    if (j.state === "error") return setStatus($("#lab-status"), "The analysis stopped: " + (j.message || "unknown error"), "error");
    setStatus($("#lab-status"), j.state === "cancelled" ? "Cancelled — partial results below." : `Done in ${Math.round(j.elapsed)} s.`,
              j.state === "cancelled" ? "warn" : "ok");
    if (j.result) render(j.result);
  }

  function drawStages(stages) {
    $("#lab-stages").innerHTML = stages.map(s => `<li class="${esc(s.status)}"><b>${esc(s.title || s.name)}</b>
      <span class="muted">${esc(s.what || "")}</span><div class="st">${esc(s.status)}${s.seconds ? " · " + s.seconds + " s" : ""}</div>
      ${s.reason ? `<div class="why">${esc(s.reason)}</div>` : ""}</li>`).join("");
  }

  /* ---------------------------------------------------------------- SVG chart */
  const tip = () => $("#lab-tip");
  function showTip(ev, html) { const t = tip(); t.innerHTML = html; t.hidden = false;
    const x = Math.min(ev.clientX + 14, innerWidth - 330), y = ev.clientY + 14; t.style.left = x + "px"; t.style.top = y + "px"; }
  function hideTip() { tip().hidden = true; }

  function ticks(lo, hi, log) {
    if (log) {
      const out = [], a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
      for (let e = a; e <= b; e++) for (const m of (b - a <= 2 ? [1, 2, 5] : [1])) { const v = m * 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
      return out;
    }
    const span = hi - lo, step0 = span / 5, mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 5, 10].map(k => k * mag).find(s => s >= step0) || mag * 10;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12)); return out;
  }
  const mjdDate = (m, full) => { const d = new Date(Date.UTC(1858, 10, 17) + m * 86400000).toISOString();
    return full ? d.slice(0, 16).replace("T", " ") : d.slice(0, 10); };
  const tickLabel = v => Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(0) : String(+v.toPrecision(4));

  /* opts: {title, x:{label,log,min,max,fmt}, y:{...}, series:[{kind:'points'|'line', color, label, dash, open, data:[{x,y,ey,tip}]}],
            refs:[{y,text}], height} */
  function chart(opts) {
    const W = 720, H = opts.height || 300, L = 62, R = 14, T = 26, B = 42;
    const pts = opts.series.flatMap(s => s.data.filter(d => isFinite(d.x) && isFinite(d.y) && (!opts.x.log || d.x > 0) && (!opts.y.log || d.y > 0)));
    if (!pts.length) return `<p class="muted">Nothing to plot.</p>`;
    const ext = (key, ax, err) => {
      let lo = ax.min ?? Math.min(...pts.map(d => d[key] - (err && d.ey && !ax.log ? d.ey : 0)));
      let hi = ax.max ?? Math.max(...pts.map(d => d[key] + (err && d.ey ? d.ey : 0)));
      (opts.refs || []).forEach(r => { if (key === "y" && isFinite(r.y)) { hi = Math.max(hi, r.y * 1.05); } });
      if (ax.log) { lo = Math.max(lo, hi * 1e-6); if (ax.min === undefined) lo /= 1.3; if (ax.max === undefined) hi *= 1.3; }
      else { const pad = (hi - lo || Math.abs(hi) || 1) * 0.06; if (ax.min === undefined) lo -= pad; if (ax.max === undefined) hi += pad; }
      return [lo, hi];
    };
    const [x0, x1] = ext("x", opts.x), [y0, y1] = ext("y", opts.y, true);
    const sx = v => L + (opts.x.log ? Math.log(v / x0) / Math.log(x1 / x0) : (v - x0) / (x1 - x0)) * (W - L - R);
    const sy = v => T + (1 - (opts.y.log ? Math.log(v / y0) / Math.log(y1 / y0) : (v - y0) / (y1 - y0))) * (H - T - B);
    const clampY = v => Math.max(T, Math.min(H - B, v));
    let g = `<g class="grid">`;
    const xt = ticks(x0, x1, opts.x.log), yt = ticks(y0, y1, opts.y.log);
    xt.forEach(v => g += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${H - B}"/>`);
    yt.forEach(v => g += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/>`);
    g += `</g><g class="axis"><line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/>`;
    xt.forEach(v => g += `<text x="${sx(v)}" y="${H - B + 15}" text-anchor="middle">${(opts.x.fmt || tickLabel)(v)}</text>`);
    yt.forEach(v => g += `<text x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${(opts.y.fmt || tickLabel)(v)}</text>`);
    g += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">${esc(opts.x.label)}</text>`;
    g += `<text transform="translate(13 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(opts.y.label)}</text></g>`;
    if (opts.title) g += `<text class="title" x="${L}" y="16">${esc(opts.title)}</text>`;
    (opts.refs || []).forEach((r, k) => { if (isFinite(r.y) && r.y >= y0 && r.y <= y1) {
      const right = k % 2 === 0;          // alternate sides so close lines keep readable labels
      g += `<line class="ref" x1="${L}" x2="${W - R}" y1="${sy(r.y)}" y2="${sy(r.y)}"/><text class="reftext" x="${right ? W - R - 4 : L + 6}" y="${sy(r.y) - 4}" text-anchor="${right ? "end" : "start"}">${esc(r.text)}</text>`; } });
    const hits = [];
    opts.series.forEach((s, si) => {
      const d = s.data.filter(p => isFinite(p.x) && isFinite(p.y) && (!opts.x.log || p.x > 0) && (!opts.y.log || p.y > 0) && p.x >= x0 && p.x <= x1);
      if (s.kind === "line") {
        const path = d.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${clampY(sy(p.y)).toFixed(1)}`).join("");
        g += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.thin ? 1.2 : 2}" ${s.dash ? 'stroke-dasharray="6 4"' : ""} ${s.opacity ? `opacity="${s.opacity}"` : ""} stroke-linejoin="round"/>`;
        if (s.hover) hits.push({ s, d });
      } else {
        d.forEach((p, i) => {
          const cx = sx(p.x), cy = sy(p.y);
          if (p.ey && isFinite(p.ey)) {
            const a = clampY(sy(opts.y.log ? Math.max(p.y - p.ey, y0) : p.y - p.ey)), b = clampY(sy(p.y + p.ey));
            g += `<line x1="${cx}" x2="${cx}" y1="${a}" y2="${b}" stroke="${s.color}" stroke-width="1.5" opacity=".7"/>`;
          }
          g += s.open ? `<circle cx="${cx}" cy="${cy}" r="4" fill="none" stroke="${s.color}" stroke-width="2"/>`
                      : `<circle cx="${cx}" cy="${cy}" r="4" fill="${s.color}" stroke="var(--paper)" stroke-width="1.5"/>`;
          if (p.tip) g += `<circle class="hit" cx="${cx}" cy="${cy}" r="9" data-s="${si}" data-i="${s.data.indexOf(p)}"/>`;
        });
      }
    });
    const id = "c" + Math.random().toString(36).slice(2, 8);
    if (hits.length) g += `<rect class="hit" data-cross="1" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/><line id="${id}x" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--chart-axis)" visibility="hidden"/>`;
    const legend = opts.series.filter(s => s.label).map(s =>
      `<span><i class="${s.kind === "line" ? (s.dash ? "dash" : "") : "dot"}" style="background:${s.color};color:${s.color}"></i>${esc(s.label)}</span>`).join("");
    const html = `<div class="lchart-wrap" id="${id}">${opts.series.filter(s => s.label).length > 1 ? `<div class="legend">${legend}</div>` : ""}
      <svg class="lchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || opts.y.label)}">${g}</svg></div>`;
    setTimeout(() => wire(id, opts, hits, sx, x0, x1, W, L, R), 0);
    return html;
  }

  function wire(id, opts, hits, sx, x0, x1, W, L, R) {
    const root = document.getElementById(id); if (!root) return;
    const svg = root.querySelector("svg");
    svg.querySelectorAll("circle.hit").forEach(c => {
      const p = opts.series[+c.dataset.s].data[+c.dataset.i];
      c.addEventListener("mousemove", ev => showTip(ev, p.tip)); c.addEventListener("mouseleave", hideTip);
    });
    const cross = svg.querySelector("[data-cross]");
    if (cross) {
      const line = document.getElementById(id + "x");
      cross.addEventListener("mousemove", ev => {
        const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
        const f = (px - L) / (W - L - R), xv = opts.x.log ? x0 * (x1 / x0) ** f : x0 + f * (x1 - x0);
        const rows = hits.map(h => { let best = h.d[0]; h.d.forEach(p => { if (Math.abs(p.x - xv) < Math.abs(best.x - xv)) best = p; }); return [h.s, best]; });
        line.setAttribute("x1", sx(rows[0][1].x)); line.setAttribute("x2", sx(rows[0][1].x)); line.setAttribute("visibility", "visible");
        showTip(ev, rows.map(([s, p]) => p.tip || `${esc(s.label)}: ${sig(p.y)}`).join("<br>"));
      });
      cross.addEventListener("mouseleave", () => { hideTip(); line.setAttribute("visibility", "hidden"); });
    }
  }

  /* ---------------------------------------------------------------- results */
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";
  const notes = arr => arr && arr.length ? `<ul class="notes">${arr.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  const kpi = (k, v, e) => `<div class="kpi"><div class="k">${esc(k)}</div><div class="v">${v}</div>${e ? `<div class="e">${e}</div>` : ""}</div>`;

  function render(r) {
    $("#lab-results").hidden = false;
    summary(r); gaiaPanel(r.gaia); sedPanel(r.sed); varPanel(r.variability); photPanel(r.photometry, r);
    uncPanel(r.uncertainty); cubePanel(r.cube); provPanel(r);
  }

  function summary(r) {
    const t = r.target || {}, s = r.sed || {}, phot = r.photometry || [];
    const bb = (s.fits || []).find(f => f.model === "blackbody");
    const v = r.variability || {}, comb = v.combined;
    const verdict = comb ? comb.constant_model.verdict : Object.values(v.per_band || {}).map(b => b.constant_model && b.constant_model.verdict).filter(Boolean)[0];
    const dist = r.gaia && r.gaia.kinematics && r.gaia.kinematics.distance_pc;
    $("#res-summary").innerHTML = `<h2>${esc(t.name || "Your object")} <small>RA ${num(t.ra, 5)}° · Dec ${num(t.dec, 5)}° (epoch ${t.year})</small></h2>
      <div class="kpis">
        ${kpi("SPHEREx exposures measured", phot.length, (r.releases || []).join(", "))}
        ${kpi("Bands", [...new Set(phot.map(p => "D" + p.band))].join(" ") || "—", phot.length ? `${num(Math.min(...phot.map(p => p.lam_um)), 2)}–${num(Math.max(...phot.map(p => p.lam_um)), 2)} µm` : "")}
        ${bb ? kpi("Blackbody temperature", `${Math.round(bb.T_K)} K`, `68 %: ${Math.round(bb.T_lo)}–${Math.round(bb.T_hi)} K · χ²/dof ${num(bb.chi2_red, 2)}`) : ""}
        ${dist ? kpi("Distance (Gaia parallax)", `${sig(dist.value, 4)} pc`, `± ${sig(dist.sigma, 2)} pc · ${sig(dist.value * 3.26156, 4)} light-years`) : ""}
        ${verdict ? kpi("Brightness over time", verdict.startsWith("variable") ? "Variable" : "Constant", esc(verdict)) : ""}
      </div>
      <p class="muted small">Each section below says how the number was made and what could make it wrong. Values in mJy are F<sub>ν</sub>, flux density per unit frequency.</p>`;
  }

  function gaiaPanel(g) {
    const el = $("#res-gaia");
    if (!g) { el.innerHTML = `<h2>Gaia DR3</h2><p class="muted">Not requested.</p>`; return; }
    if (g.ok === false) {
      el.innerHTML = `<h2>Gaia DR3</h2><p class="verdict warn">${esc(g.reason || "No match")}. The positions used your coordinates and motion instead.</p>${notes(g.errors)}`; return;
    }
    const s = g.source, k = g.kinematics || {}, sp = g.stellar_parameters || {}, pos = g.position_at_spherex_epoch || {};
    el.innerHTML = `<h2>Gaia DR3 <small>${esc(g.designation)} · served by ${esc(g.served_by)} · matched ${num(g.match_sep_arcsec, 2)}″ from your input</small></h2>
      <div class="kpis">
        ${kpi("Parallax (zero-point corrected)", pm(k.parallax_corrected_mas), `parallax/error ${sig(k.parallax_over_error, 3)}`)}
        ${k.distance_pc ? kpi("Distance", pm(k.distance_pc), pm(k.distance_ly)) : ""}
        ${kpi("Proper motion", `${num(s.pmra, 1)}, ${num(s.pmdec, 1)}`, "mas/yr east, north")}
        ${k.v_tan_kms ? kpi("Sky-plane speed", pm(k.v_tan_kms), "v_tan = 4.74 µ / ϖ") : ""}
        ${s.radial_velocity !== null && s.radial_velocity !== undefined ? kpi("Radial velocity", `${num(s.radial_velocity, 2)} km/s`, `± ${num(s.radial_velocity_error, 2)} (negative = approaching)`) : ""}
        ${k.v_lsr_kms ? kpi("Speed vs local standard of rest", pm(k.v_lsr_kms), esc(k.population_hint || "")) : ""}
        ${k.abs_mag_G ? kpi("Absolute G magnitude", pm(k.abs_mag_G), "no extinction correction") : ""}
        ${kpi("RUWE", num(s.ruwe, 2), s.ruwe > 1.4 ? "> 1.4: astrometry suspect (binary?)" : "≤ 1.4: single-star fit is good")}
      </div>
      ${k.U_kms ? `<p class="small">Space velocity (heliocentric; U to the Galactic centre, V along Galactic rotation, W to the north Galactic pole):
        U = ${pm(k.U_kms)}, V = ${pm(k.V_kms)}, W = ${pm(k.W_kms)}.</p>` : ""}
      <p class="small">Position at the SPHEREx epoch ${num(pos.epoch, 2)}: RA ${num(pos.ra, 6)}°, Dec ${num(pos.dec, 6)}° ± ${num((pos.sigma_pos_arcsec || 0) * 1000, 2)} mas
        (rigorous 3-D propagation${pos.perspective_effect_mas > 1 ? `; perspective acceleration contributes ${num(pos.perspective_effect_mas, 1)} mas` : ""}).</p>
      <p class="small">Gaia's own model fit to its low-resolution spectrum (GSP-Phot): T<sub>eff</sub> ${num(sp.teff_gspphot, 0)} K,
        log g ${num(sp.logg_gspphot, 2)}, [M/H] ${num(sp.mh_gspphot, 2)}, distance ${num(sp.distance_gspphot, 1)} pc.
        ${g.xp && g.xp.ok ? `XP spectrum: ${esc(g.xp.source)} — shown on the SED below.` : "No XP spectrum."}</p>
      ${notes([...(k.notes || []), ...(g.notes || []), ...((pos.notes) || [])])}`;
  }

  function sedPanel(s) {
    const el = $("#res-sed");
    if (!s) { el.innerHTML = `<h2>Spectral energy distribution</h2><p class="muted">Not available (see the pipeline above).</p>`; return; }
    const tipP = (p, src) => `${esc(src)}<br>λ = ${num(p.lam, 3)} µm<br>F<sub>ν</sub> = ${sig(p.flux_mJy, 4)} ± ${sig(p.sigma_mJy, 2)} mJy${p.n > 1 ? `<br>${p.n} exposures averaged` : ""}`;
    const sp = (s.points || []).filter(p => p.source === "spherex"), xp = (s.points || []).filter(p => p.source === "gaia_xp");
    const cube = (s.plot_only_points || []).filter(p => p.source === "cube");
    const series = [
      { kind: "points", color: css("--s1"), label: "SPHEREx (this analysis)", data: sp.map(p => ({ x: p.lam, y: p.flux_mJy, ey: p.sigma_mJy, tip: tipP(p, "SPHEREx channel") })) },
    ];
    if (xp.length) series.push({ kind: "points", color: css("--s2"), label: "Gaia XP spectrum", data: xp.map(p => ({ x: p.lam, y: p.flux_mJy, ey: p.sigma_mJy, tip: tipP(p, "Gaia DR3 XP") })) });
    if (cube.length) series.push({ kind: "points", open: true, color: css("--s3"), label: "DR1 all-sky cube (quick-look)", data: cube.map(p => ({ x: p.lam, y: p.flux_mJy, ey: p.sigma_mJy, tip: tipP(p, "DR1 cube") })) });
    (s.fits || []).forEach((f, i) => { if (f.plot) series.push({ kind: "line", color: i === 0 ? css("--ink") : css("--muted"), dash: i > 0, label: `${f.model}${i === 0 ? " (preferred)" : ""}`,
      data: f.plot.lam.map((x, j) => ({ x, y: f.plot.flux_mJy[j] })) }); });
    const all = series.flatMap(x => x.kind === "points" ? x.data : []).map(d => d.y).filter(v => v > 0);
    const ymin = all.length ? Math.min(...all) / 3 : undefined, ymax = all.length ? Math.max(...all) * 3 : undefined;
    const rows = (s.fits || []).map(f => `<tr><td>${esc(f.model)}${f.model === s.preferred ? " ✓" : ""}</td>
      <td>${f.model === "blackbody" ? `T = ${Math.round(f.T_K)} K [${Math.round(f.T_lo)}, ${Math.round(f.T_hi)}]; Wien peak ${num(f.wien_peak_um, 2)} µm`
          : f.model === "power law" ? `F<sub>ν</sub> ∝ λ<sup>${num(f.beta, 2)}</sup> [${num(f.beta_lo, 2)}, ${num(f.beta_hi, 2)}]`
          : `T₁ = ${Math.round(f.T1_K || 0)} K, T₂ = ${Math.round(f.T2_K || 0)} K`}</td>
      <td class="num">${num(f.chi2_red, 2)}</td><td class="num">${sig(f.p_value, 2)}</td><td class="num">${num(f.delta_bic, 1)}</td>
      <td class="num">${f.jitter_fraction ? (100 * f.jitter_fraction).toFixed(1) + " %" : "—"}</td></tr>`).join("");
    const ph = s.physical, bol = s.bolometric;
    el.innerHTML = `<h2>Spectral energy distribution <small>${s.n_points} points fitted with their full covariance</small></h2>
      <p class="small">How bright the object is at each wavelength. SPHEREx exposures falling in the same of its 102 channels are averaged
        (inverse-variance weighting); the shared calibration error is kept as a correlated term, so fits do not pretend it averages away.</p>
      ${chart({ x: { label: "wavelength λ (µm)", log: true, min: 0.35, max: 5.5 }, y: { label: "F_ν (mJy)", log: true, min: ymin, max: ymax }, series, height: 340 })}
      <div class="wide"><table><thead><tr><th>model</th><th>parameters (68 % interval)</th><th>χ²/dof</th><th>p-value</th><th>ΔBIC</th><th>extra scatter</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">χ²/dof ≈ 1 means the model fits within the errors. ΔBIC compares models while penalising extra parameters: &gt; 10 is strong evidence against that model. "Extra scatter" is the fractional error that would have to be added to make χ²/dof = 1.</p>
      ${ph ? `<h3>Radius and luminosity (blackbody + Gaia distance)</h3><p class="small">R = ${sig(ph.radius_Rsun_p16_p50_p84[1], 3)} R☉ (68 %: ${sig(ph.radius_Rsun_p16_p50_p84[0], 3)}–${sig(ph.radius_Rsun_p16_p50_p84[2], 3)}),
        L = ${sig(ph.luminosity_Lsun_p16_p50_p84[1], 3)} L☉ (${sig(ph.luminosity_Lsun_p16_p50_p84[0], 3)}–${sig(ph.luminosity_Lsun_p16_p50_p84[2], 3)}). ${esc(ph.note)}</p>
        ${ph.warning ? `<p class="verdict warn small">${esc(ph.warning)}</p>` : ""}` : ""}
      ${bol ? `<h3>Bolometric flux (model-light)</h3><p class="small">${bol.F_bol_W_m2_p16_p50_p84 ? `F<sub>bol</sub> = ${sig(bol.F_bol_W_m2_p16_p50_p84[1], 3)} W m⁻²${bol.L_bol_Lsun_p16_p50_p84 ? "" : ". "}` : ""}
        ${bol.L_bol_Lsun_p16_p50_p84 ? `, L = ${sig(bol.L_bol_Lsun_p16_p50_p84[1], 3)} L☉. ` : ""}Measured part alone (strict lower limit): ${sig(bol.F_bol_lower_limit_W_m2, 3)} W m⁻²
        ${bol.L_lower_limit_Lsun ? ` → L ≥ ${sig(bol.L_lower_limit_Lsun, 3)} L☉` : ""}. ${esc(bol.note)}</p>${bol.warning ? `<p class="verdict warn small">${esc(bol.warning)}</p>` : ""}` : ""}
      ${notes(s.caveats)}`;
  }

  function varPanel(v) {
    const el = $("#res-var");
    if (!v) { el.innerHTML = `<h2>Variability</h2><p class="muted">Not available (see the pipeline above).</p>`; return; }
    const bands = Object.entries(v.per_band || {});
    const rows = bands.map(([b, r]) => r.constant_model ? `<tr><td>${b}</td><td class="num">${r.n}</td><td class="num">${r.n_epochs}</td><td class="num">${num(r.baseline_days, 0)} d</td>
      <td class="num">${num(r.constant_model.chi2_red, 2)}</td><td class="num">${sig(r.constant_model.p_value, 2)}</td>
      <td class="num">${r.excess_variance && r.excess_variance.fvar !== null && r.excess_variance.fvar !== undefined ? `${(100 * r.excess_variance.fvar).toFixed(1)} ± ${(100 * r.excess_variance.fvar_sigma).toFixed(1)} %` : "none"}</td>
      <td>${esc(r.constant_model.verdict)}</td>
      <td class="num">${r.periodogram && r.periodogram.meaningful && r.periodogram.best_period_days ? `${sig(r.periodogram.best_period_days, 3)} d (FAP ${sig(r.periodogram.fap, 2)})` : "—"}</td></tr>`
      : `<tr><td>${b}</td><td class="num">${r.n}</td><td colspan="7" class="muted">${esc(r.note || "")}</td></tr>`).join("");
    const main = v.combined || (bands.map(([, r]) => r).find(r => r.light_curve) || null);
    let charts = "";
    if (main && main.light_curve) {
      const lc = main.light_curve;
      charts += chart({ title: v.combined ? "Light curve, all bands (each divided by its own spectral shape)" : "Light curve",
        x: { label: "date (UTC)", fmt: mjdDate }, y: { label: "relative brightness" }, height: 260,
        series: [{ kind: "points", color: css("--s1"), label: "exposures",
          data: lc.mjd.map((t, i) => ({ x: t, y: lc.rel_flux[i], ey: lc.sigma[i], tip: `${mjdDate(t, true)} (MJD ${num(t, 3)})<br>relative flux ${num(lc.rel_flux[i], 4)} ± ${num(lc.sigma[i], 4)}` })) }],
        refs: [{ y: 1, text: "constant" }] });
      const per = main.periodogram;
      if (per && per.plot) {
        const P = per.plot.frequency.map((f, i) => ({ x: 1 / f, y: per.plot.power[i], tip: `period ${sig(1 / f, 4)} d<br>power ${num(per.plot.power[i], 3)}<br>window ${num(per.plot.window[i], 3)}` }));
        const Wn = per.plot.frequency.map((f, i) => ({ x: 1 / f, y: per.plot.window[i] }));
        const refs = Object.entries(per.fap_levels || {}).map(([l, y]) => ({ y, text: `FAP ${(100 * l).toFixed(l < 0.01 ? 1 : 0)} %` }));
        charts += `<div>${chart({ title: "Lomb–Scargle periodogram", x: { label: "period (days)", log: true }, y: { label: "power", min: 0 }, height: 260,
          series: [{ kind: "line", color: css("--s3"), dash: true, thin: true, opacity: 0.7, label: "sampling window (when we looked; not a signal)", data: Wn }, { kind: "line", color: css("--s1"), label: "periodogram of the data", data: P, hover: true }], refs })}</div>`;
        if (per.folded) {
          const fo = per.folded, pts = fo.phase.flatMap((ph, i) => [ph, ph + 1].map(x => ({ x, y: fo.rel_flux[i], ey: fo.sigma[i], tip: `phase ${num(ph, 3)}<br>${num(fo.rel_flux[i], 4)}` })));
          charts += `${chart({ title: `Folded on ${sig(per.best_period_days, 4)} d`, x: { label: "phase (two cycles)", min: 0, max: 2 }, y: { label: "relative brightness" }, height: 260,
            series: [{ kind: "points", color: css("--s1"), label: "exposures", data: pts }] })}`;
        }
        charts += notes(per.notes);
        if (!per.meaningful) charts += `<p class="verdict warn small">Too few separate nights for a trustworthy period: the periodogram is shown for transparency only.</p>`;
      } else if (per) charts += notes(per.notes);
    }
    el.innerHTML = `<h2>Variability <small>is the brightness changing, and with what period?</small></h2>
      <p class="small">SPHEREx sees a slightly different wavelength in every exposure, so a raw light curve would mix colour with change.
        Each band is first divided by a smooth fit of its own spectral shape; what is left is change in time. The errors here leave out the
        absolute calibration (common to all exposures, it cannot fake variability).</p>
      <div class="wide"><table><thead><tr><th>band</th><th>exposures</th><th>nights</th><th>baseline</th><th>χ²/dof (constant)</th><th>p-value</th><th>F<sub>var</sub></th><th>verdict</th><th>best period</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">p-value: the probability that a truly constant star would scatter this much. F<sub>var</sub>: fractional rms variability after removing the measurement noise (Vaughan et al. 2003). FAP lines on the periodogram: peaks above them would arise from noise alone only 1 % / 0.1 % of the time (Baluev 2008). Peaks in the sampling window are the observing rhythm, not the star.</p>
      ${charts}<p class="muted small">${esc(v.sigma_note || "")}</p>`;
  }

  function photPanel(rows, r) {
    const el = $("#res-phot");
    if (!rows || !rows.length) { el.innerHTML = `<h2>Photometry</h2><p class="muted">No exposure was measured.</p>${dropped(r)}`; return; }
    const body = rows.map(p => `<tr><td class="num">${esc(p.date)}</td><td>D${p.band}</td><td class="num">${num(p.lam_um, 3)}</td>
      <td>${p.method === "psf" ? "PSF" : "aperture"}</td><td class="num">${pm(p.flux)}</td><td class="num">${pm(p.aperture_flux)}</td>
      <td class="num">${pm(p.psf_flux)}</td><td class="num">${num(p.psf_chi2_red, 1)}</td>
      <td>${(p.quality || []).length ? `<span class="tag" title="${esc(p.quality.join("\n"))}">${p.quality.length} note${p.quality.length > 1 ? "s" : ""}</span>` : ""}</td>
      <td><a href="${esc(p.url)}" target="_blank" rel="noopener">file</a></td></tr>`).join("");
    el.innerHTML = `<h2>Photometry, exposure by exposure <small>${rows.length} measurements</small></h2>
      <p class="small">Each exposure is measured twice on the same pixels. The PSF fit is used when it converges and fits well (χ²/dof ≤ 3); otherwise the aperture value.
        In crowded fields the PSF fit is often rejected because neighbours spill into the fit — that is the safe choice, not a failure.</p>
      <div class="wide"><table><thead><tr><th>date (UTC)</th><th>band</th><th>λ (µm)</th><th>used</th><th>flux (mJy)</th><th>aperture</th><th>PSF fit</th><th>PSF χ²/dof</th><th>quality</th><th>IRSA</th></tr></thead><tbody>${body}</tbody></table></div>
      ${dropped(r)}${notes(r.calibration_notes)}`;
  }
  const dropped = r => (r.dropped || []).length ? `<details><summary class="small">${r.dropped.length} exposure(s) not used — why</summary>${notes(r.dropped.map(d => d.reason + (d.url ? " — " + d.url.split("/").pop().split("?")[0] : "")))}</details>` : "";

  function uncPanel(u) {
    const el = $("#res-unc");
    if (!u) { el.innerHTML = `<h2>Error budget</h2><p class="muted">Not available.</p>`; return; }
    const bars = (u.photometric_budget || []).map(b => `<div class="bar-row"><span>${esc(b.term)} <span class="tag ${b.kind === "systematic" ? "sys" : "stat"}">${b.kind === "systematic" ? "sys" : "stat"}${b.shared ? " · shared" : ""}</span></span>
      <span class="track"><span class="fill ${b.kind === "systematic" ? "sys" : ""}" style="width:${Math.max(0.5, b.median_share_pct)}%"></span></span><span class="pct">${num(b.median_share_pct, 1)} %</span></div>`).join("");
    const ap = u.aperture_vs_psf, as = u.astrometry;
    el.innerHTML = `<h2>Error budget <small>what limits each number</small></h2>
      <p class="small">Share of the variance of a typical single-exposure flux (median over exposures; total relative error ${num(u.median_relative_error_pct, 1)} %).
        <span class="tag stat">stat</span> shrinks with more exposures; <span class="tag sys">sys</span> does not; <i>shared</i> = the same for every exposure (cancels in ratios and light curves).</p>
      ${bars}
      ${ap ? `<h3>Cross-check: aperture vs PSF on the same pixels</h3><p class="small">PSF / aperture = ${num(ap.median_ratio_psf_over_aperture, 3)} (scatter ${num(ap.scatter_pct, 1)} %, n = ${ap.n}). ${esc(ap.note)}</p>` : ""}
      ${as ? `<h3>Astrometric check</h3><p class="small">Fitted position minus predicted: mean (${num(as.mean_offset_arcsec[0], 2)}″ E, ${num(as.mean_offset_arcsec[1], 2)}″ N), rms ${num(as.rms_offset_arcsec, 2)}″ over ${as.n} exposures (1 pixel = 6.2″). ${esc(as.note)}</p>` : ""}
      ${u.astrometric_budget_arcsec ? `<h3>Where we aim: positional error</h3><ul class="notes">${u.astrometric_budget_arcsec.map(b => `<li>${esc(b.term)}: ${b.sigma === null || b.sigma === undefined ? "—" : num(b.sigma * 1000, 1) + " mas"}</li>`).join("")}</ul>` : ""}
      <h3>Spectral (wavelength) error</h3><p class="small">${esc(u.spectral_note)}</p>`;
  }

  function cubePanel(c) {
    const el = $("#res-cube");
    if (!c) { el.innerHTML = `<h2>DR1 all-sky spectral cube</h2><p class="muted">Not requested or not available.</p>`; return; }
    const good = (c.channels || []).filter(ch => ch.flux);
    el.innerHTML = `<h2>DR1 all-sky spectral cube <small>independent cross-check</small></h2>
      <p class="small">IRSA's DR1 cube co-adds every SPHEREx exposure into 102 maps of the whole sky (HEALPix pixels of 12.9″). We read only the bytes
        around your position from tile ${esc(c.tile)}, measure a ${num(c.aperture_arcsec, 0)}″-radius aperture in each channel, and estimate errors from empty apertures nearby
        (the cube has no error maps). ${good.length} channel${good.length === 1 ? "" : "s"} measured; plotted as open circles on the SED above.</p>
      ${c.curve_of_growth ? `<p class="small">Curve of growth at ${num(c.curve_of_growth.lam_um, 2)} µm (flux inside radius r): ${c.curve_of_growth.radius_px.map((r, i) => `${r} px: ${sig(c.curve_of_growth.flux_mJy[i], 3)} mJy`).join(" · ")}. A curve that keeps rising means neighbours or extended light are entering the aperture.</p>` : ""}
      ${notes(c.caveats)}<p class="small"><a href="${esc(c.tile_url)}" target="_blank" rel="noopener">tile file</a> · doi:10.26131/IRSA679</p>`;
  }

  function provPanel(r) {
    $("#res-prov").innerHTML = `<h2>Provenance &amp; downloads</h2>
      <div class="dl"><a class="btn sm ghost" href="${API._base || ""}/api/lab/download/${job}.json">⬇ Everything (JSON)</a>
        <a class="btn sm ghost" href="${API._base || ""}/api/lab/download/${job}.csv">⬇ Photometry table (CSV)</a></div>
      <ul class="notes">${(r.provenance || []).map(p => `<li><b>${esc(p.stage)}</b> · ${esc(p.kind)}: ${esc(p.value)}${p.note ? " — " + esc(p.note) : ""} <span class="muted">(${esc(p.time_utc)})</span></li>`).join("")}</ul>
      <p class="muted small">Lab version ${esc(r.lab_version)}.</p>`;
  }

  document.addEventListener("DOMContentLoaded", initForm);
  window.LabChart = chart;      // for tests
})();
