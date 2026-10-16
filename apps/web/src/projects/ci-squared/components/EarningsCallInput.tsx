import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { EARNINGS_CALL_FIELDS, MAX_EARNINGS_FIELD, MAX_EARNINGS_REPORT_BYTES, type EarningsCall, type EarningsCallField } from "@eradigm/shared";
import { api, type ApiError } from "../../../api/client";
import { useInvalidate } from "../api/hooks";
import { DocxPane } from "./Deliverables";
import "../styles/earnings.css";

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
const isDocx = (f: File) => /\.docx$/i.test(f.name);
const EMPTY = Object.fromEntries(EARNINGS_CALL_FIELDS.map((f) => [f.key, ""])) as Record<EarningsCallField, string>;
const SHORT = EARNINGS_CALL_FIELDS.filter((f) => !f.long);
const LONG = EARNINGS_CALL_FIELDS.filter((f) => f.long);
const REQUIRED: readonly EarningsCallField[] = ["quarter", "company"];
const PLACEHOLDER: Partial<Record<EarningsCallField, string>> = { quarter: "Q3 2024", company: "J&J", tagline: "The call's headline in a sentence" };

/**
 * Input → Earnings Call (request 64): attach the call's report (.docx, drag
 * and drop or click; View opens it in the side pane before it is sent), fill
 * in the fields, and Submit. The platform makes a Markdown file of the fields
 * and lists the call in Database → Earnings Calls.
 */
