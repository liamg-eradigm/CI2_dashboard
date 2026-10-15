/**
 * Where this page load is (requests 55 and 61). The caller's first project is
 * at the site's root; any other project at /p/<slug> (its pages see the same
 * paths). Request 55: the Test tab's pages are the root project's pages under
 * /test, answered from its test space (the API reads the `x-eradigm-space`
 * header). Project and space are fixed for the page load: moving to another
 * loads the page afresh, so nothing cached in one is ever shown in another.
 */
import { PROJECT_PATH_PREFIX, TEST_PATH_PREFIX, projectSlugOfPath, type Space } from "@eradigm/shared";

const here = typeof window !== "undefined" ? window.location.pathname : "/";

/** Request 61: the project this page load is for (its slug), or null for the caller's first project (the root). */
export const PROJECT_SLUG: string | null = projectSlugOfPath(here);
/** The address the project's pages are under ("" at the root). */
export const PROJECT_BASE = PROJECT_SLUG ? `${PROJECT_PATH_PREFIX}/${PROJECT_SLUG}` : "";

const inTest = (path: string) => path === TEST_PATH_PREFIX || path.startsWith(`${TEST_PATH_PREFIX}/`);

export const SPACE: Space = !PROJECT_SLUG && inTest(here) ? "test" : "live";

/** The space a full path (as the browser shows it) belongs to. */
export const spaceOfPath = (path: string): Space => (inTest(path) ? "test" : "live");

/** The router's base: a project's pages (and the Test tab's) see the same paths as the root project's. */
export const ROUTER_BASENAME = PROJECT_SLUG ? PROJECT_BASE : SPACE === "test" ? TEST_PATH_PREFIX : undefined;

/** A path inside the app as the browser shows it (under /p/<slug> or /test). */
export const appHref = (path: string) => (PROJECT_SLUG ? `${PROJECT_BASE}${path}` : SPACE === "test" ? `${TEST_PATH_PREFIX}${path}` : path);

/**
 * A full path as the router of this page load sees it, or null when it is in
 * another project or space (a page load of its own).
 */
export function routerPath(path: string): string | null {
  const slug = projectSlugOfPath(path);
  if (slug !== PROJECT_SLUG) return null;
  if (PROJECT_SLUG) return path.slice(PROJECT_BASE.length) || "/";
  if (spaceOfPath(path) !== SPACE) return null;
  return SPACE === "test" ? path.slice(TEST_PATH_PREFIX.length) || "/" : path;
}
