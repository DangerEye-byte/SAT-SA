// Before/after reveal: drag (or use the arrow keys on) the handle to uncover the right layer over the left.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight } from "@carbon/icons-react";

export default function CompareSlider({ left, right, leftLabel, rightLabel, start = 64, nudge = true }: {
  left: ReactNode; right: ReactNode; leftLabel: ReactNode; rightLabel: ReactNode; start?: number; nudge?: boolean;
}) {
  const [pos, setPos] = useState(start);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduce = useReducedMotion();
  const touched = useRef(false);

  // One gentle sweep when it first comes into view, so it reads as interactive.
  useEffect(() => {
    if (!inView || !nudge || reduce || touched.current) return;
    const c = animate(start, 16, { duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.3, onUpdate: (v) => !touched.current && setPos(v) });
    const back = setTimeout(() => { if (!touched.current) animate(16, start, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => !touched.current && setPos(v) }); }, 1300);
    return () => { c.stop(); clearTimeout(back); };
  }, [inView, nudge, reduce, start]);

  const setFrom = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div ref={ref} className="sa-compare"
      onPointerDown={(e) => { touched.current = true; dragging.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setFrom(e.clientX); }}
      onPointerMove={(e) => dragging.current && setFrom(e.clientX)}
      onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
      <div className="sa-compare__layer sa-compare__base">{right}</div>
      <div className="sa-compare__layer sa-compare__over" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>{left}</div>
      <span className="sa-compare__tag sa-compare__tag--left" style={{ opacity: pos > 18 ? 1 : 0 }}>{leftLabel}</span>
      <span className="sa-compare__tag sa-compare__tag--right" style={{ opacity: pos < 82 ? 1 : 0 }}>{rightLabel}</span>
      <div className="sa-compare__bar" style={{ left: `${pos}%` }}>
        <button type="button" className="sa-compare__handle" role="slider" aria-label="Reveal the paper trail" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { touched.current = true; setPos((p) => Math.max(0, p - 5)); }
            if (e.key === "ArrowRight") { touched.current = true; setPos((p) => Math.min(100, p + 5)); }
          }}>
          <ChevronLeft size={14} /><ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
