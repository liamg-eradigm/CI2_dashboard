/** The Epilepsy project (request 61) as the web app's shell sees it. */
import type { WebProject } from "../types";
import { EpilepsyAdmin } from "./admin/EpilepsyAdmin";
import { EpilepsyApp, PAGES } from "./EpilepsyApp";
import { EpilepsyNav } from "./Nav";

export const epilepsy: WebProject = {
  kind: "epilepsy",
  home: "/news",
  App: EpilepsyApp,
  Nav: EpilepsyNav,
  Admin: EpilepsyAdmin,
  title: (path) => PAGES.find((p) => p.path === path)?.label,
};
