import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import ReactECharts from "echarts-for-react";
import { motion } from "motion/react";
import { Asleep, Close, Help, Light, PlayFilledAlt, WarningAltFilled } from "@carbon/icons-react";
import { CHAPTER_FOR_GUIDE } from "../tourSteps";
import type { Reason } from "../api";
import { fmtP } from "../api";
import { useTheme } from "../theme";
import { useRemScale } from "../hooks";
import BorderGlow from "./fx/BorderGlow";
import HoldButton from "./fx/HoldButton";
import LatticeLoader from "./fx/LatticeLoader";
import { Info, Tipped, type TipArg } from "./Info";
import "../charts";
export { Info, Tipped, type TipArg };

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type BtnProps = {
  kind?: "primary" | "secondary" | "ghost" | "danger" | "ok"; size?: "sm" | "md" | "lg"; icon?: ComponentType<{ size?: number }>; iconLeft?: boolean;
  to?: string; href?: string; target?: string; onClick?: () => void; disabled?: boolean; children?: ReactNode; className?: string; title?: string; label?: string; type?: "button" | "submit";
};
export function Btn({ kind = "secondary", size = "md", icon: Icon, iconLeft, to, href, target, onClick, disabled, children, className = "", title, label, type = "button" }: BtnProps) {
  const cls = `sa-btn sa-btn--${kind} sa-btn--${size} ${children ? "" : "sa-btn--icon"} ${className}`;
  const ic = Icon ? <Icon size={size === "sm" ? 16 : 16} /> : null;
  const inner = <>{iconLeft && ic}{children}{!iconLeft && ic}</>;
  if (to) return <Link to={to} className={cls} title={title} aria-label={label} aria-disabled={disabled || undefined}>{inner}</Link>;
  if (href) return <a href={href} target={target} rel={target ? "noreferrer" : undefined} className={cls} title={title} aria-label={label}>{inner}</a>;
  return <button type={type} className={cls} onClick={onClick} disabled={disabled} title={title} aria-label={label}>{inner}</button>;
}

// Press-and-hold for consequential actions (escalate, commit, tamper). Keyboard: hold Space or Enter.
export function Hold({ children, done, onHold, tone = "accent", disabled, size = "md", holdTime = 1200 }: {
  children: ReactNode; done?: ReactNode; onHold: () => void; tone?: "accent" | "confirmed" | "ok"; disabled?: boolean; size?: "sm" | "md"; holdTime?: number;
}) {
  const { p } = useTheme();
  const fill = tone === "confirmed" ? p.confirmed : tone === "ok" ? p.ok : p.accent;
  return <HoldButton className="is-outline" size={size} backgroundColor={p.layer2} fillColor={fill} textColor={tone === "accent" ? p.text : fill}
    fillTextColor={p.bg} radius={10} holdTime={holdTime} doneLabel={done ?? "Done"} onHold={onHold} disabled={disabled} resetAfter={1400}>{children}</HoldButton>;
}

