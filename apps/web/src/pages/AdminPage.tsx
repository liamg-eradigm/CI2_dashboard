import { useEffect, useState } from "react";
import { ROLES, ROLE_LABEL, canCreateUserWithRole, type Me, type Role, type TenantSettings } from "@eradigm/shared";
import { api } from "../api/client";
import { useAudit, useConfigStatus, useIncidents, useInvalidate, useNotifications, useQuality, useSettings, useUsers } from "../api/hooks";
import { localDateTime, pct } from "../lib/format";
import { useToast } from "../state/toast";

export function AdminPage({ me }: { me: Me }) {
  const isAdmin = me.role === "admin";
  return (
    <>
      <section className="band" aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">{me.tenant.name}</span>
            <h1 id="page-title">Administration</h1>
          </div>
          <div className="band-copy">Accounts, roles, retention and data policy, extraction quality and the tamper-evident audit record. Sign-in, MFA and account recovery are handled by the organisation’s identity provider through Cloudflare Access.</div>
        </div>
      </section>
      <div className="content">
        {isAdmin && <ConfigStatus />}
        <Users me={me} />
        <Quality manual={me.features.prefill === "manual"} />
        {isAdmin && <Settings />}
        {isAdmin && <Incidents />}
        {isAdmin && <Audit />}
      </div>
    </>
  );
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

function Users({ me }: { me: Me }) {
  const users = useUsers(true);
  const inv = useInvalidate();
  const toast = useToast();
  const [form, setForm] = useState({ email: "", name: "", role: "client" as Role });
  const isAdmin = me.role === "admin";
  const allowed = ROLES.filter((r) => canCreateUserWithRole(me.role, r));
  const call = async (path: string, method: string, json: unknown, ok: string) => {
    try {
      await api(path, { method, json });
      await inv("users");
      toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, false);
      return false;
    }
  };
  return (
    <section className="card flush" aria-labelledby="users-title">
      <div style={{ padding: "16px 20px 12px" }}>
        <h2 className="card-title" id="users-title">
          Users and roles
        </h2>
        <span className="card-sub">{isAdmin ? "Admins can create any account, change roles, deactivate accounts and end sessions." : "Analysts can create analyst and client accounts for this workspace."}</span>
      </div>
      <form
        className="add-col"
        style={{ borderTop: 0 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call("/api/users", "POST", form, `Created ${ROLE_LABEL[form.role].toLowerCase()} account for ${form.email}`)) setForm({ email: "", name: "", role: "client" });
        }}
      >
        <label className="field">
          <span>Email</span>
          <input className="control" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ width: 240 }} />
        </label>
        <label className="field">
          <span>Name</span>
          <input className="control" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: 180 }} />
        </label>
        <label className="field">
          <span>Role</span>
          <select className="control" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {allowed.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" style={{ alignSelf: "end", height: 34 }}>
          + Add user
        </button>
      </form>
      <div className="table-wrap">
        <table className="data">
          <caption className="sr-only">Users in this workspace</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Last seen</th>
              {isAdmin && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 700, color: "var(--ink)" }}>{u.name}</td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {u.email}
                </td>
                <td>
                  {isAdmin && u.id !== me.user.id ? (
                    <select className="control" aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => call(`/api/users/${u.id}`, "PATCH", { role: e.target.value }, `${u.name} is now ${ROLE_LABEL[e.target.value as Role]}`)}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ROLE_LABEL[u.role]
                  )}
                </td>
                <td>
                  <span className={`tag ${u.active ? "ok" : "err"}`}>{u.active ? "● Active" : "○ Deactivated"}</span>
                </td>
                <td>{u.lastSeenAt ? localDateTime(u.lastSeenAt) : "—"}</td>
                {isAdmin && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    {u.id !== me.user.id && (
                      <>
                        <button className="btn secondary small" onClick={() => call(`/api/users/${u.id}`, "PATCH", { active: !u.active }, `${u.name} ${u.active ? "deactivated" : "reactivated"}`)}>
                          {u.active ? "Deactivate" : "Reactivate"}
                        </button>{" "}
                        <button className="btn secondary small" onClick={() => call(`/api/users/${u.id}/sessions/revoke`, "POST", {}, `Ended ${u.name}’s active sessions`)}>
                          End sessions
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Quality({ manual }: { manual: boolean }) {
  const q = useQuality(true);
  const d = q.data;
  return (
    <section className="card" aria-labelledby="q-title">
      <div>
        <h2 className="card-title" id="q-title">
          Extraction quality
        </h2>
        <span className="card-sub">
          {manual
            ? "From real review decisions. Automatic pre-fill is off (manual entry), so AI correction and evidence metrics stay empty until it is enabled (docs/ENABLING-AUTOFILL.md)."
            : "From real review decisions: how often analysts correct the AI draft, required-field completion and evidence support. Re-check after changing the AI instructions, categories or model."}
        </span>
      </div>
      {d && (
        <>
          <div className="trend-grid">
            {[
              ["Reviewed", d.reviewed],
              ["Approved", d.approved],
              ["Rejected", d.rejected],
              ["AI drafts corrected", d.aiDrafted ? `${pct(d.correctionRate)} of ${d.aiDrafted}` : "—"],
              ["Required fields completed", pct(d.requiredFieldCompletion)],
              ["Values with verified evidence", pct(d.evidenceCoverage)],
              ["Duplicates handled", d.duplicatesDetected],
              ["Failed / quarantined", `${d.failed} / ${d.quarantined}`],
            ].map(([k, v]) => (
              <div key={String(k)} style={{ padding: 10, background: "var(--subtle)", borderRadius: 8 }}>
                <div className="field-label">{k}</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Corrections by field</summary>
            <ul style={{ fontSize: 13 }}>
              {d.fieldCorrectionRates.map((f) => (
                <li key={f.key}>
                  {f.label}: {f.corrected} ({pct(f.rate)})
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

function Settings() {
  const s = useSettings();
  const inv = useInvalidate();
  const toast = useToast();
  const [draft, setDraft] = useState<TenantSettings | null>(null);
  const [markers, setMarkers] = useState("");
  useEffect(() => {
    if (s.data) {
      setDraft(s.data);
      setMarkers(s.data.redaction.quarantineMarkers.join("\n"));
    }
  }, [s.data]);
  if (!draft) return null;
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const save = async () => {
    try {
      await api("/api/settings", { method: "PATCH", json: { ...draft, redaction: { ...draft.redaction, quarantineMarkers: markers.split("\n").map((m) => m.trim()).filter((m) => m.length >= 3) } } });
      await inv("settings");
      toast("Settings saved");
    } catch (e) {
      toast((e as Error).message, false);
    }
  };
  return (
    <section className="card" aria-labelledby="set-title">
      <div>
        <h2 className="card-title" id="set-title">
          Workspace settings
        </h2>
        <span className="card-sub">Trend Test defaults are visible to all users and stored with saved views.</span>
      </div>
      <div className="trend-grid">
        <label className="field">
          <span>Time zone (for “today”)</span>
          <input className="control" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} />
        </label>
        {(Object.keys(draft.trendDefaults) as (keyof TenantSettings["trendDefaults"])[]).map((k) => (
          <label className="field" key={k}>
            <span>Trend default · {k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
            <input className="control" type="number" min={0} step={k === "growthScoreChange" ? 0.05 : 1} value={draft.trendDefaults[k]} onChange={(e) => setDraft({ ...draft, trendDefaults: { ...draft.trendDefaults, [k]: num(e.target.value) } })} />
          </label>
        ))}
        <label className="field">
          <span>Keep snapshots (days, 0 = until deletion)</span>
          <input className="control" type="number" min={0} value={draft.retention.snapshotDays} onChange={(e) => setDraft({ ...draft, retention: { ...draft.retention, snapshotDays: num(e.target.value) } })} />
        </label>
        <label className="field">
          <span>Purge rejected / failed content after (days)</span>
          <input className="control" type="number" min={0} value={draft.retention.rejectedDays} onChange={(e) => setDraft({ ...draft, retention: { ...draft.retention, rejectedDays: num(e.target.value) } })} />
        </label>
        <label className="field">
          <span>Purge deleted items after (days)</span>
          <input className="control" type="number" min={0} value={draft.retention.deletedDays} onChange={(e) => setDraft({ ...draft, retention: { ...draft.retention, deletedDays: num(e.target.value) } })} />
        </label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
        <legend className="section-h">Data classification and redaction (checked for every capture; redaction applies to anything sent to an AI service if pre-fill is enabled)</legend>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={draft.redaction.redactEmails} onChange={(e) => setDraft({ ...draft, redaction: { ...draft.redaction, redactEmails: e.target.checked } })} /> Redact email addresses
        </label>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={draft.redaction.redactPhones} onChange={(e) => setDraft({ ...draft, redaction: { ...draft.redaction, redactPhones: e.target.checked } })} /> Redact phone numbers
        </label>
        <label className="field">
          <span>Extra quarantine terms (one per line, e.g. client project code names)</span>
          <textarea className="control" style={{ height: 90, padding: 8 }} value={markers} onChange={(e) => setMarkers(e.target.value)} />
        </label>
      </fieldset>
      <div>
        <button className="btn" onClick={save}>
          Save settings
        </button>
      </div>
    </section>
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

function Audit() {
  const audit = useAudit(true);
  const [verify, setVerify] = useState<{ ok: boolean; checked: number; reason: string | null } | null>(null);
  return (
    <section className="card flush" aria-labelledby="aud-title">
      <div className="card-head" style={{ padding: "16px 20px 12px" }}>
        <div>
          <h2 className="card-title" id="aud-title">
            Audit record
          </h2>
          <span className="card-sub">Append-only, hash-chained record of sign-ins, account and role changes, submissions, classifications, edits, approvals, rejections, exports and deletions.</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {verify && (
            <span className={verify.ok ? "ok-msg" : "err-msg"} role="status">
              {verify.ok ? `✓ Chain intact · ${verify.checked} events verified` : `✕ Chain broken · ${verify.reason}`}
            </span>
          )}
          <button className="btn secondary" onClick={async () => setVerify(await api("/api/audit/verify"))}>
            Verify integrity
          </button>
        </div>
      </div>
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }} tabIndex={0} role="region" aria-label="Audit events (scrollable)">
        <table className="data" style={{ fontSize: 12.5 }}>
          <caption className="sr-only">Recent audit events</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Time</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {(audit.data ?? []).map((e) => (
              <tr key={e.seq}>
                <td className="mono">{e.seq}</td>
                <td style={{ whiteSpace: "nowrap" }}>{localDateTime(e.at)}</td>
                <td className="mono" style={{ fontSize: 11.5 }}>
                  {e.actor ?? "system"}
                </td>
                <td style={{ fontWeight: 700, color: "var(--ink)" }}>{e.action}</td>
                <td className="mono" style={{ fontSize: 11.5 }}>
                  {e.targetType ? `${e.targetType}:${e.targetId?.slice(-8) ?? ""}` : "—"}
                </td>
                <td className="mono" style={{ fontSize: 11, overflowWrap: "anywhere", maxWidth: 360 }}>
                  {JSON.stringify(e.details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

