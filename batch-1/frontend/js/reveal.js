/* =====================================================================
   reveal.js — scroll animations for the home page.
   - Sections' parts fade and rise into view (staggered).
   - Highlighted phrases (<mark class="hl">, the <b> words in the idea list,
     glossary-style terms) get a highlighter sweep as they scroll past.
   - Pipeline: the step nearest the middle of the screen "pops" and a
     progress line fills as you scroll through the five steps.
   Respects "reduce motion": everything is simply shown.
   ===================================================================== */
(function () {
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function setup() {
    // 1. things that rise into view
    const groups = [
      ["#idea .sec-head, #pipeline .sec-head, #targets .sec-head, #spectrum .sec-head, #tools .sec-head", 0],
      ["#idea .idea-lead, #idea .try-card", 120],
      ["#idea .opt", 140],
      ["#pipeline-steps > li", 130],
      ["#tools-grid > *", 70],
      [".sci-cta", 0]
    ];
    groups.forEach(([sel, step]) => $$(sel).forEach((el, i) => {
      el.classList.add("rv"); el.style.setProperty("--d", (i * step) + "ms");
    }));
    // 2. phrases that get a highlighter sweep
    $$("#idea .opt b, #pipeline-steps h3").forEach(el => el.classList.add("hl-u"));

    if (reduce || !("IntersectionObserver" in window)) {
      $$(".rv, .hl, .hl-u").forEach(el => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      io.unobserve(e.target);
    }), { rootMargin: "0px 0px -12% 0px", threshold: 0.15 });
    $$(".rv").forEach(el => io.observe(el));
    // highlights trigger a little later, when the phrase is well inside the screen
    const io2 = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      io2.unobserve(e.target);
    }), { rootMargin: "0px 0px -30% 0px", threshold: 1 });
    $$(".hl, .hl-u").forEach(el => io2.observe(el));

    // 3. pipeline: active step + progress line
    const list = document.getElementById("pipeline-steps");
    if (!list) return;
    const steps = $$("#pipeline-steps > li");
    const bar = document.createElement("div"); bar.className = "pipe-progress"; bar.innerHTML = "<i></i>";
    list.parentNode.insertBefore(bar, list);
    let ticking = false;
    function update() {
      ticking = false;
      const mid = innerHeight * 0.55, r = list.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (mid - r.top) / Math.max(1, r.height + innerHeight * 0.25)));
      bar.style.setProperty("--p", p.toFixed(3));
      const k = Math.min(steps.length - 1, Math.floor(p * steps.length));
      steps.forEach((s, i) => { s.classList.toggle("now", r.top < mid && r.bottom > 0 && i === k); s.classList.toggle("done", r.top < mid && i < k); });
    }
    addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener("resize", update);
    update();
  }
  // home.js fills the pipeline after DOMContentLoaded; run after it
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(setup, 0));
  else setTimeout(setup, 0);
})();
