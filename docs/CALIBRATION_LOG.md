# Calibration log: what we tried on the statistical model, what failed, what we kept

This log covers every change to the detector statistics, with the numbers that drove each decision. It exists so that no reasoning is lost across sessions. All numbers come from **synthetic** panels unless they are marked GUIDE (real data, Microsoft GUIDE).

Null panels are seeded rosters with no planted weakness. Any flag on one is a false flag. The target is realised FDR ≤ 10% at q = 0.1 over 40 null panels, with a detector-level type-I rate close to nominal.

---

## 1. First null diagnostic (null roster, seed 202, rate scale 0.25)

Symptoms:
- The smallest entity-level ACAT p across all entities was **0.946**, so nothing could ever be flagged.
- Detector p-values averaged about 0.45, with sd 0.16 to 0.22 (a uniform has mean 0.5 and sd 0.29).
- NS2, NS5 and NS7 were always exactly **1.0**, and the NS1 median was 1.0.
- EG6 bunching was **anti-conservative**: its 5% quantile was 0.014, with a minimum of 0.000.

Causes found:
- `rho` floor of 2e-3 in the beta-binomial. That is too wide once n is large, so every test was conservative.
- `NB_SIZE_FLOOR = 8`, and a fixed negative-binomial size r = 10 in NS2.
- Multi-part detectors took a Bonferroni minimum behind hard gates. When a gate failed, p was set to 1.0.
- Exact discrete tails, which are conservative for small counts.
- A pooled peer mean trimmed on the top side only, which is biased low.

## 2. Robust over-dispersion plus mid-p

The changes:
- `robust_overdispersion`: trimmed chi-square matching. Keep the lower 80% of z², whose expected mean under the null is 0.4377, and find the smallest theta that brings the trimmed mean down to that value.
- A symmetric 10% trimmed pooled mean.
- Lancaster mid-p for the discrete tests.
- `RHO_FLOOR = 1e-4`.

Simulation of the estimator (true rho 0.001996): median **0.00191**, mean **0.00204**, so it is unbiased.

The test was still slightly liberal at the 0.05 level: 5.9%, 6.6% and 5.8% over 3 seeds, and 6.25% for small counts. The cause is that peer estimation error is ignored. A finite-peer variance inflation, multiplying the variance by (1 + c/m) for m peers, fixes it:

| c | type I at 0.05 | type I at 0.01 | small counts at 0.05 / 0.01 |
|---|---|---|---|
| 1 | 5.5% | 1.4% | |
| 2 | 5.3% | 1.3% | |
| **3** | **5.17%** | **1.23%** | **5.23% / 1.0%** |

Kept: **`PEER_INFLATE = 3`**.

## 3. NS1 / NS2 / NS5 rewrites, and the first EG6 fix

- **NS1, NS2, NS5**:
  - ACAT across parts (assets, tactics, rules) replaces Bonferroni-min with hard gates;
  - a robust NB size (`nb_size_robust`) replaces the fixed floors;
  - NS5 became a late-share rate test (lower tail) against peers that run the same rule.
- **EG6**: a median/MAD empirical null on the bunching z was still heavy-tailed. Healthy BFS-03 reached **p = 0.0066** at entity level, and the z SD was about 1.25.
  - Switching to a **random-effects null on the log excess ratio** (`random_effects_null_p`) moved BFS-03 to **0.013**.
- After this, detector p-values had a mean of about 0.5 and sd of about 0.27, close to uniform.

## 4. Demo panel (seed 7) after those fixes

- All **11** statistically planted entities were flagged. PWR-03 is now caught statistically too, and there were **0** healthy flags.
- MSSP-3 clients sat at q 0.105 to 0.33, borderline by design. The provider lens catches them instead: +5.7 to +5.9 pp, p ≈ 0.023 to 0.025.

## 5. Quick suite: 3 of 6 null panels flagged

