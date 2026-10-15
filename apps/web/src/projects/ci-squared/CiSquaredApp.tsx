/**
 * CI Squared's pages (request 61: the shell, sign-in and Admin are the
 * platform's, App.tsx). The live pages, or (request 55) the Test tab's under
 * /test, which keep in step with the SharePoint workbook (TestSpaceSync).
 */
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { canSeeTab, type Me, type NavTab } from "@eradigm/shared";
import { SPACE } from "../../api/space";
import { DB_PREFIX } from "./components/DatabaseFilters";
import { TestSpaceSync } from "./components/ExcelSync";
import { ClientInboxPage } from "./pages/ClientInboxPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DatabasePage } from "./pages/DatabasePage";
import { InboxPage } from "./pages/InboxPage";
import { InputPage } from "./pages/InputPage";
import { SourcePage } from "./pages/SourcePage";

// Loaded on first visit: it carries the 3D graph (three.js).
const MegatrendsPage = lazy(() => import("./pages/MegatrendsPage").then((m) => ({ default: m.MegatrendsPage })));
const CompetitorsPage = lazy(() => import("./pages/CompetitorsPage").then((m) => ({ default: m.CompetitorsPage })));
const TrendAnalysisPage = lazy(() => import("./pages/TrendAnalysisPage").then((m) => ({ default: m.TrendAnalysisPage })));

export const TITLES: Record<string, string> = { "/dashboard": "Megatrends Dashboard", "/database": "Database", "/megatrends": "Knowledge Graph · Megatrends", "/competitors": "Knowledge Graph · Competitors", "/analytics/megatrends": "Trends Analysis · Megatrends", "/analytics/competitors": "Trends Analysis · Competitors", "/inbox": "Eradigm Inbox", "/client-inbox": "Client Inbox", "/input": "Input", "/admin": "Admin" };

export function CiSquaredApp({ me }: { me: Me }) {
  const loc = useLocation();
  // Full-window saved-source viewer (opened in a new tab from the Inbox).
  if (loc.pathname.startsWith("/source/")) {
    return (
      <Routes>
        <Route path="/source/:id" element={<SourcePage me={me} />} />
      </Routes>
    );
  }
  return (
    // Request 56: the Test pages keep in step with the workbook every 10 seconds; its status and problems are on the Admin page.
    // Request 57: their headers have Sync now (TestSyncButton).
    <TestSpaceSync enabled={SPACE === "test"}>{SPACE === "test" ? <TestRoutes me={me} /> : <LiveRoutes me={me} />}</TestSpaceSync>
  );
}

function LiveRoutes({ me }: { me: Me }) {
  const role = me.role;
  // Each role sees only its own tabs; any other page redirects to the Dashboard (the API enforces its own rules).
  const only = (tab: NavTab, page: ReactNode) => (canSeeTab(role, tab) ? page : <Navigate to="/dashboard" replace />);
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<DashboardPage me={me} />} />
      {/* Request 48: the Signals and Phantoms Databases and CI analyses are on the Database page (old links still work). */}
      <Route path="/tracker" element={<ToDatabase />} />
      <Route path="/phantoms" element={<ToDatabase />} />
      {/* Request 56: the Primary Tracker is the Database's (old links keep their filters and open pop-ups). */}
      <Route path="/analytics/primary" element={<PrimaryToDatabase />} />
      <Route path="/trend-analyses" element={<ToDatabase ci />} />
      <Route path="/database" element={<DatabasePage me={me} />} />
      {/* Request 52: Admin → Deliverables is gone; its newsletters are on the Database page. */}
      <Route path="/deliverables" element={<Navigate to="/database?db=newsletters" replace />} />
      <Route
        path="/megatrends"
        element={
          <Suspense fallback={<div className="empty" role="status">Loading Megatrends…</div>}>
            <MegatrendsPage me={me} />
          </Suspense>
        }
      />
      <Route
        path="/competitors"
        element={
          <Suspense fallback={<div className="empty" role="status">Loading Competitors…</div>}>
            <CompetitorsPage me={me} />
          </Suspense>
        }
      />
      {/* Request 31: Trends Analysis lives under the Analytics Dashboard (it was the Megatrends / Competitors "Trend analysis" subtab). */}
      <Route
        path="/analytics/megatrends"
        element={
          <Suspense fallback={<div className="empty" role="status">Loading the trends analysis…</div>}>
            <TrendAnalysisPage key="macro" me={me} kind="macro" />
          </Suspense>
        }
      />
      <Route
        path="/analytics/competitors"
        element={
          <Suspense fallback={<div className="empty" role="status">Loading the trends analysis…</div>}>
            <TrendAnalysisPage key="competitor" me={me} kind="competitor" />
          </Suspense>
        }
      />
      <Route path="/megatrends/analysis" element={<MovedTo path="/analytics/megatrends" />} />
      <Route path="/competitors/analysis" element={<MovedTo path="/analytics/competitors" />} />
      <Route path="/inbox" element={only("inbox", <InboxPage me={me} />)} />
      <Route path="/client-inbox" element={only("clientinbox", <ClientInboxPage me={me} />)} />
      <Route path="/input" element={only("input", <InputPage me={me} />)} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

