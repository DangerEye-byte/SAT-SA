import { useState } from "react";
import { ArrowRight, CheckmarkFilled, MachineLearningModel, Misuse, Rule, WarningAltFilled } from "@carbon/icons-react";
import { TextInput } from "@carbon/react";
import { api, fmtP, pEq, pct } from "../api";
import type { Finding } from "../api";
import { useData } from "../hooks";
import { useTheme } from "../theme";
import { useToast } from "./fx/toast";
import { Badge, Btn, Callout, Chart, ErrorBox, Figure, Hold, Info, Tipped, LatticeLoader, Loading, SidePanel } from "./ui";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function BunchingChart({ c }: { c: any }) {
  const { p } = useTheme();
  return (
    <Figure tip="bunching" title={`${Math.round(c.excess)} extra closures squeezed just under the ${c.sla}-min SLA`}
      note={c.excess_ci90 && `Bootstrap 90% interval for the excess: ${c.excess_ci90.map((x: number) => x.toFixed(0)).join(" to ")} cases.`}>
      <Chart height={300} label="Closure-time histogram with the counterfactual curve" option={{
        tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { top: 36, left: 48, right: 16, bottom: 40 },
        xAxis: { type: "category", data: c.bins.map((b: number) => b.toFixed(0)), name: "minutes to close", nameLocation: "middle", nameGap: 26 },
        yAxis: { type: "value", name: "cases" },
        series: [
          { name: "Observed", type: "bar", barCategoryGap: "12%", data: c.observed.map((v: number, i: number) => ({
            value: v, itemStyle: { color: c.bins[i] >= c.window[0] && c.bins[i] < c.sla ? p.confirmed : p.neutral1 } })) },
          { name: "Counterfactual (no gaming)", type: "line", data: c.counterfactual, smooth: true, symbol: "none", lineStyle: { color: p.ok, width: 2.5 }, itemStyle: { color: p.ok } },
        ],
      }} />
    </Figure>
  );
}

function DecayChart({ series, effect }: { series: Record<string, number[]>; effect?: string }) {
  const { p } = useTheme();
  return (
    <Figure tip="decay" title={effect ? cap(effect) : "Monthly alerts from the affected detection rule(s)"} sub="Monthly alerts from the affected detection rule(s).">
      <Chart height={240} label="Monthly alerts per affected rule" option={{
        tooltip: { trigger: "axis" }, grid: { top: 16, left: 48, right: 16, bottom: 28 },
        xAxis: { type: "category", data: Array.from({ length: 12 }, (_, i) => `M${i + 1}`) }, yAxis: { type: "value" },
        series: Object.entries(series).map(([k, v]) => ({ name: k, type: "line", smooth: 0.2, data: v, lineStyle: { color: p.review, width: 2 }, itemStyle: { color: p.review },
          areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: p.review + "40" }, { offset: 1, color: p.review + "00" }] } } })),
      }} />
    </Figure>
  );
}

function TwinChart({ t, effect }: { t: any; effect?: string }) {
  const { p } = useTheme();
  const m = t.actual.map((_: number, i: number) => `M${i + 1}`);
  return (
    <Figure tip="twin" title={effect ? cap(effect) : "Entity against its synthetic twin"}
      sub="Entity against its synthetic twin (share of likely-superficial cases). Shaded: the fit period.">
      <Chart height={260} label="Entity against its synthetic twin by month" option={{
        tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { top: 36, left: 48, right: 16, bottom: 28 },
        xAxis: { type: "category", data: m }, yAxis: { type: "value", axisLabel: { formatter: (x: number) => `${(x * 100).toFixed(0)}%` } },
        series: [
          { name: "Entity", type: "line", data: t.actual, lineStyle: { color: p.confirmed, width: 2.5 }, itemStyle: { color: p.confirmed } },
          { name: "Synthetic twin", type: "line", data: t.twin, lineStyle: { color: p.ok, type: "dashed" }, itemStyle: { color: p.ok },
            markArea: { itemStyle: { color: p.layer2, opacity: 0.6 }, data: [[{ xAxis: "M1" }, { xAxis: "M6" }]] } },
          { name: "Placebo band (5-95%)", type: "line", data: t.twin.map((v: number, i: number) => v + t.placebo_band[1][i]), lineStyle: { opacity: 0 },
            areaStyle: { color: p.ok, opacity: 0.08 }, symbol: "none" },
        ],
      }} />
    </Figure>
  );
}

