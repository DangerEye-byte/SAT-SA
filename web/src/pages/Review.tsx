import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, CheckmarkFilled, Education, Microscope, Renew, Scales, ViewOff } from "@carbon/icons-react";
import { api, pct } from "../api";
import { Badge, Btn, Empty, ErrorBox, Info, Tipped, Loading, PageHeader, Synthetic, type TipArg } from "../components/ui";
import Pagination, { paginate } from "../components/fx/Pagination";
import { useToast } from "../components/fx/toast";
import { useData } from "../hooks";

const AXIS = 0.6; // interval axis runs 0 to 60%
const PER_PAGE = 10;
const GUIDE = [
  { icon: Microscope, title: "Draw a sample", text: "30 cases uniformly at random (the estimate uses only these) plus 10 the model rates most likely superficial." },
  { icon: ViewOff, title: "Label blind-first", text: "The model's score stays hidden until you record your verdict, so it cannot anchor your judgement." },
  { icon: Scales, title: "Watch the interval", text: "Prediction-powered inference combines your labels with the model's score on every case: a valid interval that narrows faster." },
];

function CIBar({ label, ci, tone, note, tip }: { label: string; ci: any; tone: "neutral" | "accent"; note?: string; tip?: TipArg }) {
  if (!ci) return null;
  const s = (v: number) => `${Math.min(100, (v / AXIS) * 100)}%`;
  return (
    <div className={`sa-ci sa-ci--${tone}`}>
      <div className="sa-ci__head">
        <b className="sa-inline" style={{ gap: 0 }}>{label}{tip && <Info tip={tip} />}</b>{note && <span className="sa-helper">{note}</span>}
        <span className="sa-ci__nums"><span>estimate <b>{pct(ci.estimate, 1)}</b></span><span>90% interval {pct(ci.lo, 1)} to {pct(ci.hi, 1)}</span><span>width <b>{pct(ci.width, 1)}</b><Info tip={{ title: "Interval width", text: "The gap between the two ends of the interval. Narrower means a more precise estimate from the same number of reviews." }} /></span></span>
      </div>
      <div className="sa-ci__track" role="img" aria-label={`${label}: ${pct(ci.lo, 1)} to ${pct(ci.hi, 1)}`}>
        {[0.1, 0.2, 0.3, 0.4, 0.5].map((t) => <span key={t} className="sa-ci__grid" style={{ left: s(t) }} />)}
        <i style={{ left: s(ci.lo), width: `calc(${s(ci.hi)} - ${s(ci.lo)})` }} />
        <b style={{ left: s(ci.estimate) }} />
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const { id = "BFS-02" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, setData } = useData(() => api.review(id), [id]);
  const ents = useData(() => api.queue(0.1), []);
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const run = async (p: Promise<any>, msg?: (d: any) => { title: string; description?: string }) => {
    setBusy(true); setActErr(null);
    try { const d = await p; setData(d); if (msg) toast({ kind: "ok", ...msg(d) }); } catch (e) { setActErr(String(e)); } finally { setBusy(false); }
  };
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading page label={`Opening the review lab for ${id}`} />;
  const est = data.estimate;
  const unl = data.sample.filter((s: any) => s.label == null);
  const step = data.sample.length === 0 ? 1 : est.status === "ok" ? 3 : 2;
  const paged = paginate(data.sample, page, PER_PAGE);
  const width = (x: any) => (x ? pct(x.width, 1) : "");
  return (
    <>
      <PageHeader title="Review lab" meta={<Synthetic tip />} guideKey="review" guide={GUIDE}
        lead="How many of this entity's closed cases were handled superficially? Examiners label a small random sample; prediction-powered inference turns those labels into a valid, much tighter interval."
        actions={<>
          <label className="sa-selectwrap" title="Choose the entity whose cases to review"><span className="sa-sr">Entity</span>
            <select value={id} onChange={(e) => { setPage(1); nav(`/review/${e.target.value}`); }}>
              {!(ents.data?.entities || []).some((e) => e.entity_id === id) && <option value={id}>{id}</option>}
              {(ents.data?.entities || []).map((e) => <option key={e.entity_id} value={e.entity_id}>{e.entity_id} · {e.entity_name}</option>)}
            </select>
          </label>
          <Btn kind="ghost" icon={ArrowRight} to={`/entity/${id}`}>Dossier</Btn>
        </>} />

      <ol className="sa-steps" aria-label="Review steps">
        {["Draw a sample", "Label blind-first", "Read the interval"].map((t, i) => (
          <li key={t} className={step > i + 1 ? "is-done" : step === i + 1 ? "is-now" : ""}><span>{step > i + 1 ? <CheckmarkFilled size={16} /> : i + 1}</span>{t}</li>))}
      </ol>

      <div className="sa-grid sa-grid--lead">
        <section className="sa-card sa-card--tint" aria-label="Estimate">
          <div className="sa-card__head"><div>
            <h2 className="sa-card__title"><Tipped text="Share of cases handled superficially" tip="superficial" /></h2>
            <p className="sa-card__sub">Population: <b>{est.population.toLocaleString("en-IN")}</b> closed human-handled cases. Random labels: <b>{est.n_labeled_random}</b>. Priority labels: <b>{est.n_labeled_active}</b> (never used in the estimate).</p>
          </div></div>
          <div className="sa-cis">
            <CIBar label="Manual sample only" ci={est.classical} tone="neutral" note="Wilson interval" tip="wilson" />
            {est.status === "ok" ? <CIBar label="SAT-SA prediction-powered" ci={est.ppi} tone="accent" note="PPI++" tip="ppi" />
              : <div className="sa-ci-locked"><Education size={16} /> Label <b>{est.labels_needed ?? 20}</b> more random-sample cases to unlock the prediction-powered interval.</div>}
            {est.classical && <div className="sa-ci__axis" aria-hidden="true">{[0, 10, 20, 30, 40, 50, 60].map((t) => <span key={t}>{t}%</span>)}</div>}
          </div>
          {est.status === "ok" && (
            <div className="sa-reviewwins">
              <div><b className="sa-ok">{pct(est.review_saving)}</b><span><Tipped text="fewer manual reviews for the same confidence (measured on this sample)" tip={{ title: "Reviews saved", text: "How many fewer examiner labels the prediction-powered interval needs to be as narrow as the manual-only one, measured on this sample." }} /></span></div>
              <div><b>{est.planner.reviews_with_satsa} <small>vs {est.planner.reviews_manual_only}</small></b><span><Tipped text="reviews needed for a ±3 pp interval: with SAT-SA against manual only" tip={{ title: "Review planner", text: "How many random-sample reviews it would take to pin the rate down to within 3 percentage points either way, with the model helping against labels alone." }} /></span></div>
            </div>
          )}
          <div className="sa-btns" style={{ marginTop: "1.25rem" }}>
            <Btn kind="primary" disabled={busy} onClick={() => run(api.reviewSample(id), (d) => ({ title: "Sample drawn", description: `${d.sample.length} cases: 30 uniformly random, 10 priority. Scores hidden until labelled.` }))}>Draw sample (30 random + 10 priority)</Btn>
            <Btn kind="secondary" title="Demo only: records five verdicts from the synthetic panel's hidden answer key, so the interval can be shown filling in" disabled={busy || data.sample.length === 0} onClick={() => run(api.reviewSimulate(id, 5), (d) => ({ title: "Five simulated verdicts recorded", description: d.estimate.ppi ? `PPI width now ${width(d.estimate.ppi)}; manual ${width(d.estimate.classical)}.` : `${d.estimate.labels_needed ?? "More"} random labels to unlock PPI.` }))}>Simulate examiner ×5 (demo)</Btn>
            <Btn kind="ghost" icon={Renew} iconLeft disabled={busy} onClick={() => run(api.reviewReset(id), () => ({ title: "Review reset", description: "Sample and labels cleared for this entity." }))}>Reset</Btn>
            {busy && <Loading inline label="Updating" />}
          </div>
          {actErr && <div style={{ marginTop: "1rem" }}><ErrorBox e={actErr} title="That action did not complete" /></div>}
        </section>
        <section className="sa-card" aria-label="Why this is trustworthy">
          <h2 className="sa-card__title" style={{ marginBottom: "0.875rem" }}><Tipped text="Why the interval can be trusted" tip="ppi" /></h2>
          <ul className="sa-trust">
            <li><b>Blind-first.</b> The model's score stays hidden until the examiner records a verdict (cognitive forcing, Buçinca et al., CSCW 2021).</li>
            <li><b>Valid even if the model is wrong.</b> Examiner labels correct the model's bias (Angelopoulos et al., <i>Science</i> 2023).</li>
            <li><b>Random floor.</b> The interval uses only the uniform sample, so an entity cannot predict which cases get reviewed.</li>
            <li><b>Priority sample.</b> 10 cases the model rates most likely superficial confirm weaknesses fast. Reported separately, never in the estimate.</li>
            <li><b>Audited.</b> Every verdict is written to the hash-chained ledger.</li>
          </ul>
        </section>
      </div>

      <section className="sa-section">
        <div className="sa-section__head"><h2 className="sa-h2"><Tipped text="Review sample" tip="sample" /></h2>{data.sample.length > 0 && <Badge kind={unl.length ? "review" : "ok"}>{unl.length} awaiting a verdict</Badge>}</div>
        <div className="sa-card sa-card--flush">
          {data.sample.length === 0 ? <Empty icon={Microscope} title="No sample drawn yet">Use <b>Draw sample</b> to pick 30 random and 10 priority cases.</Empty> : (
            <>
              <div className="sa-tablewrap">
                <table className="sa-t">
                  <thead><tr><th>Case</th><th><Tipped text="Sample" tip="sample" /></th><th>Severity · type</th><th className="is-num"><Tipped text="Closed in" tip={{ title: "Closed in", text: "Minutes from the case being opened to it being closed." }} /></th><th className="is-num"><Tipped text="Steps" tip="steps" /></th><th>Analyst note</th><th><Tipped text="Model score" tip="modelScore" /></th><th><Tipped text="Verdict" tip="verdict" /></th></tr></thead>
                  <tbody>{paged.rows.map((s: any) => (
                    <tr key={s.case_id}>
                      <td className="sa-mono">{s.case_id}</td>
                      <td><Badge kind={s.sample_type === "random" ? "neutral" : "ai"}>{s.sample_type}</Badge></td>
                      <td>{s.severity} · {s.category}</td><td className="is-num">{s.ttc_min?.toFixed(0)} min</td><td className="is-num">{s.n_investigate}</td>
                      <td className="sa-muted" style={{ maxWidth: 320 }}>{s.notes?.slice(0, 110)}</td>
                      <td className="sa-mono">{s.yhat == null ? <span className="sa-hidden-score"><ViewOff size={14} /> hidden</span> : s.yhat.toFixed(2)}</td>
                      <td>{s.label == null ? (
                        <div className="sa-verdict">
                          <button type="button" className="is-bad" disabled={busy} onClick={() => run(api.reviewLabel(id, s.case_id, 1), () => ({ title: `${s.case_id} labelled superficial`, description: "Score revealed; interval updated." }))}>Superficial</button>
                          <button type="button" className="is-ok" disabled={busy} onClick={() => run(api.reviewLabel(id, s.case_id, 0), () => ({ title: `${s.case_id} labelled adequate`, description: "Score revealed; interval updated." }))}>Adequate</button>
                        </div>) : <span className="sa-row" style={{ gap: "0.375rem" }}>{s.label === 1 ? <Badge kind="confirmed" dot>superficial</Badge> : <Badge kind="ok" dot>adequate</Badge>}
                          {s.reviewer === "simulated-examiner" && <span className="sa-helper">simulated</span>}</span>}
                      </td>
                    </tr>))}
                  </tbody>
                </table>
              </div>
              <div className="sa-tablefoot"><Pagination page={paged.page} pages={paged.pages} onChange={setPage} total={data.sample.length} perPage={PER_PAGE} label="Sample pages" /></div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
