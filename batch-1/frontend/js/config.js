/* config.js — where the Python backend lives, for hosted copies of the site.

   - On your own computer (python main.py) leave this alone: the backend serves the site itself.
   - When the site is on Cloudflare Pages, GitHub Pages or Vercel, the pages are static files and
     the backend runs on Render. Put your Render address below (no slash at the end), e.g.
       "https://orbital-spherex.onrender.com"
   The site always tries "same server" first, so the Render copy of the site keeps working too. */
window.ORBITAL_BACKEND = "https://orbital-spherex.onrender.com";

if (window.ORBITAL_BACKEND && !/^(localhost|127\.0\.0\.1|\[::1\])?$/.test(location.hostname)) {
  window.API_BASE = window.ORBITAL_BACKEND;
}
