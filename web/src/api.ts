// Typed client for the SAT-SA API. Contract: docs/API.md
export type Reason = { detector_id: string; name: string; p_value: number | null; effect: string; deterministic?: boolean; severity?: string };
export type QueueEntity = {
  entity_id: string; entity_name: string; sector: string; sector_name: string; size_band: string; soc_provider: string;
  claims_24x7: boolean; p_value: number; q_value: number; attention: number; trust_score: number; n_tests: number;
  n_deterministic: number; flagged: boolean; flag_basis: "statistical" | "deterministic" | "both" | null;
  top_reasons: Reason[]; capabilities: Record<string, number>; sparkline: number[];
};
export type Queue = {
  fdr: number; n_entities: number; n_flagged: number; n_flagged_statistical: number; n_flagged_deterministic: number;
  expected_false_discoveries_max: number; entities: QueueEntity[];
};
export type Finding = {
  entity_id: string; detector_id: string; name: string; family: string; capability: string; method: string;
  regulations: string[]; p_value: number | null; deterministic: boolean; severity: string | null; n: number; k: number;
  rate: number | null; peer_rate: number | null; effect: string; reason: string; evidence: string[]; evidence_type: string;
  score: number; significant: boolean; extra: any; records?: any[];
  disposition?: { status: string; reason?: string; examiner?: string; ts?: string };
};
export type Entity = QueueEntity & {
  declared_log_sources: string[]; n_assets: number; n_analysts: number; sla_critical_min: number;
  trust_completeness: number; trust_temporal: number; trust_timeliness: number; trust_coverage: number;
  findings: Finding[]; monthly: any[]; tactics: { tactic: string; state: string; observed: number; expected: number; p: number | null }[];
  provider: any;
  quarterly: { look: number; quarter: string; p_value: number; e_value: number; cum_e: number; ebh_flag: boolean; naive_bh_flag: boolean }[];
};

// Two ways to build the frontend (docs: web/DEPLOY.md):
//  - default: served by the SAT-SA API itself (same origin, fully offline). VITE_API_BASE can point it at an
//    API on another origin instead.
//  - hosted demo (VITE_STATIC=1): no server at all. Reads a snapshot of real API responses captured from a
//    local run (scripts/snapshot.mjs); anything that would change state explains that it needs the local install.
const BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");
export const STATIC = import.meta.env.VITE_STATIC === "1";
// Same key function as scripts/snapshot.mjs: "/api/queue?fdr=0.1" -> "queue_fdr_0.1".
export const snapKey = (path: string) => path.replace(/^\/api\//, "").replace(/[?&=/]/g, "_");
// Captured POSTs that do not change anything (the ledger check and the tamper demo, which edits a copy).
const SAFE_POSTS = new Set(["ledger_verify", "ledger_tamper-demo"]);
const READ_ONLY = "This is the hosted demo, so nothing is saved here. Decisions, review labels and uploads are recorded when SAT-SA runs on the examiner's own machine.";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  if (STATIC) {
    const key = snapKey(path);
    if (init?.method === "POST" && !SAFE_POSTS.has(key)) throw new Error(READ_ONLY);
    const r = await fetch(`${import.meta.env.BASE_URL}snapshot/${key}.json`);
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.includes("json")) {
      throw new Error(path.includes("/explain")
        ? "Explanations are written by a local model on the examiner's machine. This hosted demo includes the ones generated for the headline findings."
        : "This view is not part of the hosted demo snapshot. Everything is available when SAT-SA runs locally.");
    }
    return r.json();
  }
  const r = await fetch(BASE + path, init);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const post = <T,>(path: string, body?: unknown) =>
  http<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

export const api = {
  meta: () => http<any>("/api/meta"),
  queue: (fdr: number, sector?: string) => http<Queue>(`/api/queue?fdr=${fdr}${sector ? `&sector=${sector}` : ""}`),
  entity: (id: string) => http<Entity>(`/api/entities/${id}`),
  finding: (id: string, det: string) => http<Finding>(`/api/entities/${id}/findings/${det}`),
  hourly: (id: string) => http<any>(`/api/entities/${id}/hourly`),
  entityReg: (id: string) => http<any>(`/api/entities/${id}/regulatory`),
  redteam: (id: string) => http<any>(`/api/redteam/${id}`),
  caseDetail: (id: string) => http<any>(`/api/cases/${id}`),
  blindspot: () => http<any>("/api/blindspot"),
  providers: () => http<any[]>("/api/providers"),
  review: (id: string, reveal = false) => http<any>(`/api/review/${id}?reveal=${reveal}`),
  reviewSample: (id: string) => post<any>(`/api/review/${id}/sample?n_random=30&n_active=10`),
  reviewLabel: (id: string, case_id: string, label: number) => post<any>(`/api/review/${id}/label`, { case_id, label, reviewer: "examiner", blind_first: true }),
  reviewSimulate: (id: string, n = 5) => post<any>(`/api/review/${id}/simulate?n=${n}`),
  reviewReset: (id: string) => post<any>(`/api/review/${id}/reset`),
  ledger: () => http<any>("/api/ledger?limit=200"),
  ledgerVerify: () => post<any>("/api/ledger/verify"),
  ledgerTamper: () => post<any>("/api/ledger/tamper-demo"),
  validation: () => http<any>("/api/validation"),
  guide: () => http<any>("/api/guide"),
  ingest: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return http<any>("/api/ingest/validate", { method: "POST", body: fd });
  },
  ingestCommit: (token: string) => post<{ job_id: string }>(`/api/ingest/commit/${token}`),
  job: (id: string) => http<any>(`/api/jobs/${id}`),
  evidence: (id: string) => http<any>(`/api/entities/${id}/evidence`),
  survival: (id: string) => http<any>(`/api/entities/${id}/survival`),
  cycle: (id: string) => http<any>(`/api/entities/${id}/cycle`),
  setDisposition: (id: string, det: string, status: string, reason = "") =>
    post<any>(`/api/entities/${id}/findings/${det}/disposition`, { status, reason, examiner: "examiner" }),
  briefUrl: (id: string) => (STATIC ? `${import.meta.env.BASE_URL}snapshot/entities_${id}_brief.html` : `${BASE}/api/entities/${id}/brief`),
  redteamUpload: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return http<any>(`/api/entities/${id}/redteam`, { method: "POST", body: fd });
  },
  sectors: () => http<any[]>("/api/sectors"),
  explain: (id: string, det: string, refresh = false) => http<any>(`/api/entities/${id}/findings/${det}/explain?refresh=${refresh}`),
  aiStatus: () => http<any>("/api/ai/status"),
  gaming: () => http<any>("/api/gaming"),
  // The hosted demo carries three replayed years per cell; "Replay another year" cycles through them.
  gamingRun: (strategy: string, policy: string, seed = 1) => http<any>(`/api/gaming/run?strategy=${strategy}&policy=${policy}&seed=${STATIC ? ((seed - 1) % 3) + 1 : seed}`),
};

export const fmtP = (p: number | null | undefined) =>
  p == null ? "n/a" : p < 1e-6 ? "< 10⁻⁶" : p < 0.001 ? p.toExponential(1) : p.toFixed(3);
export const pct = (x: number | null | undefined, d = 0) => (x == null ? "n/a" : `${(x * 100).toFixed(d)}%`);
// "p = 0.012" or "p < 10⁻⁶" (never "p = < …").
export const pEq = (p: number | null | undefined) => { const s = fmtP(p); return s.startsWith("<") ? `p ${s}` : `p = ${s}`; };
