import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import {
  CORE,
  IMPORT_CHUNK_ROWS,
  MAX_SUMMARY_LENGTH,
  MACRO_SECTIONS,
  MACRO_SECTIONS_COLUMNS,
  MACRO_SECTIONS_MACRO_COLUMN,
  TREND_ANALYSIS_COLUMNS,
  TREND_LEVEL_LABEL,
  isPlaceholderCompetitor,
  parseSpreadsheet,
  toXlsxSheets,
  type Grid,
  type MacroSectionKey,
  type TrendAnalysis,
  type TrendAnalysisCategory,
  type TrendLevel,
} from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useCompetitors, useInvalidate, useMacroSections, useMegatrends, useSchema } from "../api/hooks";
import { Combobox } from "./Combobox";

interface RowError {
  row: number;
  column: string | null;
  message: string;
}
type ImportResult = { ok: boolean; imported: number; errors: RowError[] };

const COLUMNS = Object.values(TREND_ANALYSIS_COLUMNS);
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
const DRY_RUN_ROWS = 200;

/** The two spreadsheet layouts: one analysis per row (competitors, Subtrends), or a Macrotrend's sections (request 34). */
interface ImportKind {
  columns: readonly string[];
  /** Columns that must be there (the others may be left out). */
  required: readonly string[];
  endpoint: string;
  title: string;
  noun: [string, string];
  template: string[][];
  templateName: string;
}
const TREND_IMPORT: ImportKind = {
  columns: COLUMNS,
  required: COLUMNS,
  endpoint: "/api/trend-analyses/import",
  title: "Import trend analyses from a spreadsheet",
  noun: ["trend analysis", "trend analyses"],
  template: [COLUMNS, ["Competitor", "Competitor", "Roche", "Write the analysis here."], ["Macrotrend", "Subtrend", "Agentic AI Platforms", "Write the analysis here."]],
  templateName: "eradigm-trend-analyses-template.xlsx",
};
const SECTIONS_IMPORT: ImportKind = {
  columns: MACRO_SECTIONS_COLUMNS,
  required: [MACRO_SECTIONS_MACRO_COLUMN],
  endpoint: "/api/trend-analyses/macrotrend/import",
  title: "Import Macrotrend analyses from a spreadsheet",
  noun: ["Macrotrend analysis", "Macrotrend analyses"],
  template: [MACRO_SECTIONS_COLUMNS, ["AI Investment in R&D", ...MACRO_SECTIONS.map((x, i) => (i < 2 ? `Write the ${x.label.toLowerCase().replace(/\?$/, "")} here.` : ""))]],
  templateName: "eradigm-macrotrend-analyses-template.xlsx",
};

/** The sheet's rows keyed by the column names, and any header problems. */
function prepare(
  grid: Grid,
  kind: ImportKind,
): {
  rows: { row: number; values: Record<string, string> }[];
  problems: string[];
} {
  const COLUMNS = kind.columns;
  const header = (grid[0] ?? []).map((h) => h.trim());
  const labels = new Map(COLUMNS.map((c) => [norm(c), c]));
  const problems: string[] = [];
  if (!header.some(Boolean)) problems.push("The first row must hold the column names.");
  const unknown = header.filter((h) => h && !labels.has(norm(h)));
  if (unknown.length) problems.push(`Unknown column${unknown.length === 1 ? "" : "s"}: ${unknown.map((u) => `“${u}”`).join(", ")}. The columns are ${COLUMNS.map((c) => `“${c}”`).join(", ")}.`);
  const missing = kind.required.filter((c) => !header.some((h) => norm(h) === norm(c)));
  if (missing.length && header.some(Boolean)) problems.push(`Missing column${missing.length === 1 ? "" : "s"}: ${missing.map((m) => `“${m}”`).join(", ")}.`);
  const rows: { row: number; values: Record<string, string> }[] = [];
  grid.slice(1).forEach((cells, i) => {
    if (!cells.some((c) => c && c.trim())) return;
    const values: Record<string, string> = {};
    header.forEach((h, j) => {
      const label = labels.get(norm(h));
      if (label) values[label] = (cells[j] ?? "").trim();
    });
    rows.push({ row: i + 2, values });
  });
  if (!rows.length && header.some(Boolean)) problems.push("No rows to import below the column names.");
  return { rows, problems };
}

