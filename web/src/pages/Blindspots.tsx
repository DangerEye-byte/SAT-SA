import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorBox, Loading } from "../components/ui";
import { useData } from "../hooks";

const COLOR: Record<string, string> = { covered: "#15514a", quiet: "#b7862b", blind: "", not_applicable: "#131f33" };

export default function BlindspotPage() {
  const { data, error } = useData(() => api.blindspot(), []);
  const [sel, setSel] = useState<any>(null);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  const cell = new Map<string, any>(data.cells.map((c: any) => [`${c.entity_id}|${c.tactic}`, c]));
  return (
    <>
      <h1>Blind-spot matrix</h1>
      <p className="sub">Silence is ambiguous until we know whether the entity could see. <b className="good">Covered</b>: its log sources can see the
        tactic and alerts are present. <b className="warn">Quiet</b>: it can see, but alerts are far below expectation. <b className="bad">Blind</b>: its
        declared log sources cannot support detection at all — silence here means blind, not safe.</p>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ fontSize: 11 }}>
          <thead><tr><th>Entity</th>{data.tactics.map((t: string) => <th key={t} style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 120 }}>{t}</th>)}</tr></thead>
          <tbody>{data.entities.map((e: any) => (
            <tr key={e.entity_id}>
              <td style={{ whiteSpace: "nowrap" }}><Link to={`/entity/${e.entity_id}`}>{e.entity_id}</Link> <span className="muted">{e.entity_name}</span></td>
              {data.tactics.map((t: string) => {
                const c = cell.get(`${e.entity_id}|${t}`);
                return <td key={t} title={`${t}: ${c?.state}`} onClick={() => setSel({ ...c, entity: e })}
                  className={c?.state === "blind" ? "hatch" : ""} style={{ background: c?.state === "blind" ? undefined : COLOR[c?.state], cursor: "pointer", minWidth: 26, border: "1px solid #0b1320" }} />;
              })}
            </tr>))}</tbody>
        </table>
      </div>
      {sel && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>{sel.entity.entity_name} · {sel.tactic}: <span className={sel.state === "blind" ? "bad" : sel.state === "quiet" ? "warn" : "good"}>{sel.state}</span></h2>
          <div>Observed alerts: <b>{sel.observed}</b> · expected from asset mix and peer rates: <b>{sel.expected ?? 0}</b></div>
          <div className="muted" style={{ marginTop: 6 }}>Declared log sources: {sel.entity.declared_log_sources}</div>
          {sel.state === "blind" && <div style={{ marginTop: 6 }}>Open the entity dossier → finding <b>NS3</b> for the exact sources that would restore visibility.</div>}
        </div>
      )}
    </>
  );
}
