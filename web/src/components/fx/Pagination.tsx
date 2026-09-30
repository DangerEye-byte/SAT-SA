// Pagination in two styles, after the 21st.dev "pagination6" (numbered, truncating ellipsis) and
// "pagination-arrows" (compact arrows + position) patterns. Written from scratch for SAT-SA.
import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import { motion } from "motion/react";
import { useId } from "react";

// 1 … 4 5 6 … 12 : always first/last, the current page and its neighbours.
export function pageList(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const lo = Math.max(2, Math.min(page - 1, pages - 4));
  const hi = Math.min(pages - 1, Math.max(page + 1, 5));
  if (lo > 2) out.push("gap");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pages - 1) out.push("gap");
  out.push(pages);
  return out;
}

export default function Pagination({ page, pages, onChange, variant = "numbers", label = "Pagination", total, perPage }: {
  page: number; pages: number; onChange: (p: number) => void; variant?: "numbers" | "arrows"; label?: string; total?: number; perPage?: number;
}) {
  const id = useId();
  if (pages <= 1 && variant === "numbers") return null;
  const prev = <button type="button" className="sa-pg__arrow" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
    <ChevronLeft size={16} /><span className="sa-pg__arrowtext">Previous</span></button>;
  const next = <button type="button" className="sa-pg__arrow sa-pg__arrow--next" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
    <span className="sa-pg__arrowtext">Next</span><ChevronRight size={16} /></button>;
  if (variant === "arrows")
    return (
      <nav className="sa-pg sa-pg--arrows" aria-label={label}>
        {prev}
        <span className="sa-pg__pos" aria-live="polite"><b>{page}</b> of {pages}</span>
        {next}
      </nav>
    );
  const from = total != null && perPage ? (page - 1) * perPage + 1 : null;
  return (
    <nav className="sa-pg" aria-label={label}>
      {from != null && <span className="sa-pg__range">{from} to {Math.min(total!, page * perPage!)} of {total}</span>}
      <div className="sa-pg__ctrl">
        {prev}
        <ul className="sa-pg__list">
          {pageList(page, pages).map((p, i) => p === "gap"
            ? <li key={`g${i}`} className="sa-pg__gap" aria-hidden="true">…</li>
            : <li key={p}>
                <button type="button" className="sa-pg__num" aria-current={p === page ? "page" : undefined} onClick={() => onChange(p)} aria-label={`Page ${p}`}>
                  {p === page && <motion.span layoutId={`pg-${id}`} className="sa-pg__ind" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />}
                  <span>{p}</span>
                </button>
              </li>)}
        </ul>
        {next}
      </div>
    </nav>
  );
}

// Slice helper so pages can paginate any list the same way.
export function paginate<T>(rows: T[], page: number, perPage: number) {
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((p - 1) * perPage, p * perPage), pages, page: p };
}
