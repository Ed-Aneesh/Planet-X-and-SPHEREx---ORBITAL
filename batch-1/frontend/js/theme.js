/* theme.js — light / dark toggle in the top bar. The site opens in LIGHT mode;
   the visitor's choice is remembered in this browser.
   The page sets data-theme in <head> before it paints, so there is no flash.
   Astronomy images (player, big view, sky map) stay on black in both themes on purpose.

   First visit only: once the "How to use" guide is closed, a speech bubble points at the
   toggle and says "Switch to dark mode", with a ✕. It never shows again after it is closed,
   after the toggle is used, or if the visitor is already in dark mode. */
(function () {
  const root = document.documentElement, KEY = "orbital.theme", HINT_KEY = "orbital.themehint.seen.v1";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return "1"; } },   // storage blocked: never nag
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  };

  const set = (t, remember) => {
    root.dataset.theme = t;
    if (remember) store.set(KEY, t);
    const b = document.getElementById("theme-toggle");
    if (b) {
      b.innerHTML = t === "light" ? "☾" : "☀";
      b.setAttribute("aria-label", t === "light" ? "Switch to dark mode" : "Switch to light mode");
      b.title = b.getAttribute("aria-label");
    }
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = t === "light" ? "#f5f3ee" : "#0c1424";
  };

  /* ---------- the speech bubble ---------- */
  let hint = null;

  function hintDone() {
    store.set(HINT_KEY, "1");
    if (hint) { hint.remove(); hint = null; }
    window.removeEventListener("resize", place);
  }

  function place() {
    const btn = document.getElementById("theme-toggle");
    if (!hint || !btn) return;
    const r = btn.getBoundingClientRect();
    if (!r.width) { hint.style.visibility = "hidden"; return; }
    hint.style.visibility = "";
    const vw = document.documentElement.clientWidth, w = hint.offsetWidth;
    const cx = r.left + r.width / 2;
    // tail sits near the right end of the bubble (like a comic bubble), then clamp inside the screen
    let left = cx - w * 0.78;
    left = Math.max(8, Math.min(left, vw - w - 8));
    hint.style.left = left + "px";
    hint.style.top = (r.bottom + 30) + "px";
    hint.style.setProperty("--tail-x", (cx - left - 14) + "px");
  }

  function aModalIsOpen() {
    return !!document.querySelector(".tut-wrap:not([hidden]), .choose-modal:not([hidden])");
  }

  function showHint() {
    if (hint || store.get(HINT_KEY) === "1" || root.dataset.theme === "dark") return;
    if (!document.getElementById("theme-toggle")) return;
    if (aModalIsOpen()) { setTimeout(showHint, 500); return; }   // wait until pop-ups are closed
    hint = document.createElement("div");
    hint.className = "theme-hint"; hint.setAttribute("role", "status");
    hint.innerHTML = `
      <svg class="th-tail" viewBox="0 0 28 32" aria-hidden="true">
        <path d="M3 32 C 9 24, 12 14, 10 4 C 9.5 1.5, 12 0.5, 14 2.5 C 20 9, 23 20, 25 32" />
      </svg>
      <button type="button" class="th-go">Switch to dark mode</button>
      <button type="button" class="th-x" aria-label="Close this tip">✕</button>`;
    hint.querySelector(".th-go").addEventListener("click", () => { set("dark", true); hintDone(); });
    hint.querySelector(".th-x").addEventListener("click", hintDone);
    document.body.appendChild(hint);
    place();
    requestAnimationFrame(() => { place(); hint && hint.classList.add("in"); });
    window.addEventListener("resize", place);
    setTimeout(place, 300);   // the top bar may re-arrange itself once fonts are in
  }

  document.addEventListener("DOMContentLoaded", () => {
    const nav = document.querySelector(".nav-right"); if (!nav) return;
    const b = document.createElement("button");
    b.type = "button"; b.id = "theme-toggle"; b.className = "btn sm ghost theme-toggle";
    b.addEventListener("click", () => { set(root.dataset.theme === "dark" ? "light" : "dark", true); if (hint) hintDone(); });
    nav.prepend(b);
    set(root.dataset.theme === "dark" ? "dark" : "light", false);

    if (store.get(HINT_KEY) === "1") return;
    // show the bubble right after the guide is closed; if the guide does not open on this visit, show it shortly
    document.addEventListener("orbital:tutorial-closed", () => setTimeout(showHint, 350));
    setTimeout(() => {
      if (window.Tutorial && window.Tutorial.isOpen && window.Tutorial.isOpen()) return;   // wait for the close event
      showHint();
    }, 1400);
  });
})();
