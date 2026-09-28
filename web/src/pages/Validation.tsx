import { api } from "../api";
import { ErrorBox, Loading } from "../components/ui";
import { useData } from "../hooks";

export default function ValidationPage() {
  const v = useData(() => api.validation(), []);
  const g = useData(() => api.guide(), []);
  if (v.error) return <ErrorBox e={v.error} />;
  if (!v.data) return <Loading />;
  return (
    <>
      <h1>Validation</h1>
      <p className="sub">How we know the flags are trustworthy. Synthetic results use the seeded panel with a hidden answer key
        (<b>numbers are on synthetic/seeded data</b>); real-data results use Microsoft GUIDE (6.1k organisations).</p>
      {!v.data.available ? <div className="card muted">Validation report not generated yet — run <span className="mono">python -m satsa.eval.run_all</span>.</div> :
        <pre className="note">{JSON.stringify(v.data, null, 2)}</pre>}
      {g.data?.available && <pre className="note" style={{ marginTop: 14 }}>{JSON.stringify(g.data, null, 2)}</pre>}
    </>
  );
}
