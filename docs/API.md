# SAT-SA API contract

Base URL: `http://localhost:8000`. All endpoints are JSON. CORS is open (`*`) so a Vite dev server on another port works.
Interactive docs: `http://localhost:8000/docs` (auto-generated OpenAPI).
**Real example payloads** (trimmed with `"...(N more)"` markers) are in [`docs/api-examples/`](api-examples/). Read them before you build a screen.

Conventions:
- `p_value`: calibrated p-value; smaller means stronger evidence. `null` means not applicable or a deterministic finding.
- `q_value`: Benjamini–Hochberg adjusted p-value across entities. An entity is statistically flagged when `q_value <= fdr`.
- `attention`: a 0–100 manager-facing index derived from q (= min(100, 20·(−log10 q))). Deterministic findings give 70 (high) or 45 (medium).
- Timestamps are ISO-8601 strings (local time, no timezone).
- `flag_basis`: `"statistical"` (FDR-controlled), `"deterministic"` (a documented fact such as a blind spot, clock fault or red-team miss), `"both"`, or `null`.

---

## Meta
| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ok, version}` |
| GET | `/api/meta` | `{run: {run_hash, input_hash, code_hash, version, seed, counts{table:rows}, n_findings, seconds, created}, detectors: [{detector_id, name, family, capability, method, regulations[]}], capabilities[8], tactics[14], sectors{code:name}, log_sources{code:label}, providers[], period{start,end}}` |

Detector ids: `EG1–EG7, EG11–EG13` are execution gaps. `NS1–NS3, NS5, NS7–NS9` are negative space. `RT1` is red-team reconciliation. `NS3, NS8, NS9, RT1` are **deterministic**.

## Supervisory queue (home screen)
`GET /api/queue?fdr=0.10&sector=PWR&provider=MSSP-3` (`fdr` is 0.001–0.5; `sector` and `provider` are optional)

```
{fdr, n_entities, n_flagged, n_flagged_statistical, n_flagged_deterministic,
 expected_false_discoveries_max,       // = fdr * n_flagged_statistical, for "at most ~1.8 of these may be false alarms"
 entities: [{entity_id, entity_name, sector, sector_name, size_band, soc_provider, claims_24x7,
             p_value, q_value, attention, trust_score (0-100), n_tests, n_deterministic,
             flagged, flag_basis, top_reasons: [{detector_id, name, p_value|null, effect, deterministic?, severity?}],
             capabilities: {<capability>: 0-100}, sparkline: [12 monthly mean model scores]}]}
```
Sorted: flagged first, then attention desc. **Re-query when the FDR slider moves**; it's cheap (~0.3 s).

## Entity dossier
`GET /api/entities` returns a lightweight list for pickers.

`GET /api/entities/{id}` (add `?all_detectors=true` to include non-significant detector rows)
```
{...entity fields, p_value, q_value, attention, capabilities{}, top_reasons[], declared_log_sources[],
 trust_score, trust_completeness, trust_temporal, trust_timeliness, trust_coverage (0-1 each),
 findings: [{detector_id, name, family ("Execution gap"|"Negative space"), capability, method, regulations[],
             p_value, deterministic, severity ("high"|"medium"|null), n, k, rate, peer_rate, effect, reason,
             evidence[<=10 ids], evidence_type ("case"|"asset"|"alert"|"tactic"|"detector"|"technique"|"period"),
             score (0-100), significant, extra{small}}],   // sorted by score desc
 monthly: [{period "YYYY-MM", cases, fast_share, no_investigation_share, templated_share, median_ttc_critical,
            escalation_rate_critical, mean_superficial_score}],
 tactics: [{tactic, state ("covered"|"quiet"|"blind"|"not_applicable"), observed, expected, p, supportable}],
 provider: {provider, n_clients, clients[], sectors[], rate, others_rate, p_value, client_rates{}} }
