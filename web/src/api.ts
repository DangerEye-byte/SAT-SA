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
};
export type Entity = QueueEntity & {
  declared_log_sources: string[]; n_assets: number; n_analysts: number; sla_critical_min: number;
  trust_completeness: number; trust_temporal: number; trust_timeliness: number; trust_coverage: number;
  findings: Finding[]; monthly: any[]; tactics: { tactic: string; state: string; observed: number; expected: number; p: number | null }[];
  provider: any;
};

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const post = <T,>(path: string, body?: unknown) =>
  http<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

export const api = {
  meta: () => http<any>("/api/meta"),
  queue: (fdr: number) => http<Queue>(`/api/queue?fdr=${fdr}`),
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
};

export const fmtP = (p: number | null | undefined) =>
  p == null ? "—" : p < 1e-6 ? "< 10⁻⁶" : p < 0.001 ? p.toExponential(1) : p.toFixed(3);
export const pct = (x: number | null | undefined, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
