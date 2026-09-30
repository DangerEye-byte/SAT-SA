// Orbital maps: clean, deterministic SVG layouts (stable across renders).
// EntityOrbit (evidence map): entities on a ring by sector, leading findings inside, links between them.
// ProviderOrbit: SOC providers in the centre; every entity on an outer ring grouped by sector; a thin link
// from each provider to each client. The only continuous motion is a faint flow on a risky provider's links.
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import type { QueueEntity } from "../api";
import { pct } from "../api";
import { useTheme } from "../theme";

const TAU = Math.PI * 2;
const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
const tone = (e: QueueEntity) => (!e.flagged ? "none" : e.flag_basis === "statistical" ? "review" : "confirmed");
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const SHORT: Record<string, string> = { BFS: "Banking & finance", PWR: "Power & energy", TEL: "Telecom", TRN: "Transport", GOV: "Government", SPE: "Strategic PSUs", HLT: "Health" };

type Tip = { x: number; y: number; body: ReactNode } | null;
function TipBox({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return <div className="sa-orb__tip" style={{ left: `${tip.x}%`, top: `${tip.y}%` }} role="tooltip">{tip.body}</div>;
}

// ---------------------------------------------------------------------------
// Evidence map (Overview): entities on the outer ring grouped by sector, the findings that lead the
// evidence on an inner ring, and a curved link from each flagged entity to each of its leading findings.
// ---------------------------------------------------------------------------
type Det = { detector_id: string; name: string; family: string };
const famOf = (id: string, dets: Det[]) => dets.find((d) => d.detector_id === id)?.family ?? (id.startsWith("EG") || id.startsWith("TW") ? "Execution gap" : "Negative space");
const idNum = (id: string) => [id.replace(/\d+$/, ""), Number(id.match(/\d+$/)?.[0] ?? 0)] as const;

export function EntityOrbit({ entities, detectors = [] }: { entities: QueueEntity[]; detectors?: Det[] }) {
  const { p } = useTheme();
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const [hot, setHot] = useState<{ kind: "ent" | "det" | "sec"; id: string } | null>(null);
  const [tip, setTip] = useState<Tip>(null);
  const S = 740, c = S / 2, RING = 270, INNER = 150;
  const L = useMemo(() => {
    const sectors = [...new Set(entities.map((e) => e.sector))].sort();
    // Flagged entities get more room on the ring than unflagged ones, so their ids never collide.
    const wt = (e: QueueEntity) => (e.flagged ? 2.6 : 1);
    const gap = 0.16, unit = (TAU - gap * sectors.length) / Math.max(1, entities.reduce((n, e) => n + wt(e), 0));
    const first = entities.filter((e) => e.sector === sectors[0]).reduce((n, e) => n + wt(e), 0);
    let a = -Math.PI / 2 - (unit * first) / 2;
    const pos: Record<string, { a: number; xy: [number, number] }> = {};
    const arcs: { s: string; a0: number; a1: number }[] = [];
    for (const s of sectors) {
      const m = entities.filter((e) => e.sector === s).sort((x, y) => x.entity_id.localeCompare(y.entity_id));
      const a0 = a;
      m.forEach((e) => { const w = unit * wt(e), ai = a + w / 2; pos[e.entity_id] = { a: ai, xy: polar(c, c, RING, ai) }; a += w; });
      arcs.push({ s, a0, a1: a });
      a += gap;
    }
    // Leading findings sit on the inner ring in the order of where their entities are (circular mean),
    // so links stay short and rarely cross. Colour, not position, carries the family.
    const hits = new Map<string, number[]>();
    entities.filter((e) => e.flagged).forEach((e) => e.top_reasons.forEach((r) => hits.set(r.detector_id, [...(hits.get(r.detector_id) ?? []), pos[e.entity_id]?.a ?? 0])));
    const mean = (as: number[]) => Math.atan2(as.reduce((t, x) => t + Math.sin(x), 0), as.reduce((t, x) => t + Math.cos(x), 0));
    const ids = [...hits.keys()].sort((x, y) => ((mean(hits.get(x)!) + TAU * 2.25) % TAU) - ((mean(hits.get(y)!) + TAU * 2.25) % TAU) || x.localeCompare(y));
    const start = ids.length ? mean(hits.get(ids[0])!) : 0;
    const dets = ids.map((id, i) => {
      const ang = start + (i / Math.max(1, ids.length)) * TAU;
      return { id, n: hits.get(id)!.length, fam: famOf(id, detectors), a: ang, xy: polar(c, c, INNER, ang) };
    });
    return { arcs, pos, dets };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities.map((e) => `${e.entity_id}${e.flagged ? 1 : 0}${e.top_reasons.map((r) => r.detector_id).join("")}`).join(), detectors.length]);

  const eg = (fam: string) => fam === "Execution gap";
  const entCol = (e: QueueEntity) => (tone(e) === "review" ? p.review : tone(e) === "confirmed" ? p.confirmed : p.neutral1);
  const linkOn = (e: QueueEntity, det: string) => !hot || (hot.kind === "ent" && hot.id === e.entity_id) || (hot.kind === "det" && hot.id === det) || (hot.kind === "sec" && hot.id === e.sector);
  const entOn = (e: QueueEntity) => !hot || (hot.kind === "ent" && hot.id === e.entity_id) || (hot.kind === "sec" && hot.id === e.sector) || (hot.kind === "det" && e.flagged && e.top_reasons.some((r) => r.detector_id === hot.id));
  const detOn = (id: string) => !hot || (hot.kind === "det" && hot.id === id)
    || (hot.kind === "ent" && !!entities.find((e) => e.entity_id === hot.id && e.flagged)?.top_reasons.some((r) => r.detector_id === id))
    || (hot.kind === "sec" && entities.some((e) => e.sector === hot.id && e.flagged && e.top_reasons.some((r) => r.detector_id === id)));
  const pctXY = (x: number, y: number) => ({ x: (x / S) * 100, y: (y / S) * 100 });
  const name = (id: string) => detectors.find((d) => d.detector_id === id)?.name ?? entities.flatMap((e) => e.top_reasons).find((r) => r.detector_id === id)?.name ?? id;
  const egArc = L.dets.filter((d) => eg(d.fam)), nsArc = L.dets.filter((d) => !eg(d.fam));

  return (
    <div className="sa-orb" onMouseLeave={() => { setHot(null); setTip(null); }}>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Evidence map: ${entities.length} entities grouped by sector on the outer ring; ${entities.filter((e) => e.flagged).length} flagged, each linked to the findings that lead its evidence.`}>
        <circle cx={c} cy={c} r={RING} fill="none" stroke={p.borderStrong} strokeOpacity="0.6" strokeDasharray="4 6" />
        <circle cx={c} cy={c} r={INNER} fill="none" stroke={p.borderStrong} strokeOpacity="0.45" strokeDasharray="4 6" />
        <g aria-hidden="true">
          <text x={c} y={c - 12} textAnchor="middle" fill={p.review} fontSize="11" fontWeight="700" fontFamily={SANS} letterSpacing="0.06em">EXECUTION GAPS {egArc.length}</text>
          <text x={c} y={c + 8} textAnchor="middle" fill={p.confirmed} fontSize="11" fontWeight="700" fontFamily={SANS} letterSpacing="0.06em">NEGATIVE SPACE {nsArc.length}</text>
          <text x={c} y={c + 26} textAnchor="middle" fill={p.helper} fontSize="10" fontFamily={SANS}>leading findings</text>
        </g>
        {L.arcs.map((s) => {
          const mid = (s.a0 + s.a1) / 2, [lx, ly] = polar(c, c, RING + 34, mid), cs = Math.cos(mid);
          const n = entities.filter((e) => e.sector === s.s), f = n.filter((e) => e.flagged).length;
          const anchor = cs > 0.25 ? "start" : cs < -0.25 ? "end" : "middle";
          return (
            <g key={s.s} className="sa-orb__hub" role="link" tabIndex={0} aria-label={`${SHORT[s.s] ?? s.s}: ${f} of ${n.length} flagged. Open this sector's queue.`}
              onMouseEnter={() => setHot({ kind: "sec", id: s.s })} onFocus={() => setHot({ kind: "sec", id: s.s })} onClick={() => nav(`/?sector=${s.s}`)} onKeyDown={(ev) => ev.key === "Enter" && nav(`/?sector=${s.s}`)}>
              <text x={lx} y={ly - 7} textAnchor={anchor} dominantBaseline="middle" fill={p.text2} fontSize="13.5" fontWeight="600" fontFamily={SANS}>{SHORT[s.s] ?? s.s}</text>
              <text x={lx} y={ly + 9} textAnchor={anchor} dominantBaseline="middle" fill={f ? p.review : p.helper} fontSize="11" fontFamily={SANS}>{f} of {n.length} flagged</text>
            </g>
          );
        })}
        {entities.filter((e) => e.flagged).map((e) => e.top_reasons.map((r, k) => {
          const t = L.pos[e.entity_id], d = L.dets.find((x) => x.id === r.detector_id);
          if (!t || !d) return null;
          let mid = (t.a + d.a) / 2;
          if (Math.abs(t.a - d.a) > Math.PI) mid += Math.PI;
          const [qx, qy] = polar(c, c, (RING + INNER) * 0.5, mid);
          const path = `M${t.xy[0]},${t.xy[1]} Q${qx},${qy} ${d.xy[0]},${d.xy[1]}`;
          const col = eg(d.fam) ? p.review : p.confirmed, lit = linkOn(e, d.id);
          return (
            <g key={`${e.entity_id}-${d.id}`}>
              <motion.path d={path} fill="none" stroke={col} strokeWidth={k === 0 ? 1.6 : 1.1} initial={reduce ? false : { pathLength: 0 }}
                animate={{ pathLength: 1, strokeOpacity: hot ? (lit ? 0.85 : 0.04) : k === 0 ? 0.6 : 0 }}
                transition={{ pathLength: { duration: 0.9, delay: 0.15 + k * 0.1, ease: [0.16, 1, 0.3, 1] }, strokeOpacity: { duration: 0.2 } }} />
              {hot && lit && !reduce && <path d={path} fill="none" stroke={col} strokeWidth="2.2" strokeLinecap="round" className="sa-orb__flow" pathLength={100} style={{ animationDelay: `${k * 0.25}s` }} />}
            </g>
          );
        }))}
        {entities.map((e) => {
          const t = L.pos[e.entity_id];
          if (!t) return null;
          const lit = entOn(e), f = e.flagged, r = f ? 5.5 + e.attention * 0.035 : 3.5;
          const cs = Math.cos(t.a), [lx, ly] = polar(c, c, RING - 18, t.a);
          return (
            <g key={e.entity_id} className="sa-orb__dot" role="link" tabIndex={0} aria-label={`${e.entity_id} ${e.entity_name}, attention ${e.attention.toFixed(0)}, ${f ? "flagged" : "not flagged"}`}
              opacity={lit ? 1 : 0.2} style={{ transition: "opacity 200ms" }}
              onMouseEnter={() => { setHot({ kind: "ent", id: e.entity_id }); setTip({ ...pctXY(t.xy[0], t.xy[1]), body: <EntityTip e={e} /> }); }}
              onMouseLeave={() => { setHot(null); setTip(null); }} onFocus={() => setTip({ ...pctXY(t.xy[0], t.xy[1]), body: <EntityTip e={e} /> })} onBlur={() => setTip(null)}
              onClick={() => nav(`/entity/${e.entity_id}`)} onKeyDown={(ev) => ev.key === "Enter" && nav(`/entity/${e.entity_id}`)}>
              <circle cx={t.xy[0]} cy={t.xy[1]} r={r} fill={entCol(e)} stroke={p.bg} strokeWidth={f ? 2 : 0} style={{ transition: "fill 400ms" }} />
              {f && <text x={lx} y={ly} textAnchor={cs > 0.3 ? "end" : cs < -0.3 ? "start" : "middle"} dominantBaseline="middle" fill={p.text} fontSize="11.5" fontWeight="500" fontFamily={SANS} pointerEvents="none">{e.entity_id}</text>}
            </g>
          );
        })}
        {L.dets.map((d) => {
          const lit = detOn(d.id), col = eg(d.fam) ? p.review : p.confirmed;
          return (
            <g key={d.id} className="sa-orb__hub" role="button" tabIndex={0} opacity={lit ? 1 : 0.3} style={{ transition: "opacity 200ms" }}
              aria-label={`${d.id} ${name(d.id)}: leads the evidence for ${d.n} flagged entit${d.n === 1 ? "y" : "ies"}`}
              onMouseEnter={() => { setHot({ kind: "det", id: d.id }); setTip({ ...pctXY(d.xy[0], d.xy[1]), body: <><b>{name(d.id)}</b><span className="sa-mono">{d.id} · {d.fam.toLowerCase()}</span><span>Leads the evidence for <b>{d.n}</b> flagged entit{d.n === 1 ? "y" : "ies"}</span></> }); }}
              onMouseLeave={() => { setHot(null); setTip(null); }} onFocus={() => setHot({ kind: "det", id: d.id })}>
              <circle cx={d.xy[0]} cy={d.xy[1]} r={13 + Math.min(5, d.n)} fill={p.layer} stroke={col} strokeWidth="1.75" />
              <text x={d.xy[0]} y={d.xy[1] + 1} textAnchor="middle" dominantBaseline="middle" fill={p.text} fontSize="10" fontWeight="700" fontFamily={SANS}>{d.id}</text>
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

function EntityTip({ e }: { e: QueueEntity }) {
  return <>
    <b>{e.entity_name}</b><span className="sa-mono">{e.entity_id} · {e.sector}</span>
    <span>Attention <b>{e.attention.toFixed(0)}</b> · {e.flagged ? (e.flag_basis === "statistical" ? "FDR-flagged" : "documented fact") : "not flagged"}</span>
    {e.top_reasons[0] && <span className="sa-muted">{e.top_reasons[0].name}: {e.top_reasons[0].effect}</span>}
    <span className="sa-helper">Click to open the dossier</span>
  </>;
}

// ---------------------------------------------------------------------------
// Provider orbit (SOC providers page and Overview teaser)
// ---------------------------------------------------------------------------
export function ProviderOrbit({ providers, entities, compact }: { providers: any[]; entities: QueueEntity[]; compact?: boolean }) {
  const { p } = useTheme();
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const [hot, setHot] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip>(null);
  const S = 720, c = S / 2, RING = 250, SUN = 106;
  const mssp = providers.filter((x) => x.provider !== "INHOUSE");
  const weak = (x: any) => x.p_value != null && x.p_value < 0.05;
  const L = useMemo(() => {
    const sectors = [...new Set(entities.map((e) => e.sector))].sort();
    const gap = 0.14, span = (TAU - gap * sectors.length) / Math.max(1, entities.length);
    let a = -Math.PI / 2 - (span * entities.filter((e) => e.sector === sectors[0]).length) / 2;
    const pos: Record<string, { a: number; xy: [number, number] }> = {};
    const arcs: { s: string; mid: number }[] = [];
    for (const s of sectors) {
      const m = entities.filter((e) => e.sector === s).sort((x, y) => x.entity_id.localeCompare(y.entity_id));
      const a0 = a;
      m.forEach((e) => { const ai = a + span / 2; pos[e.entity_id] = { a: ai, xy: polar(c, c, RING, ai) }; a += span; });
      arcs.push({ s, mid: (a0 + a) / 2 });
      a += gap;
    }
    const suns = mssp.map((x, i) => {
      const ang = (i / mssp.length) * TAU - Math.PI / 2 + Math.PI / mssp.length;
      return { x, xy: polar(c, c, mssp.length > 1 ? SUN : 0, ang) };
    });
    return { arcs, pos, suns };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities.map((e) => e.entity_id).join(), providers.map((x) => x.provider).join()]);
  const pctXY = (x: number, y: number) => ({ x: (x / S) * 100, y: (y / S) * 100 });
  const provOf = (id: string) => mssp.find((x) => x.clients.includes(id));
  const on = (prov?: string) => hot == null || hot === prov;
  const inhouse = providers.find((x) => x.provider === "INHOUSE");

  return (
    <div className={`sa-orb ${compact ? "sa-orb--compact" : ""}`} onMouseLeave={() => { setHot(null); setTip(null); }}>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`SOC providers and their clients across sectors. ${mssp.filter(weak).map((x) => `${x.provider} carries a provider effect of ${x.effect_pp.toFixed(1)} percentage points across ${x.clients.length} clients`).join(". ")}`}>
        <circle cx={c} cy={c} r={RING} fill="none" stroke={p.borderStrong} strokeOpacity="0.6" strokeDasharray="4 6" />
        <circle cx={c} cy={c} r={SUN} fill="none" stroke={p.borderStrong} strokeOpacity="0.45" strokeDasharray="4 6" />
        {L.arcs.map((s) => {
          const [lx, ly] = polar(c, c, RING + 34, s.mid), cs = Math.cos(s.mid);
          return <text key={s.s} x={lx} y={ly} textAnchor={cs > 0.25 ? "start" : cs < -0.25 ? "end" : "middle"} dominantBaseline="middle" fill={p.text2} fontSize={compact ? 16 : 13.5} fontWeight="600" fontFamily={SANS}>{compact ? s.s : SHORT[s.s] ?? s.s}</text>;
        })}
        {L.suns.map(({ x, xy }) => x.clients.map((cl: string, k: number) => {
          const t = L.pos[cl];
          if (!t) return null;
          const [qx, qy] = polar(c, c, RING * 0.45, t.a);
          const d = `M${xy[0]},${xy[1]} Q${qx},${qy} ${t.xy[0]},${t.xy[1]}`;
          const w = weak(x), lit = on(x.provider);
          return (
            <g key={`${x.provider}-${cl}`}>
              <path d={d} fill="none" stroke={w ? p.confirmed : p.neutral1} strokeOpacity={lit ? (w ? 0.7 : 0.5) : 0.08} strokeWidth={w ? 1.6 : 1} style={{ transition: "stroke-opacity 200ms" }} />
              {w && !reduce && lit && <path d={d} fill="none" stroke={p.confirmed} strokeWidth="2.2" strokeLinecap="round" className="sa-orb__flow" pathLength={100} style={{ animationDelay: `${k * 0.3}s` }} />}
            </g>
          );
        }))}
        {entities.map((e) => {
          const t = L.pos[e.entity_id];
          if (!t) return null;
          const pr = provOf(e.entity_id), w = pr && weak(pr), lit = on(pr?.provider ?? "INHOUSE");
          const rate = pr?.client_rates?.[e.entity_id] ?? inhouse?.client_rates?.[e.entity_id];
          const cs = Math.cos(t.a), [lx, ly] = polar(c, c, RING - 17, t.a);
          return (
            <g key={e.entity_id} className="sa-orb__dot" role="link" tabIndex={0} aria-label={`${e.entity_id}, SOC ${pr?.provider ?? "in-house"}`}
              opacity={lit ? 1 : 0.25} style={{ transition: "opacity 200ms" }}
              onMouseEnter={() => { setHot(pr?.provider ?? "INHOUSE"); setTip({ ...pctXY(t.xy[0], t.xy[1]), body: <><b>{e.entity_name}</b><span className="sa-mono">{e.entity_id} · {e.sector}</span><span>SOC: {pr?.provider ?? "in-house"}</span>{rate != null && <span>Likely-superficial rate <b>{pct(rate, 1)}</b></span>}<span className="sa-helper">Click to open the dossier</span></> }); }}
              onMouseLeave={() => setTip(null)} onClick={() => nav(`/entity/${e.entity_id}`)} onKeyDown={(ev) => ev.key === "Enter" && nav(`/entity/${e.entity_id}`)}>
              <circle cx={t.xy[0]} cy={t.xy[1]} r={pr ? (w ? 8 : 6) : 4} fill={pr ? (w ? p.confirmed : p.ok) : p.neutral1} stroke={p.bg} strokeWidth={pr ? 2 : 0} />
              {w && !compact && <text x={lx} y={ly} textAnchor={cs > 0.3 ? "end" : cs < -0.3 ? "start" : "middle"} dominantBaseline="middle" fill={p.text} fontSize="12" fontWeight="500" fontFamily={SANS} pointerEvents="none">{e.entity_id}</text>}
            </g>
          );
        })}
        {L.suns.map(({ x, xy }) => {
          const w = weak(x), r = compact ? 30 : 28, lit = on(x.provider);
          return (
            <g key={x.provider} className="sa-orb__hub" role="button" tabIndex={0} opacity={lit ? 1 : 0.4} style={{ transition: "opacity 200ms" }}
              aria-label={`${x.provider}: ${x.clients.length} clients, provider effect ${x.effect_pp > 0 ? "+" : ""}${x.effect_pp.toFixed(1)} percentage points`}
              onMouseEnter={() => { setHot(x.provider); setTip({ ...pctXY(xy[0], xy[1]), body: <><b className="sa-mono">{x.provider}</b><span>{x.clients.length} clients in {x.sectors.length} sectors</span><span>Provider effect <b className={w ? "sa-confirmed" : "sa-ok"}>{x.effect_pp > 0 ? "+" : ""}{x.effect_pp.toFixed(1)} pp</b>{x.effect_ci90 && <> (90% CI {x.effect_ci90.map((v: number) => v.toFixed(1)).join(" to ")})</>}</span><span className="sa-helper">{w ? "Systemic risk: flag the provider for review" : "No provider-level effect"}</span></> }); }}
              onMouseLeave={() => setTip(null)} onFocus={() => setHot(x.provider)}>
              <circle cx={xy[0]} cy={xy[1]} r={r} fill={p.layer} stroke={w ? p.confirmed : p.text2} strokeWidth={w ? 2.5 : 1.5} />
              <text x={xy[0]} y={xy[1] - 2} textAnchor="middle" fill={p.text} fontSize={compact ? 14 : 12} fontWeight="700" fontFamily={SANS}>{x.provider}</text>
              <text x={xy[0]} y={xy[1] + (compact ? 15 : 13)} textAnchor="middle" fill={w ? p.confirmed : p.helper} fontSize={compact ? 13 : 11} fontWeight="600" fontFamily={SANS}>{x.effect_pp > 0 ? "+" : ""}{x.effect_pp.toFixed(1)} pp</text>
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}
