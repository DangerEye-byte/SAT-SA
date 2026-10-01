import { Link } from "react-router-dom";
import { ArrowRight, Enterprise, Network_3, ViewOff } from "@carbon/icons-react";
import { api } from "../api";
import { Badge, ErrorBox, Glow, Info, Tipped, Loading, PageHeader, Synthetic } from "../components/ui";
import CountUp from "../components/fx/CountUp";
import { useData } from "../hooks";
import { useTheme } from "../theme";

const GUIDE = [
  { icon: Enterprise, title: "One card per critical sector", text: "The ring shows how many of the sector's entities are flagged for examiner review this cycle." },
  { icon: ViewOff, title: "Sector-wide blind spots", text: "Red tactics are ones some entity in the sector cannot see at all. A shared blind spot is a sector risk." },
  { icon: Network_3, title: "Shared providers", text: "A systemic provider serves clients in this sector and carries a provider-level weakness." },
];

function Ring({ v, n }: { v: number; n: number }) {
  const { p } = useTheme();
  const r = 26, c = 2 * Math.PI * r, f = n ? v / n : 0;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label={`${v} of ${n} flagged`} className="sa-ring">
      <circle cx="36" cy="36" r={r} fill="none" stroke={p.layer2} strokeWidth="7" />
      <circle cx="36" cy="36" r={r} fill="none" stroke={f >= 0.5 ? p.confirmed : f > 0 ? p.review : p.ok} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 36 36)" style={{ transition: "stroke-dasharray 900ms cubic-bezier(.16,1,.3,1)" }} />
      <text x="36" y="35" textAnchor="middle" fill={p.text} fontSize="17" fontWeight="700">{v}</text>
      <text x="36" y="49" textAnchor="middle" fill={p.helper} fontSize="9.5">of {n}</text>
    </svg>
  );
}

export default function SectorsPage() {
  const { data, error } = useData(() => api.sectors(), []);
  const meta = useData(() => api.meta(), []);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading page label="Summarising sectors" />;
  const name = (id: string) => meta.data?.detectors?.find((d: any) => d.detector_id === id)?.name ?? id;
  const flagged = data.reduce((a, s) => a + s.flagged, 0), total = data.reduce((a, s) => a + s.entities, 0);
  const blindSectors = data.filter((s) => s.blind_tactics.length).length;
  const provs = new Set(data.flatMap((s) => s.systemic_providers));
  return (
    <>
      <PageHeader title="Sectors" meta={<Synthetic tip />} guideKey="sectors" guide={GUIDE}
        lead="For NCIIPC's sector desks: how many entities in each critical sector need examiner attention this cycle, which weaknesses recur, where a sector is blind, and which outsourced SOC providers carry systemic risk." />
      <div className="sa-stats">
        <div className="sa-stat"><div className="sa-stat__value"><CountUp value={flagged} /><small>of {total}</small></div><div className="sa-stat__label"><Tipped text="entities flagged for examiner review" tip={{ title: "Flagged across sectors", text: "Entities flagged this cycle on calibrated statistics or documented facts, summed over every critical sector." }} /></div></div>
        <div className="sa-stat"><div className="sa-stat__value"><CountUp value={data.length} /></div><div className="sa-stat__label"><Tipped text="critical sectors covered" tip="sector" /></div></div>
        <div className="sa-stat"><div className="sa-stat__value sa-confirmed"><CountUp value={blindSectors} /></div><div className="sa-stat__label"><Tipped text="sectors with an entity blind to whole ATT&CK tactics" tip="blind" /></div></div>
        <div className="sa-stat"><div className="sa-stat__value sa-review"><CountUp value={provs.size} /></div><div className="sa-stat__label">systemic SOC provider{provs.size === 1 ? "" : "s"} spanning sectors<Info tip="mssp" /></div></div>
      </div>
      <div className="sa-sectors sa-section">
        {data.map((s) => (
          <Glow key={s.sector} tone={s.flagged / s.entities >= 0.5 ? "confirmed" : s.flagged ? "review" : "ok"}>
            <article className="sa-sector">
              <header className="sa-sector__head">
                <div><span className="sa-chip">{s.sector}</span><h2 className="sa-sector__name">{s.sector_name}</h2>
                  <p className="sa-helper" style={{ margin: 0 }}>mean attention {s.mean_attention.toFixed(0)} / 100<Info tip="attention" /></p></div>
                <span title={`${s.flagged} of ${s.entities} entities in this sector are flagged for examiner review`}><Ring v={s.flagged} n={s.entities} /></span>
              </header>
              <div className="sa-sector__block">
                <span className="sa-sector__label"><Tipped text="Recurring findings" tip={{ title: "Recurring findings", text: "The findings that fire most often among this sector's entities, with how many entities have each. A finding shared by several entities points to a sector-wide practice." }} /></span>
                {s.top_detectors.length ? <ul className="sa-sector__list">{s.top_detectors.map((d: any) => (
                  <li key={d.detector_id}><span className="sa-mono sa-muted">{d.detector_id}</span> {name(d.detector_id)} <span className="sa-helper">· {d.entities} entit{d.entities === 1 ? "y" : "ies"}</span></li>))}</ul>
                  : <span className="sa-helper">none</span>}
              </div>
              <div className="sa-sector__block">
                <span className="sa-sector__label"><Tipped text="Blind tactics" tip="blind" /></span>
                {s.blind_tactics.length ? <div className="sa-chips">{s.blind_tactics.map((t: string) => <Badge key={t} kind="confirmed">{t}</Badge>)}<span className="sa-helper">in {s.entities_blind_somewhere} entit{s.entities_blind_somewhere === 1 ? "y" : "ies"}</span></div>
                  : <span className="sa-helper">none: every entity can see every tactic</span>}
              </div>
              <div className="sa-sector__block">
                <span className="sa-sector__label"><Tipped text="Systemic provider risk" tip="mssp" /></span>
                {s.systemic_providers.length ? <div className="sa-chips">{s.systemic_providers.map((pr: string) => <Link key={pr} to="/providers" className="sa-chip sa-chip--warn">{pr}</Link>)}</div> : <span className="sa-helper">none</span>}
              </div>
              <Link to={`/queue?sector=${s.sector}`} className="sa-arrowlink sa-sector__go">Open this sector's queue <ArrowRight size={16} /></Link>
            </article>
          </Glow>
        ))}
      </div>
    </>
  );
}
