import ReactECharts from "echarts-for-react";
import type { Reason } from "../api";
import { fmtP } from "../api";

export const Chart = ({ option, height = 280, onEvents }: { option: any; height?: number; onEvents?: Record<string, (p: any) => void> }) => (
  <ReactECharts option={{ backgroundColor: "transparent", textStyle: { color: "#c7d3e3" }, ...option }}
    style={{ height }} notMerge lazyUpdate theme="dark" onEvents={onEvents} />
);

export const Loading = () => <div className="loading">Loading…</div>;
export const ErrorBox = ({ e }: { e: string }) => <div className="err">Error: {e}</div>;

export function BasisPill({ basis }: { basis: string | null }) {
  if (!basis) return <span className="pill gray">not flagged</span>;
  if (basis === "deterministic") return <span className="pill red">documented fact</span>;
  if (basis === "both") return <span className="pill red">statistical + fact</span>;
  return <span className="pill amber">FDR-flagged</span>;
}

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {reasons.slice(0, 3).map((r) => (
        <span key={r.detector_id} style={{ fontSize: 12 }}>
          <span className="mono muted">{r.detector_id}</span> {r.name}{" "}
          <span className="muted">— {r.effect}</span>{" "}
          {r.p_value != null && <span className="mono muted">p={fmtP(r.p_value)}</span>}
        </span>
      ))}
    </div>
  );
}

export function Sparkline({ data }: { data: number[] }) {
  if (!data?.length) return null;
  const w = 90, h = 24, max = Math.max(...data, 0.01), min = Math.min(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ");
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke="#f5b544" strokeWidth="1.5" /></svg>;
}

export function Attention({ v }: { v: number }) {
  return (
    <div style={{ minWidth: 90 }}>
      <div style={{ fontWeight: 700 }}>{v.toFixed(0)}</div>
      <div className="bar"><i style={{ width: `${v}%` }} /></div>
    </div>
  );
}
