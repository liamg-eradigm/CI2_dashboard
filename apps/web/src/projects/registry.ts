/**
 * The projects the web app serves (request 61). Adding a project: create its
 * folder under projects/, export a WebProject and list it here.
 */
import type { Me } from "@eradigm/shared";
import { ciSquared } from "./ci-squared";
import type { WebProject } from "./types";

export const PROJECTS: readonly WebProject[] = [ciSquared];

/** The project of the caller's current workspace. */
export function projectFor(me: Pick<Me, "project"> | null | undefined): WebProject {
  return PROJECTS.find((p) => p.kind === me?.project?.kind) ?? (PROJECTS[0] as WebProject);
}
