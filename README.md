# SAT-SA: Supervisory Analytics Tool for SOC Assessment

**Smart India Hackathon 2026 · PS SIH26157 (NTRO / NCIIPC)**

SAT-SA is an offline, regulator-side tool. It reads the SOC paper trail that Critical Sector Entities already submit: alerts, cases, workflow events, escalations and asset inventory. It finds **execution gaps** (work that looks done on paper but wasn't) and **negative space** (evidence that should exist but doesn't). It then tells examiners **which entities, findings and cases to review first**, with a **known, controlled false-alarm rate**.

Every flag carries its evidence (record ids), a calibrated p-value or a documented fact, and the regulatory obligation it tests (SEBI CSCRF, CERT-In 2022, RBI, CEA). The examiner decides; every decision goes into a tamper-evident ledger. Nothing leaves the machine.

---

## Results at a glance

| What we measured | Result | Data |
|---|---|---|
| Planted weaknesses recovered (5 independently seeded panels, 14 weakness types) | **100%** at 10% FDR; **0** hard negatives and **0** healthy entities flagged | synthetic |
| False alarms on 40 panels where every entity is healthy (promise: ≤ 10%) | **5%** realised (95% CI 0.6–17%) | synthetic |
| Superficially handled cases found per 100 examiner reviews | **54** with SAT-SA vs **7** with random sampling | synthetic |
| Examiner labels saved by prediction-powered inference, at equal confidence | **69%** at 30 labels, coverage 99% (target 90%) | synthetic |
| Expert top-20 incidents among the first 10 reviewed, in 499 real SOC queues | **84%** SAT-SA vs **14%** random, **39%** "most alerts first" | **real** (GUIDE) |
| False alarms on 1,286 real organisations re-split at random (nothing changed) | **5%** of runs at 10% FDR | **real** |
| A silently suppressed alert category in real orgs | **92%** caught at **93%** precision | **real** + planted |
| PPI interval coverage on real analyst verdicts | **98%**, 41% fewer labels | **real** |
| Gaming: a SOC that behaves well only in audit months | fixed audits catch it **0–2%** of the time; SAT-SA catches it **100%** | synthetic simulation |
| Full analysis of 453k alerts / 215k cases / 1.4M workflow events | **~2.5 min**, 1.3 GB RAM, CPU only; API p95 < 50 ms | this laptop |

