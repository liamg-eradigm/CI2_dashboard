import { useState } from "react";
import {
  ROLES,
  ROLE_LABEL,
  canCreateUserWithRole,
  type Invite,
  type Me,
  type Role,
  type Access,
  MAX_PROJECT_NAME,
} from "@eradigm/shared";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAccess, useConfigStatus, useIncidents, useInvalidate, useNotifications } from "../api/hooks";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { projectFor } from "../projects/registry";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";

export function AdminPage({ me }: { me: Me }) {
  const isAdmin = me.role === "admin";
  return (
    <>
      <section className="band" aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">All projects</span>
            <h1 id="page-title">Admin</h1>
          </div>
          <div className="band-copy">People and their access to each project, invite links, each project’s settings and the tamper-evident audit record. People sign in with their organisation’s Microsoft work account, so passwords, MFA and account recovery stay with their organisation.</div>
        </div>
      </section>
      <div className="content">
        {/* Each card on its own: one failing never takes the page (or the dashboard) down. */}
        {isAdmin && (
          <ErrorBoundary label="Configuration">
            <ConfigStatus />
          </ErrorBoundary>
        )}
        {/* Request 61: people and their access to every project (the same on every project's Admin page). */}
        <ErrorBoundary label="Projects and access">
          <ProjectsAccess me={me} />
        </ErrorBoundary>
        {/* Request 61: the project's own settings (the toggle opens another project's). */}
        <div className="admin-project-head">
          <h2 className="card-title">Settings for {me.project?.name ?? me.tenant.name}</h2>
          <ProjectToggle me={me} />
        </div>
        <ProjectAdmin me={me} />
        {isAdmin && (
          <ErrorBoundary label="Incidents">
            <Incidents />
          </ErrorBoundary>
        )}
      </div>
    </>
  );
}

function ProjectAdmin({ me }: { me: Me }) {
  const Admin = projectFor(me).Admin;
  return Admin ? <Admin me={me} /> : null;
}

