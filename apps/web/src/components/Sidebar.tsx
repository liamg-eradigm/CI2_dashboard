import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ROLE_LABEL, can, type Me } from "@eradigm/shared";
import { useItems } from "../api/hooks";
import { DEV_AUTH, devUserStore, tenantStore } from "../api/client";

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
  const pending = useItems(["needs_review"], staff);
  const n = pending.data?.length ?? 0;
  const loc = useLocation();
  // Dashboard and Tracker share one filter state: carry it across when switching.
  const shared = new URLSearchParams([...new URLSearchParams(loc.search)].filter(([k]) => k === "q" || k === "from" || k === "to" || k.startsWith("f."))).toString();
  const withFilters = (to: string) => (shared && (to === "/dashboard" || to === "/tracker") ? `${to}?${shared}` : to);

  if (!open) {
    return (
      <aside className="sidebar closed" aria-label="Main menu (collapsed)">
        <button className="side-open" onClick={() => setOpen(true)} title="Open menu" aria-label="Open menu" aria-expanded="false">
          »
        </button>
      </aside>
    );
  }
  const links: [string, string, boolean][] = [
    ["/dashboard", "Dashboard", true],
    ["/tracker", "Tracker", true],
    ["/inbox", "Inbox", staff],
    ["/input", "Input", can(me.role, "submission:create")],
    ["/admin", "Administration", can(me.role, "user:read")],
  ];
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
                <span className="badge" aria-label={`${n} awaiting review`}>
                  {n}
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
          <a href="/cdn-cgi/access/logout">Sign out</a>
        )}
        {me.environment !== "production" && <div className="role">Environment: {me.environment}</div>}
      </div>
    </aside>
  );
}
