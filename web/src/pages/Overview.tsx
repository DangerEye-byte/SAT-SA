import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import {
  ArrowRight, Blockchain, CheckmarkFilled, ChevronDown, CloudOffline, DataCheck, DocumentImport, DocumentView, Flag,
  MachineLearningModel, Microscope, PlayFilledAlt, Scales, Sigma, ViewOff,
} from "@carbon/icons-react";
import { api, pct, STATIC, type Queue } from "../api";
import Brand from "../components/Brand";
import CardNav from "../components/fx/CardNav";
import CompareSlider from "../components/fx/CompareSlider";
import CountUp from "../components/fx/CountUp";
import Pagination from "../components/fx/Pagination";
import Radar from "../components/fx/Radar";
import { Badge, BasisTag, Btn, Chart, Glow, Loading, Meter, Real, Segmented, Synthetic, ThemeToggle } from "../components/ui";
import { useData } from "../hooks";
import { CARD_NAV } from "../nav";
import { useTheme } from "../theme";
import { useTour } from "../tour";
import queueDark from "../assets/landing/queue-dark.jpg";
import queueLight from "../assets/landing/queue-light.jpg";
import dossierDark from "../assets/landing/dossier-dark.jpg";
import dossierLight from "../assets/landing/dossier-light.jpg";
import bunchingDark from "../assets/landing/bunching-dark.jpg";
import bunchingLight from "../assets/landing/bunching-light.jpg";
import redteamDark from "../assets/landing/redteam-dark.jpg";
import redteamLight from "../assets/landing/redteam-light.jpg";
import guideDark from "../assets/landing/guide-dark.jpg";
import guideLight from "../assets/landing/guide-light.jpg";

// Landing page. Dials: VARIANCE 6, MOTION 6, DENSITY 4. Every number comes from the running API and is
// badged synthetic or real. Screenshots are real captures of this app.
const LEVELS = [0.05, 0.1, 0.2];
const ease = [0.16, 1, 0.3, 1] as const;

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }} transition={{ duration: 0.7, ease, delay }}>
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Hero: headline + a real, working queue (not a screenshot)
// ---------------------------------------------------------------------------
function Headline() {
  const reduce = useReducedMotion();
  const words = ["Find", "the", "SOCs", "that", "only", "look", "fine", "on", "paper."];
  return (
    <h1 className="sa-land-h1" aria-label="Find the SOCs that only look fine on paper.">
      {words.map((w, i) => (
        <motion.span key={i} aria-hidden="true" className={w === "paper." ? "is-accent" : ""} initial={reduce ? false : { opacity: 0, y: 18, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.6, ease, delay: 0.08 + i * 0.06 }}>{w} </motion.span>
      ))}
    </h1>
  );
}

function LiveQueue() {
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const [fdr, setFdr] = useState(0.1);
  const [q, setQ] = useState<Queue | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let on = true; api.queue(fdr).then((d) => on && setQ(d)).catch(() => on && setErr(true)); return () => { on = false; }; }, [fdr]);
  const top = (q?.entities ?? []).filter((e) => e.flagged).slice(0, 6);
  return (
    <Glow className="sa-live" animated>
      <div className="sa-live__in">
        <div className="sa-live__head">
          <span className="sa-live__dot" aria-hidden="true" /><b>Review queue</b><span className="sa-helper">{STATIC ? "snapshot of a local run" : "live from this machine"}</span>
          <span className="sa-spacer" /><Synthetic />
        </div>
        <div className="sa-live__ctl">
          <span className="sa-helper">False-alarm budget</span>
          <Segmented accent label="False-alarm budget" value={fdr} onChange={setFdr} options={LEVELS.map((l) => ({ v: l, label: `${l * 100}%` }))} />
        </div>
        {err ? <p className="sa-body">Start the SAT-SA API (run.bat) to see the live queue.</p> : !q ? <Loading label="Ranking entities" /> : <>
          <p className="sa-live__sentence" aria-live="polite">At <b>{fdr * 100}%</b>, <b className="sa-review">{q.n_flagged_statistical}</b> entities flagged on statistics, at most <b>~{q.expected_false_discoveries_max}</b> expected false alarms, plus <b className="sa-confirmed">{q.n_flagged_deterministic}</b> on documented facts.</p>
          <ol className="sa-live__list">
            <AnimatePresence initial={false} mode="popLayout">
              {top.map((e, i) => (
                <motion.li key={e.entity_id} layout={!reduce} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.35, ease }}>
                  <button type="button" onClick={() => nav(`/entity/${e.entity_id}`)}>
                    <span className="sa-live__rank">{i + 1}</span>
                    <span className="sa-live__who"><b>{e.entity_name}</b><small className="sa-mono">{e.entity_id}</small></span>
                    <span className="sa-live__why">{e.top_reasons[0]?.name}</span>
                    <BasisTag basis={e.flag_basis} />
                    <Meter v={e.attention} basis={e.flag_basis} />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
          <Link to="/" className="sa-arrowlink">Open all {q.n_flagged} in the review queue <ArrowRight size={16} /></Link>
        </>}
      </div>
    </Glow>
  );
}