| Panel | Entity | Detector | p | Cause | Fix |
|---|---|---|---|---|---|
| hard_neg | BFS-04 (hard_neg_soar) | EG5 | 2e-6 to 2e-4 | **Case mix.** SOAR auto-closes the non-TP medium/high cases, so the human-handled mix differs. | `rate_test_expected`, with expected rates from peer strata severity × is_tp (EG3, EG4, EG5, EG13) and is_tp (EG2) |
| null | BFS-02 (healthy) | EG6 | 0.000245 | Expected 61.4 below the threshold vs about 70 for other large entities. The polynomial counterfactual's own uncertainty was ignored. | Add fit variance from `np.polyfit(cov=True)` to the log-ratio variance |

After both fixes, **0 of 6** null panels were flagged.

## 6. PPI under-coverage

Plain CLT prediction-powered inference covered only **0.68** at n = 30 while claiming a 99% label saving. When a sample has k = 0 superficial cases, the variance of Y is 0 and the interval collapses.

Fix: **PPI++**, with λ power-tuned and clipped to [0, 1], and the variance of Y Wilson-regularised: pt = (k + z²/2)/(n + z²), var_y = max(pt(1 − pt), var(Y)).

| Setting | Coverage | Label saving |
|---|---|---|
| Synthetic | 0.97 to 0.99 | |
| Synthetic, run 3, n = 30 | **0.9902** | **0.6935** |
| GUIDE (R4, real) | **0.978** | 0.41 |

## 7. Full run 1: crash at V8, then numbers

- **Crash.** V8 runs in the parent process, which had imported the old `store` module, while the edited `pipeline` needed `store.POINTER`.
  - Fix: `validation.json` is now written before V8, and V8 is wrapped in try/except.
  - Rule: do not edit store/pipeline while `run_all` is running.
- **Null FDR: 5%** (2 of 40 panels, 95% CI 0.61 to 16.9%).

Per-detector type-I rates at 0.01 / 0.05:

| Detector | 0.01 | 0.05 |
|---|---|---|
| EG1 | .006 | .045 |
| EG11 | .007 | .074 |
| EG12 | .005 | .044 |
| EG13 | .004 | .034 |
| EG2 | .002 | .042 |
| EG3 | .001 | .015 |
| EG4 | .005 | .035 |
| EG5 | .002 | .030 |
| EG6 | .0125 | .049 |
| EG7 (old definition) | .0095 | .048 |
| NS1 | .007 | .039 |
| NS2 | .001 | .029 |
| NS5 | .004 | .029 |
| NS7 | 0 | 0 |

Deterministic findings on null panels: **71 RT1 flags across 1,680 entities** (60 medium, 11 high). They are real misses: the simulator gives even a healthy SOC a 5% per-technique miss rate.

EG6 at full scale over 5 seeds: the planted gamer was caught at p = 1e-12 every time; non-gamers were ≤ 0.05 in 6.5% of cases and ≤ 0.01 in 0%.

## 8. Reason texts contradicting their p-values

A significant p-value sat next to a reassuring sentence:

| Detector | Entity | p | Text said |
|---|---|---|---|
| NS1 | PWR-03 | 2.3e-7 | "no silent assets" |
| NS1 | SPE-03 | 4e-3 | "no silent assets" |
| NS2 | PWR-03 | 1.3e-11 | "tactic mix normal" |
| NS2 | TRN-02 | 1.2e-8 | "tactic mix normal" |

Fixes:
- NS1 with p_entity < 0.01 and no individually silent asset now says "under-alerting", with the effect "N critical asset(s) under-alerting".
- NS2 with p < 0.01 and no fully quiet tactic now says "No visible tactic is missing outright, but X (o alerts vs ~e expected) runs well below…".
- Grammar fix: runs / run.

## 9. EG7 (unremediated root cause) redefinition trials

The old definition, any recurrence within 30 days, was almost always true, so it could not separate entities.

