import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CertificateCheck, DataCheck, Scales } from "@carbon/icons-react";
import { api } from "../api";
import { Chart, Empty, ErrorBox, Figure, Info, Tipped, Kpi, Loading, PageHeader, Real, Synthetic, Tabs } from "../components/ui";
import CountUp from "../components/fx/CountUp";
import { useData } from "../hooks";
import { useTheme } from "../theme";

const pc = (v: number | null | undefined, d = 0) => (v == null ? "n/a" : `${(v * 100).toFixed(d)}%`);
const STRAT: Record<string, string> = {
  random_cases: "Random cases", random_entities: "Random entities", severity_first: "Severity first", satsa: "SAT-SA queue + sampler",
  random: "Random", arrival_latest_first: "Newest first", most_alerts_first: "Most alerts first",
  satsa_tp_model: "SAT-SA (verdict model)", satsa_learned_from_examiners: "SAT-SA (learned from examiners)",
  satsa_review_lab_half_targeted: "SAT-SA Review Lab (½ targeted)",
};
type TabId = "calibration" | "efficiency" | "power" | "real" | "ops";
const GUIDE = [
  { icon: Scales, title: "Synthetic: truth is known", text: "Seeded panels with a hidden answer key. Every such number carries an amber synthetic badge." },
  { icon: DataCheck, title: "Real: Microsoft GUIDE", text: "Real SOC incidents from thousands of organisations, with analyst verdicts and expert priority labels. Badged in teal." },
  { icon: CertificateCheck, title: "What to look for", text: "Realised false alarms at or below the promise, intervals that keep coverage, and better targeting than the alternatives." },
];
const T = ({ children, tag }: { children: ReactNode; tag: ReactNode }) => <span className="sa-inline" style={{ flexWrap: "wrap", gap: "0.5rem" }}>{children} {tag}</span>;

export default function ValidationPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<TabId>((params.get("tab") as TabId) || "calibration");
  const v = useData(() => api.validation(), []);
  const g = useData(() => api.guide(), []);
  if (v.error) return <ErrorBox e={v.error} />;
  if (!v.data) return <Loading page label="Loading the validation report" />;
  const V = v.data;
  const G = g.data?.available === false ? null : g.data;
  if (V.available === false) return <Empty icon={CertificateCheck} title="Validation report not generated yet">Run <span className="sa-mono">python -m satsa.eval.run_all</span>.</Empty>;
  const h = V.headline || {};
  const r5 = G?.R5_expert_priority?.rows || [];
  const p10 = (s: string) => r5.find((r: any) => r.strategy === s && r.budget === 10)?.precision;
  return (
    <>
      <PageHeader title="Validation" guideKey="validation" guide={GUIDE}
        lead={<>How we know the flags can be trusted. <b>Synthetic</b> results use seeded panels with a hidden answer key. <b>Real-data</b> results use Microsoft GUIDE
          ({G?.dataset?.orgs?.toLocaleString("en-IN") ?? "6,000+"} organisations, {G?.dataset?.incidents ? (G.dataset.incidents / 1e6).toFixed(2) + "M" : "1M"} incidents with analyst verdicts).</>} />

      <div className="sa-kpis sa-valkpis">
        <div className="sa-card sa-kpicard"><Kpi label="Planted weaknesses found at 10% FDR" tip={{ title: "Planted weaknesses found", text: "Share of the weaknesses planted in seeded panels that SAT-SA flagged at a 10% false-alarm budget, through either lane: statistics or documented fact." }} value={<CountUp value={h.planted_recall_any_lane_q10 != null ? h.planted_recall_any_lane_q10 * 100 : null} suffix="%" />} note={`${V.V1_recovery?.seeds?.length} seeded panels`} tag={<Synthetic />} /></div>
        <div className="sa-card sa-kpicard"><Kpi label="Realised false alarms, 10% promise" tip={{ title: "Realised false alarms", text: "On panels where every entity is healthy, the share of flags that were false alarms. At or below the 10% promise means the budget is honest." }} value={<CountUp value={h.null_realized_fdr_q10 != null ? h.null_realized_fdr_q10 * 100 : null} decimals={1} suffix="%" />} note={`${h.null_panels} all-healthy panels`} tag={<Synthetic />} /></div>
        <div className="sa-card sa-kpicard"><Kpi label="Weak cases found per 100 reviews" tip={{ title: "Weak cases per 100 reviews", text: "For the same number of case reviews, how many superficially handled cases an examiner finds by following SAT-SA's queue and sampler, against picking cases at random." }} value={<>{h.weak_found_per_100_satsa_b240?.toFixed(0)}<small>vs {h.weak_found_per_100_random_b240?.toFixed(0)} random</small></>} tag={<Synthetic />} /></div>
        {G ? <div className="sa-card sa-kpicard sa-kpicard--real"><Kpi label="Expert top-20 in first 10 reviewed" tip={{ title: "Expert priority on real data", text: "On real Microsoft GUIDE queues: of the first 10 incidents SAT-SA sends for review, the share that experts ranked in their top 20, against random order." }} value={<>{pc(p10("satsa_learned_from_examiners"))}<small>vs {pc(p10("random"))} random</small></>} note={`${G.R5_expert_priority?.orgs} real SOC queues`} tag={<Real />} /></div>
          : <div className="sa-card sa-kpicard"><Kpi label="Examiner labels saved by PPI" tip="ppi" value={pc(h.ppi_label_saving_n30)} tag={<Synthetic />} /></div>}
      </div>

      <div className="sa-section">
        <Tabs label="Validation sections" value={tab} onChange={setTab} items={[
          { id: "calibration", label: "False-alarm control" }, { id: "efficiency", label: "Examiner effort" }, { id: "power", label: "What it can see" },
          { id: "real", label: "Real SOC data" }, { id: "ops", label: "Runs offline" }]} />
      </div>
      <div className="sa-rise" key={tab} style={{ marginTop: "1.25rem" }}>
        {tab === "calibration" && <div className="sa-grid sa-grid--lead"><Calibration V={V} /><QQ V={V} /></div>}
        {tab === "efficiency" && <div className="sa-grid sa-grid--2"><Effort V={V} /><PPI V={V} G={G} /></div>}
        {tab === "power" && <div className="sa-grid sa-grid--2"><Power V={V} /><Recovery V={V} h={h} /></div>}
        {tab === "real" && (G ? <RealData G={G} /> : g.error ? <ErrorBox e={g.error} /> : g.data ? <Empty icon={DataCheck} title="GUIDE results not generated">Run <span className="sa-mono">python -m satsa.guide.experiments</span>.</Empty> : <Loading label="Loading GUIDE results" />)}
        {tab === "ops" && <Runtime V={V} />}
      </div>
    </>
  );
}

