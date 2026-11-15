/* =====================================================================
   home.js — builds and wires the home page (index.html).
   ===================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const T = window.TEXT;

  /* ---------- hero stats + marquee ---------- */
  $("#hero-stats").innerHTML = T.hero.stats
    .map(s => `<div class="stat"><b>${s.value}</b><span>${s.label}</span></div>`).join("");
  if ($("#marquee")) $("#marquee").textContent = T.marquee.join("  ·  ");

  /* ---------- door cards + "try it" simulator ---------- */
  const allTargets = window.TARGETS.slice().sort((p, q) => p.n - q.n);
  doorVault($("#door-vault-art"), allTargets);
  doorProbe($("#door-probe-art"));
  const demo = new BlinkDemo({
    canvas: $("#try-canvas"), hud: $("#try-hud"), dots: $("#try-dots"),
    playBtn: $("#try-play"), trail: $("#try-trail"), probe: $("#try-probe")
  });
  $("#try-play").addEventListener("click", () => demo.toggle());
  $("#try-prev").addEventListener("click", () => { demo.stop(); demo.go(demo.i - 1); });
  $("#try-next").addEventListener("click", () => { demo.stop(); demo.go(demo.i + 1); });

  /* ---------- pipeline ---------- */
  $("#pipeline-steps").innerHTML = T.sections.pipeline.steps
    .map((s, i) => `<li class="card"><span class="mono muted">STEP ${i + 1}</span><h3>${s.t}</h3><p>${s.d}</p></li>`).join("");

  /* ---------- revolving target carousel + fun facts ---------- */
  const carousel = new Carousel({
    stage: $("#c-stage"), ring: $("#c-ring"), angle: $("#c-angle"), autoBtn: $("#c-auto"),
    jump: $("#c-jump"), detail: $("#c-detail"), targets: allTargets
  });
  /* Every "open the Vault / Probe / Lab" link on this page carries the target the ring is showing,
     so the next page opens with its name, coordinates and motion already filled in. */
  const linkToShown = () => {
    const t = allTargets[carousel.i]; if (!t) return;
    $$('a[href^="vault.html"], a[href^="probe.html"], a[href^="lab.html"]').forEach(a => {
      if (a.hasAttribute("data-choose")) return;
      const page = a.getAttribute("href").split(/[?#]/)[0];
      a.setAttribute("href", `${page}?target=${encodeURIComponent(t.id)}`);
      a.title = `Opens with ${t.name} filled in`;
    });
  };
  const goShown = carousel.go.bind(carousel);
  carousel.go = k => { goShown(k); linkToShown(); };
  linkToShown();
  $("#c-prev").addEventListener("click", () => { carousel.stopAuto(); carousel.prev(); });
  $("#c-next").addEventListener("click", () => { carousel.stopAuto(); carousel.next(); });
  $("#c-auto").addEventListener("click", () => carousel.auto());
  // spin on its own by default (AUTO on); any click, key or jump stops it. Not for "reduce motion" users.
  if (!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) carousel.auto();

  /* ---------- spectrum bar: 6 detectors, 102 channels, labelled features ---------- */
  const LMIN = 0.75, LMAX = 5.0;
  const pct = l => ((l - LMIN) / (LMAX - LMIN)) * 100;
  const BANDS = window.BANDS;
  // 17 channels per detector, equally spaced in log(λ) (constant resolving power) — approximate positions
  const CH = [];
  BANDS.forEach((b, bi) => { for (let k = 0; k < 17; k++) {
    const lo = b.min * Math.pow(b.max / b.min, k / 17), hi = b.min * Math.pow(b.max / b.min, (k + 1) / 17);
    CH.push({ n: bi * 17 + k + 1, band: b.id, lo, hi }); } });
  $("#spec-bands").innerHTML = BANDS
    .map(b => `<div class="band" style="left:${pct(b.min)}%;width:${pct(b.max) - pct(b.min)}%"><span>${b.id}</span></div>`).join("") +
    `<div class="spec-ch">${CH.map(c => `<i style="left:${pct(c.lo)}%"></i>`).join("")}</div>`;
  // feature lines; labels go in 3 rows so neighbours never overlap
  let row = 0;
  $("#spec-features").innerHTML = window.SPEC_FEATURES.map((f, i) => {
    const r = f.to ? 2 : (row++ % 2);
    return f.to
      ? `<button type="button" class="feat range r${r}" data-i="${i}" style="left:${pct(f.at)}%;width:${pct(f.to) - pct(f.at)}%"><span>${f.label}</span></button>`
      : `<button type="button" class="feat line r${r}" data-i="${i}" style="left:${pct(f.at)}%"><span>${f.label}</span></button>`;
  }).join("");
  $("#spec-ticks").innerHTML = [0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
    .map(l => `<span style="left:${pct(l)}%">${l}</span>`).join("") + `<span class="unit" style="left:100%">µm</span>`;

  const REGION = l => l < 1.1 ? "Shortest band: hot and ordinary stars, sharpest detail; dust dims light most here."
    : l < 2.42 ? "Near-infrared continuum — stars, galaxies and the zodiacal background (sunlight scattered by dust in the Solar System)."
    : l < 3.83 ? "Ice and organics band: water ice, methane and PAH features; cool objects start to stand out."
    : "Long bands, finest colour steps (R ≈ 110–130): cold brown dwarfs, CO₂ and CO ice; dust is almost transparent.";
  const bar = $("#spec-bar");
  function setLambda(l, explain) {
    l = Math.min(LMAX, Math.max(LMIN, l));
    const b = BANDS.find(b => l >= b.min && l <= b.max) ||
      BANDS.reduce((m, b) => Math.min(Math.abs(l - b.min), Math.abs(l - b.max)) < Math.min(Math.abs(l - m.min), Math.abs(l - m.max)) ? b : m);
    const ch = CH.find(c => l >= c.lo && l < c.hi && c.band === b.id) || CH.filter(c => c.band === b.id).reduce((m, c) => Math.abs((c.lo + c.hi) / 2 - l) < Math.abs((m.lo + m.hi) / 2 - l) ? c : m);
    $("#spec-lambda").textContent = `${l.toFixed(2)} µm`;
    $("#spec-band").textContent = `${b.id}`;
    $("#spec-ch").textContent = `${ch.n} / 102`;
    $("#spec-R").textContent = `R ≈ ${b.R || "—"}`;
    $("#spec-cursor").style.left = pct(l) + "%";
    const near = window.SPEC_FEATURES.find(f => f.to ? (l >= f.at && l <= f.to) : Math.abs(f.at - l) < 0.06);
    $("#spec-explain").textContent = explain || (near ? `${near.label}: ${near.d}` : REGION(l));
  }
  const fromEvent = e => {
    const r = bar.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    return LMIN + (x / r.width) * (LMAX - LMIN);
  };
  bar.addEventListener("mousemove", e => setLambda(fromEvent(e)));
  bar.addEventListener("touchmove", e => setLambda(fromEvent(e)), { passive: true });
  $("#spec-features").addEventListener("click", e => {
    const b = e.target.closest(".feat"); if (!b) return;
    const f = window.SPEC_FEATURES[+b.dataset.i];
    setLambda(f.to ? (f.at + f.to) / 2 : f.at, `${f.label}: ${f.d}`);
  });
  setLambda(2.04);

  /* ---------- tools ---------- */
  $("#tools-grid").innerHTML = T.tools
    .map(x => `<a class="card tool" href="${x.href}"><span class="ico">${x.ico}</span><h3>${x.t}</h3><p>${x.d}</p></a>`).join("");

  /* ---------- compare table ---------- */
  const c = T.compare;
  $("#compare-table").innerHTML =
    `<thead><tr>${c.head.map(h => `<th>${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${c.rows.map(r => `<tr>${r.map((v, i) => i ? `<td>${v}</td>` : `<th>${v}</th>`).join("")}</tr>`).join("")}</tbody>`;

  /* ---------- glossary: one foldable section; inside, a term cloud + a definition card ----------
     Closed: a single row with a chevron and a strip of sample terms (click one to jump to it).
     Open: search, an A–Z rail, every term as a chip, and the chosen term's definition on a card
     with ← → to step through. The nav "Glossary" link opens it. */
  const esc = t => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const mark = (text, q) => {
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q);
    return i < 0 ? esc(text) : esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length));
  };
  const G = T.glossary.map((g, k) => Object.assign({ k, L: g.t.replace(/^[^A-Za-z]*/, "")[0].toUpperCase() }, g))
    .sort((a, b) => a.t.localeCompare(b.t));
  let gq = "", gsel = G[0], shown = G;
  const gOpen = open => {
    $("#gloss-body").hidden = !open;
    $("#gloss-toggle").setAttribute("aria-expanded", String(open));
    $("#glossary").classList.toggle("open", open);
  };
  $("#gloss-toggle").addEventListener("click", () => gOpen($("#gloss-body").hidden));
  $("#gloss-teaser").innerHTML = G.filter((_, k) => k % 4 === 0).slice(0, 10)
    .map(g => `<button type="button" data-g="${g.k}">${esc(g.t)}</button>`).join("") + `<span>+ ${G.length - 10} more</span>`;
  $("#gloss-teaser").addEventListener("click", e => {
    const b = e.target.closest("[data-g]"); if (!b) return;
    gOpen(true); pick(G.find(g => g.k === +b.dataset.g));
  });
  function pick(g) {
    if (!g) return;
    gsel = g;
    const i = shown.indexOf(g);
    $("#gloss-card").innerHTML =
      `<span class="gc-letter">${g.L}</span>` +
      `<span class="gc-kicker mono">Term ${G.indexOf(g) + 1} of ${G.length}</span>` +
      `<h3>${mark(g.t, gq)}</h3><p>${mark(g.d, gq)}</p>` +
      `<div class="gc-nav"><button type="button" class="btn sm ghost" data-step="-1" ${shown.length < 2 ? "disabled" : ""}>←</button>` +
      `<span class="mono">${i + 1} / ${shown.length}</span>` +
      `<button type="button" class="btn sm ghost" data-step="1" ${shown.length < 2 ? "disabled" : ""}>→</button></div>`;
    $$(".gchip", $("#gloss-grid")).forEach(c => { const on = +c.dataset.g === g.k; c.classList.toggle("on", on); c.setAttribute("aria-selected", String(on)); });
    const chip = $(`.gchip[data-g="${g.k}"]`); if (chip) chip.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function renderGloss(q = "") {
    gq = q.trim().toLowerCase();
    shown = G.filter(g => !gq || g.t.toLowerCase().includes(gq) || g.d.toLowerCase().includes(gq));
    const letters = [...new Set(G.map(g => g.L))], have = new Set(shown.map(g => g.L));
    $("#gloss-az").innerHTML = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(L =>
      `<button type="button" data-l="${L}" ${have.has(L) ? "" : "disabled"}>${L}</button>`).join("");
    let last = "";
    $("#gloss-grid").innerHTML = shown.length ? shown.map(g => {
      const head = g.L !== last ? `<span class="gl-letter" id="gl-${g.L}">${(last = g.L)}</span>` : "";
      return head + `<button type="button" class="gchip" role="option" data-g="${g.k}">${mark(g.t, gq)}</button>`;
    }).join("") : `<p class="muted">No term matches “${esc(gq)}”.</p>`;
    $("#gloss-count").textContent = gq ? `${shown.length} of ${G.length} terms` : `${G.length} terms`;
    pick(shown.includes(gsel) ? gsel : shown[0]);
    void letters;
  }
  $("#gloss-grid").addEventListener("click", e => { const c = e.target.closest(".gchip"); if (c) pick(G.find(g => g.k === +c.dataset.g)); });
  $("#gloss-az").addEventListener("click", e => {
    const b = e.target.closest("[data-l]"); if (!b) return;
    pick(shown.find(g => g.L === b.dataset.l));
  });
  $("#gloss-card").addEventListener("click", e => {
    const b = e.target.closest("[data-step]"); if (!b || !shown.length) return;
    const i = shown.indexOf(gsel); pick(shown[(i + +b.dataset.step + shown.length) % shown.length]);
  });
  $("#gloss-random").addEventListener("click", () => pick(shown[Math.floor(Math.random() * shown.length)]));
  $("#gloss-search").addEventListener("input", e => renderGloss(e.target.value));
  $("#glossary").addEventListener("keydown", e => {
    if ($("#gloss-body").hidden || e.target.matches("input")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault(); const i = shown.indexOf(gsel); pick(shown[(i + (e.key === "ArrowRight" ? 1 : -1) + shown.length) % shown.length]);
    }
  });
  const fromHash = () => { if (location.hash === "#glossary") { gOpen(true); } };
  addEventListener("hashchange", fromHash);
  document.addEventListener("click", e => { const a = e.target.closest('a[href$="#glossary"]'); if (a) setTimeout(() => gOpen(true), 0); });
  renderGloss();
  fromHash();

  /* ---------- backend status ---------- */
  API.health().then(ok => {
    const el = $("#backend-status"); if (!el) return;
    el.textContent = ok ? "● Backend connected" : "○ " + API.offlineText();
  });

  /* ---------- keyboard: ← → steps the blink demo ---------- */
  document.addEventListener("keydown", e => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "ArrowRight") { demo.stop(); demo.go(demo.i + 1); }
    if (e.key === "ArrowLeft") { demo.stop(); demo.go(demo.i - 1); }
  });
});
