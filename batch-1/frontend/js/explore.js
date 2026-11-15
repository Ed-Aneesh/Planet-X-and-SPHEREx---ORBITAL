/* explore.js — one "Explore" button in the top bar.
   It opens a small pop-up where the user picks Star Vault or Sky Probe.
   It also keeps the top bar from overlapping: when the page links no longer fit
   on one line, they fold into a "☰ Menu" list instead of running under the buttons. */
(function () {
  "use strict";

  /* ---------- the pop-up ---------- */
  let box = null, lastFocus = null;
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  function close() {
    if (!box || box.hidden) return;
    box.hidden = true;
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === "Escape") close(); }

  function card(href, icon, name, tag, text, points, cls) {
    const isHere = here === href;
    return `<a class="ch-opt ex-opt${isHere ? " here" : ""}" href="${href}">
      <b>${icon} ${name}${isHere ? ' <span class="ex-here">You are here</span>' : ""}</b><em>${tag}</em>
      <p>${text}</p>
      <ul class="${cls}">${points.map(p => `<li${p.con ? ' class="con"' : ""}>${p.t}</li>`).join("")}</ul>
    </a>`;
  }

  function open() {
    lastFocus = document.activeElement;
    if (!box) {
      box = document.createElement("div");
      box.className = "choose-modal ex-modal"; box.hidden = true;
      box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-labelledby", "ex-title");
      box.addEventListener("click", e => { if (e.target === box || e.target.closest(".ch-x")) close(); });
      box.innerHTML = `<div class="ch-card ex-card">
        <button type="button" class="ch-x" aria-label="Close">✕</button>
        <span class="mono muted">EXPLORE</span>
        <h2 id="ex-title" class="ex-title">Where do you want to start?</h2>
        <div class="ch-opts ex-opts">
          ${card("vault.html", "✦", "Star Vault", "19 ready targets · instant",
            "Pick a famous star, brown dwarf or asteroid and play its real SPHEREx images straight away, from the team's saved copy of the NASA/IPAC IRSA files.",
            [{ t: "Includes the 5 challenge targets." }, { t: "Works even if NASA's archive is slow or down." }], "ch-pros")}
          ${card("probe.html", "⌖", "Sky Probe", "Any RA / Dec · live from NASA",
            "Type any position in the sky, or click the sky map. ORBITAL asks NASA/IPAC IRSA for every SPHEREx image of that spot.",
            [{ t: "Newest weekly data, any radius, older 2MASS/WISE images." }, { t: "A search takes about 10 s to 2 min.", con: true }], "ch-pros")}
        </div>
      </div>`;
      document.body.appendChild(box);
    }
    box.hidden = false;
    document.addEventListener("keydown", onKey);
    box.querySelector(".ch-opt").focus();
  }

  /* ---------- the button ---------- */
  function addButton(right) {
    if (right.querySelector(".explore-btn")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn sm primary explore-btn";
    b.setAttribute("aria-haspopup", "dialog");
    b.innerHTML = `<span aria-hidden="true">✦</span> Explore`;
    b.addEventListener("click", open);
    right.appendChild(b);
  }

  /* ---------- no overlap: fold the page links into a menu when they don't fit ---------- */
  let menuBtn = null, menuList = null;

  function buildMenu(nav, links, right) {
    if (menuBtn) return;
    menuBtn = document.createElement("button");
    menuBtn.type = "button"; menuBtn.className = "btn sm ghost nav-menu-btn";
    menuBtn.setAttribute("aria-expanded", "false"); menuBtn.setAttribute("aria-label", "Page menu");
    menuBtn.innerHTML = `<span aria-hidden="true">☰</span><span class="nm-label"> Menu</span>`;
    menuList = document.createElement("div");
    menuList.className = "nav-menu-list"; menuList.hidden = true;
    menuBtn.addEventListener("click", e => {
      e.stopPropagation();
      menuList.innerHTML = [...links.querySelectorAll("a")]
        .map(a => `<a href="${a.getAttribute("href")}">${a.textContent}</a>`).join("");
      menuList.hidden = !menuList.hidden;
      menuBtn.setAttribute("aria-expanded", String(!menuList.hidden));
    });
    menuList.addEventListener("click", e => { if (e.target.closest("a")) hideMenu(); });
    document.addEventListener("click", e => { if (!e.target.closest(".nav-menu-list, .nav-menu-btn")) hideMenu(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") hideMenu(); });
    right.insertBefore(menuBtn, right.firstChild);
    nav.appendChild(menuList);
  }
  function hideMenu() { if (menuList && !menuList.hidden) { menuList.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); } }

  function fit() {
    const nav = document.querySelector(".nav"); if (!nav) return;
    const links = nav.querySelector(".links"), right = nav.querySelector(".nav-right");
    if (!right) return;
    // start from the roomiest layout, then tighten one step at a time until nothing overlaps
    nav.classList.remove("nav-fold", "nav-tight", "nav-tiny");
    const hasLinks = links && links.querySelector("a");
    const overflows = () =>
      (links && links.offsetParent !== null && links.scrollWidth > links.clientWidth + 1) ||
      nav.scrollWidth > nav.clientWidth + 1;
    if (hasLinks) buildMenu(nav, links, right);
    const linksHiddenByCss = !links || links.offsetParent === null;
    if (hasLinks && (overflows() || linksHiddenByCss)) nav.classList.add("nav-fold");
    if (overflows()) nav.classList.add("nav-tight");
    if (overflows()) nav.classList.add("nav-tiny");
    if (!nav.classList.contains("nav-fold")) hideMenu();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const right = document.querySelector(".nav .nav-right");
    if (!right) return;
    addButton(right);
    // the theme and "How to use" buttons are added on DOMContentLoaded too; measure after them
    requestAnimationFrame(fit);
    window.addEventListener("load", fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    let t = 0;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(fit, 60); });
  });

  window.Explore = { open, fit };
})();