function Calibration({ V }: { V: any }) {
  const { p } = useTheme();
  const np = V.V2_calibration?.null_panels || [];
  const mx = V.V2_calibration?.mixed_panels || [];
  const at10 = np.find((r: any) => Math.abs(r.q - 0.1) < 1e-9);
  return (
    <section className="sa-card">
      <Figure title={<T tag={<Synthetic />}>{at10 ? `${pc(at10.realized_fdr)} false alarms realised at the 10% promise` : "False-alarm control"}</T>}
        tip="fdrChecked" sub={`${np[0]?.panels} independently seeded panels where every entity is healthy: any flag is a false alarm. Bars must stay at or below the promised level (dashed).`}>
        <Chart height={280} label="Realised against promised false-discovery rate" option={{
          tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { top: 40, left: 44, right: 12, bottom: 28 },
          xAxis: { type: "category", data: np.map((r: any) => `promise ${r.q * 100}%`) },
          yAxis: { type: "value", max: 0.3, axisLabel: { formatter: (x: number) => `${Math.round(x * 100)}%` } },
          series: [
            { name: "promised", type: "line", data: np.map((r: any) => r.q), lineStyle: { type: "dashed", color: p.helper }, itemStyle: { color: p.helper }, symbol: "none" },
            { name: "healthy-only panels", type: "bar", barMaxWidth: 34, data: np.map((r: any) => r.realized_fdr), itemStyle: { color: p.accent } },
            { name: "panels with planted weaknesses", type: "bar", barMaxWidth: 34, data: mx.map((r: any) => r.realized_fdr), itemStyle: { color: p.neutral1 } },
            { name: "95% CI upper", type: "scatter", data: np.map((r: any) => r.ci95[1]), symbol: "triangle", itemStyle: { color: p.review } },
          ],
        }} />
      </Figure>
    </section>
  );
}

