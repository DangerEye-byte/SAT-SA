import { useState } from "react";
import { api } from "../api";
import { ErrorBox, Loading } from "../components/ui";
import { useData } from "../hooks";

export default function LedgerPage() {
  const { data, error, reload } = useData(() => api.ledger(), []);
  const [check, setCheck] = useState<any>(null);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <h1>Audit ledger</h1>
      <p className="sub">Every submission, analysis run, sample draw and examiner verdict is appended to a SHA-256 hash chain. Editing any past
        record breaks every later hash.</p>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn good" onClick={async () => setCheck(await api.ledgerVerify())}>Verify chain</button>
        <button className="btn bad" onClick={async () => setCheck(await api.ledgerTamper())}>Tamper demo (edits a copy)</button>
        <button className="btn" onClick={reload}>Refresh</button>
        {check && (check.ok
          ? <span className="pill teal">✓ chain intact — {check.entries} entries · head {check.head?.slice(0, 16)}…</span>
          : <span className="pill red">✗ chain broken at entry #{check.broken_at}: {check.problems?.join("; ")}</span>)}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>#</th><th>Time (UTC)</th><th>Actor</th><th>Event</th><th>Payload</th><th>Hash</th></tr></thead>
          <tbody>{data.entries.map((e: any) => (
            <tr key={e.seq}>
              <td>{e.seq}</td><td className="mono">{e.ts}</td><td>{e.actor}</td><td>{e.type}</td>
              <td className="mono muted" style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis" }}>{JSON.stringify(e.payload).slice(0, 140)}</td>
              <td className="mono">{e.hash.slice(0, 12)}…</td>
            </tr>))}</tbody>
        </table>
      </div>
    </>
  );
}
