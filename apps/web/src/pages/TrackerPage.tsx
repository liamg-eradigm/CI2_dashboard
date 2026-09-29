import { useCallback, useEffect, useRef, useState } from "react";
import { CORE, STREAM_LABEL, displayValue, getColumn, trackerColumns, type Me, type Signal, type TrackerColumn } from "@eradigm/shared";
import { request } from "../api/client";
import { exportUrl, useSchema, useSettings, useTracker, type TableView } from "../api/hooks";
import { FilterHeader } from "../components/FilterHeader";
import { MarkdownPanel, downloadMarkdown } from "../components/MarkdownPanel";
import { RecordDrawer } from "../components/RecordDrawer";
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

/** The Tracker and the Phantoms tabs: the same filterable table, per stream. Phantoms adds the Markdown. */
export function TrackerPage({ me, view = "tracker" }: { me: Me; view?: TableView }) {
  const phantoms = view === "phantoms";
  const [stream, setStream] = useStreamParam();
  const schema = useSchema(stream);
  const settings = useSettings();
  const f = useFilters(schema.data, settings.data?.timezone ?? me.timezone);
  const toast = useToast();
  const sortKey = f.params.get("sort") ?? "date";
  const dir = (f.params.get("dir") as "asc" | "desc") ?? "desc";
  const page = Math.max(0, Number(f.params.get("page") ?? 0) || 0);
  const tracker = useTracker(f.filters, { key: sortKey, dir }, page, PAGE, stream, view, !!schema.data);
  const [exportOpen, setExportOpen] = useState(false);
  const [scope, setScope] = useState<"filtered" | "all">("filtered");
  const exportRef = useRef<HTMLDivElement>(null);
  const selected = f.params.get("signal");
  const mdOpen = f.params.get("md");

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

  if (!schema.data) return <div className="content"><div className="skeleton" style={{ height: 200 }} /></div>;
  const s = schema.data;
  const cols = trackerColumns(s);
  const impactCol = getColumn(s, CORE.impact);
  const growthCol = getColumn(s, CORE.growth);
  const actionCol = getColumn(s, "action");
  const t = tracker.data;
  const pages = t ? Math.max(1, Math.ceil(t.total / PAGE)) : 1;
  const info = t ? (t.total ? `Showing ${page * PAGE + 1}–${Math.min(t.total, page * PAGE + PAGE)} of ${t.total} · page ${page + 1} of ${pages}` : "0 results") : "Loading…";

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
      <FilterHeader title={phantoms ? "Phantoms" : "Tracker"} schema={s} f={f} viewKind="tracker" />
      <div className="content">
        <div className="stream-bar">
          <StreamSwitch noun={phantoms ? "Phantoms" : "Tracker"} value={stream} onChange={setStream} label={`${phantoms ? "Phantoms" : "Tracker"} to show`} />
          <span className="stream-note">
            {phantoms
              ? stream === "primary"
                ? "Every Primary Tracker entry · open a row to view its Markdown"
                : `Secondary Tracker entries with Impact ${settings.data?.phantoms.secondaryMinImpact ?? "Medium"} or higher (set by admins) · open a row to view its Markdown`
              : `Approved entries from the ${STREAM_LABEL[stream]} Inbox`}
          </span>
        </div>
        <section className="card flush" aria-label="Approved signals table">
          <div className="table-top">
            <span className="info" aria-live="polite">
              {info}
            </span>
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
          <div className="table-wrap">
            <table className="data" style={{ minWidth: Math.max(1100, cols.length * 125 + (phantoms ? 150 : 0)) }}>
              <caption className="sr-only">Approved signals, sorted by {getColumn(s, sortKey)?.label ?? "Date"} {dir === "asc" ? "ascending" : "descending"}</caption>
              <thead>
                <tr>
                  {phantoms && (
                    <th scope="col" className="md-col">
                      <span>Markdown</span>
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
                  <tr key={r.id} className="clickable" onClick={() => setParam(phantoms ? { md: r.id } : { signal: r.id }, true)}>
                    {phantoms && (
                      <td className="md-col">
                        <button
                          className="btn secondary small md-dl"
                          onClick={(e) => {
                            e.stopPropagation();
                            void downloadMarkdown(r.id).then(
                              (name) => toast(`Downloaded ${name}`),
                              (err: Error) => toast(`Download failed · ${err.message}`, false),
                            );
                          }}
                          aria-label={`Download Markdown for ${String(r.values[CORE.title] ?? r.code)}`}
                        >
                          <span aria-hidden="true">⤓</span> Download Markdown
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
            <button className="btn pager" disabled={page <= 0} onClick={() => setParam({ page: String(page - 1) })}>
              ← Previous
            </button>
            <button className="btn pager" disabled={page >= pages - 1} onClick={() => setParam({ page: String(page + 1) })}>
              Next →
            </button>
          </div>
        </section>
      </div>
      {mdOpen && !selected && (
        <MarkdownPanel id={mdOpen} onClose={() => setParam({ md: null })} onOpenRecord={(id) => setParam({ md: null, signal: id }, true)} />
      )}
      {selected && <RecordDrawer id={selected} schema={s} me={me} onClose={() => setParam({ signal: null })} onOpen={(id) => setParam({ signal: id }, true)} />}
    </>
  );
}