/**
 * Input → Input Trend Analysis (request 29; Macrotrend sections in request 34):
 * a competitor's analysis, or a Macrotrend's analysis section by section (only
 * the sections filled in change), one at a time or from a spreadsheet. Each
 * submission is kept in Databases → CI analyses as a Markdown file.
 */
export function TrendAnalysisInput() {
  const mq = useMegatrends("all", null, null);
  const cq = useCompetitors();
  const sp = useSchema("primary");
  const ss = useSchema("secondary");
  const inv = useInvalidate();
  const [category, setCategory] = useState<TrendAnalysisCategory>("macrotrend");
  const [comp, setComp] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<TrendAnalysis | null>(null);

  const macros = mq.data?.macrotrends ?? [];
  const comps = useMemo(() => {
    const names = new Set<string>();
    for (const c of cq.data?.competitors ?? []) names.add(c.name);
    for (const s of [sp.data, ss.data]) for (const o of s?.columns.find((c) => c.key === CORE.competitors)?.options ?? []) if (!isPlaceholderCompetitor(o)) names.add(o);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [cq.data, sp.data, ss.data]);

  const target: { level: TrendLevel; name: string } | null = category === "competitor" && comp ? { level: "competitor", name: comp } : null;
  const current = target ? cq.data?.competitors.find((c) => c.name === target.name)?.summary : null;

  const submit = async () => {
    if (!target || !text.trim()) return;
    setSaving(true);
    setErr(null);
    setSaved(null);
    try {
      const a = await api<TrendAnalysis>("/api/trend-analyses", {
        method: "POST",
        json: { ...target, text },
      });
      setSaved(a);
      setText("");
      await inv("competitors", "trend-analyses");
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const analysisLink = (a: { level: TrendLevel; name: string; parent: string | null }) =>
    a.level === "competitor"
      ? `/analytics/competitors?${new URLSearchParams({ c: a.name })}`
      : `/analytics/megatrends?${new URLSearchParams(a.level === "sub" ? { m: a.parent ?? "", s: a.name } : { m: a.name })}`;

  return (
    <section className="card source-card ta-input" aria-labelledby="tai-title" data-testid="trend-analysis-input">
      <div className="card-head" style={{ alignItems: "center" }}>
        <div>
          <h2 className="card-title" id="tai-title">
            Input Trend Analysis
          </h2>
          <span className="card-sub">
            {category === "macrotrend"
              ? "Fills the text of the Macrotrend's dashboard (Analytics → Megatrends Dashboard → Megatrends), section by section; kept in Databases → CI analyses as a Markdown file"
              : "Becomes the competitor's analysis on its Trends Analysis page, and is kept in Databases → CI analyses as a Markdown file"}
          </span>
        </div>
        <div className="seg" role="group" aria-label="Trend analysis of a">
          {(["competitor", "macrotrend"] as const).map((k) => (
            <button
              key={k}
              aria-pressed={category === k}
              data-testid={`tai-${k}`}
              onClick={() => {
                setCategory(k);
                setErr(null);
                setSaved(null);
              }}
            >
              {k === "competitor" ? "Competitor" : "Macrotrend"}
            </button>
          ))}
        </div>
      </div>

      {category === "macrotrend" ? (
        <MacroSectionsForm macros={macros.map((m) => m.name)} onSaved={() => void inv("macro-sections", "trend-analyses")} />
      ) : (
        <>
          <div className="tai-pick">
            <label className="field">
              <span>Competitor</span>
              <Combobox options={comps} value={comp} onChange={setComp} placeholder="Find a competitor…" label="Competitor" testId="tai-competitor" />
            </label>
          </div>

          {current && current.source !== "default" && current.text && (
            <details className="tai-current">
              <summary>Current analysis of {target?.name}</summary>
              <p>{current.text}</p>
            </details>
          )}

          <label className="field">
            <span>
              Trend analysis
              {target ? ` · ${TREND_LEVEL_LABEL[target.level]} ${target.name}` : ""}
            </span>
            <textarea
              className="control tai-text"
              value={text}
              maxLength={MAX_SUMMARY_LENGTH}
              rows={8}
              onChange={(e) => setText(e.target.value)}
              placeholder={target ? `Write the analysis of ${target.name}…` : "Choose the competitor, then write its analysis here…"}
              aria-describedby="tai-count"
              data-testid="tai-text"
            />
          </label>
          <div className="tai-foot">
            <span id="tai-count" className="card-sub">
              {text.length.toLocaleString("en-GB")} / {MAX_SUMMARY_LENGTH.toLocaleString("en-GB")} characters
            </span>
            <button className="btn" onClick={() => void submit()} disabled={!target || !text.trim() || saving} data-testid="tai-submit">
              {saving ? "Submitting…" : "Submit trend analysis"}
            </button>
          </div>
          {err && (
            <div className="err-msg" role="alert">
              <b>✕</b> {err}
            </div>
          )}
          {saved && (
            <div className="import-done" role="status" data-testid="tai-saved">
              <b>
                ✓ Saved as the analysis of the {TREND_LEVEL_LABEL[saved.level]} {saved.name}
              </b>
              <span>
                <Link to={analysisLink(saved)}>Open its trend analysis →</Link> · <Link to="/trend-analyses">CI analyses →</Link>
              </span>
            </div>
          )}
        </>
      )}

      <TrendAnalysisImport key={category} kind={category === "macrotrend" ? SECTIONS_IMPORT : TREND_IMPORT} onDone={() => void inv("macro-sections", "megatrends", "competitors", "trend-analyses")} />
    </section>
  );
}

/** Several trend analyses from a spreadsheet: checked in full first, then saved in small batches. */
function TrendAnalysisImport({ onDone, kind = TREND_IMPORT }: { onDone: () => void; kind?: ImportKind }) {
  const [file, setFile] = useState<File | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const prepared = useMemo(() => (grid ? prepare(grid, kind) : null), [grid, kind]);
  const rows = prepared?.rows ?? null;
  const headerErrors = readError ? [readError] : (prepared?.problems ?? []);

  const read = async (f: File | null) => {
    setGrid(null);
    setReadError(null);
    setErrors([]);
    setStatus(null);
    setDone(null);
    setProgress(null);
    setFile(f);
    if (!f) return;
    if (!/\.(xlsx|csv|tsv)$/i.test(f.name)) return setReadError("Choose an .xlsx, .csv or .tsv file.");
    try {
      setGrid(await parseSpreadsheet(new Uint8Array(await f.arrayBuffer()), f.name));
    } catch (e) {
      setReadError(`Could not read the file · ${(e as Error).message}`);
    }
  };

  const run = async () => {
    if (!rows?.length || !file) return;
    setErrors([]);
    setDone(null);
    try {
      setStatus("Checking every row…");
      const found: RowError[] = [];
      for (let i = 0; i < rows.length; i += DRY_RUN_ROWS) {
        const r = await api<ImportResult>(kind.endpoint, {
          method: "POST",
          json: {
            fileName: file.name,
            rows: rows.slice(i, i + DRY_RUN_ROWS),
            dryRun: true,
          },
        });
        found.push(...r.errors);
      }
      if (found.length) {
        setErrors(found.sort((a, b) => a.row - b.row));
        setStatus(null);
        return;
      }
      setProgress({ at: 0, of: rows.length });
      setStatus(`Saving the ${kind.noun[1]}…`);
      let n = 0;
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK_ROWS) {
        const r = await api<ImportResult>(kind.endpoint, {
          method: "POST",
          json: {
            fileName: file.name,
            rows: rows.slice(i, i + IMPORT_CHUNK_ROWS),
          },
        });
        if (!r.ok) {
          setErrors(r.errors);
          setStatus(`Stopped after ${n} of ${rows.length} rows (the first ${n} are saved): fix the rows below and import the rest.`);
          onDone();
          return;
        }
        n += r.imported;
        setProgress({
          at: Math.min(rows.length, i + IMPORT_CHUNK_ROWS),
          of: rows.length,
        });
      }
      setDone(n);
      setStatus(null);
      setGrid(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onDone();
    } catch (e) {
      setStatus(`Import failed · ${(e as ApiError).message}`);
    }
  };

  const template = () => {
    const bytes = toXlsxSheets([{ name: "Trend analyses", table: kind.template }]);
    const url = URL.createObjectURL(
      new Blob([bytes as unknown as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = kind.templateName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const failed = !!status && (status.startsWith("Stopped") || status.startsWith("Import failed"));
  const busy = !!status && !failed;
  const ready = !!rows?.length && !headerErrors.length;

  return (
    <div
      className={`tai-import${dragging ? " drag-target" : ""}`}
      data-testid="tai-import"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        void read(e.dataTransfer.files[0] ?? null);
      }}
    >
      <h3 className="tai-sub-title">{kind.title}</h3>
      <p className="import-help">
        The first row must hold the columns{" "}
        {kind.columns.map((c, i) => (
          <span key={c}>
            {i ? (i === kind.columns.length - 1 ? " and " : ", ") : ""}
            <b>{c}</b>
          </span>
        ))}
        .{" "}
        {kind === SECTIONS_IMPORT
          ? "Each row is one Macrotrend: only Macrotrend is required, and an empty cell leaves that section as it is. A later row for the same Macrotrend wins."
          : "The first three say which trend each row updates (e.g. Competitor · Competitor · Roche, or Macrotrend · Subtrend · Agentic AI Platforms); the last is the analysis. A later row for the same trend replaces an earlier one."}
        <button className="link-btn" onClick={template}>
          Download the template (.xlsx)
        </button>
      </p>
      <div className="source-row">
        <div className="drop-wrap">
          <label className={`drop${dragging ? " over" : ""}`} data-testid="drop-zone-trend-import">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,.tsv,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => void read(e.target.files?.[0] ?? null)}
              aria-label="Spreadsheet of trend analyses to import"
            />
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--navy-700)",
              }}
            >
              {dragging ? "Drop the spreadsheet here" : file ? file.name : "Drag and drop a spreadsheet here, or click to choose"}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {rows && !headerErrors.length ? `${rows.length} row${rows.length === 1 ? "" : "s"} ready to check and import` : ".xlsx, .csv or .tsv · first sheet of a workbook"}
            </span>
          </label>
          {file && (
            <button
              type="button"
              className="drop-remove"
              disabled={busy}
              aria-label={`Remove ${file.name}`}
              title="Remove this file"
              onClick={() => {
                void read(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              ✕ Remove
            </button>
          )}
        </div>
        <button className="btn lg" onClick={() => void run()} disabled={!ready || busy} data-testid="tai-import-run">
          {busy ? "Importing…" : "Check and import"}
        </button>
      </div>
      {headerErrors.map((m) => (
        <div className="err-msg" role="alert" key={m}>
          <b>✕</b> {m}
        </div>
      ))}
      {progress && (
        <div className="import-progress" role="status" aria-label={`Imported ${progress.at} of ${progress.of} rows`}>
          <div
            style={{
              width: `${(progress.at / Math.max(1, progress.of)) * 100}%`,
            }}
          />
        </div>
      )}
      {status && (
        <div className={failed ? "err-msg" : "card-sub"} role="status">
          {status}
        </div>
      )}
      {errors.length > 0 && (
        <div className="import-errors" role="alert">
          <b>
            ✕ Nothing was imported: {errors.length} problem
            {errors.length === 1 ? "" : "s"} to fix in {file?.name ?? "the file"}
          </b>
          <div className="table-wrap" style={{ maxHeight: 260 }}>
            <table className="data" style={{ fontSize: 12.5 }}>
              <caption className="sr-only">Import problems</caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Column</th>
                  <th scope="col">Problem</th>
                </tr>
              </thead>
              <tbody>
                {errors.slice(0, 200).map((e, i) => (
                  <tr key={i}>
                    <td className="mono">{e.row || "—"}</td>
                    <td>{e.column ?? "—"}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {done != null && (
        <div className="import-done" role="status" data-testid="tai-import-done">
          <b>
            ✓ Imported {done} {done === 1 ? kind.noun[0] : kind.noun[1]}
          </b>
          <span>
            Each is now the analysis of its trend. <Link to="/trend-analyses">Open Trend Analyses →</Link>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * A Macrotrend's analysis by section (request 34): every box is optional, and
 * only the boxes with text change on its dashboard. Each box shows the text in
 * place now.
 */
function MacroSectionsForm({ macros, onSaved }: { macros: string[]; onSaved: () => void }) {
  const sections = useMacroSections();
  const [macro, setMacro] = useState("");
  const [draft, setDraft] = useState<Partial<Record<MacroSectionKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<TrendAnalysis | null>(null);
  const now = (k: MacroSectionKey) => sections.data?.find((x) => x.macrotrend === macro && x.section === k)?.text ?? "";
  const filled = MACRO_SECTIONS.filter((x) => draft[x.key]?.trim());
  const submit = async () => {
    if (!macro || !filled.length) return;
    setSaving(true);
    setErr(null);
    setSaved(null);
    try {
      const a = await api<TrendAnalysis>("/api/trend-analyses/macrotrend", { method: "POST", json: { macrotrend: macro, sections: draft } });
      setSaved(a);
      setDraft({});
      onSaved();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="tai-sections" data-testid="tai-sections">
      <div className="tai-pick">
        <label className="field">
          <span>Macrotrend</span>
          <select className="control" value={macro} onChange={(e) => setMacro(e.target.value)} data-testid="tai-macro">
            <option value="">Choose a Macrotrend…</option>
            {macros.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="card-sub tai-sections-note">Every box is optional: only the boxes you fill in change, so one section can be updated on its own.</p>
      <div className="tai-sections-grid">
        {MACRO_SECTIONS.map((x) => (
          <label className="field tai-section" key={x.key}>
            <span>{x.label}</span>
            <textarea
              className="control tai-text"
              value={draft[x.key] ?? ""}
              maxLength={MAX_SUMMARY_LENGTH}
              rows={6}
              onChange={(e) => setDraft((d) => ({ ...d, [x.key]: e.target.value }))}
              placeholder={macro ? (now(x.key) ? `Now: ${now(x.key).slice(0, 160)}${now(x.key).length > 160 ? "…" : ""}` : "Empty for now · leave blank to keep it so") : "Choose a Macrotrend first"}
              disabled={!macro}
              data-testid={`tai-section-${x.key}`}
            />
          </label>
        ))}
      </div>
      <div className="tai-foot">
        <span className="card-sub">{filled.length ? `${filled.length} section${filled.length === 1 ? "" : "s"} to update: ${filled.map((x) => x.label).join(", ")}` : "Nothing to update yet"}</span>
        <button className="btn" onClick={() => void submit()} disabled={!macro || !filled.length || saving} data-testid="tai-submit">
          {saving ? "Submitting…" : "Submit Macrotrend analysis"}
        </button>
      </div>
      {err && (
        <div className="err-msg" role="alert">
          <b>✕</b> {err}
        </div>
      )}
      {saved && (
        <div className="import-done" role="status" data-testid="tai-saved">
          <b>
            ✓ Saved {Object.keys(saved.sections ?? {}).length} section{Object.keys(saved.sections ?? {}).length === 1 ? "" : "s"} of the Macrotrend {saved.name}
          </b>
          <span>
            <Link to={`/analytics/megatrends?${new URLSearchParams({ m: saved.name })}`}>Open its dashboard →</Link> · <Link to="/trend-analyses">CI analyses →</Link>
          </span>
        </div>
      )}
    </div>
  );
}
