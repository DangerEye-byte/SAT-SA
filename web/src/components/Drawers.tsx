import { useState } from "react";
import { api, fmtP, pct } from "../api";
import type { Finding } from "../api";
import { useData } from "../hooks";
import { Chart, ErrorBox, Loading } from "./ui";

function BunchingChart({ c }: { c: any }) {
  return (
    <Chart height={320} option={{
      title: { text: `${Math.round(c.excess)} extra closures squeezed just under the ${c.sla}-min SLA`, textStyle: { fontSize: 13, color: "#e6edf6" } },
      tooltip: { trigger: "axis" }, legend: { top: 24, textStyle: { color: "#8fa3bf" } }, grid: { top: 60, left: 45, right: 15, bottom: 35 },
      xAxis: { type: "category", data: c.bins.map((b: number) => b.toFixed(0)), name: "minutes to close", nameLocation: "middle", nameGap: 25 },
      yAxis: { type: "value", name: "cases" },
      series: [
        { name: "Observed", type: "bar", data: c.observed.map((v: number, i: number) => ({
          value: v, itemStyle: { color: c.bins[i] >= c.window[0] && c.bins[i] < c.sla ? "#f06a6a" : "#3b5b85" } })) },
        { name: "Counterfactual (no gaming)", type: "line", data: c.counterfactual, smooth: true, symbol: "none", lineStyle: { color: "#2dd4bf", width: 2 } },
      ],
    }} />
  );
}

function DecayChart({ series }: { series: Record<string, number[]> }) {
  return (
    <Chart height={260} option={{
      title: { text: "Monthly alerts from the affected detection rule(s)", textStyle: { fontSize: 13, color: "#e6edf6" } },
      tooltip: { trigger: "axis" }, grid: { top: 40, left: 45, right: 15, bottom: 30 },
      xAxis: { type: "category", data: Array.from({ length: 12 }, (_, i) => `M${i + 1}`) }, yAxis: { type: "value" },
      series: Object.entries(series).map(([k, v]) => ({ name: k, type: "line", data: v, lineStyle: { color: "#f5b544" } })),
    }} />
  );
}

function TwinChart({ t }: { t: any }) {
  const m = t.actual.map((_: number, i: number) => `M${i + 1}`);
  return (
    <Chart height={280} option={{
      title: { text: "Entity vs its synthetic twin (share of likely-superficial cases)", textStyle: { fontSize: 13, color: "#e6edf6" } },
      tooltip: { trigger: "axis" }, legend: { top: 24, textStyle: { color: "#8fa3bf" } }, grid: { top: 60, left: 45, right: 15, bottom: 30 },
      xAxis: { type: "category", data: m }, yAxis: { type: "value", axisLabel: { formatter: (x: number) => `${(x * 100).toFixed(0)}%` } },
      series: [
        { name: "Entity", type: "line", data: t.actual, lineStyle: { color: "#f06a6a", width: 2 }, itemStyle: { color: "#f06a6a" } },
        { name: "Synthetic twin", type: "line", data: t.twin, lineStyle: { color: "#2dd4bf", type: "dashed" }, itemStyle: { color: "#2dd4bf" },
          markArea: { itemStyle: { color: "rgba(143,163,191,.08)" }, data: [[{ xAxis: "M1" }, { xAxis: "M6" }]] } },
        { name: "Placebo band (5-95%)", type: "line", data: t.twin.map((v: number, i: number) => v + t.placebo_band[1][i]), lineStyle: { opacity: 0 },
          areaStyle: { color: "rgba(45,212,191,.08)" }, symbol: "none" },
      ],
    }} />
  );
}

function Disposition({ f }: { f: any }) {
  const [d, setD] = useState<any>(f.disposition || { status: "open" });
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const act = async (status: string) => {
    try { setErr(null); const r = await api.setDisposition(f.entity_id, f.detector_id, status, reason); setD(r); } catch (x) { setErr(String(x)); }
  };
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h3>Examiner disposition</h3>
      <div className="row">
        <span>Current: <b>{d.status}</b>{d.reason ? ` — ${d.reason}` : ""}</span>
        {d.ledger_hash && <span className="mono muted">ledger {d.ledger_hash.slice(0, 12)}…</span>}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required to dismiss)"
          style={{ flex: 1, background: "#0b1320", color: "#e6edf6", border: "1px solid #22324d", borderRadius: 8, padding: 8 }} />
        <button className="btn good" onClick={() => act("accepted")}>Accept</button>
        <button className="btn" onClick={() => act("dismissed")}>Dismiss</button>
        <button className="btn bad" onClick={() => act("escalated")}>Escalate</button>
      </div>
      {err && <div className="bad" style={{ marginTop: 6 }}>{err}</div>}
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Every decision is written to the hash-chained audit ledger. SAT-SA flags; the examiner decides.</div>
    </div>
  );
}

