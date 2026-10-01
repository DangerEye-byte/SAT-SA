import { useEffect, useState } from "react";
import { CheckmarkFilled, Close, DataCheck, Document, DocumentImport, FingerprintRecognition, Renew } from "@carbon/icons-react";
import { FileUploaderDropContainer } from "@carbon/react";
import { api } from "../api";
import { Badge, Btn, Callout, ErrorBox, Hold, Info, Tipped, LatticeLoader, Loading, PageHeader } from "../components/ui";
import { useToast } from "../components/fx/toast";
import { useTheme } from "../theme";

const GUIDE = [
  { icon: DocumentImport, title: "Add one submission", text: "CSV, JSON, JSON-lines, Parquet or SQLite exports of alerts, cases, workflow events, escalations and assets. Vendor column names are mapped automatically." },
  { icon: DataCheck, title: "Validate", text: "Malformed files are rejected with row numbers, never silently repaired. Every file is fingerprinted with SHA-256." },
  { icon: FingerprintRecognition, title: "Commit", text: "Hold to commit: the analysis re-runs in the background and the queue switches over when it finishes." },
];
const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export default function IngestPage() {
  const { p } = useTheme();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [rep, setRep] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [job, setJob] = useState<any>(null);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(async () => {
      try {
        const j = await api.job(job.job_id);
        setJob(j);
        if (j.status === "done") toast({ kind: "ok", title: "Analysis updated", description: `${(j.result?.merged?.entities || []).join(", ") || "Submission"} merged; the queue now reflects it.` });
        if (j.status === "failed") toast({ kind: "error", title: "Re-analysis failed", description: j.error });
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(t);
  }, [job, toast]);

  const validate = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.ingest(files);
      setRep(r);
      toast({ kind: r.accepted ? "ok" : "error", title: r.accepted ? "Submission accepted" : "Submission rejected", description: r.accepted ? `Ready to commit: ${r.entities?.join(", ")}` : "See the row-level errors below." });
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const commit = async () => {
    try { setJob({ ...(await api.ingestCommit(rep.token)), status: "running", log: [] }); } catch (e) { setErr(String(e)); }
  };
  const step = job?.status === "done" ? 4 : job ? 3 : rep?.accepted ? 2 : rep ? 1 : files.length ? 1 : 0;
  const reset = () => { setFiles([]); setRep(null); setJob(null); setErr(null); };

  return (
    <>
      <PageHeader title="Ingest a submission" guideKey="ingest" guide={GUIDE}
        lead="Bring in an entity's periodic submission. It is validated, fingerprinted in the audit ledger, merged and re-analysed on this machine."
        actions={(rep || files.length > 0) && <Btn kind="ghost" icon={Renew} iconLeft onClick={reset}>Start over</Btn>} />

      <ol className="sa-steps" aria-label="Ingest steps">
        {["Add files", "Validate", "Commit", "Re-analyse", "Review"].map((t, i) => (
          <li key={t} className={step > i ? "is-done" : step === i ? "is-now" : ""}><span>{step > i ? <CheckmarkFilled size={16} /> : i + 1}</span>{t}</li>))}
      </ol>

      <div className="sa-grid sa-grid--lead" style={{ alignItems: "start" }}>
        <section className="sa-card" aria-label="Upload">
          <h2 className="sa-card__title"><Tipped text="Submission files" tip={{ title: "One submission", text: "Every export file from one entity for one period: alerts, cases, workflow events, escalations and assets. CSV, JSON, JSON-lines, Parquet or SQLite; vendor column names are mapped automatically." }} /></h2>
          <p className="sa-card__sub" style={{ marginBottom: "1rem" }}>Add every file of one submission, then validate. Samples: <span className="sa-mono">data/samples/submission</span> (valid, 7 files) and <span className="sa-mono">data/samples/broken</span>.</p>
          <FileUploaderDropContainer multiple labelText="Drag files here or click to choose"
            onAddFiles={(_ev, { addedFiles }) => { setFiles((f) => [...f, ...Array.from(addedFiles || []).filter((a) => !f.some((x) => x.name === a.name))]); setRep(null); setJob(null); }} />
          {files.length > 0 && <ul className="sa-files">
            {files.map((f) => (
              <li key={f.name}>
                <Document size={16} /><span className="sa-mono">{f.name}</span><span className="sa-helper">{kb(f.size)}</span>
                {rep && (() => { const r = rep.files.find((x: any) => x.file === f.name); return r ? (r.errors.length ? <Badge kind="confirmed">{r.errors.length} error{r.errors.length > 1 ? "s" : ""}</Badge> : <Badge kind="ok">{r.rows.toLocaleString("en-IN")} rows · {r.table}</Badge>) : null; })()}
                {!job && <button type="button" className="sa-files__x" aria-label={`Remove ${f.name}`} onClick={() => { setFiles(files.filter((x) => x !== f)); setRep(null); }}><Close size={16} /></button>}
              </li>))}
          </ul>}
          <div className="sa-btns" style={{ marginTop: "1rem" }}>
            {busy ? <Loading inline label="Validating" /> : !rep && <Btn kind="primary" icon={DataCheck} iconLeft disabled={!files.length} onClick={validate}>Validate {files.length || ""} file{files.length === 1 ? "" : "s"}</Btn>}
            {rep?.accepted && !job && <><Hold onHold={commit} done="Committing" holdTime={1400}>Hold to commit and re-analyse</Hold><Info tip={{ title: "Commit", text: "Press and hold to merge the submission and re-run the analysis in the background on this machine. The queue switches over only when the new analysis finishes." }} /></>}
          </div>
          {err && <div style={{ marginTop: "1rem" }}><ErrorBox e={err} title="That step did not complete" /></div>}
        </section>

        <aside className="sa-stack">
          {!rep && !job && <section className="sa-card">
            <h2 className="sa-card__title"><Tipped text="What happens" tip={{ title: "Nothing leaves this machine", text: "Validation, fingerprinting and re-analysis all run locally and offline. Examiner labels, decisions and cached explanations carry over to the new analysis." }} /></h2>
            <ul className="sa-trust" style={{ marginTop: "0.75rem" }}>
              <li><b>Mapped, not guessed.</b> Column names such as <span className="sa-mono">AlertId</span>, <span className="sa-mono">Rule ID</span> and <span className="sa-mono">Hostname</span> map to the schema.</li>
              <li><b>Rejected with reasons.</b> Missing columns, bad timestamps and broken references come back with row numbers.</li>
              <li><b>Fingerprinted.</b> Each file's SHA-256 goes into the audit ledger.</li>
              <li><b>Re-analysed offline.</b> About two to three minutes on this laptop; labels, decisions and explanations carry over.</li>
            </ul>
          </section>}
          {rep && <Callout kind={rep.accepted ? "ok" : "confirmed"} icon={rep.accepted ? CheckmarkFilled : Close} title={rep.accepted ? "Submission accepted" : "Submission rejected"}>
            {rep.accepted ? `Entities: ${rep.entities?.join(", ")}. Hold the commit button to merge and re-analyse.` : "Nothing was merged. Fix the errors listed and validate again."}</Callout>}
          {rep?.integrity?.length > 0 && <Callout kind="review" title="Integrity notes">{rep.integrity.join("; ")}</Callout>}
          {job && <section className="sa-card sa-job" aria-live="polite">
            <div className="sa-row">
              <LatticeLoader label={job.status === "running" ? "Re-analysing" : job.status === "done" ? "Analysis updated in" : "Failed after"} doneLabel="Analysis updated in" errorLabel="Failed after"
                status={job.status === "running" ? "working" : job.status === "done" ? "done" : "error"} pattern="sweep" grid={4} glow color={p.accent} doneColor={p.ok} errorColor={p.confirmed}
                cellSize={6} gap={2} fontSize={14} elapsed={job.status === "running" ? undefined : job.elapsed ?? job.seconds} />
            </div>
            <pre className="sa-terminal">{(job.log || []).slice(-10).join("\n") || "Starting…"}</pre>
            {job.status === "failed" && <ErrorBox e={job.error ?? "unknown error"} title="Re-analysis failed" />}
            {job.status === "done" && <div className="sa-btns">
              {(job.result?.merged?.entities || []).map((e: string) => <Btn key={e} kind="primary" to={`/entity/${e}`}>Open {e} dossier</Btn>)}
              <Btn kind="secondary" to="/queue">See the queue</Btn></div>}
          </section>}
        </aside>
      </div>

      {rep && (
        <section className="sa-section">
          <div className="sa-card sa-card--flush">
            <div className="sa-card__head"><div><h2 className="sa-card__title"><Tipped text="Validation report" tip={{ title: "Validation report", text: "Errors (missing columns, bad timestamps, broken references) reject the whole submission; warnings are recorded but do not. SHA-256 is each file's fingerprint, written to the audit ledger." }} /></h2><p className="sa-card__sub">One row per file. Errors reject the submission; warnings do not.</p></div></div>
            <div className="sa-tablewrap">
              <table className="sa-t sa-t--sm">
                <thead><tr><th>File</th><th>Table</th><th className="is-num">Rows</th><th>Errors</th><th>Warnings</th><th>SHA-256</th></tr></thead>
                <tbody>{rep.files.map((f: any, i: number) => (
                  <tr key={i}><td className="sa-mono">{f.file}</td><td>{f.table}</td><td className="is-num">{f.rows?.toLocaleString("en-IN")}</td>
                    <td className="sa-confirmed" style={{ maxWidth: 320 }}>{f.errors.join("; ") || <span className="sa-helper">none</span>}</td>
                    <td className="sa-review" style={{ maxWidth: 260 }}>{f.warnings.join("; ") || <span className="sa-helper">none</span>}</td>
                    <td className="sa-mono sa-muted">{rep.sha256[f.file]?.slice(0, 16)}…</td></tr>))}</tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
