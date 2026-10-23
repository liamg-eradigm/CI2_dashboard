/**
 * CI Squared's pages (request 61: the shell, sign-in and Admin are the
 * platform's, App.tsx). Request 63: the Test tab (request 55) is gone; its
 * old addresses (/test/…) open the same pages.
 */
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { canSeeTab, type Me, type NavTab } from "@eradigm/shared";
import { DB_PREFIX } from "./components/DatabaseFilters";
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

export const TITLES: Record<string, string> = { "/dashboard": "Dashboard", "/database": "Database", "/megatrends": "Knowledge Graph · Megatrends", "/competitors": "Knowledge Graph · Competitors", "/analytics/megatrends": "Trends Analysis · Megatrends", "/analytics/competitors": "Trends Analysis · Competitors", "/inbox": "Eradigm Inbox", "/client-inbox": "Client Inbox", "/input": "New Entry", "/admin": "Admin" };

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
  return <LiveRoutes me={me} />;
}

function LiveRoutes({ me }: { me: Me }) {
  const role = me.role;
  // Each role sees only its own tabs; any other page redirects to the Dashboard (the API enforces its own rules).
  const only = (tab: NavTab, page: ReactNode) => (canSeeTab(role, tab) ? page : <Navigate to="/dashboard" replace />);
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      {/* Request 63: the Test tab is gone; its old addresses open the same pages. */}
      <Route path="/test/*" element={<FromTest />} />
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

/** Request 63: an old Test tab address (/test/…): the same page. */
function FromTest() {
  const loc = useLocation();
  return <Navigate to={`${loc.pathname.replace(/^\/test/, "") || "/dashboard"}${loc.search}`} replace />;
}
