// Counts a number up once it scrolls into view (and re-counts when the value changes). Reduced motion: no count.
import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

export default function CountUp({ value, decimals = 0, prefix = "", suffix = "", duration = 1.1, className }: {
  value: number | null | undefined; decimals?: number; prefix?: string; suffix?: string; duration?: number; className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const last = useRef(0);
  const fmt = (v: number) => `${prefix}${v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
  useEffect(() => {
    const el = ref.current;
    if (!el || value == null) return;
    if (reduce) { el.textContent = fmt(value); last.current = value; return; }
    if (!inView) return;
    const c = animate(last.current, value, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => { el.textContent = fmt(v); } });
    last.current = value;
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, inView, reduce]);
  // The initial text is the true value, so the number is right even where the animation never runs.
  return <span ref={ref} className={className}>{value == null ? "…" : fmt(value)}</span>;
}
