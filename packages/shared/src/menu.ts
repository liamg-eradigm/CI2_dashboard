/**
 * The menu (request 28, contract 1.17; regrouped in request 31, contract 1.19):
 * tabs in groups, each group a button that opens its subtabs. Admins reorder the groups and the subtabs within
 * each group, and rename both (Admin → Menu). People only see the
 * subtabs their role allows; a group with none is hidden.
 */
import { canSeeTab, type NavTab } from "./megatrends.js";
import type { Role } from "./permissions.js";

export const MENU_GROUPS = ["inputs", "analytics", "database", "admin"] as const;
export type MenuGroupKey = (typeof MENU_GROUPS)[number];

/** Request 53: "knowledge-graph" is in no group any more (the graphs are in the Megatrends Dashboard); kept so menus saved with it still read. */
export const MENU_ITEMS = ["input", "inbox", "clientinbox", "dashboard", "knowledge-graph", "primary-tracker", "database", "admin"] as const;
export type MenuItemKey = (typeof MENU_ITEMS)[number];

/**
 * Each group's subtabs, in their default order (a subtab stays in its group).
 * Request 31: Inputs, Analytics (the Analytics Dashboard, with Trends Analysis,
 * and the Knowledge Graph, Megatrends and Competitors behind one toggle),
 * Trackers and Admin. Request 34: Trackers is named Databases (Signals
 * Database, Phantoms Database, CI analyses), Dashboard is the Megatrends
 * Dashboard, and Analytics gains the Primary Tracker (Archived Responses).
 * Request 43: Database, a tab of its own (no subtabs) bringing the databases
 * and Deliverables onto one page. Request 48: the Databases group (Signals
 * Database, Phantoms Database, CI analyses) is gone; Database has them all.
 * Request 52: Admin → Deliverables is gone (its newsletters are on the
 * Database page), so Admin is a tab of its own, as Database is. Request 53:
 * Analytics → Knowledge Graph is gone (the knowledge graphs are part of the
 * Megatrends Dashboard); a menu saved with it drops it.
 */
export const MENU_GROUP_ITEMS: Record<MenuGroupKey, readonly MenuItemKey[]> = {
  inputs: ["input", "inbox", "clientinbox"],
  analytics: ["dashboard", "primary-tracker"],
  database: ["database"],
  admin: ["admin"],
};

export const MENU_GROUP_LABEL: Record<MenuGroupKey, string> = {
  inputs: "Inputs",
  analytics: "Analytics",
  database: "Database",
  admin: "Admin",
};

export const MENU_ITEM_LABEL: Record<MenuItemKey, string> = {
  input: "Input",
  inbox: "Eradigm Inbox",
  clientinbox: "Client Inbox",
  dashboard: "Megatrends Dashboard",
  "knowledge-graph": "Knowledge Graph",
  "primary-tracker": "Primary Tracker",
  database: "Database",
  admin: "Admin",
};

export const MENU_ITEM_PATH: Record<MenuItemKey, string> = {
  input: "/input",
  inbox: "/inbox",
  clientinbox: "/client-inbox",
  dashboard: "/dashboard",
  "knowledge-graph": "/megatrends",
  "primary-tracker": "/analytics/primary",
  database: "/database",
  admin: "/admin",
};

/** Groups that are a tab of their own: a link straight to their one page, with no subtabs (request 43). */
export const STANDALONE_GROUPS: readonly MenuGroupKey[] = ["database", "admin"];
export const isStandaloneGroup = (key: MenuGroupKey) => STANDALONE_GROUPS.includes(key);

/** Other pages a subtab is current on: the Trends Analysis pages and (request 53) the full-page knowledge graphs, all part of the Megatrends Dashboard. */
export const MENU_ITEM_ALSO: Partial<Record<MenuItemKey, readonly string[]>> = {
  dashboard: ["/analytics/megatrends", "/analytics/competitors", "/megatrends", "/competitors"],
};

/** Whether a subtab is the current page. */
export const isMenuItemAt = (key: MenuItemKey, pathname: string): boolean => pathname === MENU_ITEM_PATH[key] || (MENU_ITEM_ALSO[key] ?? []).includes(pathname);

/** The tab whose role rules a subtab follows. */
export const MENU_ITEM_TAB: Record<MenuItemKey, NavTab> = {
  input: "input",
  inbox: "inbox",
  clientinbox: "clientinbox",
  dashboard: "dashboard",
  "knowledge-graph": "megatrends",
  "primary-tracker": "tracker",
  database: "tracker",
  admin: "admin",
};

