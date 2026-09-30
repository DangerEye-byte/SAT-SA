import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Checkmark, DocumentView, Flag, Microscope, Printer, Rule, Upload, ViewOff } from "@carbon/icons-react";
import { FileUploaderDropContainer } from "@carbon/react";
import { api, fmtP, pEq, pct, type Entity, type Finding } from "../api";
import { CaseDrawer, FindingDrawer } from "../components/Drawers";
import { Badge, BasisTag, Btn, Chart, Empty, ErrorBox, Figure, Glow, Info, Tipped, Kpi, Loading, Meter, PageHeader, StateLegend, Tabs } from "../components/ui";
import { useData } from "../hooks";
import { useTheme } from "../theme";

type TabId = "findings" | "evidence" | "trends" | "survival" | "hourly" | "regulatory" | "redteam" | "attack";
const DISP: Record<string, "ok" | "neutral" | "confirmed" | "review"> = { accepted: "ok", dismissed: "neutral", escalated: "confirmed", open: "review" };
const GUIDE = [
  { icon: Flag, title: "Start with the findings", text: "Each one states the evidence first: what the records show, compared with peers, and the obligation it tests." },
  { icon: DocumentView, title: "Open the evidence", text: "A finding opens a drawer with its chart, the exact records, an optional verified AI explanation and your decision." },
  { icon: Microscope, title: "Size the problem", text: "The Review lab estimates how many cases were handled superficially, with a valid interval." },
];

