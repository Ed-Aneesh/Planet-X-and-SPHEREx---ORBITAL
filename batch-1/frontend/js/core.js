/* =====================================================================
   core.js — shared helpers used by every page.
   No animations here on purpose (design comes later).
   ===================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* Read "a.b.c" from TEXT */
function t(key) {
  return key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), window.TEXT);
}

/* Fill every [data-k] element with its text */
function fillText(root = document) {
  $$("[data-k]", root).forEach(el => {
    const v = t(el.dataset.k);
    if (typeof v === "string") el.textContent = v;
  });
}

/* Build top navigation links */
function buildNav() {
  const nav = $("#nav-links");
  if (!nav) return;
  nav.innerHTML = "";
  window.TEXT.nav.forEach(item => {
    const a = document.createElement("a");
    a.href = item.href;
    a.textContent = item.label;
    nav.appendChild(a);
  });
}

/* Small status line helper: el.textContent with a type class */
function setStatus(el, msg, type = "info") {
  if (!el) return;
  el.textContent = msg;
  el.className = "status " + type;
}

/* ---------------- Coordinates ----------------
   RA: degrees (0–360) or "hh:mm:ss.s" / "hh mm ss" / "08h55m10.8s"
   Dec: degrees (−90..+90) or "±dd:mm:ss" / "-07d14m42.5s"           */
function parseRA(str) {
  const s = String(str).trim();
  if (!s) return NaN;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return parseFloat(s);              // decimal degrees
  const p = s.replace(/[hms:]/gi, " ").trim().split(/\s+/).map(Number);
  if (p.some(isNaN)) return NaN;
  const [h, m = 0, sec = 0] = p;
  return 15 * (h + m / 60 + sec / 3600);
}
function parseDec(str) {
  const s = String(str).trim();
  if (!s) return NaN;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const neg = s.startsWith("-") || s.startsWith("−");
  const p = s.replace(/^[+\-−]/, "").replace(/[d°'′"″ms:]/gi, " ").trim().split(/\s+/).map(Number);
  if (p.some(isNaN)) return NaN;
  const [d, m = 0, sec = 0] = p;
  const v = d + m / 60 + sec / 3600;
  return neg ? -v : v;
}
function validCoords(ra, dec) {
  return Number.isFinite(ra) && Number.isFinite(dec) && ra >= 0 && ra < 360 && dec >= -90 && dec <= 90;
}
function fmtRA(deg) {
  const h = deg / 15, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}m${ss.toFixed(2).padStart(5, "0")}s`;
}
function fmtDec(deg) {
  const sign = deg < 0 ? "−" : "+", a = Math.abs(deg);
  const dd = Math.floor(a), mm = Math.floor((a - dd) * 60);
  const ss = ((a - dd) * 60 - mm) * 60;
  return `${sign}${String(dd).padStart(2, "0")}°${String(mm).padStart(2, "0")}′${ss.toFixed(1).padStart(4, "0")}″`;
}

/* ---------------- Downloads ---------------- */
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------------- Aladin Lite helper ----------------
   Loads Aladin Lite v3 (CDS) and creates a viewer in #divId.
   Returns a Promise<aladin | null>. Null = could not load (offline). */
/* Aladin Lite is loaded as a module (vendor/aladin-lite-3.8.2.js), which finishes after the
   page scripts, so wait for it (up to ms) instead of assuming window.A exists. */
function waitForAladin(ms = 12000) {
  if (window.A && window.A.init) return Promise.resolve(window.A);
  return new Promise(resolve => {
    const done = () => resolve(window.A && window.A.init ? window.A : null);
    window.addEventListener("aladin-ready", done, { once: true });
    setTimeout(done, ms);
  });
}

async function makeAladin(divId, opts = {}) {
  await waitForAladin();
  return new Promise(resolve => {
    if (!window.A || !A.init) { resolve(null); return; }
    A.init.then(() => {
      const al = A.aladin("#" + divId, Object.assign({
        survey: "https://casda.csiro.au/hips/2MASS/Color",   // CDS alasky retired Nov 2026: mirror
        fov: 0.25,
        cooFrame: "ICRS",
        showReticle: true,
        showCooGrid: false,
        showProjectionControl: false,
        showFullscreenControl: true,
        showLayersControl: true
      }, opts));
      resolve(al);
    }).catch(() => resolve(null));
  });
}

/* Hero rotator: shows the first word only (no animation for now) */
function setRotator() {
  const el = $("#rotator");
  if (el) el.textContent = window.TEXT.hero.rotator[0];
}

document.addEventListener("DOMContentLoaded", () => {
  fillText();
  buildNav();
  setRotator();
  const y = $("#year");
  if (y) y.textContent = new Date().getFullYear();
});

/* ---------- F47 coordinate & epoch helper ----------
   A catalogue position is true at one date (its "epoch"). A star with proper motion has moved since,
   so we show where it is today. Small-angle approximation: fine for arcseconds-per-year motions. */
function decimalYear(d = new Date()) {
  const y = d.getUTCFullYear(), a = Date.UTC(y, 0, 1), b = Date.UTC(y + 1, 0, 1);
  return y + (d - a) / (b - a);
}
function positionAt(ra, dec, pmEast, pmNorth, epoch, year) {
  const dt = year - epoch, cosd = Math.cos(dec * Math.PI / 180) || 1e-9;
  return { ra: ((ra + (pmEast || 0) * dt / 3.6e6 / cosd) % 360 + 360) % 360, dec: dec + (pmNorth || 0) * dt / 3.6e6,
           moved: Math.hypot(pmEast || 0, pmNorth || 0) * Math.abs(dt) / 1000 };
}
function epochNote(t) {
  const pm = Math.hypot(t.pmEast || 0, t.pmNorth || 0) / 1000, now = decimalYear();
  if (pm <= 0.05) return `${t.kind ? t.kind + ". " : ""}Catalogue position (epoch ${t.epoch || 2000}); no measurable motion.`;
  const p = positionAt(t.ra, t.dec, t.pmEast, t.pmNorth, t.epoch || 2000, now);
  return `Catalogue position is for <b>${t.epoch || 2000}</b>. It moves ${pm.toFixed(2)}″/yr, so <b>today (${now.toFixed(2)})</b> it is at ` +
    `<span class="mono">RA ${p.ra.toFixed(5)}° · Dec ${p.dec >= 0 ? "+" : ""}${p.dec.toFixed(5)}°</span>, ${p.moved.toFixed(1)}″ from the catalogue spot. ` +
    `We place it at each image's own date.`;
}
