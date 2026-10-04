import { useEffect, useState } from "react";
import { DEFAULT_COMPETITOR_TIERS, NAV_LABEL, ROLES, ROLE_LABEL, SUMMARY_MODELS, canCreateUserWithRole, type Invite, type Me, type NavTab, type Role, type TenantSettings, type UserWithInvite } from "@eradigm/shared";
import { api } from "../api/client";
import { useConfigStatus, useIncidents, useInvalidate, useNotifications, useQuality, useSchema, useSettings, useUsers } from "../api/hooks";
import { Combobox } from "../components/Combobox";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ReorderList } from "../components/SchemaEditor";
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
          <div className="band-copy">Accounts, roles, invite links, retention and data policy, extraction quality and the tamper-evident audit record. People sign in with their organisation’s Microsoft work account, so passwords, MFA and account recovery stay with their organisation.</div>
        </div>
      </section>
      <div className="content">
        {/* Each card on its own: one failing never takes the page (or the dashboard) down. */}
        {isAdmin && (
          <ErrorBoundary label="Configuration">
            <ConfigStatus />
          </ErrorBoundary>
        )}
        <ErrorBoundary label="Users">
          <Users me={me} />
        </ErrorBoundary>
        <ErrorBoundary label="Extraction quality">
          <Quality manual={me.features.prefill === "manual"} />
        </ErrorBoundary>
        {isAdmin && (
          <ErrorBoundary label="Tabs">
            <TabOrder />
          </ErrorBoundary>
        )}
        {isAdmin && (
          <ErrorBoundary label="Competitor tiers">
            <CompetitorTiersCard />
          </ErrorBoundary>
        )}
        {isAdmin && (
          <ErrorBoundary label="Settings">
            <Settings />
          </ErrorBoundary>
        )}
        {isAdmin && (
          <ErrorBoundary label="Incidents">
            <Incidents />
          </ErrorBoundary>
        )}
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
  const [link, setLink] = useState<{ name: string; url: string; expiresAt: string; relink: boolean } | null>(null);
  const isAdmin = me.role === "admin";
  const allowed = ROLES.filter((r) => canCreateUserWithRole(me.role, r));
  const newLink = async (u: { id: string; name: string; signIn: string }) => {
    if (u.signIn === "linked" && !window.confirm(`${u.name} already signs in with Microsoft. A new link lets them attach a different Microsoft account (their current one stops working once they use it). Continue?`)) return;
    try {
      const r = await api<Invite>(`/api/users/${u.id}/invite`, { method: "POST" });
      setLink({ name: u.name, url: r.url, expiresAt: r.expiresAt, relink: u.signIn === "linked" });
      await inv("users");
    } catch (e) {
      toast((e as Error).message, false);
    }
  };
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
        <span className="card-sub">
          {isAdmin ? "Admins can create any account, change roles, deactivate accounts and end sessions." : "Analysts can create analyst and client accounts for this workspace."} People sign in with
          their organisation’s Microsoft work account: each new account gets a one-time invite link to send them.
        </span>
      </div>
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
            const u = await api<UserWithInvite>("/api/users", { method: "POST", json: form });
            await inv("users");
            toast(`Created ${ROLE_LABEL[form.role].toLowerCase()} account for ${form.email}`);
            setLink({ name: u.name, url: u.invite.url, expiresAt: u.invite.expiresAt, relink: false });
            setForm({ email: "", name: "", role: "client" });
          } catch (err) {
            toast((err as Error).message, false);
          }
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
        <table className="data" style={{ minWidth: 1080 }}>
          <caption className="sr-only">Users in this workspace</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Microsoft sign-in</th>
              <th scope="col">Last seen</th>
              <th scope="col">Actions</th>
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
                    <select className="control" style={{ minWidth: 110 }} aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => call(`/api/users/${u.id}`, "PATCH", { role: e.target.value }, `${u.name} is now ${ROLE_LABEL[e.target.value as Role]}`)}>
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
                  {u.id !== me.user.id && u.active && canCreateUserWithRole(me.role, u.role) && (
                    <>
                      <button className="btn secondary small" onClick={() => void newLink(u)}>
                        {u.signIn === "linked" ? "New sign-in link" : u.signIn === "invited" ? "New invite link" : "Create invite link"}
                      </button>{" "}
                    </>
                  )}
                  {isAdmin && (
                    <>
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
                    </>
                  )}
                </td>
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

/** The order of the tabs in the menu, for everyone in the workspace (saved straight away). */
function TabOrder() {
  const s = useSettings();
  const inv = useInvalidate();
  const toast = useToast();
  if (!s.data) return null;
  const save = async (navOrder: string[], ok: string) => {
    try {
      await api("/api/settings", { method: "PATCH", json: { navOrder } });
      await inv("settings");
      toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, false);
      return false;
    }
  };
  return (
    <section className="card" aria-labelledby="tabs-title" data-testid="tab-order">
      <div>
        <h2 className="card-title" id="tabs-title">
          Tabs
        </h2>
        <span className="card-sub">The order of the tabs in the menu, for everyone in this workspace. People only see the tabs their role allows (clients never see Inbox, Input or Administration).</span>
      </div>
      <div className="table-cols-list" style={{ maxWidth: 460 }}>
        <ReorderList
          values={s.data.navOrder}
          what="Tabs"
          labelOf={(k) => NAV_LABEL[k as NavTab] ?? k}
          itemNoun="tab"
          sortable={false}
          hint="this is the order of the menu"
          onSave={save}
          renderRow={(k, cell) => (
            <div className="tcol-row" data-testid={`tab-${k}`}>
              {cell}
              <span className="tcol-label">{NAV_LABEL[k as NavTab] ?? k}</span>
            </div>
          )}
        />
      </div>
    </section>
  );
}

