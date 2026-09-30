import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Blockchain, CheckmarkFilled, ErrorFilled, Locked, Renew, Search, Unlocked } from "@carbon/icons-react";
import { api } from "../api";
import { Badge, Btn, Callout, ErrorBox, Hold, Info, Tipped, Loading, PageHeader } from "../components/ui";
import Pagination, { paginate } from "../components/fx/Pagination";
import { useToast } from "../components/fx/toast";
import { useData } from "../hooks";

const PER_PAGE = 12;
const GUIDE = [
  { icon: Blockchain, title: "Append-only", text: "Every submission, analysis run, sample draw and examiner verdict is appended with the hash of the entry before it." },
  { icon: Locked, title: "Verify", text: "Recomputes every SHA-256 hash from the start. One edited byte anywhere breaks every later link." },
  { icon: Unlocked, title: "Tamper demo", text: "Edits a copy of the ledger (never the real one) and shows exactly which entry breaks." },
];
// Payloads are small JSON objects; show them as key=value pairs instead of a raw dump.
const summarise = (o: any) => (o && typeof o === "object"
  ? Object.entries(o).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("  ")
  : String(o ?? "")).slice(0, 180);
const tone = (t: string): "accent" | "ok" | "review" | "ai" | "neutral" => (t.includes("disposition") ? "review" : t.includes("analysis") ? "accent" : t.includes("submission") || t.includes("ingest") ? "ok" : t.includes("review") || t.includes("label") || t.includes("sample") ? "ai" : "neutral");

