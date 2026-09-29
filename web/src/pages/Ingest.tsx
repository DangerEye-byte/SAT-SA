import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function IngestPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [rep, setRep] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<any>(null);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(async () => setJob(await api.job(job.job_id)), 2000);
    return () => clearInterval(t);
  }, [job]);

  return (
    <>
      <h1>Ingest a periodic submission</h1>
      <p className="sub">CSV, JSON, JSON-lines, Parquet or SQLite exports of alerts, cases, workflow events, escalations and asset inventory. Column
        names are mapped automatically (e.g. <span className="mono">AlertId</span>, <span className="mono">Rule ID</span>, <span className="mono">Hostname</span>);
        malformed files are rejected with row numbers, never silently repaired. Every file is fingerprinted (SHA-256) in the audit ledger.
        Sample bundles: <span className="mono">data/samples/submission</span> (valid) and <span className="mono">data/samples/broken</span>.</p>
      <div className="card">
        <input type="file" multiple onChange={(e) => { setFiles(Array.from(e.target.files || [])); setRep(null); setJob(null); }} />
        <button className="btn primary" style={{ marginLeft: 10 }} disabled={!files.length || busy}
          onClick={async () => { setBusy(true); try { setRep(await api.ingest(files)); } finally { setBusy(false); } }}>Validate</button>
      </div>
      {rep && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>{rep.accepted ? <span className="good">✓ Submission accepted</span> : <span className="bad">✗ Submission rejected</span>}
            {rep.entities?.length > 0 && <span className="muted" style={{ fontSize: 13 }}> · entities: {rep.entities.join(", ")}</span>}</h2>
          <table><thead><tr><th>File</th><th>Table</th><th>Rows</th><th>Errors</th><th>Warnings</th><th>SHA-256</th></tr></thead>
            <tbody>{rep.files.map((f: any, i: number) => (
              <tr key={i}><td>{f.file}</td><td>{f.table}</td><td>{f.rows}</td><td className="bad">{f.errors.join("; ")}</td>
                <td className="warn">{f.warnings.join("; ")}</td><td className="mono">{rep.sha256[f.file]?.slice(0, 16)}…</td></tr>))}</tbody></table>
          {rep.integrity.length > 0 && <div className="warn" style={{ marginTop: 8 }}>Integrity: {rep.integrity.join("; ")}</div>}
          {rep.accepted && !job && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn good" onClick={async () => setJob({ ...(await api.ingestCommit(rep.token)), status: "running", log: [] })}>
                Commit and re-run the analysis</button>
              <span className="muted" style={{ fontSize: 13 }}>Runs in the background (about 2-3 minutes); the dashboard switches over when it finishes.</span>
            </div>)}
        </div>
      )}
      {job && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>{job.status === "running" ? "Re-analysing…" : job.status === "done" ? <span className="good">✓ Analysis updated</span> : <span className="bad">Failed</span>}
            {job.elapsed != null && <span className="muted" style={{ fontSize: 13 }}> · {job.elapsed.toFixed(0)} s</span>}</h2>
          <div className="note" style={{ maxHeight: 200, overflowY: "auto" }}>{(job.log || []).slice(-12).join("\n")}</div>
          {job.error && <div className="bad">{job.error}</div>}
          {job.status === "done" && <div className="row" style={{ marginTop: 10 }}>
            {(job.result?.merged?.entities || []).map((e: string) => <Link key={e} className="btn primary" to={`/entity/${e}`}>Open {e} dossier →</Link>)}
            <Link className="btn" to="/">Back to the queue</Link></div>}
        </div>
      )}
    </>
  );
}