// ---------------------------------------------------------------------------
// Glow card (BorderGlow on SAT-SA colours)
// ---------------------------------------------------------------------------
function hsl(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = Math.round(h * 60 + 360) % 360;
  }
  return `${h} ${Math.round(s * 100)} ${Math.round(l * 100)}`;
}
export function Glow({ children, className = "", tone = "accent", animated }: { children: ReactNode; className?: string; tone?: "accent" | "ok" | "review" | "confirmed" | "ai"; animated?: boolean }) {
  const { p, mode } = useTheme();
  const c = { accent: p.accent, ok: p.ok, review: p.review, confirmed: p.confirmed, ai: p.ai }[tone];
  return (
    <BorderGlow className={`sa-glow ${className}`} backgroundColor={p.layer} borderRadius={14} glowColor={hsl(c)} glowRadius={28}
      glowIntensity={mode === "dark" ? 0.9 : 0.6} coneSpread={22} edgeSensitivity={26} colors={[c, p.ok, p.ai]} fillOpacity={mode === "dark" ? 0.35 : 0.18} animated={animated}>
      {children}
    </BorderGlow>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
export const Chart = ({ option, height = 280, onEvents, label }: { option: any; height?: number; onEvents?: Record<string, (p: any) => void>; label?: string }) => {
  const { mode, reduceMotion } = useTheme();
  const rem = useRemScale();
  return (
    <div role="img" aria-label={label}>
      <ReactECharts option={{ animation: !reduceMotion, animationDuration: 700, animationEasing: "cubicOut", ...option }} theme={`satsa-${mode}`} opts={{ renderer: "svg" }}
        style={{ height: Math.round(height * Math.max(0.85, rem)) }} notMerge lazyUpdate onEvents={onEvents} />
    </div>
  );
};

export function Figure({ title, sub, note, tip, children }: { title: ReactNode; sub?: ReactNode; note?: ReactNode; tip?: TipArg; children: ReactNode }) {
  return (
    <figure className="sa-figure">
      <figcaption>
        <div className="sa-figure__title">{tip && typeof title === "string" ? <Tipped text={title} tip={tip} /> : <>{title}{tip && <Info tip={tip} />}</>}</div>
        {sub && <div className="sa-figure__sub">{sub}</div>}
      </figcaption>
      {children}
      {note && <div className="sa-figure__note">{note}</div>}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Loading, errors, empty
// ---------------------------------------------------------------------------
export const Loading = ({ label = "Loading", page, inline, pattern = "orbit" }: { label?: string; page?: boolean; inline?: boolean; pattern?: "orbit" | "sweep" | "spiral" | "ripple" }) => {
  const { p } = useTheme();
  return (
    <div className={`sa-loading ${page ? "sa-loading--page" : ""} ${inline ? "sa-loading--inline" : ""}`} aria-busy="true">
      <LatticeLoader label={label} pattern={pattern} grid={pattern === "sweep" ? 4 : 3} cellSize={page ? 7 : 6} gap={3} fontSize={page ? 15 : 13} glow color={p.accent} doneColor={p.ok} errorColor={p.confirmed} showTimer={false} />
    </div>
  );
};
export { LatticeLoader };

export function cleanError(e: string) {
  const m = e.match(/^(?:Error: )?(\d{3}) (.*)$/s);
  if (!m) return e.replace(/^Error: /, "").replace(/^TypeError: Failed to fetch$/, "The SAT-SA API is not reachable. Start it with run.bat.");
  try { const j = JSON.parse(m[2]); return `${m[1]}: ${typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j)}`; } catch { return `${m[1]}: ${m[2].slice(0, 200)}`; }
}
export function Callout({ kind = "info", title, children, icon: Icon = WarningAltFilled }: { kind?: "info" | "ok" | "review" | "confirmed" | "ai"; title?: ReactNode; children?: ReactNode; icon?: ComponentType<{ size?: number }> }) {
  return (
    <div className={`sa-callout ${kind !== "info" ? `sa-callout--${kind}` : ""}`} role={kind === "confirmed" ? "alert" : "status"}>
      <Icon size={16} />
      <div>{title && <b>{title}</b>}{children && <span className="sa-callout__sub">{children}</span>}</div>
    </div>
  );
}
export const ErrorBox = ({ e, title = "This view could not be loaded" }: { e: string; title?: string }) =>
  <Callout kind="confirmed" title={title}>{cleanError(e)}</Callout>;
export const Empty = ({ icon: Icon, title, children }: { icon?: ComponentType<{ size?: number }>; title: ReactNode; children?: ReactNode }) =>
  <div className="sa-empty">{Icon && <Icon size={28} />}<b>{title}</b>{children && <span>{children}</span>}</div>;

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
export type Kind = "ok" | "review" | "confirmed" | "ai" | "neutral" | "accent";
export const Badge = ({ kind, children, dot }: { kind: Kind; children: ReactNode; dot?: boolean }) =>
  <span className={`sa-badge sa-badge--${kind}`}>{dot && <i />}{children}</span>;
export const Synthetic = ({ tip = false }: { tip?: boolean }) => <span className="sa-inline" style={{ gap: 0 }}><Badge kind="review">synthetic</Badge>{tip && <Info tip="synthetic" />}</span>;
export const Real = ({ tip = false }: { tip?: boolean }) => <span className="sa-inline" style={{ gap: 0 }}><Badge kind="ok">real data · GUIDE</Badge>{tip && <Info tip="real" />}</span>;

export function BasisTag({ basis }: { basis: string | null }) {
  if (!basis) return <Badge kind="neutral">not flagged</Badge>;
  if (basis === "deterministic") return <Badge kind="confirmed" dot>documented fact</Badge>;
  if (basis === "both") return <Badge kind="confirmed" dot>statistical + fact</Badge>;
  return <Badge kind="review" dot>FDR-flagged</Badge>;
}

export function ReasonList({ reasons, max = 3 }: { reasons: Reason[]; max?: number }) {
  return (
    <div className="sa-reasons">
      {reasons.slice(0, max).map((r) => (
        <span key={r.detector_id}>
          <span className="sa-mono sa-muted">{r.detector_id}</span> {r.name}: <span className="sa-muted">{r.effect}</span>{" "}
          {r.p_value != null && <span className="sa-mono sa-muted">p={fmtP(r.p_value)}</span>}
        </span>
      ))}
    </div>
  );
}

// Data sparkline (not an icon): monthly mean model scores.
export function Sparkline({ data, w = 96, h = 26 }: { data: number[]; w?: number; h?: number }) {
  const gid = useId();
  if (!data?.length) return null;
  const d = data.length > 1 && data[data.length - 1] === 0 ? data.slice(0, -1) : data; // trailing 0 = empty current month
  const max = Math.max(...d, 0.01), min = Math.min(...d);
  const xy = d.map((v, i) => [(i / (d.length - 1)) * w, h - 2 - ((v - min) / (max - min || 1)) * (h - 4)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg className="sa-spark" width={w} height={h} role="img" aria-label="12-month model score trend">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity="0.28" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="2.25" fill="currentColor" />
    </svg>
  );
}

export function Meter({ v, basis }: { v: number; basis?: string | null }) {
  const tone = basis === "deterministic" || basis === "both" ? "confirmed" : basis === "statistical" ? "review" : "";
  return (
    <div className="sa-meter" title={`Supervisory attention ${v.toFixed(0)} of 100`}>
      <span className="sa-meter__v">{v.toFixed(0)}</span>
      <span className="sa-meter__track"><i className={`sa-meter__fill ${tone ? `sa-meter__fill--${tone}` : ""}`} style={{ inlineSize: `${Math.max(3, v)}%` }} /></span>
    </div>
  );
}
export const Attention = Meter;

// ---------------------------------------------------------------------------
// Page header with an optional "How to read this page" guide
// ---------------------------------------------------------------------------
export type GuideStep = { icon: ComponentType<{ size?: number }>; title: string; text: ReactNode };
export function PageHeader({ title, meta, lead, actions, guide, guideKey }: { title: ReactNode; meta?: ReactNode; lead?: ReactNode; actions?: ReactNode; guide?: GuideStep[]; guideKey?: string }) {
  const k = `satsa-guide-${guideKey ?? "x"}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(k) === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem(k, open ? "1" : "0"); } catch { /* per-viewer convenience only */ } }, [open, k]);
  return (
    <>
      <header className="sa-ph">
        <div className="sa-ph__text">
          <div className="sa-ph__title"><h1 className="sa-h1">{title}</h1>{meta}</div>
          {lead && <p className="sa-lead">{lead}</p>}
        </div>
        {(actions || guide) && <div className="sa-ph__actions">
          {guideKey && CHAPTER_FOR_GUIDE[guideKey] && <Btn kind="ghost" size="md" icon={PlayFilledAlt} iconLeft title="A spotlight tour of this page, a few stops long"
            onClick={() => window.dispatchEvent(new CustomEvent("satsa:tour-page", { detail: guideKey }))}>Tour this page</Btn>}
          {guide && <Btn kind="ghost" size="md" icon={open ? Close : Help} iconLeft onClick={() => setOpen(!open)}>{open ? "Hide guide" : "How to read this page"}</Btn>}
          {actions}
        </div>}
      </header>
      {guide && open && (
        <motion.section className="sa-guide" aria-label="How to read this page" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <ol className="sa-guide__steps">
            {guide.map((g) => <li key={g.title}><span><g.icon size={16} /></span><b>{g.title}</b><span>{g.text}</span></li>)}
          </ol>
        </motion.section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// KPI tiles and stats
// ---------------------------------------------------------------------------
export const Kpi = ({ label, value, note, tag, tip, icon: Icon }: { label: ReactNode; value: ReactNode; note?: ReactNode; tag?: ReactNode; tip?: TipArg; icon?: ComponentType<{ size?: number }> }) => (
  <div className="sa-kpi">
    <div className="sa-kpi__label">{Icon && <Icon size={14} />}{tip && typeof label === "string" ? <Tipped text={label} tip={tip} /> : <>{label}{tip && <Info tip={tip} />}</>}</div>
    <div className="sa-kpi__value">{value}</div>
    {note && <div className="sa-kpi__note">{note}</div>}
    {tag && <div>{tag}</div>}
  </div>
);
export const Stat = ({ value, label, tag, tip }: { value: ReactNode; label: ReactNode; tag?: ReactNode; tip?: TipArg }) => (
  <div className="sa-stat">
    <div className="sa-stat__value">{value}</div>
    <div className="sa-stat__label">{tip && typeof label === "string" ? <Tipped text={label} tip={tip} /> : <>{label}{tip && <Info tip={tip} />}</>}</div>
    {tag && <div>{tag}</div>}
  </div>
);

// ---------------------------------------------------------------------------
// Tabs and segmented control, both with a sliding indicator
// ---------------------------------------------------------------------------
export function Tabs<T extends string>({ items, value, onChange, label }: { items: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  const id = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (dir: number) => {
    const i = items.findIndex((x) => x.id === value);
    const n = items[(i + dir + items.length) % items.length];
    onChange(n.id); refs.current[n.id]?.focus();
  };
  return (
    <div className="sa-tabs" role="tablist" aria-label={label} onKeyDown={(e) => { if (e.key === "ArrowRight") move(1); if (e.key === "ArrowLeft") move(-1); }}>
      {items.map((t) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" type="button" className="sa-tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}>
          {t.id === value && <motion.i layoutId={`tab-${id}`} className="sa-tab__ind" transition={{ type: "spring", bounce: 0.18, duration: 0.45 }} />}
          <span>{t.label}{t.count != null && <span className="sa-tab__count">{t.count}</span>}</span>
        </button>
      ))}
    </div>
  );
}
export function Segmented<T extends string | number>({ options, value, onChange, label, size, accent }: { options: { v: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; size?: "lg"; accent?: boolean }) {
  const id = useId();
  return (
    <div className={`sa-seg ${size === "lg" ? "sa-seg--lg" : ""} ${accent ? "sa-seg--accent" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" className="sa-tab" aria-checked={o.v === value} onClick={() => onChange(o.v)}>
          {o.v === value && <motion.i layoutId={`seg-${id}`} className="sa-tab__ind" transition={{ type: "spring", bounce: 0.2, duration: 0.45 }} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panel: focus moves in, Tab stays inside, Escape closes, focus returns on close.
// ---------------------------------------------------------------------------
export function SidePanel({ title, subtitle, onClose, nested, children }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; nested?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!ref.current) return;
      const panels = document.querySelectorAll(".sa-sidepanel");
      if (panels[panels.length - 1] !== ref.current) return;
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const f = ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"]), summary');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <>
      <div className={`sa-panel-bg ${nested ? "is-nested" : ""}`} onClick={onClose} />
      <div ref={ref} className={`sa-sidepanel ${nested ? "is-nested" : ""}`} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="sa-sidepanel__head">
          <div><h2 className="sa-h2">{title}</h2>{subtitle}</div>
          <Btn kind="ghost" size="md" icon={Close} label="Close" onClick={onClose} />
        </div>
        <div className="sa-sidepanel__body">{children}</div>
      </div>
    </>
  );
}

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { mode, toggle } = useTheme();
  const label = mode === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return compact
    ? <Btn kind="ghost" size="md" icon={mode === "dark" ? Light : Asleep} label={label} title={label} onClick={toggle} />
    : <Btn kind="ghost" size="sm" icon={mode === "dark" ? Light : Asleep} iconLeft onClick={toggle}>{mode === "dark" ? "Light theme" : "Dark theme"}</Btn>;
}

// Shared legend for ATT&CK tactic states (dossier tab and blind-spot matrix).
export const StateLegend = () => (
  <div className="sa-legend" aria-label="Legend">
    <span><i className="sa-state--covered" />covered: can see, alerts present</span><span><i className="sa-state--quiet" />quiet: can see, far fewer alerts</span>
    <span><i className="sa-state--blind" />blind: cannot see at all</span><span><i className="sa-state--not_applicable" />not applicable</span>
  </div>
);
