import { api } from "../api";
import { Chart, ErrorBox, Loading } from "../components/ui";
import { useData } from "../hooks";

const pc = (v: number | null | undefined, d = 0) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
const Syn = () => <span className="pill amber">synthetic</span>;
const Real = () => <span className="pill teal">real data · GUIDE</span>;
const STRAT: Record<string, string> = {
  random_cases: "Random cases", random_entities: "Random entities", severity_first: "Severity first", satsa: "SAT-SA queue + sampler",
  random: "Random", arrival_latest_first: "Newest first", most_alerts_first: "Most alerts first",
  satsa_tp_model: "SAT-SA (verdict model)", satsa_learned_from_examiners: "SAT-SA (learned from examiners)",
  satsa_review_lab_half_targeted: "SAT-SA Review Lab (½ targeted)",
};

function Kpi({ v, l, tag }: { v: string; l: string; tag?: any }) {
  return <div className="card kpi"><div className="v">{v}</div><div className="l">{l}</div><div style={{ marginTop: 6 }}>{tag}</div></div>;
}

export default function ValidationPage() {
  const v = useData(() => api.validation(), []);
  const g = useData(() => api.guide(), []);
  if (v.error) return <ErrorBox e={v.error} />;
  if (!v.data) return <Loading />;
  const V = v.data;
  const G = g.data?.available === false ? null : g.data;
  if (V.available === false)
    return <div className="card muted">Validation report not generated yet. Run <span className="mono">python -m satsa.eval.run_all</span>.</div>;
  const h = V.headline || {};
  const r5 = G?.R5_expert_priority?.rows || [];
  const p10 = (s: string) => r5.find((r: any) => r.strategy === s && r.budget === 10)?.precision;

  return (
    <>
      <h1>Validation</h1>
      <p className="sub">How we know the flags can be trusted. <b>Synthetic</b> results use seeded panels with a hidden answer key and are
        labelled as such. <b>Real-data</b> results use Microsoft GUIDE ({G?.dataset?.orgs?.toLocaleString() ?? "6,000+"} organisations,
        {" "}{G?.dataset?.incidents ? (G.dataset.incidents / 1e6).toFixed(2) + "M" : "1M"} incidents with analyst verdicts, expert priority labels for 499 queues).</p>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Kpi v={pc(h.planted_recall_any_lane_q10)} l={`planted weaknesses found at 10% FDR (${V.V1_recovery?.seeds?.length} seeds)`} tag={<Syn />} />
        <Kpi v={pc(h.null_realized_fdr_q10)} l={`realised false-alarm rate on ${h.null_panels} all-healthy panels (target ≤ 10%)`} tag={<Syn />} />
        <Kpi v={`${h.weak_found_per_100_satsa_b240?.toFixed(0)} vs ${h.weak_found_per_100_random_b240?.toFixed(0)}`}
          l="weak cases found per 100 examiner reviews: SAT-SA vs random" tag={<Syn />} />
        {G ? <Kpi v={`${pc(p10("satsa_learned_from_examiners"))} vs ${pc(p10("random"))}`}
          l="expert top-20 incidents among the first 10 reviewed: SAT-SA vs random" tag={<Real />} />
          : <Kpi v={pc(h.ppi_label_saving_n30)} l="examiner labels saved by PPI at equal precision" tag={<Syn />} />}
      </div>

      <div className="grid g2">
        <Calibration V={V} />
        <QQ V={V} />
        <Recovery V={V} />
        <PPI V={V} G={G} />
        <Effort V={V} />
        <Power V={V} />
      </div>

      {G && <RealData G={G} />}
      <Runtime V={V} />
    </>
  );
}

function Calibration({ V }: { V: any }) {
  const np = V.V2_calibration?.null_panels || [];
  const mx = V.V2_calibration?.mixed_panels || [];
  return (
    <div className="card">
      <h2>False-alarm control <Syn /></h2>
      <p className="sub" style={{ fontSize: 13 }}>{np[0]?.panels} independently seeded panels where every entity is healthy: any flag is a false alarm.
        Bars must stay at or below the promised level (dashed).</p>
      <Chart height={260} option={{
        tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { color: "#8fa3bf" } },
        xAxis: { type: "category", data: np.map((r: any) => `q = ${r.q}`) },
        yAxis: { type: "value", max: 0.3, axisLabel: { formatter: (x: number) => `${x * 100}%` } },
        series: [
          { name: "promised (q)", type: "line", data: np.map((r: any) => r.q), lineStyle: { type: "dashed", color: "#8fa3bf" }, symbol: "none" },
          { name: "realised: healthy-only panels", type: "bar", data: np.map((r: any) => r.realized_fdr), itemStyle: { color: "#2dd4bf" } },
          { name: "realised: panels with planted weaknesses", type: "bar", data: mx.map((r: any) => r.realized_fdr), itemStyle: { color: "#60a5fa" } },
          { name: "95% CI upper", type: "scatter", data: np.map((r: any) => r.ci95[1]), symbol: "triangle", itemStyle: { color: "#f5b544" } },
        ],
      }} />
    </div>
  );
}

