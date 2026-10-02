import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { canSeeTab, type NavTab } from "@eradigm/shared";
import { useMe } from "./api/hooks";
import { getContractWarning } from "./api/client";
import { Sidebar } from "./components/Sidebar";
import { DashboardPage } from "./pages/DashboardPage";
import { TrackerPage } from "./pages/TrackerPage";
import { DeliverablesPage } from "./pages/DeliverablesPage";
import { InboxPage } from "./pages/InboxPage";
import { ClientInboxPage } from "./pages/ClientInboxPage";
import { InputPage } from "./pages/InputPage";
import { AdminPage } from "./pages/AdminPage";
import { InvitePage, SignInPage } from "./pages/SignInPage";
import { SourcePage } from "./pages/SourcePage";

// Loaded on first visit: it carries the 3D graph (three.js).
const MegatrendsPage = lazy(() => import("./pages/MegatrendsPage").then((m) => ({ default: m.MegatrendsPage })));
const CompetitorsPage = lazy(() => import("./pages/CompetitorsPage").then((m) => ({ default: m.CompetitorsPage })));

const TITLES: Record<string, string> = { "/dashboard": "Dashboard", "/tracker": "Tracker", "/phantoms": "Phantoms", "/deliverables": "Deliverables", "/megatrends": "Megatrends", "/competitors": "Competitors", "/inbox": "Eradigm Inbox", "/client-inbox": "Client Inbox", "/input": "Input", "/admin": "Administration" };

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
    document.title = `${TITLES[loc.pathname] ?? "Eradigm"} · Eradigm Competitive Intelligence`;
  }, [loc.pathname]);

  if (me.isLoading) return <div className="empty" role="status">Loading…</div>;
  if (me.isError || !me.data) {
    const e = me.error as { status?: number } | null;
    if (e?.status === 401) return <Navigate to={`/signin?returnTo=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
    return <SignInPage problem={me.error} />;
  }
  const role = me.data.role;
  // Each role sees only its own tabs; any other page redirects to the Dashboard (the API enforces its own rules).
  const only = (tab: NavTab, page: ReactNode) => (canSeeTab(role, tab) ? page : <Navigate to="/dashboard" replace />);
  const warning = getContractWarning();

  // Full-window saved-source viewer (opened in a new tab from the Inbox).
  if (loc.pathname.startsWith("/source/")) {
    return (
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/source/:id" element={<SourcePage me={me.data} />} />
        </Routes>
      </main>
    );
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <Sidebar me={me.data} />
      <main id="main" tabIndex={-1}>
        {warning && <div className="banner" role="alert">{warning}</div>}
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage me={me.data} />} />
          <Route path="/tracker" element={<TrackerPage me={me.data} view="tracker" />} />
          <Route path="/phantoms" element={<TrackerPage key="phantoms" me={me.data} view="phantoms" />} />
          <Route path="/deliverables" element={only("deliverables", <DeliverablesPage me={me.data} />)} />
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
          <Route path="/inbox" element={only("inbox", <InboxPage me={me.data} />)} />
          <Route path="/client-inbox" element={only("clientinbox", <ClientInboxPage me={me.data} />)} />
          <Route path="/input" element={only("input", <InputPage me={me.data} />)} />
          <Route path="/admin" element={only("admin", <AdminPage me={me.data} />)} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
