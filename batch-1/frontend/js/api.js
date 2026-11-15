/* =====================================================================
   api.js — the ONLY file that talks to the Python backend (../backend).

   Start the backend:   cd backend  ->  python main.py
   It serves this website too, at http://127.0.0.1:8765/

   Endpoints used (see backend/api/server.py):
     GET /api/health                  -> { ok, version, libraries }
     GET /api/settings                -> { bands, radiusArcmin, fps, ... }
     GET /api/targets                 -> [ { id, n, name, ra, dec, epoch, raNow, decNow, ... } ]
     GET /api/search?ra&dec&radius&band&start&end&target   -> 202 { id }
     GET /api/jobs/<id>               -> { state, message, done, total, result? }
     GET /api/colour?...&bands=1,3,5  -> 202 { id }   (infrared colour composite job)
     GET /api/fits/<name>             -> FITS file of the aligned frames
   result.frames[k] = { index, date, mjd, year, visit, wavelength, coverage,
                        flagged, missing, marker:{x,y}, png:"data:image/png;base64,..." }
   PNG: north up, east left, missing pixels transparent, ONE shared stretch.
   ===================================================================== */

const API = {
  _base: null,

  /* Finds the backend. Order:
       1. the same server that sent this page (python main.py, or the Render copy of the site);
       2. window.API_BASE from config.js (the Render backend, for Cloudflare / GitHub Pages / Vercel).
          A free Render server sleeps when idle and needs up to about a minute to wake, so this
          check waits longer and shows a small "waking up" note;
       3. http://127.0.0.1:8765 (a backend on this computer), only when the page itself is local. */
  _finding: null,
  async base() {
    if (this._base !== null) return this._base;
    if (this._finding) return this._finding;
    this._finding = (async () => {
      const local = !location.protocol.startsWith("http") || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      const candidates = [];
      if (location.protocol.startsWith("http")) candidates.push({ url: "", ms: 2500 });
      if (window.API_BASE) candidates.push({ url: window.API_BASE.replace(/\/$/, ""), ms: 90000, remote: true });
      if (local) candidates.push({ url: "http://127.0.0.1:8765", ms: 2500 });
      for (const c of candidates) {
        let note = null;
        const slow = c.remote ? setTimeout(() => { note = wakeNote(true); }, 3000) : 0;
        try {
          const r = await fetchTimeout(c.url + "/api/health", c.ms);
          if (r.ok && (await r.json()).ok) { this._base = c.url; return c.url; }
        } catch (_) { /* try next */ }
        finally { clearTimeout(slow); if (note) wakeNote(false); }
      }
      return null;
    })();
    try { return await this._finding; } finally { this._finding = null; }
  },

  async _get(path, params, timeoutMs = 20000) {
    const b = await this.base();
    if (b === null) throw new Error(API.offlineText());
    const qs = params ? "?" + new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString() : "";
    let r;
    try { r = await fetchTimeout(b + path + qs, timeoutMs); }
    catch (e) { throw new Error(e.name === "AbortError" ? "Backend did not answer in time" : "Lost connection to the backend"); }
    let body = null;
    try { body = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((body && body.error) || `HTTP ${r.status}`);
    return body;
  },

  /* What to tell the visitor when no backend answers: a hosted site gets a plain message. */
  offlineText() {
    return window.API_BASE
      ? "The ORBITAL server is not answering right now. Please try again in a minute."
      : "Backend not running. In the backend folder run:  python main.py";
  },

  async health() { return (await this.base()) !== null; },

  async settings() {
    try { return await this._get("/api/settings"); } catch (_) { return null; }
  },

  /* Backend list merged with the full list in content.js (backend values win),
     so every target always shows. this.staleBackend = backend sent fewer. */
  async targets() {
    let fromApi = [];
    try { fromApi = await this._get("/api/targets", null, 5000); } catch (_) { /* offline */ }
    const byId = new Map(window.TARGETS.map(t => [t.id, t]));
    fromApi.forEach(t => byId.set(t.id, Object.assign({}, byId.get(t.id), t)));
    this.staleBackend = fromApi.length > 0 && fromApi.length < window.TARGETS.length;
    return [...byId.values()].sort((a, b) => a.n - b.n);
  },

  /* Starts a search and polls until done. onProgress({message, done, total, elapsed}). */
  async search(params, onProgress) { return this.job("/api/search", params, onProgress); },

  /* Infrared colour composite: params of the loaded images + bands "1,3,5" + grid centre */
  async colour(params, onProgress) { return this.job("/api/colour", params, onProgress); },

  /* FITS file of the aligned frames (binary download). null = not on the server yet. */
  async fits(name) {
    const b = await this.base();
    if (b === null || !name) return null;
    const r = await fetch(b + "/api/fits/" + name);
    return r.ok ? r.blob() : null;
  },

  active: new Set(),                       // jobs this page started and is still waiting for
  stopped: new Set(),                      // jobs the user cancelled (polling stops at once)

  async job(path, params, onProgress) {
    const { id } = await this._get(path, params);
    this.active.add(id);
    const t0 = Date.now();
    let polls = 0;
    const cancelled = () => Object.assign(new Error("Search cancelled. Nothing was loaded."), { cancelled: true });
    try {
      while (true) {
        await new Promise(r => setTimeout(r, polls++ === 0 ? 120 : 900));   // prebuilt results answer at once
        if (this.stopped.has(id)) throw cancelled();
        const s = await this._get("/api/jobs/" + id);
        if (this.stopped.has(id) || s.state === "cancelled") throw cancelled();
        if (onProgress) onProgress(s);
        if (s.state === "done") return s.result;
        if (s.state === "error") throw new Error(s.message);
        if (Date.now() - t0 > 10 * 60 * 1000) throw new Error("Gave up after 10 minutes");
      }
    } finally {
      this.active.delete(id);
    }
  },

  /* Stop every search this page is waiting for. keepalive lets the request finish even while
     the page is being refreshed or closed, so the backend stops downloading at once. */
  cancelAll(leaving) {
    const ids = [...this.active];
    ids.forEach(id => {
      this.stopped.add(id);
      const url = (this._base || "") + "/api/jobs/" + id + "/cancel";
      try {
        if (leaving && navigator.sendBeacon && navigator.sendBeacon(url)) return;   // survives the page closing
        fetch(url, { keepalive: true, cache: "no-store" });
      } catch (_) {}
    });
    return ids.length;
  }
};

/* Small note while a sleeping free server wakes up (first visit after it was idle). */
function wakeNote(on) {
  let n = document.getElementById("wake-note");
  if (!on) { if (n) n.remove(); return null; }
  if (!n) {
    n = document.createElement("div"); n.id = "wake-note"; n.setAttribute("role", "status");
    n.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:300;max-width:min(520px,92vw);" +
      "padding:10px 16px;border-radius:12px;background:#111;color:#fff;font:600 .88rem/1.4 system-ui,sans-serif;" +
      "box-shadow:0 10px 30px rgba(0,0,0,.3);text-align:center";
    n.textContent = "Waking up the ORBITAL server… The free server sleeps when nobody uses it, so the first visit can take up to a minute.";
    document.body.appendChild(n);
  }
  return n;
}

function fetchTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/* Refreshing, closing or leaving the page cancels any search still running on the backend. */
addEventListener("pagehide", () => API.cancelAll(true));