function QQ({ V }: { V: any }) {
  const { p } = useTheme();
  const qq = V.V2_calibration?.qq;
  if (!qq) return null;
  const pts = (k: string) => qq.expected.map((e: number, i: number) => [e, qq[k][i]]);
  return (
    <section className="sa-card">
      <Figure title={<T tag={<Synthetic />}>Are the p-values honest?</T>}
        tip={{ title: "QQ plot", text: "Each point is one p-value from an all-healthy panel, sorted against where a perfectly calibrated p-value would fall. On the diagonal means p-values can be taken at face value." }} sub="Under 'nothing wrong', a calibrated p-value is uniform: points on the diagonal. Above it = cautious; below = over-confident.">
        <Chart height={280} label="QQ plot of null p-values" option={{
          tooltip: {}, legend: { top: 0 }, grid: { top: 40, left: 44, right: 12, bottom: 36 },
          xAxis: { type: "value", name: "expected", min: 0, max: 1, nameLocation: "middle", nameGap: 22 }, yAxis: { type: "value", name: "observed", min: 0, max: 1 },
          series: [
            { name: "ideal", type: "line", data: [[0, 0], [1, 1]], symbol: "none", lineStyle: { type: "dashed", color: p.helper }, itemStyle: { color: p.helper } },
            { name: "each detector", type: "scatter", symbolSize: 4, data: pts("detector"), itemStyle: { color: p.neutral1 } },
            { name: "entity (combined)", type: "scatter", symbolSize: 4, data: pts("entity"), itemStyle: { color: p.accent } },
          ],
        }} />
      </Figure>
    </section>
  );
}

function Recovery({ V, h }: { V: any; h: any }) {
  const rows = (V.V1_recovery?.by_archetype || []).slice().sort((a: any, b: any) => a.class.localeCompare(b.class) || a.median_rank - b.median_rank);
  return (
    <section className="sa-card sa-card--flush">
      <div className="sa-card__head"><div>
        <h2 className="sa-card__title"><T tag={<Synthetic />}>{h.planted_recall_any_lane_q10 != null ? `Planted weaknesses recovered: ${pc(h.planted_recall_any_lane_q10)} at 10% FDR` : "Planted weaknesses recovered"}</T><Info tip={{ title: "Recovery by archetype", text: "Each archetype is a kind of weakness planted in the seeded panels. Detected: share of panels where it was flagged. Median rank: its median place in the queue, 1 being the top. Hard negatives are healthy and should never be detected." }} /></h2>
        <p className="sa-card__sub">{V.V1_recovery?.seeds?.length} seeded panels × 42 entities. Hard negatives are healthy but unusual and must not be flagged.</p>
      </div></div>
      <div className="sa-tablewrap" style={{ maxHeight: 340 }}>
        <table className="sa-t sa-t--sm">
          <thead><tr><th>Archetype</th><th>Type</th><th className="is-num">Detected</th><th className="is-num">Median rank</th></tr></thead>
          <tbody>{rows.map((r: any) => (
            <tr key={r.archetype + r.class}><td>{r.archetype.replaceAll("_", " ")}</td><td className="sa-muted">{r.class.replaceAll("_", " ")}</td>
              <td className={`is-num ${r.class === "hard_negative" ? (r.detected === 0 ? "sa-ok" : "sa-confirmed") : r.detected >= 0.9 ? "sa-ok" : "sa-review"}`}>{pc(r.detected)}</td>
              <td className="is-num sa-mono">{r.median_rank}</td></tr>))}</tbody>
        </table>
      </div>
      {V.V1_recovery?.note && <p className="sa-helper" style={{ padding: "0.75rem 1.25rem", margin: 0 }}>{V.V1_recovery.note}</p>}
    </section>
  );
}

