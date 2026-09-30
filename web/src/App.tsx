import { Suspense, lazy, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { PlayFilledAlt } from "@carbon/icons-react";
import Brand from "./components/Brand";
import QueuePage from "./pages/Queue";
import NotFound from "./pages/NotFound";
import NavTree from "./components/fx/NavTree";
import CardNav from "./components/fx/CardNav";
import { Btn, Info, Loading, ThemeToggle } from "./components/ui";
import { CARD_NAV, NAV, crumbsFor, navKey } from "./nav";
import { useTour } from "./tour";
import { useData, useRemScale } from "./hooks";
import { api, STATIC } from "./api";

// Heavier screens load on demand (still bundled locally; nothing leaves the machine).
const EntityPage = lazy(() => import("./pages/Entity"));
const ReviewPage = lazy(() => import("./pages/Review"));
const BlindspotPage = lazy(() => import("./pages/Blindspots"));
const ProvidersPage = lazy(() => import("./pages/Providers"));
const ValidationPage = lazy(() => import("./pages/Validation"));
const LedgerPage = lazy(() => import("./pages/Ledger"));
const IngestPage = lazy(() => import("./pages/Ingest"));
const RedTeamLab = lazy(() => import("./pages/RedTeamLab"));
const SectorsPage = lazy(() => import("./pages/Sectors"));
const OverviewPage = lazy(() => import("./pages/Overview"));
const CommandPage = lazy(() => import("./pages/Command"));

function Status() {
  const { data, error } = useData(() => api.meta(), []);
  return (
    <div className={`sa-status ${error ? "is-down" : ""}`} title={data ? `Analysis run ${data.run?.run_hash?.slice(0, 12)}` : undefined}>
      <i aria-hidden="true" />
      {error ? "API not reachable" : <span>{STATIC ? "Hosted demo" : "Offline"} · run <span className="sa-mono">{data?.run?.run_hash?.slice(0, 8) ?? "…"}</span></span>}
    </div>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const { open } = useTour();
  const rem = useRemScale();
  const c = crumbsFor(pathname);
  useEffect(() => { document.title = `${c.page} · SAT-SA`; window.scrollTo({ top: 0 }); }, [pathname, c.page]);
  return (
    <div className="sa-app">
      <aside className="sa-side" aria-label="Sidebar">
        <Brand />
        <div className="sa-side__nav" data-tour="nav"><NavTree items={NAV} active={navKey(pathname)} width={Math.round(236 * rem)} rowHeight={Math.round(36 * rem)} indent={Math.round(40 * rem)} trunk={Math.round(14 * rem)} radius={Math.round(10 * rem)} /></div>
        <div className="sa-side__foot">
          <Status />
          <p className="sa-policy">Air-gapped: no external calls. Flags are for examiner review; the examiner decides.</p>
        </div>
      </aside>
      <div className="sa-body-col">
        <header className="sa-top">
          <div className="sa-top__mobile" style={{ flex: 1 }}>
            <CardNav className="sa-mobilenav" brand={<Brand small />} items={CARD_NAV} cta={<ThemeToggle compact />} />
          </div>
          <nav className="sa-crumbs" aria-label="Breadcrumb">
            {c.group && <><span>{c.group}</span><span aria-hidden="true">/</span></>}<b>{c.page}</b>
          </nav>
          <span className="sa-top__spacer" />
          <div className="sa-top__actions">
            {STATIC && <span className="sa-demochip">Hosted demo<Info tip={{ title: "You are viewing the hosted demo", text: "A read-only snapshot of a real local run on synthetic data. SAT-SA itself is installed and run offline on the regulator's own machine; there, decisions, review labels and new submissions are saved and re-analysed." }} /></span>}
            <Btn kind="secondary" size="sm" icon={PlayFilledAlt} iconLeft onClick={open}>Guided tour</Btn>
            <ThemeToggle compact />
          </div>
        </header>
        <main className="sa-main" id="main">
          <Suspense fallback={<Loading page label="Loading" />}>
            <Routes>
              <Route path="/" element={<QueuePage />} />
              <Route path="/command" element={<CommandPage />} />
              <Route path="/entity/:id" element={<EntityPage />} />
              <Route path="/review/:id" element={<ReviewPage />} />
              <Route path="/blindspots" element={<BlindspotPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/validation" element={<ValidationPage />} />
              <Route path="/ledger" element={<LedgerPage />} />
              <Route path="/ingest" element={<IngestPage />} />
              <Route path="/sectors" element={<SectorsPage />} />
              <Route path="/redteam-lab" element={<RedTeamLab />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/overview" element={<Suspense fallback={<Loading page label="Loading" />}><OverviewPage /></Suspense>} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}
