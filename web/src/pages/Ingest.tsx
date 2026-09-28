import { useState } from "react";
import { api } from "../api";

export default function IngestPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [rep, setRep] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1>Ingest a periodic submission</h1>
      <p className="sub">CSV, JSON, Parquet or SQLite exports of alerts, cases, workflow events, escalations and asset inventory. Column names
        are mapped automatically; malformed files are rejected with line numbers — never silently repaired. Sample files: <span className="mono">data/samples/</span>.</p>
      <div className="card">
        <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        <button className="btn primary" style={{ marginLeft: 10 }} disabled={!files.length || busy}
          onClick={async () => { setBusy(true); try { setRep(await api.ingest(files)); } finally { setBusy(false); } }}>Validate</button>
      </div>
      {rep && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>{rep.accepted ? <span className="good">✓ Submission accepted</span> : <span className="bad">✗ Submission rejected</span>}</h2>
          <table><thead><tr><th>File</th><th>Table</th><th>Rows</th><th>Errors</th><th>Warnings</th><th>SHA-256</th></tr></thead>
            <tbody>{rep.files.map((f: any, i: number) => (
              <tr key={i}><td>{f.file}</td><td>{f.table}</td><td>{f.rows}</td><td className="bad">{f.errors.join("; ")}</td>
                <td className="warn">{f.warnings.join("; ")}</td><td className="mono">{rep.sha256[f.file]?.slice(0, 16)}…</td></tr>))}</tbody></table>
          {rep.integrity.length > 0 && <div className="warn" style={{ marginTop: 8 }}>Integrity: {rep.integrity.join("; ")}</div>}
        </div>
      )}
    </>
  );
}