function Records({ f, onCase }: { f: Finding; onCase: (id: string) => void }) {
  const recs = f.records || [];
  if (!recs.length) return null;
  if (f.evidence_type === "case")
    return (
      <table>
        <thead><tr><th>Case</th><th>Sev</th><th>Type</th><th>Close (min)</th><th>Esc.</th><th>Invest.</th><th>Note</th></tr></thead>
        <tbody>{recs.map((r) => (
          <tr key={r.case_id} className="click" onClick={() => onCase(r.case_id)}>
            <td className="mono">{r.case_id}</td><td>{r.severity}</td><td>{r.category}</td>
            <td>{r.ttc_min?.toFixed(0)}</td><td>{r.escalated ? "yes" : <span className="bad">no</span>}</td>
            <td>{r.n_investigate}</td>
            <td style={{ maxWidth: 320 }}>{r.injection_like && <span className="pill violet">⚠ instruction-like text</span>} <span className="muted">{r.notes?.slice(0, 90)}</span></td>
          </tr>))}</tbody>
      </table>
    );
  return (
    <table>
      <thead><tr>{Object.keys(recs[0]).slice(0, 7).map((k) => <th key={k}>{k}</th>)}</tr></thead>
      <tbody>{recs.map((r, i) => <tr key={i}>{Object.values(r).slice(0, 7).map((v: any, j) => <td key={j} className="mono">{String(v ?? "")}</td>)}</tr>)}</tbody>
    </table>
  );
}

