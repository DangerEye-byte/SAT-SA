// Guided tour. driver.js (MIT) draws the spotlight and positions the card; this file is the engine around it:
// chapters across routes, a quick and a full route, per-page tours, a Tour Center launcher, "Try it" steps
// that react when you act, pause and resume when you click away, and progress that survives reloads.
// The script itself lives in tourSteps.ts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./styles/tour.scss";
import { ArrowRight, CheckmarkFilled, Close, Location, Map as MapIcon, PlayFilledAlt, Renew, Rocket, Time } from "@carbon/icons-react";
import { CHAPTERS, CHAPTER_FOR_GUIDE, type Chapter, type TourStep } from "./tourSteps";
import { useTheme } from "./theme";
import LatticeLoader from "./components/fx/LatticeLoader";

type Mode = { kind: "full" } | { kind: "quick" } | { kind: "chapter"; id: string };
type Flat = TourStep & { chapter: Chapter; route: string };
type Saved = { done: string[]; resume: { mode: Mode; i: number } | null; seen: boolean };

const KEY = "satsa-tour-v2";
const SECONDS_PER_STOP = 13;
const load = (): Saved => { try { return { done: [], resume: null, seen: false, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { done: [], resume: null, seen: false }; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* per-viewer convenience only */ } };

function build(mode: Mode): Flat[] {
  const chs = mode.kind === "chapter" ? CHAPTERS.filter((c) => c.id === mode.id) : CHAPTERS;
  return chs.flatMap((c) => c.steps.filter((s) => mode.kind !== "quick" || s.quick).map((s) => ({ ...s, chapter: c, route: s.route ?? c.route })));
}
const minutes = (n: number) => Math.max(1, Math.round((n * SECONDS_PER_STOP) / 60));
const modeLabel = (m: Mode) => (m.kind === "full" ? "Full tour" : m.kind === "quick" ? "Quick tour" : `${CHAPTERS.find((c) => c.id === m.id)?.title ?? ""} tour`);

// A route matches when the path is the same and every query parameter the step asks for is present.
function routeMatches(route: string) {
  if (!route) return true;
  const [path, query] = route.split("?");
  if (window.location.pathname !== path) return false;
  const want = new URLSearchParams(query ?? ""), have = new URLSearchParams(window.location.search);
  return [...want.entries()].every(([k, v]) => have.get(k) === v);
}
// `stale`: elements from the page we are leaving, which can linger for a frame while the next route renders.
function waitFor(sel: string | undefined, ms: number, route = "", stale: Element[] = []): Promise<Element | null> {
  return new Promise((res) => {
    const t0 = performance.now();
    const tick = () => {
      const el = sel ? [...document.querySelectorAll(sel)].find((e) => !stale.includes(e)) : document.querySelector(".sa-main > *:not(.sa-loading)");
      const r = el?.getBoundingClientRect();
      if (el && el.isConnected && r && r.width > 0 && r.height > 0 && routeMatches(route) && (!sel || !stale.includes(el))
        && !document.querySelector(".sa-main .sa-loading--page")) return res(sel ? el : null);
      if (performance.now() - t0 > ms) return res(null);
      setTimeout(tick, 90);
    };
    tick();
  });
}
// Resolves once the element has stopped moving (drawer slide-ins, charts drawing, smooth scrolls).
function settle(el: Element, max = 1800): Promise<void> {
  return new Promise((res) => {
    const t0 = performance.now();
    let last = "", same = 0;
    const tick = () => {
      const r = el.getBoundingClientRect();
      const k = `${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.width)},${Math.round(r.height)}`;
      same = k === last ? same + 1 : 0; last = k;
      if (same >= 3 || performance.now() - t0 > max) return res();
      setTimeout(tick, 60);
    };
    tick();
  });
}
// Bring the target into view ourselves, before driver.js draws anything, so the spotlight and the card
// land once and never chase a scroll. Elements taller than the screen get a spotlight the height of the
// viewport (a proxy child), so driver.js has nothing left to scroll.
// Resolves once loaders inside the element are gone and every chart in it has drawn.
function drawn(el: Element, max = 2500): Promise<void> {
  return new Promise((res) => {
    const t0 = performance.now();
    const tick = () => {
      const busy = el.querySelector(".sa-loading, [aria-busy=true]")
        || [...el.querySelectorAll(".echarts-for-react")].some((c) => !c.querySelector("svg, canvas"));
      if (!busy || performance.now() - t0 > max) return res();
      setTimeout(tick, 80);
    };
    tick();
  });
}
async function frame(el: Element, reduce: boolean): Promise<{ target: Element; undo: () => void }> {
  await drawn(el);
  await settle(el);
  // On phones the card docks as a bottom sheet (tour.scss), so the target must fit in the top part.
  const phone = window.innerWidth < 640;
  const top = (document.querySelector(".sa-top")?.getBoundingClientRect().bottom ?? 0) + (phone ? 8 : 16);
  const reserve = phone ? Math.round(window.innerHeight * 0.5) : 16;
  const room = window.innerHeight - top - reserve;
  let r = el.getBoundingClientRect();
  const tall = r.height > room;
  const visible = r.top >= top - 1 && r.bottom <= window.innerHeight - reserve && r.left >= 0 && r.right <= window.innerWidth;
  if (tall || phone ? Math.abs(r.top - top) > 6 : !visible) {
    const h = el as HTMLElement, prev = h.style.scrollMarginTop;
    h.style.scrollMarginTop = `${top}px`;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: tall || phone ? "start" : "center", inline: "nearest" });
    h.style.scrollMarginTop = prev;
    await settle(el, 1400);
    r = el.getBoundingClientRect();
  }
  if (!tall) return { target: el, undo: () => {} };
  const h = el as HTMLElement;
  const restorePos = getComputedStyle(h).position === "static" ? (h.style.position = "relative", () => { h.style.position = ""; }) : () => {};
  const proxy = document.createElement("div");
  proxy.className = "sa-tr-proxy";
  proxy.style.height = `${Math.max(120, Math.min(r.height, room))}px`;
  h.appendChild(proxy);
  h.classList.add("sa-tr-proxied");
  return { target: proxy, undo: () => { proxy.remove(); h.classList.remove("sa-tr-proxied"); restorePos(); } };
}
// The card can be dragged by its top bar when it covers something you want to read. The offset lasts for
// the current stop; the next stop places the card fresh. Double-click the bar to snap it back.
function makeDraggable(card: HTMLElement) {
  card.style.transform = "";
  card.classList.remove("is-dragged", "is-dragging");
  const bar = card.querySelector<HTMLElement>(".sa-tr__top");
  if (!bar || bar.dataset.drag) return;
  bar.dataset.drag = "1";
  let dx = 0, dy = 0;
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(card.style.transform);
    dx = m ? +m[1] : 0; dy = m ? +m[2] : 0;
    const r = card.getBoundingClientRect(), x0 = r.left - dx, y0 = r.top - dy, sx = e.clientX - dx, sy = e.clientY - dy;
    card.classList.add("is-dragging", "is-dragged");
    const move = (ev: PointerEvent) => {
      dx = Math.min(Math.max(ev.clientX - sx, 8 - x0), window.innerWidth - 8 - x0 - r.width);
      dy = Math.min(Math.max(ev.clientY - sy, 8 - y0), window.innerHeight - 8 - y0 - r.height);
      card.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const up = () => { card.classList.remove("is-dragging"); bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); bar.removeEventListener("pointercancel", up); };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  });
  bar.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    card.style.transform = ""; card.classList.remove("is-dragged");
  });
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const ICON_NEXT = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M9.3 3.3 8.6 4l3.5 3.5H2v1h10.1L8.6 12l.7.7L14 8z" fill="currentColor"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.7 12.7 7.4 12 3.9 8.5H14v-1H3.9L7.4 4l-.7-.7L2 8z" fill="currentColor"/></svg>`;
const ICON_X = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M12 4.7 11.3 4 8 7.3 4.7 4 4 4.7 7.3 8 4 11.3l.7.7L8 8.7l3.3 3.3.7-.7L8.7 8z" fill="currentColor"/></svg>`;
const ICON_TRY = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m0 13A6 6 0 1 1 8 2a6 6 0 0 1 0 12M6.5 5v6L11 8z" fill="currentColor"/></svg>`;