function Disposition({ f }: { f: any }) {
  const toast = useToast();
  const [d, setD] = useState<any>(f.disposition || { status: "open" });
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (status: string) => {
    if (status === "dismissed" && !reason.trim()) { setErr("400 A reason is required to dismiss a finding."); return; }
    setBusy(true);
    try {
      setErr(null);
      const r = await api.setDisposition(f.entity_id, f.detector_id, status, reason);
      setD(r);
      toast({ kind: status === "escalated" ? "warn" : "ok", title: `${f.detector_id} ${status} for ${f.entity_id}`, description: r.ledger_hash ? `Sealed in the audit ledger, hash ${r.ledger_hash.slice(0, 12)}…` : "Written to the audit ledger." });
    } catch (x) { setErr(String(x)); } finally { setBusy(false); }
  };
  const tone = d.status === "accepted" ? "ok" : d.status === "escalated" ? "confirmed" : d.status === "dismissed" ? "neutral" : "review";
  return (
    <section className="sa-block sa-decide" aria-label="Examiner disposition">
      <div className="sa-row"><h3 className="sa-h3"><Tipped text="Examiner decision" tip="disposition" /></h3><Badge kind={tone as any} dot>{d.status}</Badge>
        {d.ledger_hash && <span className="sa-mono sa-helper">ledger {d.ledger_hash.slice(0, 12)}…</span>}</div>
      {d.reason && <p className="sa-body">Reason: {d.reason}</p>}
      <TextInput id={`reason-${f.detector_id}`} labelText="Reason (required to dismiss)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. compensating control documented in the submission" />
      <div className="sa-btns">
        <Btn kind="ok" icon={CheckmarkFilled} iconLeft disabled={busy} onClick={() => act("accepted")}>Accept finding</Btn>
        <Btn kind="secondary" disabled={busy} onClick={() => act("dismissed")}>Dismiss</Btn>
        <Hold tone="confirmed" done="Escalated" disabled={busy} onHold={() => act("escalated")}>Hold to escalate</Hold>
      </div>
      {err && <ErrorBox e={err} title="The decision was not recorded" />}
      <p className="sa-helper" style={{ margin: 0 }}>Every decision is appended to the hash-chained audit ledger. SAT-SA flags; the examiner decides.</p>
    </section>
  );
}

