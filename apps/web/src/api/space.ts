/**
 * Request 61: which project this page load is for. The caller's first project
 * is at the site's root; any other at /p/<slug> (its pages see the same
 * paths). The project is fixed for the page load: moving to another loads the
 * page afresh, so nothing cached in one is ever shown in another.
 */
import { PROJECT_PATH_PREFIX, projectSlugOfPath } from "@eradigm/shared";

const here = typeof window !== "undefined" ? window.location.pathname : "/";

/** The project this page load is for (its slug), or null for the caller's first project (the root). */
export const PROJECT_SLUG: string | null = projectSlugOfPath(here);
/** The address the project's pages are under ("" at the root). */
export const PROJECT_BASE = PROJECT_SLUG ? `${PROJECT_PATH_PREFIX}/${PROJECT_SLUG}` : "";

/** The router's base: a project's pages see the same paths as the root project's. */
export const ROUTER_BASENAME = PROJECT_SLUG ? PROJECT_BASE : undefined;

/** A path inside the app as the browser shows it (under /p/<slug> in another project). */
export const appHref = (path: string) => `${PROJECT_BASE}${path}`;

/** A full path as the router of this page load sees it, or null when it is in another project (a page load of its own). */
export function routerPath(path: string): string | null {
  if (projectSlugOfPath(path) !== PROJECT_SLUG) return null;
  return PROJECT_SLUG ? path.slice(PROJECT_BASE.length) || "/" : path;
}