function ConfigStatus() {
  const q = useConfigStatus(true);
  if (!q.data) return null;
  const bad = q.data.checks.filter((c) => !c.ok);
  return (
    <section className="card" aria-labelledby="cfg-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="cfg-title">
            Deployment status
          </h2>
          <span className="card-sub">
            Environment {q.data.environment} ·{" "}
            {q.data.prefill === "manual" ? "Draft pre-fill: manual entry (no AI service)" : `Draft pre-fill: LLM provider ${q.data.provider} · model ${q.data.model}`}
          </span>
        </div>
        <span className={`tag ${bad.length ? "warn" : "ok"}`}>{bad.length ? `${bad.length} item(s) need attention` : "All checks passed"}</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 6, fontSize: 13 }}>
        {q.data.checks.map((c) => (
          <li key={c.key} style={{ color: c.ok ? "var(--success-2)" : "var(--warning)" }}>
            <span aria-hidden="true">{c.ok ? "✓" : "⚠"}</span> <span className="sr-only">{c.ok ? "OK:" : "Needs attention:"}</span> {c.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

type Link = { name: string; url: string; expiresAt: string; relink: boolean };

/**
 * Request 61: one account per person; who opens which project, with which
 * role. Admins of a project change anyone's access to it (or take it away)
 * and rename it; analysts add analysts and clients, as before.
 */
function ProjectsAccess({ me }: { me: Me }) {
  const q = useAccess(true);
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ email: "", name: "", projectId: me.project?.id ?? me.tenant.id, role: "client" as Role });
  const [link, setLink] = useState<Link | null>(null);
  const data = q.data;
  const set = (a: Access) => qc.setQueryData(["access"], a);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast((e as Error).message, false);
    }
  };
  if (!data) return <section className="card"><div className="empty" role="status">{q.isError ? (q.error as Error).message : "Loading projects…"}</div></section>;
  const projects = data.projects;
  const formProject = projects.find((p) => p.id === form.projectId) ?? projects[0];
  const allowed = ROLES.filter((r) => formProject && canCreateUserWithRole(formProject.role, r));
  const anyAdmin = projects.some((p) => p.role === "admin");
  return (
    <section className="card flush" aria-labelledby="access-title" data-testid="projects-access">
      <div style={{ padding: "16px 20px 12px" }}>
        <h2 className="card-title" id="access-title">
          Projects and access
        </h2>
        <span className="card-sub">
          One account per person. Choose who can open each project and with which role; “No access” hides the project from them completely. People sign in with their organisation’s Microsoft work account: someone new gets a
          one-time invite link to send them.
        </span>
      </div>
      {anyAdmin && (
        <div className="access-projects" aria-label="Project names">
          {projects.map((p) => (
            <ProjectName key={`${p.id}:${p.name}`} project={p} onSaved={async () => {
              await qc.invalidateQueries({ queryKey: ["access"] });
              await qc.invalidateQueries({ queryKey: ["me"] });
            }} />
          ))}
        </div>
      )}
      {link && (
        <div className="invite-box" role="status">
          <b>
            {link.relink ? "New sign-in link" : "Invite link"} for {link.name}
          </b>
          <span>
            Send this link to {link.name} (e.g. by email or Teams). They open it and sign in with their Microsoft work or school account to {link.relink ? "attach that account" : "activate access"}. It works once and expires on{" "}
            {localDateTime(link.expiresAt)}. It is shown only now.
          </span>
          <div className="row">
            <label className="sr-only" htmlFor="invite-url">
              Invite link
            </label>
            <input id="invite-url" className="control" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            <button
              className="btn small"
              onClick={() => {
                void navigator.clipboard?.writeText(link.url).then(
                  () => toast("Link copied"),
                  () => toast("Copy failed — select the link and copy it", false),
                );
              }}
            >
              Copy link
            </button>
            <button className="btn secondary small" onClick={() => setLink(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      <form
        className="add-col"
        style={{ borderTop: 0 }}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api<Access & { invite: Invite | null }>("/api/access", { method: "POST", json: { ...form, projectId: formProject?.id ?? form.projectId } });
            set(r);
            toast(`${form.name} can open ${formProject?.name ?? "the project"} as ${ROLE_LABEL[form.role].toLowerCase()}`);
            if (r.invite) setLink({ name: form.name, url: r.invite.url, expiresAt: r.invite.expiresAt, relink: false });
            setForm({ ...form, email: "", name: "", role: "client" });
          } catch (err) {
            toast((err as Error).message, false);
          }
        }}
      >
        <label className="field">
          <span>Email</span>
          <input className="control" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ width: 230 }} />
        </label>
        <label className="field">
          <span>Name</span>
          <input className="control" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: 170 }} />
        </label>
        <label className="field">
          <span>Project</span>
          <select className="control" value={formProject?.id ?? ""} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Role</span>
          <select className="control" value={allowed.includes(form.role) ? form.role : (allowed[0] ?? "client")} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {allowed.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" style={{ alignSelf: "end", height: 34 }}>
          + Add person
        </button>
      </form>
      <div className="table-wrap">
        <table className="data access-table" style={{ minWidth: 760 + projects.length * 150 }}>
          <caption className="sr-only">People and their access to each project</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              {projects.map((p) => (
                <th scope="col" key={p.id} className="access-project">
                  {p.name}
                </th>
              ))}
              <th scope="col">Microsoft sign-in</th>
              <th scope="col">Last seen</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((u) => {
              const self = u.id === me.user.id;
              // A sign-in link: in a project the caller manages where they may act on this person's role.
              const canLink = !self && projects.some((p) => u.access[p.id] && canCreateUserWithRole(p.role, u.access[p.id]!.role));
              const canEnd = !self && projects.some((p) => u.access[p.id] && p.role === "admin");
              return (
                <tr key={u.id} data-testid={`access-${u.email}`}>
                  <td style={{ fontWeight: 700, color: "var(--ink)" }}>{u.name}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {u.email}
                  </td>
                  {projects.map((p) => {
                    const a = u.access[p.id];
                    return (
                      <td key={p.id}>
                        {p.role === "admin" && !self ? (
                          <select
                            className="control"
                            style={{ minWidth: 120 }}
                            aria-label={`${u.name}: access to ${p.name}`}
                            value={a?.role ?? ""}
                            onChange={(e) => {
                              const role = (e.target.value || null) as Role | null;
                              if (!role && !window.confirm(`Take away ${u.name}’s access to ${p.name}? They will no longer see it at all.`)) return;
                              void run(
                                async () => set(await api<Access>(`/api/access/${u.id}`, { method: "PUT", json: { projectId: p.id, role } })),
                                role ? `${u.name} is now ${ROLE_LABEL[role]} in ${p.name}` : `${u.name} no longer has access to ${p.name}`,
                              );
                            }}
                          >
                            <option value="">No access</option>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        ) : a ? (
                          <span className={a.active ? "" : "muted"}>
                            {ROLE_LABEL[a.role]}
                            {!a.active && " (deactivated)"}
                          </span>
                        ) : (
                          <span className="muted">No access</span>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    {u.signIn === "linked" ? (
                      <span className="tag ok">✓ Linked</span>
                    ) : u.signIn === "invited" ? (
                      <span className="tag warn">◷ Invite pending</span>
                    ) : (
                      <span className="tag info">○ Not invited</span>
                    )}
                  </td>
                  <td>{u.lastSeenAt ? localDateTime(u.lastSeenAt) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canLink && (
                      <>
                        <button
                          className="btn secondary small"
                          onClick={() => {
                            if (u.signIn === "linked" && !window.confirm(`${u.name} already signs in with Microsoft. A new link lets them attach a different Microsoft account (their current one stops working once they use it). Continue?`)) return;
                            void run(async () => {
                              const r = await api<Invite>(`/api/access/${u.id}/invite`, { method: "POST" });
                              setLink({ name: u.name, url: r.url, expiresAt: r.expiresAt, relink: u.signIn === "linked" });
                              await qc.invalidateQueries({ queryKey: ["access"] });
                            }, "Link created");
                          }}
                        >
                          {u.signIn === "linked" ? "New sign-in link" : u.signIn === "invited" ? "New invite link" : "Create invite link"}
                        </button>{" "}
                      </>
                    )}
                    {canEnd && (
                      <button className="btn secondary small" onClick={() => void run(() => api(`/api/access/${u.id}/sessions/revoke`, { method: "POST" }), `Ended ${u.name}’s active sessions`)}>
                        End sessions
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A project's name, renamed in place by its admins. */
function ProjectName({ project, onSaved }: { project: Access["projects"][number]; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(project.name);
  const toast = useToast();
  const admin = project.role === "admin";
  const changed = name.trim() !== project.name && name.trim().length > 0;
  return (
    <form
      className="access-project-name"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed) return;
        try {
          await api(`/api/projects/${project.id}`, { method: "PATCH", json: { name: name.trim() } });
          await onSaved();
          toast(`Renamed to ${name.trim()}`);
        } catch (err) {
          toast((err as Error).message, false);
        }
      }}
    >
      <label className="field">
        <span>Project name</span>
        <input className="control" value={name} maxLength={MAX_PROJECT_NAME} disabled={!admin} onChange={(e) => setName(e.target.value)} aria-label={`Name of ${project.name}`} />
      </label>
      {admin && (
        <button className="btn secondary small" disabled={!changed}>
          Rename
        </button>
      )}
    </form>
  );
}

/** Request 61: the Admin page is the same in every project; this picks whose settings show below. */
function ProjectToggle({ me }: { me: Me }) {
  const projects = (me.projects ?? []).filter((p) => p.role === "admin" || p.role === "analyst");
  if (projects.length < 2) return null;
  return (
    <div className="seg project-toggle" role="group" aria-label="Settings for project">
      {projects.map((p) => {
        const here = p.id === me.project?.id;
        return (
          <a key={p.id} href={`${p.path}/admin`} aria-current={here ? "true" : undefined} className={here ? "on" : ""} onClick={(e) => (here ? e.preventDefault() : undefined)}>
            {p.name}
          </a>
        );
      })}
    </div>
  );
}

function Incidents() {
  const inc = useIncidents(true);
  const notes = useNotifications(true);
  const inv = useInvalidate();
  return (
    <section className="card" aria-labelledby="inc-title">
      <div>
        <h2 className="card-title" id="inc-title">
          Quarantine incidents and alerts
        </h2>
        <span className="card-sub">Only a non-sensitive category and time are recorded. Quarantined content is not processed further and its stored copy is deleted.</span>
      </div>
      {(notes.data ?? []).slice(0, 8).map((n) => (
        <div key={n.id} style={{ fontSize: 13 }} className={n.kind === "quarantine" || n.kind === "llm_permission" ? "err-msg" : ""}>
          <span aria-hidden="true">⚠ </span>
          {localDateTime(n.at)} · {n.message}
        </div>
      ))}
      <div className="table-wrap">
        <table className="data">
          <caption className="sr-only">Incidents</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Category</th>
              <th scope="col">Item</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {(inc.data ?? []).map((i) => (
              <tr key={i.id}>
                <td>{localDateTime(i.at)}</td>
                <td>{i.category.replace(/_/g, " ")}</td>
                <td className="mono">{i.itemCode ?? "—"}</td>
                <td>
                  {i.resolved ? (
                    <span className="tag ok">✓ Resolved</span>
                  ) : (
                    <button className="btn secondary small" onClick={async () => (await api(`/api/incidents/${i.id}/resolve`, { method: "POST" }), inv("incidents"))}>
                      Mark resolved
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inc.data && !inc.data.length && <div className="empty">No incidents.</div>}
    </section>
  );
}

