/**
 * The menu (request 28, contract 1.17): tabs in groups, each group a button
 * that opens its subtabs. Admins reorder the groups and the subtabs within
 * each group, and rename both (Administration → Menu). People only see the
 * subtabs their role allows; a group with none is hidden.
 */
import { canSeeTab, type NavTab } from "./megatrends.js";
import type { Role } from "./permissions.js";

export const MENU_GROUPS = ["trackers", "megatrends", "competitors", "inputs", "admin"] as const;
export type MenuGroupKey = (typeof MENU_GROUPS)[number];

export const MENU_ITEMS = [
  "tracker",
  "dashboard",
  "phantoms",
  "megatrends",
  "megatrends-analysis",
  "competitors",
  "competitors-analysis",
  "input",
  "inbox",
  "clientinbox",
  "deliverables",
  "admin",
] as const;
export type MenuItemKey = (typeof MENU_ITEMS)[number];

/** Each group's subtabs, in their default order (a subtab stays in its group). */
export const MENU_GROUP_ITEMS: Record<MenuGroupKey, readonly MenuItemKey[]> = {
  trackers: ["tracker", "dashboard", "phantoms"],
  megatrends: ["megatrends", "megatrends-analysis"],
  competitors: ["competitors", "competitors-analysis"],
  inputs: ["input", "inbox", "clientinbox"],
  admin: ["deliverables", "admin"],
};

export const MENU_GROUP_LABEL: Record<MenuGroupKey, string> = {
  trackers: "Trackers",
  megatrends: "Megatrends",
  competitors: "Competitors",
  inputs: "Inputs",
  admin: "Admin",
};

export const MENU_ITEM_LABEL: Record<MenuItemKey, string> = {
  tracker: "Tracker",
  dashboard: "Dashboard",
  phantoms: "Phantoms",
  megatrends: "Knowledge graph",
  "megatrends-analysis": "Trend analysis",
  competitors: "Knowledge graph",
  "competitors-analysis": "Trend analysis",
  input: "Input",
  inbox: "Eradigm Inbox",
  clientinbox: "Client Inbox",
  deliverables: "Deliverables",
  admin: "Administration",
};

export const MENU_ITEM_PATH: Record<MenuItemKey, string> = {
  tracker: "/tracker",
  dashboard: "/dashboard",
  phantoms: "/phantoms",
  megatrends: "/megatrends",
  "megatrends-analysis": "/megatrends/analysis",
  competitors: "/competitors",
  "competitors-analysis": "/competitors/analysis",
  input: "/input",
  inbox: "/inbox",
  clientinbox: "/client-inbox",
  deliverables: "/deliverables",
  admin: "/admin",
};

/** The tab whose role rules a subtab follows. */
export const MENU_ITEM_TAB: Record<MenuItemKey, NavTab> = {
  tracker: "tracker",
  dashboard: "dashboard",
  phantoms: "phantoms",
  megatrends: "megatrends",
  "megatrends-analysis": "megatrends",
  competitors: "competitors",
  "competitors-analysis": "competitors",
  input: "input",
  inbox: "inbox",
  clientinbox: "clientinbox",
  deliverables: "deliverables",
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

/**
 * A stored menu made whole: unknown or repeated groups and subtabs dropped, a
 * subtab only in its own group, missing ones added in their default place,
 * names trimmed (an empty name means the default).
 */
export function normaliseMenu(menu: unknown): MenuSetting {
  const raw = (menu && typeof menu === "object" && Array.isArray((menu as { groups?: unknown }).groups) ? (menu as { groups: unknown[] }).groups : []) as Partial<MenuGroupSetting>[];
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
  MENU_GROUPS.forEach((k) => {
    if (!groups.some((g) => g.key === k)) groups.push(structuredClone(DEFAULT_MENU.groups.find((g) => g.key === k)!));
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
