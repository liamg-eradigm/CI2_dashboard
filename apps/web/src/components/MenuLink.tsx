import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { routerPath } from "../api/space";

/**
 * A menu link: within this project, a link of the app; into another project
 * (request 61), a page load of its own, so nothing cached in one project shows
 * in the other.
 */
export function MenuLink({ path, children, ...rest }: { path: string; children: ReactNode; className?: string; "aria-label"?: string; "aria-current"?: "page" }) {
  const to = routerPath(path);
  return to != null ? (
    <Link to={to} {...rest}>
      {children}
    </Link>
  ) : (
    <a href={path} {...rest}>
      {children}
    </a>
  );
}