// The card's HTML. driver.js puts it inside its popover; buttons carry data-tr actions.
function cardHtml(list: Flat[], i: number, mode: Mode, done: string[]) {
  const s = list[i];
  const chapters = [...new Map(list.map((x) => [x.chapter.id, x.chapter])).values()].filter((c) => c.id !== "finish");
  const ci = chapters.findIndex((c) => c.id === s.chapter.id);
  const bar = chapters.map((c) => {
    const idx = list.map((x, k) => (x.chapter.id === c.id ? k : -1)).filter((k) => k >= 0);
    const fill = i > idx[idx.length - 1] ? 1 : i < idx[0] ? 0 : (i - idx[0] + 1) / idx.length;
    return `<span title="${esc(c.title)}" class="${c.id === s.chapter.id ? "is-now" : ""}"><i style="width:${(fill * 100).toFixed(1)}%"></i></span>`;
  }).join("");
  const next = list[i + 1];
  const last = i === list.length - 1;
  const after = mode.kind === "chapter" ? CHAPTERS[CHAPTERS.findIndex((c) => c.id === mode.id) + 1] : undefined;
  const nextLabel = last ? (mode.kind === "chapter" ? "Done" : "Finish") : next.chapter.id !== s.chapter.id && next.chapter.id !== "finish" ? `Next: ${esc(next.chapter.title)}` : "Next";

  let main: string;
  if (s.hero === "welcome") {
    main = `<div class="sa-tr__hero">
      <div class="sa-tr__mark" aria-hidden="true"><i></i><i></i><i></i></div>
      <h3 class="sa-tr__title">${esc(s.title)}</h3>
      <p class="sa-tr__body">${md(s.body)}</p>
      <ol class="sa-tr__pillars">
        <li><b>Find</b><span>Execution gaps and negative space in each entity's own SOC records.</span></li>
        <li><b>Rank</b><span>Calibrated statistics under a false-alarm budget you choose.</span></li>
        <li><b>Decide</b><span>Evidence, records and obligations for the examiner. SAT-SA flags; you decide.</span></li>
      </ol>
      <p class="sa-tr__fine">${list.length} stops, about ${minutes(list.length)} min. All entities in this demo are synthetic.</p>
    </div>`;
  } else if (s.hero === "finale") {
    const seen = chapters.filter((c) => c.id !== "start");
    main = `<div class="sa-tr__hero">
      <div class="sa-tr__mark is-done" aria-hidden="true"><svg viewBox="0 0 32 32" width="30" height="30"><path d="M13 21.2 7.8 16l-1.4 1.4 6.6 6.6 13-13-1.4-1.4z" fill="currentColor"/></svg></div>
      <h3 class="sa-tr__title">${mode.kind === "quick" ? "That was the quick tour" : esc(s.title)}</h3>
      <p class="sa-tr__body">${mode.kind === "quick"
        ? "You have seen where to look, why an entity is flagged, how the examiner decides, and why the flags can be trusted. The full tour covers every screen, chapter by chapter."
        : "You have seen every screen of SAT-SA. Each page keeps its <b>How to read this page</b> guide and a <b>?</b> on every number, and this tour is always one click away."}</p>
      <ul class="sa-tr__seen">${seen.map((c) => `<li>${esc(c.title)}</li>`).join("")}</ul>
      <div class="sa-tr__cta">
        <button type="button" class="sa-btn sa-btn--primary sa-btn--md" data-tr="goto:/">Open the review queue ${ICON_NEXT}</button>
        ${mode.kind === "quick" ? `<button type="button" class="sa-btn sa-btn--secondary sa-btn--md" data-tr="full">Take the full tour</button>` : `<button type="button" class="sa-btn sa-btn--secondary sa-btn--md" data-tr="center">Choose a chapter</button>`}
      </div>
    </div>`;
  } else {
    main = `<h3 class="sa-tr__title">${esc(s.title)}</h3>
      <p class="sa-tr__body">${md(s.body)}</p>
      ${s.try ? `<div class="sa-tr__try"><span class="sa-tr__trylabel">${ICON_TRY}<b>Try it</b><em>✓ Nice, you did it</em></span><span>${md(s.try)}</span></div>` : ""}
      ${s.why ? `<p class="sa-tr__why"><b>Why it matters.</b> ${md(s.why)}</p>` : ""}`;
  }
  const chapNo = s.chapter.id === "finish" ? "" : `<b>${String(ci + 1).padStart(2, "0")}</b>`;
  return `<div class="sa-tr__top" title="Drag to move this card · double-click to put it back">
      <span class="sa-tr__grip" aria-hidden="true"><svg viewBox="0 0 10 16" width="8" height="13"><g fill="currentColor"><circle cx="2" cy="2" r="1.4"/><circle cx="8" cy="2" r="1.4"/><circle cx="2" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="2" cy="14" r="1.4"/><circle cx="8" cy="14" r="1.4"/></g></svg></span>
      <span class="sa-tr__chap">${chapNo}${esc(s.chapter.id === "finish" ? modeLabel(mode) : s.chapter.title)}${done.includes(s.chapter.id) ? ` <span class="sa-tr__tick" title="Chapter seen before">✓</span>` : ""}</span>
      <span class="sa-tr__count">${i + 1} / ${list.length}</span>
      <button type="button" class="sa-tr__x" data-tr="end" aria-label="End the tour">${ICON_X}</button>
    </div>
    <div class="sa-tr__bar" aria-hidden="true">${bar}</div>
    <div class="sa-tr__main">${main}</div>
    <div class="sa-tr__foot">
      ${i > 0 ? `<button type="button" class="sa-btn sa-btn--ghost sa-btn--sm" data-tr="prev">${ICON_BACK} Back</button>` : `<button type="button" class="sa-btn sa-btn--ghost sa-btn--sm" data-tr="end">Skip tour</button>`}
      <span class="sa-tr__keys" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd><kbd>Esc</kbd></span>
      ${last && after && after.id !== "finish" ? `<button type="button" class="sa-btn sa-btn--secondary sa-btn--sm" data-tr="chapter:${after.id}">Next chapter</button>` : ""}
      <button type="button" class="sa-btn sa-btn--primary sa-btn--sm sa-tr__next" data-tr="${last ? "finish" : "next"}">${nextLabel} ${last ? "" : ICON_NEXT}</button>
    </div>`;
}

