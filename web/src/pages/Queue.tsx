import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Close, Filter, Scales, Search, Sigma, TaskView } from "@carbon/icons-react";
import { api, fmtP, type Queue, type QueueEntity } from "../api";
import { Badge, BasisTag, Btn, Empty, ErrorBox, Info, Tipped, Loading, Meter, PageHeader, Segmented, Sparkline, Tabs } from "../components/ui";
import Pagination, { paginate } from "../components/fx/Pagination";
import CountUp from "../components/fx/CountUp";

const LEVELS = [0.05, 0.1, 0.2];
const PER_PAGE = 12;
const HARD_NEGATIVES = ["BFS-04", "PWR-06"];
const GUIDE = [
  { icon: Scales, title: "Pick a false-alarm budget", text: "5%, 10% or 20%: the share of statistical flags allowed to be wrong. The queue resizes to match." },
  { icon: Sigma, title: "Read the basis", text: <>Amber <b>FDR-flagged</b> = calibrated statistics. Red <b>documented fact</b> = a deterministic finding such as a blind tactic or a missed red-team technique.</> },
  { icon: TaskView, title: "Open an entity", text: "Click a row for the dossier: every finding, its evidence records and the obligation it tests." },
];

const tone = (e: QueueEntity) => (!e.flagged ? "none" : e.flag_basis === "statistical" ? "review" : "confirmed");

