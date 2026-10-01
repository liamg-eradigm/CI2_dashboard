import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CORE, FIELDS, STREAM_LABEL, TABLE_ALL_MAX, can, displayValue, getColumn, phantomColumns, trackerColumns, type Me, type Signal, type TrackerColumn } from "@eradigm/shared";
import { request } from "../api/client";
import { exportUrl, useNewsletters, useSchema, useSettings, useTracker, type TableView } from "../api/hooks";
import { FilterHeader } from "../components/FilterHeader";
import { MarkdownPanel } from "../components/MarkdownPanel";
import { DeleteEntries } from "../components/DeleteEntries";
import { DatesHint } from "../components/DatesHint";
import { RecordDrawer } from "../components/RecordDrawer";
import { DocxButton, DocxPane, NewsletterCreate, canCreateNewsletter } from "../components/Deliverables";
import { SourceDrawer } from "../components/SnapshotFrame";
import { SavedPagesButton, useAttachPage } from "../components/SavedPages";
import { StreamSwitch } from "../components/StreamSwitch";
import { useStreamParam } from "../state/stream";
import { GROWTH_GLYPH, IMPACT_CLASS, IMPACT_GLYPH, impactBucket } from "../lib/format";
import { useFilters } from "../state/filters";
import { useToast } from "../state/toast";

