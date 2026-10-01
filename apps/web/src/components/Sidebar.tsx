import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_NAV_ORDER, NAV_LABEL, NAV_PATH, ROLE_LABEL, can, canSeeTab, type Me, type NavTab } from "@eradigm/shared";
import { useClientInboxCount, useInboxCounts, useSettings } from "../api/hooks";
import { DEV_AUTH, devUserStore, signOut, tenantStore } from "../api/client";

const DEV_USERS = [
  ["l.griffith@example.com", "L. Griffith · Analyst"],
  ["admin@example.com", "E. Admin · Admin"],
  ["client@example.com", "C. Client · Client"],
  ["analyst@northwind.example.com", "N. Analyst · other tenant"],
];

export function Sidebar({ me }: { me: Me }) {
  const [open, setOpen] = useState(true);
  const qc = useQueryClient();
  const staff = can(me.role, "inbox:read");
  const counts = useInboxCounts(staff);
  const clientCount = useClientInboxCount(canSeeTab(me.role, "clientinbox"));
  const settings = useSettings();
  const n = (counts.data?.primary ?? 0) + (counts.data?.secondary ?? 0);
  const loc = useLocation();
  // Dashboard, Tracker, Phantoms and Deliverables share one filter state (and the tables the Primary/Secondary switch): carry it across.
  const cur = [...new URLSearchParams(loc.search)];
  const filterPairs = cur.filter(([k]) => k === "q" || k === "from" || k === "to" || k.startsWith("f."));
  const TABLES = ["/tracker", "/phantoms", "/deliverables"];
  const tables = TABLES.includes(loc.pathname);
  const withFilters = (to: string) => {
    if (to !== "/dashboard" && !TABLES.includes(to)) return to;
    const pairs = to === "/dashboard" ? filterPairs : tables ? cur.filter(([k]) => k === "stream" || filterPairs.some(([f]) => f === k)) : filterPairs;
    const q = new URLSearchParams(pairs).toString();
    return q ? `${to}?${q}` : to;
  };

  if (!open) {
    return (
      <aside className="sidebar closed" aria-label="Main menu (collapsed)">
        <button className="side-open" onClick={() => setOpen(true)} title="Open menu" aria-label="Open menu" aria-expanded="false">
          »
        </button>
      </aside>
    );
  }
  // The tabs, in the order an admin set (Administration → Tabs); each role sees only its own tabs.
  const links: [string, string, boolean][] = (settings.data?.navOrder ?? DEFAULT_NAV_ORDER).map((k: NavTab) => [NAV_PATH[k], NAV_LABEL[k], canSeeTab(me.role, k)]);
  const waiting = clientCount.data?.count ?? 0;
  return (
    <aside className="sidebar" aria-label="Main menu">
      <button className="side-close" onClick={() => setOpen(false)} title="Close menu" aria-label="Close menu" aria-expanded="true">
        «
      </button>
      <NavLink to="/dashboard" className="brand" aria-label="Eradigm Consulting — Dashboard">
        <div className="logo-tile">
          <img src="/eradigm-logo.webp" alt="" />
        </div>
        <div className="wordmark" aria-hidden="true">
          <b>ERADIGM</b>
          <span>CONSULTING</span>
        </div>
      </NavLink>
      <div className="side-label" id="nav-label">
        COMPETITIVE INTELLIGENCE
      </div>
      <nav className="nav" aria-labelledby="nav-label">
        {links
          .filter(([, , show]) => show)
          .map(([to, label]) => (
            <NavLink key={to} to={withFilters(to)} className={({ isActive }) => (isActive ? "active" : "")}>
              <span>{label}</span>
              {to === "/inbox" && n > 0 && (
                <span className="badge" aria-label={`${n} unprocessed`}>
                  {n}
                </span>
              )}
              {to === "/client-inbox" && waiting > 0 && (
                <span className="badge" aria-label={`${waiting} to check`}>
                  {waiting}
                </span>
              )}
            </NavLink>
          ))}
      </nav>
      <div className="side-foot">
        <div className="who">{me.user.name}</div>
        <div className="role">
          {ROLE_LABEL[me.role]} · {me.tenant.name}
        </div>
        {me.tenants.length > 1 && (
          <label className="field">
            <span className="sr-only">Workspace</span>
            <select
              value={me.tenant.id}
              onChange={(e) => {
                tenantStore.set(e.target.value);
                qc.clear();
                window.location.assign("/dashboard");
              }}
            >
              {me.tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {DEV_AUTH ? (
          <label className="field">
            <span style={{ color: "var(--on-dark-4)" }}>Dev sign-in</span>
            <select
              value={devUserStore.get() ?? ""}
              onChange={(e) => {
                devUserStore.set(e.target.value);
                tenantStore.set(null);
                window.location.assign("/dashboard");
              }}
            >
              {DEV_USERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <button className="link" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
        {me.environment !== "production" && <div className="role">Environment: {me.environment}</div>}
      </div>
    </aside>
  );
}