export default function QueuePage() {
  const [params, setParams] = useSearchParams();
  const sector = params.get("sector") || "";
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const [fdr, setFdr] = useState(0.1);
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"flagged" | "all">("flagged");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const req = useRef(0);

  const load = useCallback(async (level: number) => {
    setFdr(level);
    const n = ++req.current;
    try {
      const d = await api.queue(level);
      if (n === req.current) { setData(d); setError(null); }
    } catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { load(0.1); }, [load]);
  useEffect(() => setPage(1), [view, sector, q, fdr]);

  const sectors = useMemo(() => {
    const m = new Map<string, { name: string; n: number; f: number }>();
    data?.entities.forEach((e) => { const s = m.get(e.sector) ?? { name: e.sector_name, n: 0, f: 0 }; s.n++; if (e.flagged) s.f++; m.set(e.sector, s); });
    return [...m.entries()].sort((a, b) => b[1].f - a[1].f || a[0].localeCompare(b[0]));
  }, [data]);

  if (error && !data) return <ErrorBox e={error} />;
  if (!data) return <Loading page label="Ranking entities" />;

  const scoped = data.entities.filter((e) => (!sector || e.sector === sector) && (!q || `${e.entity_id} ${e.entity_name}`.toLowerCase().includes(q.toLowerCase())));
  const rows = view === "flagged" ? scoped.filter((e) => e.flagged) : scoped;
  const paged = paginate(rows, page, PER_PAGE);
  const hardNeg = data.entities.filter((e) => HARD_NEGATIVES.includes(e.entity_id));
  const hardOk = hardNeg.length === 2 && hardNeg.every((e) => !e.flagged);
  const waffle = data.entities.slice().sort((a, b) => b.attention - a.attention);

  return (
    <>
      <PageHeader title="Review queue" guideKey="queue" guide={GUIDE}
        lead="Entities ranked by calibrated evidence from their own SOC paper trail. Statistical flags are held to a known false-alarm budget; documented facts are listed on their own basis." />

      <section className="sa-card sa-budget" aria-label="False-alarm budget">
        <div className="sa-budget__control">
          <span className="sa-budget__label" id="fdr-label"><Tipped text="False-alarm budget (FDR)" tip="fdr" /></span>
          <Segmented size="lg" accent label="False-alarm budget" value={fdr} onChange={(v) => load(v)} options={LEVELS.map((l) => ({ v: l, label: `${l * 100}%` }))} />
          <p className="sa-helper" style={{ margin: 0, maxWidth: "30ch" }}>The share of statistical flags allowed to be false alarms. Checked on 40 all-healthy panels.</p>
        </div>
        <div className="sa-budget__nums" aria-live="polite">
          <div className="sa-bignum sa-bignum--review"><CountUp value={data.n_flagged_statistical} /><span><Tipped text="flagged on statistical evidence" tip={{ title: "Statistical flags", text: "Entities whose combined q-value is at or below the budget. These are the flags the false-alarm budget applies to." }} /></span></div>
          <div className="sa-bignum"><CountUp value={data.expected_false_discoveries_max} decimals={1} prefix="≤ " /><span><Tipped text="of them may be false alarms" tip={{ title: "Expected false alarms", text: "The most false alarms to expect among the statistical flags: budget × number flagged. At 10% and 20 flags, about 2 at most." }} /></span></div>
          <div className="sa-bignum sa-bignum--confirmed"><CountUp value={data.n_flagged_deterministic} /><span><Tipped text="more on documented facts" tip={{ title: "Documented facts", text: "Entities flagged only by deterministic findings, such as a blind tactic, a retention gap or a missed red-team technique. They do not depend on the budget." }} /></span></div>
          <div className="sa-bignum sa-bignum--muted"><CountUp value={data.n_entities - data.n_flagged} /><span><Tipped text="not flagged" tip={{ title: "Not flagged", text: "No statistical evidence within the budget and no documented fact. It means nothing stood out this cycle, not that the SOC is certified healthy." }} /></span></div>
        </div>
        <div className="sa-waffle-wrap">
          <div className="sa-waffle" role="list" aria-label="Every entity, ordered by supervisory attention">
            {waffle.map((e, i) => (
              <motion.button key={e.entity_id} role="listitem" type="button" className={`sa-waffle__cell is-${tone(e)}`} layout={!reduce}
                transition={{ type: "spring", bounce: 0.15, duration: 0.5, delay: reduce ? 0 : i * 0.006 }}
                title={`${e.entity_id} ${e.entity_name}: ${e.flagged ? (e.flag_basis === "statistical" ? "FDR-flagged" : "documented fact") : "not flagged"}`}
                aria-label={`${e.entity_id}, ${e.flagged ? "flagged" : "not flagged"}`} onClick={() => nav(`/entity/${e.entity_id}`)}>
                <span>{e.entity_id.split("-")[1]}</span>
              </motion.button>
            ))}
          </div>
          <div className="sa-waffle__legend"><span><i className="is-review" />statistical</span><span><i className="is-confirmed" />fact</span><span><i className="is-none" />not flagged</span><Info tip={{ title: "Entity tiles", text: "Every entity as one tile, ordered by supervisory attention from the top left. Click a tile to open its dossier." }} /></div>
        </div>
      </section>
      {hardOk && <p className="sa-helper sa-hardneg">Fairness check: hard negatives <Link to="/entity/BFS-04" className="sa-mono">BFS-04</Link> (heavy SOAR use) and <Link to="/entity/PWR-06" className="sa-mono">PWR-06</Link> (very small SOC) are unusual but healthy, and stay unflagged. <Badge kind="review">synthetic</Badge><Info tip={{ title: "Hard negatives", text: "Planted entities that are healthy but look unusual. Flagging them would be a false alarm, so they check that SAT-SA does not punish a SOC just for being different." }} /></p>}

      <section className="sa-section">
        <div className="sa-toolbar">
          <Tabs label="Queue view" value={view} onChange={setView} items={[{ id: "flagged", label: "Flagged for review", count: data.entities.filter((e) => e.flagged && (!sector || e.sector === sector)).length }, { id: "all", label: "All entities", count: data.entities.filter((e) => !sector || e.sector === sector).length }]} />
          <label className="sa-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" placeholder="Find an entity (name or id)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an entity" />
          </label>
        </div>
        <div className="sa-sectorbar" role="group" aria-label="Filter by sector">
          <Filter size={16} aria-hidden="true" className="sa-muted" />
          <button type="button" className="sa-fchip" aria-pressed={!sector} onClick={() => setParams({})}>All sectors</button>
          {sectors.map(([code, s]) => (
            <button key={code} type="button" className="sa-fchip" aria-pressed={sector === code} title={s.name} onClick={() => setParams(sector === code ? {} : { sector: code })}>
              {code}<span className={s.f ? "is-hot" : ""}>{s.f}/{s.n}</span>
            </button>
          ))}
          {sector && <button type="button" className="sa-linkbtn sa-inline" onClick={() => setParams({})}><Close size={14} />Clear</button>}
          <Info tip={{ title: "Filter by sector", text: "Shows one critical sector at a time. The numbers read flagged / entities in that sector." }} />
        </div>

        <div className="sa-card sa-card--flush">
          {rows.length === 0 ? <Empty icon={Search} title="No entities match">Try another sector or clear the search.</Empty> : (
            <div className="sa-tablewrap">
              <table className="sa-t sa-t--queue">
                <thead><tr><th className="is-num">#</th><th>Entity</th><th><Tipped text="Strongest evidence" tip="strongest" /></th><th><Tipped text="Basis" tip="basis" /></th><th className="is-num"><Tipped text="q-value" tip="qvalue" /></th><th><Tipped text="Attention" tip="attention" /></th><th><Tipped text="12-month trend" tip="trend" /></th><th><span className="sa-sr">Open</span></th></tr></thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {paged.rows.map((e) => {
                      const r = e.top_reasons[0];
                      const rank = data.entities.indexOf(e) + 1;
                      return (
                        <motion.tr key={e.entity_id} className={`is-click ${HARD_NEGATIVES.includes(e.entity_id) ? "is-hardneg" : ""}`} layout={reduce ? false : "position"}
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
                          onClick={() => nav(`/entity/${e.entity_id}`)}>
                          <td className="is-num sa-muted">{rank}</td>
                          <td>
                            <div className="sa-cell-entity">
                              <Link to={`/entity/${e.entity_id}`} onClick={(ev) => ev.stopPropagation()}>{e.entity_name}</Link>
                              <small><span className="sa-mono">{e.entity_id}</span><span aria-hidden="true">·</span><span title={e.sector_name}>{e.sector}</span>{e.soc_provider !== "INHOUSE" && <><span aria-hidden="true">·</span><span>{e.soc_provider}</span></>}</small>
                            </div>
                          </td>
                          <td className="sa-evidence">
                            {r ? <>
                              <span className="sa-evidence__name"><span className="sa-mono sa-muted">{r.detector_id}</span> {r.name}</span>
                              <span className="sa-evidence__effect">{r.effect}{r.p_value != null && <span className="sa-mono"> · p {fmtP(r.p_value)}</span>}
                                {e.top_reasons.length > 1 && <span className="sa-more" title={e.top_reasons.slice(1).map((x) => `${x.detector_id} ${x.name}: ${x.effect}`).join("\n")}>+{e.top_reasons.length - 1} more</span>}</span>
                            </> : <span className="sa-helper">No findings</span>}
                          </td>
                          <td><BasisTag basis={e.flag_basis} /></td>
                          <td className="is-num sa-mono">{fmtP(e.q_value)}</td>
                          <td><Meter v={e.attention} basis={e.flag_basis} /></td>
                          <td className={`sa-trend is-${tone(e)}`}><Sparkline data={e.sparkline} /></td>
                          <td className="sa-rowgo"><ArrowRight size={16} aria-hidden="true" /></td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
          {paged.pages > 1 && <div className="sa-tablefoot"><Pagination page={paged.page} pages={paged.pages} onChange={setPage} total={rows.length} perPage={PER_PAGE} label="Queue pages" /></div>}
        </div>
      </section>
      {error && <ErrorBox e={error} title="The last budget change did not load" />}
      <div className="sa-queue-cta"><Btn kind="ghost" size="sm" to="/sectors" icon={ArrowRight}>See the sector view</Btn></div>
    </>
  );
}
