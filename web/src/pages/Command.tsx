import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Blockchain, Enterprise, Flag, ListChecked, Network_3, TaskView, ViewOff, Radar as RadarIcon } from "@carbon/icons-react";
import { api, type Queue } from "../api";
import { EntityOrbit, ProviderOrbit } from "../components/Orbital";
import { Badge, BasisTag, Btn, ErrorBox, Glow, Info, Tipped, Kpi, Loading, Meter, PageHeader, Segmented, Synthetic } from "../components/ui";
import CountUp from "../components/fx/CountUp";
import { useData } from "../hooks";

const LEVELS = [0.05, 0.1, 0.2];
const GUIDE = [
  { icon: RadarIcon, title: "Spot who needs attention", text: "On the evidence map, amber dots are flagged on statistics and red dots on documented facts. Lines show which findings drive each flag." },
  { icon: ListChecked, title: "Set the budget, read the list", text: "The false-alarm budget drives both the map and the priority list beside it. Click any entity to open its dossier." },
  { icon: TaskView, title: "Check and decide", text: "In the dossier, open each finding's evidence, then accept, dismiss or escalate. You make the final call." },
];

export default function CommandPage() {
  const nav = useNavigate();
  const [fdr, setFdr] = useState(0.1);
  const [q, setQ] = useState<Queue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const meta = useData(() => api.meta(), []);
  const blind = useData(() => api.blindspot(), []);
  const prov = useData(() => api.providers(), []);
  const sectors = useData(() => api.sectors(), []);
  const ledger = useData(() => api.ledger(), []);
  useEffect(() => { let on = true; api.queue(fdr).then((d) => { if (on) { setQ(d); setErr(null); } }).catch((e) => on && setErr(String(e))); return () => { on = false; }; }, [fdr]);

  const leading = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number; fam: string }>();
    const fam = (id: string) => meta.data?.detectors?.find((d: any) => d.detector_id === id)?.family ?? (id.startsWith("EG") || id.startsWith("TW") ? "Execution gap" : "Negative space");
    (q?.entities ?? []).filter((e) => e.flagged).forEach((e) => e.top_reasons.forEach((r) => {
      const x = m.get(r.detector_id) ?? { id: r.detector_id, name: r.name, n: 0, fam: fam(r.detector_id) };
      x.n++; m.set(r.detector_id, x);
    }));
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  }, [q, meta.data]);

  if (err && !q) return <ErrorBox e={err} />;
  if (!q) return <Loading page label="Building the overview" />;
  const blindPairs = blind.data?.cells?.filter((c: any) => c.state === "blind").length;
  const decisions = ledger.data?.entries?.filter((e: any) => e.type === "finding_disposition").length;
  const top = q.entities.filter((e) => e.flagged).slice(0, 8);
  const period = meta.data?.period;
  const maxLead = Math.max(1, ...leading.map((l) => l.n));
  const weak = (prov.data ?? []).find((x: any) => x.provider !== "INHOUSE" && x.p_value != null && x.p_value < 0.05);

  return (
    <>
      <PageHeader title="Overview" meta={<Synthetic tip />} guideKey="command" guide={GUIDE}
        lead="Which entities' SOCs need a closer look this cycle, and why. Every mark on this page traces to findings, and every finding to the entity's own records."
        actions={meta.data && <span className="sa-runchip" title={`Run ${meta.data.run?.run_hash}`}><RadarIcon size={14} /> Run <span className="sa-mono">{meta.data.run?.run_hash?.slice(0, 8)}</span>{period && <> · {period.start?.slice(0, 10)} to {period.end?.slice(0, 10)}</>}<Info tip="runHash" /></span>} />

      <div className="sa-kpis sa-kpis--glow">
        <Link to="/sectors" className="sa-kpilink"><Glow><Kpi icon={Enterprise} label="Entities assessed" tip={{ title: "Entities assessed", text: "Critical Sector Entities whose SOC paper trail (alerts, cases, workflow events, escalations, assets) was analysed this cycle. Click the card to see them by sector." }} value={<CountUp value={q.n_entities} />} note={`across ${new Set(q.entities.map((e) => e.sector)).size} critical sectors`} /></Glow></Link>
        <Link to="/queue" className="sa-kpilink"><Glow tone="review"><Kpi icon={Flag} label="Flagged for examiner review" tip={{ title: "Flagged for examiner review", text: "Where to look first. Amber flags come from calibrated statistics and are held to the false-alarm budget; red flags are documented facts. A flag asks for examiner review; it is not a verdict." }} value={<><CountUp value={q.n_flagged} /><small>at {fdr * 100}% FDR</small></>} note={<span className="sa-row" style={{ gap: "0.375rem" }}><Badge kind="review">{q.n_flagged_statistical} statistical</Badge><Badge kind="confirmed">{q.n_flagged_deterministic} facts</Badge></span>} /></Glow></Link>
        <Link to="/blindspots" className="sa-kpilink"><Glow tone="confirmed"><Kpi icon={ViewOff} label="Blind entity-tactic pairs" tip={{ title: "Blind entity-tactic pairs", text: "Each pair is one entity and one ATT&CK tactic that its own declared log sources cannot see. Silence there means blind, not safe." }} value={<CountUp value={blindPairs} />} note="tactics an entity's own log sources cannot see" /></Glow></Link>
        <Link to="/ledger" className="sa-kpilink"><Glow tone="ok"><Kpi icon={Blockchain} label="Findings raised" tip={{ title: "Findings raised", text: "Detector results across every entity in this run. The note counts examiner decisions (accept, dismiss, escalate) sealed in the audit ledger." }} value={<CountUp value={meta.data?.run?.n_findings} />} note={`${decisions ?? 0} examiner decision${decisions === 1 ? "" : "s"} sealed in the ledger`} /></Glow></Link>
      </div>

      <section className="sa-card sa-section sa-where" aria-labelledby="where-h">
        <div className="sa-card__head">
          <div><h2 id="where-h" className="sa-card__title"><Tipped text="Where to look" tip={{ title: "Evidence map", text: <>Outer ring: every entity, grouped by sector. Inner ring: the findings that lead the evidence (<b>amber</b> execution gap, <b>red</b> negative space). A line joins each flagged entity to its strongest finding; hover an entity or a finding to see all its links.</> }} /></h2>
            <p className="sa-card__sub">Every entity sits on the ring, grouped by sector. Each flagged entity is linked to its strongest finding. Hover an entity or a finding to see every link; click an entity to open it.</p></div>
          <span className="sa-inline"><Segmented accent label="False-alarm budget" value={fdr} onChange={setFdr} options={LEVELS.map((l) => ({ v: l, label: `FDR ${l * 100}%` }))} /><Info tip="fdr" /></span>
        </div>
        <div className="sa-where__grid">
          <div>
            <EntityOrbit entities={q.entities} detectors={meta.data?.detectors ?? []} />
            <div className="sa-orb-legend"><span><i className="is-review" />FDR-flagged</span><span><i className="is-confirmed" />documented fact</span><span><i className="is-none" />not flagged</span><span>Links: amber execution gap, red negative space · bigger dot = stronger evidence</span></div>
          </div>
          <aside className="sa-prio" aria-label="Priority list">
            <div className="sa-row"><h3 className="sa-h3"><Tipped text="Priority list" tip={{ title: "Priority list", text: "The flagged entities with the highest supervisory attention, strongest first. The note on the right is how many of the statistical flags may be false alarms at this budget." }} /></h3><span className="sa-spacer" /><span className="sa-helper">at most ~{q.expected_false_discoveries_max} false alarms</span></div>
            <ol>
              {top.map((e, i) => (
                <li key={e.entity_id}><button type="button" onClick={() => nav(`/entity/${e.entity_id}`)}>
                  <span className="sa-prio__n">{i + 1}</span>
                  <span className="sa-prio__who"><b>{e.entity_name}</b><small><span className="sa-mono">{e.entity_id}</span> · {e.top_reasons[0]?.name}</small></span>
                  <BasisTag basis={e.flag_basis} />
                  <Meter v={e.attention} basis={e.flag_basis} />
                </button></li>))}
            </ol>
            <Btn kind="secondary" to="/queue" icon={ArrowRight}>Open the full review queue</Btn>
          </aside>
        </div>
      </section>

      <div className="sa-grid sa-grid--2 sa-section">
        <section className="sa-card">
          <div className="sa-card__head"><div><h2 className="sa-card__title"><Tipped text="What was found" tip={{ title: "What was found", text: "For each finding, how many flagged entities have it among their three strongest. Long bars are weaknesses that recur across the cycle, which may call for sector-wide guidance." }} /></h2>
            <p className="sa-card__sub">How often each finding leads the evidence among flagged entities (top three per entity).</p></div></div>
          <ul className="sa-bars">
            {leading.map((l) => (
              <li key={l.id}>
                <span className="sa-bars__label"><span className="sa-mono sa-muted">{l.id}</span> {l.name}</span>
                <span className="sa-bars__track"><i className={l.fam === "Execution gap" ? "is-review" : "is-confirmed"} style={{ inlineSize: `${(l.n / maxLead) * 100}%` }} /></span>
                <b className="sa-num">{l.n}</b>
              </li>))}
          </ul>
          <div className="sa-orb-legend" style={{ justifyContent: "flex-start", marginTop: "0.75rem" }}><span><i className="is-review" />execution gap</span><span><i className="is-confirmed" />negative space</span></div>
        </section>
        <section className="sa-card">
          <div className="sa-card__head"><div><h2 className="sa-card__title"><Tipped text="Sectors" tip={{ title: "Sectors", text: <>Each square is one entity; filled squares are flagged. <b>blind</b> marks a sector where some entity cannot see a whole ATT&CK tactic.</> }} /></h2><p className="sa-card__sub">Flagged entities per critical sector. Click a sector for its queue.</p></div>
            <Btn kind="ghost" size="sm" to="/sectors" icon={ArrowRight}>Sector view</Btn></div>
          <ul className="sa-bars sa-bars--sector">
            {(sectors.data ?? []).map((s: any) => (
              <li key={s.sector}><button type="button" onClick={() => nav(`/queue?sector=${s.sector}`)}>
                <span className="sa-bars__label"><span className="sa-chip">{s.sector}</span> {s.sector_name}</span>
                <span className="sa-bars__stack" aria-label={`${s.flagged} of ${s.entities} flagged`}>
                  {Array.from({ length: s.entities }, (_, k) => <i key={k} className={k < s.flagged ? "is-hot" : ""} />)}
                </span>
                <b className="sa-num">{s.flagged}/{s.entities}</b>
                {s.blind_tactics.length > 0 && <Badge kind="confirmed">blind</Badge>}
              </button></li>))}
          </ul>
        </section>
      </div>

      {prov.data && (
        <section className="sa-card sa-section sa-systemic" aria-labelledby="sys-h">
          <div className="sa-systemic__text">
            <h2 id="sys-h" className="sa-card__title"><Network_3 size={16} /><Tipped text=" Systemic risk" tip={{ title: "Systemic risk", text: "A managed SOC provider whose clients together show a shift that no single client's review would reveal. Estimated with a random-effects model; the chart links the provider to its clients." }} /></h2>
            {weak ? <>
              <p className="sa-systemic__big"><span className="sa-mono">{weak.provider}</span> serves {weak.clients.length} entities across {weak.sectors.length} sectors, with a <b className="sa-confirmed">+{weak.effect_pp.toFixed(1)} pp</b> provider effect.</p>
              <p className="sa-body">Each client looks only borderline on its own. Together they show one shared weakness: a risk no single entity's review would reveal.</p>
            </> : <p className="sa-body">No outsourced SOC provider shows a provider-level effect this cycle.</p>}
            <Btn kind="primary" to="/providers" icon={ArrowRight}>Open SOC providers</Btn>
          </div>
          <ProviderOrbit providers={prov.data} entities={q.entities} compact />
        </section>
      )}
    </>
  );
}
