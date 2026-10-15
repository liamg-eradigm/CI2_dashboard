import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { routerPath } from "../api/space";

/**
 * A menu link (request 55): within this space, a link of the app; into the
 * other space (the Test tab from the live pages, or back), a page load of its
 * own, so nothing cached in one space shows in the other.
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
