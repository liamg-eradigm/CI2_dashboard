import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { CORE, FIELDS, STREAM_LABEL, TABLE_ALL_MAX, can, displayValue, getColumn, phantomColumns, sortedColumns, trackerColumns, type Me, type Newsletter, type Signal, type TrackerColumn, type TrackerSchema } from "@eradigm/shared";
import { api, request, type ApiError } from "../api/client";
import { exportUrl, useArchived, useInvalidate, useNewsletters, useSchema, useSettings, useSignal, useTracker, type TableView } from "../api/hooks";
import { FilterHeader } from "../components/FilterHeader";
import { MarkdownPanel } from "../components/MarkdownPanel";
import { DeleteEntries } from "../components/DeleteEntries";
import { DatesHint } from "../components/DatesHint";
import { RecordDrawer, useFocusTrap } from "../components/RecordDrawer";
import { DeleteDeliverables, DocxButton, DocxPane, NewsletterCreate, canCreateNewsletter } from "../components/Deliverables";
import { SourceDrawer } from "../components/SnapshotFrame";
import { SavedPagesButton, useAttachPage } from "../components/SavedPages";
import { StreamSwitch } from "../components/StreamSwitch";
import { useStreamParam } from "../state/stream";
import { GROWTH_GLYPH, IMPACT_CLASS, IMPACT_GLYPH, impactBucket } from "../lib/format";
import { useFilters } from "../state/filters";
import { useToast } from "../state/toast";
import { useFitToScreen } from "../lib/fitToScreen";
import { PrimaryTrackerFilters, primaryTrackerFilters } from "../components/PrimaryTrackerFilters";
import { DatabaseFilters, databaseFilters } from "../components/DatabaseFilters";
import { NewsletterCell, NewspaperIcon } from "../components/NewsletterCell";
import { DiscussionSummaryBox } from "../components/DiscussionSummaryBox";
import { RichText } from "../components/BulletText";
import { SizedHeading } from "../components/TextSize";

const PAGE = 10;

/**
 * Analytics → Primary Tracker (request 38): these columns, in this order, in
 * the table and in Archived Responses. The Signals Database keeps its own.
 */
const PRIMARY_TRACKER_KEYS = [FIELDS.sourceCompany, FIELDS.sourceRole, CORE.date, FIELDS.insightTopic, FIELDS.keyQuestion, FIELDS.keyDetails, FIELDS.keyMetrics];
const primaryTrackerColumns = (s: TrackerSchema) => PRIMARY_TRACKER_KEYS.map((k) => getColumn(s, k)).filter((c): c is TrackerColumn => !!c);

/** Full Discussion (request 42): a speech bubble. */
function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" data-icon="chat">
      <path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3.6 2.8v-2.8H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 8.2h7M6.5 10.8h4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** KIQ Archive (request 42): the link icon Archived Responses had. */
function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" data-icon="link">
      <path d="M8.2 11.8a3.2 3.2 0 0 0 4.5 0l2.6-2.6a3.2 3.2 0 0 0-4.5-4.5l-1 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11.8 8.2a3.2 3.2 0 0 0-4.5 0l-2.6 2.6a3.2 3.2 0 0 0 4.5 4.5l1-1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Cell({ col, s, impactCol, growthCol, actionCol }: { col: TrackerColumn; s: Signal; impactCol?: TrackerColumn; growthCol?: TrackerColumn; actionCol?: TrackerColumn }) {
  const v = s.values[col.key];
  const text = displayValue(col, v);
  if (col.type === "date") return <td className="date">{text}</td>;
  if (col.key === FIELDS.id) return <td className="nowrap">{text}</td>;
  if (col.type === "long")
    return (
      <td className="long">
        <div className="clamp" title={text}>
          {text}
        </div>
      </td>
    );
  if (col.key === CORE.competitors) return <td className="comp">{text}</td>;
  if (col.key === CORE.title) return <td className="title">{text}</td>;
  if (col.key === CORE.impact && typeof v === "string") {
    const b = impactBucket(impactCol, v);
    const cls = b < 0 ? "" : IMPACT_CLASS[b as 0 | 1 | 2];
    return (
      <td>
        <span className={`impact ${cls}`}>
          <span className="g" aria-hidden="true">
            {b < 0 ? "" : IMPACT_GLYPH[b]}
          </span>
          {v}
        </span>
      </td>
    );
  }
  if (col.key === CORE.growth && typeof v === "string") {
    const b = impactBucket(growthCol, v);
    return (
      <td className="growth">
        <span className="g" aria-hidden="true">
          {b < 0 ? "" : GROWTH_GLYPH[b]}
        </span>
        {v}
      </td>
    );
  }
  if (col.key === "action" && typeof v === "string") {
    const on = v === actionCol?.options?.[0];
    return (
      <td className={on ? "action-on" : "action-off"}>
        <span aria-hidden="true">{on ? "✓ " : "○ "}</span>
        {v}
      </td>
    );
  }
  return <td style={{ minWidth: col.type === "macro" ? 150 : col.type === "sub" ? 160 : undefined }}>{text}</td>;
}

/**
 * Source cell of a Tracker/Phantoms row: opens the saved source page in the side pane, or — for
 * an entry without one (imported from a spreadsheet) — a green plus to attach
 * the HTML file (analysts and admins).
 */