export function FindingDrawer({ entityId, detector, onClose, onCase }: { entityId: string; detector: string; onClose: () => void; onCase: (id: string) => void }) {
  const { data: f, error } = useData(() => api.finding(entityId, detector), [entityId, detector]);
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <div className="drawer">
        <div className="row"><h2 style={{ margin: 0 }}>{f?.name ?? detector}</h2><div className="spacer" /><button className="btn" onClick={onClose}>Close</button></div>
        {error && <ErrorBox e={error} />}
        {!f ? <Loading /> : (
          <>
            <div className="row" style={{ margin: "8px 0 14px" }}>
              <span className="pill gray">{f.family}</span><span className="pill gray">{f.capability}</span>
              {f.deterministic ? <span className="pill red">documented fact ({f.severity})</span> : <span className="pill amber">p = {fmtP(f.p_value)}</span>}
              {f.rate != null && <span className="muted">entity {pct(f.rate)} vs peer median {pct(f.peer_rate)}</span>}
            </div>
            <div className="card" style={{ marginBottom: 12 }}><div style={{ lineHeight: 1.55 }}>{f.reason}</div></div>
            <Disposition f={f} />
            {f.extra?.chart && <div className="card" style={{ marginBottom: 12 }}><BunchingChart c={f.extra.chart} />
              {f.extra.chart.excess_ci90 && <div className="muted" style={{ fontSize: 12 }}>Bootstrap 90% interval for the excess: {f.extra.chart.excess_ci90.map((x: number) => x.toFixed(0)).join(" – ")} cases.</div>}</div>}
            {f.extra?.twin && <div className="card" style={{ marginBottom: 12 }}><TwinChart t={f.extra.twin} /></div>}
            {f.extra?.series && Object.keys(f.extra.series).length > 0 && <div className="card" style={{ marginBottom: 12 }}><DecayChart series={f.extra.series} /></div>}
            {f.extra?.clusters && (
              <div className="card" style={{ marginBottom: 12 }}>
                <h3>Repeated note templates</h3>
                {f.extra.clusters.map((c: any, i: number) => (
                  <div key={i} style={{ marginBottom: 8 }}><span className="pill amber">{c.count}× </span> <span className="note" style={{ display: "inline-block" }}>{c.example}</span></div>
                ))}
              </div>
            )}
            {f.extra?.funnel && (
              <div className="card" style={{ marginBottom: 12 }}>
                <h3>Red-team detection funnel</h3>
                <div className="row">{Object.entries(f.extra.funnel).map(([k, v]) => <div key={k} className="kpi" style={{ marginRight: 24 }}><div className="v">{String(v)}</div><div className="l">{k}</div></div>)}</div>
              </div>
            )}
            {f.extra?.restore_with && (
              <div className="card" style={{ marginBottom: 12 }}>
                <h3>What would restore visibility</h3>
                {Object.entries(f.extra.restore_with).map(([t, s]: any) => <div key={t}><b>{t}</b>: <span className="muted">{s.join(", ")}</span></div>)}
              </div>
            )}
            {f.extra?.violations && (
              <div className="card" style={{ marginBottom: 12 }}>
                <h3>Workflow rules broken</h3>
                {Object.entries(f.extra.violations).map(([k, v]) => <div key={k}>{k.replace(/_/g, " ")}: <b>{String(v)}</b></div>)}
              </div>
            )}
            {f.extra?.assets && (
              <div className="card" style={{ marginBottom: 12 }}>
                <h3>Critical assets: observed vs expected (last quarter)</h3>
                <table><thead><tr><th>Asset</th><th>Class</th><th>Observed</th><th>Expected (peers)</th><th>Earlier in year</th><th>p</th></tr></thead>
                  <tbody>{f.extra.assets.slice(0, 8).map((a: any) => (
                    <tr key={a.asset_id}><td className="mono">{a.asset_id}</td><td>{a.asset_class}</td><td className={a.obs_quarter === 0 ? "bad" : ""}>{a.obs_quarter}</td>
                      <td>{a.expected_quarter}</td><td>{a.obs_prior}</td><td className="mono">{fmtP(a.p)}</td></tr>))}</tbody></table>
              </div>
            )}
            <div className="card" style={{ marginBottom: 12 }}><h3>Evidence records</h3><Records f={f} onCase={onCase} /></div>
            <div className="card">
              <h3>Method</h3><div className="muted" style={{ fontSize: 13 }}>{f.method}</div>
              <h3 style={{ marginTop: 12 }}>Obligations this tests</h3>
              {f.regulations.map((r) => <div key={r} style={{ fontSize: 13 }}>• {r}</div>)}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function CaseDrawer({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const { data: c, error } = useData(() => api.caseDetail(caseId), [caseId]);
  return (
    <>
      <div className="drawer-bg" onClick={onClose} style={{ zIndex: 30 }} />
      <div className="drawer" style={{ zIndex: 31, width: "min(760px, 90vw)" }}>
        <div className="row"><h2 style={{ margin: 0 }} className="mono">{caseId}</h2><div className="spacer" /><button className="btn" onClick={onClose}>Close</button></div>
        {error && <ErrorBox e={error} />}
        {!c ? <Loading /> : (
          <>
            <div className="row" style={{ margin: "10px 0" }}>
              <span className="pill gray">{c.severity}</span><span className="pill gray">{c.category}</span><span className="pill gray">{c.disposition}</span>
              <span>closed in <b>{c.ttc_min?.toFixed(0)} min</b></span>
              <span className="muted">faster than peers: p={fmtP(c.p_fast)}</span>
              {c.auto_closed && <span className="pill teal">SOAR playbook</span>}
            </div>
            {c.violations.length > 0 && <div className="card" style={{ marginBottom: 10, borderColor: "#6b2c2c" }}>
              <b className="bad">Workflow rules broken:</b> {c.violations.map((v: string) => v.replace(/_/g, " ")).join(" · ")}</div>}
            <h3>Workflow timeline</h3>
            <div className="timeline">{c.events.map((e: any, i: number) => <div key={i}><span className="mono muted">{e.ts.slice(0, 16).replace("T", " ")}</span> <b>{e.activity}</b> <span className="muted">{e.actor}</span></div>)}</div>
            {c.escalations.length > 0 && <><h3 style={{ marginTop: 12 }}>Escalations / reports</h3>
              {c.escalations.map((e: any, i: number) => <div key={i} className="mono">{e.ts.slice(0, 16).replace("T", " ")} → {e.to_level}</div>)}</>}
            <h3 style={{ marginTop: 12 }}>Analyst note {c.injection_like && <span className="pill violet">⚠ instruction-like text aimed at an AI reviewer — treated as data, flagged as tampering signal</span>}</h3>
            <div className="note">{c.notes}</div>
            {c.template_siblings?.length > 0 && <><h3 style={{ marginTop: 12 }}>Near-identical notes on other cases</h3>
              {c.template_siblings.map((s: any) => <div key={s.case_id} className="note" style={{ marginBottom: 6 }}><span className="muted">{s.case_id}: </span>{s.notes}</div>)}</>}
          </>
        )}
      </div>
    </>
  );
}
