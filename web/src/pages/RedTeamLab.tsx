import { useState } from "react";
import { Renew, Security, TouchInteraction, Calendar } from "@carbon/icons-react";
import { api } from "../api";
import { Badge, Btn, Callout, Chart, ErrorBox, Figure, Info, Tipped, Loading, PageHeader } from "../components/ui";
import { useData } from "../hooks";
import { useTheme } from "../theme";

const S: Record<string, [string, string]> = {
  honest: ["Honest SOC", "false alarms: lower is better"], delay: ["Delay", "weak after month 6"], drift: ["Drift", "slides to weak"],
  cherry_pick: ["Cherry-pick", "weak on unsampled cases"], off_audit_drift: ["Off-audit drift", "good only in audit months"],
  attrition: ["Attrition", "drops bad cases"], metadata_masking: ["Metadata masking", "pads the paper trail"],
};
const P: Record<string, string> = {
  annual_audit: "Annual audit", quarterly_audit: "Quarterly audit", unannounced: "Unannounced audits",
  satsa_analytics: "SAT-SA analytics", satsa_with_floor: "SAT-SA + random floor",
};
const GUIDE = [
  { icon: Security, title: "Rows: how a weak SOC games", text: "Each strategy hides a weak SOC (15% of cases handled superficially against 3% when healthy)." },
  { icon: Calendar, title: "Columns: how the regulator audits", text: "Every policy gets the same budget of human case reviews per year. Cells show how often the weakness is caught within 12 months." },
  { icon: TouchInteraction, title: "Click a cell", text: "Replay one simulated year: true rate, what was submitted, and when SAT-SA's evidence crossed the line." },
];
const band = (v: number) => (v >= 90 ? "b5" : v >= 60 ? "b4" : v >= 30 ? "b3" : v >= 10 ? "b2" : "b1");

