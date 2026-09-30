// Adapted from React Bits "BranchedMenu" (https://reactbits.dev), MIT + Commons Clause, (c) 2026 David Haz. See NOTICE.md.
// Changes for SAT-SA: items are router links, the active item follows the URL, icons are Carbon icons,
// each item carries a one-line description (tooltip), and all groups start open.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import "./BranchedMenu.css";

export type NavLeaf = { to: string; label: string; icon?: ReactNode; hint?: string };
export type NavGroup = { label: string; children: NavLeaf[] };

const PAD = 6;
const MARK = 16;

export default function NavTree({ items, active, width = 240, rowHeight = 36, indent = 40, trunk = 14, radius = 10, onNavigate }: {
  items: NavGroup[]; active: string; width?: number; rowHeight?: number; indent?: number; trunk?: number; radius?: number; onNavigate?: () => void;
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(items.map((_, i) => i)));
  const navRef = useRef<HTMLElement>(null);
  const heads = useRef<(HTMLButtonElement | null)[]>([]);
  const markerRef = useRef<HTMLSpanElement>(null);

  const activeSection = items.findIndex((it) => it.children.some((k) => k.to === active));
  const markerShown = activeSection >= 0 && open.has(activeSection);
  useLayoutEffect(() => {
    const place = (glide: boolean) => {
      const m = markerRef.current;
      const el = heads.current[activeSection];
      if (!m) return;
      const on = markerShown && el;
      if (!glide) m.style.transition = "none";
      if (on) m.style.top = `${el.offsetTop + (el.offsetHeight - MARK) / 2}px`;
      m.toggleAttribute("data-on", Boolean(on));
      if (!glide) { void m.offsetHeight; m.style.transition = ""; }
    };
    place(true);
    let first = true;
    const ro = new ResizeObserver(() => { if (first) { first = false; return; } place(false); });
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [activeSection, markerShown, items, rowHeight]);

  const toggle = (i: number) => setOpen((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const r = Math.min(radius, rowHeight / 2 - 2);
  const endX = indent - 8;
  const rowY = (k: number) => PAD + k * rowHeight + rowHeight / 2;
  const branch = (k: number) => `M ${trunk} ${rowY(k) - r} A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`;
  const reach = (k: number) => `M ${trunk} 0 V ${rowY(k) - r} A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`;
  const length = (k: number) => rowY(k) - r + (Math.PI * r) / 2 + (endX - trunk - r);

  return (
    <nav ref={navRef} aria-label="Primary" className="branched-menu sa-navtree"
      style={{ "--bm-w": `${width}px`, "--bm-row": `${rowHeight}px`, "--bm-indent": `${indent}px` } as CSSProperties}>
      <span ref={markerRef} className="branched-menu__marker" aria-hidden="true" />
      {items.map((item, i) => {
        const kids = item.children;
        const isOpen = open.has(i);
        const bodyH = PAD * 2 + kids.length * rowHeight;
        return (
          <div key={item.label} className="branched-menu__section" data-open={isOpen ? "" : undefined}>
            <button ref={(el) => { heads.current[i] = el; }} type="button" className="branched-menu__head" aria-expanded={isOpen} onClick={() => toggle(i)}>
              {item.label}
            </button>
            <div className="branched-menu__body">
              <div className="branched-menu__fold">
                <div className="branched-menu__tree" style={{ height: bodyH }}>
                  <svg className="branched-menu__lines" width={indent} height={bodyH} aria-hidden="true">
                    <path className="branched-menu__base" d={`M ${trunk} 0 V ${rowY(kids.length - 1) - r}`} />
                    {kids.map((kid, k) => <path key={kid.to} className="branched-menu__base" d={branch(k)} />)}
                    {kids.map((kid, k) => (
                      <path key={kid.to} className="branched-menu__reach" d={reach(k)}
                        style={{ strokeDasharray: length(k), strokeDashoffset: kid.to === active ? 0 : length(k) }} />
                    ))}
                  </svg>
                  {kids.map((kid) => (
                    <Link key={kid.to} to={kid.to} className="branched-menu__item" title={kid.hint}
                      aria-current={kid.to === active ? "page" : undefined} data-active={kid.to === active ? "" : undefined}
                      tabIndex={isOpen ? 0 : -1} onClick={onNavigate}>
                      {kid.icon ? <span className="branched-menu__icon" aria-hidden="true">{kid.icon}</span> : null}
                      <span className="branched-menu__label">{kid.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
