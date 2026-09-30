# SAT-SA API contract

> **Stable contract.** Endpoints, parameters and field shapes are fixed; changes are bug fixes that keep the shape. Every endpoint has a live example in `docs/api-examples/`, and `tests/test_workflow_e2e.py` calls every GET route.
>
> **Pre-generated local-AI explanations (cached, instant):**
> - PWR-01 EG2 (hostile note flagged), TEL-02 EG3, BFS-03 EG6, PWR-03 NS5, TRN-06 TW1, BFS-02 EG1;
> - the top finding of every flagged entity.
>
> Any other finding's "Explain" runs the model live (about 2 min on this CPU). `?model=false` gives the instant template version.

Base URL: `http://localhost:8000`. All endpoints return JSON, except `/brief`, which returns HTML. CORS is open (`*`), so a Vite dev server on another port works.
Interactive docs: `http://localhost:8000/docs` (auto-generated OpenAPI).
**Real example payloads** (trimmed with `"...(N more)"` markers) are in [`docs/api-examples/`](api-examples/). Read them before you build a screen.

Conventions:
- `p_value`: a calibrated p-value; smaller means stronger evidence. `null` means not applicable, or a deterministic finding.
- `q_value`: the Benjamini–Hochberg adjusted p-value across entities. An entity is statistically flagged when `q_value <= fdr`.
- `attention`: a 0–100 manager-facing index derived from q (= min(100, 20·(−log10 q))). Deterministic findings give 70 (high) or 45 (medium).
- Timestamps are ISO-8601 strings (local time, no timezone).
- `flag_basis`: `"statistical"` (FDR-controlled), `"deterministic"` (a documented fact such as a blind spot, clock fault or red-team miss), `"both"`, or `null`.
- Everything computed on the seeded panel is **synthetic**. `/api/guide` is **real data** (Microsoft GUIDE).

---

## Meta
| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ok, version}` |
| GET | `/api/meta` | `{run: {run_hash, input_hash, code_hash, version, seed, counts{table:rows}, n_findings, seconds, created}, detectors: [{detector_id, name, family, capability, method, regulations[]}], capabilities[8], tactics[14], sectors{code:name}, log_sources{code:label}, providers[], period{start,end}}` |
| GET | `/api/ai/status` | `{available, model, path, offline: true}`. Tells you whether the local model is installed. |

Detector ids:
- **Execution gaps:** `EG1–EG7`, `EG11–EG13`, and `TW1` (synthetic twin).
- **Negative space:** `NS1–NS3`, `NS5`, `NS7–NS9`.
- **Red-team reconciliation:** `RT1`.
- **Deterministic:** `NS3`, `NS8`, `NS9` and `RT1`.

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

## Sector view
`GET /api/sectors?fdr=0.10` returns `[{sector, sector_name, entities, flagged, mean_attention, top_detectors: [{detector_id, entities}], blind_tactics[], entities_blind_somewhere, systemic_providers[]}]`, sorted by flagged desc.

## Entity dossier
`GET /api/entities` returns a lightweight list for pickers.

`GET /api/entities/{id}` (add `?all_detectors=true` to include non-significant detector rows)
```
{...entity fields, p_value, q_value, attention, capabilities{}, top_reasons[], declared_log_sources[],
 trust_score, trust_completeness, trust_temporal, trust_timeliness, trust_coverage (0-1 each),
 findings: [{detector_id, name, family ("Execution gap"|"Negative space"), capability, method, regulations[],
             p_value, deterministic, severity ("high"|"medium"|null), n, k, rate, peer_rate, effect, reason,
             evidence[<=10 ids], evidence_type ("case"|"asset"|"alert"|"tactic"|"detector"|"technique"|"period"|"series"),
             score (0-100), significant, extra{small},
             disposition: {status ("open"|"accepted"|"dismissed"|"escalated"), reason?, examiner?, ts?}}],   // sorted by score desc
 monthly: [{period "YYYY-MM", cases, fast_share, no_investigation_share, templated_share, median_ttc_critical,
            escalation_rate_critical, mean_superficial_score}],
 tactics: [{tactic, state ("covered"|"quiet"|"blind"|"not_applicable"), observed, expected, p, supportable}],
 provider: {provider, n_clients, clients[], sectors[], rate, others_rate, p_value, effect_pp, effect_ci90[lo,hi], tau2, client_rates{}},
 quarterly: [{look 1-4, quarter "2025-Q4", p_value, e_value, cum_e, ebh_flag, naive_bh_flag}] }