function QQ({ V }: { V: any }) {
  const qq = V.V2_calibration?.qq;
  if (!qq) return null;
  const pts = (k: string) => qq.expected.map((e: number, i: number) => [e, qq[k][i]]);
  return (
    <div className="card">
      <h2>Are the p-values honest? <Syn /></h2>
      <p className="sub" style={{ fontSize: 13 }}>Under "nothing wrong", a calibrated p-value is uniform: points on the diagonal. Above it = cautious, below = over-confident.</p>
      <Chart height={260} option={{
        tooltip: {}, legend: { top: 0, textStyle: { color: "#8fa3bf" } },
        xAxis: { type: "value", name: "expected", min: 0, max: 1 }, yAxis: { type: "value", name: "observed", min: 0, max: 1 },
        series: [
          { name: "ideal", type: "line", data: [[0, 0], [1, 1]], symbol: "none", lineStyle: { type: "dashed", color: "#8fa3bf" } },
          { name: "each detector", type: "scatter", symbolSize: 4, data: pts("detector"), itemStyle: { color: "#60a5fa" } },
          { name: "entity (combined)", type: "scatter", symbolSize: 4, data: pts("entity"), itemStyle: { color: "#2dd4bf" } },
        ],
      }} />
    </div>
  );
}

function Recovery({ V }: { V: any }) {
  const rows = (V.V1_recovery?.by_archetype || []).slice().sort((a: any, b: any) => a.class.localeCompare(b.class) || a.median_rank - b.median_rank);
  return (
    <div className="card">
      <h2>Planted weaknesses recovered <Syn /></h2>
      <p className="sub" style={{ fontSize: 13 }}>{V.V1_recovery?.seeds?.length} seeded panels × 42 entities. Hard negatives are healthy but unusual (heavy SOAR use, very small SOC) and must not be flagged.</p>
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        <table><thead><tr><th>Archetype</th><th>Type</th><th>Detected</th><th>Median rank</th></tr></thead>
          <tbody>{rows.map((r: any) => (
            <tr key={r.archetype + r.class}><td>{r.archetype.replaceAll("_", " ")}</td>
              <td className="muted">{r.class.replaceAll("_", " ")}</td>
              <td className={r.class === "hard_negative" ? (r.detected === 0 ? "good" : "bad") : r.detected >= 0.9 ? "good" : "warn"}>{pc(r.detected)}</td>
              <td className="mono">{r.median_rank}</td></tr>))}</tbody></table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{V.V1_recovery?.note}</p>
    </div>
  );
}

function PPI({ V, G }: { V: any; G: any }) {
  const b = V.V3_ppi?.by_n || [];
  const real = G?.R4_ppi_real?.by_n || [];
  return (
    <div className="card">
      <h2>Fewer manual reviews, same confidence <Syn /> {real.length > 0 && <Real />}</h2>
      <p className="sub" style={{ fontSize: 13 }}>90% interval width for an entity's share of superficially handled cases: labels only (classical) vs labels + model (PPI).
        Coverage must stay at or above 90%.</p>
      <Chart height={260} option={{
        tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { color: "#8fa3bf" } },
        xAxis: { type: "category", name: "labels", data: b.map((r: any) => r.n) },
        yAxis: [{ type: "value", name: "width", axisLabel: { formatter: (x: number) => `${(x * 100).toFixed(0)}pp` } },
          { type: "value", name: "coverage", min: 0.5, max: 1, axisLabel: { formatter: (x: number) => `${x * 100}%` } }],
        series: [
          { name: "classical width", type: "bar", data: b.map((r: any) => r.classical_width), itemStyle: { color: "#475569" } },
          { name: "PPI width", type: "bar", data: b.map((r: any) => r.ppi_width), itemStyle: { color: "#2dd4bf" } },
          { name: "PPI coverage", type: "line", yAxisIndex: 1, data: b.map((r: any) => r.ppi_coverage), itemStyle: { color: "#f5b544" } },
        ],
      }} />
      <div className="row" style={{ fontSize: 13 }}>
        {b.filter((r: any) => r.n === 30).map((r: any) => <span key="s">At 30 labels PPI saves <b>{pc(r.label_saving)}</b> of labels (coverage {pc(r.ppi_coverage)}).</span>)}
        {real.filter((r: any) => r.n === 20).map((r: any) => <span key="r"> On real GUIDE verdicts: saves <b>{pc(r.label_saving)}</b>, coverage {pc(r.ppi_coverage)}.</span>)}
      </div>
    </div>
  );
}

