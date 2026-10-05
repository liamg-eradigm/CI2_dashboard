import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import {
  CORE,
  IMPORT_CHUNK_ROWS,
  MAX_SUMMARY_LENGTH,
  TREND_ANALYSIS_COLUMNS,
  TREND_LEVEL_LABEL,
  isPlaceholderCompetitor,
  parseSpreadsheet,
  toXlsxSheets,
  type Grid,
  type TrendAnalysis,
  type TrendAnalysisCategory,
  type TrendLevel,
} from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useCompetitors, useInvalidate, useMegatrends, useSchema } from "../api/hooks";
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

/** The sheet's rows keyed by the four column names, and any header problems. */
function prepare(grid: Grid): {
  rows: { row: number; values: Record<string, string> }[];
  problems: string[];
} {
  const header = (grid[0] ?? []).map((h) => h.trim());
  const labels = new Map(COLUMNS.map((c) => [norm(c), c]));
  const problems: string[] = [];
  if (!header.some(Boolean)) problems.push("The first row must hold the column names.");
  const unknown = header.filter((h) => h && !labels.has(norm(h)));
  if (unknown.length) problems.push(`Unknown column${unknown.length === 1 ? "" : "s"}: ${unknown.map((u) => `“${u}”`).join(", ")}. The columns are ${COLUMNS.map((c) => `“${c}”`).join(", ")}.`);
  const missing = COLUMNS.filter((c) => !header.some((h) => norm(h) === norm(c)));
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
 * Input → Input Trend Analysis (request 29): write the analysis of a
 * Macrotrend, Subtrend or competitor, or import several from a spreadsheet.
 * Each becomes the analysis shown on the Trend analysis subtab and in the
 * knowledge graph, and is kept in Trackers → Trend Analyses as a Markdown file.
 */
export function TrendAnalysisInput() {
  const mq = useMegatrends("all", null, null);
  const cq = useCompetitors();
  const sp = useSchema("primary");
  const ss = useSchema("secondary");
  const inv = useInvalidate();
  const [category, setCategory] = useState<TrendAnalysisCategory>("macrotrend");
  const [macro, setMacro] = useState("");
  const [scope, setScope] = useState<"macro" | "sub">("macro");
  const [sub, setSub] = useState("");
  const [comp, setComp] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<TrendAnalysis | null>(null);

  const macros = mq.data?.macrotrends ?? [];
  const subs = macros.find((m) => m.name === macro)?.subtrends ?? [];
  const comps = useMemo(() => {
    const names = new Set<string>();
    for (const c of cq.data?.competitors ?? []) names.add(c.name);
    for (const s of [sp.data, ss.data]) for (const o of s?.columns.find((c) => c.key === CORE.competitors)?.options ?? []) if (!isPlaceholderCompetitor(o)) names.add(o);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [cq.data, sp.data, ss.data]);

  const target: { level: TrendLevel; name: string; parent?: string } | null =
    category === "competitor"
      ? comp
        ? { level: "competitor", name: comp }
        : null
      : !macro
        ? null
        : scope === "macro"
          ? { level: "macro", name: macro }
          : sub
            ? { level: "sub", name: sub, parent: macro }
            : null;
  const current =
    target?.level === "competitor"
      ? cq.data?.competitors.find((c) => c.name === target.name)?.summary
      : target?.level === "macro"
        ? macros.find((m) => m.name === target.name)?.summary
        : target
          ? subs.find((s) => s.name === target.name)?.summary
          : null;

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
      await inv("megatrends", "competitors", "trend-analyses");
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const analysisLink = (a: { level: TrendLevel; name: string; parent: string | null }) =>
    a.level === "competitor"
      ? `/competitors/analysis?${new URLSearchParams({ c: a.name })}`
      : `/megatrends/analysis?${new URLSearchParams(a.level === "sub" ? { m: a.parent ?? "", s: a.name } : { m: a.name })}`;

  return (
    <section className="card source-card ta-input" aria-labelledby="tai-title" data-testid="trend-analysis-input">
      <div className="card-head" style={{ alignItems: "center" }}>
        <div>
          <h2 className="card-title" id="tai-title">
            Input Trend Analysis
          </h2>
          <span className="card-sub">Becomes the analysis shown on the Trend analysis subtab and in the knowledge graph, and is kept in Trackers → Trend Analyses as a Markdown file</span>
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

      <div className="tai-pick">
        {category === "macrotrend" ? (
          <>
            <label className="field">
              <span>Macrotrend</span>
              <select
                className="control"
                value={macro}
                onChange={(e) => {
                  setMacro(e.target.value);
                  setSub("");
                }}
                data-testid="tai-macro"
              >
                <option value="">Choose a Macrotrend…</option>
                {macros.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="tai-scope" disabled={!macro}>
              <legend>The analysis is for</legend>
              <label>
                <input type="radio" name="tai-scope" checked={scope === "macro"} onChange={() => setScope("macro")} /> The Macrotrend itself
              </label>
              <label>
                <input type="radio" name="tai-scope" checked={scope === "sub"} onChange={() => setScope("sub")} /> A Subtrend within it
              </label>
            </fieldset>
            {scope === "sub" && (
              <label className="field">
                <span>Subtrend</span>
                <select className="control" value={sub} onChange={(e) => setSub(e.target.value)} disabled={!macro} data-testid="tai-sub">
                  <option value="">{macro ? "Choose a Subtrend…" : "Choose a Macrotrend first"}</option>
                  {subs.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <label className="field">
            <span>Competitor</span>
            <Combobox options={comps} value={comp} onChange={setComp} placeholder="Find a competitor…" label="Competitor" testId="tai-competitor" />
          </label>
        )}
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
          placeholder={target ? `Write the analysis of ${target.name}…` : "Choose what the analysis is for, then write it here…"}
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
            <Link to={analysisLink(saved)}>Open its trend analysis →</Link> · <Link to="/trend-analyses">Trend Analyses →</Link>
          </span>
        </div>
      )}

      <TrendAnalysisImport onDone={() => void inv("megatrends", "competitors", "trend-analyses")} />
    </section>
  );
}

/** Several trend analyses from a spreadsheet: checked in full first, then saved in small batches. */
function TrendAnalysisImport({ onDone }: { onDone: () => void }) {
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
  const prepared = useMemo(() => (grid ? prepare(grid) : null), [grid]);
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
        const r = await api<ImportResult>("/api/trend-analyses/import", {
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
      setStatus("Saving the trend analyses…");
      let n = 0;
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK_ROWS) {
        const r = await api<ImportResult>("/api/trend-analyses/import", {
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
    const bytes = toXlsxSheets([
      {
        name: "Trend analyses",
        table: [COLUMNS, ["Macrotrend", "Subtrend", "Agentic AI Platforms", "Write the analysis here."], ["Competitor", "Competitor", "Roche", "Write the analysis here."]],
      },
    ]);
    const url = URL.createObjectURL(
      new Blob([bytes as unknown as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "eradigm-trend-analyses-template.xlsx";
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
      <h3 className="tai-sub-title">Import trend analyses from a spreadsheet</h3>
      <p className="import-help">
        The first row must hold the columns{" "}
        {COLUMNS.map((c, i) => (
          <span key={c}>
            {i ? (i === COLUMNS.length - 1 ? " and " : ", ") : ""}
            <b>{c}</b>
          </span>
        ))}
        . The first three say which trend each row updates (e.g. Macrotrend · Subtrend · Agentic AI Platforms, or Competitor · Competitor · Roche); the last is the analysis. A later row for the same
        trend replaces an earlier one.
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
            ✓ Imported {done} trend analys{done === 1 ? "is" : "es"}
          </b>
          <span>
            Each is now the analysis of its trend. <Link to="/trend-analyses">Open Trend Analyses →</Link>
          </span>
        </div>
      )}
    </div>
  );
}