function PPI({ V, G }: { V: any; G: any }) {
  const { p } = useTheme();
  const b = V.V3_ppi?.by_n || [];
  const real = G?.R4_ppi_real?.by_n || [];
  const at30 = b.find((r: any) => r.n === 30);
  const r20 = real.find((r: any) => r.n === 20);
  return (
    <section className="sa-card">
      <Figure title={<T tag={<>{<Synthetic />} {real.length > 0 && <Real />}</>}>{at30 ? `${pc(at30.label_saving)} fewer labels for the same confidence at 30` : "Fewer manual reviews, same confidence"}</T>}
        tip="ppi" sub="90% interval width for an entity's share of superficially handled cases: labels only (classical) against labels plus model (PPI). Coverage must stay at or above 90%."
        note={<>{at30 && <>At 30 labels PPI saves <b>{pc(at30.label_saving)}</b> of labels (coverage {pc(at30.ppi_coverage)}).</>}
          {r20 && <> On real GUIDE verdicts: saves <b>{pc(r20.label_saving)}</b>, coverage {pc(r20.ppi_coverage)}.</>}</>}>
        <Chart height={270} label="Interval width and coverage by number of labels" option={{
          tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { top: 40, left: 48, right: 48, bottom: 36 },
          xAxis: { type: "category", name: "labels", nameLocation: "middle", nameGap: 22, data: b.map((r: any) => r.n) },
          yAxis: [{ type: "value", name: "width", axisLabel: { formatter: (x: number) => `${(x * 100).toFixed(0)}pp` } },
            { type: "value", name: "coverage", min: 0.5, max: 1, splitLine: { show: false }, axisLabel: { formatter: (x: number) => `${Math.round(x * 100)}%` } }],
          series: [
            { name: "classical width", type: "bar", data: b.map((r: any) => r.classical_width), itemStyle: { color: p.neutral1 } },
            { name: "PPI width", type: "bar", data: b.map((r: any) => r.ppi_width), itemStyle: { color: p.accent } },
            { name: "PPI coverage", type: "line", yAxisIndex: 1, data: b.map((r: any) => r.ppi_coverage), itemStyle: { color: p.review }, lineStyle: { color: p.review } },
          ],
        }} />
      </Figure>
    </section>
  );
}

function Effort({ V }: { V: any }) {
  const { p } = useTheme();
  const rows = V.V4_effort?.rows || [];
  const budgets = [...new Set(rows.map((r: any) => r.budget))] as number[];
  const strategies = [...new Set(rows.map((r: any) => r.strategy))] as string[];
  const col: Record<string, string> = { satsa: p.accent, random_cases: p.neutral1, random_entities: p.neutral2, severity_first: p.helper };
  const maxB = Math.max(...budgets);
  const at = (s: string) => rows.find((r: any) => r.budget === maxB && r.strategy === s)?.weak_entities_confirmed;
  return (
    <section className="sa-card">
      <Figure title={<T tag={<Synthetic />}>{at("satsa") != null && at("random_cases") != null ? `${at("satsa")} weak entities confirmed against ${at("random_cases")} for random cases, at ${maxB} reviews` : "Examiner effort: SAT-SA against manual sampling"}</T>}
        tip={{ title: "Examiner effort", text: "A weak entity counts as confirmed once an examiner finds at least 3 superficial cases there. Each line is a way of choosing which cases to review; higher is better for the same effort." }} sub="Weak entities confirmed (at least 3 superficial cases found) for the same number of case reviews.">
        <Chart height={270} label="Weak entities confirmed by review budget" option={{
          tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { top: 40, left: 44, right: 12, bottom: 36 },
          xAxis: { type: "category", name: "reviews", nameLocation: "middle", nameGap: 22, data: budgets },
          yAxis: { type: "value", name: "weak entities confirmed" },
          series: strategies.map((s) => ({
            name: STRAT[s] || s, type: "line", smooth: true, itemStyle: { color: col[s] }, lineStyle: { width: s === "satsa" ? 3 : 1.5, color: col[s] },
            areaStyle: s === "satsa" ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: p.accent + "33" }, { offset: 1, color: p.accent + "00" }] } } : undefined,
            data: budgets.map((bb) => rows.find((r: any) => r.budget === bb && r.strategy === s)?.weak_entities_confirmed),
          })),
        }} />
      </Figure>
    </section>
  );
}

