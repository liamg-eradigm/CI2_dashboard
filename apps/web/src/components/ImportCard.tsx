import { useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { AUTO_KEYS, IMPORT_CHUNK_ROWS, STREAM_LABEL, parseSpreadsheet, sortedColumns, toXlsx, type Stream } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useInvalidate, useSchema } from "../api/hooks";
import { StreamSwitch } from "./StreamSwitch";

interface Row {
  row: number;
  values: Record<string, string>;
}
interface RowError {
  row: number;
  column: string | null;
  message: string;
}
type ImportResult = { ok: boolean; imported: number; errors: RowError[]; codes: string[] };

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const DRY_RUN_ROWS = 200;

/**
 * One-off import of existing entries into the Primary or Secondary Tracker
 * from a spreadsheet (.xlsx, .csv or .tsv). The first row must hold the
 * tracker's column names; each further row becomes a published entry.
 */
export function ImportCard() {
  const [stream, setStream] = useState<Stream>("primary");
  const schema = useSchema(stream);
  const inv = useInvalidate();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [headerErrors, setHeaderErrors] = useState<string[]>([]);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [done, setDone] = useState<{ n: number; first?: string; last?: string } | null>(null);
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const cols = schema.data ? sortedColumns(schema.data).filter((c) => !AUTO_KEYS.includes(c.key)) : [];
  const trackerName = `${STREAM_LABEL[stream]} Tracker`;

  const reset = () => {
    setRows(null);
    setHeaderErrors([]);
    setErrors([]);
    setStatus(null);
    setDone(null);
    setProgress(null);
  };

  const read = async (f: File | null, forStream = stream) => {
    reset();
    setFile(f);
    if (!f) return;
    if (!/\.(xlsx|csv|tsv)$/i.test(f.name)) return setHeaderErrors(["Choose an .xlsx, .csv or .tsv file."]);
    try {
      const grid = await parseSpreadsheet(new Uint8Array(await f.arrayBuffer()), f.name);
      const header = (grid[0] ?? []).map((h) => h.trim());
      const labels = new Map(cols.map((c) => [norm(c.label), c.label]));
      const problems: string[] = [];
      if (!header.some(Boolean)) problems.push("The first row must hold the column names.");
      const unknown = header.filter((h) => h && !labels.has(norm(h)));
      if (unknown.length) problems.push(`Not a ${STREAM_LABEL[forStream]} Tracker column: ${unknown.map((u) => `“${u}”`).join(", ")}. Column names must match the tracker exactly (download the template).`);
      const dupes = header.filter((h, i) => h && header.findIndex((x) => norm(x) === norm(h)) !== i);
      if (dupes.length) problems.push(`Column named twice: ${[...new Set(dupes)].map((u) => `“${u}”`).join(", ")}.`);
      const data: Row[] = [];
      grid.slice(1).forEach((cells, i) => {
        if (!cells.some((c) => c && c.trim())) return;
        const values: Record<string, string> = {};
        header.forEach((h, j) => {
          if (h) values[labels.get(norm(h)) ?? h] = (cells[j] ?? "").trim();
        });
        data.push({ row: i + 2, values });
      });
      if (!data.length) problems.push("No rows to import below the column names.");
      setHeaderErrors(problems);
      setRows(data);
    } catch (e) {
      setHeaderErrors([`Could not read the file · ${(e as Error).message}`]);
    }
  };

  const run = async () => {
    if (!rows || !file) return;
    setErrors([]);
    setDone(null);
    // IDs must be unique across the whole file (the server also checks each request and the tracker).
    const idLabel = cols.find((c) => c.key === "record_id")?.label ?? "ID";
    const seen = new Map<string, number>();
    const local: RowError[] = [];
    for (const r of rows) {
      const id = (r.values[idLabel] ?? "").trim().toLowerCase();
      if (!id) continue;
      const prev = seen.get(id);
      if (prev) local.push({ row: r.row, column: idLabel, message: `${idLabel} “${r.values[idLabel]}” is also used on row ${prev}` });
      else seen.set(id, r.row);
    }
    try {
      // 1. Check every row first: nothing is written unless the whole file is valid.
      setStatus("Checking every row…");
      const found: RowError[] = [...local];
      for (let i = 0; i < rows.length; i += DRY_RUN_ROWS) {
        const r = await api<ImportResult>(`/api/import?stream=${stream}`, { method: "POST", json: { fileName: file.name, rows: rows.slice(i, i + DRY_RUN_ROWS), dryRun: true } });
        found.push(...r.errors);
      }
      if (found.length) {
        found.sort((a, b) => a.row - b.row);
        setErrors(found);
        setStatus(null);
        return;
      }
      // 2. Import in small batches (the free plan limits database work per request).
      setProgress({ at: 0, of: rows.length });
      setStatus(`Importing into the ${trackerName}…`);
      const codes: string[] = [];
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK_ROWS) {
        const r = await api<ImportResult>(`/api/import?stream=${stream}`, { method: "POST", json: { fileName: file.name, rows: rows.slice(i, i + IMPORT_CHUNK_ROWS) } });
        if (!r.ok) {
          setErrors(r.errors);
          setStatus(`Stopped after ${codes.length} of ${rows.length} rows. The first ${codes.length} are in the ${trackerName}: remove them from the file, fix the rows below and import the rest.`);
          await inv("tracker", "dashboard");
          return;
        }
        codes.push(...r.codes);
        setProgress({ at: Math.min(rows.length, i + IMPORT_CHUNK_ROWS), of: rows.length });
      }
      setDone({ n: codes.length, first: codes[0], last: codes[codes.length - 1] });
      setStatus(null);
      setRows(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await inv("tracker", "dashboard", "schema");
    } catch (e) {
      setStatus(`Import failed · ${(e as ApiError).message}`);
    }
  };

  const template = () => {
    const bytes = toXlsx([cols.map((c) => c.label)], `${STREAM_LABEL[stream]} Tracker`);
    const url = URL.createObjectURL(new Blob([bytes as unknown as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `eradigm-${stream}-tracker-import-template.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const busy = !!status && !status.startsWith("Stopped") && !status.startsWith("Import failed");
  const ready = !!rows?.length && !headerErrors.length;

  return (
    <section
      className={`card source-card${dragging ? " drag-target" : ""}`}
      aria-labelledby="import-title"
      data-testid="import-card"
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
      <div className="card-head" style={{ alignItems: "center" }}>
        <div>
          <h2 className="card-title" id="import-title">
            Import spreadsheet
          </h2>
          <span className="card-sub">Existing entries go straight to the {trackerName} (no Inbox review), and to Phantoms under the usual rules · .xlsx, .csv or .tsv</span>
        </div>
        <StreamSwitch
          noun="Tracker"
          value={stream}
          onChange={(s) => {
            setStream(s);
            reset();
            setFile(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
          label="Tracker to import into"
        />
      </div>
      <p className="import-help">
        The first row must hold the column names of the {trackerName}, spelled exactly as in the tracker; each further row is one entry. Competitors are separated by commas; dates as YYYY-MM-DD (Excel dates work too).
        <button className="link-btn" onClick={template} disabled={!cols.length}>
          Download the {trackerName} template (.xlsx)
        </button>
      </p>
      <div className="source-row">
        <label className={`drop${dragging ? " over" : ""}`} data-testid="drop-zone-import">
          <input ref={inputRef} type="file" accept=".xlsx,.csv,.tsv,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => void read(e.target.files?.[0] ?? null)} aria-label={`Spreadsheet to import into the ${trackerName}`} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--navy-700)" }}>{dragging ? "Drop the spreadsheet here" : file ? file.name : "Drag and drop a spreadsheet here, or click to choose"}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {rows && !headerErrors.length ? `${rows.length} row${rows.length === 1 ? "" : "s"} ready to check and import` : ".xlsx, .csv or .tsv · first sheet of a workbook"}
          </span>
        </label>
        <button className="btn lg" onClick={() => void run()} disabled={!ready || busy}>
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
          <div style={{ width: `${(progress.at / Math.max(1, progress.of)) * 100}%` }} />
        </div>
      )}
      {status && (
        <div className={status.startsWith("Stopped") || status.startsWith("Import failed") ? "err-msg" : "card-sub"} role="status">
          {status}
        </div>
      )}
      {errors.length > 0 && (
        <div className="import-errors" role="alert">
          <b>
            ✕ Nothing was imported: {errors.length} problem{errors.length === 1 ? "" : "s"} to fix in {file?.name ?? "the file"}
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
      {done && (
        <div className="import-done" role="status">
          <b>
            ✓ Imported {done.n} entr{done.n === 1 ? "y" : "ies"} into the {trackerName}
            {done.first ? ` (${done.first}${done.last && done.last !== done.first ? ` – ${done.last}` : ""})` : ""}
          </b>
          <span>
            They have no saved page yet: attach one from the tracker with the green <span aria-hidden="true">+</span> on each row.{" "}
            <Link to={`/tracker${stream === "secondary" ? "?stream=secondary" : ""}`}>Open the {trackerName} →</Link>
          </span>
        </div>
      )}
    </section>
  );
}
