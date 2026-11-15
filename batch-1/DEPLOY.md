# How to upload ORBITAL — no Git needed

This folder holds two things:

| Folder | Goes to | Why |
|---|---|---|
| `1-GitHub-repo/` (4 batches) | **GitHub**, one repository | Render can only run the Python backend from a GitHub repository |
| `2-Website/` | **Cloudflare**, **Vercel**, **GitHub Pages** | The website itself (60 files, ready to serve) |

Do the steps **in this order**. Nothing here contains your Google key; that goes only into Render (step 2).

---

## 1. GitHub repository (about 5 minutes)

1. Go to **github.com/new**. Repository name: `orbital-spherex`. Choose **Public**. Leave every "Add …" box
   unticked. Click **Create repository**.
2. On the new, empty page, click the link **"uploading an existing file"**. Later uploads use
   **Add file → Upload files**.
3. Open `1-GitHub-repo\batch-1` in File Explorer. Press **Ctrl+A** to select **everything inside it** and
   drag it onto the GitHub page. Wait until every file is listed, then click **Commit changes**.
   GitHub allows at most 100 files per upload, so the project is split into batches.
4. Do the same with **batch-2**, then **batch-3**, then **batch-4**, each with **Add file → Upload files** on the
   repository's main page. Drop each batch's *contents* on the main page, not inside a folder: the `backend`
   folders in the batches merge by themselves.
5. Check: the repository's top level shows `backend`, `frontend`, `.gitignore`, `DEPLOY.md`, `LICENSE`,
   `README.md` and `render.yaml`. `backend/data/context` should hold about 100 small `.json` files.

## 2. Backend on Render (about 10 minutes, mostly waiting)

1. Go to **render.com** and **sign up with GitHub**, allowing it to see `orbital-spherex`.
2. Click **New + → Blueprint** and pick `orbital-spherex`. Render reads `render.yaml` by itself.
3. It asks for two secret values:
   - `DRIVE_FOLDER_ID`: the long id at the end of the team Drive folder's web address. It is the same value
     as in `backend\local.settings` on your PC.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: open your service-account key file in Notepad, **copy all of it** and paste it.
4. Click **Apply** and wait until the service says **Live** (the first build takes a few minutes).
5. Open `https://<your-service>.onrender.com/api/health`. It must show `"ok": true`.
   `https://<your-service>.onrender.com/` is already a complete working copy of the site.

## 3. Check the backend address

Look at the address Render gave you. If it is **not** exactly `https://orbital-spherex.onrender.com`:
open `2-Website\js\config.js` in Notepad, change the address on the `window.ORBITAL_BACKEND = "…"` line to
yours (no slash at the end), and save. Do this **before** steps 4–6.

## 4. Cloudflare Pages

1. Go to **dash.cloudflare.com → Workers & Pages → Create application** and choose
   **Drag and drop your files** (Get started).
2. Project name: `orbital-spherex`. Drag the whole **`2-Website`** folder in and click **Deploy**.
3. The site is at `https://orbital-spherex.pages.dev`, or at the name Cloudflare shows.

## 5. Vercel

1. **Sign in first** at vercel.com. Without an account, a drop is temporary and expires.
2. Go to **vercel.com/drop**, drag the whole **`2-Website`** folder in, give it a project name, and click **Deploy**.
3. The site is at `https://<project>.vercel.app`.

## 6. GitHub Pages

1. **github.com/new**: name `orbital-website`, **Public**, then **Create repository**.
2. Click **uploading an existing file**, open `2-Website`, press **Ctrl+A**, drag everything in, and click
   **Commit changes**.
3. In the repository go to **Settings → Pages**. Set **Source: Deploy from a branch**, **Branch: main**,
   folder **/ (root)**, then click **Save**.
4. After 1–2 minutes the site is at `https://<your-github-username>.github.io/orbital-website/`.

## 7. Keep the backend awake for judging

Render's free server sleeps after 15 minutes with no visitors and takes about a minute to wake. On
**cron-job.org**, make a free job that opens `https://<your-service>.onrender.com/api/health` every
**14 minutes**.

## 8. Final check (on every address, and on a phone)

1. The site opens in light mode. Close the guide, and the "Switch to dark mode" bubble appears.
2. **✦ Explore → Star Vault → Barnard's Star → Load images** → frames play. This needs the Drive secrets from step 2.
3. **✦ Explore → Sky Probe →** WISE 0855 (RA 08h55m10.831s, Dec −07d14m42.53s) **→ Load images** → frames play.
4. **Copy link** → open it in a private window → the same view loads.

If a page says "The ORBITAL server is not answering", open `/api/health` on Render. If it is not `ok`, read
the **Logs** tab on Render.

## Updating later

- **GitHub:** upload the changed file again to the same folder, which replaces it. Render redeploys by itself.
- **Cloudflare:** open the project, choose **Create new deployment**, and drag `2-Website` in again.
- **Vercel:** drag `2-Website` onto the project in the dashboard.
- **GitHub Pages:** upload the changed files to `orbital-website`.
