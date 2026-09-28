/**
 * Role and permission rules (6_QC_&_Compliance, "Security, tenancy and
 * non-functional requirements").
 *
 * These rules are enforced by the API on every request. The dashboard uses the
 * same table only to decide what to show; hiding a control is never treated
 * as a security control.
 */
export const ROLES = ["admin", "analyst", "client"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  analyst: "Analyst",
  client: "Client",
};

export const ACTIONS = [
  "dashboard:read",
  "tracker:read",
  "tracker:export",
  "savedView:write",
  "inbox:read",
  "submission:create",
  "item:edit",
  "item:review",
  "item:delete",
  "schema:edit",
  "user:read",
  "user:create",
  "user:changeRole",
  "user:deactivate",
  "user:endSessions",
  "audit:read",
  "settings:edit",
  "incident:read",
  "metrics:read",
] as const;
export type Action = (typeof ACTIONS)[number];

const MATRIX: Record<Role, readonly Action[]> = {
  client: ["dashboard:read", "tracker:read", "tracker:export", "savedView:write"],
  analyst: [
    "dashboard:read",
    "tracker:read",
    "tracker:export",
    "savedView:write",
    "inbox:read",
    "submission:create",
    "item:edit",
    "item:review",
    "item:delete",
    "schema:edit",
    "user:read",
    "user:create",
    "metrics:read",
  ],
  admin: ACTIONS,
};

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return MATRIX[role].includes(action);
}

/**
 * Analysts may create analyst and client accounts only for their own
 * authorised tenant. Only admins may create admin accounts.
 * (Tenant scoping is enforced separately by the API.)
 */
export function canCreateUserWithRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === "admin") return true;
  if (actorRole === "analyst") return targetRole === "analyst" || targetRole === "client";
  return false;
}

/** Only admins may change a user's role after the account is created. */
export function canChangeRole(actorRole: Role): boolean {
  return actorRole === "admin";
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