// ---------------------------------------------------------------------------
// Claim against record: compare slider with real evidence
// ---------------------------------------------------------------------------
type Story = "sla" | "nights" | "notes";
const STORIES: { id: Story; entity: string; name: string; claims: string[] }[] = [
  { id: "sla", entity: "BFS-03", name: "Bank C", claims: ["Critical incidents closed within the 240-minute SLA", "SLA compliance reported every month", "Closure times look healthy on the KPI dashboard"] },
  { id: "nights", entity: "PWR-05", name: "Power Utility E", claims: ["Round-the-clock (24×7) monitoring declared", "Every high-severity alert acknowledged", "Night shift staffed per the SOC charter"] },
  { id: "notes", entity: "TEL-02", name: "Telecom B", claims: ["Every case investigated and documented", "Analyst notes on every closed case", "Investigation steps logged in the workflow"] },
];

function StoryRecord({ id, entity }: { id: Story; entity: string }) {
  const { p } = useTheme();
  const sla = useData(() => (id === "sla" ? api.finding("BFS-03", "EG6") : Promise.resolve(null)), [id]);
  const hr = useData(() => (id === "nights" ? api.hourly("PWR-05") : Promise.resolve(null)), [id]);
  const tpl = useData(() => (id === "notes" ? api.finding("TEL-02", "EG3") : Promise.resolve(null)), [id]);
  if (id === "sla") {
    const c = sla.data?.extra?.chart;
    if (!c) return <Loading label="Reading closure times" />;
    return <>
      <RecordText entity={entity}><b className="sa-confirmed">{Math.round(c.excess)} extra closures</b> squeezed into the minutes just before the {c.sla}-minute SLA.</RecordText>
      <Chart height={230} label="Closure-time histogram" option={{
        grid: { top: 10, left: 36, right: 8, bottom: 26 }, tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: c.bins.map((b: number) => b.toFixed(0)), axisLabel: { interval: 9 } }, yAxis: { type: "value" },
        series: [{ type: "bar", barCategoryGap: "10%", data: c.observed.map((v: number, i: number) => ({ value: v, itemStyle: { color: c.bins[i] >= c.window[0] && c.bins[i] < c.sla ? p.confirmed : p.neutral1 } })) },
          { type: "line", data: c.counterfactual, smooth: true, symbol: "none", lineStyle: { color: p.ok, width: 2.5 } }],
      }} />
    </>;
  }
  if (id === "nights") {
    const d = hr.data;
    if (!d) return <Loading label="Reading acknowledgement times" />;
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return <>
      <RecordText entity={entity}>Median minutes to acknowledge, by hour of week: <b className="sa-confirmed">nights go unattended.</b></RecordText>
      <Chart height={230} label="Hour-of-week acknowledgement heatmap" option={{
        grid: { top: 6, left: 36, right: 8, bottom: 22 }, tooltip: { formatter: (q: any) => `${DAYS[q.value[1]]} ${q.value[0]}:00, ${q.value[2]} min` },
        xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => `${i}`), axisLabel: { interval: 3 } }, yAxis: { type: "category", data: DAYS },
        visualMap: { show: false, min: 0, max: 240, inRange: { color: [p.covered, p.ok, p.review, p.confirmed] } },
        series: [{ type: "heatmap", data: d.cells.map((c: any) => [c.hour, c.dow, Math.min(600, Math.round(c.median_ack_min))]), itemStyle: { borderColor: p.layer, borderWidth: 2, borderRadius: 3 } }],
      }} />
    </>;
  }
  const cl = tpl.data?.extra?.clusters;
  if (!tpl.data) return <Loading label="Reading analyst notes" />;
  return <>
    <RecordText entity={entity}><b className="sa-confirmed">{tpl.data.effect}</b>: the same note, pasted case after case.</RecordText>
    <div className="sa-record__notes">
      {(cl ?? []).slice(0, 3).map((c: any, i: number) => <div key={i}><Badge kind="confirmed">{c.count}×</Badge><p className="sa-note">{c.example}</p></div>)}
    </div>
  </>;
}