export default function EntityPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: e, error, reload } = useData(() => api.entity(id), [id]);
  const [tab, setTab] = useState<TabId>((params.get("tab") as TabId) || "findings");
  const det = params.get("finding");
  const [caseId, setCaseId] = useState<string | null>(null);
  useEffect(() => { setTab((params.get("tab") as TabId) || "findings"); /* new entity: reset tab */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const openDet = (d: string | null) => { const n = new URLSearchParams(params); d ? n.set("finding", d) : n.delete("finding"); setParams(n, { replace: true }); };

  if (error) return <ErrorBox e={error} title={`Entity ${id} could not be loaded`} />;
  if (!e) return <Loading page label={`Opening the ${id} dossier`} />;
  const basis = e.q_value <= 0.1 ? (e.n_deterministic ? "both" : "statistical") : (e.n_deterministic ? "deterministic" : null);
  const gaps = e.findings.filter((f) => f.family === "Execution gap");
  const space = e.findings.filter((f) => f.family !== "Execution gap");
  const TABS: { id: TabId; label: string; count?: number }[] = [
    { id: "findings", label: "Findings", count: e.findings.length }, { id: "evidence", label: "Evidence over time" }, { id: "trends", label: "Trends" },
    { id: "survival", label: "Time to close" }, { id: "hourly", label: "24×7 reality" }, { id: "regulatory", label: "Regulatory" },
    { id: "redteam", label: "Red team" }, { id: "attack", label: "ATT&CK coverage" },
  ];
  return (
    <>
      <PageHeader guideKey="entity" guide={GUIDE}
        title={<>{e.entity_name} <span className="sa-chip">{e.entity_id}</span></>}
        meta={<BasisTag basis={basis} />}
        lead={<span className="sa-metaline">
          <span>{e.sector_name}</span><span>size {e.size_band}</span><span>SOC: {e.soc_provider === "INHOUSE" ? <><Tipped text="in-house" tip="inhouse" /></> : <><Link to="/providers">{e.soc_provider}</Link><Info tip="mssp" /></>}</span>
          <span>{e.n_assets} assets</span><span>{e.n_analysts} analysts</span><span>{e.claims_24x7 ? "declares 24×7 monitoring" : "business-hours SOC"}<Info tip={{ title: "Declared operating hours", text: "What the entity says about its SOC hours. The 24×7 reality tab checks the claim against acknowledgement times by hour of week." }} /></span>
        </span>}
        actions={<>
          <Btn kind="secondary" icon={Printer} iconLeft href={api.briefUrl(e.entity_id)} target="_blank" title="A printable, self-contained brief of this dossier for the examination team">Examination brief</Btn>
          <Btn kind="primary" icon={ArrowRight} to={`/review/${e.entity_id}`}>Open review lab</Btn>
        </>} />

      <div className="sa-kpis sa-kpis--glow">
        <Glow tone={basis === "statistical" ? "review" : basis ? "confirmed" : "accent"}><Kpi label="Supervisory attention" tip="attention" value={<>{e.attention.toFixed(0)}<small>/ 100</small></>} note={<Meter v={e.attention} basis={basis} />} /></Glow>
        <Glow><Kpi label="Entity q-value (FDR-adjusted)" tip={{ title: "Entity q-value", text: <>The entity's calibrated tests are combined into one p-value (ACAT, which stays valid when tests are related), then corrected across all entities (Benjamini-Hochberg). Flagged when q is at or below the budget, 10% by default.</> }} value={<span className="sa-mono" style={{ fontSize: "1.5rem" }}>{fmtP(e.q_value)}</span>} note={`combined from ${e.n_tests} calibrated tests (ACAT, then BH)`} /></Glow>
        <Glow tone="review"><Kpi label="Findings for examiner review" tip="findings" value={e.findings.length} note={<span className="sa-row" style={{ gap: "0.375rem" }}><Badge kind="review">{gaps.length} execution gaps</Badge><Badge kind="confirmed">{space.length} negative space</Badge></span>} /></Glow>
        <Glow tone="ok"><Kpi label="Data trust" tip="trust" value={<>{e.trust_score.toFixed(0)}<small>/ 100</small></>} note={`completeness ${pct(e.trust_completeness)}, timeliness ${pct(e.trust_timeliness)}, coverage ${pct(e.trust_coverage)}`} /></Glow>
      </div>

      <div className="sa-grid sa-grid--side sa-section">
        <aside className="sa-stack sa-sticky" aria-label="Capability profile">
          <Capabilities e={e} />
          <section className="sa-card">
            <h2 className="sa-card__title"><Tipped text="Declared log sources" tip="sources" /></h2>
            <p className="sa-card__sub" style={{ marginBottom: "0.75rem" }}>What this SOC says it collects. Blind tactics follow from what is missing.</p>
            <div className="sa-chips">{e.declared_log_sources.map((s) => <span key={s} className="sa-chip">{s}</span>)}</div>
          </section>
        </aside>
        <div className="sa-stack" style={{ minWidth: 0, gap: "1.25rem" }}>
          <Tabs label="Dossier sections" value={tab} onChange={setTab} items={TABS} />
          <div role="tabpanel" className="sa-rise" key={tab}>
            {tab === "findings" && (e.findings.length === 0
              ? <div className="sa-card"><Empty icon={Checkmark} title="No significant findings">This entity's evidence is consistent with its peers.</Empty></div>
              : <div className="sa-stack" style={{ gap: "1.5rem" }}>
                {gaps.length > 0 && <FindingGroup title="Execution gaps" tip="execGap" sub="Practice that looks fine on paper but is not." items={gaps} onOpen={openDet} />}
                {space.length > 0 && <FindingGroup title="Negative space" tip="negSpace" sub="Evidence that should exist and is missing." items={space} onOpen={openDet} />}
              </div>)}
            {tab === "evidence" && <div className="sa-card"><Evidence id={e.entity_id} q={e.quarterly} /></div>}
            {tab === "trends" && <div className="sa-card"><Trends monthly={e.monthly} /></div>}
            {tab === "survival" && <div className="sa-card"><Survival id={e.entity_id} /></div>}
            {tab === "hourly" && <div className="sa-card"><Hourly id={e.entity_id} claims={e.claims_24x7} /></div>}
            {tab === "regulatory" && <Regulatory id={e.entity_id} />}
            {tab === "redteam" && <RedTeam id={e.entity_id} />}
            {tab === "attack" && <div className="sa-card">
              <Figure title={`${e.tactics.filter((t) => t.state === "blind").length} tactics blind, ${e.tactics.filter((t) => t.state === "quiet").length} quiet`} tip={{ title: "ATT&CK coverage", text: "For each tactic: alerts observed against alerts expected from the entity's assets and peers. Blind means the declared log sources cannot see it at all; quiet means it can see but raised far fewer alerts." }}
                sub="Silence is ambiguous until we know whether the entity could see. Blind means the declared log sources cannot support detection.">
                <StateLegend />
                <div className="sa-tactics">
                  {e.tactics.map((t) => (
                    <div key={t.tactic} className={`sa-tactic sa-state--${t.state}`}>
                      <b>{t.tactic}</b><span>{t.state.replace("_", " ")}</span>
                      <span className="sa-mono">{t.observed} seen / {Math.round(t.expected ?? 0)} expected</span>
                    </div>))}
                </div>
              </Figure>
            </div>}
          </div>
        </div>
      </div>
      {det && <FindingDrawer entityId={e.entity_id} detector={det} onClose={() => { openDet(null); reload(); }} onCase={setCaseId} />}
      {caseId && <CaseDrawer caseId={caseId} onClose={() => setCaseId(null)} />}
    </>
  );
}

function FindingGroup({ title, sub, tip, items, onOpen }: { title: string; sub: string; tip: string; items: Finding[]; onOpen: (d: string) => void }) {
  return (
    <section>
      <div className="sa-section__head" style={{ marginBottom: "0.625rem" }}>
        <h2 className="sa-h2">{title} <span className="sa-muted" style={{ fontWeight: 400 }}>({items.length})</span><Info tip={tip} /></h2>
        <span className="sa-helper">{sub}</span>
      </div>
      <div className="sa-findings">
        {items.map((f) => (
          <button key={f.detector_id} type="button" className={`sa-finding ${f.deterministic ? "is-fact" : ""}`} onClick={() => onOpen(f.detector_id)}>
            <span className="sa-finding__head">
              <span className="sa-mono sa-muted">{f.detector_id}</span>
              <span className="sa-finding__name">{f.name}</span>
              {f.disposition && f.disposition.status !== "open" && <Badge kind={DISP[f.disposition.status] ?? "neutral"}>examiner: {f.disposition.status}</Badge>}
              <span className="sa-finding__p">{f.deterministic ? <Badge kind="confirmed" dot>fact · {f.severity}</Badge> : <span className="sa-pchip">{pEq(f.p_value)}</span>}</span>
            </span>
            <span className="sa-finding__reason">{f.reason}</span>
            <span className="sa-finding__foot"><Rule size={14} aria-hidden="true" /><span className="sa-finding__reg">{f.regulations[0]}</span><span className="sa-finding__open">Open evidence <ArrowRight size={14} /></span></span>
          </button>))}
      </div>
    </section>
  );
}

function Capabilities({ e }: { e: Entity }) {
  const { p } = useTheme();
  const caps = Object.entries(e.capabilities);
  const top = caps.slice().sort((a, b) => b[1] - a[1])[0];
  return (
    <section className="sa-card">
      <Figure title={top && top[1] > 0 ? <>Weakest capability: {top[0]}</> : "No capability stands out"}
        tip="capability" sub="Capability profile across the eight PS areas. Further out = stronger evidence of weakness.">
        <Chart height={270} label="Capability radar" option={{
          radar: { indicator: caps.map(([k]) => ({ name: k.replace(" & ", " &\n").replace("Operational ", "Operational\n"), max: 100 })), radius: "50%", center: ["50%", "53%"], axisName: { color: p.text2, fontSize: 10 }, splitNumber: 4,
            splitArea: { show: true, areaStyle: { color: [p.layer, p.layer2] } } },
          series: [{ type: "radar", symbolSize: 4, data: [{ value: caps.map(([, v]) => Math.round(v)), name: "Weakness evidence",
            areaStyle: { color: { type: "radial", x: 0.5, y: 0.5, r: 0.7, colorStops: [{ offset: 0, color: p.confirmed + "22" }, { offset: 1, color: p.confirmed + "66" }] } },
            lineStyle: { color: p.confirmed, width: 2 }, itemStyle: { color: p.confirmed } }] }],
        }} />
      </Figure>
    </section>
  );
}

const SERIES: [string, string, "confirmed" | "review" | "ai" | "ok"][] = [
  ["Fast closures (p≤0.05)", "fast_share", "confirmed"], ["No investigation (high/crit)", "no_investigation_share", "review"],
  ["Templated notes", "templated_share", "ai"], ["Critical escalation rate", "escalation_rate_critical", "ok"],
];

function Trends({ monthly }: { monthly: any[] }) {
  const { p } = useTheme();
  const x = monthly.map((m) => m.period);
  const move = SERIES.map(([name, key]) => {
    const v = monthly.map((m) => m[key]).filter((z) => z != null) as number[];
    if (v.length < 6) return null;
    const a = (v[0] + v[1] + v[2]) / 3, b = (v[v.length - 1] + v[v.length - 2] + v[v.length - 3]) / 3;
    return { name, a, b, d: Math.abs(b - a) };
  }).filter(Boolean).sort((m, n) => n!.d - m!.d)[0];
  return (
    <Figure title={move ? `${move.name} moved from ${pct(move.a)} to ${pct(move.b)} over the year` : "Monthly workflow signals"} tip={{ title: "Monthly workflow signals", text: "Four monthly shares from the case workflow: closures faster than peers (p ≤ 0.05), high or critical cases with no investigation step, templated notes and the critical escalation rate. The title names the signal that moved most over the year." }} sub="First-quarter against last-quarter average of each monthly share.">
      <Chart height={320} label="Monthly workflow signals" option={{
        tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { top: 40, left: 44, right: 16, bottom: 28 },
        xAxis: { type: "category", data: x }, yAxis: { type: "value", name: "%" },
        series: SERIES.map(([name, key, tone]) => ({ name, type: "line", smooth: 0.3, symbol: "circle", symbolSize: 5, data: monthly.map((m) => m[key] == null ? null : +(m[key] * 100).toFixed(1)), lineStyle: { color: p[tone], width: 2 }, itemStyle: { color: p[tone] } })),
      }} />
    </Figure>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function Hourly({ id, claims }: { id: string; claims: boolean }) {
  const { p } = useTheme();
  const { data, error } = useData(() => api.hourly(id), [id]);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading label="Reading hour-of-week activity" />;
  const cells = data.cells.map((c: any) => [c.hour, c.dow, Math.min(600, Math.round(c.median_ack_min))]);
  const med = (hours: (h: number) => boolean) => {
    const v = data.cells.filter((c: any) => hours(c.hour)).map((c: any) => c.median_ack_min).sort((a: number, b: number) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const night = med((h) => h < 6), day = med((h) => h >= 9 && h < 18);
  return (
    <Figure tip="hourly" title={night != null && day != null ? `Nights: ${Math.round(night)} min median to acknowledge; days: ${Math.round(day)} min` : "Acknowledgement time by hour of week"}
      sub={<>Median minutes to acknowledge high and critical cases, by hour of week. {claims ? "This entity declares 24×7 monitoring, so the grid should look uniform." : "This entity runs a business-hours SOC."}</>}>
      <Chart height={330} label="Hour-of-week heatmap of acknowledgement time" option={{
        tooltip: { formatter: (q: any) => `${DAYS[q.value[1]]} ${q.value[0]}:00, median ack ${q.value[2]} min` },
        grid: { top: 8, left: 44, right: 16, bottom: 84 },
        xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => `${i}`), splitArea: { show: false } }, yAxis: { type: "category", data: DAYS },
        visualMap: { min: 0, max: 240, calculable: true, orient: "horizontal", left: "center", bottom: 4, itemHeight: 220, itemWidth: 12, text: ["240+ min", "0 min"], inRange: { color: [p.covered, p.ok, p.review, p.confirmed] } },
        series: [{ type: "heatmap", data: cells, itemStyle: { borderColor: p.layer, borderWidth: 2, borderRadius: 3 } }],
      }} />
    </Figure>
  );
}

function Regulatory({ id }: { id: string }) {
  const { data, error } = useData(() => api.entityReg(id), [id]);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading label="Mapping findings to obligations" />;
  const label: Record<string, ReactNode> = {
    evidence_contradicts: <Badge kind="confirmed" dot>evidence contradicts</Badge>,
    insufficient_evidence: <Badge kind="neutral">insufficient evidence</Badge>,
    consistent: <Badge kind="ok" dot>consistent</Badge>,
  };
  const n = data.items.filter((i: any) => i.status === "evidence_contradicts").length;
  return (
    <div className="sa-card sa-card--flush">
      <div className="sa-card__head"><div><h2 className="sa-card__title">{n} obligation{n === 1 ? "" : "s"} where the evidence contradicts the claim<Info tip="regulatory" /></h2>
        <p className="sa-card__sub">Crosswalk from each detector to SEBI CSCRF, CERT-In Directions 2022, RBI and CEA obligations. Flags are for examiner review.</p></div></div>
      <div className="sa-tablewrap">
        <table className="sa-t">
          <thead><tr><th>Obligation</th><th><Tipped text="Status" tip={{ title: "Status", text: "Evidence contradicts: the records do not support the obligation. Insufficient evidence: too few records to tell. Consistent: the records support it." }} /></th><th>Evidence</th></tr></thead>
          <tbody>{data.items.map((it: any, i: number) => (
            <tr key={i}><td style={{ maxWidth: "28rem" }}>{it.obligation}</td><td>{label[it.status]}</td><td className="sa-muted"><span className="sa-mono">{it.detector}</span> {it.effect}</td></tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

function RedTeam({ id }: { id: string }) {
  const { p } = useTheme();
  const { data: stored, error } = useData(() => api.redteam(id), [id]);
  const [up, setUp] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox e={error} />;
  if (!stored) return <Loading label="Loading red-team exercises" />;
  const data = up ? { ...up, has_report: true, reason: `Uploaded exercise: ${up.funnel.executed} techniques executed, ${up.funnel.executed - up.funnel.alerted} never alerted${up.missed.length ? ` (${up.missed.join(", ")})` : ""}.` } : stored;
  const upload = (
    <section className="sa-card">
      <h2 className="sa-card__title"><Upload size={16} /><Tipped text=" Reconcile a red-team or drill report" tip="redteamRecon" /></h2>
      <p className="sa-card__sub" style={{ marginBottom: "0.75rem" }}>CSV or JSON with category or technique_id, start_ts and target_asset. Each executed technique is matched against the SOC's own alerts, cases and escalations.</p>
      {busy ? <Loading inline label="Reconciling the report" /> :
        <FileUploaderDropContainer multiple={false} labelText="Drag a report here or click to choose a file" accept={[".csv", ".json"]}
          onAddFiles={async (_ev, { addedFiles }) => {
            const f = addedFiles?.[0];
            if (!f) return;
            setBusy(true);
            try { setErr(null); setUp(await api.redteamUpload(id, f)); } catch (x) { setErr(String(x)); } finally { setBusy(false); }
          }} />}
      {err && <div style={{ marginTop: "0.75rem" }}><ErrorBox e={err} title="The report could not be reconciled" /></div>}
    </section>);
  if (!data.has_report) return <div className="sa-stack">{upload}<div className="sa-card"><Empty icon={ViewOff} title="No red-team report submitted">Upload one above to reconcile it against this SOC's paper trail.</Empty></div></div>;
  const stages = ["executed", "alerted", "cased", "escalated"];
  const f = data.funnel;
  return (
    <div className="sa-stack">
      <section className="sa-card">
        <Figure tip={{ title: "Detection funnel", text: "Of the techniques the red team executed: how many raised an alert, became a case and were escalated. Every drop between stages is a documented miss." }} title={`${f.alerted} of ${f.executed} techniques alerted; ${f.escalated} escalated`} sub={data.reason}>
          <div className="sa-funnel">
            {stages.map((s, i) => (
              <div key={s} className="sa-funnel__step">
                <span className="sa-funnel__bar" style={{ inlineSize: `${Math.max(4, (f[s] / Math.max(1, f.executed)) * 100)}%`, background: i === 0 ? p.neutral1 : p.accent }} />
                <span className="sa-funnel__label"><b>{f[s]}</b> {s}</span>
              </div>))}
          </div>
        </Figure>
      </section>
      <div className="sa-card sa-card--flush">
        <div className="sa-tablewrap">
          <table className="sa-t sa-t--sm">
            <thead><tr><th>Technique</th><th>Tactic</th><th>Target</th><th>Alerted</th><th>Cased</th><th>Escalated</th></tr></thead>
            <tbody>{data.techniques.map((t: any) => (
              <tr key={t.technique_id + t.target_asset}><td><span className="sa-mono">{t.technique_id}</span> {t.technique}</td><td>{t.tactic}</td><td className="sa-mono">{t.target_asset}</td>
                <td>{t.alerted ? <span className="sa-ok">yes</span> : <Badge kind="confirmed">missed</Badge>}</td><td>{t.cased ? "yes" : <span className="sa-muted">no</span>}</td><td>{t.escalated ? "yes" : <span className="sa-muted">no</span>}</td></tr>))}</tbody>
          </table>
        </div>
      </div>
      {upload}
    </div>
  );
}

const CYCLE_TIP = {
  new: "Findings raised this cycle that were not raised last cycle.",
  persisting: "Findings raised in both cycles: the weakness was not fixed.",
  resolved: "Findings raised last cycle that no longer appear.",
};

function Evidence({ id, q }: { id: string; q: Entity["quarterly"] }) {
  const { p } = useTheme();
  const { data: cyc } = useData(() => api.cycle(id), [id]);
  if (!q?.length) return <Empty title="Quarterly monitoring not available for this run" />;
  const first = q.find((x) => x.ebh_flag);
  return (
    <>
      <Figure tip="evalue" title={first ? `Crossed the flag line in ${first.quarter}` : "Evidence stays below the flag line"}
        sub="Each quarter is analysed on its own data. The running product of e-values keeps its false-alarm guarantee however often the regulator looks (anytime-valid e-BH). Above the line = flagged at 10% FDR.">
        <Chart height={260} label="Cumulative e-value by quarter" option={{
          tooltip: { trigger: "axis" }, grid: { top: 16, left: 60, right: 20, bottom: 28 },
          xAxis: { type: "category", data: q.map((x) => x.quarter) },
          yAxis: { type: "log", name: "evidence (e)", min: 0.1 },
          series: [{ type: "line", name: "cumulative evidence", smooth: 0.2, data: q.map((x) => Math.max(0.1, x.cum_e)), itemStyle: { color: p.accent }, lineStyle: { color: p.accent, width: 2.5 },
            areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: p.accent + "44" }, { offset: 1, color: p.accent + "00" }] } },
            markLine: { symbol: "none", data: [{ yAxis: 10, name: "1/FDR" }], lineStyle: { color: p.confirmed, type: "dashed" }, label: { color: p.confirmed, formatter: "flag line (e = 10)" } } },
            { type: "scatter", name: "flagged (e-BH)", data: q.map((x) => (x.ebh_flag ? Math.max(0.1, x.cum_e) : null)), itemStyle: { color: p.confirmed }, symbolSize: 12 }],
        }} />
      </Figure>
      {cyc?.available && <div className="sa-cycle">
        {(["new", "persisting", "resolved"] as const).map((k) => (
          <section key={k} className={`sa-cycle__col is-${k}`}>
            <h3 className="sa-h3">{k[0].toUpperCase() + k.slice(1)}<Info tip={CYCLE_TIP[k]} /> <span className="sa-helper">{cyc.previous} to {cyc.current}</span></h3>
            {cyc[k].length ? cyc[k].map((d: any) => <div key={d.detector_id} className="sa-body"><span className="sa-mono">{d.detector_id}</span> {d.name}</div>)
              : <div className="sa-helper">none</div>}
          </section>))}
      </div>}
    </>
  );
}

function Survival({ id }: { id: string }) {
  const { p } = useTheme();
  const { data, error } = useData(() => api.survival(id), [id]);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading label="Fitting the Kaplan-Meier curve" />;
  if (!data.available) return <Empty title="Not enough high and critical cases" />;
  return (
    <Figure tip="km" title={`Median ${data.km_median_min?.toFixed(0)} min to close, against ${data.peer_km_median_min?.toFixed(0)} min at peers`}
      sub={<>Share of high and critical cases still open after t minutes (Kaplan-Meier; cases still open at the end of the period count as censored, not dropped).
        A closed-cases-only median would say {data.naive_median_min?.toFixed(0)} min ({data.open} cases still open).</>}>
      <Chart height={280} label="Kaplan-Meier time-to-close curve" option={{
        tooltip: { trigger: "axis" }, grid: { top: 16, left: 50, right: 20, bottom: 40 },
        xAxis: { type: "category", data: data.curve.t, name: "minutes", nameLocation: "middle", nameGap: 26 },
        yAxis: { type: "value", max: 1, axisLabel: { formatter: (x: number) => `${x * 100}%` } },
        series: [{ type: "line", step: "end", symbol: "none", data: data.curve.open_share, itemStyle: { color: p.accent }, lineStyle: { color: p.accent, width: 2 },
          areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: p.accent + "40" }, { offset: 1, color: p.accent + "05" }] } } }],
      }} />
    </Figure>
  );
}