function Effort({ V }: { V: any }) {
  const rows = V.V4_effort?.rows || [];
  const budgets = [...new Set(rows.map((r: any) => r.budget))] as number[];
  const strategies = [...new Set(rows.map((r: any) => r.strategy))] as string[];
  const col: Record<string, string> = { satsa: "#2dd4bf", random_cases: "#475569", random_entities: "#64748b", severity_first: "#94a3b8" };
  return (
    <div className="card">
      <h2>Examiner effort: SAT-SA vs manual sampling <Syn /></h2>
      <p className="sub" style={{ fontSize: 13 }}>Weak entities confirmed (≥ 3 superficial cases found) for the same number of case reviews.</p>
      <Chart height={260} option={{
        tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { color: "#8fa3bf" } },
        xAxis: { type: "category", name: "reviews", data: budgets },
        yAxis: { type: "value", name: "weak entities confirmed" },
        series: strategies.map((s) => ({
          name: STRAT[s] || s, type: "line", smooth: true, itemStyle: { color: col[s] }, lineStyle: { width: s === "satsa" ? 3 : 1.5 },
          data: budgets.map((b) => rows.find((r: any) => r.budget === b && r.strategy === s)?.weak_entities_confirmed),
        })),
      }} />
    </div>
  );
}

function Power({ V }: { V: any }) {
  const f = V.V5_power?.families || {};
  const names = Object.keys(f);
  return (
    <div className="card">
      <h2>What it can and cannot see <Syn /></h2>
      <p className="sub" style={{ fontSize: 13 }}>Detection rate at 10% FDR as a planted weakness grows (level 1 = subtlest).</p>
      <Chart height={260} option={{
        tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { color: "#8fa3bf" } },
        xAxis: { type: "category", data: ["1", "2", "3", "4", "5"], name: "effect level" },
        yAxis: { type: "value", max: 1, axisLabel: { formatter: (x: number) => `${x * 100}%` } },
        series: names.map((n) => {
          const fam = f[n];
          const order = fam.levels.map((l: number, i: number) => [Math.abs(l - fam.healthy_value), fam.detection_rate[i]]).sort((a: any, b: any) => a[0] - b[0]);
          return { name: fam.parameter, type: "line", data: order.map((x: any) => x[1]) };
        }),
      }} />
      <div className="muted" style={{ fontSize: 12 }}>{names.map((n) => <div key={n}>{f[n].parameter}: healthy {f[n].healthy_value}, levels {f[n].levels.join(", ")}</div>)}</div>
    </div>
  );
}