function SourceCell({ s, canAttach, onOpen, cls = "src-col" }: { s: Signal; canAttach: boolean; onOpen: (pageId: string | null) => void; cls?: string }) {
  const title = String(s.values[CORE.title] ?? s.code);
  const attach = useAttachPage(s);
  if (s.hasSnapshot) {
    return (
      <td className={cls}>
        <SavedPagesButton entry={{ id: s.id, code: s.code, title }} pages={s.pages} canAttach={canAttach} onOpen={onOpen} />
      </td>
    );
  }
  if (!canAttach) {
    return (
      <td className={cls}>
        <span className="src-none" title="No saved page for this entry" aria-label="No saved page">
          —
        </span>
      </td>
    );
  }
  return (
    <td className={cls}>
      {attach.input}
      <button className="src-btn add" disabled={attach.busy} onClick={attach.pick} aria-label={`Attach the HTML page for ${title}`} title="No saved page yet · click to upload the HTML file">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="8.25" fill="currentColor" />
          <path d="M10 6v8M6 10h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </td>
  );
}

const NOUN: Record<TableView, string> = { tracker: "Tracker", phantoms: "Phantoms", alerts: "Phantoms", newsletter: "Phantoms", database: "Tracker" };

/** The Markdown icon (Phantoms). */
function MdIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M5 2.5h6.5L15.5 6.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11.5 2.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <text x="10" y="14.6" textAnchor="middle" fontSize="5.6" fontWeight="700" fontFamily="sans-serif" fill="currentColor">MD</text>
    </svg>
  );
}

/**
 * The Tracker and Phantoms tabs, and the two Deliverables tables (Alerts and
 * Newsletter, built from Phantoms): the same filterable table, per stream.
 * Phantoms-based tables add the Markdown; Alerts add the .docx alert; the
 * Newsletter table's tick boxes build a newsletter.
 *
 * The Database page (request 43, view "database"): a stream's Tracker
 * entries with every field, their saved page, Markdown (Phantoms), alert and
 * newsletters, its own filters, and Generate Newsletter from the ticked rows.
 */
