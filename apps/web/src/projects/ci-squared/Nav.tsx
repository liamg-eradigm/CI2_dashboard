/**
 * CI Squared's menu (request 61: the sidebar is the platform's; each project
 * brings its own menu): the groups and their subtabs, in the order and with
 * the names an admin set (Admin → Menu), each role seeing only its own, with
 * the inboxes' waiting counts.
 */
import { useState } from "react";
import { useLocation } from "react-router-dom";
import {
  DEFAULT_MENU,
  MENU_ITEM_PATH,
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
import { PROJECT_BASE } from "../../api/space";
import { MenuLink } from "../../components/MenuLink";
import { useClientInboxCount, useInboxCounts, useSettings } from "./api/hooks";

/** Whether a menu item is the page shown (by its full path: the Test tab's pages are under /test). */
const isHere = (item: MenuItemKey, pathname: string) => isMenuItemAt(item, pathname);
/** A menu item's address in this workspace (request 61: a workspace other than the first is under /p/<slug>). */
const hrefOf = (item: MenuItemKey) => `${PROJECT_BASE}${MENU_ITEM_PATH[item]}`;

/**
 * A menu group (Inputs, Analytics; requests 28 and 31): a button that opens
 * its subtabs. Open while one of its pages is open, unless the user closed it.
 * Names and order are an admin setting (Admin → Menu).
 */
function NavGroup({
  group,
  open,
  onToggle,
  badge,
}: {
  group: MenuGroupSetting;
  open: boolean;
  onToggle: (open: boolean) => void;
  badge: (item: MenuItemKey) => { n: number; label: string } | null;
}) {
  const loc = useLocation();
  const within = group.items.some((it) => isHere(it.key, loc.pathname));
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
              <MenuLink
                key={it.key}
                path={hrefOf(it.key)}
                aria-label={`${label}: ${itemLabel(it)}`}
                aria-current={isHere(it.key, loc.pathname) ? "page" : undefined}
                className={isHere(it.key, loc.pathname) ? "active" : ""}
              >
                <span>{itemLabel(it)}</span>
                {b && b.n > 0 && (
                  <span className="badge" aria-label={b.label}>
                    {b.n}
                  </span>
                )}
              </MenuLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A group that is a tab of its own (request 43; request 70: every tab): one link, named as the group, with its count. */
function SoloTab({ group, item, badge }: { group: MenuGroupSetting; item: MenuItemKey; badge?: { n: number; label: string } | null }) {
  const loc = useLocation();
  const here = isHere(item, loc.pathname);
  return (
    <div className={`nav-group solo${here ? " within" : ""}`} data-testid={`nav-group-${group.key}`}>
      <MenuLink className={`nav-solo${here ? " active" : ""}`} path={hrefOf(item)} aria-current={here ? "page" : undefined}>
        <span>{groupLabel(group)}</span>
        {badge && badge.n > 0 && (
          <span className="badge" aria-label={badge.label}>
            {badge.n}
          </span>
        )}
      </MenuLink>
    </div>
  );
}

export function CiSquaredNav({ me }: { me: Me }) {
  // Groups the user opened or closed (else open while on one of their pages).
  const [expanded, setExpanded] = useState<Partial<Record<MenuGroupKey, boolean>>>({});
  const staff = can(me.role, "inbox:read");
  const counts = useInboxCounts(staff);
  const clientCount = useClientInboxCount(canSeeTab(me.role, "clientinbox"));
  const settings = useSettings();
  const n = (counts.data?.primary ?? 0) + (counts.data?.secondary ?? 0);
  const loc = useLocation();
  const groups = visibleMenu(settings.data?.menu ?? DEFAULT_MENU, me.role);
  const waiting = clientCount.data?.count ?? 0;
  const badge = (k: MenuItemKey) => (k === "inbox" ? { n, label: `${n} unprocessed` } : k === "clientinbox" ? { n: waiting, label: `${waiting} to check` } : null);
  return (
    <>
      {groups.map((g) =>
        // A tab of its own (request 70: every tab): a link straight to its page, no subtabs.
        isStandaloneGroup(g.key) && g.items[0] ? (
          <SoloTab key={g.key} group={g} item={g.items[0].key} badge={badge(g.items[0].key)} />
        ) : (
          <NavGroup
            key={g.key}
            group={g}
            open={expanded[g.key] ?? g.items.some((it) => isHere(it.key, loc.pathname))}
            onToggle={(o) => setExpanded((e) => ({ ...e, [g.key]: o }))}
            badge={badge}
          />
        ),
      )}
    </>
  );
}
