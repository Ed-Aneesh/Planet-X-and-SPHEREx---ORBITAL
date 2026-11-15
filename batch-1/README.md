# ORBITAL: watch the infrared sky change

**NASA Space Apps Challenge 2026 · Team "Planet X and SPHERE x – ORBITAL"**

Type any position in the sky, or pick one of 19 ready targets. ORBITAL plays every real SPHEREx near-infrared image
of that spot as a short video, so moving stars, brown dwarfs, asteroids and variable stars stand out at a glance.
All images come from NASA/IPAC IRSA. There is no mock data.

- **Star Vault:** 19 curated targets, including the 5 challenge targets, from the team's saved copy of the IRSA files.
  It works even when the archive is slow.
- **Sky Probe:** any RA/Dec, fetched live from NASA/IPAC IRSA.
- **Same colour only:** each SPHEREx image sees a slightly different wavelength, so a red star can look brighter
  when nothing has changed. This switch compares only like with like.
- **Gaia overlays, the 1999/2010 Mission view, known asteroids, Measure the motion, Story mode, and Copy link.**

## Layout
| Folder | What it is |
|---|---|
| `frontend/` | The website: plain HTML, CSS and JavaScript with no build step |
| `backend/` | Python server: IRSA and Drive access, frame alignment, the Science Lab |
| `render.yaml` | Tells Render how to run the backend |
| `DEPLOY.md` | How to host it |

## Run it on your own computer
```
cd backend
pip install -r requirements.txt
python main.py
```
Open http://127.0.0.1:8765/

Data: SPHEREx DR1+QR3 (NASA/JPL-Caltech/IPAC), 2MASS and WISE via NASA/IPAC IRSA; Gaia DR3 (ESA/Gaia/DPAC);
sky maps by Aladin Lite (CDS). Full credits are on the site's Credits page.