function RecordText({ entity, children }: { entity: string; children: ReactNode }) {
  return (
    <div className="sa-record__col">
      <div className="sa-record__head"><span className="sa-mono">{entity}</span> paper trail, as read by SAT-SA <Badge kind="confirmed" dot>flagged</Badge></div>
      <p className="sa-record__lead">{children}</p>
      <Link to={`/entity/${entity}`} className="sa-arrowlink" onPointerDown={(e) => e.stopPropagation()}>Open the {entity} dossier <ArrowRight size={16} /></Link>
    </div>
  );
}

function ClaimVsRecord() {
  const [s, setS] = useState<Story>("sla");
  const story = STORIES.find((x) => x.id === s)!;
  return (
    <section className="sa-land-sec" aria-labelledby="cvr-h">
      <Reveal className="sa-land-sechead">
        <h2 id="cvr-h" className="sa-land-h2">A clean dashboard can hide a weak SOC.</h2>
        <p className="sa-land-p">Drag the handle. On the left, what the submission claims. On the right, what its own paper trail shows.</p>
      </Reveal>
      <Reveal delay={0.1}>
        <div className="sa-land-stories" role="tablist" aria-label="Examples">
          {STORIES.map((x) => (
            <button key={x.id} role="tab" type="button" aria-selected={s === x.id} className="sa-land-story" onClick={() => setS(x.id)}>
              <span className="sa-mono">{x.entity}</span>{x.name}
            </button>))}
          <span className="sa-spacer" /><Synthetic />
        </div>
        <CompareSlider key={s} leftLabel="The claim" rightLabel="The record"
          left={<div className="sa-claim">
            <div className="sa-claim__col">
              <div className="sa-claim__head"><span className="sa-mono">{story.entity}</span> self-assessment <Badge kind="ok" dot>all green</Badge></div>
              <ul>{story.claims.map((c) => <li key={c}><CheckmarkFilled size={18} />{c}</li>)}</ul>
              <div className="sa-claim__kpis"><div><b>OK</b><span>KPI status</span></div><div><b>0</b><span>open issues</span></div><div><b>Met</b><span>SLA</span></div></div>
            </div>
            <div className="sa-claim__seal" aria-hidden="true"><span><CheckmarkFilled size={44} /></span><b>Compliant</b><small>as reported by the entity</small></div>
          </div>}
          right={<div className="sa-record"><StoryRecord id={s} entity={story.entity} /></div>} />
      </Reveal>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bento: what it finds and why it can be trusted
// ---------------------------------------------------------------------------
function Bento({ meta, V, blind, ledger }: { meta: any; V: any; blind: any; ledger: any }) {
  const { p } = useTheme();
  const num = (id: string) => [id.replace(/\d+$/, ""), Number(id.match(/\d+$/)?.[0] ?? 0)] as const;
  const byId = (a: any, b: any) => { const [x, i] = num(a.detector_id), [y, j] = num(b.detector_id); return x.localeCompare(y) || i - j; };
  const eg = (meta?.detectors ?? []).filter((d: any) => d.family === "Execution gap").sort(byId);
  const ns = (meta?.detectors ?? []).filter((d: any) => d.family !== "Execution gap").sort(byId);
  const np = V?.V2_calibration?.null_panels || [];
  const ppi30 = V?.V3_ppi?.by_n?.find((r: any) => r.n === 30);
  const blindRows = blind ? blind.entities.filter((e: any) => blind.cells.some((c: any) => c.entity_id === e.entity_id && c.state === "blind")).slice(0, 3) : [];
  const chain = (ledger?.entries ?? []).slice(0, 4).reverse();
  return (
    <section className="sa-land-sec" aria-labelledby="bento-h">
      <Reveal className="sa-land-sechead">
        <h2 id="bento-h" className="sa-land-h2">Two kinds of weakness. One ranked, calibrated queue.</h2>
        <p className="sa-land-p">{eg.length + ns.length || "Twenty-plus"} detectors read the alerts, cases, workflow events, escalations and asset inventory entities already submit.</p>
      </Reveal>
      <div className="sa-bento">
        <Reveal className="sa-bento__a"><Glow tone="review"><div className="sa-bento__in">
          <div className="sa-bento__icon is-review"><Flag size={20} /></div>
          <h3 className="sa-land-h3">Execution gaps</h3><p className="sa-land-p">Practice that looks fine on paper but is not.</p>
          <ul className="sa-detlist">{eg.slice(0, 8).map((d: any) => <li key={d.detector_id}><span className="sa-mono">{d.detector_id}</span>{d.name}</li>)}</ul>
        </div></Glow></Reveal>
        <Reveal className="sa-bento__b" delay={0.05}><Glow tone="confirmed"><div className="sa-bento__in">
          <div className="sa-bento__icon is-confirmed"><ViewOff size={20} /></div>
          <h3 className="sa-land-h3">Negative space</h3><p className="sa-land-p">Evidence that should exist and is missing: silent assets, blind tactics, decayed rules, missing records.</p>
          {blindRows.length > 0 && <div className="sa-minimatrix" aria-label="Blind-spot matrix excerpt">
            {blindRows.map((e: any) => <div key={e.entity_id} className="sa-minimatrix__row"><span className="sa-mono">{e.entity_id}</span>
              {blind.tactics.map((t: string) => { const c = blind.cells.find((x: any) => x.entity_id === e.entity_id && x.tactic === t); return <i key={t} className={`sa-state--${c?.state}`} title={`${t}: ${c?.state}`} />; })}</div>)}
          </div>}
          <ul className="sa-detlist sa-detlist--cols">{ns.slice(0, 6).map((d: any) => <li key={d.detector_id}><span className="sa-mono">{d.detector_id}</span>{d.name}</li>)}</ul>
        </div></Glow></Reveal>
        <Reveal className="sa-bento__c" delay={0.1}><Glow><div className="sa-bento__in">
          <div className="sa-bento__icon"><Sigma size={20} /></div>
          <h3 className="sa-land-h3">Calibrated, not guessed</h3><p className="sa-land-p">Realised false alarms stay under the promise on all-healthy panels. <Synthetic /></p>
          <Chart height={150} label="Realised against promised false-alarm rate" option={{
            grid: { top: 8, left: 32, right: 4, bottom: 22 }, xAxis: { type: "category", data: np.map((r: any) => `${r.q * 100}%`) },
            yAxis: { type: "value", max: 0.25, splitNumber: 2, axisLabel: { formatter: (x: number) => `${Math.round(x * 100)}%` } },
            series: [{ type: "line", data: np.map((r: any) => r.q), symbol: "none", lineStyle: { type: "dashed", color: p.helper } }, { type: "bar", barWidth: 22, data: np.map((r: any) => r.realized_fdr), itemStyle: { color: p.accent } }],
          }} />
        </div></Glow></Reveal>
        <Reveal className="sa-bento__d" delay={0.15}><Glow tone="ai"><div className="sa-bento__in">
          <div className="sa-bento__icon is-ai"><Microscope size={20} /></div>
          <h3 className="sa-land-h3">Examiners label less</h3><p className="sa-land-p">Prediction-powered inference: {ppi30 ? <b>{pct(ppi30.label_saving)} fewer labels</b> : "fewer labels"} for the same confidence. <Synthetic /></p>
          <div className="sa-miniCI"><span>manual</span><i className="is-n" /><span>SAT-SA</span><i className="is-a" /></div>
        </div></Glow></Reveal>
        <Reveal className="sa-bento__e" delay={0.2}><Glow tone="ok"><div className="sa-bento__in">
          <div className="sa-bento__icon is-ok"><Blockchain size={20} /></div>
          <h3 className="sa-land-h3">Tamper-evident decisions</h3><p className="sa-land-p">Every verdict sealed in a SHA-256 hash chain.</p>
          <div className="sa-minichain">{chain.map((e: any) => <span key={e.seq}><b>#{e.seq}</b><small className="sa-mono">{e.hash.slice(0, 6)}</small></span>)}</div>
        </div></Glow></Reveal>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// How it works: sticky visual + scrolling steps
// ---------------------------------------------------------------------------
const STEPS = [
  { icon: DocumentImport, t: "Ingest", d: "A periodic submission arrives as CSV, JSON, Parquet or SQLite. It is validated with row-level errors and fingerprinted in the ledger.", v: ["alerts.csv", "cases.jsonl", "workflow.sqlite", "assets.parquet"] },
  { icon: Flag, t: "Detect", d: "Detectors compare each entity with its peers and with its own case mix: fast closures, missing escalation, copy-paste notes, SLA bunching, blind tactics, silent assets.", v: ["EG2", "EG6", "EG3", "NS1", "NS3", "NS5"] },
  { icon: Sigma, t: "Calibrate", d: "Every statistical flag carries a calibrated p-value. Results are combined per entity and held to a false-alarm budget the examiner chooses.", v: ["p-value", "ACAT", "BH q", "FDR 10%"] },
  { icon: Microscope, t: "Review", d: "Examiners label a blind-first random sample. Prediction-powered inference turns a few labels into a valid interval on the true weakness rate.", v: ["blind-first", "PPI++", "90% interval"] },
  { icon: Scales, t: "Decide", d: "The examiner accepts, dismisses or escalates. A local AI may explain, never decide. Each decision is sealed in the hash-chained ledger.", v: ["accept", "dismiss", "escalate"] },
];
function HowItWorks() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i)); }), { rootMargin: "-45% 0px -45% 0px" });
    refs.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, []);
  const S = STEPS[active];
  return (
    <section className="sa-land-sec" aria-labelledby="how-h">
      <Reveal className="sa-land-sechead"><h2 id="how-h" className="sa-land-h2">From submission to signed decision.</h2></Reveal>
      <div className="sa-how">
        <div className="sa-how__stick">
          <div className="sa-how__panel">
            <div className="sa-how__rail">{STEPS.map((s, i) => <span key={s.t} className={i <= active ? "is-on" : ""} />)}</div>
            <AnimatePresence mode="wait">
              <motion.div key={active} className="sa-how__visual" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.4, ease }}>
                <span className="sa-how__big"><S.icon size={32} /></span>
                <b className="sa-how__step">{active + 1} / {STEPS.length} · {S.t}</b>
                <div className="sa-how__chips">{S.v.map((c, i) => <motion.span key={c} className="sa-chip" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.07 }}>{c}</motion.span>)}</div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <div className="sa-how__steps">
          {STEPS.map((s, i) => (
            <div key={s.t} ref={(el) => { refs.current[i] = el; }} data-i={i} className={`sa-how__item ${i === active ? "is-active" : ""}`}>
              <span className="sa-how__n"><s.icon size={18} /></span>
              <h3 className="sa-land-h3">{s.t}</h3>
              <p className="sa-land-p">{s.d}</p>
            </div>))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Red-team teaser, real-data band, product tour, principles, FAQ, CTA
// ---------------------------------------------------------------------------
function RedTeamTeaser({ m }: { m: any }) {
  if (!m) return null;
  const rate = (s: string, pol: string) => Math.round(100 * (m.cells.find((c: any) => c.strategy === s && c.policy === pol)?.detection_rate ?? 0));
  const strat = m.strategies.filter((s: string) => s !== "honest");
  const band = (v: number) => (v >= 90 ? "b5" : v >= 60 ? "b4" : v >= 30 ? "b3" : v >= 10 ? "b2" : "b1");
  const POL: Record<string, string> = { annual_audit: "Annual", quarterly_audit: "Quarterly", unannounced: "Unannounced", satsa_analytics: "SAT-SA", satsa_with_floor: "SAT-SA + floor" };
  return (
    <section className="sa-land-sec sa-land-rt" aria-labelledby="rt-h">
      <Reveal className="sa-land-rt__text">
        <h2 id="rt-h" className="sa-land-h2">Can a SOC game its regulator?</h2>
        <p className="sa-land-p">The Red-Team Lab pits {strat.length} gaming strategies against {m.policies.length} audit policies with the same review budget. Fixed schedules are gamed. Analytics on every submission, plus a small random review floor, sharply reduce what gaming can hide.</p>
        <Btn kind="secondary" to="/redteam-lab" icon={ArrowRight}>Open the Red-Team Lab</Btn>
        <Badge kind="review">synthetic simulation</Badge>
      </Reveal>
      <Reveal delay={0.1}>
        <div className="sa-land-rt__heat" style={{ gridTemplateColumns: `8rem repeat(${m.policies.length}, minmax(0, 1fr))` }}>
          <span />{m.policies.map((p: string) => <span key={p} className="sa-land-rt__col">{POL[p] ?? p}</span>)}
          {strat.map((s: string) => (
            <div key={s} style={{ display: "contents" }}>
              <span className="sa-land-rt__row">{s.replace(/_/g, " ")}</span>
              {m.policies.map((p: string) => { const v = rate(s, p); return <span key={p} className={`sa-heat__cell ${band(v)}`}>{v}%</span>; })}
            </div>))}
        </div>
      </Reveal>
    </section>
  );
}

function RealBand({ G, V }: { G: any; V: any }) {
  const r5 = G?.R5_expert_priority?.rows || [];
  const p10 = (s: string) => r5.find((r: any) => r.strategy === s && r.budget === 10)?.precision;
  const r1 = G?.R1_null_calibration;
  const at10 = V?.V2_calibration?.null_panels?.find((r: any) => Math.abs(r.q - 0.1) < 1e-9);
  if (!G) return null;
  return (
    <section className="sa-land-real" aria-labelledby="real-h">
      <Reveal className="sa-land-real__head">
        <div><h2 id="real-h" className="sa-land-h2">Checked where the truth is known.</h2>
          <p className="sa-land-p">Synthetic panels carry a hidden answer key. Microsoft GUIDE adds real SOC incidents with analyst verdicts and expert priority labels.</p></div>
        <Btn kind="secondary" to="/validation?tab=real" icon={ArrowRight}>See the validation</Btn>
      </Reveal>
      <div className="sa-land-real__grid">
        <Reveal><div className="sa-land-real__num"><CountUp value={G.dataset?.orgs} /><span>real organisations in the GUIDE validation</span><Real /></div></Reveal>
        <Reveal delay={0.06}><div className="sa-land-real__num"><CountUp value={p10("satsa_learned_from_examiners") != null ? p10("satsa_learned_from_examiners") * 100 : null} suffix="%" /><span>of the first 10 incidents SAT-SA surfaces are experts' top 20, against {pct(p10("random"))} at random</span><Real /></div></Reveal>
        <Reveal delay={0.12}><div className="sa-land-real__num"><CountUp value={r1?.realized_fdr?.["0.1"]?.value != null ? r1.realized_fdr["0.1"].value * 100 : null} decimals={1} suffix="%" /><span>false alarms on real organisations where nothing changed, at a 10% budget</span><Real /></div></Reveal>
        <Reveal delay={0.18}><div className="sa-land-real__num"><CountUp value={at10?.realized_fdr != null ? at10.realized_fdr * 100 : null} decimals={1} suffix="%" /><span>realised against a 10% promise on {at10?.panels ?? 40} all-healthy panels</span><Synthetic /></div></Reveal>
      </div>
    </section>
  );
}

const SHOTS = [
  { id: "queue", label: "Review queue", text: "Entities ranked for review at the false-alarm budget you choose.", dark: queueDark, light: queueLight, w: 1600, h: 1000 },
  { id: "dossier", label: "Entity dossier", text: "Every finding with its evidence, peers and the obligation it tests.", dark: dossierDark, light: dossierLight, w: 1600, h: 1000 },
  { id: "bunching", label: "Evidence drawer", text: "The records behind a flag, a verified AI explanation and the examiner's decision.", dark: bunchingDark, light: bunchingLight, w: 1600, h: 1000 },
  { id: "redteam", label: "Red-Team Lab", text: "Which audit policies a gaming SOC can beat.", dark: redteamDark, light: redteamLight, w: 1600, h: 1000 },
  { id: "guide", label: "Validation", text: "Calibration on healthy panels and results on real SOC data.", dark: guideDark, light: guideLight, w: 1600, h: 1000 },
];
function ProductTour() {
  const { mode, reduceMotion } = useTheme();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  useEffect(() => {
    if (paused || reduceMotion || !inView) return;
    const t = setTimeout(() => setI((x) => (x + 1) % SHOTS.length), 6000);
    return () => clearTimeout(t);
  }, [i, paused, reduceMotion, inView]);
  const s = SHOTS[i];
  return (
    <section className="sa-land-sec" aria-labelledby="tour-h" ref={ref} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <Reveal className="sa-land-sechead"><h2 id="tour-h" className="sa-land-h2">What an examiner sees.</h2></Reveal>
      <div className="sa-land-tour">
        <div className="sa-land-tour__tabs" role="tablist" aria-label="Screens">
          {SHOTS.map((x, k) => (
            <button key={x.id} role="tab" type="button" aria-selected={k === i} className="sa-land-tour__tab" onClick={() => { setI(k); setPaused(true); }}>
              <b>{x.label}</b><span>{x.text}</span>
              {k === i && !paused && !reduceMotion && inView && <motion.i key={`bar-${i}`} className="sa-land-tour__bar" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 6, ease: "linear" }} />}
            </button>))}
          <Pagination variant="arrows" page={i + 1} pages={SHOTS.length} onChange={(n) => { setI(n - 1); setPaused(true); }} label="Screens" />
        </div>
        <div className="sa-land-tour__frame">
          <div className="sa-land-tour__chrome" aria-hidden="true"><i /><i /><i /><span>localhost:8000</span></div>
          <AnimatePresence mode="wait">
            <motion.img key={`${s.id}-${mode}`} src={s[mode]} width={s.w} height={s.h} alt={`${s.label}: ${s.text}`} loading="lazy" decoding="async"
              initial={{ opacity: 0, scale: 1.015 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease }} />
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

const PRINCIPLES = [
  { icon: CloudOffline, t: "Offline by design", d: "Runs on a laptop CPU with no network. Fonts, charts and the optional local model ship with it." },
  { icon: DocumentView, t: "Evidence first", d: "Every flag carries record ids and the obligation it tests: SEBI CSCRF, CERT-In, RBI and CEA." },
  { icon: Scales, t: "The examiner decides", d: "Accept, dismiss or escalate. Each decision is sealed in a SHA-256 hash-chained ledger." },
  { icon: MachineLearningModel, t: "AI that cannot overrule", d: "A local model only drafts explanations. A verifier drops unsupported claims and flags injected instructions." },
];

function Faq({ V, G }: { V: any; G: any }) {
  const [open, setOpen] = useState<number | null>(0);
  const at10 = V?.V2_calibration?.null_panels?.find((r: any) => Math.abs(r.q - 0.1) < 1e-9);
  const orgs = G?.dataset?.orgs?.toLocaleString("en-IN") ?? "6,115";
  const qa: [string, string][] = [
    ["Does SAT-SA decide that an entity is non-compliant?", "No. It flags entities for examiner review, with the evidence records and the obligation each finding tests. The examiner accepts, dismisses or escalates, and every decision is sealed in the audit ledger."],
    ["What does the false-alarm budget mean?", `It is the false-discovery rate the examiner sets. At 10%, at most about one in ten statistical flags is expected to be a false alarm. On ${at10?.panels ?? 40} all-healthy synthetic panels the realised rate was ${at10 ? pct(at10.realized_fdr, 1) : "5%"} at a 10% promise.`],
    ["Is any of this real data?", `The demo panel is synthetic, seeded with known weaknesses so every result can be checked. The method is also validated on Microsoft GUIDE: real incidents from ${orgs} organisations with analyst verdicts and expert priority labels. Every number is badged synthetic or real.`],
    ["Does it need the internet or a cloud AI?", "No. It runs on a laptop CPU with no network access. The optional language model runs locally, and core findings never depend on it."],
    ["What does the AI do, and can it be manipulated?", "It only drafts plain-language explanations. A deterministic verifier drops any claim that does not quote the evidence, and notes containing instructions aimed at an AI are flagged as tampering and never followed."],
    ["Can a SOC game it?", "The Red-Team Lab simulates gaming strategies against audit policies. Fixed audit schedules are gamed; analytics on every submission plus a small random review floor sharply reduce what gaming can hide."],
  ];
  return (
    <section className="sa-land-sec sa-land-faq" aria-labelledby="faq-h">
      <Reveal className="sa-land-sechead"><h2 id="faq-h" className="sa-land-h2">Questions examiners ask.</h2></Reveal>
      <div className="sa-faq">
        {qa.map(([q, a], i) => (
          <div key={q} className={`sa-faq__item ${open === i ? "is-open" : ""}`}>
            <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}><span>{q}</span><ChevronDown size={18} /></button>
            <AnimatePresence initial={false}>
              {open === i && <motion.div className="sa-faq__a" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }}><p>{a}</p></motion.div>}
            </AnimatePresence>
          </div>))}
      </div>
    </section>
  );
}