```

`GET /api/entities/{id}/findings/{detector_id}?limit=40` returns the full finding plus resolved `records[]`:
- `evidence_type=case`: `records` = case rows `{case_id, severity, category, tactic, asset_id, opened_ts, ack_ts, closed_ts, ttc_min, ack_min, escalated, disposition, n_investigate, p_fast, templated, yhat, notes, injection_like}`
- `evidence_type=asset`: asset rows. `alert`: alert rows. Otherwise `[{id}]`.
- `extra` by detector:
  - **EG6** `extra.chart = {bins[], observed[], counterfactual[], sla, window[lo,hi], excess, missing_above, ratio, p}`. This is the **bunching chart**: bars = observed, line = counterfactual, shade the window below the SLA.
  - **EG3** `extra.clusters = [{count, example, cases[]}]`. This is the **template diff view**.
  - **EG5** `extra.violations = {rule: count}`
  - **EG12** `extra.median_latency_h, unreported`
  - **NS1** `extra.assets = [{asset_id, asset_class, obs_quarter, expected_quarter, obs_prior, expected_from_own_history, p, basis ("stopped"|"peer")}]`
  - **NS3** `extra.restore_with{tactic: [sources]}, missing_sources[]`
  - **NS5** `extra.series{detector: [12 monthly counts]}, rules[]`. This is the **decay chart**.
  - **NS7** `extra.late_submissions[]`
  - **RT1** `extra.funnel{executed, alerted, cased, escalated}, techniques[]`

`GET /api/entities/{id}/hourly` returns `{cells: [{dow 0=Mon, hour, cases, median_ack_min, slow_ack_share}], peer_by_hour: [{hour, peer_median_ack_min}]}`. This is the **24×7 heatmap** (star entity: `PWR-05`).

`GET /api/entities/{id}/regulatory` returns `{entity_id, entity_name, items: [{obligation, detector_id, detector, status ("evidence_contradicts"|"insufficient_evidence"|"consistent"), effect, reason}]}`

## Case drill-down
`GET /api/cases/{case_id}` returns the case row, plus:
- `violations[]` (workflow rules broken)
- `events: [{ts, activity, actor}]` (timeline; activities are open, ack, triage, investigate, contain, escalate, remediate, enrich, playbook, close)
- `escalations: [{ts, to_level, acknowledged_ts}]` (`to_level` is L2, CISO, CERT-In or NCIIPC)
- `template_siblings[]` (when the note is templated)

`injection_like=true` means the note contains instruction-like text aimed at an AI reviewer. Flag it visibly.

## Blind-spot matrix
`GET /api/blindspot` returns `{tactics[14], entities: [{entity_id, entity_name, sector, declared_log_sources}], cells: [{entity_id, tactic, state, observed, expected, p, supportable}], summary{state:count}, legend{state:text}}`

## Providers (systemic MSSP lens)
`GET /api/providers` returns `[{provider, n_clients, clients[], sectors[], rate, others_rate, p_value (null for INHOUSE), client_rates{entity: rate}}]`. The star is `MSSP-3`.

## Red team
`GET /api/redteam/{id}` returns `{has_report, funnel{executed, alerted, cased, escalated}, techniques: [{technique_id, technique, tactic, target_asset, executed, alerted, cased, escalated}], reason}`. Entities with reports: PWR-01, PWR-03, TEL-03, BFS-01, TRN-01, GOV-01.

## Regulatory crosswalk
`GET /api/regulatory` returns `{crosswalk: [{detector_id, detector, obligations[]}]}`

## Review Lab (prediction-powered inference)
- `GET /api/review/{id}?reveal=false` returns `{entity_id, sample: [...], estimate: {...}}`
- `POST /api/review/{id}/sample?n_random=20&n_active=10` draws a new sample and returns the same shape.
- `POST /api/review/{id}/label` with body `{"case_id": "...", "label": 1|0, "reviewer": "examiner", "blind_first": true}` (label 1 = superficial / inadequate).
- `POST /api/review/{id}/simulate?n=5` is **demo only**. It labels the next 5 sampled cases from the hidden answer key (as a "simulated examiner"), and draws a sample first if none exists.
- `POST /api/review/{id}/reset`

`sample[]`: `{case_id, sample_type ("random"|"active"), rank, severity, category, ttc_min, notes, yhat (null until labelled = blind-first), n_investigate, escalated, label (null|0|1), reviewer, blind_first}`

`estimate`:
```
{population, n_labeled_random, n_labeled_active, n_sampled, model_mean, alpha (0.1 = 90% CIs),
 status: "collecting" (fewer than 20 random labels; classical only) | "ok",
 labels_needed?, classical: {estimate, lo, hi, width},
 ppi: {estimate, lo, hi, width},                     // only when status == "ok"
 review_saving: 0-1,                                 // share of manual reviews saved at equal CI width
 planner: {target_half_width, reviews_manual_only, reviews_with_satsa}}
```
**The key animation:** two horizontal CI bars (classical vs PPI) that shrink as labels arrive.

## Ledger (tamper-evident audit)
- `GET /api/ledger?limit=200` returns `{entries: [{seq, ts, actor, type, payload, payload_sha256, prev_hash, hash}] newest first, total}`
- `POST /api/ledger/verify` returns `{ok, entries, head}`, or `{ok: false, broken_at, problems[]}`
- `POST /api/ledger/tamper-demo` edits a *copy* of the ledger and verifies it. It returns `{ok: false, broken_at, tampered_seq, problems}`. The real ledger is untouched.

## Ingestion
`POST /api/ingest/validate` (multipart, field `files`, one or more of CSV / JSON / Parquet / SQLite) returns `{accepted, files: [{file, table, rows, errors[], warnings[]}], integrity[], sha256{file: hash}, tables{table: rows}}`. Sample bundles to upload live in `data/samples/`.

## Validation and real data
- `GET /api/validation` returns `{available: false}` or the contents of `reports/validation.json` (see `satsa/eval/`).
- `GET /api/guide` returns `{available: false}` or `reports/guide.json` (Microsoft GUIDE real-data experiments).
