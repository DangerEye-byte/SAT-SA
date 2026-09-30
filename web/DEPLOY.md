# Hosting the SAT-SA demo

SAT-SA is built to run offline on the regulator's own machine (`run.bat`: API and UI on one port). The
**hosted demo** is a static copy of the frontend for anyone to click through: it reads a snapshot of real API
responses from a local run, needs no server, and never saves anything (decisions, labels and uploads explain
that they need the local install). It is labelled "Hosted demo" in the top bar.

## Refresh the snapshot (whenever the analysis changes)

1. Start the API locally: `.venv/Scripts/python -m uvicorn satsa.api.main:app --port 8000`
2. Optional: prepare the state you want visitors to see first (for example `python -m satsa.reset_demo` with
   the API stopped, then a Review lab sample with some simulated labels so the prediction-powered interval shows).
3. `cd web && npm run snapshot`: about 2 to 3 minutes, read-only, writes `web/public-static/snapshot/` (~6 MB).
   It only includes AI explanations that were already generated (`python -m satsa.ai.warm --top 10` first to add more).
4. Check it: `npm run build:static && npm run preview:static`, then open http://localhost:4173.
5. Commit `web/public-static/` so the host can build it.

## Deploy

**Vercel**: New Project, import the repository, set **Root Directory** to `web`. Everything else comes from
`web/vercel.json` (build `npm run build:static`, output `dist`, client-side routing).

**Netlify**: New site from Git, **Base directory** `web`. `web/netlify.toml` sets the build and routing.

**Any other static host**: run `npm run build:static` and upload `web/dist/`, with every unknown path
rewritten to `/index.html` (paths under `/snapshot/` and `/assets/` must be served as files).

## Pointing the frontend at a live API instead (optional)

Build with `VITE_API_BASE=https://your-satsa-host npm run build` to call an API on another origin. That API
must then allow the site's origin (CORS), which `satsa/api/main.py` does not do today; the simpler route is a
host rewrite that proxies `/api/*` to the backend so the browser sees one origin.
