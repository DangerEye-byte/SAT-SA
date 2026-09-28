import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtP, pct } from "../api";
import { CaseDrawer, FindingDrawer } from "../components/Drawers";
import { BasisPill, Chart, ErrorBox, Loading } from "../components/ui";
import { useData } from "../hooks";

const TABS = ["Findings", "Trends", "24×7 reality", "Regulatory", "Red team", "ATT&CK coverage"];
const STATE_COLOR: Record<string, string> = { covered: "#1f6a60", quiet: "#b7862b", blind: "#8f2f2f", not_applicable: "#1a2840" };

export default function EntityPage() {
  const { id = "" } = useParams();
  const { data: e, error } = useData(() => api.entity(id), [id]);
  const [tab, setTab] = useState(TABS[0]);
  const [det, setDet] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  if (error) return <ErrorBox e={error} />;
  if (!e) return <Loading />;
  const caps = Object.entries(e.capabilities);
  const basis = e.q_value <= 0.1 ? (e.n_deterministic ? "both" : "statistical") : (e.n_deterministic ? "deterministic" : null);
  return (
    <>
      <div className="row">
        <div>
          <h1>{e.entity_name} <span className="mono muted" style={{ fontSize: 14 }}>{e.entity_id}</span></h1>
          <p className="sub" style={{ margin: 0 }}>{e.sector_name} · size {e.size_band} · SOC: {e.soc_provider} · {e.n_assets} assets ·
            {e.claims_24x7 ? " declares 24×7 monitoring" : " business-hours SOC"}</p>
        </div>
        <div className="spacer" />
        <BasisPill basis={basis} />
        <Link className="btn primary" to={`/review/${e.entity_id}`}>Open review lab →</Link>
      </div>
      <div className="grid g4" style={{ margin: "16px 0" }}>
        <div className="card kpi"><div className="v">{e.attention.toFixed(0)}</div><div className="l">Supervisory attention (0–100, from calibrated q)</div></div>
        <div className="card kpi"><div className="v mono" style={{ fontSize: 22 }}>{fmtP(e.q_value)}</div><div className="l">q-value (entity, FDR-adjusted)</div></div>
        <div className="card kpi"><div className="v">{e.findings.length}</div><div className="l">findings for examiner review</div></div>
        <div className="card kpi"><div className="v">{e.trust_score.toFixed(0)}</div><div className="l">data trust (completeness {pct(e.trust_completeness)}, timeliness {pct(e.trust_timeliness)})</div></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "360px 1fr" }}>
        <div className="card">
          <h3>Capability profile (PS §i–viii)</h3>
          <Chart height={300} option={{
            radar: { indicator: caps.map(([k]) => ({ name: k.replace(" & ", " &\n"), max: 100 })), radius: "62%", axisName: { color: "#8fa3bf", fontSize: 10 },
              splitArea: { areaStyle: { color: ["#111c2e", "#0e1828"] } } },
            series: [{ type: "radar", data: [{ value: caps.map(([, v]) => Math.round(v)), name: "Concern", areaStyle: { color: "rgba(240,106,106,.25)" }, lineStyle: { color: "#f06a6a" } }] }],
          }} />
          <div className="muted" style={{ fontSize: 12 }}>Higher = stronger evidence of weakness in that capability.</div>
        </div>
        <div className="card">
          <div className="tabs">{TABS.map((t) => <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>
          {tab === "Findings" && (e.findings.length === 0 ? <div className="muted">No significant findings — this entity's evidence is consistent with its peers.</div> :
            e.findings.map((f) => (
              <div key={f.detector_id} className={`finding ${f.deterministic ? "det" : ""}`} onClick={() => setDet(f.detector_id)}>
                <div className="row"><span className="t">{f.name}</span><span className="pill gray">{f.family}</span><div className="spacer" />
                  {f.deterministic ? <span className="pill red">fact · {f.severity}</span> : <span className="mono muted">p={fmtP(f.p_value)}</span>}</div>
                <div className="r">{f.reason}</div>
                <div className="muted" style={{ fontSize: 12 }}>Tests: {f.regulations[0]} · click for evidence →</div>
              </div>)))}
          {tab === "Trends" && <Trends monthly={e.monthly} />}
          {tab === "24×7 reality" && <Hourly id={e.entity_id} />}
          {tab === "Regulatory" && <Regulatory id={e.entity_id} />}
          {tab === "Red team" && <RedTeam id={e.entity_id} />}
          {tab === "ATT&CK coverage" && (
            <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {e.tactics.map((t) => (
                <div key={t.tactic} className={t.state === "blind" ? "hatch" : ""} style={{ background: t.state === "blind" ? undefined : STATE_COLOR[t.state], padding: 8, borderRadius: 8, minHeight: 64 }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{t.tactic}</div>
                  <div style={{ fontSize: 11 }}>{t.state}</div>
                  <div className="mono" style={{ fontSize: 10 }}>{t.observed} obs / {t.expected ?? 0} exp</div>
                </div>))}
            </div>
          )}
        </div>
      </div>
      {det && <FindingDrawer entityId={e.entity_id} detector={det} onClose={() => setDet(null)} onCase={setCaseId} />}
      {caseId && <CaseDrawer caseId={caseId} onClose={() => setCaseId(null)} />}
    </>
  );
}

function Trends({ monthly }: { monthly: any[] }) {
  const x = monthly.map((m) => m.period);
  const line = (name: string, key: string, color: string) => ({ name, type: "line", data: monthly.map((m) => m[key] == null ? null : +(m[key] * 100).toFixed(1)), lineStyle: { color }, itemStyle: { color } });
  return <Chart height={320} option={{
    tooltip: { trigger: "axis" }, legend: { textStyle: { color: "#8fa3bf" } }, grid: { top: 40, left: 40, right: 15, bottom: 30 },
    xAxis: { type: "category", data: x }, yAxis: { type: "value", name: "%" },
    series: [line("Fast closures (p≤0.05)", "fast_share", "#f06a6a"), line("No investigation (high/crit)", "no_investigation_share", "#f5b544"),
      line("Templated notes", "templated_share", "#a78bfa"), line("Critical escalation rate", "escalation_rate_critical", "#2dd4bf")],
  }} />;
}

function Hourly({ id }: { id: string }) {
  const { data } = useData(() => api.hourly(id), [id]);
  if (!data) return <Loading />;
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cells = data.cells.map((c: any) => [c.hour, c.dow, Math.min(600, Math.round(c.median_ack_min))]);
  return <>
    <p className="muted" style={{ fontSize: 13 }}>Median minutes to acknowledge high/critical cases, by hour of week. A 24×7 SOC should look uniform.</p>
    <Chart height={300} option={{
      tooltip: { formatter: (p: any) => `${days[p.value[1]]} ${p.value[0]}:00 — median ack ${p.value[2]} min` },
      grid: { top: 10, left: 45, right: 20, bottom: 60 },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => `${i}`) }, yAxis: { type: "category", data: days },
      visualMap: { min: 0, max: 240, calculable: true, orient: "horizontal", left: "center", bottom: 0, inRange: { color: ["#0d2424", "#2dd4bf", "#f5b544", "#f06a6a"] }, textStyle: { color: "#8fa3bf" } },
      series: [{ type: "heatmap", data: cells }],
    }} />
  </>;
}

