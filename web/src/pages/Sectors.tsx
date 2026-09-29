import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorBox, Loading } from "../components/ui";
import { useData } from "../hooks";

export default function SectorsPage() {
  const { data, error } = useData(() => api.sectors(), []);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <h1>Sector view</h1>
      <p className="sub">For NCIIPC's sector desks: how many entities in each critical sector need examiner attention this cycle, which weaknesses recur,
        where whole sectors are blind, and which outsourced SOC providers are a systemic risk.</p>
      <div className="grid g3">
        {data.map((s) => (
          <div key={s.sector} className="card">
            <div className="row"><h2 style={{ margin: 0 }}>{s.sector_name}</h2><div className="spacer" />
              <span className={`pill ${s.flagged ? "red" : "teal"}`}>{s.flagged} of {s.entities} flagged</span></div>
            <h3 style={{ marginTop: 12 }}>Most frequent findings</h3>
            {s.top_detectors.length ? s.top_detectors.map((d: any) => <div key={d.detector_id} style={{ fontSize: 13 }}>
              <span className="mono muted">{d.detector_id}</span> in {d.entities} entit{d.entities === 1 ? "y" : "ies"}</div>)
              : <div className="muted" style={{ fontSize: 13 }}>none</div>}
            <h3 style={{ marginTop: 12 }}>Blind tactics</h3>
            <div style={{ fontSize: 13 }}>{s.blind_tactics.length ? `${s.blind_tactics.join(", ")} (${s.entities_blind_somewhere} entities)` : <span className="muted">none</span>}</div>
            <h3 style={{ marginTop: 12 }}>Systemic provider risk</h3>
            <div style={{ fontSize: 13 }}>{s.systemic_providers.length ? s.systemic_providers.map((p: string) => <Link key={p} to="/providers" className="pill red" style={{ marginRight: 6 }}>{p}</Link>)
              : <span className="muted">none</span>}</div>
            <Link to={`/?sector=${s.sector}`} style={{ display: "block", marginTop: 12, fontSize: 13 }}>Open this sector's queue →</Link>
          </div>))}
      </div>
    </>
  );
}
