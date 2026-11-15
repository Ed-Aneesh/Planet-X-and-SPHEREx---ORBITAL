/* =====================================================================
   vault.js — Star Vault console: chips + search + target grid (left),
   sky map + settings + "Load images" card (right). Results appear below.
   ===================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  const targets = await API.targets();
  let filter = "all", query = "", sel = null;

  const map = new SkyMap($("#skymap"), { onSelect: id => selectTarget(id) });
  map.setTargets(targets);

  await Explorer.init({
    getQuery: () => {
      if (!sel) throw new Error("Choose a target first.");
      // target id gives the backend the proper motion; ra/dec is the fallback for an older backend
      // source=drive: Star Vault reads ONLY the team's Google Drive copy, never the IRSA API
      return { target: sel.id, ra: sel.ra, dec: sel.dec, source: "drive" };
    },
    radiusChoices: "vault"
  });

  /* ---------- chips + search ---------- */
  const CHIPS = [
    { id: "all", label: "All" }, { id: "challenge", label: "Challenge" },
    { id: "moves", label: "Moves" }, { id: "varies", label: "Varies" }, { id: "exploded", label: "Exploded" }
  ];
  function renderChips() {
    $("#chips").innerHTML = CHIPS.map(c => {
      const n = c.id === "all" ? targets.length : targets.filter(x => x.tags.includes(c.id)).length;
      return `<button type="button" class="chip ${c.id === filter ? "on" : ""}" data-id="${c.id}">${c.label} <b>${n}</b></button>`;
    }).join("");
  }
  $("#chips").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return;
    filter = b.dataset.id; renderChips(); renderCards();
  });
  $("#vault-search").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); renderCards(); });

  /* ---------- the orbit: all 19 targets on one ring ---------- */
  const mainTag = x => ["challenge", "moves", "exploded", "varies"].find(t => x.tags.includes(t)) || "varies";
  const ring = $("#orbit-ring"), N = targets.length;
  let R = 0;                                                   // ring rotation, degrees
  // ring labels must fit the ~78 px between neighbouring dots on one line; full names are in the centre and tooltip
  const RING_NAME = { epsindib: "Eps Indi B", wise0855: "WISE 0855", proxima: "Proxima Cen", sgra: "Sgr A*", casa: "Cas A" };
  const short = n => n.replace(/^(\S+)\s(\S+)\s(.+)$/, "$1 $2\n$3");
  ring.innerHTML = targets.map((x, k) => `
    <div class="onode" style="--a:${(360 * k / N).toFixed(3)}deg" data-id="${x.id}">
      <button type="button" class="obtn t-${mainTag(x)}" data-id="${x.id}" role="option" title="${x.name} — ${x.kind}">
        <i></i><span>${RING_NAME[x.id] || x.name}</span></button></div>`).join("");
  const matches = x => (filter === "all" || x.tags.includes(filter)) &&
    (!query || (x.name + " " + x.kind + " " + x.why).toLowerCase().includes(query));
  function renderCards() {
    targets.forEach(x => {
      const b = $(`.obtn[data-id="${x.id}"]`, ring);
      b.classList.toggle("dim", !matches(x));
      b.classList.toggle("on", !!sel && sel.id === x.id);
      b.setAttribute("aria-selected", String(!!sel && sel.id === x.id));
    });
    const n = targets.filter(matches).length;
    if (!sel) return;
    const t = sel, f = (window.FACTS || {})[t.id] || {}, pm = Math.hypot(t.pmEast || 0, t.pmNorth || 0) / 1000;
    $("#orbit-core").innerHTML =
      `<span class="oc-num mono">${String(t.n).padStart(2, "0")} / ${N}${n < N ? ` · ${n} match` : ""}</span>` +
      `<span class="vtag t-${mainTag(t)}">${mainTag(t)}</span>` +
      `<h3>${t.name}</h3><p class="oc-kind">${t.kind}</p><p class="oc-why">${t.why}</p>` +
      `<div class="oc-stats">${f.distance ? `<span><b>${f.distance}</b>away</span>` : ""}` +
      `<span><b>${pm > 0.05 ? pm.toFixed(2) + "″/yr" : "fixed"}</b>motion</span><span><b>${t.defaultBand || "D2"}</b>best band</span></div>` +
      `<button type="button" class="btn go-btn oc-go" id="oc-go">Load images ↗</button>`;
    $("#oc-go").onclick = () => $("#load-btn").click();
    // keep the name on ONE line: shrink the font until it fits the circle
    const h = $("#orbit-core h3"); h.style.removeProperty("--fit");
    let fs = parseFloat(getComputedStyle(h).fontSize);
    const room = $("#orbit-core").clientWidth * 0.82;
    while (h.scrollWidth > room && fs > 12) { fs -= 1; h.style.setProperty("--fit", fs + "px"); }
  }
  function spin(k) {                                           // turn target k to 12 o'clock, the short way round
    const want = -360 * k / N; let d = ((want - R) % 360 + 540) % 360 - 180;
    R += d; ring.style.setProperty("--R", R + "deg");
  }
  ring.addEventListener("click", e => { const b = e.target.closest(".obtn"); if (b) selectTarget(b.dataset.id); });
  const step = d => { const k = sel ? targets.indexOf(sel) : 0; selectTarget(targets[(k + d + N) % N].id); };
  $("#orbit-prev").addEventListener("click", () => step(-1));
  $("#orbit-next").addEventListener("click", () => step(1));
  let lastWheel = 0;
  $("#orbit").addEventListener("wheel", e => {                 // scroll the wheel to turn the ring
    if (Math.abs(e.deltaY) < 4) return; e.preventDefault();
    const now = Date.now(); if (now - lastWheel < 220) return; lastWheel = now;
    step(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  function selectTarget(id) {
    sel = targets.find(x => x.id === id);
    if (!sel) return;
    $("#sel-name").textContent = sel.name;
    $("#sel-coords").textContent = `RA ${sel.ra.toFixed(4)}° · Dec ${sel.dec >= 0 ? "+" : ""}${sel.dec.toFixed(4)}°`;
    $("#ra").value = sel.ra; $("#dec").value = sel.dec;
    const pm = Math.hypot(sel.pmEast || 0, sel.pmNorth || 0) / 1000;
    $("#pm-note").innerHTML = epochNote(sel);
    $("#band").value = sel.defaultBand || "D2";
    setStatus($("#status"), "");
    history.replaceState(null, "", `?target=${encodeURIComponent(sel.id)}`);
    map.select(sel.id);
    spin(targets.indexOf(sel));
    renderCards();
  }

  /* ---------- map collapse ---------- */
  $("#map-toggle").addEventListener("click", e => {
    const open = $("#map-body").hidden;
    $("#map-body").hidden = !open;
    e.currentTarget.textContent = open ? "−" : "+";
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });

  /* the zoomable sky atlas lives in sky.js (Sky.atlas) */

  API.health().then(ok => {
    if (ok && !API.staleBackend) {
      $("#backend-status").textContent = "● Star Vault plays real SPHEREx files from the team's Google Drive copy (no live archive calls)";
      $("#backend-status").className = "mono status ok";
    }
  });
  if (API.staleBackend) {
    setStatus($("#backend-status"), "⚠ The backend is running old code. Stop it (Ctrl+C) and start it again: python main.py", "warn");
  }
  renderChips();
  renderCards();
  selectTarget(new URLSearchParams(location.search).get("target") || "barnard");
});
