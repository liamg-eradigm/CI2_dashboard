/**
 * What a project gives the platform's web app (request 61). The shell
 * (App.tsx, Sidebar, Admin page, sign-in) knows projects only through this
 * shape and the registry; a project never imports another project.
 */
import type { ComponentType } from "react";
import type { Me } from "@eradigm/shared";

export type WebProject = {
  /** tenants.kind of the workspaces this project serves. */
  kind: string;
  /** Its first page (sign-in and unknown addresses land here). */
  home: string;
  /** Its pages (the routes under the project's address). */
  App: ComponentType<{ me: Me }>;
  /** Its menu in the sidebar. */
  Nav: ComponentType<{ me: Me }>;
  /** Its settings cards on the Admin page. */
  Admin?: ComponentType<{ me: Me }>;
  /** The page title of an address (the browser tab). */
  title: (pathname: string) => string | undefined;
  /** Addresses shown full-window, without the sidebar (e.g. a saved source). */
  bare?: (pathname: string) => boolean;
};