function Power({ V }: { V: any }) {
  const f = V.V5_power?.families || {};
  const names = Object.keys(f);
  return (
    <section className="sa-card">
      <Figure tip={{ title: "Detection power", text: "How detection grows as a planted weakness gets stronger, level 1 being the subtlest. It shows honestly where SAT-SA stops seeing, so examiners know what a clean result does and does not mean." }} title={<T tag={<Synthetic />}>What it can and cannot see</T>} sub="Detection rate at 10% FDR as a planted weakness grows (level 1 = subtlest)."
        note={names.map((n) => <span key={n} style={{ display: "block" }}>{f[n].parameter}: healthy {f[n].healthy_value}, levels {f[n].levels.join(", ")}</span>)}>
        <Chart height={270} label="Detection rate by effect level" option={{
          tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { top: 40, left: 44, right: 12, bottom: 36 },
          xAxis: { type: "category", data: ["1", "2", "3", "4", "5"], name: "effect level", nameLocation: "middle", nameGap: 22 },
          yAxis: { type: "value", max: 1, axisLabel: { formatter: (x: number) => `${Math.round(x * 100)}%` } },
          series: names.map((n) => {
            const fam = f[n];
            const order = fam.levels.map((l: number, i: number) => [Math.abs(l - fam.healthy_value), fam.detection_rate[i]]).sort((a: any, b: any) => a[0] - b[0]);
            return { name: fam.parameter, type: "line", smooth: 0.2, data: order.map((x: any) => x[1]) };
          }),
        }} />
      </Figure>
    </section>
  );
}

function RealData({ G }: { G: any }) {
  const { p } = useTheme();
  const r5 = G.R5_expert_priority?.rows || [];
  const strategies = [...new Set(r5.map((r: any) => r.strategy))] as string[];
  const r1 = G.R1_null_calibration;
  const r2 = G.R2_injected_recall?.rows || [];
  const r3 = G.R3_peer_flags;
  const p10 = (s: string) => r5.find((r: any) => r.strategy === s && r.budget === 10)?.precision;
  return (
    <section className="sa-realband" aria-label="Real SOC data">
      <div className="sa-realband__head">
        <div><h2 className="sa-h2"><Tipped text="Real SOC data: Microsoft GUIDE" tip="real" /></h2><p className="sa-body">Incidents from {G.dataset?.orgs?.toLocaleString("en-IN")} real organisations, with analyst verdicts and expert priority labels.</p></div>
        <Real />
      </div>
      <div className="sa-grid sa-grid--lead">
        <div className="sa-card">
          <Figure title={p10("satsa_learned_from_examiners") != null ? `${pc(p10("satsa_learned_from_examiners"))} of the first 10 reviewed are expert top-20, against ${pc(p10("random"))} for random` : "Does SAT-SA's sampler find what experts prioritise?"}
            tip={{ title: "Precision at budget B", text: "For each real organisation, experts marked their top 20 incidents. Bars show the share of the first B incidents each strategy would review that are in that top 20." }} sub={`${G.R5_expert_priority?.orgs} real org queues swept by experts (top 20 each, median queue ${G.R5_expert_priority?.median_queue_size} incidents). Share of the first B incidents reviewed that experts ranked top 20.`}>
            <Chart height={290} label="Expert-priority precision by review budget" option={{
              tooltip: { trigger: "axis" }, legend: { top: 0, type: "scroll" }, grid: { top: 48, left: 44, right: 12, bottom: 28 },
              xAxis: { type: "category", data: ["B = 5", "B = 10", "B = 20"] },
              yAxis: { type: "value", max: 1, axisLabel: { formatter: (x: number) => `${Math.round(x * 100)}%` } },
              series: strategies.map((s) => ({
                name: STRAT[s] || s, type: "bar", barMaxWidth: 22,
                itemStyle: { color: s.startsWith("satsa_learned") ? p.accent : s.startsWith("satsa") ? p.ok : p.neutral1 },
                data: [5, 10, 20].map((bb) => r5.find((r: any) => r.strategy === s && r.budget === bb)?.precision ?? null),
              })),
            }} />
          </Figure>
        </div>
        <div className="sa-card sa-stack">
          <h3 className="sa-card__title"><Tipped text="False alarms and recall on real organisations" tip={{ title: "Real-data checks", text: "False alarms: each real organisation's incidents are split at random, so nothing differs and any flag is a false alarm. Recall: a degradation is planted in 5% of real organisations and we count how often it is found." }} /></h3>
          {r1 && <p className="sa-body">Real-data null: each org's incidents randomly re-split, so nothing changed. Over {r1.repeats} re-splits of {r1.orgs_tested?.toLocaleString("en-IN")} orgs,
            realised false-alarm rate at 10% FDR: <b className="sa-ok">{pc(r1.realized_fdr?.["0.1"]?.value)}</b> (95% CI up to {pc(r1.realized_fdr?.["0.1"]?.ci95?.[1])}).</p>}
          <div className="sa-card sa-card--flush" style={{ boxShadow: "none" }}>
            <table className="sa-t sa-t--sm">
              <thead><tr><th>Degradation planted in 5% of real orgs</th><th className="is-num">Strength</th><th className="is-num">Recall</th><th className="is-num">Precision</th></tr></thead>
              <tbody>{r2.map((r: any, i: number) => (
                <tr key={i}><td>{r.kind === "category_suppressed" ? "Alert category silently suppressed" : "True positives re-graded as false"}</td>
                  <td className="is-num sa-mono">{pc(r.level)}</td><td className="is-num">{pc(r.recall)}</td><td className="is-num">{pc(r.precision)}</td></tr>))}</tbody>
            </table>
          </div>
          {r3?.raw_peer_rate && <p className="sa-helper" style={{ margin: 0 }}>Stability: of the 20 most unusual orgs on one half of their incidents,
            {" "}{r3.raw_peer_rate.top20_overlap} are again top 20 on the independent other half (chance: {r3.raw_peer_rate.top20_overlap_by_chance}).</p>}
        </div>
      </div>
    </section>
  );
}

