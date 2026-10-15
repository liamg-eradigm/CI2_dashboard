/**
 * The platform's sidebar (request 61): the Eradigm logo, the project's name
 * under it, and a menu of the caller's projects behind the logo; the
 * project's own menu (projects/registry.ts); who is signed in.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ROLE_LABEL, type Me, type Project } from "@eradigm/shared";
import { DEV_AUTH, devUserStore, signOut } from "../api/client";
import { projectFor } from "../projects/registry";

const DEV_USERS = [
  ["l.griffith@example.com", "L. Griffith · Analyst"],
  ["admin@example.com", "E. Admin · Admin"],
  ["client@example.com", "C. Client · Client"],
  ["analyst@northwind.example.com", "N. Analyst · other tenant"],
];

/** A project's first page as the browser shows it (a page load of its own). */
const projectHref = (p: Project) => `${p.path}${projectFor({ project: p }).home}`;

/** Request 61: the Eradigm logo opens a menu of the caller's projects; the project's name is under it. */
function Brand({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const projects = me.projects ?? [];
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const name = me.project?.name ?? me.tenant.name;
  return (
    <div className="brand-box" ref={box}>
      <button className="brand" aria-haspopup="menu" aria-expanded={open} aria-controls="project-menu" onClick={() => setOpen((o) => !o)} title="Change project" data-testid="brand">
        <div className="logo-tile">
          <img src="/eradigm-logo.webp" alt="" />
        </div>
        <div className="wordmark">
          <b>ERADIGM</b>
          <span>CONSULTING</span>
          <span className="sr-only">: change project</span>
        </div>
      </button>
      <div className="side-project" data-testid="project-name">
        {name}
      </div>
      {open && (
        <div className="project-menu" id="project-menu" role="menu" aria-label="Projects">
          <div className="project-menu-head">Your projects</div>
          {projects.map((p) => {
            const here = p.id === me.project?.id;
            return (
              <a key={p.id} role="menuitemradio" aria-checked={here} className={here ? "here" : ""} href={projectHref(p)} onClick={(e) => (here ? (e.preventDefault(), setOpen(false)) : undefined)}>
                <span>{p.name}</span>
                <small>{ROLE_LABEL[p.role]}</small>
                {here && <span className="project-check" aria-hidden="true">✓</span>}
              </a>
            );
          })}
          {!projects.length && <div className="project-menu-none">No other projects</div>}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ me }: { me: Me }) {
  const [open, setOpen] = useState(true);
  const qc = useQueryClient();
  const Nav = projectFor(me).Nav;
  if (!open) {
    return (
      <aside className="sidebar closed" aria-label="Main menu (collapsed)">
        <button className="side-open" onClick={() => setOpen(true)} title="Open menu" aria-label="Open menu" aria-expanded="false">
          »
        </button>
      </aside>
    );
  }
  return (
    <aside className="sidebar" aria-label="Main menu">
      <button className="side-close" onClick={() => setOpen(false)} title="Close menu" aria-label="Close menu" aria-expanded="true">
        «
      </button>
      <Brand me={me} />
      <div className="side-label" id="nav-label">
        COMPETITIVE INTELLIGENCE
      </div>
      <nav className="nav" aria-labelledby="nav-label">
        <Nav me={me} />
      </nav>
      <div className="side-foot">
        <div className="who">{me.user.name}</div>
        <div className="role">
          {ROLE_LABEL[me.role]}
        </div>
        {DEV_AUTH ? (
          <label className="field">
            <span style={{ color: "var(--on-dark-4)" }}>Dev sign-in</span>
            <select
              value={devUserStore.get() ?? ""}
              onChange={(e) => {
                devUserStore.set(e.target.value);
                qc.clear();
                window.location.assign("/");
              }}
            >
              {DEV_USERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <button className="link" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
        {me.environment !== "production" && <div className="role">Environment: {me.environment}</div>}
      </div>
    </aside>
  );
}
