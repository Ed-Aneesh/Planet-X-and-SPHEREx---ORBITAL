# ORBITAL frontend (plain version)

Plain HTML + CSS + JavaScript. No framework, no build step, no background, no animations.
Design comes later; all buttons already work.

## Files

| File | What it does |
|---|---|
| `index.html` | Home page: hero, doors, blink demo, pipeline, targets + Aladin, spectrum, tools, compare, glossary |
| `vault.html` | **Star Vault**: filter chips, search, numbered target cards, controls, player, exports, Aladin |
| `probe.html` | **Sky Probe**: type RA/Dec (or a name, or click the Aladin map), then probe |
| `css/style.css` | Layout only. Replace freely when the design is agreed |
| `js/content.js` | **All text and data** (targets, bands, glossary). Edit words here, not in HTML |
| `js/core.js` | Shared helpers: text filling, nav, RA/Dec parsing, Aladin loader |
| `js/api.js` | The only file that talks to the Python backend (start job, poll progress) |
| `js/player.js` | Player: auto play, step, click frames, blink A↔B |
| `js/home.js`, `js/vault.js`, `js/probe.js` | Page wiring |

## Run it

Start the Python backend; it serves this website too:

```
cd backend
python main.py
```
Open http://127.0.0.1:8765/

Without the backend the explorer pages say "Backend not running". The home page blink demo is a
labelled schematic. Aladin Lite needs internet.

## New files (v2)
- `js/explorer.js`: shared controls for Star Vault and Sky Probe. Inputs are RA, Dec, radius,
  band, and either a time range or all dates. Output: auto play at the chosen FPS, clickable
  frame buttons, and a blink between frames A and B chosen from dropdowns.
- `js/player.js`: draws the backend's PNG frames, the proper-motion ring, the compass and a
  1′ scale bar.
- `js/schematic.js`: drawn dots for the home-page explainer only.

## Hosting
The pages are plain static files, so any static host can serve this folder (Cloudflare Pages,
GitHub Pages, Vercel). The backend runs on Render. `js/config.js` holds the backend address.
Full steps: `DEPLOY.md` at the top of the repository.
