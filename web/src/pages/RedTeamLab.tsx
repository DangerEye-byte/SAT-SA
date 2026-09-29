import { useState } from "react";
import { api } from "../api";
import { Chart, ErrorBox, Loading } from "../components/ui";
import { useData } from "../hooks";

const S: Record<string, string> = {
  honest: "Honest SOC (false alarms)", delay: "Delay: weak after month 6", drift: "Drift: slides to weak",
  cherry_pick: "Cherry-pick: weak on unsampled cases", off_audit_drift: "Off-audit drift: good only in audit months",
  attrition: "Attrition: drops bad cases", metadata_masking: "Metadata masking: pads the paper trail",
};
const P: Record<string, string> = {
  annual_audit: "Annual audit", quarterly_audit: "Quarterly audit", unannounced: "Unannounced audits",
  satsa_analytics: "SAT-SA analytics", satsa_with_floor: "SAT-SA + random floor",
};

export default function RedTeamLab() {
  const { data: m, error } = useData(() => api.gaming(), []);
  const [sel, setSel] = useState<[string, string]>(["off_audit_drift", "quarterly_audit"]);
  const [seed, setSeed] = useState(1);
  const run = useData(() => api.gamingRun(sel[0], sel[1], seed), [sel[0], sel[1], seed]);
  if (error) return <ErrorBox e={error} />;
  if (!m) return <Loading />;
  const cells = m.cells.map((c: any) => [m.policies.indexOf(c.policy), m.strategies.indexOf(c.strategy), Math.round(c.detection_rate * 100)]);
  const t = run.data;
  return (
    <>
      <h1>Red-Team Lab: can a SOC game its regulator? <span className="pill amber">synthetic simulation</span></h1>
      <p className="sub">Each auditee strategy hides a weak SOC (15% of cases handled superficially vs 3% when healthy). Each auditor policy gets the
        same budget: {m.review_budget_per_year} human case reviews per year. Cells show how often the weakness is caught within 12 months
        ({m.sims_per_cell} simulations each). Click a cell to replay one year.</p>
      <div className="grid g2">
        <div className="card">
          <Chart height={380} option={{
            tooltip: { formatter: (p: any) => `${S[m.strategies[p.value[1]]]}<br/>${P[m.policies[p.value[0]]]}: caught ${p.value[2]}%` },
            grid: { top: 10, left: 230, right: 20, bottom: 70 },
            xAxis: { type: "category", data: m.policies.map((x: string) => P[x]), axisLabel: { interval: 0, rotate: 20, fontSize: 11 } },
            yAxis: { type: "category", data: m.strategies.map((x: string) => S[x]), axisLabel: { fontSize: 11 } },
            visualMap: { show: false, min: 0, max: 100, inRange: { color: ["#2c1414", "#6b2c2c", "#b7862b", "#1f6a60", "#2dd4bf"] } },
            series: [{ type: "heatmap", data: cells, label: { show: true, formatter: (p: any) => `${p.value[2]}%`, color: "#fff" } }],
          }} onEvents={{ click: (p: any) => setSel([m.strategies[p.value[1]], m.policies[p.value[0]]]) }} />
          <p className="muted" style={{ fontSize: 12 }}>Honest row = false alarms (should be near 0). Fixed schedules are gamed; analytics on every submission
            catch timing and attrition games; padding the paper trail beats analytics alone, and a small randomised review floor restores detection.</p>
        </div>
        <div className="card">
          <div className="row"><h2 style={{ margin: 0 }}>{S[sel[0]]} vs {P[sel[1]]}</h2><div className="spacer" />
            <button className="btn" onClick={() => setSeed(seed + 1)}>Replay another year ↻</button></div>
          {!t ? <Loading /> : <>
            <p style={{ fontSize: 13 }}>{t.detected_month ? <>Caught in <b>month {t.detected_month}</b> by <b>{t.why}</b>
              {t.onset_month > 1 && <> (weakness began month {t.onset_month})</>}.</> : <b className="bad">Not caught this year.</b>}</p>
            <Chart height={300} option={{
              tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { color: "#8fa3bf" } }, grid: { top: 40, left: 45, right: 45, bottom: 30 },
              xAxis: { type: "category", data: t.trace.map((x: any) => `M${x.month}`) },
              yAxis: [{ type: "value", max: 0.3, axisLabel: { formatter: (x: number) => `${(x * 100).toFixed(0)}%` } }, { type: "log", name: "evidence", min: 0.1 }],
              series: [
                { name: "true superficial rate", type: "line", data: t.trace.map((x: any) => x.true_rate), itemStyle: { color: "#f06a6a" } },
                { name: "rate in what was submitted", type: "line", data: t.trace.map((x: any) => x.submitted_rate), itemStyle: { color: "#f5b544" }, lineStyle: { type: "dashed" } },
                { name: "SAT-SA evidence (e)", type: "line", yAxisIndex: 1, data: t.trace.map((x: any) => Math.max(0.1, x.cum_e)), itemStyle: { color: "#2dd4bf" } },
              ],
            }} />
            <table><thead><tr><th>Month</th><th>Reviews so far</th><th>Superficial found</th><th>Missing records</th><th>Signal</th></tr></thead>
              <tbody>{t.trace.map((x: any) => <tr key={x.month}><td>{x.month}</td><td>{x.reviews}</td><td>{x.found}</td><td>{x.missing}</td>
                <td className={x.detected ? "bad" : "muted"}>{x.detected || "—"}</td></tr>)}</tbody></table>
          </>}
        </div>
      </div>
    </>
  );
}
