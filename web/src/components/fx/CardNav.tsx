// Adapted from React Bits "CardNav" (https://reactbits.dev), MIT + Commons Clause, (c) 2026 David Haz. See NOTICE.md.
// Changes for SAT-SA: motion instead of GSAP, router links, Carbon icons, measured (not fixed) open height,
// Escape and outside-click close, and colours from the SAT-SA tokens.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "@carbon/icons-react";

export type CardNavLink = { label: string; to: string; hint?: string };
export type CardNavItem = { label: string; blurb?: string; tone?: "accent" | "ok" | "review" | "ai"; links: CardNavLink[] };

export default function CardNav({ brand, items, cta, className = "" }: { brand: ReactNode; items: CardNavItem[]; cta?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setH(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => { if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  const ease = [0.16, 1, 0.3, 1] as const;
  return (
    <div className={`card-nav-container ${className}`}>
      <motion.nav ref={navRef} className={`card-nav ${open ? "open" : ""}`} aria-label="Site"
        initial={false} animate={{ height: open ? 64 + h : 64 }} transition={{ duration: reduce ? 0 : 0.42, ease }}>
        <div className="card-nav-top">
          <button type="button" className={`hamburger-menu ${open ? "open" : ""}`} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
            onClick={() => setOpen(!open)}>
            <span className="hamburger-line" /><span className="hamburger-line" />
          </button>
          <div className="card-nav-brand">{brand}</div>
          <div className="card-nav-cta">{cta}</div>
        </div>
        <div ref={contentRef} className="card-nav-content" aria-hidden={!open} inert={!open}>
          {items.map((item, i) => (
            <motion.div key={item.label} className={`nav-card nav-card--${item.tone ?? "accent"}`}
              initial={false} animate={open ? { y: 0, opacity: 1 } : { y: 36, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.4, ease, delay: open && !reduce ? 0.08 + i * 0.07 : 0 }}>
              <div className="nav-card-label">{item.label}</div>
              {item.blurb && <p className="nav-card-blurb">{item.blurb}</p>}
              <div className="nav-card-links">
                {item.links.map((l) => (
                  <Link key={l.to} className="nav-card-link" to={l.to} title={l.hint} onClick={() => setOpen(false)}>
                    <ArrowUpRight size={16} aria-hidden="true" />{l.label}
                  </Link>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.nav>
    </div>
  );
}
