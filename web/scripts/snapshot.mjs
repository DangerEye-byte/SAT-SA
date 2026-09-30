// Captures the hosted-demo snapshot from a running SAT-SA API (read-only: it never changes the local state).
//   1. Start the API:   .venv/Scripts/python -m uvicorn satsa.api.main:app --port 8000
//   2. Capture:         cd web && npm run snapshot          (SATSA_API=http://host:port to use another API)
//   3. Build the site:  npm run build:static                -> web/dist, ready for any static host
// Files land in web/public-static/snapshot/, named with the same key as src/api.ts snapKey().
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.SATSA_API ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public-static", "snapshot");
const snapKey = (path) => path.replace(/^\/api\//, "").replace(/[?&=/]/g, "_");
const FDRS = [0.05, 0.1, 0.2];
const SEEDS = [1, 2, 3];
const CASES_PER_FINDING = 40;

let files = 0, bytes = 0;
const failed = [];
async function get(path, { method = "GET", save = true, timeout = 60000, html = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(API + path, { method, signal: ctl.signal });
    if (!r.ok) { failed.push(`${r.status} ${path}`); return null; }
    const body = html ? await r.text() : await r.json();
    if (save) {
      const text = html ? body : JSON.stringify(body);
      await writeFile(join(OUT, `${snapKey(path)}.${html ? "html" : "json"}`), text);
      files++; bytes += text.length;
    }
    return body;
  } catch (e) {
    failed.push(`${e.name === "AbortError" ? "timeout" : e.message} ${path}`);
    return null;
  } finally { clearTimeout(t); }
}
// Small worker pool so the capture is quick without flooding the API.
async function each(items, fn, n = 6) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const meta = await get("/api/meta");
if (!meta) { console.error(`No SAT-SA API at ${API}. Start it first.`); process.exit(1); }

for (const p of ["/api/ai/status", "/api/blindspot", "/api/providers", "/api/sectors", "/api/ledger?limit=200", "/api/validation", "/api/guide", "/api/gaming"]) await get(p);
for (const f of FDRS) await get(`/api/queue?fdr=${f}`);
// Read-only POSTs: verifying the chain, and the tamper demo (it edits a copy, never the real ledger).
await get("/api/ledger/verify", { method: "POST" });
await get("/api/ledger/tamper-demo", { method: "POST" });

const queue = await get("/api/queue?fdr=0.2", { save: false });
const ids = queue.entities.map((e) => e.entity_id);
const flagged = new Set(queue.entities.filter((e) => e.flagged).map((e) => e.entity_id));
const cases = new Set();
await each(ids, async (id) => {
  const e = await get(`/api/entities/${id}`);
  for (const p of ["evidence", "survival", "hourly", "regulatory", "cycle"]) await get(`/api/entities/${id}/${p}`);
  await get(`/api/redteam/${id}`);
  await get(`/api/review/${id}?reveal=false`);
  await get(`/api/entities/${id}/brief`, { html: true });
  for (const f of e?.findings ?? []) {
    const d = await get(`/api/entities/${id}/findings/${f.detector_id}`);
    if (d?.evidence_type === "case") (d.records ?? []).slice(0, flagged.has(id) ? CASES_PER_FINDING : 12).forEach((r) => cases.add(r.case_id));
  }
});
await each([...cases], (c) => get(`/api/cases/${c}`), 8);

const g = await get("/api/gaming", { save: false });
const runs = g.strategies.flatMap((s) => g.policies.flatMap((p) => SEEDS.map((seed) => `/api/gaming/run?strategy=${s}&policy=${p}&seed=${seed}`)));
await each(runs, (r) => get(r), 4);

// Explanations: only the ones already generated (recorded in the ledger), so the capture never starts the
// local model. The short timeout is a second guard: cached answers return in milliseconds.
const ledger = await get("/api/ledger?limit=100000", { save: false });
const pairs = new Set((ledger?.entries ?? []).filter((x) => x.type === "explanation_generated").map((x) => `${x.payload.entity_id}|${x.payload.detector_id}`));
let explained = 0;
for (const pair of pairs) {
  const [id, det] = pair.split("|");
  if (await get(`/api/entities/${id}/findings/${det}/explain?refresh=false`, { timeout: 4000 })) explained++;
}

await writeFile(join(OUT, "_manifest.json"), JSON.stringify({ captured_at: new Date().toISOString(), api: API, run_hash: meta.run?.run_hash, files, entities: ids.length, cases: cases.size, explanations: explained }, null, 2));
console.log(`Snapshot: ${files} files, ${(bytes / 1e6).toFixed(1)} MB, ${ids.length} entities, ${cases.size} cases, ${explained} explanations -> ${OUT}`);
if (failed.length) console.log(`Skipped ${failed.length}:\n  ${failed.slice(0, 20).join("\n  ")}${failed.length > 20 ? "\n  ..." : ""}`);
