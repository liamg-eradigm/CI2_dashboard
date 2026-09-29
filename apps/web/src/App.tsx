import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { can } from "@eradigm/shared";
import { useMe } from "./api/hooks";
import { getContractWarning } from "./api/client";
import { Sidebar } from "./components/Sidebar";
import { DashboardPage } from "./pages/DashboardPage";
import { TrackerPage } from "./pages/TrackerPage";
import { InboxPage } from "./pages/InboxPage";
import { InputPage } from "./pages/InputPage";
import { AdminPage } from "./pages/AdminPage";
import { InvitePage, SignInPage } from "./pages/SignInPage";
import { SourcePage } from "./pages/SourcePage";

const TITLES: Record<string, string> = { "/dashboard": "Dashboard", "/tracker": "Tracker", "/phantoms": "Phantoms", "/inbox": "Inbox", "/input": "Input", "/admin": "Administration" };

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
  const staff = can(role, "inbox:read");
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
          {/* Staff-only pages do not exist for clients: the routes redirect to the dashboard (the API also refuses them). */}
          <Route path="/inbox" element={staff ? <InboxPage me={me.data} /> : <Navigate to="/dashboard" replace />} />
          <Route path="/input" element={can(role, "submission:create") ? <InputPage me={me.data} /> : <Navigate to="/dashboard" replace />} />
          <Route path="/admin" element={can(role, "user:read") ? <AdminPage me={me.data} /> : <Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
