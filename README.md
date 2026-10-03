<div align="center">

<img src="web/public/favicon.svg" width="84" alt="SAT-SA logo" />

# SAT-SA

### Supervisory Analytics Tool for SOC Assessment

**Find the security operations centres that only look good on paper.**

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![DuckDB](https://img.shields.io/badge/DuckDB-columnar%20store-FFF000?logo=duckdb&logoColor=black)](https://duckdb.org/)
[![React](https://img.shields.io/badge/React%2019-Carbon%20UI-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Offline](https://img.shields.io/badge/runtime-100%25%20offline-2ea44f)](#air-gapped-installation)
[![Licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)
[![SIH 2026](https://img.shields.io/badge/Smart%20India%20Hackathon-2026%20%C2%B7%20SIH26157-ff6f00)](#)

[Why](#why-sat-sa) · [How it works](#how-it-works) · [Detectors](#what-it-detects) · [Results](#results) · [Quick start](#quick-start) · [Using it](#using-sat-sa) · [Docs](#documentation)

</div>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/src/assets/landing/queue-dark.jpg" />
  <img src="web/src/assets/landing/queue-light.jpg" alt="SAT-SA review queue: entities ranked by calibrated evidence at a chosen false-alarm budget" />
</picture>

<p align="center"><sub>The supervisory queue on the seeded demo panel (synthetic data). Statistical flags are held to a known false-alarm budget; documented facts are listed on their own basis.</sub></p>

---

## Why SAT-SA

Critical Sector Entities (banks, power utilities, telecoms, hospitals and others) already send their regulator a **SOC paper trail**: alerts, cases, workflow events, escalations and asset inventory. Reading it by hand doesn't scale, and the metrics in it can be gamed.

SAT-SA is an **offline, regulator-side** tool built for PS **SIH26157 (NTRO / NCIIPC)**. It reads that paper trail and looks for two kinds of weakness:

| | **Execution gaps** | **Negative space** |
|---|---|---|
| The question | *Was the work really done?* | *What evidence should exist but doesn't?* |
| Example | Critical alerts closed in minutes, with no escalation and copy-pasted notes | A critical server that has gone silent; an ATT&CK tactic the SOC cannot see at all |
| How it shows up | Unusual rates, timings and text compared with peers and with the entity's own history | Missing telemetry, missing records, decaying detection rules, red-team techniques that were never alerted on |

It then tells examiners **which entities, findings and cases to review first**, with a **known, controlled false-alarm rate**. Every flag carries:

- its **evidence** (record ids, down to the case timeline);
- a **calibrated p-value** or a **documented fact**;
- the **regulatory obligation** it tests (SEBI CSCRF, CERT-In 2022 Directions, RBI, CEA).

> [!IMPORTANT]
> SAT-SA raises **flags for examiner review**. It never decides on its own. Every examiner decision goes into a tamper-evident ledger, and nothing leaves the machine.

---

## How it works

```mermaid
flowchart LR
    A["🏢 Critical Sector Entities<br/>periodic SOC submissions"] --> B["🔒 SAT-SA<br/>on the regulator's own machine<br/>no network needed"]
    B --> C["📋 Ranked review queue<br/>evidence + known false-alarm rate"]
    C --> D["🧑‍💼 Examiner decides<br/>accept · dismiss · escalate"]
    D --> E["⛓️ Hash-chained<br/>audit ledger"]

    classDef src fill:#e8f1ff,stroke:#0f62fe,color:#0b1f44
    classDef core fill:#defbe6,stroke:#24a148,color:#0b2e14
    classDef out fill:#fff4d6,stroke:#b28600,color:#3d2e00
    class A src
    class B core
    class C,D,E out
```

Under the hood, one pass of the analysis looks like this:

```mermaid
flowchart TB
    subgraph IN["① Ingest"]
        direction LR
        U["Upload<br/>CSV · JSON · Parquet · SQLite"] --> VAL["Validate<br/>schema, vendor aliases,<br/>row-numbered errors"]
    end

    subgraph AN["② Analyse"]
        direction LR
        ST[("DuckDB<br/>canonical store")] --> FE["Case features<br/>timings · conformal p_fast<br/>note templates · workflow"]
        FE --> DET["Detector bank<br/>19 detectors"]
    end

    subgraph SC["③ Score"]
        direction LR
        ACAT["ACAT<br/>per entity"] --> BH["Benjamini–Hochberg<br/>q-values"]
        BH ~~~ EV["Quarterly e-values<br/>anytime-valid e-BH"]
    end

    subgraph SV["④ Serve and review"]
        direction LR
        API["FastAPI<br/>localhost only"] --> UI["Examiner UI<br/>queue · dossier · evidence"]
        UI --> RL["Review Lab<br/>PPI++ intervals"]
    end

    LED[("⛓️ SHA-256 hash-chained ledger<br/>file hashes · run hashes · every label and decision")]
    LLM["Optional local LLM<br/>+ deterministic verifier"]

    IN --> AN --> SC --> SV
    LLM -. "explanations only" .-> SV
    SV -.-> LED

    classDef store fill:#f2f4f8,stroke:#525252,color:#161616
    classDef opt fill:#f6f2ff,stroke:#8a3ffc,color:#2a0a5e,stroke-dasharray: 5 5
    class ST,LED store
    class LLM opt
```

---

## What it detects

Nineteen detectors, one per weakness, each mapped to the problem statement's use cases and to a regulatory obligation. **Statistical** detectors return a calibrated p-value. **Fact** detectors return a documented severity and are never mixed into the statistics.

```mermaid
%%{init: {"flowchart": {"wrappingWidth": 420}}}%%
flowchart TB
    R(["19 detectors"])
    R --> EGL
    R --> NSL

    subgraph EGL["⚙️ Execution gaps"]
        direction TB
        EG1["EG1 · Unusually fast high-severity closures"]
        EG2["EG2 · Critical cases closed without escalation"]
        EG3["EG3 · Template or copy-paste notes"]
        EG4["EG4 · Acknowledged but not investigated"]
        EG5["EG5 · Workflow non-conformance"]
        EG6["EG6 · SLA-threshold bunching"]
        EG7["EG7 · Repeat alerts without remediation"]
        EG11["EG11 · 24×7 claim vs night-time reality"]
        EG12["EG12 · CERT-In reporting beyond 6 hours"]
        EG13["EG13 · Threat intelligence not applied"]
        TW1["TW1 · Divergence from a synthetic twin"]
        EG1 ~~~ EG2 ~~~ EG3 ~~~ EG4 ~~~ EG5 ~~~ EG6 ~~~ EG7 ~~~ EG11 ~~~ EG12 ~~~ EG13 ~~~ TW1
    end

    subgraph NSL["🕳️ Negative space"]
        direction TB
        NS1["NS1 · Silent critical assets"]
        NS2["NS2 · Quiet ATT&CK tactics"]
        NS5["NS5 · Detection-rule decay"]
        NS7["NS7 · Missing case records"]
        NS3["NS3 · Blind ATT&CK tactics"]
        NS8["NS8 · Log-retention gap"]
        NS9["NS9 · Clock integrity faults"]
        RT1["RT1 · Red-team techniques missed"]
        NS1 ~~~ NS2 ~~~ NS5 ~~~ NS7 ~~~ NS3 ~~~ NS8 ~~~ NS9 ~~~ RT1
    end

    classDef root fill:#0f62fe,stroke:#0f62fe,color:#ffffff
    style EGL fill:#e8f1ff,stroke:#0f62fe,color:#0b1f44
    style NSL fill:#e8f1ff,stroke:#0f62fe,color:#0b1f44
    classDef stat fill:#fff4d6,stroke:#b28600,color:#3d2e00
    classDef fact fill:#ffe0e0,stroke:#da1e28,color:#520408
    class R root
    class EG1,EG2,EG3,EG4,EG5,EG6,EG7,EG11,EG12,EG13,TW1,NS1,NS2,NS5,NS7 stat
    class NS3,NS8,NS9,RT1 fact
```

<sub>🟨 statistical: returns a calibrated p-value  ·  🟥 fact: returns a documented severity</sub>

| PS use case | Detector(s) | Method |
|---|---|---|
| (i) High-severity alerts closed unusually quickly | EG1, EG4 | Leave-one-entity-out conformal p-value per case → beta-binomial vs peers |
| (ii) Repeat alerts without remediation | EG7 | The same rule fires again as a true positive on the same asset within 14 days → beta-binomial |
| (iii) Critical alerts closed without escalation | EG2, EG5 | Case-mix-standardised rate test; declarative workflow conformance |
| (iv) Critical systems with little or no telemetry | NS1 | Negative-binomial silence vs peer asset classes and the asset's own history |
| (v) Deviations from peers | all statistical detectors, TW1 | Robust peer baselines; synthetic-control twin with placebo inference |
| (vi) Missing monitoring coverage | NS2, NS3 | Log-source → ATT&CK supportability: *quiet* (visible but absent) vs *blind* (cannot see) |
| (vii) Repetitive notes suggesting superficial review | EG3 | Near-duplicate clustering (char n-gram cosine) |
| (viii) Meeting metrics without managing risk | EG6, EG11 | SLA **bunching estimator** with a random-effects null; 24×7 claim vs night-time reality |
| (ix) Workloads inconsistent with expected activity | NS5, NS7, NS8, NS9 | Detection-rule decay ("exclusion ratchet"), missing case records, retention gaps, clock faults |
| Additional signals | EG12, EG13, RT1, provider lens, e-values | CERT-In 6-hour reporting; threat intel not applied; red-team known-positive misses; systemic MSSP effect; anytime-valid monitoring |

### How an entity gets its score

```mermaid
flowchart LR
    subgraph STAT["Statistical lane · 15 detectors"]
        P["One p-value per detector<br/>beta-binomial vs peers, conformal,<br/>bunching, negative binomial, twin"]
    end
    subgraph FACT["Fact lane · 4 detectors"]
        F["NS3 blind tactics · NS8 retention gap<br/>NS9 clock faults · RT1 red-team misses"]
    end

    P --> A["ACAT<br/>Cauchy combination<br/>valid under dependence"]
    A --> B["Benjamini–Hochberg<br/>q-value across entities"]
    B --> Q{"q ≤ chosen FDR?<br/>5 · 10 · 20 %"}
    Q -- yes --> FL["FDR-flagged"]
    Q -- no --> NF["Not flagged<br/>on statistics"]
    F --> DS["Documented fact<br/>with a severity"]
    FL --> ATT["Attention 0–100<br/>max of 20·(−log₁₀ q)<br/>and the fact score"]
    DS --> ATT
    ATT --> QUEUE["📋 Supervisory queue"]

    classDef stat fill:#fff4d6,stroke:#b28600,color:#3d2e00
    classDef fact fill:#ffe0e0,stroke:#da1e28,color:#520408
    class P,A,B,FL stat
    class F,DS fact
```

Why this design:

- **ACAT** combines an entity's evidence without assuming the detectors are independent (they aren't).
- **Benjamini–Hochberg** turns that into a queue where, of the entities flagged at 10% FDR, at most about 10% are expected to be false alarms. The examiner chooses the budget.
- **Anytime-valid e-values** let the regulator re-test every quarter without false alarms piling up.
- **Calibration rules** (robust over-dispersion, finite-peer variance inflation, mid-p for discrete counts) were each validated on panels where every entity is healthy. The history is in [`docs/CALIBRATION_LOG.md`](docs/CALIBRATION_LOG.md).

---

## Results

> [!NOTE]
> Numbers marked **synthetic** come from seeded panels with a hidden answer key. Numbers marked **real** come from [Microsoft GUIDE](https://arxiv.org/abs/2407.09017): 1.03M triage-graded incidents from 6,115 real organisations (CDLA-Permissive-2.0), including the expert queue rankings released with it (Freitas et al., 2026). Every number is produced by one command (see [Reproduce the validation](#reproduce-the-validation)) and is shown on the **Validation** page.

**Real SOC queues: does SAT-SA put the incidents experts care about first?**

```mermaid
%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "#0f62fe"}}}}%%
xychart-beta
    title "Expert top-20 in the first 10 reviewed (%)"
    x-axis ["Random", "Newest first", "Most alerts first", "SAT-SA"]
    y-axis "Share of first 10 reviewed (%)" 0 --> 100
    bar [14, 14, 39, 84]
```

**Re-testing healthy entities every quarter: do false alarms pile up?**

```mermaid
%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "#da1e28, #24a148"}}}}%%
xychart-beta
    title "False alarms after 4 quarterly looks (%)"
    x-axis ["Naive re-testing", "SAT-SA e-BH"]
    y-axis "False alarms (%)" 0 --> 60
    bar [55, 2.5]
    line [10, 10]
```
<sub>The line is the promised 10% budget.</sub>

**Can a SOC game a fixed audit schedule? (behaves well only in audit months)**

```mermaid
%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "#8a3ffc"}}}}%%
xychart-beta
    title "Off-audit drift caught within a year (%)"
    x-axis ["Annual audit", "Quarterly audit", "Unannounced", "SAT-SA"]
    y-axis "Detection rate (%)" 0 --> 100
    bar [0.5, 2, 67, 100]
```

### Everything at a glance

| What we measured | Result | Data |
|---|---|---|
| Planted weaknesses recovered (5 independently seeded panels, 14 weakness types) | **100%** at 10% FDR; **0** hard negatives and **0** healthy entities flagged | synthetic |
| False alarms on 40 panels where every entity is healthy (promise: ≤ 10%) | **5%** realised (95% CI 0.6–17%) | synthetic |
| Re-testing the same healthy entities every quarter (40 panels, 4 looks) | naive re-testing: **55%** false alarms; SAT-SA anytime-valid e-BH: **2.5%** | synthetic |
| Superficially handled cases found per 100 examiner reviews | **55** with SAT-SA vs **7** with random sampling | synthetic |
| Examiner labels saved by prediction-powered inference, at equal confidence | **69%** at 30 labels, coverage 99% (target 90%) | synthetic |
| Expert top-20 incidents among the first 10 reviewed, in 499 real SOC queues | **84%** SAT-SA vs **14%** random, **39%** "most alerts first" | **real** |
| False alarms on 1,286 real organisations re-split at random (nothing changed) | **5%** of runs at 10% FDR | **real** |
| A silently suppressed alert category in real orgs | **92%** caught at **93%** precision | **real** + planted |
| PPI interval coverage on real analyst verdicts | **98%**, 41% fewer labels | **real** |
| Gaming: a SOC that behaves well only in audit months | fixed audits catch it **0.5–2%** of the time; SAT-SA catches it **100%** | synthetic simulation |
| Full analysis of 453k alerts / 215k cases / 1.4M workflow events | **~3 min**, 1.3 GB RAM, CPU only; API p95 < 70 ms | dev laptop |

---

## A look inside

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="web/src/assets/landing/dossier-dark.jpg" />
        <img src="web/src/assets/landing/dossier-light.jpg" alt="Entity dossier" />
      </picture>
      <p align="center"><b>Entity dossier</b><br/><sub>Capability profile, findings with evidence and the regulation each one tests</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="web/src/assets/landing/bunching-dark.jpg" />
        <img src="web/src/assets/landing/bunching-light.jpg" alt="SLA bunching evidence" />
      </picture>
      <p align="center"><b>Evidence drawer</b><br/><sub>389 closures squeezed just under a 240-minute SLA, against the no-gaming counterfactual</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="web/src/assets/landing/guide-dark.jpg" />
        <img src="web/src/assets/landing/guide-light.jpg" alt="Validation page" />
      </picture>
      <p align="center"><b>Validation</b><br/><sub>Calibration on healthy panels and results on real SOC data</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="web/src/assets/landing/redteam-dark.jpg" />
        <img src="web/src/assets/landing/redteam-light.jpg" alt="Red-Team Lab" />
      </picture>
      <p align="center"><b>Red-Team Lab</b><br/><sub>Seven gaming strategies against five audit policies</sub></p>
    </td>
  </tr>
</table>

<sub>All screenshots show the seeded demo panel (synthetic data).</sub>

---

## Quick start

> [!TIP]
> The web UI is pre-built and served by the API, so you don't need Node.js to run SAT-SA.

### Windows: one click

```bat
run.bat
```

Then open **http://localhost:8000**.

- The first run creates a virtual environment, installs the dependencies, generates the 42-entity demo panel and runs the analysis (about 5 minutes).
- Later runs start in seconds.
- Needs Python 3.11+ (the reference build is Python 3.13).

### Any OS: manual

```bash
python -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m satsa.pipeline                             # generate the demo panel + analyse (~3 min) -> data/satsa.duckdb
python -m uvicorn satsa.api.main:app --port 8000     # UI + API on http://localhost:8000
```

The interactive API reference is at **http://localhost:8000/docs**; the contract is written up in [`docs/API.md`](docs/API.md) with sample responses in [`docs/api-examples/`](docs/api-examples/).

### Docker

The demo panel and its analysis are built into the image.

```bash
docker build -t satsa .                  # ~6 min, needs internet once
docker run --rm -p 8000:8000 satsa       # ready immediately on http://localhost:8000
```

- The container needs no network at run time. With `docker run --network none`, the full API still answers from inside the container, and the results match the Windows build exactly.
- The image does not include the optional local model; explanations use the verified template path.

### Air-gapped installation

1. On a connected machine, run `prepare_offline.bat`. It downloads all wheels to `wheelhouse\` (about 130 MB), the optional local model and a SHA-256 manifest.
2. Copy the folder to the target machine.
3. Run `install_offline.bat` there, then `run.bat`.

Use the **same Python minor version** on both machines: wheels are version-specific, and the reference build is Python 3.13, locked in `requirements.lock`. No network access is used at install or run time; `tests/test_offline.py` runs the analysis with every outbound connection blocked.

### Optional: local AI explanations

- Run `pip install -r requirements-ai.txt`, then place `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` (Apache-2.0, 2.5 GB) in `data/models/`. `prepare_offline.bat` does both.
- The model only drafts plain-language explanations. A deterministic verifier keeps a claim only if it is grounded in the cited records (see [Built to be trusted](#built-to-be-trusted)).
- Without the model, SAT-SA uses template explanations and everything else is unchanged.
- `python -m satsa.ai.warm` pre-generates explanations for the top findings. Each takes about 1–2 minutes on a 4-core CPU.

### Optional: a hosted click-through demo

The frontend can also be built as a static site that reads a snapshot of real API responses, for hosts like Vercel or Netlify. It never saves anything. See [`web/DEPLOY.md`](web/DEPLOY.md).

---

## Using SAT-SA

The UI is organised the way an examination runs: **Supervise → Investigate → Prove → Operate**. A **Guided demo** button in the top bar walks through it.

| Area | Page | What it's for |
|---|---|---|
| **Supervise** | Overview | Entity map, priority list, findings and systemic risk at a glance |
| | Review queue | Entities ranked by calibrated evidence. The FDR slider (5 / 10 / 20%) sets how many false alarms you accept |
| | Sectors | Flagged entities, recurring weaknesses and blind tactics per critical sector |
| | SOC providers | Outsourced SOCs whose clients share a weakness, for example one weak MSSP serving 7 entities in 4 sectors |
| **Investigate** | Entity dossier | Findings with reasons, evidence and regulations; evidence over time, time-to-close survival, the 24×7 reality heatmap, red-team reconciliation, and a printable **examination brief** that answers SEBI CSCRF SOC-efficacy questions from evidence |
| | Evidence drawer | The chart behind each finding, every underlying record down to the case timeline, and **accept / dismiss / escalate** |
| | Blind spots | ATT&CK tactics each entity cannot see at all |
| | Review Lab | Blind-first case review with prediction-powered confidence intervals |
| **Prove** | Validation | Calibration on healthy panels and results on real SOC data |
| | Red-Team Lab | Can a SOC game its regulator? Seven gaming strategies against five audit policies |
| | Audit ledger | Every run, upload, label and decision in a SHA-256 hash chain, with a tamper demo |
| **Operate** | Ingest submission | Validate and commit a periodic submission, then re-run the analysis |

### An examiner's path through a finding

```mermaid
sequenceDiagram
    autonumber
    actor E as Examiner
    participant UI as Web UI
    participant API as FastAPI on localhost
    participant AI as Local LLM, optional
    participant V as Verifier
    participant L as Ledger

    E->>UI: Open the review queue at 10% FDR
    UI->>API: GET /api/queue?fdr=0.1
    API-->>UI: Ranked entities with their strongest evidence
    E->>UI: Open an entity and a finding
    UI->>API: GET /api/entities/{id}/findings/{detector}
    API-->>UI: Chart data, reason, evidence records, regulation
    opt Plain-language explanation
        UI->>API: GET .../explain
        API->>AI: Evidence pack, entity notes fenced as untrusted
        AI-->>V: Schema-constrained JSON claims
        V-->>API: Keep only claims that cite and quote real records
        API-->>UI: Verified explanation, rejected claims shown
    end
    E->>UI: Accept, dismiss with a reason, or escalate
    UI->>API: POST .../disposition
    API->>L: Append a SHA-256 hash-chained entry
```

### Review Lab: fewer labels, honest intervals

Examiners can only read a handful of cases. The Review Lab makes those reviews count twice: once to confirm findings, and once to estimate how much superficial handling there really is.

```mermaid
flowchart LR
    C["All closed cases<br/>of one entity"] --> R["Uniform random sample"]
    C --> T["Targeted sample<br/>highest predicted risk"]
    R --> L["Examiner labels<br/>blind-first"]
    T --> K["Confirm findings<br/>never used in the estimate"]
    M["Superficial-handling model<br/>scores every case"] --> PPI
    L --> PPI["PPI++ interval<br/>true share of superficial handling"]
    L -. "too few labels" .-> W["Wilson interval<br/>PPI shown from 20 random labels"]

    classDef est fill:#defbe6,stroke:#24a148,color:#0b2e14
    classDef conf fill:#fff4d6,stroke:#b28600,color:#3d2e00
    class R,L,PPI est
    class T,K conf
```

The interval stays valid even if the model is poor; a good model just makes it narrower. On real analyst verdicts it covered the truth 98% of the time with 41% fewer labels.

---

## Bring your own data

Upload a periodic submission as one file per table, or one SQLite / JSON file containing several. Column names are normalised, and common vendor spellings are mapped (`AlertId`, `Rule ID`, `Hostname`, `Priority`, `created_at`, …).

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Uploaded
    Uploaded --> Validated: schema and alias checks
    Validated --> Rejected: row-numbered errors
    Rejected --> [*]: never silently repaired
    Validated --> Staged: file SHA-256 to ledger
    Staged --> Reanalysing: examiner commits
    Reanalysing --> Live: hot swap to a new DuckDB file
    Live --> [*]
```

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
- Try [`data/samples/broken/`](data/samples/broken/) (rejected with row-numbered errors) and [`data/samples/submission/`](data/samples/submission/) (new entity HLT-07, flagged after commit).

---

## Built to be trusted

**Every action is ledgered.** Each run, upload, label and decision is appended to a SHA-256 hash chain. Changing any past entry breaks every link after it, which `POST /api/ledger/verify` detects. The tamper demo edits a copy only.

```mermaid
flowchart LR
    G["Genesis"] -- "prev hash" --> R1["Analysis run<br/>run hash = data + code + seed"]
    R1 -- "prev hash" --> R2["Upload<br/>file SHA-256"]
    R2 -- "prev hash" --> R3["Examiner label"]
    R3 -- "prev hash" --> R4["Decision<br/>accept · dismiss · escalate"]
    R4 -.-> N["next entry"]
```

**The AI is on a short leash.** The optional local model never flags anyone and core findings never depend on it.

- Output is schema-constrained JSON, then checked by a deterministic `verify()`.
- Every claim must cite records in the evidence pack, quote them verbatim and use only numbers that appear there.
- Claims that try to clear the entity are rejected.
- Notes written by the entity are fenced as untrusted, and instruction-like text in them is flagged and never used as evidence.

**The predictor only targets reviews.** The superficial-handling model is a readable logistic regression on 11 case features. It picks review samples and powers the PPI estimate; it never raises a flag.

---

## Reproduce the validation

```bash
python -m satsa.eval.run_all            # synthetic suite -> reports/validation.json (~1 h on 4 cores; cached, resumable)
python -m satsa.guide.aggregate         # once: GUIDE CSVs -> data/guide/agg (~5 min)
python -m satsa.guide.experiments       # real-data suite -> reports/guide.json (~18 min)
python -m pytest tests -q               # unit, offline and end-to-end tests
```

- The committed results are in [`reports/validation.json`](reports/validation.json) and [`reports/guide.json`](reports/guide.json).
- GUIDE is not redistributed. Download it from Kaggle (`Microsoft/microsoft-security-incident-prediction`) into `data/guide/`.
- The seeded panel's answer key is written to `data/generated/_truth/`. The API never exposes it, except to the demo-only "simulated examiner".

<details>
<summary><b>Other useful commands</b></summary>

```bash
python -m satsa.gen.generator           # regenerate the synthetic panel (~90 s) -> data/generated/
python -m satsa.eval.quickcheck         # detector -log10(p) matrix + ranking vs the answer key
python -m satsa.eval.gaming             # print the Red-Team Lab detection matrix
python -m satsa.gen.samples             # rebuild data/samples/ (valid, broken, red-team)
python -m satsa.reset_demo              # clear labels, dispositions and ingested runs (API stopped)
cd web && npm install && npm run dev    # frontend dev server, proxies /api to :8000
cd web && npm run build                 # rebuild the UI into satsa/api/static
```

On Windows, set `PYTHONIOENCODING=utf-8`. DuckDB holds an exclusive file lock, so stop the API before running the pipeline or the eval scripts.

</details>

---

## Honest limitations

- **Headline detection numbers are synthetic.** Real-data results use GUIDE, which has analyst verdicts and expert queue ranks but no ground-truth "weak SOC" labels. So real-data recall is measured by planting degradations into real organisations.
- **Real organisations differ a great deal.** Peer comparison alone flags few real orgs at 10% FDR (the flags it does raise are stable across independent halves). SAT-SA's power there comes from **self-history** and **case-level evidence**, not raw peer ranking.
- **Subtle weaknesses have limits.** A 10% SLA-gaming share, or an escalation rate of 85% against 93%, is caught only some of the time. The power curves on the Validation page show exactly where.
- **Padding the paper trail defeats any metadata analytics.** SAT-SA's defence is the randomised review floor, which catches it 69% of the time within a year in the simulator.
- **Local explanations are slow and optional.** They take 1–2 minutes each on a laptop CPU, and findings never depend on them.
- **Out of scope:** real-time monitoring, live SIEM ingestion, and acting as a SOC.

---

## Repository layout

```
satsa/
├── gen/          seeded synthetic panel (42 entities, 7 NCIIPC sectors, 12 months) + sample submissions
├── ingest/       validation of uploaded submissions
├── detect/       19 detectors (one row per entity each)
├── stats/        calibrated tests, ACAT, BH / e-BH, PPI++, random-effects nulls
├── ai/           verifier-gated local explanations
├── eval/         validation suite and Red-Team Lab simulator
├── guide/        Microsoft GUIDE real-data experiments
├── api/          FastAPI server (serves the built UI from satsa/api/static)
├── pipeline.py   features -> detectors -> scores -> DuckDB (+ ledger)
├── workflow.py   submission commit, dispositions, red-team upload, sector view
├── review.py     Review Lab sampling and PPI++
├── ledger.py     append-only SHA-256 hash chain
└── brief.py      printable examination brief
web/              React 19 + TypeScript + IBM Carbon + ECharts UI
docs/             architecture (+ PDF), API contract and examples, calibration log
reports/          committed validation results
data/samples/     example uploads: valid, broken and red-team
tests/            unit, offline and end-to-end tests
```

**Tech stack:** Python (FastAPI, DuckDB, pandas, NumPy, SciPy, scikit-learn, lifelines) · React 19, TypeScript, Vite, IBM Carbon, ECharts · optional llama.cpp with a 4-bit GGUF model.

## Documentation

| Document | What's in it |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ([PDF](docs/ARCHITECTURE.pdf)) | Two-page solution architecture: functional design, methods, AI components, data requirements |
| [`docs/API.md`](docs/API.md) | The HTTP contract, with sample responses in [`docs/api-examples/`](docs/api-examples/) |
| [`docs/CALIBRATION_LOG.md`](docs/CALIBRATION_LOG.md) | Every statistical fix that was tried, with its numbers, including what failed and why |
| [`web/DEPLOY.md`](web/DEPLOY.md) | Building and hosting the static click-through demo |

## Licence

SAT-SA is released under the [Apache License 2.0](LICENSE). You may use, modify and redistribute it, including in commercial or government tools, provided you keep the licence and copyright notices and state any significant changes. The licence also grants a patent licence from contributors.

Copyright 2026 the SAT-SA authors.

## Third-party licences and credits

- **Python dependencies:** permissive only (MIT / BSD / Apache-2.0): FastAPI, DuckDB, pandas, NumPy, SciPy, scikit-learn, lifelines, psutil, llama-cpp-python (optional). No GPL or AGPL code; conformance checking and bunching are implemented from scratch.
- **Model:** Qwen3-4B-Instruct-2507, Apache-2.0 (optional, not included).
- **Data:** Microsoft GUIDE, CDLA-Permissive-2.0 (not redistributed).
- **Methods:**
  - Benjamini & Hochberg (1995); Liu & Xie (2020, ACAT); Wang & Ramdas (2022, e-BH).
  - Angelopoulos et al. (2023, prediction-powered inference and PPI++).
  - Chetty et al. (2011) and Kleven (2016) for bunching; Abadie et al. (2010) for synthetic control; Efron (2004) for the empirical null.

<div align="center">
<br />
<sub>Built for <b>Smart India Hackathon 2026</b> · Problem statement <b>SIH26157</b> (NTRO / NCIIPC)</sub>
</div>