/**
 * Request 55: the Test tab's pages (under /test, in the test space): the
 * Database, the Megatrends Dashboard (with its Trends Analysis pages and
 * full-page graphs) and the Primary Tracker, exactly as the live ones. Any
 * other address opens the test Database.
 */
function TestRoutes({ me }: { me: Me }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/database" replace />} />
      <Route path="/database" element={<DatabasePage me={me} />} />
      <Route path="/dashboard" element={<DashboardPage me={me} />} />
      <Route path="/analytics/primary" element={<PrimaryToDatabase />} />
      <Route path="/tracker" element={<ToDatabase />} />
      <Route path="/phantoms" element={<ToDatabase />} />
      <Route path="/trend-analyses" element={<ToDatabase ci />} />
      <Route path="/deliverables" element={<Navigate to="/database?db=newsletters" replace />} />
      <Route
        path="/megatrends"
        element={
          <Suspense fallback={<div className="empty" role="status">Loading Megatrends…</div>}>
            <MegatrendsPage me={me} />
          </Suspense>
        }
      />
      <Route
        path="/competitors"
        element={
          <Suspense fallback={<div className="empty" role="status">Loading Competitors…</div>}>
            <CompetitorsPage me={me} />
          </Suspense>
        }
      />
      <Route
        path="/analytics/megatrends"
        element={
          <Suspense fallback={<div className="empty" role="status">Loading the trends analysis…</div>}>
            <TrendAnalysisPage key="macro" me={me} kind="macro" />
          </Suspense>
        }
      />
      <Route
        path="/analytics/competitors"
        element={
          <Suspense fallback={<div className="empty" role="status">Loading the trends analysis…</div>}>
            <TrendAnalysisPage key="competitor" me={me} kind="competitor" />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/database" replace />} />
    </Routes>
  );
}

/**
 * Request 48: an old Signals Database, Phantoms Database or CI analyses
 * address opens the Database page, with its filters (the Database keeps them
 * under `db.`) and any open record, Markdown or page.
 */
/** Request 56: Analytics → Primary Tracker is now Database → Primary Tracker (the same page, its parameters kept). */
function PrimaryToDatabase() {
  const loc = useLocation();
  const p = new URLSearchParams(loc.search);
  p.delete("db");
  p.set("stream", "primary");
  return <Navigate to={`/database?${p.toString()}`} replace />;
}

function ToDatabase({ ci = false }: { ci?: boolean }) {
  const loc = useLocation();
  const p = new URLSearchParams();
  new URLSearchParams(loc.search).forEach((v, k) => {
    const filter = k === "q" || k === "from" || k === "to" || /^(f|t|df|dt)\./.test(k);
    p.set(filter ? `${DB_PREFIX}${k}` : k, v);
  });
  if (ci) p.set("db", "ci");
  const q = p.toString();
  return <Navigate to={`/database${q ? `?${q}` : ""}`} replace />;
}

/** An old address (bookmarks, shared links): the same view at its new path. */
function MovedTo({ path }: { path: string }) {
  const loc = useLocation();
  return <Navigate to={`${path}${loc.search}`} replace />;
}