Every number above is produced by one command (see *Reproduce the validation*) and is shown on the **Validation** page. Synthetic numbers come from seeded panels with a hidden answer key. Real-data numbers come from [Microsoft GUIDE](https://arxiv.org/abs/2407.09017) (1.03M triage-graded incidents from 6,115 organisations, CDLA-Permissive-2.0), including the expert queue rankings released with it (Freitas et al., 2026).

---

## Quick start (Windows)

```bat
run.bat
```

Then open **http://localhost:8000**.
- The first run creates a virtual environment, installs the dependencies, generates the 42-entity demo panel and runs the analysis (about 5 minutes).
- Later runs start in seconds.
- Needs Python 3.11+.

Manual, on any OS:
```bash
python -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m satsa.pipeline                             # generate the demo panel + analyse (~3 min) -> data/satsa.duckdb
python -m uvicorn satsa.api.main:app --port 8000     # UI + API on http://localhost:8000 (UI is pre-built)
```

### Air-gapped installation
1. On a connected machine, run `prepare_offline.bat`. It downloads all wheels to `wheelhouse\` (about 130 MB), the optional local model and a SHA-256 manifest.
2. Copy the folder to the target machine.
3. Run `install_offline.bat` there, then `run.bat`. Use the **same Python minor version** on both machines (wheels are version-specific; the reference build is Python 3.13, locked in `requirements.lock`). No network access is used at install or run time. `tests/test_offline.py` proves the analysis runs with every outbound connection blocked.

### Optional: local AI explanations
- `pip install -r requirements-ai.txt`, then place `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` (Apache-2.0, 2.5 GB) in `data/models/`. `prepare_offline.bat` does both.
- The model only drafts plain-language explanations; a deterministic verifier keeps a claim only if it is grounded in the cited records (see Architecture).
- Without the model, SAT-SA uses template explanations and everything else is unchanged.
- `python -m satsa.ai.warm` pre-generates explanations for the top findings. Each takes about 1–2 minutes on a 4-core CPU.

---

## Using SAT-SA
1. **Supervisory queue:** entities ranked by calibrated evidence. The FDR slider (5/10/20%) sets how many false alarms you accept; statistical flags and documented facts are shown separately.
2. **Entity dossier:**
   - A capability profile and findings with reasons, evidence and regulations.
   - Evidence over time (anytime-valid e-values), time-to-close survival, the 24×7 reality heatmap, the regulatory crosswalk and red-team reconciliation.
   - A printable **examination brief** that answers the SEBI CSCRF SOC-efficacy questions from evidence.
3. **Evidence drawer:**
   - The charts behind each finding: SLA bunching, rule decay, synthetic twin, template notes, silent assets.
   - Every underlying record, down to the case timeline.
   - **Accept / dismiss / escalate** (ledgered), plus a verified plain-language explanation.
4. **Review Lab:** draw a sample (uniform random for the estimate, plus targeted cases to confirm), label blind-first, and watch the prediction-powered interval tighten.
5. **Sector view, blind-spot matrix, providers:** systemic views. For example, a weak managed SOC provider serving 7 entities in 4 sectors.
6. **Red-Team Lab:** can a SOC game its regulator? Seven gaming strategies against five audit policies.
7. **Ingest:** upload a periodic submission (CSV / JSON / JSON-lines / Parquet / SQLite). It is validated with row-numbered errors, then committed; the analysis re-runs in the background. Try `data/samples/broken/` (rejected) and `data/samples/submission/` (new entity HLT-07, flagged after commit).
8. **Audit ledger:** a SHA-256 hash chain of every run, upload, label and decision, with a tamper demo.

## Data format
One file per table, or one SQLite / JSON file containing several. Column names are normalised and common vendor spellings are mapped (`AlertId`, `Rule ID`, `Hostname`, `Priority`, `created_at`, …).

| Table | Required columns |
|---|---|
| entities | entity_id, entity_name, sector |
| assets | asset_id, entity_id, asset_class, criticality |
| alerts | alert_id, entity_id, asset_id, ts, category, severity, detector_id |
| cases | case_id, entity_id, alert_id, severity, opened_ts, ack_ts, closed_ts, escalated, notes |
| case_events | case_id, ts, activity |
| escalations | case_id, entity_id, ts, to_level |
| submissions | submission_id, entity_id, period, due_ts, received_ts |
| redteam (optional) | entity_id, category (or technique_id), target_asset, start_ts |

- Optional columns improve specific detectors: `disposition`, `remediated`, `ioc_enriched`, `auto_closed`, `analyst_id` and `declared_log_sources`.
- Malformed files are **rejected, never silently repaired**. Each file's SHA-256 is written to the ledger.

## What it detects
| PS use case | Detector(s) | Method |
|---|---|---|
| (i) High-severity alerts closed unusually quickly | EG1, EG4 | Leave-one-entity-out conformal p-value per case → beta-binomial vs peers |
| (ii) Repeat alerts without remediation | EG7 | Recurrence within 30 days → beta-binomial |
| (iii) Critical alerts closed without escalation | EG2, EG5 | Case-mix-standardised rate test; declarative workflow conformance |
| (iv) Critical systems with little or no telemetry | NS1 | Negative-binomial silence vs peer asset classes and the asset's own history |
| (v) Deviations from peers | all statistical detectors, TW1 | Robust peer baselines; synthetic-control twin with placebo inference |
| (vi) Missing monitoring coverage | NS2, NS3 | Log-source → ATT&CK supportability: *quiet* (visible but absent) vs *blind* (cannot see) |
| (vii) Repetitive notes suggesting superficial review | EG3 | Near-duplicate clustering (char n-gram cosine) |
| (viii) Meeting metrics without managing risk | EG6, EG11 | SLA **bunching estimator** with random-effects null; 24×7 claim vs night-time reality |
| (ix) Workloads inconsistent with expected activity | NS5, NS7, NS8, NS9 | Detection-rule decay ("exclusion ratchet"), missing case records, retention gaps, clock faults |
| Additional signals | EG12, EG13, RT1, provider lens, e-values | CERT-In 6-hour reporting; threat intel not applied; red-team known-positive misses; systemic MSSP effect; anytime-valid monitoring |

Entity score:
- The statistical p-values are combined with the Cauchy combination test (ACAT, valid under dependence).
- They are adjusted across entities with Benjamini–Hochberg, which gives a queue with a controlled false-discovery rate.
- Deterministic facts (blind tactic, clock fault, retention gap, red-team miss) are listed separately and never mixed into the statistics.

## Reproduce the validation
```bash
python -m satsa.eval.run_all            # synthetic suite -> reports/validation.json (~1 h on 4 cores; cached, resumable)
python -m satsa.guide.aggregate         # once: GUIDE CSVs -> data/guide/agg (~5 min)
python -m satsa.guide.experiments       # real-data suite -> reports/guide.json (~18 min)
python -m pytest tests -q               # unit, offline and end-to-end tests
```
- GUIDE is not redistributed. Download it from Kaggle (`Microsoft/microsoft-security-incident-prediction`) into `data/guide/`.
- The seeded panel's answer key is in `data/generated/_truth/`. The API never exposes it, except to the demo-only "simulated examiner".

## Honest limitations
- Headline detection numbers are on **synthetic** panels. Real-data results use GUIDE, which has analyst verdicts and expert queue ranks, but no ground-truth "weak SOC" labels. So real-data recall is measured by planting degradations into real organisations.
- On real multi-tenant data, organisations differ a great deal. Peer comparison alone flags few real orgs at 10% FDR (the flags it does raise are stable across independent halves). SAT-SA's power there comes from **self-history** and **case-level evidence**, not raw peer ranking.
- Subtle weaknesses have limits. A 10% SLA-gaming share or an escalation rate of 85% (vs 93%) is caught only some of the time. The power curves on the Validation page show exactly where.
- "Padding the paper trail" defeats any metadata analytics. SAT-SA's defence is the randomised review floor, which catches 69% within a year in the simulator.
- Local explanations take 1–2 minutes each on a laptop CPU and are optional. Findings never depend on them.

## Repository layout
```
satsa/gen/        seeded synthetic panel (42 entities, 7 NCIIPC sectors, 12 months) + sample submissions
satsa/ingest/     validation of uploaded submissions
satsa/detect/     19 detectors (one row per entity each)
satsa/stats/      calibrated tests, ACAT, BH / e-BH, PPI++, random-effects nulls
satsa/pipeline.py features -> detectors -> scores -> DuckDB (+ ledger)
satsa/workflow.py submission commit, dispositions, red-team upload, sector view
satsa/ai/         verifier-gated local explanations
satsa/eval/       validation suite and gaming simulator
satsa/guide/      Microsoft GUIDE real-data experiments
satsa/api/        FastAPI server (serves the built UI from satsa/api/static)
web/              React + TypeScript + ECharts UI
docs/             ARCHITECTURE.md, API.md, slide content, video script
```

## Licences
- **Python dependencies:** permissive only (MIT / BSD / Apache-2.0): FastAPI, DuckDB, pandas, NumPy, SciPy, scikit-learn, lifelines, psutil, llama-cpp-python (optional). No GPL/AGPL.
- **Model:** Qwen3-4B-Instruct-2507, Apache-2.0 (optional).
- **Data:** Microsoft GUIDE, CDLA-Permissive-2.0 (not redistributed).
- **Methods:**
  - Benjamini & Hochberg (1995); Liu & Xie (2020, ACAT); Wang & Ramdas (2022, e-BH).
  - Angelopoulos et al. (2023, prediction-powered inference and PPI++).
  - Chetty et al. (2011) and Kleven (2016) for bunching; Abadie et al. (2010) for synthetic control; Efron (2004) for empirical null.
  - Full list: `RESEARCH_PAPERS.md`.
