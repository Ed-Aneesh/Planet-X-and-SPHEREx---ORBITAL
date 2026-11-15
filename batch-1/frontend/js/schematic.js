/* =====================================================================
   schematic.js — drawn dots for the HOME PAGE explainer only.
   Never used for the explorer, never presented as data (labelled
   "SCHEMATIC — NOT REAL DATA" on the canvas).
   Same physics conventions as the backend: one shared stretch, one fixed
   grid, a mover drifting at constant speed, a variable changing brightness.
   ===================================================================== */

function makeSchematic() {
  const N = 64, nFrames = 6;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stars = Array.from({ length: 22 }, () => ({ x: rnd() * N, y: rnd() * N, f: 20 + rnd() * 180 }));
  const raw = [];
  for (let v = 0; v < nFrames; v++) {
    const px = new Float32Array(N * N);
    for (let i = 0; i < px.length; i++) px[i] = (rnd() - 0.5) * 4;
    const add = (x, y, f) => {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
        px[j * N + i] += f * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / 2.2);
    };
    stars.forEach(s => add(s.x, s.y, s.f));
    const mover = { x: N / 2 - 6 + v * 2.2, y: N / 2 + 3 - v * 1.1 };
    add(mover.x, mover.y, 120);                                    // constant-speed mover
    add(N * 0.25, N * 0.7, 60 + 140 * Math.abs(Math.sin(v * 1.3))); // variable
    if (v === 3) for (let j = 0; j < 8; j++) for (let i = 0; i < N; i++) px[j * N + i] = NaN;  // missing strip
    raw.push({ px, mover });
  }
  // ONE shared stretch for all frames
  const all = raw.flatMap(r => Array.from(r.px).filter(Number.isFinite)).sort((a, b) => a - b);
  const lo = all[Math.floor(all.length * 0.01)], hi = all[Math.floor(all.length * 0.995)];
  const cv = document.createElement("canvas"); cv.width = cv.height = N;
  const cx = cv.getContext("2d");
  const frames = raw.map((r, v) => {
    const img = cx.createImageData(N, N);
    for (let k = 0; k < N * N; k++) {
      const val = r.px[k];
      const g = Number.isFinite(val) ? Math.round(255 * Math.asinh(10 * Math.min(1, Math.max(0, (val - lo) / (hi - lo)))) / Math.asinh(10)) : 0;
      img.data[4 * k] = img.data[4 * k + 1] = img.data[4 * k + 2] = g;
      img.data[4 * k + 3] = Number.isFinite(val) ? 255 : 0;
    }
    cx.putImageData(img, 0, 0);
    return { index: v, visit: v + 1, date: `visit ${v + 1}`, marker: r.mover, png: cv.toDataURL("image/png") };
  });
  return { schematic: true, sizePixels: N, pixelArcsec: 6.15, frames };
}
