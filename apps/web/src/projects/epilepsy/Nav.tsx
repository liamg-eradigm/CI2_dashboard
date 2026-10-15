/** The Epilepsy project's menu (request 61): its five tabs, and Admin for staff. */
import { useLocation } from "react-router-dom";
import { canSeeTab, type Me } from "@eradigm/shared";
import { appHref } from "../../api/space";
import { MenuLink } from "../../components/MenuLink";
import { PAGES } from "./EpilepsyApp";

export function EpilepsyNav({ me }: { me: Me }) {
  const loc = useLocation();
  const items = [...PAGES, ...(canSeeTab(me.role, "admin") ? [{ path: "/admin", label: "Admin" }] : [])];
  return (
    <>
      {items.map((p) => {
        const here = loc.pathname === p.path;
        return (
          <div key={p.path} className={`nav-group solo${here ? " within" : ""}`}>
            <MenuLink className={`nav-solo${here ? " active" : ""}`} path={appHref(p.path)} aria-current={here ? "page" : undefined}>
              <span>{p.label}</span>
            </MenuLink>
          </div>
        );
      })}
    </>
  );
}