function RealData({ G }: { G: any }) {
  const r5 = G.R5_expert_priority?.rows || [];
  const strategies = [...new Set(r5.map((r: any) => r.strategy))] as string[];
  const r1 = G.R1_null_calibration;
  const r2 = G.R2_injected_recall?.rows || [];
  const r3 = G.R3_peer_flags;
  return (
    <>
      <h2 style={{ marginTop: 22 }}>Real SOC data: Microsoft GUIDE <Real /></h2>
      <div className="grid g2">
        <div className="card">
          <h2>Does SAT-SA's sampler find what experts prioritise?</h2>
          <p className="sub" style={{ fontSize: 13 }}>{G.R5_expert_priority?.orgs} real org queues swept by experts (top 20 each, median queue {G.R5_expert_priority?.median_queue_size} incidents).
            Share of the first B incidents reviewed that experts ranked top 20.</p>
          <Chart height={280} option={{
            tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { color: "#8fa3bf" }, type: "scroll" },
            grid: { top: 50 },
            xAxis: { type: "category", data: ["B = 5", "B = 10", "B = 20"] },
            yAxis: { type: "value", max: 1, axisLabel: { formatter: (x: number) => `${x * 100}%` } },
            series: strategies.map((s) => ({
              name: STRAT[s] || s, type: "bar",
              itemStyle: { color: s.startsWith("satsa_learned") ? "#2dd4bf" : s.startsWith("satsa") ? "#0f766e" : "#475569" },
              data: [5, 10, 20].map((b) => r5.find((r: any) => r.strategy === s && r.budget === b)?.precision ?? null),
            })),
          }} />
        </div>
        <div className="card">
          <h2>False alarms and recall on real organisations</h2>
          {r1 && <p style={{ fontSize: 13 }}>Real-data null: each org's incidents randomly re-split, so nothing changed. Over {r1.repeats} re-splits of {r1.orgs_tested?.toLocaleString()} orgs,
            realised false-alarm rate at 10% FDR: <b>{pc(r1.realized_fdr?.["0.1"]?.value)}</b> (95% CI up to {pc(r1.realized_fdr?.["0.1"]?.ci95?.[1])}).</p>}
          <table><thead><tr><th>Degradation planted in 5% of real orgs</th><th>Strength</th><th>Recall</th><th>Precision</th></tr></thead>
            <tbody>{r2.map((r: any, i: number) => (
              <tr key={i}><td>{r.kind === "category_suppressed" ? "Alert category silently suppressed" : "True positives re-graded as false"}</td>
                <td className="mono">{pc(r.level)}</td><td>{pc(r.recall)}</td><td>{pc(r.precision)}</td></tr>))}</tbody></table>
          {r3?.raw_peer_rate && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Stability: of the 20 most unusual orgs on one half of their incidents,
            {" "}{r3.raw_peer_rate.top20_overlap} are again top 20 on the independent other half (chance: {r3.raw_peer_rate.top20_overlap_by_chance}).</p>}
        </div>
      </div>
    </>
  );
}

function Runtime({ V }: { V: any }) {
  const r = V.V8_runtime;
  const rep = V.V9_reproducibility;
  const a = V.V12_anytime;
  if (!r && !rep) return null;
  return (
    <div className="grid g2" style={{ marginTop: 14 }}>
      {a && <div className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>Re-checking every quarter without inflating false alarms <Syn /></h2>
        <p style={{ fontSize: 13 }}>Four quarterly looks at {a.null_panels} all-healthy panels. Naive re-testing each quarter raised a false alarm in
          {" "}<b className="bad">{pc(a.naive_realized_fdr)}</b> of panels; SAT-SA's anytime-valid e-values in <b className="good">{pc(a.ebh_realized_fdr)}</b> (promise ≤ {pc(a.q)}).
          Planted weaknesses caught by the fourth look: {pc(a.planted_recall_by_look4_ebh)}.</p>
      </div>}
      {r && <div className="card">
        <h2>Runs on a laptop, offline</h2>
        <table><tbody>
          <tr><td>Machine</td><td>{r.machine?.cpu} · {r.machine?.logical_cores} threads · {r.machine?.ram_gb} GB RAM · {r.machine?.os}</td></tr>
          <tr><td>Panel</td><td>{r.demo_panel?.alerts?.toLocaleString()} alerts · {r.demo_panel?.cases?.toLocaleString()} cases · {r.demo_panel?.workflow_events?.toLocaleString()} workflow events</td></tr>
          <tr><td>Full analysis</td><td>{r.demo_panel?.analyze_seconds?.toFixed(0)} s, peak {r.demo_panel?.peak_memory_gb?.toFixed(1)} GB</td></tr>
          <tr><td>API latency (p95)</td><td>{Math.max(...(r.api_latency || []).map((x: any) => x.p95_ms)).toFixed(0)} ms worst endpoint</td></tr>
        </tbody></table>
      </div>}
      {rep && <div className="card">
        <h2>Reproducible</h2>
        <p style={{ fontSize: 13 }}>Same seed, separate processes: identical data <b className={rep.input_hash_equal ? "good" : "bad"}>{rep.input_hash_equal ? "✓" : "✗"}</b>,
          identical findings <b className={rep.result_hash_equal ? "good" : "bad"}>{rep.result_hash_equal ? "✓" : "✗"}</b></p>
        <p className="mono muted">data {rep.input_hash} · results {rep.result_hash}</p>
      </div>}
    </div>
  );
}
