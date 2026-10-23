/**
 * CI Squared's part of the Admin page (request 61: Admin is the platform's;
 * each project brings its own settings): extraction quality, the menu, competitor tiers and logos, and the workspace settings.
 */
import { useEffect, useState } from "react";
import {
  DEFAULT_COMPETITOR_TIERS,
  DEFAULT_MENU,
  MAX_MENU_LABEL,
  MENU_GROUP_LABEL,
  MENU_ITEM_LABEL,
  SUMMARY_MODELS,
  DEFAULT_NEW_SIGNAL_DAYS,
  DEFAULT_DISCUSSION_SUMMARY_INSTRUCTIONS,
  MAX_DISCUSSION_INSTRUCTIONS,
  isStandaloneGroup,
  groupLabel,
  itemLabel,
  normaliseMenu,
  type Me,
  type MenuGroupKey,
  type MenuGroupSetting,
  type MenuSetting,
  type TenantSettings,
} from "@eradigm/shared";
import { api } from "../../../api/client";
import { useInvalidate, useQuality, useSchema, useSettings } from "../api/hooks";
import { Combobox } from "../../../components/Combobox";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { ReorderList } from "../components/SchemaEditor";
import { pct } from "../../../lib/format";
import { useToast } from "../../../state/toast";
import { CompetitorLogosCard } from "./CompetitorLogos";

/** CI Squared's settings cards on the Admin page (admins see them all; analysts see extraction quality). */
export function CiSquaredAdmin({ me }: { me: Me }) {
  const isAdmin = me.role === "admin";
  return (
    <>
      <ErrorBoundary label="Extraction quality">
        <Quality manual={me.features.prefill === "manual"} />
      </ErrorBoundary>
      {isAdmin && (
        <ErrorBoundary label="Tabs">
          <MenuEditor />
        </ErrorBoundary>
      )}
      {isAdmin && (
        <ErrorBoundary label="Competitor tiers">
          <CompetitorTiersCard />
        </ErrorBoundary>
      )}
      {isAdmin && (
        <ErrorBoundary label="Competitor logos">
          <CompetitorLogosCard />
        </ErrorBoundary>
      )}
      {isAdmin && (
        <ErrorBoundary label="Settings">
          <Settings />
        </ErrorBoundary>
      )}
    </>
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

/** A menu name, saved when the field is left (empty: the default name). */
function MenuLabel({ value, fallback, label, onCommit }: { value: string | undefined; fallback: string; label: string; onCommit: (v: string | undefined) => void }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const commit = () => {
    const t = v.replace(/\s+/g, " ").trim();
    // The usual name typed back in counts as no new name.
    const next = t && t !== fallback ? t : undefined;
    if (next !== (value || undefined)) onCommit(next);
    else setV(value ?? "");
  };
  return (
    <span className="menu-label">
      <input
        className="control"
        value={v}
        placeholder={fallback}
        maxLength={MAX_MENU_LABEL}
        aria-label={label}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setV(value ?? "");
        }}
      />
      {value && <span className="menu-default">was {fallback}</span>}
    </span>
  );
}

/**
 * The menu, for everyone in the workspace (request 28; saved straight away):
 * the groups in order, each group's subtabs in order (a subtab stays in its
 * group), and their names.
 */
