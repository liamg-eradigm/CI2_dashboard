import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_MENU,
  MENU_ITEM_PATH,
  ROLE_LABEL,
  can,
  canSeeTab,
  groupLabel,
  isMenuItemAt,
  isStandaloneGroup,
  itemLabel,
  visibleMenu,
  type Me,
  type MenuGroupKey,
  type MenuGroupSetting,
  type MenuItemKey,
} from "@eradigm/shared";
import { useClientInboxCount, useInboxCounts, useSettings } from "../api/hooks";
import { DEV_AUTH, devUserStore, signOut, tenantStore } from "../api/client";

const DEV_USERS = [
  ["l.griffith@example.com", "L. Griffith · Analyst"],
  ["admin@example.com", "E. Admin · Admin"],
  ["client@example.com", "C. Client · Client"],
  ["analyst@northwind.example.com", "N. Analyst · other tenant"],
];

/**
 * A menu group (Inputs, Analytics, Trackers, Admin; requests 28 and 31): a
 * button that opens its subtabs. Open while one of its pages is open, unless
 * the user closed it. Names and order are an admin setting (Administration → Menu).
 */
function NavGroup({
  group,
  open,
  onToggle,
  linkTo,
  badge,
}: {
  group: MenuGroupSetting;
  open: boolean;
  onToggle: (open: boolean) => void;
  linkTo: (path: string) => string;
  badge: (item: MenuItemKey) => { n: number; label: string } | null;
}) {
  const loc = useLocation();
  const within = group.items.some((it) => isMenuItemAt(it.key, loc.pathname));
  const id = `nav-sub-${group.key}`;
  const label = groupLabel(group);
  const total = group.items.reduce((sum, it) => sum + (badge(it.key)?.n ?? 0), 0);
  return (
    <div className={`nav-group${within ? " within" : ""}`} data-testid={`nav-group-${group.key}`}>
      <button className="nav-parent" aria-expanded={open} aria-controls={id} onClick={() => onToggle(!open)}>
        <span>{label}</span>
        {!open && total > 0 && (
          <span className="badge" aria-label={`${total} waiting`}>
            {total}
          </span>
        )}
        <span className="nav-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="nav-sub" id={id} role="group" aria-label={label}>
          {group.items.map((it) => {
            const b = badge(it.key);
            return (
              <Link
                key={it.key}
                to={linkTo(MENU_ITEM_PATH[it.key])}
                aria-label={`${label}: ${itemLabel(it)}`}
                aria-current={isMenuItemAt(it.key, loc.pathname) ? "page" : undefined}
                className={isMenuItemAt(it.key, loc.pathname) ? "active" : ""}
              >
                <span>{itemLabel(it)}</span>
                {b && b.n > 0 && (
                  <span className="badge" aria-label={b.label}>
                    {b.n}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A group that is a tab of its own (request 43): one link, named as the group. */
function SoloTab({ group, item }: { group: MenuGroupSetting; item: MenuItemKey }) {
  const loc = useLocation();
  const here = isMenuItemAt(item, loc.pathname);
  return (
    <div className={`nav-group solo${here ? " within" : ""}`} data-testid={`nav-group-${group.key}`}>
      <Link className={`nav-solo${here ? " active" : ""}`} to={MENU_ITEM_PATH[item]} aria-current={here ? "page" : undefined}>
        <span>{groupLabel(group)}</span>
      </Link>
    </div>
  );
}

export function Sidebar({ me }: { me: Me }) {
  const [open, setOpen] = useState(true);
  // Groups the user opened or closed (else open while on one of their pages).
  const [expanded, setExpanded] = useState<Partial<Record<MenuGroupKey, boolean>>>({});
  const qc = useQueryClient();
  const staff = can(me.role, "inbox:read");
  const counts = useInboxCounts(staff);
  const clientCount = useClientInboxCount(canSeeTab(me.role, "clientinbox"));
  const settings = useSettings();
  const n = (counts.data?.primary ?? 0) + (counts.data?.secondary ?? 0);
  const loc = useLocation();
  // Deliverables keeps the filters it was opened with (and the Primary/Secondary switch).
  const cur = [...new URLSearchParams(loc.search)];
  const filterPairs = cur.filter(([k]) => k === "q" || k === "from" || k === "to" || k.startsWith("f."));
  const TABLES = ["/deliverables"];
  const tables = TABLES.includes(loc.pathname);
  const withFilters = (to: string) => {
    if (!TABLES.includes(to)) return to;
    const pairs = tables ? cur.filter(([k]) => k === "stream" || filterPairs.some(([f]) => f === k)) : filterPairs;
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
  // The groups and their subtabs, in the order and with the names an admin set (Administration → Menu); each role sees only its own.
  const groups = visibleMenu(settings.data?.menu ?? DEFAULT_MENU, me.role);
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
        {groups.map((g) =>
          // A tab of its own (Database, request 43): a link straight to its page, no subtabs.
          isStandaloneGroup(g.key) && g.items[0] ? (
            <SoloTab key={g.key} group={g} item={g.items[0].key} />
          ) : (
            <NavGroup
              key={g.key}
              group={g}
              open={expanded[g.key] ?? g.items.some((it) => isMenuItemAt(it.key, loc.pathname))}
              onToggle={(o) => setExpanded((e) => ({ ...e, [g.key]: o }))}
              linkTo={withFilters}
              badge={(k) => (k === "inbox" ? { n, label: `${n} unprocessed` } : k === "clientinbox" ? { n: waiting, label: `${waiting} to check` } : null)}
            />
          ),
        )}
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
