import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { canSeeTab, type Me, type NavTab } from "@eradigm/shared";
import { useMe } from "./api/hooks";
import { getContractWarning } from "./api/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { DashboardPage } from "./pages/DashboardPage";
import { InboxPage } from "./pages/InboxPage";
import { ClientInboxPage } from "./pages/ClientInboxPage";
import { InputPage } from "./pages/InputPage";
import { AdminPage } from "./pages/AdminPage";
import { InvitePage, SignInPage } from "./pages/SignInPage";
import { SourcePage } from "./pages/SourcePage";
import { DatabasePage } from "./pages/DatabasePage";
import { DB_PREFIX } from "./components/DatabaseFilters";
import { TestSpaceSync } from "./components/ExcelSync";
import { SPACE } from "./api/space";

// Loaded on first visit: it carries the 3D graph (three.js).
const MegatrendsPage = lazy(() => import("./pages/MegatrendsPage").then((m) => ({ default: m.MegatrendsPage })));
const CompetitorsPage = lazy(() => import("./pages/CompetitorsPage").then((m) => ({ default: m.CompetitorsPage })));
const TrendAnalysisPage = lazy(() => import("./pages/TrendAnalysisPage").then((m) => ({ default: m.TrendAnalysisPage })));

const TITLES: Record<string, string> = { "/dashboard": "Megatrends Dashboard", "/database": "Database", "/megatrends": "Knowledge Graph · Megatrends", "/competitors": "Knowledge Graph · Competitors", "/analytics/megatrends": "Trends Analysis · Megatrends", "/analytics/competitors": "Trends Analysis · Competitors", "/inbox": "Eradigm Inbox", "/client-inbox": "Client Inbox", "/input": "Input", "/admin": "Admin" };

export function App() {
  const loc = useLocation();
  // Public pages: sign-in and invite acceptance (no session needed).
  if (loc.pathname === "/signin") return <SignInPage />;
  if (loc.pathname.startsWith("/invite/")) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
      </Routes>
    );
  }
  return <SignedIn />;
}

function SignedIn() {
  const me = useMe();
  const loc = useLocation();
  useEffect(() => {
    document.title = `${SPACE === "test" ? "Test · " : ""}${TITLES[loc.pathname] ?? "Eradigm"} · Eradigm Competitive Intelligence`;
  }, [loc.pathname]);

  if (me.isLoading) return <div className="empty" role="status">Loading…</div>;
  if (me.isError || !me.data) {
    const e = me.error as { status?: number } | null;
    // Request 55: the Test tab is for admins only (the API refuses its space to anyone else).
    if (SPACE === "test" && e?.status === 403) {
      window.location.replace("/dashboard");
      return null;
    }
    if (e?.status === 401) return <Navigate to={`/signin?returnTo=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
    return <SignInPage problem={me.error} />;
  }
  const role = me.data.role;
  // Request 55: the Test tab is for admins only (the API refuses the test space to anyone else).
  if (SPACE === "test" && role !== "admin") {
    window.location.replace("/dashboard");
    return null;
  }
  // Each role sees only its own tabs; any other page redirects to the Dashboard (the API enforces its own rules).
  const only = (tab: NavTab, page: ReactNode) => (canSeeTab(role, tab) ? page : <Navigate to="/dashboard" replace />);
  const warning = getContractWarning();

  // Full-window saved-source viewer (opened in a new tab from the Inbox).
  if (loc.pathname.startsWith("/source/")) {
    return (
      <main id="main" tabIndex={-1}>
        {/* A page that fails shows a message instead of blanking the dashboard (reset on navigation). */}
        <ErrorBoundary key={loc.pathname} label="This page">
          <Routes>
            <Route path="/source/:id" element={<SourcePage me={me.data} />} />
          </Routes>
        </ErrorBoundary>
      </main>
    );
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <Sidebar me={me.data} />
      <main id="main" tabIndex={-1}>
        {warning && <div className="banner" role="alert">{warning}</div>}
        {SPACE === "test" && me.data.space !== "test" && (
          <div className="banner" role="alert">
            The API does not know the Test tab yet: deploy the API (and apply its migrations), then reload.
          </div>
        )}
        {/* Request 56: the Test pages keep in step with the workbook every 10 seconds; its status and problems are on the Admin page.
            Request 57: their headers have Sync now (TestSyncButton). */}
        <TestSpaceSync enabled={SPACE === "test"}>
        <ErrorBoundary key={loc.pathname} label="This page">
          {SPACE === "test" ? <TestRoutes me={me.data} /> : (
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage me={me.data} />} />
            {/* Request 48: the Signals and Phantoms Databases and CI analyses are on the Database page (old links still work). */}
            <Route path="/tracker" element={<ToDatabase />} />
            <Route path="/phantoms" element={<ToDatabase />} />
            {/* Request 56: the Primary Tracker is the Database's (old links keep their filters and open pop-ups). */}
            <Route path="/analytics/primary" element={<PrimaryToDatabase />} />
            <Route path="/trend-analyses" element={<ToDatabase ci />} />
            <Route path="/database" element={<DatabasePage me={me.data} />} />
            {/* Request 52: Admin → Deliverables is gone; its newsletters are on the Database page. */}
            <Route path="/deliverables" element={<Navigate to="/database?db=newsletters" replace />} />
            <Route
              path="/megatrends"
              element={
                <Suspense fallback={<div className="empty" role="status">Loading Megatrends…</div>}>
                  <MegatrendsPage me={me.data} />
                </Suspense>
              }
            />
            <Route
              path="/competitors"
              element={
                <Suspense fallback={<div className="empty" role="status">Loading Competitors…</div>}>
                  <CompetitorsPage me={me.data} />
                </Suspense>
              }
            />
            {/* Request 31: Trends Analysis lives under the Analytics Dashboard (it was the Megatrends / Competitors "Trend analysis" subtab). */}
            <Route
              path="/analytics/megatrends"
              element={
                <Suspense fallback={<div className="empty" role="status">Loading the trends analysis…</div>}>
                  <TrendAnalysisPage key="macro" me={me.data} kind="macro" />
                </Suspense>
              }
            />
            <Route
              path="/analytics/competitors"
              element={
                <Suspense fallback={<div className="empty" role="status">Loading the trends analysis…</div>}>
                  <TrendAnalysisPage key="competitor" me={me.data} kind="competitor" />
                </Suspense>
              }
            />
            <Route path="/megatrends/analysis" element={<MovedTo path="/analytics/megatrends" />} />
            <Route path="/competitors/analysis" element={<MovedTo path="/analytics/competitors" />} />
            <Route path="/inbox" element={only("inbox", <InboxPage me={me.data} />)} />
            <Route path="/client-inbox" element={only("clientinbox", <ClientInboxPage me={me.data} />)} />
            <Route path="/input" element={only("input", <InputPage me={me.data} />)} />
            <Route path="/admin" element={only("admin", <AdminPage me={me.data} />)} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          )}
        </ErrorBoundary>
        </TestSpaceSync>
      </main>
    </div>
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
