import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY } from "../glossary";

// "?" info tip. Pass a glossary key (tip="fdr"), plain text (tip="..."), or title + children.
// Hover or focus shows it; click or tap pins it; Escape or a click elsewhere closes it.
// Rendered as a span with role="button" so it is valid inside links, buttons and clickable rows,
// and it never lets a click through to them. The bubble is portalled so no card can clip it.
export type TipArg = string | { title?: ReactNode; text: ReactNode };

export function Info({ tip, title, children, label }: { tip?: TipArg; title?: ReactNode; children?: ReactNode; label?: string }) {
  const g = typeof tip === "string" ? GLOSSARY[tip] : undefined;
  const head = title ?? g?.title ?? (typeof tip === "object" ? tip.title : undefined);
  const body = children ?? g?.text ?? (typeof tip === "object" ? tip.text : tip);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; ax: number; below: boolean } | null>(null);
  const open = hover || pinned;

  const hoverTo = (v: boolean, delay: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHover(v), delay); };
  const close = useCallback(() => { window.clearTimeout(timer.current); setHover(false); setPinned(false); }, []);
  const place = useCallback(() => {
    const a = ref.current?.getBoundingClientRect(), b = box.current;
    if (!a || !b) return;
    const m = 12, w = b.offsetWidth, h = b.offsetHeight, vw = document.documentElement.clientWidth;
    const cx = a.left + a.width / 2, x = Math.max(m, Math.min(cx - w / 2, vw - m - w));
    const below = a.top - h - 10 < m;
    setPos({ x, y: below ? a.bottom + 10 : a.top - h - 10, ax: Math.max(12, Math.min(w - 12, cx - x)), below });
  }, []);

  useLayoutEffect(() => { if (open) place(); else setPos(null); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); ref.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, place, close]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toggle = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (pinned) close(); else setPinned(true);
  };
  const name = typeof head === "string" ? head : typeof label === "string" ? label : "this";

  return (
    <>
      <span ref={ref} role="button" tabIndex={0} className={`sa-info ${open ? "is-open" : ""}`} aria-label={label ?? `What is ${name}?`}
        aria-expanded={open} aria-describedby={open ? id : undefined}
        onMouseEnter={() => hoverTo(true, 90)} onMouseLeave={() => hoverTo(false, 120)}
        onFocus={() => setHover(true)} onBlur={close}
        onClick={toggle} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(e); }}>
        <span aria-hidden="true">?</span>
      </span>
      {open && createPortal(
        <div ref={box} id={id} role="tooltip" className={`sa-infotip ${pos?.below ? "is-below" : ""}`}
          style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? "visible" : "hidden", ["--ax" as string]: `${pos?.ax ?? 0}px` }}>
          {head && <b>{head}</b>}
          <span>{body}</span>
        </div>, document.body)}
    </>
  );
}

// A text label whose last word and "?" always wrap together, so the tip never sits alone on a line.
export function Tipped({ text, ...rest }: { text: string } & Parameters<typeof Info>[0]) {
  const i = text.lastIndexOf(" ");
  return <span>{text.slice(0, i + 1)}<span className="sa-nowrap">{text.slice(i + 1)}<Info {...rest} /></span></span>;
}
