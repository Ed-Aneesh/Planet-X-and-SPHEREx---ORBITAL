/* =====================================================================
   tutorial.js — "How to use ORBITAL": a 9-step guide in a pop-up.
   Opens by itself the first time someone visits (remembered in this
   browser), and any time from the "? How to use" button in the top bar.
   Keys: ← → to step, Esc to close. Needs no other script.
   ===================================================================== */
(function () {
  "use strict";
  const KEY = "orbital.tutorial.seen.v1";
  const STEPS = [
    { img: "1-welcome.jpg", title: "Welcome!",
      text: "ORBITAL turns NASA's SPHEREx infrared images of any spot in the sky into a short time-lapse, " +
            "so you can see what <b>moves</b>, what <b>changes brightness</b>, and whether that change is real. " +
            "This one-minute guide walks you through your first look. Let's get started!" },
    { img: "2-vault.jpg", title: "Pick a door",
      text: "<b>Star Vault</b> has 19 famous targets ready to play instantly, including the five NASA challenge targets. " +
            "<b>Sky Probe</b> lets you look anywhere in the sky, live from NASA's archive (IRSA). " +
            "Press <b>✦ Explore</b> in the top bar to pick one. New here? Start in the Star Vault and spin the ring." },
    { img: "3-probe.jpg", title: "Choose where to look",
      text: "Type a position (RA and Dec, in degrees or hh:mm:ss), click a dot on the <b>sky map</b>, or pick a target, " +
            "an asteroid or a deep field from the list. Choose a <b>band</b> (D1–D6 — not sure? press <b>Which band?</b>), " +
            "then press <b>Load images</b>." },
    { img: "4-player.jpg", title: "Play the sky", fit: "top",
      text: "Press <b>Auto play</b>, or step with the arrows and frame numbers. Switch on helpers under the picture: " +
            "<b>Gaia stars</b> (known stars), <b>Predicted position</b> (where a moving star should be), " +
            "<b>Known asteroids</b>, <b>Flag objects</b> and <b>Frame labels</b>." },
    { img: "5-trust.jpg", title: "Can I trust what I see?", fit: "top",
      text: "SPHEREx sees each star at a slightly different colour in every image, so a star can seem to brighten " +
            "when nothing changed. Tick <b>Same colour only</b> to compare like with like. " +
            "The <b>Can I trust a change here?</b> card checks every frame for you." },
    { img: "6-mission.jpg", title: "Travel back 27 years",
      text: "The <b>Mission</b> view puts older NASA images — 2MASS (about 1999) and WISE (2010) — on the same pixels. " +
            "Slow movers jump: Barnard's Star moves 45 pixels. Use <b>Measure the motion</b> to time its speed and " +
            "compare it with ESA's Gaia." },
    { img: "7-asteroids.jpg", title: "Catch real asteroids",
      text: "Pick an asteroid from the list (try <b>433 Eros</b>) and turn on <b>Known asteroids</b>: orange diamonds " +
            "mark every catalogued asteroid in the frame, from NASA/JPL. The <b>Trail</b> view paints each date in its " +
            "own colour, so a mover leaves a rainbow." },
    { img: "8-toolbox.jpg", title: "Go deeper",
      text: "Below the player, the <b>toolbox</b> has 16 tools on the same images: difference images, stacks that beat " +
            "the noise, spectrum and light curve, a six-colour picture, 3D views — and <b>Report &amp; export</b> " +
            "for GIF, video, CSV and FITS." },
    { img: "9-share.jpg", title: "Share it and check it",
      text: "<b>Story mode</b> gives a guided tour of any target. <b>Copy link</b> saves exactly what you see, ready to share. " +
            "<b>Check it at NASA/IRSA</b> opens NASA's own tools for the same spot. Found something odd? Flag it. " +
            "You're ready — happy hunting!" }
  ];

  let box = null, i = 0, lastFocus = null;
  const imgBase = () => (document.querySelector('script[src$="tutorial.js"]')?.getAttribute("src") || "js/tutorial.js")
    .replace(/js\/tutorial\.js$/, "img/tutorial/");

  function build() {
    box = document.createElement("div");
    box.className = "tut-wrap"; box.hidden = true;
    box.innerHTML = `
      <div class="tut" role="dialog" aria-modal="true" aria-labelledby="tut-title">
        <div class="tut-head"><span>How to use ORBITAL</span>
          <button type="button" class="tut-x" aria-label="Close the guide">✕</button></div>
        <div class="tut-body">
          <div class="tut-img"><img alt="" decoding="async"></div>
          <h2 id="tut-title"></h2>
          <p class="tut-text"></p>
        </div>
        <div class="tut-foot">
          <button type="button" class="tut-nav tut-prev" aria-label="Previous step">‹</button>
          <div class="tut-dots" role="tablist">${STEPS.map((s, k) =>
            `<button type="button" role="tab" aria-label="Step ${k + 1}: ${s.title}" data-k="${k}"></button>`).join("")}</div>
          <button type="button" class="tut-nav tut-next" aria-label="Next step">›</button>
        </div>
        <div class="tut-end"><button type="button" class="btn sm primary tut-go">Start exploring</button></div>
      </div>`;
    document.body.appendChild(box);
    box.addEventListener("click", e => {
      if (e.target.closest(".tut-go")) { close(); if (window.Explore) window.Explore.open(); return; }
      if (e.target === box || e.target.closest(".tut-x")) return close();
      if (e.target.closest(".tut-prev")) return show(i - 1);
      if (e.target.closest(".tut-next")) return show(i + 1);
      const d = e.target.closest(".tut-dots button"); if (d) show(+d.dataset.k);
    });
    // preload the pictures so stepping is instant
    STEPS.forEach(s => { const im = new Image(); im.src = imgBase() + s.img; });
  }

  function show(k) {
    i = Math.max(0, Math.min(STEPS.length - 1, k));
    const s = STEPS[i], img = box.querySelector(".tut-img img");
    img.src = imgBase() + s.img;
    img.alt = `Screenshot: ${s.title}`;
    img.classList.toggle("top", s.fit === "top");
    box.querySelector("#tut-title").textContent = s.title;
    box.querySelector(".tut-text").innerHTML = s.text;
    box.querySelectorAll(".tut-dots button").forEach((d, n) => {
      d.classList.toggle("on", n === i); d.setAttribute("aria-selected", n === i ? "true" : "false");
    });
    box.querySelector(".tut-prev").disabled = i === 0;
    box.querySelector(".tut-next").disabled = i === STEPS.length - 1;
    box.querySelector(".tut-end").hidden = i !== STEPS.length - 1;
  }

  function onKey(e) {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") { e.preventDefault(); show(i + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); show(i - 1); }
  }

  function open(start = 0) {
    if (!box) build();
    lastFocus = document.activeElement;
    show(start);
    box.hidden = false;
    document.documentElement.classList.add("tut-open");
    document.addEventListener("keydown", onKey);
    box.querySelector(".tut-next").focus();
  }

  function close() {
    box.hidden = true;
    document.documentElement.classList.remove("tut-open");
    document.removeEventListener("keydown", onKey);
    try { localStorage.setItem(KEY, "1"); } catch (_) {}
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    document.dispatchEvent(new CustomEvent("orbital:tutorial-closed"));
  }

  function addButton() {
    const right = document.querySelector(".nav .nav-right");
    if (!right || right.querySelector(".tut-btn")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn sm ghost tut-btn"; b.title = "How to use this website";
    b.innerHTML = `<span aria-hidden="true">?</span> How to use`;
    b.addEventListener("click", () => open(0));
    right.insertBefore(b, right.firstChild);
  }

  document.addEventListener("DOMContentLoaded", () => {
    addButton();
    let seen = false;
    try { seen = localStorage.getItem(KEY) === "1"; } catch (_) { seen = true; }
    const q = new URLSearchParams(location.search);
    // a shared link that loads a view straight away should not be covered by the guide
    if (q.get("guide") === "1" || (!seen && !q.get("load"))) setTimeout(() => open(0), 600);
  });

  window.Tutorial = { open, isOpen: () => !!box && !box.hidden };
})();