/** The longest name an admin can give a group or subtab. */
export const MAX_MENU_LABEL = 40;

export interface MenuItemSetting {
  key: MenuItemKey;
  /** The admin's name for it (none: the default name). */
  label?: string;
}
export interface MenuGroupSetting {
  key: MenuGroupKey;
  label?: string;
  items: MenuItemSetting[];
}
export interface MenuSetting {
  groups: MenuGroupSetting[];
}

export const DEFAULT_MENU: MenuSetting = {
  groups: MENU_GROUPS.map((key) => ({ key, items: MENU_GROUP_ITEMS[key].map((k) => ({ key: k })) })),
};

const cleanLabel = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim().slice(0, MAX_MENU_LABEL);
  return t ? t : undefined;
};

/** Groups of the menu before request 31: a menu saved with them is laid out afresh (names kept). */
const LEGACY_GROUPS = ["megatrends", "competitors"];

/**
 * A stored menu made whole: unknown or repeated groups and subtabs dropped, a
 * subtab only in its own group, missing ones added in their default place,
 * names trimmed (an empty name means the default). A menu saved before the
 * request 31 layout (with Megatrends and Competitors groups) takes the new
 * layout and keeps the names given to the groups and subtabs that remain.
 */
export function normaliseMenu(menu: unknown): MenuSetting {
  let raw = (menu && typeof menu === "object" && Array.isArray((menu as { groups?: unknown }).groups) ? (menu as { groups: unknown[] }).groups : []) as Partial<MenuGroupSetting>[];
  if (raw.some((g) => g && LEGACY_GROUPS.includes(g.key as string))) {
    const groupNames = new Map(raw.filter((g) => g && g.label).map((g) => [g.key as string, g.label]));
    const itemNames = new Map(raw.flatMap((g) => (g && Array.isArray(g.items) ? g.items : [])).filter((it) => it && it.label).map((it) => [it.key as string, it.label]));
    raw = DEFAULT_MENU.groups.map((g) => ({ key: g.key, label: groupNames.get(g.key), items: g.items.map((it) => ({ key: it.key, label: itemNames.get(it.key) })) }));
  }
  const groups: MenuGroupSetting[] = [];
  for (const g of raw) {
    if (!g || !(MENU_GROUPS as readonly string[]).includes(g.key as string) || groups.some((x) => x.key === g.key)) continue;
    const key = g.key as MenuGroupKey;
    const members = MENU_GROUP_ITEMS[key];
    const items: MenuItemSetting[] = [];
    for (const it of Array.isArray(g.items) ? g.items : []) {
      if (!it || !members.includes(it.key as MenuItemKey) || items.some((x) => x.key === it.key)) continue;
      const label = cleanLabel(it.label);
      items.push({ key: it.key as MenuItemKey, ...(label ? { label } : {}) });
    }
    members.forEach((k, i) => {
      if (items.some((x) => x.key === k)) return;
      const before = members.slice(0, i).reverse().find((m) => items.some((x) => x.key === m));
      const at = before ? items.findIndex((x) => x.key === before) + 1 : 0;
      items.splice(at, 0, { key: k });
    });
    const label = cleanLabel(g.label);
    groups.push({ key, ...(label ? { label } : {}), items });
  }
  // A missing group goes back after the group it follows by default (first when it leads).
  MENU_GROUPS.forEach((k, i) => {
    if (groups.some((g) => g.key === k)) return;
    const before = MENU_GROUPS.slice(0, i).reverse().find((m) => groups.some((g) => g.key === m));
    const at = before ? groups.findIndex((g) => g.key === before) + 1 : 0;
    groups.splice(at, 0, structuredClone(DEFAULT_MENU.groups.find((g) => g.key === k)!));
  });
  return { groups };
}

export const groupLabel = (g: MenuGroupSetting) => g.label ?? MENU_GROUP_LABEL[g.key];
export const itemLabel = (it: MenuItemSetting) => it.label ?? MENU_ITEM_LABEL[it.key];

/** The menu a role sees: each group with the subtabs it may use; groups with none left out. */
export function visibleMenu(menu: MenuSetting, role: Role | null | undefined): MenuGroupSetting[] {
  return normaliseMenu(menu)
    .groups.map((g) => ({ ...g, items: g.items.filter((it) => canSeeTab(role, MENU_ITEM_TAB[it.key])) }))
    .filter((g) => g.items.length > 0);
}