```

`GET /api/entities/{id}/findings/{detector_id}?limit=40` returns the full finding plus resolved `records[]`:
- `evidence_type=case`: `records` = case rows `{case_id, severity, category, tactic, asset_id, opened_ts, ack_ts, closed_ts, ttc_min, ack_min, escalated, disposition, n_investigate, p_fast, templated, yhat, notes, injection_like}`
- `evidence_type=asset`: asset rows. `alert`: alert rows. Otherwise `[{id}]`.
- `extra` by detector:
  - **EG6** `extra.chart = {bins[], observed[], counterfactual[], sla, window[lo,hi], excess, missing_above, ratio, p, p_theoretical, log_ratio, excess_ci90?[lo,hi]}`. This is the **bunching chart**: bars = observed, line = counterfactual; shade the window below the SLA.
  - **EG3** `extra.clusters = [{count, example, cases[]}]`. This is the **template diff view**.
  - **EG2/EG3/EG4/EG5/EG13** `extra.expected_rate_for_case_mix` is the rate this entity's own mix of case severities and verdicts would predict.
  - **EG5** `extra.violations = {rule: count}`
  - **EG12** `extra.median_latency_h, unreported`
  - **NS1** `extra.assets = [{asset_id, asset_class, obs_quarter, expected_quarter, obs_prior, expected_from_own_history, p, basis ("stopped"|"peer")}]`
  - **NS3** `extra.restore_with{tactic: [sources]}, missing_sources[]`
  - **NS5** `extra.series{detector: [12 monthly counts]}, rules[]`. This is the **decay chart**.
  - **NS7** `extra.late_submissions[]`
  - **RT1** `extra.funnel{executed, alerted, cased, escalated}, techniques[]`
  - **TW1** `extra.twin = {actual[12], twin[12], gap[12], pre_rmse, donors{entity: weight}, placebo_band[[12 lo],[12 hi]], stat, p}`. This is the **synthetic twin chart**: months 1–6 are fitted, 7–12 are compared; the band is the placebo 5–95% gap. Star entity: `TRN-06`.

`GET /api/entities/{id}/findings/{detector_id}/explain?refresh=false&model=true` returns a **verifier-gated plain-language explanation** (`model=false` forces the instant template path; cached results are returned regardless):
```
{entity_id, detector_id, mode ("local_model"|"template"|...), model, seconds, cached,
 summary, verified_claims: [{text, record_ids[], quote}], rejected_claims: [{text, record_ids[], quote, rejected_because}],
 question_for_entity, untrusted_instruction_like_notes: [case ids], policy}
```
- Cached per finding; `refresh=true` regenerates it, which takes about 1 minute on CPU.
- Show verified claims with their record ids, and rejected claims (collapsed) with the reason.
- If `untrusted_instruction_like_notes` is non-empty, show the prompt-injection warning. Star: `PWR-01 / EG2`.

`POST /api/entities/{id}/findings/{detector_id}/disposition` with body `{"status": "accepted"|"dismissed"|"escalated"|"open", "reason": "...", "examiner": "..."}`:
- Returns `{..., ledger_hash}`.
- 400 if a dismissal has no reason.
- It's ledgered.

`GET /api/dispositions?entity_id=` returns the latest disposition rows.

`GET /api/entities/{id}/evidence?fdr=0.10` returns `{entity_id, fdr, n_entities, looks: [same as quarterly], note}`. This is the **anytime-valid evidence chart** (log y-axis, e-BH flags).

`GET /api/entities/{id}/cycle` returns `{available, previous "2026-Q2", current "2026-Q3", alpha, new: [{detector_id, name}], resolved[], persisting[]}` (quarter-on-quarter findings).

`GET /api/entities/{id}/survival` returns `{available, n, open, km_median_min, naive_median_min, peer_km_median_min, curve: {t[], open_share[]}}`. This is the **Kaplan–Meier time-to-close** curve (a step chart).

`GET /api/entities/{id}/brief?fdr=0.10` returns **HTML**: a printable examination brief with findings, evidence, dispositions, CSCRF questions answered from evidence, the PPI estimate, quarterly evidence and the ledger head. Open it in a new tab; it has its own Print button.

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
`GET /api/providers` returns `[{provider, n_clients, clients[], sectors[], rate, others_rate, p_value (null for INHOUSE), effect_pp, effect_ci90[lo,hi], tau2, client_rates{entity: rate}}]`.
- `effect_pp` is the provider-level shift in the share of likely-superficial cases, in percentage points, from a random-effects model.
- The star is `MSSP-3`: each client is individually borderline, but the provider as a whole is clear.

## Red team
- `GET /api/redteam/{id}` returns `{has_report, funnel{executed, alerted, cased, escalated}, techniques: [{technique_id, technique, tactic, target_asset, executed, alerted, cased, escalated}], reason}`. Entities with reports: PWR-01, PWR-03, TEL-03, BFS-01, TRN-01, GOV-01.
- `POST /api/entities/{id}/redteam` (multipart, field `file`, CSV/JSON with `category` or `technique_id`, `start_ts`, optional `target_asset`) reconciles an uploaded exercise against the entity's own submission. It returns `{entity_id, funnel, techniques: [... , start_ts, matched_alerts[]], missed[], severity}`. Sample: `data/samples/redteam/tel03_exercise.csv` for `TEL-03`.

## Red-Team Lab (gaming simulator, synthetic)
- `GET /api/gaming` returns `{description, sims_per_cell, review_budget_per_year, alpha, strategies[7], policies[5], cells: [{strategy, policy, detection_rate, median_months_to_detect, detected_by{why: count}}]}`. This is the **heatmap**; the `honest` row = false alarms.
- `GET /api/gaming/run?strategy=off_audit_drift&policy=quarterly_audit&seed=1` returns `{strategy, policy, onset_month, detected_month|null, why, trace: [{month, true_rate, submitted_rate, missing, mean_score, cum_e, reviews, found, detected}]}`. This replays one year.

## Regulatory crosswalk
`GET /api/regulatory` returns `{crosswalk: [{detector_id, detector, obligations[]}]}`

## Review Lab (prediction-powered inference)
- `GET /api/review/{id}?reveal=false` returns `{entity_id, sample: [...], estimate: {...}}`
- `POST /api/review/{id}/sample?n_random=20&n_active=10` draws a new sample and returns the same shape.
  - "active" = the targeted half: the cases the model rates most likely to be superficial.
  - Targeted cases are for confirming weaknesses and never enter the estimate.
- `POST /api/review/{id}/label` with body `{"case_id": "...", "label": 1|0, "reviewer": "examiner", "blind_first": true}` (label 1 = superficial / inadequate).
- `POST /api/review/{id}/simulate?n=5` is **demo only**. It labels the next 5 sampled cases from the hidden answer key (as a "simulated examiner"), and draws a sample first if none exists.
- `POST /api/review/{id}/reset`

`sample[]`: `{case_id, sample_type ("random"|"active"), rank, severity, category, ttc_min, notes, yhat (null until labelled = blind-first), n_investigate, escalated, label (null|0|1), reviewer, blind_first}`

`estimate`:
```
{population, n_labeled_random, n_labeled_active, n_sampled, model_mean, alpha (0.1 = 90% CIs),
 status: "collecting" (fewer than 20 random labels; classical only) | "ok",
 labels_needed?, classical: {estimate, lo, hi, width},
 ppi: {estimate, lo, hi, width, lambda},              // only when status == "ok"; PPI++ (power-tuned)
 review_saving: 0-1,                                 // share of manual reviews saved at equal CI width
 planner: {target_half_width, reviews_manual_only, reviews_with_satsa}}
