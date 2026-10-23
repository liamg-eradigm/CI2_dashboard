/** CI Squared (request 61: the platform's first project) as the web app's shell sees it. */
import type { WebProject } from "../types";
import { CiSquaredAdmin } from "./admin/CiSquaredAdmin";
import { CiSquaredApp, TITLES } from "./CiSquaredApp";
import { CiSquaredNav } from "./Nav";
// Request 70: no capitals, one font (CI SQUARED pages only: keyed off the page's project).
import "./styles/ci2.css";

export const ciSquared: WebProject = {
  kind: "ci2",
  home: "/dashboard",
  App: CiSquaredApp,
  Nav: CiSquaredNav,
  Admin: CiSquaredAdmin,
  title: (path) => TITLES[path],
  bare: (path) => path.startsWith("/source/"),
};
