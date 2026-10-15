/**
 * The projects this platform serves (request 61). Adding a project: create
 * its folder under projects/, export a ProjectModule and list it here.
 */
import { ciSquared } from "./ci-squared/index.js";
import type { ProjectModule } from "./types.js";

export const PROJECTS: readonly ProjectModule[] = [ciSquared];

/** The module serving a workspace of this kind. */
export const projectOf = (kind: string | null | undefined): ProjectModule | undefined => PROJECTS.find((m) => m.kind === kind);