function Runtime({ V }: { V: any }) {
  const r = V.V8_runtime;
  const rep = V.V9_reproducibility;
  const a = V.V12_anytime;
  if (!r && !rep && !a) return <Empty title="No runtime results in this report" />;
  return (
    <div className="sa-stack" style={{ gap: "1.25rem" }}>
      {a && <section className="sa-card">
        <h2 className="sa-card__title">Re-checking every quarter without inflating false alarms <Synthetic /><Info tip="evalue" /></h2>
        <p className="sa-body" style={{ fontSize: "0.9375rem", marginTop: "0.5rem" }}>Four quarterly looks at {a.null_panels} all-healthy panels. Naive re-testing each quarter raised a false alarm in
          {" "}<b className="sa-confirmed">{pc(a.naive_realized_fdr)}</b> of panels; SAT-SA's anytime-valid e-values in <b className="sa-ok">{pc(a.ebh_realized_fdr)}</b> (promise at most {pc(a.q)}).
          Planted weaknesses caught by the fourth look: {pc(a.planted_recall_by_look4_ebh)}.</p>
      </section>}
      <div className="sa-grid sa-grid--2">
        {r && <section className="sa-card">
          <h2 className="sa-card__title" style={{ marginBottom: "0.75rem" }}><Tipped text="Runs on a laptop, offline" tip={{ title: "Measured, not claimed", text: "Timed by the validation suite on this machine, CPU only, with no network. API latency is the 95th percentile of the slowest endpoint." }} /></h2>
          <dl className="sa-kv">
            <dt>Machine</dt><dd>{r.machine?.cpu}, {r.machine?.logical_cores} threads, {r.machine?.ram_gb} GB RAM, {r.machine?.os}</dd>
            <dt>Panel</dt><dd className="sa-num">{r.demo_panel?.alerts?.toLocaleString("en-IN")} alerts, {r.demo_panel?.cases?.toLocaleString("en-IN")} cases, {r.demo_panel?.workflow_events?.toLocaleString("en-IN")} workflow events</dd>
            <dt>Full analysis</dt><dd className="sa-num">{r.demo_panel?.analyze_seconds?.toFixed(0)} s, peak {r.demo_panel?.peak_memory_gb?.toFixed(1)} GB</dd>
            <dt>API latency (p95)</dt><dd className="sa-num">{Math.max(...(r.api_latency || []).map((x: any) => x.p95_ms)).toFixed(0)} ms, worst endpoint</dd>
          </dl>
        </section>}
        {rep && <section className="sa-card">
          <h2 className="sa-card__title" style={{ marginBottom: "0.75rem" }}><Tipped text="Reproducible" tip={{ title: "Reproducible", text: "Two separate runs with the same seed produce identical data and identical findings. The hashes below are their fingerprints; anyone can rerun and compare." }} /></h2>
          <p className="sa-body">Same seed, separate processes: identical data <b className={rep.input_hash_equal ? "sa-ok" : "sa-confirmed"}>{rep.input_hash_equal ? "yes" : "no"}</b>;
            identical findings <b className={rep.result_hash_equal ? "sa-ok" : "sa-confirmed"}>{rep.result_hash_equal ? "yes" : "no"}</b>.</p>
          <p className="sa-mono sa-muted" style={{ overflowWrap: "anywhere", marginBottom: 0 }}>data {rep.input_hash}<br />results {rep.result_hash}</p>
        </section>}
      </div>
    </div>
  );
}