type Ctx = { open: () => void; start: (mode: Mode) => void; running: boolean };
const TourCtx = createContext<Ctx>({ open: () => {}, start: () => {}, running: false });
export const useTour = () => useContext(TourCtx);
export type { Mode as TourMode };

export function TourProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const { mode: theme, p } = useTheme();
  const reduce = useReducedMotion();
  const [saved, setSaved] = useState<Saved>(load);
  const [run, setRun] = useState<{ mode: Mode; list: Flat[]; i: number } | null>(null);
  const [transit, setTransit] = useState<Chapter | null>(null);
  const [paused, setPaused] = useState(false);
  const [center, setCenter] = useState<null | "menu" | "welcome">(null);
  const runRef = useRef(run); runRef.current = run;
  const transitRef = useRef(false);
  const seq = useRef(0);
  const drv = useRef<Driver | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const themeRef = useRef(theme); themeRef.current = theme;

  const persist = useCallback((f: (s: Saved) => Saved) => setSaved((s) => { const n = f(s); save(n); return n; }), []);

  const config = useCallback(() => ({
    animate: !reduce, smoothScroll: false, allowClose: false, allowKeyboardControl: false, disableActiveInteraction: false,
    overlayColor: themeRef.current === "dark" ? "#02050c" : "#0b1322", overlayOpacity: themeRef.current === "dark" ? 0.74 : 0.52,
    stagePadding: 8, stageRadius: 14, popoverOffset: 16, showButtons: [] as never[], popoverClass: "sa-tr",
    onPopoverRender: (pop: { wrapper: HTMLElement }) => {
      pop.wrapper.classList.remove("is-leaving");
      makeDraggable(pop.wrapper);
      pop.wrapper.setAttribute("role", "dialog");
      pop.wrapper.setAttribute("aria-label", "Guided tour");
      pop.wrapper.querySelectorAll<HTMLElement>("[data-tr]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); act(b.dataset.tr!); }));
      requestAnimationFrame(() => pop.wrapper.querySelector<HTMLElement>(".sa-tr__next")?.focus({ preventScroll: true }));
    },
  }), [reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const kill = useCallback(() => { cleanup.current(); cleanup.current = () => {}; drv.current?.destroy(); drv.current = null; }, []);

  const go = useCallback(async (i: number, r = runRef.current) => {
    if (!r || i < 0 || i >= r.list.length) return;
    const token = ++seq.current;
    const s = r.list[i];
    const nr = { ...r, i };
    runRef.current = nr; setRun(nr); setPaused(false);
    persist((p) => ({ ...p, resume: { mode: r.mode, i } }));
    const moving = !!s.route && !routeMatches(s.route);
    // Fade the current card out while we move, so nothing is seen sliding around.
    document.querySelector(".driver-popover.sa-tr")?.classList.add("is-leaving");
    const stale = moving && s.el ? [...document.querySelectorAll(s.el)] : [];
    if (moving) { transitRef.current = true; kill(); setTransit(s.chapter); nav(s.route); }
    let el = s.el ? await waitFor(s.el, moving ? 9000 : 2500, s.route, stale) : (moving ? await waitFor(undefined, 9000, s.route) : null);
    if (token !== seq.current) return;
    cleanup.current(); cleanup.current = () => {};
    let framed = el ? await frame(el, !!reduce) : null;
    if (el && !el.isConnected && s.el) { // the page re-rendered while we waited: pick up the new element
      framed?.undo(); el = await waitFor(s.el, 3000, s.route); framed = el ? await frame(el, !!reduce) : null;
    }
    if (token !== seq.current) { framed?.undo(); return; }
    transitRef.current = false; setTransit(null);
    if (!drv.current) drv.current = driver(config());
    else drv.current.setConfig(config());
    const wide = s.hero ? " sa-tr--hero" : "";
    drv.current.highlight({
      element: framed?.target,
      popover: { description: cardHtml(nr.list, i, nr.mode, load().done), side: el ? s.side : undefined, align: el ? s.align ?? "center" : undefined, popoverClass: `sa-tr${wide}` },
    });
    // Follow real layout changes only (the user switched a budget, a chart finished drawing), once they
    // stop, and only by more than a couple of pixels. Mark "Try it" done when the user acts.
    if (el) {
      let t = 0, size = el.getBoundingClientRect();
      const ro = new ResizeObserver(() => {
        const n = el.getBoundingClientRect();
        if (Math.abs(n.width - size.width) < 3 && Math.abs(n.height - size.height) < 3) return;
        size = n; clearTimeout(t);
        t = window.setTimeout(() => { if (token === seq.current) drv.current?.refresh(); }, 220);
      });
      ro.observe(el);
      const onAct = () => {
        if (!s.try) return;
        document.querySelector(".sa-tr .sa-tr__try")?.classList.add("is-done");
        document.querySelector(".sa-tr .sa-tr__next")?.classList.add("is-ready");
      };
      const hover = !!s.try?.startsWith("Hover");
      el.addEventListener("click", onAct);
      if (hover) el.addEventListener("mousemove", onAct);
      cleanup.current = () => { ro.disconnect(); clearTimeout(t); el.removeEventListener("click", onAct); el.removeEventListener("mousemove", onAct); framed?.undo(); };
    }
  }, [config, kill, nav, persist]);

  const markDone = useCallback((upto: number, r = runRef.current) => {
    if (!r) return;
    const ids = [...new Set(r.list.slice(0, upto + 1).map((x) => x.chapter.id))].filter((id) => {
      const steps = r.list.filter((x) => x.chapter.id === id);
      return r.list.indexOf(steps[steps.length - 1]) <= upto;
    });
    persist((p) => ({ ...p, done: [...new Set([...p.done, ...ids])] }));
  }, [persist]);

  const end = useCallback((finished = false) => {
    const r = runRef.current;
    seq.current++; kill(); setTransit(null); setPaused(false); transitRef.current = false;
    if (r && finished) { markDone(r.list.length - 1, r); persist((p) => ({ ...p, resume: null })); }
    runRef.current = null; setRun(null);
  }, [kill, markDone, persist]);

  const start = useCallback((mode: Mode, from = 0) => {
    setCenter(null);
    persist((p) => ({ ...p, seen: true }));
    kill();
    const r = { mode, list: build(mode), i: from };
    runRef.current = r; setRun(r);
    go(from, r);
  }, [go, kill, persist]);

  // Buttons inside the card.
  const actRef = useRef<(a: string) => void>(() => {});
  function act(a: string) { actRef.current(a); }
  actRef.current = (a: string) => {
    const r = runRef.current;
    if (!r) return;
    if (a === "next") { markDone(r.i, r); go(r.i + 1); }
    else if (a === "prev") go(r.i - 1);
    else if (a === "end") end(false);
    else if (a === "finish") end(true);
    else if (a === "full") { end(true); start({ kind: "full" }); }
    else if (a === "center") { end(true); setCenter("menu"); }
    else if (a.startsWith("chapter:")) { end(true); start({ kind: "chapter", id: a.slice(8) }); }
    else if (a.startsWith("goto:")) { end(true); nav(a.slice(5)); }
  };

  // Keyboard: arrows move, Escape leaves the tour (and nothing underneath, such as an open drawer).
  useEffect(() => {
    if (!run) return;
    const onKey = (e: KeyboardEvent) => {
      if (transitRef.current) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest("input, textarea, select, [contenteditable=true], [role=tablist], [role=radiogroup], [role=grid]");
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); end(false); }
      else if (!typing && e.key === "ArrowRight") { e.preventDefault(); actRef.current(run.i === run.list.length - 1 ? "finish" : "next"); }
      else if (!typing && e.key === "ArrowLeft") { e.preventDefault(); actRef.current("prev"); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [run, end]);

  // If the user navigates somewhere else mid-tour, pause instead of pointing at nothing.
  useEffect(() => {
    const r = runRef.current;
    if (!r || transitRef.current || paused) return;
    const s = r.list[r.i];
    if (s.route && !routeMatches(s.route)) { seq.current++; kill(); setPaused(true); }
  }, [loc.pathname, loc.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Theme switch mid-step: redraw with the right overlay.
  useEffect(() => { const r = runRef.current; if (r && !paused && !transitRef.current && drv.current) go(r.i); }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Tour this page" buttons in page headers.
  useEffect(() => {
    const on = (e: Event) => { const id = CHAPTER_FOR_GUIDE[(e as CustomEvent<string>).detail]; if (id) start({ kind: "chapter", id }); };
    window.addEventListener("satsa:tour-page", on);
    return () => window.removeEventListener("satsa:tour-page", on);
  }, [start]);

  // First visit: offer the tour once.
  useEffect(() => {
    if (saved.seen || loc.pathname === "/overview") return;
    const t = setTimeout(() => setCenter((c) => c ?? "welcome"), 900);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => kill(), [kill]);

  const open = useCallback(() => { if (runRef.current) end(false); setCenter("menu"); }, [end]);
  // Only changes when a tour starts or ends: changing it per step would re-render every page (and replay
  // every chart animation) on each stop.
  const running = !!run;
  const value = useMemo(() => ({ open, start, running }), [open, start, running]);

  return (
    <TourCtx.Provider value={value}>
      {children}
      {createPortal(
        <AnimatePresence>
          {transit && (
            <motion.div key="transit" className="sa-tr-pill" role="status" aria-live="polite"
              initial={{ opacity: 0, y: 16, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 10, x: "-50%" }} transition={{ duration: 0.25 }}>
              <LatticeLoader label={`Opening ${transit.title}`} pattern="orbit" grid={3} cellSize={4} gap={2} fontSize={13} glow color={p.accent} showTimer={false} />
            </motion.div>
          )}
          {run && paused && (
            <motion.div key="paused" className="sa-tr-pill is-paused" role="status"
              initial={{ opacity: 0, y: 16, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 10, x: "-50%" }} transition={{ duration: 0.25 }}>
              <PlayFilledAlt size={14} />
              <span><b>Tour paused</b> at stop {run.i + 1} of {run.list.length}, {run.list[run.i].chapter.title}</span>
              <button type="button" className="sa-btn sa-btn--primary sa-btn--sm" onClick={() => go(run.i)}>Resume</button>
              <button type="button" className="sa-tr-pill__x" aria-label="End the tour" onClick={() => end(false)}><Close size={16} /></button>
            </motion.div>
          )}
        </AnimatePresence>, document.body)}
      <AnimatePresence>
        {center && <TourCenter key="center" welcome={center === "welcome"} saved={saved} path={loc.pathname}
          onClose={() => { setCenter(null); persist((p) => ({ ...p, seen: true })); }} onStart={start} />}
      </AnimatePresence>
    </TourCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Tour Center: pick the quick tour, the full tour, this page, or any chapter.
// ---------------------------------------------------------------------------
function TourCenter({ welcome, saved, path, onClose, onStart }: { welcome: boolean; saved: Saved; path: string; onClose: () => void; onStart: (m: Mode, from?: number) => void }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const quick = build({ kind: "quick" }).length, full = build({ kind: "full" }).length;
  const here = CHAPTERS.find((c) => c.match(path));
  const chapters = CHAPTERS.filter((c) => c.id !== "finish");
  const res = saved.resume;
  const resList = res ? build(res.mode) : [];
  const canResume = res && res.i > 0 && res.i < resList.length;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, [onClose]);
  return createPortal(
    <motion.div className="sa-tc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div ref={ref} className="sa-tc__panel" role="dialog" aria-modal="true" aria-labelledby="tc-title"
        initial={{ opacity: 0, y: reduce ? 0 : 24, scale: reduce ? 1 : 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduce ? 0 : 12 }}
        transition={{ type: "spring", bounce: 0.16, duration: 0.5 }}>
        <button type="button" className="sa-tc__x" aria-label="Close" onClick={onClose}><Close size={20} /></button>
        <header className="sa-tc__head">
          <span className="sa-tc__badge" aria-hidden="true"><PlayFilledAlt size={20} /></span>
          <div>
            <h2 id="tc-title">{welcome ? "New here? Take a guided tour" : "Guided tour"}</h2>
            <p>Real screens, one spotlight at a time. Every stop says what you are looking at and why it matters. You can leave at any moment and pick up where you left off.</p>
          </div>
        </header>

        {canResume && (
          <button type="button" className="sa-tc__resume" onClick={() => onStart(res!.mode, res!.i)}>
            <Renew size={16} />
            <span><b>Resume {modeLabel(res!.mode).toLowerCase()}</b> at stop {res!.i + 1} of {resList.length}: {resList[res!.i]?.chapter.title}</span>
            <ArrowRight size={16} />
          </button>
        )}

        <div className="sa-tc__options">
          <button type="button" className="sa-tc__opt is-primary" data-autofocus onClick={() => onStart({ kind: "quick" })}>
            <span className="sa-tc__opticon"><Rocket size={20} /></span>
            <b>Quick tour</b>
            <span>The essentials: where to look, why an entity is flagged, how the examiner decides, and why the flags can be trusted.</span>
            <small><Time size={14} /> about {minutes(quick)} min · {quick} stops</small>
          </button>
          <button type="button" className="sa-tc__opt" onClick={() => onStart({ kind: "full" })}>
            <span className="sa-tc__opticon"><MapIcon size={20} /></span>
            <b>Full tour</b>
            <span>Every screen, chapter by chapter, with things to try along the way.</span>
            <small><Time size={14} /> about {minutes(full)} min · {full} stops</small>
          </button>
          {here && here.steps.length > 0 && (
            <button type="button" className="sa-tc__opt" onClick={() => onStart({ kind: "chapter", id: here.id })}>
              <span className="sa-tc__opticon"><Location size={20} /></span>
              <b>This page: {here.title}</b>
              <span>{here.blurb}</span>
              <small><Time size={14} /> about {minutes(here.steps.length)} min · {here.steps.length} stops</small>
            </button>
          )}
        </div>

        <div className="sa-tc__chapters">
          <div className="sa-tc__label"><span>Or jump to a chapter</span><span>{saved.done.filter((d) => chapters.some((c) => c.id === d)).length} of {chapters.length} seen</span></div>
          <ol>
            {chapters.map((c, k) => {
              const seen = saved.done.includes(c.id);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => onStart({ kind: "chapter", id: c.id })} className={seen ? "is-seen" : ""}>
                    <span className="sa-tc__no">{String(k + 1).padStart(2, "0")}</span>
                    <span className="sa-tc__cicon"><c.icon size={16} /></span>
                    <span className="sa-tc__ctext"><b>{c.title}</b><small>{c.blurb}</small></span>
                    {seen ? <CheckmarkFilled size={16} className="sa-ok" aria-label="seen" /> : <span className="sa-tc__stops">{c.steps.length}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <footer className="sa-tc__foot">
          <span><kbd>←</kbd><kbd>→</kbd> move · <kbd>Esc</kbd> leave</span>
          <span>Every page also has <b>How to read this page</b> and a <b>?</b> on every number.</span>
          {welcome && <button type="button" className="sa-linkbtn" onClick={onClose}>Not now</button>}
        </footer>
      </motion.div>
    </motion.div>, document.body);
}