const PAGE = 10;

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
function SourceCell({ s, canAttach, onOpen }: { s: Signal; canAttach: boolean; onOpen: (pageId: string | null) => void }) {
  const title = String(s.values[CORE.title] ?? s.code);
  const attach = useAttachPage(s);
  if (s.hasSnapshot) {
    return (
      <td className="src-col">
        <SavedPagesButton entry={{ id: s.id, code: s.code, title }} pages={s.pages} canAttach={canAttach} onOpen={onOpen} />
      </td>
    );
  }
  if (!canAttach) {
    return (
      <td className="src-col">
        <span className="src-none" title="No saved page for this entry" aria-label="No saved page">
          —
        </span>
      </td>
    );
  }
  return (
    <td className="src-col">
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

const NOUN: Record<TableView, string> = { tracker: "Tracker", phantoms: "Phantoms", alerts: "Phantoms", newsletter: "Phantoms" };

/**
 * The Tracker and Phantoms tabs, and the two Deliverables tables (Alerts and
 * Newsletter, built from Phantoms): the same filterable table, per stream.
 * Phantoms-based tables add the Markdown; Alerts add the .docx alert; the
 * Newsletter table's tick boxes build a newsletter.
 */
export function TrackerPage({ me, view = "tracker", title, above }: { me: Me; view?: TableView; title?: string; above?: ReactNode }) {
  // Phantoms and the Deliverables tables share the Phantoms columns, Markdown and rules.
  const phantoms = view !== "tracker";
  const newsletter = view === "newsletter";
  const [stream, setStream] = useStreamParam();
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
  const tracker = useTracker(f.filters, { key: sortKey, dir }, page, size, stream, view, !!schema.data && f.ready);
  const [exportOpen, setExportOpen] = useState(false);
  const [scope, setScope] = useState<"filtered" | "all">("filtered");
  const exportRef = useRef<HTMLDivElement>(null);
  const selected = f.params.get("signal");
  const mdOpen = f.params.get("md");
  const savedOpen = f.params.get("saved");
  const docxOpen = f.params.get("docx");
  const newsletters = useNewsletters(newsletter);
  // Ticked rows: for deletion (Tracker/Phantoms, cleared when the page of rows
  // changes) or, on the Newsletter table, the entries of the next newsletter
  // (kept across pages and both streams).
  const [picked, setPicked] = useState<Map<string, Signal>>(() => new Map());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creating, setCreating] = useState(false);
  const rowKey = tracker.data?.rows.map((r) => r.id).join(",") ?? "";
  useEffect(() => {
    if (!newsletter) setPicked(new Map());
  }, [rowKey, stream, view, newsletter]);

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
  const missingAlerts = view === "alerts" && !!tracker.data?.rows.some((r) => !r.alertId);
  useEffect(() => {
    if (!missingAlerts) return;
    const id = setTimeout(() => void tracker.refetch(), 1200);
    return () => clearTimeout(id);
  }, [missingAlerts, tracker, tracker.data]);

  if (!schema.data) return <div className="content"><div className="skeleton" style={{ height: 200 }} /></div>;
  const s = schema.data;
  // Each table has its own columns, chosen from the Inbox columns (Inbox → Edit columns).
  const cols = phantoms ? phantomColumns(s) : trackerColumns(s);
  const canAttach = can(me.role, "item:edit");
  const canDelete = can(me.role, "item:delete");
  const tickable = newsletter ? canCreateNewsletter(me) : (view === "tracker" || view === "phantoms") && canDelete;
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
  const docxNewsletter = docxOpen ? newsletters.data?.find((n) => n.id === docxOpen) : undefined;
  const titleOf = (r: Signal) => String(r.values[CORE.title] ?? r.code);
  const info = t
    ? !t.total
      ? "0 results"
      : showAll
        ? t.total > size
          ? `Showing the first ${size} of ${t.total}`
          : `Showing all ${t.total}`
        : `Showing ${page * PAGE + 1}–${Math.min(t.total, page * PAGE + PAGE)} of ${t.total} · page ${page + 1} of ${pages}`
    : "Loading…";


  const doExport = async (format: string) => {
    setExportOpen(false);
    try {
      const res = await request(exportUrl(f.filters, { key: sortKey, dir }, scope, format, stream, view));
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
      <FilterHeader title={title ?? (phantoms ? "Phantoms" : "Tracker")} schema={s} f={f} viewKind="tracker" />
      <div className="content">
        {above}
        <div className="stream-bar">
          <StreamSwitch noun={NOUN[view]} value={stream} onChange={setStream} label={`${NOUN[view]} to show`} />
          <span className="stream-note">
            {view === "alerts"
              ? `${STREAM_LABEL[stream]} Phantoms with High Impact · each gets a .docx alert automatically`
              : newsletter
                ? `${STREAM_LABEL[stream]} Phantoms with High or Medium Impact · tick entries from either stream, then Create Newsletter`
                : phantoms
                  ? stream === "primary"
                    ? "Every Primary Tracker entry · open the Markdown from the MD icon"
                    : `Secondary Tracker entries with Impact ${settings.data?.phantoms.secondaryMinImpact ?? "Low"} or higher (set by admins) · open the Markdown from the MD icon`
                  : `Approved entries from the ${STREAM_LABEL[stream]} Inbox`}
          </span>
        </div>
        <section className="card flush pop-host" aria-label="Approved signals table">
          <div className="table-top">
            <span className="info" aria-live="polite">
              {info}
              <DatesHint info={t?.outsideDates} f={f} />
            </span>
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
                  <button className="btn danger small" onClick={() => setConfirmDelete(true)}>
                    Delete selected
                  </button>
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
                      Includes the {cols.length} {STREAM_LABEL[stream]} {phantoms ? "Phantoms" : "Tracker"} columns plus signal ID, in the current sort order.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className={showAll ? "table-wrap all" : "table-wrap"} tabIndex={showAll ? 0 : undefined} role={showAll ? "region" : undefined} aria-label={showAll ? "All entries (scrollable)" : undefined}>
            <table className="data" style={{ minWidth: Math.max(1100, cols.length * 125 + (phantoms ? 150 : 0) + (view === "alerts" ? 70 : 0)) }}>
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
                  <th scope="col" className="src-col">
                    <span>Source</span>
                  </th>
                  {canAttach && (
                    <th scope="col" className="src-col">
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
                  <tr key={r.id} className={picked.has(r.id) ? "picked" : undefined}>
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
                    <SourceCell s={r} canAttach={canAttach} onOpen={(pageId) => setParam({ saved: r.id, savedPage: pageId }, true)} />
                    {canAttach && (
                      <td className="src-col">
                        <button className="src-btn open edit-btn" onClick={() => setParam({ signal: r.id, edit: "1" }, true)} aria-label={`Edit ${titleOf(r)}`} title="Edit, then approve again">
                          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
                            <path d="M13.6 3.2l3.2 3.2-9.4 9.4-3.9.7.7-3.9 9.4-9.4Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                            <path d="M11.8 5l3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        </button>
                      </td>
                    )}
                    {cols.map((c) =>
                      c.key === CORE.title ? (
                        <td key={c.key} className="title">
                          <button
                            onClick={(e) => (e.stopPropagation(), setParam(phantoms ? { md: r.id } : { signal: r.id }, true))}
                            aria-label={`${phantoms ? "View Markdown" : "Open record"}: ${String(r.values[c.key] ?? "")}`}
                          >
                            {String(r.values[c.key] ?? "")}
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
        </section>
      </div>
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
      {confirmDelete && pickedRows.length > 0 && (view === "tracker" || view === "phantoms") && (
        <DeleteEntries
          modal
          table={view}
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
          onEdit={canAttach ? (id) => setParam({ md: null, signal: id, edit: "1" }, true) : undefined}
        />
      )}
      {selected && (
        <RecordDrawer
          key={`${selected}-${f.params.get("edit") ?? ""}`}
          id={selected}
          schema={s}
          me={me}
          table={view === "tracker" || view === "phantoms" ? view : undefined}
          startEditing={canAttach && f.params.get("edit") === "1"}
          onClose={() => setParam({ signal: null, edit: null })}
          onOpen={(id) => setParam({ signal: id, edit: null }, true)}
        />
      )}
    </>
  );
}