/** Competitor tiers for the Competitors tab: one name per line; any competitor not listed is Tier 4. */
const TIER_NOTE: Record<1 | 2 | 3, string> = { 1: "red", 2: "orange-yellow", 3: "green" };
function CompetitorTiersCard() {
  const s = useSettings();
  const inv = useInvalidate();
  const toast = useToast();
  const [text, setText] = useState<Record<"tier1" | "tier2" | "tier3", string> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (s.data && !text) {
      // An API from before contract 1.15 has no tiers yet: start from the defaults.
      const t = { ...DEFAULT_COMPETITOR_TIERS, ...(s.data.competitorTiers ?? {}) };
      setText({ tier1: (t.tier1 ?? []).join("\n"), tier2: (t.tier2 ?? []).join("\n"), tier3: (t.tier3 ?? []).join("\n") });
    }
  }, [s.data, text]);
  if (!s.data || !text) return null;
  const lines = (v: string) => [...new Set(v.split("\n").map((x) => x.trim()).filter(Boolean))];
  const save = async () => {
    setBusy(true);
    try {
      await api("/api/settings", { method: "PATCH", json: { competitorTiers: { tier1: lines(text.tier1), tier2: lines(text.tier2), tier3: lines(text.tier3) } } });
      await inv("settings", "competitors");
      toast("Competitor tiers saved");
    } catch (e) {
      toast((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="tiers-title" data-testid="competitor-tiers">
      <div>
        <h2 className="card-title" id="tiers-title">
          Competitor tiers
        </h2>
        <span className="card-sub">
          On the Competitors tab, each competitor's sphere takes its tier's colour. One competitor per line; names match however entries write them (BMS, J&J, Lilly…). Any competitor not listed is Tier 4 (grey).
        </span>
      </div>
      <div className="tiers-grid">
        {([1, 2, 3] as const).map((n) => (
          <label key={n} className="tier-field">
            <span>
              <i className={`tier-dot t${n}`} aria-hidden="true" /> Tier {n} <small>({TIER_NOTE[n]})</small>
            </span>
            <textarea className="control" rows={9} style={{ height: 190, padding: 8 }} value={text[`tier${n}`]} onChange={(e) => setText({ ...text, [`tier${n}`]: e.target.value })} aria-label={`Tier ${n} competitors, one per line`} />
          </label>
        ))}
      </div>
      <div>
        <button className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save tiers"}
        </button>
      </div>
    </section>
  );
}

function Settings() {
  const s = useSettings();
  const secondary = useSchema("secondary");
  const impactOpts = secondary.data?.columns.find((c) => c.key === "impact")?.options ?? [];
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
      await api("/api/settings", { method: "PATCH", json: { ...draft, navOrder: undefined, competitorTiers: undefined, redaction: { ...draft.redaction, quarantineMarkers: markers.split("\n").map((m) => m.trim()).filter((m) => m.length >= 3) } } });
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
        <legend className="section-h">Phantoms</legend>
        <p className="card-sub" style={{ margin: 0 }}>
          Every Primary Tracker entry is in Phantoms. Secondary Tracker entries are included when their Impact is at or above this level (using the Secondary Inbox’s Impact order).
        </p>
        <label className="field" style={{ maxWidth: 320 }}>
          <span>Secondary entries: minimum Impact</span>
          <Combobox
            label="Secondary entries: minimum Impact"
            options={impactOpts}
            value={draft.phantoms.secondaryMinImpact}
            onChange={(v) => v && setDraft({ ...draft, phantoms: { secondaryMinImpact: v } })}
          />
        </label>
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }} data-testid="megatrends-settings">
        <legend className="section-h">Megatrends · AI summaries</legend>
        <p className="card-sub" style={{ margin: 0 }}>
          How Claude writes the Macrotrend and Subtrend summaries once the Claude API is connected (analysts choose ✦ Write with AI on the Megatrends tab). Until then, summaries are written by hand.
        </p>
        <div className="trend-grid">
          <label className="field">
            <span>Time frame: entries from the last (days)</span>
            <input
              className="control"
              type="number"
              min={7}
              max={1095}
              value={draft.megatrends.summaryDays}
              onChange={(e) => setDraft({ ...draft, megatrends: { ...draft.megatrends, summaryDays: num(e.target.value) } })}
            />
          </label>
          <label className="field">
            <span>Summary length (at most, sentences)</span>
            <input
              className="control"
              type="number"
              min={1}
              max={6}
              value={draft.megatrends.summarySentences}
              onChange={(e) => setDraft({ ...draft, megatrends: { ...draft.megatrends, summarySentences: num(e.target.value) } })}
            />
          </label>
          <label className="field">
            <span>Claude model</span>
            <select className="control" value={draft.megatrends.model} onChange={(e) => setDraft({ ...draft, megatrends: { ...draft.megatrends, model: e.target.value } })}>
              {SUMMARY_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Written for (company)</span>
            <input className="control" maxLength={80} value={draft.megatrends.perspective} onChange={(e) => setDraft({ ...draft, megatrends: { ...draft.megatrends, perspective: e.target.value } })} />
          </label>
        </div>
      </fieldset>
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