```
**The key animation:** two horizontal CI bars (classical vs PPI) that shrink as labels arrive.

## Ledger (tamper-evident audit)
- `GET /api/ledger?limit=200` returns `{entries: [{seq, ts, actor, type, payload, payload_sha256, prev_hash, hash}] newest first, total}`
  - Entry types include: analysis_run, submission_validated, submission_committed, review_sample_drawn, examiner_verdict, finding_disposition, redteam_report_reconciled and explanation_generated.
- `POST /api/ledger/verify` returns `{ok, entries, head}`, or `{ok: false, broken_at, problems[]}`
- `POST /api/ledger/tamper-demo` edits a *copy* of the ledger and verifies it. It returns `{ok: false, broken_at, tampered_seq, problems}`. The real ledger is untouched.

## Ingestion (validate → commit → re-analyse)
- `POST /api/ingest/validate` (multipart, field `files`, one or more of CSV / JSON / JSON-lines / Parquet / SQLite):
  - Returns `{accepted, files: [{file, table, rows, errors[], warnings[]}], integrity[], sha256{file: hash}, tables{table: rows}, token?, entities[]?}`.
  - `token` is present only when the submission is accepted.
- `POST /api/ingest/commit/{token}` returns `{job_id, status: "running"}`.
  - It merges the submission into the working dataset (a re-submission replaces that entity's data) and re-runs the full analysis in the background, about 2–3 minutes.
  - When the job finishes, the API switches to the new results. Examiner labels, dispositions and explanations carry over.
- `GET /api/jobs/{job_id}` returns `{job_id, kind, status ("running"|"done"|"failed"), elapsed, seconds?, log[], result?: {merged: {entities[], rows{}}, run_hash, db}, error?}`. Poll it every 2 s.

Sample bundles live in `data/samples/`:
- `submission/`: a valid new entity, `HLT-07`, split over CSV / JSON-lines / SQLite with vendor-style column names. It is flagged after commit.
- `broken/`: rejected, with row numbers.
- `redteam/`

## Validation and real data
- `GET /api/validation` returns `{available: false}` or the contents of `reports/validation.json` (see `satsa/eval/`). Its keys:
  - `headline`
  - `V1_recovery`
  - `V2_calibration`
  - `V3_ppi`
  - `V4_effort`
  - `V5_power`
  - `V8_runtime`
  - `V9_reproducibility`
  - `D4_gaming`
  - `V12_anytime` (when present)
- `GET /api/guide` returns `{available: false}` or `reports/guide.json`: Microsoft GUIDE real-data experiments. Its keys:
  - `dataset`
  - `tp_model`
  - `R1_null_calibration`
  - `R2_injected_recall`
  - `R3_peer_flags`
  - `R4_ppi_real`
  - `R5_expert_priority`
