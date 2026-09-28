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
import { SignInProblem } from "./pages/SignInProblem";

const TITLES: Record<string, string> = { "/dashboard": "Dashboard", "/tracker": "Tracker", "/inbox": "Inbox", "/input": "Input", "/admin": "Administration" };

export function App() {
  const me = useMe();
  const loc = useLocation();
  useEffect(() => {
    document.title = `${TITLES[loc.pathname] ?? "Eradigm"} · Eradigm Competitive Intelligence`;
  }, [loc.pathname]);

  if (me.isLoading) return <div className="empty" role="status">Loading…</div>;
  if (me.isError || !me.data) return <SignInProblem error={me.error} />;
  const role = me.data.role;
  const staff = can(role, "inbox:read");
  const warning = getContractWarning();

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <Sidebar me={me.data} />
      <main id="main" tabIndex={-1}>
        {warning && <div className="banner" role="alert">{warning}</div>}
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage me={me.data} />} />
          <Route path="/tracker" element={<TrackerPage me={me.data} />} />
          <Route path="/inbox" element={staff ? <InboxPage me={me.data} /> : <Denied what="The Inbox" />} />
          <Route path="/input" element={can(role, "submission:create") ? <InputPage me={me.data} /> : <Denied what="Input" />} />
          <Route path="/admin" element={can(role, "user:read") ? <AdminPage me={me.data} /> : <Denied what="Administration" />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Denied({ what }: { what: string }) {
  return (
    <>
      <section className="band">
        <div>
          <span className="eyebrow">Analysts and admins only</span>
          <h1>Access restricted</h1>
        </div>
      </section>
      <div className="content">
        <p className="empty">{what} is available to analysts and admins. Ask an admin for access.</p>
      </div>
    </>
  );
}
