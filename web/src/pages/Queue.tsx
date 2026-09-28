import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtP } from "../api";
import { Attention, BasisPill, ErrorBox, Loading, ReasonList, Sparkline } from "../components/ui";
import { useData } from "../hooks";

const LEVELS = [0.05, 0.1, 0.2];

export default function QueuePage() {
  const [fdr, setFdr] = useState(0.1);
  const [showAll, setShowAll] = useState(false);
  const { data, error, loading } = useData(() => api.queue(fdr), [fdr]);
  const nav = useNavigate();
  if (error) return <ErrorBox e={error} />;
  const rows = data ? (showAll ? data.entities : data.entities.filter((e) => e.flagged)) : [];
  return (
    <>
      <h1>Supervisory review queue</h1>
      <p className="sub">Entities ranked by calibrated evidence from their own SOC paper trail. Statistical flags are controlled at a
        known false-discovery rate; documented facts (blind spots, clock faults, red-team misses) are listed separately.</p>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div>
            <h3>False-discovery budget</h3>
            <div className="slider">
              {LEVELS.map((l) => (
                <button key={l} className={`btn ${l === fdr ? "on" : ""}`} onClick={() => setFdr(l)}>{l * 100}%</button>
              ))}
            </div>
          </div>
          <div className="spacer" />
          {data && (
            <div style={{ fontSize: 15, maxWidth: 720 }}>
              At a <b>{fdr * 100}%</b> false-discovery budget, <b>{data.n_flagged_statistical}</b> entities warrant review on
              statistical evidence — at most <b>~{data.expected_false_discoveries_max}</b> of them expected to be false alarms —
              plus <b>{data.n_flagged_deterministic}</b> with documented deterministic findings.{" "}
              <span className="muted">{data.n_entities - data.n_flagged} entities are not flagged.</span>
            </div>
          )}
        </div>
      </div>
      {loading && !data ? <Loading /> : (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{showAll ? "All entities" : "Flagged for examiner review"}</h2>
            <div className="spacer" />
            <button className="btn" onClick={() => setShowAll(!showAll)}>{showAll ? "Show flagged only" : "Show all 42"}</button>
          </div>
          <table>
            <thead><tr><th>#</th><th>Entity</th><th>Sector</th><th>Attention</th><th>q-value</th><th>Basis</th><th>Why flagged (top evidence)</th><th>Trend</th><th>Data trust</th></tr></thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.entity_id} className="click" onClick={() => nav(`/entity/${e.entity_id}`)}>
                  <td className="muted">{i + 1}</td>
                  <td><b>{e.entity_name}</b><div className="mono muted">{e.entity_id} · {e.soc_provider}</div></td>
                  <td>{e.sector_name}</td>
                  <td><Attention v={e.attention} /></td>
                  <td className="mono">{fmtP(e.q_value)}</td>
                  <td><BasisPill basis={e.flag_basis} /></td>
                  <td><ReasonList reasons={e.top_reasons} /></td>
                  <td><Sparkline data={e.sparkline} /></td>
                  <td>{e.trust_score.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
