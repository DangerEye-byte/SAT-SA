import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Grid, TouchInteraction, ViewOff } from "@carbon/icons-react";
import { api } from "../api";
import { Badge, ErrorBox, Glow, Info, Tipped, Loading, PageHeader, Segmented, StateLegend, Synthetic } from "../components/ui";
import CountUp from "../components/fx/CountUp";
import { useData } from "../hooks";

const GUIDE = [
  { icon: ViewOff, title: "Silence is ambiguous", text: "No alerts can mean safe, or blind. SAT-SA checks whether the entity's declared log sources could see the tactic at all." },
  { icon: Grid, title: "Read a row", text: "Teal: can see, alerts present. Amber: can see, far fewer alerts than expected. Hatched red: blind." },
  { icon: TouchInteraction, title: "Click a cell", text: "See observed against expected alerts and which log sources would restore visibility." },
];
const STATE_LABEL: Record<string, string> = { covered: "covered", quiet: "quiet", blind: "blind", not_applicable: "not applicable" };

export default function BlindspotPage() {
  const { data, error } = useData(() => api.blindspot(), []);
  const [sel, setSel] = useState<any>(null);
  const [only, setOnly] = useState<"all" | "blind">("all");
  const cell = useMemo(() => new Map<string, any>((data?.cells ?? []).map((c: any) => [`${c.entity_id}|${c.tactic}`, c])), [data]);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading page label="Checking what each SOC can see" />;
  const blindCells = data.cells.filter((c: any) => c.state === "blind");
  const blindEnt = new Set(blindCells.map((c: any) => c.entity_id));
  const quiet = data.cells.filter((c: any) => c.state === "quiet").length;
  const gapEnt = new Set(data.cells.filter((c: any) => c.state === "blind" || c.state === "quiet").map((c: any) => c.entity_id));
  const rows = data.entities.filter((e: any) => only === "all" || gapEnt.has(e.entity_id));
  const worstTactic = Object.entries(blindCells.reduce((m: any, c: any) => ({ ...m, [c.tactic]: (m[c.tactic] || 0) + 1 }), {})).sort((a: any, b: any) => b[1] - a[1])[0];
  return (
    <>
      <PageHeader title="Blind spots" meta={<Synthetic tip />} guideKey="blind" guide={GUIDE}
        lead="Which ATT&CK tactics each entity cannot see. A blind tactic is a documented fact from the entity's own declared log sources: silence there means blind, not safe." />
      <div className="sa-stats">
        <div className="sa-stat"><div className="sa-stat__value sa-confirmed"><CountUp value={blindCells.length} /></div><div className="sa-stat__label"><Tipped text="entity-tactic pairs that are blind" tip="blind" /></div></div>
        <div className="sa-stat"><div className="sa-stat__value"><CountUp value={blindEnt.size} /><small>of {data.entities.length}</small></div><div className="sa-stat__label"><Tipped text="entities blind to at least one tactic" tip={{ title: "Blind entities", text: "Entities that cannot see at least one ATT&CK tactic that applies to their assets. Each one is flagged as a documented fact (finding NS3)." }} /></div></div>
        <div className="sa-stat"><div className="sa-stat__value sa-review"><CountUp value={quiet} /></div><div className="sa-stat__label"><Tipped text="pairs visible but unusually quiet" tip="quiet" /></div></div>
        {worstTactic && <div className="sa-stat"><div className="sa-stat__value" style={{ fontSize: "1.25rem" }}>{worstTactic[0]}</div><div className="sa-stat__label">most often blind ({String(worstTactic[1])} entities)<Info tip="tactic" /></div></div>}
      </div>

      <div className="sa-toolbar sa-section">
        <Segmented label="Rows" value={only} onChange={setOnly} options={[{ v: "blind", label: `Entities with a gap (${gapEnt.size})` }, { v: "all", label: `All ${data.entities.length} entities` }]} />
        <span className="sa-inline" style={{ gap: 0 }}><StateLegend /><Info tip={{ title: "Reading the matrix", text: "One row per entity, one column per ATT&CK tactic. Each cell compares what the entity could see with the alerts it raised. Click a cell for the detail." }} /></span>
      </div>
      <div className="sa-blindgrid">
        <div className="sa-card sa-card--flush">
          <div className="sa-tablewrap sa-matrixwrap">
            <table className="sa-matrix">
              <thead><tr><th className="sa-matrix__corner"><span className="sa-helper">Entity</span></th>{data.tactics.map((t: string) => <th key={t} scope="col"><span>{t}</span></th>)}</tr></thead>
              <tbody>{rows.map((e: any) => (
                <tr key={e.entity_id} className={sel?.entity.entity_id === e.entity_id ? "is-sel" : ""}>
                  <th scope="row"><Link to={`/entity/${e.entity_id}`}>{e.entity_id}</Link> <span className="sa-helper">{e.entity_name}</span></th>
                  {data.tactics.map((t: string) => {
                    const c = cell.get(`${e.entity_id}|${t}`);
                    const on = sel && sel.entity.entity_id === e.entity_id && sel.tactic === t;
                    return <td key={t}><button type="button" className={`sa-matrix__cell sa-state--${c?.state}`} aria-pressed={on}
                      aria-label={`${e.entity_id}, ${t}: ${STATE_LABEL[c?.state] ?? "unknown"}`} title={`${e.entity_id} · ${t}: ${STATE_LABEL[c?.state] ?? ""}`}
                      onClick={() => setSel({ ...c, entity: e })} /></td>;
                  })}
                </tr>))}</tbody>
            </table>
          </div>
        </div>
        <aside className="sa-sticky" aria-live="polite">
          <Glow tone={sel?.state === "blind" ? "confirmed" : sel?.state === "quiet" ? "review" : "accent"}>
            <div className="sa-blinddetail">
              {!sel ? <>
                <h2 className="sa-h3">Select a cell</h2>
                <p className="sa-body">See observed against expected alerts for that tactic, and the entity's declared log sources.</p>
              </> : <>
                <div className="sa-row"><span className="sa-chip">{sel.entity.entity_id}</span><Badge kind={sel.state === "blind" ? "confirmed" : sel.state === "quiet" ? "review" : sel.state === "covered" ? "ok" : "neutral"} dot>{STATE_LABEL[sel.state]}</Badge></div>
                <h2 className="sa-h2">{sel.entity.entity_name}</h2>
                <p className="sa-body" style={{ marginTop: "-0.25rem" }}>{sel.tactic}</p>
                <div className="sa-obsexp">
                  <div><span>Observed alerts</span><b>{sel.observed}</b></div>
                  <div><span><Tipped text="Expected" tip={{ title: "Expected alerts", text: "Alerts expected for this tactic from the entity's asset mix and peers' alert rates. Far below expected while able to see is quiet; unable to see at all is blind." }} /></span><b>{Math.round(sel.expected ?? 0)}</b></div>
                </div>
                <p className="sa-helper" style={{ margin: 0 }}>Expected from the entity's asset mix and peer rates.</p>
                <div><span className="sa-sector__label"><Tipped text="Declared log sources" tip="sources" /></span>
                  <div className="sa-chips" style={{ marginTop: "0.5rem" }}>{String(sel.entity.declared_log_sources).split(",").map((s: string) => <span key={s} className="sa-chip">{s}</span>)}</div></div>
                {sel.state === "blind" && <p className="sa-body">None of these sources can support detection of <b>{sel.tactic}</b>. Finding <b>NS3</b> in the dossier lists what would restore visibility.</p>}
                <Link to={`/entity/${sel.entity.entity_id}${sel.state === "blind" ? "?finding=NS3" : ""}`} className="sa-arrowlink">Open the dossier <ArrowRight size={16} /></Link>
              </>}
            </div>
          </Glow>
        </aside>
      </div>
    </>
  );
}