function Explain({ f }: { f: any }) {
  const { p } = useTheme();
  const toast = useToast();
  const [x, setX] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (refresh = false) => {
    setBusy(true); setErr(null);
    try {
      const r = await api.explain(f.entity_id, f.detector_id, refresh);
      setX(r);
      if (r.untrusted_instruction_like_notes?.length) toast({ kind: "warn", title: "Prompt injection detected in the evidence", description: "Shown as data. The model was never allowed to follow it." });
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  return (
    <section className="sa-block sa-explain" aria-label="Plain-language explanation">
      <div className="sa-row">
        <h3 className="sa-h3 sa-inline"><MachineLearningModel size={16} className="sa-ai" /><Tipped text=" Plain-language explanation" tip="explain" /></h3>
        <Badge kind="ai">local AI, verified</Badge>
        <span className="sa-spacer" />
        {busy ? <LatticeLoader label="Generating on CPU" pattern="spiral" color={p.ai} glow cellSize={5} gap={2} fontSize={13} />
          : !x ? <Btn kind="secondary" onClick={() => run()}>Explain this finding</Btn>
            : <Btn kind="ghost" size="sm" onClick={() => run(true)}>Regenerate</Btn>}
      </div>
      {!x && !busy && <p className="sa-helper" style={{ margin: 0 }}>Runs offline on this machine. Cached explanations return at once; a fresh one takes one to two minutes on CPU. Core findings never depend on it.</p>}
      {err && <ErrorBox e={err} title="No explanation was produced" />}
      {x && <>
        <p className="sa-helper" style={{ margin: 0 }}>{x.mode === "local_model" ? `${x.model}, ${x.seconds}s, offline` : "Template (local model not installed)"}{x.cached && ", cached"}</p>
        {x.untrusted_instruction_like_notes?.length > 0 && (
          <Callout kind="ai" icon={WarningAltFilled} title={`${x.untrusted_instruction_like_notes.length} evidence note(s) contain instructions aimed at an AI reviewer`}>Shown as data and flagged as a tampering signal. Never followed.</Callout>)}
        {x.summary && <p className="sa-body" style={{ color: "var(--sa-text)" }}>{x.summary}</p>}
        <ul className="sa-claims">
          {x.verified_claims.map((c: any, i: number) => (
            <li key={i}><CheckmarkFilled size={16} className="sa-ok" aria-label="verified" />
              <span>{c.text} <span className="sa-mono sa-muted">[{c.record_ids.join(", ")}] “{c.quote}”</span></span></li>))}
        </ul>
        {x.rejected_claims.length > 0 && <details className="sa-details">
          <summary>{x.rejected_claims.length} claim(s) rejected by the verifier</summary>
          <ul className="sa-claims" style={{ marginTop: "0.5rem" }}>
            {x.rejected_claims.map((c: any, i: number) => (
              <li key={i} className="sa-muted"><Misuse size={16} className="sa-confirmed" aria-label="rejected" />
                <span>{c.text}: <i>{c.rejected_because}</i></span></li>))}
          </ul></details>}
        {x.question_for_entity && <p className="sa-body"><b>Question for the entity:</b> {x.question_for_entity}</p>}
        <p className="sa-helper" style={{ margin: 0 }}>{x.policy}</p>
      </>}
    </section>
  );
}

function Records({ f, onCase }: { f: Finding; onCase: (id: string) => void }) {
  const recs = f.records || [];
  if (!recs.length) return <p className="sa-helper">No record-level evidence for this finding.</p>;
  if (f.evidence_type === "case")
    return (
      <div className="sa-card sa-card--flush"><div className="sa-tablewrap">
        <table className="sa-t sa-t--sm">
          <thead><tr><th>Case</th><th>Severity</th><th>Type</th><th className="is-num">Closed (min)</th><th>Escalated</th><th className="is-num"><Tipped text="Steps" tip="steps" /></th><th>Note</th></tr></thead>
          <tbody>{recs.map((r) => (
            <tr key={r.case_id} className="is-click" onClick={() => onCase(r.case_id)}>
              <td><button type="button" className="sa-linkbtn sa-mono" onClick={(e) => { e.stopPropagation(); onCase(r.case_id); }}>{r.case_id}</button></td>
              <td>{r.severity}</td><td>{r.category}</td>
              <td className="is-num">{r.ttc_min?.toFixed(0)}</td><td>{r.escalated ? "yes" : <span className="sa-confirmed">no</span>}</td>
              <td className="is-num">{r.n_investigate}</td>
              <td style={{ maxWidth: 300 }}>{r.injection_like && <Badge kind="ai">instruction-like text</Badge>} <span className="sa-muted">{r.notes?.slice(0, 90)}</span></td>
            </tr>))}</tbody>
        </table>
      </div></div>
    );
  const cols = Object.keys(recs[0]).slice(0, 7);
  return (
    <div className="sa-card sa-card--flush"><div className="sa-tablewrap">
      <table className="sa-t sa-t--sm">
        <thead><tr>{cols.map((k) => <th key={k}>{k.replace(/_/g, " ")}</th>)}</tr></thead>
        <tbody>{recs.map((r, i) => <tr key={i}>{cols.map((k) => <td key={k} className="sa-mono">{String(r[k] ?? "")}</td>)}</tr>)}</tbody>
      </table>
    </div></div>
  );
}

export function FindingDrawer({ entityId, detector, onClose, onCase }: { entityId: string; detector: string; onClose: () => void; onCase: (id: string) => void }) {
  const { data: f, error } = useData(() => api.finding(entityId, detector), [entityId, detector]);
  const subtitle = f && (
    <div className="sa-tags">
      <span className="sa-chip">{f.entity_id} · {f.detector_id}</span>
      <Badge kind="neutral">{f.family}</Badge><Badge kind="neutral">{f.capability}</Badge>
      {f.deterministic ? <Badge kind="confirmed" dot>documented fact ({f.severity})</Badge> : <Badge kind="review" dot>{pEq(f.p_value)}</Badge>}<Info tip={f.deterministic ? "basis" : "pvalue"} />
    </div>
  );
  return (
    <SidePanel title={f?.name ?? detector} subtitle={subtitle} onClose={onClose}>
      {error && <ErrorBox e={error} />}
      {!f ? <Loading label="Loading the evidence" /> : (
        <>
          <div className="sa-lede">
            <p>{f.reason}</p>
            {f.rate != null && f.peer_rate != null && (
              <div className="sa-vs" aria-label={`Entity ${pct(f.rate)} against peer median ${pct(f.peer_rate)}`}>
                <div><span>This entity</span><b className="sa-confirmed">{pct(f.rate)}</b><i style={{ inlineSize: `${Math.min(100, f.rate * 100)}%` }} className="is-bad" /></div>
                <div><span><Tipped text="Peer median" tip={{ title: "Peer median", text: "The median rate among this entity's peers for the same measure. The gap between the two bars is what the finding tests." }} /></span><b>{pct(f.peer_rate)}</b><i style={{ inlineSize: `${Math.min(100, f.peer_rate * 100)}%` }} /></div>
              </div>)}
          </div>
          {f.extra?.chart && <BunchingChart c={f.extra.chart} />}
          {f.extra?.twin && <TwinChart t={f.extra.twin} effect={f.effect} />}
          {f.extra?.series && Object.keys(f.extra.series).length > 0 && <DecayChart series={f.extra.series} effect={f.effect} />}
          <Disposition f={f} />
          <Explain f={f} />
          {f.extra?.clusters && (
            <section className="sa-block">
              <h3 className="sa-h3"><Tipped text="Repeated note templates" tip="templates" /></h3>
              {f.extra.clusters.map((c: any, i: number) => (
                <div key={i} className="sa-template"><Badge kind="review">{c.count}×</Badge><p className="sa-note">{c.example}</p></div>
              ))}
            </section>
          )}
          {f.extra?.funnel && (
            <section className="sa-block">
              <h3 className="sa-h3"><Tipped text="Red-team detection funnel" tip="redteamRecon" /></h3>
              <div className="sa-stats">{Object.entries(f.extra.funnel).map(([k, v]) => <div key={k} className="sa-stat"><div className="sa-stat__value">{String(v)}</div><div className="sa-stat__label">{k}</div></div>)}</div>
            </section>
          )}
          {f.extra?.restore_with && (
            <section className="sa-block">
              <h3 className="sa-h3"><Tipped text="What would restore visibility" tip={{ title: "Restoring visibility", text: "For each blind tactic, the log sources that would let this entity see it. A concrete remediation to ask the entity about." }} /></h3>
              <dl className="sa-kv">{Object.entries(f.extra.restore_with).map(([t, s]: any) => <div key={t} style={{ display: "contents" }}><dt>{t}</dt><dd className="sa-chips">{s.map((x: string) => <span key={x} className="sa-chip">{x}</span>)}</dd></div>)}</dl>
            </section>
          )}
          {f.extra?.violations && (
            <section className="sa-block">
              <h3 className="sa-h3"><Tipped text="Workflow rules broken" tip={{ title: "Workflow rules", text: "Counts of cases whose recorded workflow broke a required order or step of the SOC process, found by conformance checking against the expected process." }} /></h3>
              <dl className="sa-kv">{Object.entries(f.extra.violations).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k.replace(/_/g, " ")}</dt><dd className="sa-num"><b>{String(v)}</b></dd></div>)}</dl>
            </section>
          )}
          {f.extra?.assets && (
            <section className="sa-block">
              <h3 className="sa-h3"><Tipped text="Critical assets: observed against expected (last quarter)" tip={{ title: "Silent critical assets", text: "Critical assets that sent far fewer alerts last quarter than peers and their own earlier months predict. A zero (in red) from a critical asset means it went silent." }} /></h3>
              <div className="sa-card sa-card--flush"><div className="sa-tablewrap">
                <table className="sa-t sa-t--sm">
                  <thead><tr><th>Asset</th><th>Class</th><th className="is-num">Observed</th><th className="is-num">Expected (peers)</th><th className="is-num">Earlier in year</th><th className="is-num">p</th></tr></thead>
                  <tbody>{f.extra.assets.slice(0, 8).map((a: any) => (
                    <tr key={a.asset_id}><td className="sa-mono">{a.asset_id}</td><td>{a.asset_class}</td>
                      <td className={`is-num ${a.obs_quarter === 0 ? "sa-confirmed" : ""}`}>{a.obs_quarter}</td>
                      <td className="is-num">{a.expected_quarter}</td><td className="is-num">{a.obs_prior}</td><td className="is-num sa-mono">{fmtP(a.p)}</td></tr>))}</tbody>
                </table>
              </div></div>
            </section>
          )}
          <section className="sa-block" data-tour="records">
            <h3 className="sa-h3"><Tipped text="Evidence records"tip="records" /></h3>
            <Records f={f} onCase={onCase} />
          </section>
          <section className="sa-block">
            <h3 className="sa-h3"><Tipped text="Method" tip="method" /></h3>
            <p className="sa-body">{f.method}</p>
            <h3 className="sa-h3 sa-inline"><Rule size={16} /><Tipped text=" Obligations this tests" tip="regulatory" /></h3>
            <ul className="sa-list">{f.regulations.map((r) => <li key={r}>{r}</li>)}</ul>
          </section>
        </>
      )}
    </SidePanel>
  );
}