function MenuEditor() {
  const s = useSettings();
  const inv = useInvalidate();
  const toast = useToast();
  if (!s.data) return null;
  const menu = normaliseMenu(s.data.menu);
  const save = async (next: MenuSetting, ok: string) => {
    try {
      await api("/api/settings", { method: "PATCH", json: { menu: next } });
      await inv("settings");
      toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, false);
      return false;
    }
  };
  const withGroup = (key: MenuGroupKey, change: (g: MenuGroupSetting) => MenuGroupSetting): MenuSetting => ({ groups: menu.groups.map((g) => (g.key === key ? change(g) : g)) });
  const byKey = (k: string) => menu.groups.find((g) => g.key === k)!;
  return (
    <section className="card" aria-labelledby="tabs-title" data-testid="tab-order">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="card-title" id="tabs-title">
            Menu
          </h2>
          <span className="card-sub">
            The tabs in the menu, for everyone in this workspace: drag or use ↑ ↓ to reorder them, and type a new name to rename one (leave it empty for the usual name). People only see the tabs their role allows.
          </span>
        </div>
        <button className="btn secondary small" onClick={() => void save(structuredClone(DEFAULT_MENU), "Menu set back to the usual tabs, order and names")}>
          Restore the usual menu
        </button>
      </div>
      <div className="table-cols-list menu-editor">
        <ReorderList
          values={menu.groups.map((g) => g.key)}
          what="Menu tabs"
          labelOf={(k) => groupLabel(byKey(k))}
          itemNoun="tab"
          sortable={false}
          hint="the order of the tabs in the menu"
          onSave={(keys, ok) => save({ groups: keys.map(byKey) }, ok)}
          renderRow={(k, cell) => {
            const g = byKey(k);
            return (
              <div className="menu-group-row" data-testid={`menu-group-${k}`}>
                <div className="menu-row">
                  {cell}
                  <MenuLabel
                    value={g.label}
                    fallback={MENU_GROUP_LABEL[g.key]}
                    label={`Name of the ${MENU_GROUP_LABEL[g.key]} tab`}
                    onCommit={(label) => void save(withGroup(g.key, (x) => ({ ...x, label })), label ? `Tab renamed to “${label}”` : `Tab named “${MENU_GROUP_LABEL[g.key]}” again`)}
                  />
                </div>
                {/* A tab of its own (Database, Admin): no tabs inside to order or name. */}
                {!isStandaloneGroup(g.key) && (
                <div className="menu-items">
                  <ReorderList
                    values={g.items.map((it) => it.key)}
                    what={`${groupLabel(g)} tabs`}
                    labelOf={(ik) => `${groupLabel(g)}: ${itemLabel(g.items.find((x) => x.key === ik)!)}`}
                    itemNoun="tab"
                    sortable={false}
                    hint={`the order in ${groupLabel(g)}`}
                    onSave={(keys, ok) => save(withGroup(g.key, (x) => ({ ...x, items: keys.map((ik) => x.items.find((it) => it.key === ik)!) })), ok)}
                    renderRow={(ik, cell2) => {
                      const it = g.items.find((x) => x.key === ik)!;
                      return (
                        <div className="menu-row" data-testid={`menu-item-${ik}`}>
                          {cell2}
                          <MenuLabel
                            value={it.label}
                            fallback={MENU_ITEM_LABEL[it.key]}
                            label={`Name of the ${MENU_GROUP_LABEL[g.key]} tab ${MENU_ITEM_LABEL[it.key]}`}
                            onCommit={(label) =>
                              void save(
                                withGroup(g.key, (x) => ({ ...x, items: x.items.map((y) => (y.key === it.key ? { ...y, label } : y)) })),
                                label ? `Tab renamed to “${label}”` : `Tab named “${MENU_ITEM_LABEL[it.key]}” again`,
                              )
                            }
                          />
                        </div>
                      );
                    }}
                  />
                </div>
                )}
              </div>
            );
          }}
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
      await api("/api/settings", { method: "PATCH", json: { ...draft, navOrder: undefined, menu: undefined, competitorTiers: undefined, redaction: { ...draft.redaction, quarantineMarkers: markers.split("\n").map((m) => m.trim()).filter((m) => m.length >= 3) } } });
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
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }} data-testid="discussion-summary-settings">
        <legend className="section-h">Primary Tracker · AI Summary</legend>
        <p className="card-sub" style={{ margin: 0 }}>
          The instructions Claude follows when it writes the AI Summary of a Full Discussion or KIQ Archive on Analytics → Primary Tracker, once the Claude API is connected (it uses the Claude model and company set
          above). A summary already written is kept until its discussion changes.
        </p>
        <label className="field">
          <span>Instructions for the AI Summary</span>
          <textarea
            className="control"
            style={{ height: 110, padding: 8, lineHeight: 1.45 }}
            maxLength={MAX_DISCUSSION_INSTRUCTIONS}
            value={draft.discussionSummary?.instructions ?? DEFAULT_DISCUSSION_SUMMARY_INSTRUCTIONS}
            onChange={(e) => setDraft({ ...draft, discussionSummary: { instructions: e.target.value } })}
          />
        </label>
        <div>
          <button className="link-btn" onClick={() => setDraft({ ...draft, discussionSummary: { instructions: DEFAULT_DISCUSSION_SUMMARY_INSTRUCTIONS } })}>
            Use the usual instructions
          </button>
        </div>
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }} data-testid="new-signal-settings">
        <legend className="section-h">Knowledge graphs · New signals</legend>
        <p className="card-sub" style={{ margin: 0 }}>
          A signal whose Event Date is less than this many days ago is new: it pulses in the knowledge graphs and is tagged NEW in their signals lists.
        </p>
        <label className="field" style={{ maxWidth: 320 }}>
          <span>New for (days after its Event Date)</span>
          <input
            className="control"
            type="number"
            min={1}
            max={365}
            value={draft.newSignals?.days ?? DEFAULT_NEW_SIGNAL_DAYS}
            onChange={(e) => setDraft({ ...draft, newSignals: { days: num(e.target.value) } })}
          />
        </label>
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

