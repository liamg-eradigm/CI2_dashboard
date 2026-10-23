/**
 * The platform's web app (request 61): sign-in, the shell (sidebar with the
 * project menu), the universal Admin page, and the pages of the project the
 * address is for (projects/registry.ts).
 */
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { canSeeTab } from "@eradigm/shared";
import { useMe } from "./api/hooks";
import { getContractWarning } from "./api/client";
import { PROJECT_SLUG } from "./api/space";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { AdminPage } from "./pages/AdminPage";
import { InvitePage, SignInPage } from "./pages/SignInPage";
import { projectFor } from "./projects/registry";

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
  const project = projectFor(me.data);
  useEffect(() => {
    const name = me.data?.project?.name;
    document.title = `${loc.pathname === "/admin" ? "Admin" : (project.title(loc.pathname) ?? "Eradigm")}${name ? ` · ${name}` : ""} · Eradigm Competitive Intelligence`;
  }, [loc.pathname, project, me.data?.project?.name]);
  // Request 70: the page knows its project (each project's own styles key off it).
  useEffect(() => {
    document.documentElement.dataset.project = project.kind;
  }, [project.kind]);

  if (me.isLoading) return <div className="empty" role="status">Loading…</div>;
  if (me.isError || !me.data) {
    const e = me.error as { status?: number } | null;
    // Request 61: a project the caller cannot open. Back to their first project.
    if (PROJECT_SLUG && (e?.status === 403 || e?.status === 404)) {
      window.location.replace("/");
      return null;
    }
    if (e?.status === 401) return <Navigate to={`/signin?returnTo=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
    return <SignInPage problem={me.error} />;
  }
  const data = me.data;
  // Request 61: the caller's first project lives at the site's root (an old /p/<slug> address of it still opens it).
  if (PROJECT_SLUG && data.project?.path === "") {
    window.location.replace((window.location.pathname.replace(/^\/p\/[^/]+/, "") || "/") + window.location.search);
    return null;
  }
  const warning = getContractWarning();

  // A page shown full-window (e.g. a saved source opened in a new tab).
  if (project.bare?.(loc.pathname)) {
    return (
      <main id="main" tabIndex={-1}>
        {/* A page that fails shows a message instead of blanking the dashboard (reset on navigation). */}
        <ErrorBoundary key={loc.pathname} label="This page">
          <project.App me={data} />
        </ErrorBoundary>
      </main>
    );
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <Sidebar me={data} />
      <main id="main" tabIndex={-1}>
        {warning && <div className="banner" role="alert">{warning}</div>}
        <ErrorBoundary key={loc.pathname} label="This page">
          {loc.pathname === "/admin" ? (
            canSeeTab(data.role, "admin") ? <AdminPage me={data} /> : <Navigate to={project.home} replace />
          ) : (
            <project.App me={data} />
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
