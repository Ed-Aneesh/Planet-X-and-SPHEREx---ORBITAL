/* =====================================================================
   decor.js — the character star field (idea from mauricemoynihan.com's
   ASCII dot field). Static: drawn once from a fixed seed, redrawn only on
   resize. Density rises toward the bottom, like the Milky Way's band.
   Purely decorative (aria-hidden), no data.
   ===================================================================== */
(function () {
  const CHARS = " .  .   ·  :  .  *  +  ✳";      // light -> heavy
  function draw(el) {
    const cw = 7.2, ch = 12;                       // Space Mono 12px cell
    const cols = Math.ceil(el.clientWidth / cw) + 2;
    const rows = Math.ceil(el.clientHeight / ch);
    let seed = 20261114;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const lines = [];
    for (let r = 0; r < rows; r++) {
      const depth = (r + 1) / rows;               // 0 top .. 1 bottom
      let line = "";
      for (let c = 0; c < cols; c++) {
        const x = rnd();
        if (x > 0.2 + 0.72 * depth) { line += " "; continue; }
        const k = Math.min(CHARS.length - 1, Math.floor(rnd() * (6 + depth * (CHARS.length - 6))));
        line += CHARS[k];
      }
      lines.push(line);
    }
    el.textContent = lines.join("\n");
  }
  function all() { document.querySelectorAll(".starfield").forEach(draw); }
  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(all, 200); });
  document.addEventListener("DOMContentLoaded", all);
})();