export default function RedTeamLab() {
  const { p } = useTheme();
  const { data: m, error } = useData(() => api.gaming(), []);
  const [sel, setSel] = useState<[string, string]>(["off_audit_drift", "quarterly_audit"]);
  const [seed, setSeed] = useState(1);
  const run = useData(() => api.gamingRun(sel[0], sel[1], seed), [sel[0], sel[1], seed]);
  if (error) return <ErrorBox e={error} />;
  if (!m) return <Loading page label="Loading the gaming simulations" />;
  const rate = (s: string, pol: string) => Math.round(100 * (m.cells.find((c: any) => c.strategy === s && c.policy === pol)?.detection_rate ?? 0));
  const floor = (policy: string) => Math.min(...m.strategies.filter((s: string) => s !== "honest").map((s: string) => rate(s, policy)));
  const fixedWorst = Math.min(floor("annual_audit"), floor("quarterly_audit"));
  const t = run.data;
  const strategies = m.strategies.slice().sort((a: string, b: string) => (a === "honest" ? 1 : b === "honest" ? -1 : 0));
  return (
    <>
      <PageHeader title="Red-Team Lab" meta={<Badge kind="review">synthetic simulation</Badge>} guideKey="redteam" guide={GUIDE}
        lead={`Can a SOC game its regulator? Each audit policy gets the same ${m.review_budget_per_year} human case reviews per year; each cell is ${m.sims_per_cell} simulated years.`} />

      <div className="sa-rtl-head">
        <div className="sa-rtl-kpi is-bad"><b>{fixedWorst}%</b><span><Tipped text="worst-case detection with fixed audit schedules" tip={{ title: "Fixed audit schedules", text: "The lowest detection rate across every gaming strategy when the regulator audits on a fixed annual or quarterly calendar. A gaming SOC times its behaviour around the calendar." }} /></span></div>
        <div className="sa-rtl-kpi is-good"><b>{m.policies.includes("satsa_with_floor") ? floor("satsa_with_floor") : "n/a"}%</b><span><Tipped text="worst case with SAT-SA plus a small random review floor" tip={{ title: "SAT-SA + random floor", text: "The lowest detection rate across every gaming strategy when SAT-SA analyses every submission and a small share of reviews is drawn at random, so no case can be sure it will not be checked." }} /></span></div>
        <p className="sa-body">Fixed schedules are gamed. Analytics on every submission catch timing and attrition games; padding the paper trail beats analytics alone, and a small randomised review floor restores detection. SAT-SA sharply reduces what gaming can hide; it does not claim to eliminate it.</p>
      </div>

      <div className="sa-grid sa-rtl-grid sa-section">
        <section className="sa-card">
          <div className="sa-card__head"><div><h2 className="sa-card__title"><Tipped text="Detection rate within 12 months" tip={{ title: "Reading the grid", text: "Each cell is the share of simulated years in which the weak SOC was caught within 12 months, with the same review budget for every policy. The honest SOC row counts false alarms, so lower is better there." }} /></h2><p className="sa-card__sub">Click a cell to replay one year.</p></div></div>
          <div className="sa-heat" role="grid" aria-label="Detection rate by gaming strategy and audit policy" style={{ gridTemplateColumns: `minmax(10rem, 1.3fr) repeat(${m.policies.length}, minmax(4.25rem, 1fr))` }}>
            <div role="columnheader" />
            {m.policies.map((pol: string) => <div key={pol} role="columnheader" className={`sa-heat__col ${pol.startsWith("satsa") ? "is-satsa" : ""}`}>{P[pol]}</div>)}
            {strategies.map((s: string) => (
              <div key={s} role="row" style={{ display: "contents" }}>
                <div role="rowheader" className={`sa-heat__row ${s === "honest" ? "is-honest" : ""}`}><b>{S[s]?.[0] ?? s}</b><span>{S[s]?.[1]}</span></div>
                {m.policies.map((pol: string) => {
                  const v = rate(s, pol), on = sel[0] === s && sel[1] === pol;
                  return <button key={pol} type="button" role="gridcell" aria-pressed={on} aria-label={`${S[s]?.[0]} against ${P[pol]}: caught ${v}%`}
                    className={`sa-heat__cell ${s === "honest" ? "is-honest" : band(v)}`} onClick={() => setSel([s, pol])}>{v}%</button>;
                })}
              </div>
            ))}
          </div>
          <div className="sa-heat__legend"><span><i className="b1" />caught under 10%</span><span><i className="b3" />30 to 60%</span><span><i className="b5" />90% or more</span><span><i className="is-honest" />honest SOC: false alarms</span></div>
        </section>

        <section className="sa-card">
          <div className="sa-card__head">
            <div><h2 className="sa-card__title">{S[sel[0]]?.[0]} against {P[sel[1]]}<Info tip={{ title: "One simulated year", text: "Red: the true superficial rate. Amber dashed: the rate in what the SOC submitted. Blue: SAT-SA's running evidence, on the right-hand scale; crossing the dashed line raises a flag." }} /></h2><p className="sa-card__sub">One simulated year, seed {seed}.</p></div>
            <Btn kind="ghost" size="sm" icon={Renew} iconLeft onClick={() => setSeed(seed + 1)} title="Run the same cell with a new random seed">Replay another year</Btn>
          </div>
          {run.error ? <ErrorBox e={run.error} /> : !t ? <Loading label="Replaying the year" /> : <div className="sa-stack">
            {t.detected_month
              ? <Callout kind={sel[0] === "honest" ? "review" : "ok"} title={`Caught in month ${t.detected_month} by ${t.why}`}>{t.onset_month > 1 ? `The weakness began in month ${t.onset_month}.` : "Weak from the start of the year."}</Callout>
              : <Callout kind={sel[0] === "honest" ? "ok" : "confirmed"} title={sel[0] === "honest" ? "No false alarm this year" : "Not caught this year"}>{sel[0] === "honest" ? "The honest SOC was correctly left alone." : "This policy missed the weakness for all 12 months."}</Callout>}
            <Figure title="True rate against what was submitted">
              <Chart height={250} label="Monthly true and submitted rates with SAT-SA evidence" option={{
                tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { top: 40, left: 45, right: 45, bottom: 28 },
                xAxis: { type: "category", data: t.trace.map((x: any) => `M${x.month}`) },
                yAxis: [{ type: "value", max: 0.3, axisLabel: { formatter: (x: number) => `${(x * 100).toFixed(0)}%` } }, { type: "log", name: "evidence", min: 0.1, splitLine: { show: false } }],
                series: [
                  { name: "true superficial rate", type: "line", smooth: 0.25, data: t.trace.map((x: any) => x.true_rate), itemStyle: { color: p.confirmed }, lineStyle: { color: p.confirmed, width: 2.5 } },
                  { name: "rate in what was submitted", type: "line", smooth: 0.25, data: t.trace.map((x: any) => x.submitted_rate), itemStyle: { color: p.review }, lineStyle: { color: p.review, type: "dashed" } },
                  ...(sel[1].startsWith("satsa") ? [{ name: "SAT-SA evidence (e)", type: "line", yAxisIndex: 1, data: t.trace.map((x: any) => Math.max(0.1, x.cum_e)), itemStyle: { color: p.accent }, lineStyle: { color: p.accent, width: 2 },
                    markLine: { symbol: "none", data: [{ yAxis: 100 }], lineStyle: { color: p.helper, type: "dashed" } } }] : []),
                ],
              }} />
            </Figure>
            <div>
              <span className="sa-sector__label"><Tipped text="Month by month" tip={{ title: "Month by month", text: "Reviews made so far, superficial cases found and missing records in each month. A highlighted month is when a signal fired; hover any month for the detail." }} /></span>
              <div className="sa-months">
                {t.trace.map((x: any) => (
                  <div key={x.month} className={`sa-month ${x.detected ? "is-hit" : ""} ${t.detected_month && x.month >= t.detected_month ? "is-after" : ""}`}
                    title={`Month ${x.month}: ${x.reviews} reviews so far, ${x.found} superficial found, ${x.missing} missing records${x.detected ? `, signal: ${x.detected}` : ""}`}>
                    <b>M{x.month}</b><span>{x.reviews} rev</span><span>{x.found} found</span>{x.missing > 0 && <span className="sa-review">{x.missing} miss</span>}
                  </div>))}
              </div>
            </div>
          </div>}
        </section>
      </div>
    </>
  );
}