| Definition | Median rate | PWR-01 (planted) | BFS-02 (planted) |
|---|---|---|---|
| Any recurrence, 30 days (old) | 92% | 98% | |
| TP only, 30 days | 60% | | |
| **Same rule, TP, 14 days, high/critical** | **32%** | **59%** | **49%** |
| Same rule, TP, 7 days | 17.5% | | |
| Same category, TP, 14 days | 33.7% | | |

Kept: **the same detection rule re-fires as a TP on the same asset within 14 days of a closed high/critical TP.**

## 10. Definitive run 2: null FDR rose to 10%

Result: **4 of 40** null panels flagged (95% CI 2.79 to 23.66%).

| Panel | Entity | Detector | p |
|---|---|---|---|
| | SPE-05 | EG7 | 6.4e-5 |
| 1020 | SPE-02 | EG12 | 4.9e-5 |
| 1031 | TEL-06 | EG7 | 1e-6 (entity q 0.000465) |
| 1035 | PWR-03 | NS1 | 1.9e-5 |

- EG7 type-I was **0.0119 / 0.0542**: slightly liberal and heavy-tailed. TW1 was 0 / 0.0476.
- **V12, repeated looks**: naive BH at every quarter gave **40%** FDR (CI 24.9 to 56.7%), against **0%** for e-BH on running e-values (CI 0 to 8.8%). Planted recall by look 4 was 72.7% for both.
- Other results: PPI at n = 30 had coverage .9887 and saving .6891; V4 found 53.9 vs 6.67 weak cases per 100 reviews.

## 11. EG7 diagnosis and fix: asset clustering

Null panel 1031, entity TEL-06:
- n = 284 relevant cases, recurrence rate 35% vs a 22% peer median.
- Recurrence rates differ a lot by asset class: email_gw 44%, citizen_portal 5%.
- TEL-06's single email gateway had 33 cases recurring at 73%.
- So the binomial treated 284 cases as independent, when they cluster on a handful of assets.

Trials:
1. **Stratify by asset class only** (indirect standardisation). TEL-06 was still p = 2.7e-5, and the entity minimum q was .0158. Not enough.
2. **Asset-clustered O/E test** (kept):
   - expected recurrences per asset from the peers' class rate;
   - within-asset correlation rho estimated from peer assets with `robust_overdispersion`, clipped to [1e-4, 0.5];
   - var = Σ n·r(1 − r)(1 + (n − 1)ρ), and z = (O − E)/√var;
   - z is read against the peers' z values: median, with scale max(1, MAD·1.4826)·√(1 + 3/m).

Results of the kept version:

| Panel | Min EG7 p | Entity min q |
|---|---|---|
| null 1031 | .0011 | .654 |
| null diag | .064 | |
| null 1005 | .0041 | |

- Planted PWR-01 and BFS-02 stay at p = 1e-12.
- Bonus: on the small demo panel, the truly degraded MSSP-3 clients GOV-04, GOV-03 and HLT-03 now reach q ≤ 0.1.

## 12. Definitive run 3 (final detectors, `run_all --fresh --jobs 4`, 3,010 s)

**Null FDR: 5%** at q = 0.1 (2 of 40 panels, 95% CI 0.61 to 16.92%). The same 2 of 40 at q = 0.05, and 4 of 40 at q = 0.2. Mixed panels had realised FDR 0.

Remaining false flags (both were already present in run 2; the EG7 false flags are gone):

| Panel | Entity | Detector | p | Entity q |
|---|---|---|---|---|
| 1020 | SPE-02 | EG12 | 4.9e-5 | .031 |
| 1035 | PWR-03 | NS1 | 1.9e-5 | .012 |

Borderline at q = 0.2 only:
- null_1019: TEL-05 (EG12 6.7e-4), TRN-05 (NS1 3.2e-4) and SPE-03 (NS1 5.6e-4), all at q .1375;
- null_1022: HLT-04 (EG6 2.7e-4, q .166).

Per-detector type-I at 0.01 / 0.05:

| Detector | 0.01 | 0.05 |
|---|---|---|
| EG1 | .0060 | .0452 |
| EG11 | .0071 | .0736 |
| EG12 | .0054 | .0435 |
| EG13 | .0036 | .0339 |
| EG2 | .0024 | .0417 |
| EG3 | .0012 | .0149 |
| EG4 | .0048 | .0345 |
| EG5 | .0018 | .0298 |
| EG6 | .0125 | .0494 |
| **EG7** | **.0030** | **.0470** (was .0119 / .0542) |
| NS1 | .0071 | .0393 |
| NS2 | .0012 | .0286 |
| NS5 | .0042 | .0286 |
| NS7 | 0 | 0 |
| TW1 | 0 | .0476 |

Other results:
- **V1, recovery over 5 demo seeds**:
  - planted recall **100%**, both statistical and in any lane;
  - **0** hard-negative flags and **0** healthy statistical flags;
  - precision@k: 1.0 (k = 5), 1.0 (k = 10), .973 (k = 15), .95 (k = 20);
  - weak-provider clients recalled on their own: mean 5.7%. They are the provider lens's job.
- **V3 (PPI)**: coverage .9902, saving .6935.
- **V4 (effort)**: 54.6 vs 6.65 weak cases found per 100 reviews; at a 240-review budget, 4.0 vs 1.07 weak entities confirmed.
- **V5 (power, detection rate by planted strength)**:
  - escalation .35/.5/.65/.75/.85 → 1, 1, 1, 1, .167;
  - SLA gaming .1/.2/.3/.5/.75 → .167, .833, 1, 1, 1;
  - superficial handling: 1 at every level.
- **V12 (repeated looks)**: naive BH at every look **55%** FDR (CI 38.5 to 70.7%) vs e-BH **2.5%** (CI 0.06 to 13.2%). Planted recall by look 4 was 72.7% for both.
- **V9**: input and result hashes are identical across two separate processes.
- **V8 (runtime)**:
  - 453,041 alerts, 215,116 cases, 1,405,762 events;
  - analysis 166 s, peak memory 1.32 GB, full pipeline 180.9 s;
  - API p95 under 66 ms on every endpoint.

Known residuals, not chased further:
- EG11 is slightly liberal at 0.05 (.074) but fine at 0.01 (.007).
- EG6 is at .0125 at 0.01.
- Both residual false flags sit in single-detector tails. The entity-level FDR is within target, so any more tuning risks over-fitting to these 40 seeds.

---

## Local LLM (explanations) trials

The model is Qwen3-4B-Instruct-2507 Q4_K_M running on the CPU. Its output is schema-constrained JSON, then checked by a deterministic `verify()`.

| Trial | Latency | What went wrong | Fix |
|---|---|---|---|
| 1 (CPU contended) | 239 s, 229 s | TEL-02 JSON truncated at max_tokens 420, so unparseable. A summary was falsely rejected as "exonerating" because it quoted a note saying "no issue" / "benign". | maxLength limits in the schema (summary 240, claim 170, quote 90, 1 to 3 claims, 1 to 2 record ids), max_tokens 700, 3 evidence records, `_unquoted()` strips quoted text before the exoneration check, and a rejected summary falls back to the detector reason |
| 2 (CPU free) | 112.6 s, 117.9 s | Both came from the local model: 3 claims verified, 1 rejected. The summary was rejected because a truncated quote with no closing mark contained "benign". | `_unquoted()` also strips an unclosed trailing quote. Claims that quote text from an instruction-like (hostile) note are rejected, with a test in `tests/test_core.py`. |

## GUIDE R3 (real data), outcome

No org is flagged, either raw or case-mix adjusted. Between-org heterogeneity is large (rho 0.108), and about 10% of orgs have zero TPs.

R3 is therefore reported as ranking stability instead:
- top-20 overlap between re-splits: **16 of 20** (chance: 0.52);
- Spearman correlation: **0.975**.
