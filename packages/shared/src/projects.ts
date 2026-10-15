/**
 * Request 61: projects. The platform holds several projects (CI SQUARED,
 * Epilepsy, …); each is a workspace of its own with its own people and roles.
 * One account per person; an admin decides who sees which project, with which
 * role, on the Admin page (Projects & access).
 */
import { z } from "zod";
import { ROLES } from "./permissions.js";

/** The kinds of project the platform knows (tenants.kind). */
export const PROJECT_KINDS = ["ci2", "epilepsy"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/** The request header naming the project (its slug) a request is for; without it, the caller's first project. */
export const PROJECT_HEADER = "x-project";
/** The web app's address of a project other than the caller's first: /p/<slug>/… */
export const PROJECT_PATH_PREFIX = "/p";
export const MAX_PROJECT_NAME = 60;

export const ProjectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  kind: z.string(),
  /** The caller's role in it. */
  role: z.enum(ROLES),
  /** Where its pages are: "" for the caller's first project (the site's root), else /p/<slug>. */
  path: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** A person and their access to each project the caller manages (Admin → Projects & access). */
export const AccessPersonSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  signIn: z.enum(["linked", "invited", "not_invited"]),
  lastSeenAt: z.string().nullable(),
  /** Project id → role (and whether that access is switched on); projects not listed: no access. */
  access: z.record(z.string(), z.object({ role: z.enum(ROLES), active: z.boolean() })),
});
export const AccessSchema = z.object({
  /** The projects the caller manages people for (admin or analyst there). */
  projects: z.array(ProjectSchema.omit({ path: true })),
  people: z.array(AccessPersonSchema),
});
export type AccessPerson = z.infer<typeof AccessPersonSchema>;
export type Access = z.infer<typeof AccessSchema>;

/** Give a person a role in a project, change it, or (null) take their access away. */
export const SetAccessRequest = z.object({ projectId: z.string().min(1), role: z.enum(ROLES).nullable() });
/** Add a person (a new account, or an existing one) to a project. */
export const AddPersonRequest = z.object({
  email: z.email().max(254),
  name: z.string().min(1).max(120),
  projectId: z.string().min(1),
  role: z.enum(ROLES),
});
export const RenameProjectRequest = z.object({ name: z.string().trim().min(1).max(MAX_PROJECT_NAME) });

/** The project path a full browser path is under ("/p/epilepsy/news" → "epilepsy"), or null for the root project. */
export function projectSlugOfPath(path: string): string | null {
  const m = new RegExp(`^${PROJECT_PATH_PREFIX}/([a-z0-9-]+)(?:/|$)`).exec(path);
  return m ? (m[1] as string) : null;
}
