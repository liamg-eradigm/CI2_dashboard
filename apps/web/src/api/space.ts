/**
 * Request 55: the space this page load works in. The Test tab's pages are the
 * usual pages under /test, answered from the workspace's test space (the API
 * reads the `x-eradigm-space` header). The space is fixed for the page load:
 * moving between the Test tab and the rest of the dashboard loads the page
 * afresh, so nothing cached in one space is ever shown in the other.
 */
import { TEST_PATH_PREFIX, type Space } from "@eradigm/shared";

const inTest = (path: string) => path === TEST_PATH_PREFIX || path.startsWith(`${TEST_PATH_PREFIX}/`);

export const SPACE: Space = typeof window !== "undefined" && inTest(window.location.pathname) ? "test" : "live";

/** The space a full path (as the browser shows it) belongs to. */
export const spaceOfPath = (path: string): Space => (inTest(path) ? "test" : "live");

/** The router's base: the Test tab's pages see the same paths as the live ones. */
export const ROUTER_BASENAME = SPACE === "test" ? TEST_PATH_PREFIX : undefined;

/** A path inside the app as the browser shows it (under /test in the test space). */
export const appHref = (path: string) => (SPACE === "test" ? `${TEST_PATH_PREFIX}${path}` : path);

/** A full path as the router of this page load sees it, or null when it is in the other space (a page load of its own). */
export const routerPath = (path: string): string | null => (spaceOfPath(path) !== SPACE ? null : SPACE === "test" ? path.slice(TEST_PATH_PREFIX.length) || "/" : path);
