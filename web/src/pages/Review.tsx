import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, pct } from "../api";
import { ErrorBox, Loading } from "../components/ui";
import { useData } from "../hooks";

function CIBar({ label, ci, color }: { label: string; ci: any; color: string }) {
  if (!ci) return null;
  const s = (v: number) => `${Math.min(100, v * 100 / 0.6)}%`; // axis 0–60%
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="row" style={{ fontSize: 13, marginBottom: 4 }}>
        <b>{label}</b><span className="muted">estimate {pct(ci.estimate, 1)} · 90% interval {pct(ci.lo, 1)} – {pct(ci.hi, 1)} · width {pct(ci.width, 1)}</span>
      </div>
      <div className="ci">
        <i style={{ left: s(ci.lo), width: `calc(${s(ci.hi)} - ${s(ci.lo)})`, background: color, opacity: 0.55 }} />
        <b style={{ left: s(ci.estimate) }} />
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const { id = "BFS-02" } = useParams();
  const nav = useNavigate();
  const { data, error, setData } = useData(() => api.review(id), [id]);
  const ents = useData(() => api.queue(0.1), []);
  const [busy, setBusy] = useState(false);
  const run = async (p: Promise<any>) => { setBusy(true); try { setData(await p); } finally { setBusy(false); } };
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  const est = data.estimate;
  const unl = data.sample.filter((s: any) => s.label == null);
  return (
    <>
      <div className="row">
        <div>
          <h1>Examiner review lab</h1>
          <p className="sub" style={{ margin: 0 }}>How many of this entity's closed cases were handled superficially? Examiners review a small random
            sample; prediction-powered inference combines their verdicts with the model's scores on every case to give a valid, much tighter interval.</p>
        </div>
      </div>
      <div className="row" style={{ margin: "14px 0" }}>
        <select className="btn" value={id} onChange={(e) => nav(`/review/${e.target.value}`)}>
          {(ents.data?.entities || []).map((e) => <option key={e.entity_id} value={e.entity_id}>{e.entity_id} — {e.entity_name}</option>)}
        </select>
        <Link to={`/entity/${id}`} className="btn">Entity dossier</Link>
        <div className="spacer" />
        <button className="btn primary" disabled={busy} onClick={() => run(api.reviewSample(id))}>Draw sample (30 random + 10 priority)</button>
        <button className="btn" disabled={busy} onClick={() => run(api.reviewSimulate(id, 5))}>Simulate examiner ×5 (demo)</button>
        <button className="btn" disabled={busy} onClick={() => run(api.reviewReset(id))}>Reset</button>
      </div>
      <div className="grid g2">
        <div className="card">
          <h3>Estimated share of superficially handled cases</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Population: {est.population.toLocaleString()} closed human-handled cases ·
            random-sample labels: {est.n_labeled_random} · priority labels: {est.n_labeled_active}</div>
          <CIBar label="Manual sample only" ci={est.classical} color="#8fa3bf" />
          {est.status === "ok" ? <CIBar label="SAT-SA (prediction-powered)" ci={est.ppi} color="#2dd4bf" /> :
            <div className="muted">Label {est.labels_needed ?? 20} more random-sample cases to unlock the prediction-powered interval.</div>}
          {est.status === "ok" && (
            <div className="grid g2" style={{ marginTop: 12 }}>
              <div className="card kpi"><div className="v good">{pct(est.review_saving)}</div><div className="l">fewer manual reviews for the same confidence (measured)</div></div>
              <div className="card kpi"><div className="v">{est.planner.reviews_with_satsa} <span className="muted" style={{ fontSize: 14 }}>vs {est.planner.reviews_manual_only}</span></div>
                <div className="l">reviews needed for ±3 pp — with SAT-SA vs manual only</div></div>
            </div>
          )}
        </div>
        <div className="card">
          <h3>Why this is trustworthy</h3>
          <ul style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 18 }}>
            <li><b>Blind-first:</b> the model's score stays hidden until the examiner records a verdict (cognitive forcing, Buçinca et al. CSCW 2021).</li>
            <li><b>Valid even if the model is wrong:</b> examiner labels correct the model's bias (Angelopoulos et al., <i>Science</i> 2023).</li>
            <li><b>Random floor:</b> the interval uses only the uniform random sample, so an entity cannot predict which cases get reviewed.</li>
            <li><b>Priority sample:</b> 10 extra cases where the model is least certain — reviewed to find weaknesses fast, reported separately.</li>
            <li>Every verdict is written to the tamper-evident ledger.</li>
          </ul>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Review sample ({unl.length} awaiting verdict)</h3>
        <table>
          <thead><tr><th>Case</th><th>Sample</th><th>Severity / type</th><th>Closed in</th><th>Investigation steps</th><th>Analyst note</th><th>Model score</th><th>Verdict</th></tr></thead>
          <tbody>{data.sample.map((s: any) => (
            <tr key={s.case_id}>
              <td className="mono">{s.case_id}</td>
              <td><span className={`pill ${s.sample_type === "random" ? "gray" : "violet"}`}>{s.sample_type}</span></td>
              <td>{s.severity} · {s.category}</td><td>{s.ttc_min?.toFixed(0)} min</td><td>{s.n_investigate}</td>
              <td style={{ maxWidth: 360 }} className="muted">{s.notes?.slice(0, 120)}</td>
              <td className="mono">{s.yhat == null ? <span className="muted">hidden</span> : s.yhat.toFixed(2)}</td>
              <td>{s.label == null ? (
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn bad" disabled={busy} onClick={() => run(api.reviewLabel(id, s.case_id, 1))}>Superficial</button>
                  <button className="btn good" disabled={busy} onClick={() => run(api.reviewLabel(id, s.case_id, 0))}>Adequate</button>
                </div>) : s.label === 1 ? <span className="pill red">superficial</span> : <span className="pill teal">adequate</span>}
                {s.reviewer === "simulated-examiner" && <div className="muted" style={{ fontSize: 10 }}>simulated</div>}
              </td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </>
  );
}