export default function LedgerPage() {
  const toast = useToast();
  const reduce = useReducedMotion();
  const { data, error, reload } = useData(() => api.ledger(), []);
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [runId, setRunId] = useState(0);
  const act = async (p: () => Promise<any>, kind: "verify" | "tamper") => {
    setBusy(true); setActErr(null);
    try {
      const r = await p();
      setCheck({ ...r, kind }); setRunId((n) => n + 1);
      if (r.ok) toast({ kind: "ok", title: "Chain intact", description: `${r.entries} entries verified from the first to the last hash.` });
      else toast({ kind: "error", title: `Chain broken at entry #${r.broken_at}`, description: kind === "tamper" ? "Demo copy edited. The real ledger is untouched." : r.problems?.[0] });
    } catch (e) { setActErr(String(e)); } finally { setBusy(false); }
  };
  const asc = useMemo(() => (data?.entries ?? []).slice().sort((a: any, b: any) => a.seq - b.seq), [data]);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading page label="Reading the audit ledger" />;
  const broken = check && !check.ok ? check.broken_at : null;
  const center = broken ?? asc[asc.length - 1]?.seq ?? 0;
  const win = asc.filter((e: any) => broken != null ? e.seq >= center - 2 && e.seq <= center + 3 : e.seq > center - 6);
  const rows = data.entries.filter((e: any) => !q || `${e.type} ${e.actor} ${JSON.stringify(e.payload)} ${e.hash}`.toLowerCase().includes(q.toLowerCase()));
  const paged = paginate(rows, page, PER_PAGE);
  return (
    <>
      <PageHeader title="Audit ledger" guideKey="ledger" guide={GUIDE}
        lead="Every submission, analysis run, sample draw and examiner verdict is appended to a SHA-256 hash chain. Editing any past record breaks every later hash."
        actions={<>
          <Btn kind="primary" icon={Locked} iconLeft disabled={busy} onClick={() => act(api.ledgerVerify, "verify")} title="Recompute every hash from the first entry to the last">Verify chain</Btn>
          <Hold tone="confirmed" done="Tampered copy" disabled={busy} onHold={() => act(api.ledgerTamper, "tamper")}>Hold: tamper demo (a copy)</Hold>
          <Info tip={{ title: "Tamper demo", text: "Press and hold to edit one entry in a copy of the ledger, never the real one, and see exactly which link breaks. Verify chain afterwards confirms the real ledger is intact." }} />
          <Btn kind="ghost" icon={Renew} label="Refresh entries" onClick={reload} />
        </>} />

      <section className="sa-card sa-chainwrap" aria-label="Hash chain">
        <div className="sa-card__head"><div>
          <h2 className="sa-card__title">{check ? (check.ok ? <><CheckmarkFilled className="sa-ok" /> Chain intact: {check.entries} entries</> : <><ErrorFilled className="sa-confirmed" /> Chain broken at entry #{check.broken_at}</>) : <>Latest {win.length} links of {asc.length}</>}<Info tip="hash" /></h2>
          <p className="sa-card__sub">{check ? (check.ok ? `Head ${check.head?.slice(0, 24)}…` : check.problems?.join("; ")) : "Each block stores the hash of the one before it. Verify to recompute them."}</p>
        </div>{check && !check.ok && check.kind === "tamper" && <Badge kind="neutral">demo copy only</Badge>}</div>
        <div className="sa-chain" key={runId}>
          {win.map((e: any, i: number) => {
            const state = !check ? "idle" : check.ok ? "ok" : e.seq < broken ? "ok" : e.seq === broken ? "bad" : "after";
            return (
              <motion.div key={e.seq} className={`sa-block-link is-${state}`}
                initial={check && !reduce ? { opacity: 0.35, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduce ? 0 : i * 0.08, duration: 0.35 }}>
                {i > 0 && <span className="sa-block-link__bond" aria-hidden="true" />}
                <div className="sa-block-link__box">
                  <span className="sa-block-link__seq">#{e.seq}</span>
                  <span className="sa-block-link__type">{e.type.replace(/_/g, " ")}</span>
                  <span className="sa-block-link__hash sa-mono">{e.hash.slice(0, 10)}</span>
                  <span className="sa-block-link__prev sa-mono">prev {e.prev_hash.slice(0, 6)}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>
      {actErr && <div className="sa-section"><ErrorBox e={actErr} title="The check did not run" /></div>}
      {check && !check.ok && check.kind === "tamper" && <div className="sa-section"><Callout kind="review" title="This was the tamper demo">It edited a copy of the ledger to show detection. Press Verify chain to confirm the real ledger is intact.</Callout></div>}

      <section className="sa-section">
        <div className="sa-toolbar">
          <h2 className="sa-h2">Entries <span className="sa-muted" style={{ fontWeight: 400 }}>({data.entries.length})</span><Info tip="ledger" /></h2>
          <label className="sa-search"><Search size={16} aria-hidden="true" /><input type="search" placeholder="Filter by event, actor, entity or hash" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Filter entries" /></label>
        </div>
        <div className="sa-card sa-card--flush">
          <div className="sa-tablewrap">
            <table className="sa-t sa-t--sm">
              <thead><tr><th className="is-num">#</th><th>Time (UTC)</th><th>Event</th><th><Tipped text="Actor" tip={{ title: "Actor", text: "Who made the entry: the system, an analysis run or a named examiner." }} /></th><th><Tipped text="Payload" tip={{ title: "Payload", text: "What the entry records, as key=value pairs. Hover a row's payload to read all of it." }} /></th><th><Tipped text="Hash" tip="hash" /></th></tr></thead>
              <tbody>{paged.rows.map((e: any) => (
                <tr key={e.seq} className={broken === e.seq ? "is-broken" : ""}>
                  <td className="is-num sa-mono">{e.seq}</td><td className="sa-mono sa-nowrap">{e.ts.slice(0, 19).replace("T", " ")}</td>
                  <td><Badge kind={tone(e.type)}>{e.type.replace(/_/g, " ")}</Badge></td><td>{e.actor}</td>
                  <td className="sa-mono sa-muted"><div className="sa-payload" title={summarise(e.payload)}>{summarise(e.payload)}</div></td>
                  <td className="sa-mono">{e.hash.slice(0, 12)}…</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="sa-tablefoot"><Pagination page={paged.page} pages={paged.pages} onChange={setPage} total={rows.length} perPage={PER_PAGE} label="Ledger pages" /></div>
        </div>
      </section>
    </>
  );
}
