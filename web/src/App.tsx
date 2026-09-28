import { NavLink, Route, Routes } from "react-router-dom";
import QueuePage from "./pages/Queue";
import EntityPage from "./pages/Entity";
import ReviewPage from "./pages/Review";
import BlindspotPage from "./pages/Blindspots";
import ProvidersPage from "./pages/Providers";
import ValidationPage from "./pages/Validation";
import LedgerPage from "./pages/Ledger";
import IngestPage from "./pages/Ingest";

const NAV = [
  ["/", "Supervisory queue"],
  ["/blindspots", "Blind-spot matrix"],
  ["/review/BFS-02", "Review lab"],
  ["/providers", "Providers (systemic)"],
  ["/validation", "Validation"],
  ["/ledger", "Audit ledger"],
  ["/ingest", "Ingest submission"],
];

export default function App() {
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">SAT-SA<small>Supervisory Analytics Tool for SOC Assessment</small></div>
        <nav className="nav">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>
          ))}
        </nav>
        <div className="offline">● Air-gapped mode — no external calls. Flags are for examiner review; the examiner decides.</div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<QueuePage />} />
          <Route path="/entity/:id" element={<EntityPage />} />
          <Route path="/review/:id" element={<ReviewPage />} />
          <Route path="/blindspots" element={<BlindspotPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/validation" element={<ValidationPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/ingest" element={<IngestPage />} />
        </Routes>
      </main>
    </div>
  );
}