function Regulatory({ id }: { id: string }) {
  const { data } = useData(() => api.entityReg(id), [id]);
  if (!data) return <Loading />;
  const label: Record<string, ReactNode> = {
    evidence_contradicts: <span className="pill red">evidence contradicts</span>,
    insufficient_evidence: <span className="pill gray">insufficient evidence</span>,
    consistent: <span className="pill teal">consistent</span>,
  };
  return <table><thead><tr><th>Obligation</th><th>Status</th><th>Evidence</th></tr></thead>
    <tbody>{data.items.map((it: any, i: number) => <tr key={i}><td>{it.obligation}</td><td>{label[it.status]}</td><td className="muted" style={{ fontSize: 12 }}>{it.detector}: {it.effect}</td></tr>)}</tbody></table>;
}

function RedTeam({ id }: { id: string }) {
  const { data } = useData(() => api.redteam(id), [id]);
  if (!data) return <Loading />;
  if (!data.has_report) return <div className="muted">No red-team report submitted by this entity.</div>;
  const stages = ["executed", "alerted", "cased", "escalated"];
  return <>
    <p>{data.reason}</p>
    <Chart height={220} option={{
      grid: { left: 90, right: 30, top: 10, bottom: 20 }, xAxis: { type: "value" }, yAxis: { type: "category", data: stages.slice().reverse() },
      series: [{ type: "bar", data: stages.slice().reverse().map((s) => data.funnel[s]), itemStyle: { color: "#2dd4bf" }, label: { show: true, position: "right" } }],
    }} />
    <table><thead><tr><th>Technique</th><th>Tactic</th><th>Target</th><th>Alerted</th><th>Cased</th><th>Escalated</th></tr></thead>
      <tbody>{data.techniques.map((t: any) => <tr key={t.technique_id}><td><span className="mono">{t.technique_id}</span> {t.technique}</td><td>{t.tactic}</td><td className="mono">{t.target_asset}</td>
        <td>{t.alerted ? "✓" : <b className="bad">missed</b>}</td><td>{t.cased ? "✓" : "—"}</td><td>{t.escalated ? "✓" : "—"}</td></tr>)}</tbody></table>
  </>;
}