export function CaseDrawer({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const { data: c, error } = useData(() => api.caseDetail(caseId), [caseId]);
  const subtitle = c && (
    <div className="sa-tags">
      <Badge kind="neutral">{c.severity}</Badge><Badge kind="neutral">{c.category}</Badge><Badge kind="neutral">{c.disposition}</Badge>
      {c.auto_closed && <Badge kind="ok">SOAR playbook</Badge>}
      <span className="sa-helper">closed in <b>{c.ttc_min?.toFixed(0)} min</b>; faster than peers: {pEq(c.p_fast)}<Info tip={{ title: "Faster than peers", text: "How unusual this closure time is against peers' cases of the same severity and category (a conformal p-value, leaving this entity out). Small means implausibly fast." }} /></span>
    </div>
  );
  return (
    <SidePanel nested title={<span className="sa-mono" style={{ fontSize: "1.125rem" }}>{caseId}</span>} subtitle={subtitle} onClose={onClose}>
      {error && <ErrorBox e={error} />}
      {!c ? <Loading label="Loading the case" /> : (
        <>
          {c.violations.length > 0 && <Callout kind="confirmed" title="Workflow rules broken">{c.violations.map((v: string) => v.replace(/_/g, " ")).join(", ")}</Callout>}
          <section className="sa-block">
            <h3 className="sa-h3"><Tipped text="Workflow timeline" tip={{ title: "Workflow timeline", text: "Every workflow event recorded for this case, in order, with who did it. Gaps and missing steps are what the execution-gap detectors look for." }} /></h3>
            <ol className="sa-timeline">{c.events.map((e: any, i: number) => <li key={i}><span className="sa-mono sa-muted">{e.ts.slice(0, 16).replace("T", " ")}</span> <b>{e.activity}</b> <span className="sa-muted">{e.actor}</span></li>)}</ol>
          </section>
          {c.escalations.length > 0 && <section className="sa-block">
            <h3 className="sa-h3">Escalations and reports</h3>
            <ul className="sa-timeline">{c.escalations.map((e: any, i: number) => <li key={i}><span className="sa-mono">{e.ts.slice(0, 16).replace("T", " ")}</span> <ArrowRight size={14} aria-label="to" /> {e.to_level}</li>)}</ul>
          </section>}
          <section className="sa-block">
            <h3 className="sa-h3">Analyst note</h3>
            {c.injection_like && <Callout kind="ai" title="Instruction-like text aimed at an AI reviewer">Treated as data and flagged as a tampering signal.</Callout>}
            <p className="sa-note">{c.notes}</p>
          </section>
          {c.template_siblings?.length > 0 && <section className="sa-block">
            <h3 className="sa-h3"><Tipped text="Near-identical notes on other cases" tip="templates" /></h3>
            {c.template_siblings.map((s: any) => <p key={s.case_id} className="sa-note"><span className="sa-muted">{s.case_id}: </span>{s.notes}</p>)}
          </section>}
        </>
      )}
    </SidePanel>
  );
}