export function TrackerPage({
  me,
  view = "tracker",
  title,
  above,
  primaryOnly = false,
  switcher,
}: {
  me: Me;
  view?: TableView;
  title?: string;
  above?: ReactNode;
  primaryOnly?: boolean;
  /** The Database page: its Primary / Secondary / CI Analysis toggle, in place of the Primary / Secondary switch. */
  switcher?: ReactNode;
}) {
  const database = view === "database";
  // Phantoms and the Deliverables tables share the Phantoms columns, Markdown and rules.
  const phantoms = view !== "tracker" && !database;
  const newsletter = view === "newsletter";
  const [streamParam, setStream] = useStreamParam();
  // Analytics → Primary Tracker (request 34): the Primary Tracker only, with Archived Responses.
  const stream = primaryOnly ? "primary" : streamParam;
  // Primary Tracker and Phantoms: 🔗 marks entries linked to others from the same source (request 27).
  const linkCol = stream === "primary" && (view === "tracker" || view === "phantoms");
  const schema = useSchema(stream);
  const settings = useSettings();
  const f = useFilters(schema.data, settings.data?.timezone ?? me.timezone);
  const toast = useToast();
  const sortKey = f.params.get("sort") ?? "date";
  const dir = (f.params.get("dir") as "asc" | "desc") ?? "desc";
  // "Display all": one long, scrollable table instead of pages of 10.
  const showAll = f.params.get("all") === "1";
  const page = showAll ? 0 : Math.max(0, Number(f.params.get("page") ?? 0) || 0);
  const size = showAll ? TABLE_ALL_MAX : PAGE;
  // Analytics → Primary Tracker has its own filters (request 41); every other table shares one set.
  const ptFilters = useMemo(() => (primaryOnly ? primaryTrackerFilters(f.params, f.defaults) : null), [primaryOnly, f.params, f.defaults]);
  // The Database page has its own filters too, on every field (request 43).
  const dbFilters = useMemo(() => (database && schema.data ? databaseFilters(f.params, f.defaults, schema.data) : null), [database, f.params, f.defaults, schema.data]);
  const query = ptFilters ?? dbFilters ?? f.filters;
  const tracker = useTracker(query, { key: sortKey, dir }, page, size, stream, view, !!schema.data && f.ready);
  const [exportOpen, setExportOpen] = useState(false);
  const [scope, setScope] = useState<"filtered" | "all">("filtered");
  const exportRef = useRef<HTMLDivElement>(null);
  // The Database table takes 80% of the space below the filters (request 44); the Primary Tracker's runs to the
  // bottom of the window, under the AI Summary (request 45), so each page fits the screen.
  const fitRef = useFitToScreen(primaryOnly ? 160 : 260, database ? 0.8 : 1, primaryOnly);
  const selected = f.params.get("signal");
  const mdOpen = f.params.get("md");
  const archId = primaryOnly ? f.params.get("arch") : null;
  const archPopup = primaryOnly ? f.params.get("ap") : null;
  // Request 39: the pop-up of a Primary Tracker row (left, over the table, beside Archived Responses; else centred).
  const rowPopup = primaryOnly ? f.params.get("pp") : null;
  // Which earlier entries the split shows: Full Discussion (the same source) or, with am=kiq, the KIQ Archive (request 42).
  const archMode: "source" | "kiq" = primaryOnly && f.params.get("am") === "kiq" ? "kiq" : "source";
  const archived = useArchived(primaryOnly ? archId : null, archMode);
  const archRows = archived.data?.rows ?? [];
  const archSignal = useSignal(archId);
  const archSource = archSignal.data ? [archSignal.data.values[FIELDS.sourceRole], archSignal.data.values[FIELDS.sourceCompany]].filter(Boolean).join(" · ") : undefined;
  const savedOpen = f.params.get("saved");
  const docxOpen = f.params.get("docx");
  const newsletters = useNewsletters(newsletter);
  // Ticked rows: for deletion (Tracker/Phantoms, cleared when the page of rows
  // changes) or, on the Newsletter table, the entries of the next newsletter
  // (kept across pages and both streams).
  const [picked, setPicked] = useState<Map<string, Signal>>(() => new Map());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const inv = useInvalidate();
  const rowKey = tracker.data?.rows.map((r) => r.id).join(",") ?? "";
  // The Database page keeps its ticks across pages and both streams, to build a newsletter from.
  const keepPicks = newsletter || database;
  useEffect(() => {
    if (!keepPicks) setPicked(new Map());
  }, [rowKey, stream, view, keepPicks]);

  const setParam = useCallback(
    (patch: Record<string, string | null>, push = false) =>
      f.setParams(
        (p) => {
          const n = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null) n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: !push },
      ),
    [f],
  );

  // Esc closes the right-hand pop-up first, then the left one (the panes are not modal).
  useEffect(() => {
    if (!archId || (!rowPopup && !archPopup)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[role=dialog][aria-modal=true]")) return;
      if (archPopup) setParam({ ap: null });
      else setParam({ pp: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [archId, rowPopup, archPopup, setParam]);

  useEffect(() => {
    if (!exportOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExportOpen(false);
    const onClick = (e: MouseEvent) => !exportRef.current?.contains(e.target as Node) && setExportOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [exportOpen]);

  // Alerts on a long page are written a batch at a time: fetch again until every row has one.
  const missingAlerts = (view === "alerts" && !!tracker.data?.rows.some((r) => !r.alertId)) || (database && !!tracker.data?.rows.some((r) => r.alertPending));
  useEffect(() => {
    if (!missingAlerts) return;
    const id = setTimeout(() => void tracker.refetch(), 1200);
    return () => clearTimeout(id);
  }, [missingAlerts, tracker, tracker.data]);

  if (!schema.data) return <div className="content"><div className="skeleton" style={{ height: 200 }} /></div>;
  const s = schema.data;
  // Each table has its own columns, chosen from the Inbox columns (Inbox → Edit columns).
  const cols = primaryOnly ? primaryTrackerColumns(s) : database ? sortedColumns(s) : phantoms ? phantomColumns(s) : trackerColumns(s);
  // The column whose cell opens the entry: its Title, or (Primary Tracker, no Title column) the first.
  const openKey = primaryOnly ? cols[0]?.key : CORE.title;
  const canAttach = can(me.role, "item:edit");
  // Phantoms (and the Deliverables built from them) are an evergreen snapshot: only Tracker entries are edited.
  // (The Analytics Primary Tracker has no Source or Edit columns, request 42.)
  const canEdit = canAttach && (view === "tracker" || database) && !primaryOnly;
  const canDelete = can(me.role, "item:delete");
  const canGenerate = database && canCreateNewsletter(me);
  // Alerts (request 36): tick to delete alerts. The Database page: to delete, or to generate a newsletter.
  const tickable = newsletter ? canCreateNewsletter(me) : database ? canDelete || canGenerate : (view === "tracker" || view === "phantoms" || view === "alerts") && canDelete;
  const impactCol = getColumn(s, CORE.impact);
  const growthCol = getColumn(s, CORE.growth);
  const actionCol = getColumn(s, "action");
  const t = tracker.data;
  const pages = t ? Math.max(1, Math.ceil(t.total / size)) : 1;
  const pickedRows = [...picked.values()];
  const onPage = t?.rows.filter((r) => picked.has(r.id)).length ?? 0;
  const allPicked = !!t?.rows.length && onPage === t.rows.length;
  const toggle = (r: Signal) =>
    setPicked((p) => {
      const n = new Map(p);
      if (n.has(r.id)) n.delete(r.id);
      else n.set(r.id, r);
      return n;
    });
  const togglePage = () =>
    setPicked((p) => {
      const n = new Map(p);
      for (const r of t?.rows ?? []) {
        if (allPicked) n.delete(r.id);
        else n.set(r.id, r);
      }
      return n;
    });
  const savedRow = savedOpen ? t?.rows.find((r) => r.id === savedOpen) : undefined;
  const docxRow = docxOpen ? t?.rows.find((r) => r.alertId === docxOpen) : undefined;
  const docxNewsletter = docxOpen ? (newsletters.data?.find((n) => n.id === docxOpen) ?? t?.rows.flatMap((r) => r.newsletters ?? []).find((n) => n.id === docxOpen)) : undefined;
  const titleOf = (r: Signal) => String(r.values[CORE.title] ?? r.code);
  /** Primary Tracker (request 39): a row opens its pop-up; beside the Full Discussion / KIQ Archive when it has one and they are open. */
  const openRow = (r: Signal) => {
    if (!archId || archId === r.id) return setParam({ pp: r.id }, true);
    const has = archMode === "kiq" ? r.kiqEarlier : r.discussionWith;
    setParam({ pp: r.id, arch: has ? r.id : null, am: has && archMode === "kiq" ? "kiq" : null, ap: null }, true);
  };
  const onRowClick = (e: ReactMouseEvent, r: Signal) => {
    if (!primaryOnly || (e.target as HTMLElement).closest("button, a, input, label, select, textarea")) return;
    openRow(r);
  };
  const info = t
    ? !t.total
      ? "0 results"
      : showAll
        ? t.total > size
          ? `Showing the first ${size} of ${t.total}`
          : `Showing all ${t.total}`
        : `Showing ${page * PAGE + 1}–${Math.min(t.total, page * PAGE + PAGE)} of ${t.total} · page ${page + 1} of ${pages}`
    : "Loading…";


  /** The Database page: a newsletter from the ticked rows (for now, a .docx of their titles), attached to each of them. */
  const generate = async () => {
    setGenerating(true);
    try {
      const n = await api<Newsletter>("/api/newsletters/generate", { method: "POST", json: { itemIds: pickedRows.map((r) => r.id) } });
      await inv("tracker", "newsletters");
      setPicked(new Map());
      toast(`Generated “${n.name}” from ${n.items.length} entries`);
    } catch (e) {
      toast(`Could not generate the newsletter · ${(e as ApiError).message}`, false);
    } finally {
      setGenerating(false);
    }
  };

  const doExport = async (format: string) => {
    setExportOpen(false);
    try {
      const res = await request(exportUrl(query, { key: sortKey, dir }, scope, format, stream, view));
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `eradigm-tracker.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`Exported ${res.headers.get("x-export-rows") ?? ""} rows as .${format}`);
    } catch (e) {
      toast(`Export failed · ${(e as Error).message}`, false);
    }
  };

  return (
    <>
      {primaryOnly ? (
        <>
          <PrimaryTrackerFilters title={title ?? "Primary Tracker"} schema={s} params={f.params} setParams={f.setParams} defaults={f.defaults} />
          {/* The AI Summary of the open Full Discussion or KIQ Archive (request 43), attached under the sticky filters (request 44). */}
          <DiscussionSummaryBox me={me} id={archId} mode={archMode} source={archSource} />
        </>
      ) : database ? (
        <DatabaseFilters schema={s} params={f.params} setParams={f.setParams} defaults={f.defaults} />
      ) : (
        <FilterHeader title={title ?? (phantoms ? "Phantoms Database" : "Signals Database")} schema={s} f={f} viewKind="tracker" />
      )}
      <div className={`content${primaryOnly ? " ptr-content" : ""}`}>
        {above}
        {/* Analytics → Primary Tracker: no switch or note; the table sits right under the AI Summary (request 45). */}
        {!primaryOnly && (
          <div className={`stream-bar${database ? " db-bar" : ""}`}>
            {switcher ?? <StreamSwitch noun={NOUN[view]} value={stream} onChange={setStream} label={`${NOUN[view]} to show`} />}
            <span className="stream-note">
              {database
                ? `Every ${STREAM_LABEL[stream]} Tracker entry with all its fields, its saved page, Markdown, alert and newsletters`
                : view === "alerts"
                ? `${STREAM_LABEL[stream]} Phantoms with High Impact · each gets a .docx alert automatically`
                : newsletter
                  ? `${STREAM_LABEL[stream]} Phantoms with High or Medium Impact · tick entries from either stream, then Create Newsletter`
                  : phantoms
                    ? stream === "primary"
                      ? "Every Primary Tracker entry · open the Markdown from the MD icon"
                      : `Secondary Tracker entries with Impact ${settings.data?.phantoms.secondaryMinImpact ?? "Low"} or higher (set by admins) · open the Markdown from the MD icon`
                    : `Approved entries from the ${STREAM_LABEL[stream]} Inbox`}
            </span>
            {canGenerate && pickedRows.length >= 2 && (
              <button className="btn gen-newsletter" disabled={generating} onClick={() => void generate()} data-testid="generate-newsletter" title={`A newsletter from the ${pickedRows.length} ticked entries`}>
                <NewspaperIcon />
                <span>{generating ? "Generating…" : `Generate Newsletter (${pickedRows.length})`}</span>
              </button>
            )}
          </div>
        )}
        <div className={archId ? "arch-split" : undefined} data-testid={archId ? "arch-split" : undefined}>
        <section className={`card flush pop-host${primaryOnly ? " ptr-card" : ""}`} aria-label="Approved signals table">
          <div className="table-top">
            {primaryOnly ? (
              <div className="ptr-head">
                <SizedHeading className="card-title" sizeKey="heading:primary-signals" label="Primary Signals heading">
                  Primary Signals
                </SizedHeading>
                <span className="card-sub info" aria-live="polite">
                  {info}
                </span>
              </div>
            ) : (
              <span className="info" aria-live="polite">
                {info}
                {!database && <DatesHint info={t?.outsideDates} f={f} />}
              </span>
            )}
            <div className="table-actions">
              {newsletter && tickable && (
                <div className="pick-bar" role="group" aria-label="Selected entries">
                  <span>{pickedRows.length} selected</span>
                  {pickedRows.length > 0 && (
                    <button className="link-btn" onClick={() => setPicked(new Map())}>
                      Clear
                    </button>
                  )}
                  <button className="btn small" disabled={!pickedRows.length} onClick={() => setCreating(true)} title={pickedRows.length ? undefined : "Tick one or more entries first"}>
                    Create Newsletter
                  </button>
                </div>
              )}
              {!newsletter && tickable && pickedRows.length > 0 && (
                <div className="pick-bar" role="group" aria-label="Selected entries">
                  <span>{pickedRows.length} selected</span>
                  <button className="link-btn" onClick={() => setPicked(new Map())}>
                    Clear
                  </button>
                  {canDelete && (
                    <button className="btn danger small" onClick={() => setConfirmDelete(true)}>
                      Delete selected
                    </button>
                  )}
                </div>
              )}
              <div style={{ position: "relative" }} ref={exportRef}>
                <button className="btn" aria-haspopup="true" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}>
                  <span aria-hidden="true">⤓</span>
                  <span>Export</span>
                  <span style={{ fontSize: 10 }} aria-hidden="true">
                    ▾
                  </span>
                </button>
                {exportOpen && (
                  <div className="popover" role="dialog" aria-label="Export options">
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="h">ROWS</span>
                      <div className="seg" role="group" aria-label="Rows to export">
                        <button aria-pressed={scope === "filtered"} onClick={() => setScope("filtered")}>
                          Filtered ({t?.total ?? 0})
                        </button>
                        <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
                          All ({t?.totalPublished ?? 0})
                        </button>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="h">FORMAT</span>
                      {[
                        ["csv", "CSV", ".csv"],
                        ["xlsx", "Excel", ".xlsx"],
                        ["tsv", "TSV", ".tsv"],
                        ["json", "JSON", ".json"],
                      ].map(([k, l, n]) => (
                        <button key={k} className="fmt" onClick={() => doExport(k as string)}>
                          <b>{l}</b>
                          <span>{n}</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
                      {database
                        ? `Includes every ${STREAM_LABEL[stream]} field (${cols.length}) plus signal ID, in the current sort order.`
                        : `Includes the ${cols.length} ${STREAM_LABEL[stream]} ${phantoms ? "Phantoms" : "Tracker"} columns plus signal ID, in the current sort order.`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Request 36: the table scrolls inside its own box, sized to the screen, so its horizontal scrollbar is always in view. */}
          <div ref={fitRef} className={`table-wrap fit${showAll ? " all" : ""}`} tabIndex={0} role="region" aria-label={showAll ? "All entries (scrollable)" : "Entries (scrollable)"} data-testid="table-scroll">
            <table className={`data${primaryOnly ? " ptr" : ""}${database ? " db-table" : ""}`} style={{ minWidth: primaryOnly ? 1500 : Math.max(1100, cols.length * (database ? 150 : 125) + (phantoms ? 150 : 0) + (linkCol ? 60 : 0) + (view === "alerts" ? 70 : 0) + (database ? 300 : 0)) }}>
              <caption className="sr-only">Approved signals, sorted by {getColumn(s, sortKey)?.label ?? "Date"} {dir === "asc" ? "ascending" : "descending"}</caption>
              <thead>
                <tr>
                  {tickable && (
                    <th scope="col" className="pick-col">
                      <input
                        type="checkbox"
                        checked={allPicked}
                        ref={(el) => {
                          if (el) el.indeterminate = onPage > 0 && !allPicked;
                        }}
                        disabled={!t?.rows.length}
                        onChange={togglePage}
                        aria-label="Select every entry on this page"
                      />
                    </th>
                  )}
                  {view === "alerts" && (
                    <th scope="col" className="md-col">
                      <span>Alert</span>
                    </th>
                  )}
                  {phantoms && (
                    <th scope="col" className="md-col">
                      <span>Markdown</span>
                    </th>
                  )}
                  {!primaryOnly && (
                    <th scope="col" className={database ? "doc-col" : "src-col"}>
                      <span>Source</span>
                    </th>
                  )}
                  {/* The Database page's four document columns share one width, their icons centred (request 44). */}
                  {database && (
                    <>
                      <th scope="col" className="doc-col">
                        <span>Markdown</span>
                      </th>
                      <th scope="col" className="doc-col">
                        <span>Alert</span>
                      </th>
                      <th scope="col" className="doc-col">
                        <span>Newsletter</span>
                      </th>
                    </>
                  )}
                  {linkCol &&
                    (primaryOnly ? (
                      <>
                        <th scope="col" className="arch-col" title="The other answers of the same conversation (same Source Role, Source Company and Event Date)">
                          <span>Full Discussion</span>
                        </th>
                        <th scope="col" className="arch-col" title="Earlier answers from the same source with the same Insight Topic and Key Intelligence Question">
                          <span>KIQ Archive</span>
                        </th>
                      </>
                    ) : (
                      <th scope="col" className="link-col" title="Linked to other entries from the same source (Source Role and Source Company)">
                        <span aria-hidden="true">🔗</span>
                        <span className="sr-only">Linked</span>
                      </th>
                    ))}
                  {canEdit && (
                    <th scope="col" className={database ? "doc-col" : "src-col"}>
                      <span>Edit</span>
                    </th>
                  )}
                  {cols.map((c) => {
                    const active = sortKey === c.key;
                    return (
                      <th key={c.key} scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                        <button onClick={() => setParam({ sort: c.key, dir: active && dir === "desc" ? "asc" : "desc", page: null })}>
                          {c.label} {active ? (dir === "desc" ? "↓" : "↑") : ""}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {t?.rows.map((r) => (
                  <tr key={r.id} className={[picked.has(r.id) ? "picked" : "", primaryOnly ? "arch-row" : "", primaryOnly && rowPopup === r.id ? "open" : ""].filter(Boolean).join(" ") || undefined} onClick={(e) => onRowClick(e, r)}>
                    {tickable && (
                      <td className="pick-col">
                        <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r)} aria-label={`Select ${titleOf(r)}`} />
                      </td>
                    )}
                    {view === "alerts" && (
                      <td className="md-col">{r.alertId ? <DocxButton label={`Open the alert for ${titleOf(r)}`} onClick={() => setParam({ docx: r.alertId ?? null }, true)} /> : <span className="src-none">—</span>}</td>
                    )}
                    {phantoms && (
                      <td className="md-col">
                        <button className="src-btn open md-open" onClick={() => setParam({ md: r.id }, true)} aria-label={`Open Markdown for ${String(r.values[CORE.title] ?? r.code)}`} title="Open the Markdown file">
                          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                            <path d="M5 2.5h6.5L15.5 6.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                            <path d="M11.5 2.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                            <text x="10" y="14.6" textAnchor="middle" fontSize="5.6" fontWeight="700" fontFamily="sans-serif" fill="currentColor">MD</text>
                          </svg>
                        </button>
                      </td>
                    )}
                    {!primaryOnly && <SourceCell s={r} canAttach={canAttach} cls={database ? "doc-col" : "src-col"} onOpen={(pageId) => setParam({ saved: r.id, savedPage: pageId }, true)} />}
                    {database && (
                      <>
                        <td className="doc-col">
                          {r.phantom ? (
                            <button className="src-btn open md-open" onClick={() => setParam({ md: r.id }, true)} aria-label={`Open Markdown for ${titleOf(r)}`} title="Open the Phantom’s Markdown file">
                              <MdIcon />
                            </button>
                          ) : (
                            <span className="src-none" aria-label="Not in Phantoms" title="Not in Phantoms">
                              —
                            </span>
                          )}
                        </td>
                        <td className="doc-col">
                          {r.alertId ? (
                            <DocxButton label={`Open the alert for ${titleOf(r)}`} onClick={() => setParam({ docx: r.alertId ?? null }, true)} />
                          ) : (
                            <span className="src-none" aria-label={r.alertPending ? "Alert being written" : "No alert"} title={r.alertPending ? "Being written…" : "Alerts are written for High Impact Phantoms"}>
                              {r.alertPending ? "…" : "—"}
                            </span>
                          )}
                        </td>
                        <td className="doc-col">
                          <NewsletterCell title={titleOf(r)} newsletters={r.newsletters ?? []} onOpen={(id) => setParam({ docx: id }, true)} />
                        </td>
                      </>
                    )}
                    {linkCol && primaryOnly && (
                      <td className="arch-col">
                        {r.discussionWith ? (
                          <button
                            className={`src-btn open arch-btn${archId === r.id && archMode === "source" ? " on" : ""}`}
                            data-testid="archived-cell"
                            onClick={() => setParam({ arch: r.id, am: null, pp: r.id, ap: null }, true)}
                            aria-label={`Full Discussion: the other answers of the same conversation as ${titleOf(r)}`}
                            title="Full Discussion · the other answers of the same conversation (same source and Event Date)"
                          >
                            <ChatIcon />
                          </button>
                        ) : (
                          <span className="src-none" aria-label="No other answers in this conversation">
                            —
                          </span>
                        )}
                      </td>
                    )}
                    {linkCol && primaryOnly && (
                      <td className="arch-col">
                        {r.kiqEarlier ? (
                          <button
                            className={`src-btn open arch-btn${archId === r.id && archMode === "kiq" ? " on" : ""}`}
                            data-testid="kiq-cell"
                            onClick={() => setParam({ arch: r.id, am: "kiq", pp: r.id, ap: null }, true)}
                            aria-label={`KIQ Archive: earlier answers to the same Key Intelligence Question from the same source as ${titleOf(r)}`}
                            title="KIQ Archive · earlier answers from the same source, Insight Topic and Key Intelligence Question"
                          >
                            <LinkIcon />
                          </button>
                        ) : (
                          <span className="src-none" aria-label="No earlier answers to this Key Intelligence Question">
                            —
                          </span>
                        )}
                      </td>
                    )}
                    {linkCol && !primaryOnly && (
                      <td className="link-col">
                        {r.linkedEarlier || r.linkedLater ? (
                          <button
                            className="src-btn open link-btn-cell"
                            data-testid="linked-cell"
                            onClick={() => setParam(phantoms ? { md: r.id } : { signal: r.id }, true)}
                            aria-label={`Linked to ${r.linkedEarlier ? "an earlier" : "a later"} entry from the same source: open ${titleOf(r)} side by side`}
                            title={`Same source as ${r.linkedEarlier && r.linkedLater ? "an earlier and a later entry" : r.linkedEarlier ? "an earlier entry" : "a later entry"} · open side by side`}
                          >
                            <span aria-hidden="true">🔗</span>
                          </button>
                        ) : (
                          <span className="src-none" aria-label="Not linked">
                            —
                          </span>
                        )}
                      </td>
                    )}
                    {canEdit && (
                      <td className={database ? "doc-col" : "src-col"}>
                        <button className="src-btn open edit-btn" onClick={() => setParam({ signal: r.id, edit: "1" }, true)} aria-label={`Edit ${titleOf(r)}`} title="Edit, then approve again">
                          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
                            <path d="M13.6 3.2l3.2 3.2-9.4 9.4-3.9.7.7-3.9 9.4-9.4Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                            <path d="M11.8 5l3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        </button>
                      </td>
                    )}
                    {cols.map((c) =>
                      c.key === openKey ? (
                        <td key={c.key} className="title">
                          <button
                            onClick={(e) => (e.stopPropagation(), primaryOnly ? openRow(r) : setParam(phantoms ? { md: r.id } : { signal: r.id }, true))}
                            aria-label={`${phantoms ? "View Markdown" : primaryOnly ? "Open" : "Open record"}: ${c.key === CORE.title ? String(r.values[c.key] ?? "") : titleOf(r)}`}
                          >
                            {displayValue(c, r.values[c.key]) || "—"}
                          </button>
                        </td>
                      ) : (
                        <Cell key={c.key} col={c} s={r} impactCol={impactCol} growthCol={growthCol} actionCol={actionCol} />
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t && !t.rows.length && <div className="empty">No approved signals match these filters.</div>}
          <div className="pager-row">
            {showAll ? (
              <button className="btn pager" onClick={() => setParam({ all: null, page: null })} data-testid="show-pages">
                Show 10 per page
              </button>
            ) : (
              <>
                <button className="btn pager" onClick={() => setParam({ all: "1", page: null })} disabled={!t || t.total <= PAGE} data-testid="display-all" title="Show every entry in one long table">
                  Display all
                </button>
                <span className="pager-gap" />
                <button className="btn pager" disabled={page <= 0} onClick={() => setParam({ page: String(page - 1) })}>
                  ← Previous
                </button>
                <button className="btn pager" disabled={page >= pages - 1} onClick={() => setParam({ page: String(page + 1) })}>
                  Next →
                </button>
              </>
            )}
          </div>
          {archId && rowPopup && (
            <AnswerCard
              key={rowPopup}
              id={rowPopup}
              schema={s}
              kind="primary"
              mode="pane"
              onClose={() => setParam({ pp: null })}
              onOpenRecord={() => setParam({ signal: rowPopup }, true)}
            />
          )}
        </section>
        {archId && (
          <ArchivedPanel
            id={archId}
            schema={s}
            cols={cols}
            mode={archMode}
            current={archPopup}
            onOpen={(id) => setParam({ ap: id }, true)}
            onClose={() => setParam({ arch: null, am: null, ap: null })}
          >
            {archPopup && (
              <AnswerCard
                key={archPopup}
                id={archPopup}
                schema={s}
                kind="archived"
                mode="pane"
                onClose={() => setParam({ ap: null })}
                nav={(() => {
                  const i = archRows.findIndex((x) => x.id === archPopup);
                  return i < 0 ? undefined : { index: i, total: archRows.length, onStep: (d: number) => archRows[i + d] && setParam({ ap: archRows[i + d]!.id }) };
                })()}
              />
            )}
          </ArchivedPanel>
        )}
        </div>
      </div>
      {!archId && rowPopup && (
        <AnswerCard key={rowPopup} id={rowPopup} schema={s} kind="primary" mode="modal" onClose={() => setParam({ pp: null })} onOpenRecord={() => setParam({ pp: null, signal: rowPopup }, true)} />
      )}
      {savedOpen && !selected && !mdOpen && (
        <SourceDrawer
          itemId={savedOpen}
          pageId={f.params.get("savedPage")}
          pages={savedRow?.pages ?? 1}
          canAttach={canAttach}
          code={savedRow?.code ?? "Saved source"}
          title={String(savedRow?.values[CORE.title] ?? "Saved copy of the page")}
          onPage={(id) => setParam({ savedPage: id })}
          onClose={() => setParam({ saved: null, savedPage: null })}
        />
      )}
      {docxOpen && !selected && (
        <DocxPane
          id={docxOpen}
          kind={docxNewsletter ? "Newsletter" : "Alert"}
          title={docxNewsletter?.name ?? (docxRow ? titleOf(docxRow) : "Document")}
          onClose={() => setParam({ docx: null })}
        />
      )}
      {creating && pickedRows.length > 0 && (
        <NewsletterCreate
          entries={pickedRows.map((r) => ({ id: r.id, code: String(r.values[FIELDS.id] ?? "") || r.code, label: titleOf(r) }))}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setPicked(new Map());
          }}
        />
      )}
      {confirmDelete && pickedRows.some((r) => r.alertId) && view === "alerts" && (
        <DeleteDeliverables
          kind="alert"
          items={pickedRows.filter((r) => r.alertId).map((r) => ({ id: r.alertId!, code: String(r.values[FIELDS.id] ?? "") || r.code, label: titleOf(r) }))}
          onCancel={() => setConfirmDelete(false)}
          onDone={(ids) => {
            setPicked((p) => new Map([...p].filter(([, r]) => !r.alertId || !ids.includes(r.alertId))));
            setConfirmDelete(false);
          }}
        />
      )}
      {confirmDelete && pickedRows.length > 0 && (view === "tracker" || view === "phantoms" || database) && (
        <DeleteEntries
          modal
          table={database ? "tracker" : view === "phantoms" ? "phantoms" : "tracker"}
          entries={pickedRows.map((r) => ({ id: r.id, code: r.code, title: String(r.values[CORE.title] ?? "") }))}
          onCancel={() => setConfirmDelete(false)}
          onDone={(ids) => {
            setPicked((p) => new Map([...p].filter(([id]) => !ids.includes(id))));
            if (ids.length === pickedRows.length) setConfirmDelete(false);
          }}
        />
      )}
      {mdOpen && !selected && (
        <MarkdownPanel
          id={mdOpen}
          onClose={() => setParam({ md: null })}
          onOpenRecord={(id) => setParam({ md: null, signal: id }, true)}
          onEdit={canEdit ? (id) => setParam({ md: null, signal: id, edit: "1" }, true) : undefined}
        />
      )}
      {selected && (
        <RecordDrawer
          key={`${selected}-${f.params.get("edit") ?? ""}`}
          id={selected}
          schema={s}
          me={me}
          table={database ? "tracker" : view === "tracker" || view === "phantoms" ? view : undefined}
          startEditing={canEdit && f.params.get("edit") === "1"}
          editable={view === "tracker" || database}
          onClose={() => setParam({ signal: null, edit: null })}
          onOpen={(id) => setParam({ signal: id, edit: null }, true)}
        />
      )}
    </>
  );
}

/**
 * Archived Responses (request 34): the entries linked to the open one — the
 * rest of its conversation (Full Discussion, request 46) or its KIQ Archive —
 * in a table like the Primary Tracker's, on the right of a split screen.
 */
function ArchivedPanel({
  id,
  schema,
  cols,
  mode = "source",
  current,
  onOpen,
  onClose,
  children,
}: {
  id: string;
  schema: TrackerSchema;
  cols: TrackerColumn[];
  /** Full Discussion (the same source) or the KIQ Archive (also the same Insight Topic and KIQ, request 42). */
  mode?: "source" | "kiq";
  current: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  /** The open archived response's pop-up, over this table (request 39). */
  children?: ReactNode;
}) {
  const q = useArchived(id, mode);
  const name = mode === "kiq" ? "KIQ Archive" : "Archived Responses";
  const cur = useSignal(id);
  const impactCol = getColumn(schema, CORE.impact);
  const growthCol = getColumn(schema, CORE.growth);
  const actionCol = getColumn(schema, "action");
  const rows = q.data?.rows ?? [];
  // Level with the Primary Tracker beside it: to the bottom of the window (request 45).
  const fitRef = useFitToScreen(160, 1, true);
  const role = String(cur.data?.values[FIELDS.sourceRole] ?? "");
  const company = String(cur.data?.values[FIELDS.sourceCompany] ?? "");
  return (
    <section className="card flush arch-panel" aria-labelledby="arch-title" data-testid="archived-panel">
      <div className="table-top">
        <div>
          <SizedHeading className="card-title" id="arch-title" sizeKey="heading:archive" label="Full Discussion / KIQ Archive heading">
            {name}
          </SizedHeading>
          <span className="card-sub">{role || company ? `${[role, company].filter(Boolean).join(" · ")} · ` : ""}{q.data
            ? mode === "kiq"
              ? `${rows.length} earlier ${rows.length === 1 ? "answer" : "answers"} from the same source to the same Insight Topic and KIQ`
              : `${rows.length} other ${rows.length === 1 ? "answer" : "answers"} in the same conversation (same Event Date)`
            : "Loading…"}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={`Close ${name}`} title="Close">
          ✕
        </button>
      </div>
      <div ref={fitRef} className="table-wrap fit arch-wrap" tabIndex={0} role="region" aria-label={`${name} (scrollable)`}>
        <table className="data ptr" style={{ minWidth: 1300 }}>
          <caption className="sr-only">{name}: {mode === "kiq" ? "earlier entries from the same source with the same Insight Topic and KIQ" : "the other entries of the same conversation"}</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col">
                  <span>{c.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`arch-row${current === r.id ? " open" : ""}`} onClick={() => onOpen(r.id)}>
                {cols.map((c, i) =>
                  i === 0 ? (
                    <td key={c.key} className="title">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(r.id);
                        }}
                        aria-label={`Open archived response: ${String(r.values[CORE.title] ?? r.code)}`}
                      >
                        {displayValue(c, r.values[c.key]) || "—"}
                      </button>
                    </td>
                  ) : (
                    <Cell key={c.key} col={c} s={r} impactCol={impactCol} growthCol={growthCol} actionCol={actionCol} />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.data && !rows.length && <div className="empty">{mode === "kiq" ? "No earlier answers to this KIQ from this source." : "No other answers in this conversation."}</div>}
      {children}
    </section>
  );
}

/**
 * A Primary answer at a glance (requests 38 and 39): the Primary Tracker's
 * columns, in order, and nothing else. Source Company, Source Role and Event
 * Date small at the top; Insight Topic, Key Intelligence Question, Key
 * Details and Key Metrics filling the rest. As a pane it lies over its table
 * (the signal on the left, an archived response on the right, side by side
 * to compare) and leaves the rest of the page usable; otherwise it is a
 * centred dialog.
 */
function AnswerCard({
  id,
  schema,
  kind,
  mode,
  onClose,
  onOpenRecord,
  nav,
}: {
  id: string;
  schema: TrackerSchema;
  kind: "primary" | "archived";
  mode: "pane" | "modal";
  onClose: () => void;
  onOpenRecord?: () => void;
  nav?: { index: number; total: number; onStep: (d: number) => void };
}) {
  const q = useSignal(id);
  const trap = useFocusTrap(mode === "modal", onClose);
  const pane = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mode === "pane") pane.current?.focus();
  }, [mode, id]);
  const v = q.data?.values ?? {};
  const cols = primaryTrackerColumns(schema);
  const text = (c: TrackerColumn) => displayValue(c, v[c.key]);
  const company = getColumn(schema, FIELDS.sourceCompany);
  const date = getColumn(schema, CORE.date);
  const name = q.data ? [company && text(company), date && text(date)].filter(Boolean).join(" · ") || q.data.code : "Loading…";
  const label = kind === "primary" ? "Primary signal" : "Archived response";
  const body = (
    <>
      <div className="arch-pop-head">
        <div className="arch-pop-top">
          <span className={`arch-pop-kind ${kind}`}>{label}</span>
          {nav && (
            <span className="arch-pop-nav">
              <button className="icon-btn sm" onClick={() => nav.onStep(-1)} disabled={nav.index === 0} aria-label="Newer archived response" title="Newer">
                ‹
              </button>
              <span>
                {nav.index + 1} of {nav.total}
              </span>
              <button className="icon-btn sm" onClick={() => nav.onStep(1)} disabled={nav.index >= nav.total - 1} aria-label="Older archived response" title="Older">
                ›
              </button>
            </span>
          )}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={`Close the ${label.toLowerCase()}`} data-autofocus>
          ✕
        </button>
      </div>
      <dl className="arch-pop-meta">
        {cols.slice(0, 3).map((c) => (
          <div key={c.key}>
            <dt>{c.label}</dt>
            <dd>{text(c) || "—"}</dd>
          </div>
        ))}
      </dl>
      <div className="arch-pop-body" tabIndex={0} role="region" aria-label={`${label}: details`}>
        {cols.slice(3).map((c) => (
          <section key={c.key}>
            <SizedHeading as="h3" sizeKey={`label:${c.key}`} label={`${c.label} headings`} rowClassName="arch-pop-h">
              {c.label}
            </SizedHeading>
            {/* Long text keeps its formatting (request 46). */}
            {c.type === "long" && v[c.key] ? <RichText text={String(v[c.key])} /> : <p>{text(c) || "—"}</p>}
          </section>
        ))}
      </div>
      {onOpenRecord && (
        <div className="arch-pop-foot">
          <button className="link-btn" onClick={onOpenRecord}>
            Open the full record →
          </button>
        </div>
      )}
    </>
  );
  if (mode === "pane")
    return (
      <section
        className={`arch-pane ${kind}`}
        role="dialog"
        aria-modal="false"
        aria-label={`${label}: ${name}`}
        tabIndex={-1}
        ref={pane}
        data-testid={kind === "primary" ? "answer-primary" : "answer-archived"}
      >
        {body}
      </section>
    );
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="modal arch-popup" role="dialog" aria-modal="true" aria-label={`${label}: ${name}`} ref={trap} data-testid="answer-primary">
        {body}
      </div>
    </>
  );
}