export default function OverviewPage() {
  const { p, mode, reduceMotion } = useTheme();
  const { open } = useTour();
  const meta = useData(() => api.meta(), []);
  const v = useData(() => api.validation(), []);
  const g = useData(() => api.guide(), []);
  const blind = useData(() => api.blindspot(), []);
  const ledger = useData(() => api.ledger(), []);
  const gaming = useData(() => api.gaming(), []);
  const V = v.data?.available === false ? null : v.data;
  const G = g.data?.available === false ? null : g.data;
  const r5 = G?.R5_expert_priority?.rows || [];
  const p10 = (s: string) => r5.find((r: any) => r.strategy === s && r.budget === 10)?.precision;
  const at10 = V?.V2_calibration?.null_panels?.find((r: any) => Math.abs(r.q - 0.1) < 1e-9);
  const ppi30 = V?.V3_ppi?.by_n?.find((r: any) => r.n === 30);
  useEffect(() => { document.title = "SAT-SA · Supervisory Analytics Tool for SOC Assessment"; }, []);
  return (
    <div className="sa-land">
      <div className="sa-land-navwrap">
        <CardNav brand={<Brand />} items={CARD_NAV} cta={<><ThemeToggle compact /><Btn kind="primary" size="sm" to="/" icon={ArrowRight}>Open the queue</Btn></>} />
      </div>

      <main id="main">
        <section className="sa-hero" aria-labelledby="hero-h">
          <div className="sa-hero__radar"><Radar color={p.accent} backgroundColor={p.bg} lightMode={mode === "light"} brightness={mode === "light" ? 0.55 : 0.8} scale={0.55} ringCount={9} spokeCount={12} sweepSpeed={0.8} speed={0.6} still={reduceMotion} /></div>
          <div className="sa-hero__inner">
            <div className="sa-hero__text">
              <motion.span className="sa-hero__pill" initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                <i aria-hidden="true" />SIH 2026 · SIH26157 · for NCIIPC examiners
              </motion.span>
              <div id="hero-h"><Headline /></div>
              <motion.p className="sa-land-sub" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.6, ease }}>
                SAT-SA reads the paper trail entities already submit and ranks who to examine first, with a known false-alarm budget.
              </motion.p>
              <motion.div className="sa-hero__ctas" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.75, ease }}>
                <Btn kind="primary" size="lg" to="/" icon={ArrowRight}>Open the review queue</Btn>
                <Btn kind="secondary" size="lg" icon={PlayFilledAlt} iconLeft onClick={open}>Take the guided tour</Btn>
              </motion.div>
            </div>
            <motion.div className="sa-hero__live" initial={reduceMotion ? false : { opacity: 0, y: 30, rotateX: 8 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ duration: 0.9, delay: 0.3, ease }}>
              <LiveQueue />
            </motion.div>
          </div>
        </section>

        <section className="sa-proof" aria-label="Headline results">
          <div><b><CountUp value={at10 ? at10.realized_fdr * 100 : null} decimals={1} suffix="%" /></b><span>false alarms realised at a 10% promise</span><Synthetic /></div>
          <div><b><CountUp value={G?.dataset?.orgs} /></b><span>real organisations in validation</span><Real /></div>
          <div><b><CountUp value={p10("satsa_learned_from_examiners") != null ? p10("satsa_learned_from_examiners") * 100 : null} suffix="%" /></b><span>expert top-20 in the first 10 reviewed, against {pct(p10("random"))} random</span><Real /></div>
          <div><b><CountUp value={ppi30 ? ppi30.label_saving * 100 : null} suffix="%" /></b><span>fewer examiner labels for the same confidence</span><Synthetic /></div>
        </section>

        <ClaimVsRecord />
        <Bento meta={meta.data} V={V} blind={blind.data} ledger={ledger.data} />
        <HowItWorks />
        <RedTeamTeaser m={gaming.data} />
        <RealBand G={G} V={V} />
        <ProductTour />

        <section className="sa-land-sec" aria-labelledby="built-h">
          <Reveal className="sa-land-sechead"><h2 id="built-h" className="sa-land-h2">Built for an air-gapped regulator.</h2></Reveal>
          <div className="sa-principles">
            {PRINCIPLES.map((x, i) => (
              <Reveal key={x.t} delay={i * 0.06}><div className="sa-principle"><span><x.icon size={22} /></span><h3 className="sa-land-h3">{x.t}</h3><p className="sa-land-p">{x.d}</p></div></Reveal>))}
          </div>
        </section>

        <Faq V={V} G={G} />

        <section className="sa-cta" aria-labelledby="cta-h">
          <div className="sa-cta__radar"><Radar color={p.accent} backgroundColor={p.layer} lightMode={mode === "light"} brightness={0.6} scale={0.9} ringCount={7} spokeCount={8} still={reduceMotion} enableMouseInteraction={false} /></div>
          <div className="sa-cta__in">
            <h2 id="cta-h" className="sa-land-h2">Start with the queue.</h2>
            <p className="sa-land-p">Every flag comes with its evidence, its statistics and the examiner's final say.</p>
            <div className="sa-hero__ctas"><Btn kind="primary" size="lg" to="/" icon={ArrowRight}>Open the review queue</Btn><Btn kind="ghost" size="lg" icon={DataCheck} iconLeft to="/validation">Read the validation</Btn></div>
          </div>
        </section>
      </main>

      <footer className="sa-land-foot">
        <Brand />
        <div>
          <p>Smart India Hackathon 2026, problem statement SIH26157 (NTRO / NCIIPC).</p>
          <p>Numbers marked synthetic come from seeded panels with a hidden answer key. Numbers marked real come from Microsoft GUIDE. Flags are for examiner review; the examiner decides.</p>
        </div>
      </footer>
    </div>
  );
}