export function EarningsCallInput() {
  const [file, setFile] = useState<File | null>(null);
  const [values, setValues] = useState(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Partial<Record<EarningsCallField, string>>>({});
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<EarningsCall | null>(null);
  const depth = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLElement>(null);
  const inv = useInvalidate();
  const loc = useLocation();

  // Database → Earnings Calls links here (“+ Input an earnings call”).
  useEffect(() => {
    if (loc.hash === "#earnings-call") card.current?.scrollIntoView({ block: "start" });
  }, [loc.hash]);

  const pick = (f: File | null) => {
    setFile(f);
    setSaved(null);
    if (fileRef.current && !f) fileRef.current.value = "";
    setErr(f && !isDocx(f) ? "Only Word documents (.docx) are accepted." : f && f.size > MAX_EARNINGS_REPORT_BYTES ? `The report is over the ${MAX_EARNINGS_REPORT_BYTES / 1048576} MB limit.` : null);
  };
  const set = (k: EarningsCallField, v: string) => {
    setValues((p) => ({ ...p, [k]: v }));
    setFieldErr((p) => ({ ...p, [k]: undefined }));
    setSaved(null);
  };

  const submit = async () => {
    setErr(null);
    const missing = Object.fromEntries(REQUIRED.filter((k) => !values[k].trim()).map((k) => [k, `Give the ${k}`]));
    setFieldErr(missing);
    if (!file) return setErr("Attach the report (.docx) first.");
    if (!isDocx(file)) return setErr("Only Word documents (.docx) are accepted.");
    if (file.size > MAX_EARNINGS_REPORT_BYTES) return setErr(`The report is over the ${MAX_EARNINGS_REPORT_BYTES / 1048576} MB limit.`);
    if (Object.keys(missing).length) return setErr("Fill in the Quarter and the Company.");
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("values", JSON.stringify(values));
      const res = await api<EarningsCall>("/api/earnings-calls", { method: "POST", body: fd });
      await inv("earnings-calls");
      setSaved(res);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setValues(EMPTY);
    } catch (e) {
      const ae = e as ApiError;
      setFieldErr(Object.fromEntries(ae.fields.filter((f) => f.key in EMPTY).map((f) => [f.key, f.message])));
      setErr(ae.message);
    } finally {
      setSaving(false);
    }
  };

  const field = (f: (typeof EARNINGS_CALL_FIELDS)[number]) => {
    const id = `ec-${f.key}`;
    const bad = fieldErr[f.key];
    const common = {
      id,
      value: values[f.key],
      maxLength: MAX_EARNINGS_FIELD,
      placeholder: PLACEHOLDER[f.key],
      "aria-invalid": bad ? true : undefined,
      "aria-describedby": bad ? `${id}-err` : undefined,
      "data-testid": id,
    };
    return (
      <label className="field" key={f.key} htmlFor={id}>
        <span>
          {f.label}
          {REQUIRED.includes(f.key) ? " *" : ""}
        </span>
        {f.long ? (
          <textarea className="control ec-text" {...common} onChange={(e) => set(f.key, e.target.value)} />
        ) : (
          <input className="control" type="text" {...common} maxLength={f.key === "quarter" ? 40 : 200} onChange={(e) => set(f.key, e.target.value)} />
        )}
        {bad && (
          <span className="err-text" id={`${id}-err`} style={{ textTransform: "none", letterSpacing: 0, fontSize: 12, color: "var(--error)" }}>
            {bad}
          </span>
        )}
      </label>
    );
  };

  return (
    <section
      ref={card}
      id="earnings-call"
      className={`card source-card ec-input${dragging ? " drag-target" : ""}`}
      aria-labelledby="ec-title"
      data-testid="earnings-call-input"
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
        const files = e.dataTransfer.files;
        if (!files.length) return;
        if (fileRef.current) fileRef.current.value = "";
        if (files.length > 1) {
          setFile(null);
          return setErr("Drop one report (.docx) at a time.");
        }
        pick(files[0] ?? null);
      }}
    >
      <div className="card-head" style={{ alignItems: "center" }}>
        <div>
          <h2 className="card-title" id="ec-title">
            Input Earnings Call
          </h2>
          <span className="card-sub">Attach the call's report and fill in its fields: on Submit a Markdown file of the fields is made, and both go to Database · Earnings Calls</span>
        </div>
      </div>
      <div className="ec-report">
        <div className="drop-wrap">
          <label className={`drop${dragging ? " over" : ""}`} data-testid="drop-zone-earnings">
            <input
              ref={fileRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
              aria-label="Earnings call report: Word document"
              aria-describedby="ec-file-note"
            />
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--navy-700)" }}>{dragging ? "Drop the report here" : file ? file.name : "Drag and drop the report (.docx) here, or click to choose"}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }} id="ec-file-note">
              {file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `Word document (.docx) up to ${MAX_EARNINGS_REPORT_BYTES / 1048576} MB`}
            </span>
          </label>
          {file && (
            <button type="button" className="drop-remove" disabled={saving} aria-label={`Remove ${file.name}`} title="Remove this file" onClick={() => pick(null)}>
              ✕ Remove
            </button>
          )}
        </div>
        <button type="button" className="btn secondary" disabled={!file || !isDocx(file)} onClick={() => setViewing(true)} data-testid="ec-view">
          View report
        </button>
      </div>
      <div className="ec-short">{SHORT.map(field)}</div>
      <div className="ec-long">{LONG.map(field)}</div>
      <div className="ec-foot">
        <span className="card-sub">* Quarter and Company are needed · the other fields may be left empty</span>
        <button className="btn" onClick={() => void submit()} disabled={saving} data-testid="ec-submit">
          {saving ? "Submitting…" : "Submit earnings call"}
        </button>
      </div>
      {err && (
        <div className="err-msg" role="alert">
          {err}
        </div>
      )}
      {saved && (
        <div className="import-done" role="status" data-testid="ec-saved">
          <b>
            ✓ Saved the earnings call {saved.company} {saved.quarter}, with its Markdown
          </b>
          <span>
            <Link to="/database?db=earnings">Database · Earnings Calls →</Link>
          </span>
        </div>
      )}
      {viewing && file && <DocxPane id="attached" file={file} kind="Earnings call report · not yet submitted" title={file.name} onClose={() => setViewing(false)} />}
    </section>
  );
}
