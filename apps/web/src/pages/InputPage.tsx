import { useEffect, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CAPTURE_LIMITS, IN_PROGRESS_STATUSES, STREAM_LABEL, pipelineSteps, type ItemSummary, type Me, type Stream } from "@eradigm/shared";
import type { ApiError } from "../api/client";
import { api } from "../api/client";
import { useCaptureLog, useInvalidate, useItem, useSchema } from "../api/hooks";
import { ImportCard } from "../components/ImportCard";
import { StreamSwitch } from "../components/StreamSwitch";
import { ModelOutputTable } from "../components/ModelOutput";
import { localDateTime } from "../lib/format";

const DUP_BASIS: Record<"url" | "file" | "content", string> = {
  url: "Same URL as the existing tracker entry",
  file: "Same file as the existing tracker entry",
  content: "Same article text as the existing tracker entry",
};

const STAGE_OF_CODE: Record<string, number> = { TOO_LARGE: 0, CONTENT_TYPE: 0, MALICIOUS_CONTENT: 4 };

const SOURCE_NOTE: Record<Stream, string> = {
  primary: "Sent to the Eradigm Inbox as a Primary entry",
  secondary: "Sent to the Eradigm Inbox as a Secondary entry · Source Tier: Reviewed-Secondary",
};

interface LocalRun {
  stream: Stream;
  itemId: string | null;
  duplicate?: boolean;
  /** A blank manual entry (no file, so no capture steps). */
  typedIn?: boolean;
  /** Failure before an item was created (policy rejection). */
  failAt?: number;
  failDetail?: string;
}

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

/**
 * The one source card: a Primary / Secondary switch, then an HTML file (drag
 * and drop, or click to choose) or a blank manual entry, sent to that
 * source's Inbox.
 */
function SourceCard({
  busy,
  onSubmit,
  onManual,
}: {
  busy: "file" | "manual" | null;
  onSubmit: (stream: Stream, file: File) => Promise<boolean>;
  onManual: (stream: Stream) => Promise<void>;
}) {
  const [stream, setStream] = useState<Stream>("secondary");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = "src-html";
  const title = `${STREAM_LABEL[stream]} Source`;

  const pick = (f: File | null) => {
    setFile(f);
    setErr(f && !/\.html?$/i.test(f.name) ? "Only .html or .htm files are accepted." : null);
  };
  const submit = async () => {
    setErr(null);
    if (!file) return setErr("Choose or drop an HTML file first.");
    if (!/\.html?$/i.test(file.name)) return setErr("Only .html or .htm files are accepted.");
    if (file.size > CAPTURE_LIMITS.maxBytes) return setErr(`File exceeds the ${CAPTURE_LIMITS.maxBytes / 1048576} MB limit.`);
    if (await onSubmit(stream, file)) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section
      className={`card source-card${dragging ? " drag-target" : ""}`}
      aria-labelledby={`${id}-title`}
      data-testid="source-card"
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
          return setErr("Drop one HTML file at a time.");
        }
        pick(files[0] ?? null);
      }}
    >
      <div className="card-head" style={{ alignItems: "center" }}>
        <div>
          <h2 className="card-title" id={`${id}-title`}>
            Add a source
          </h2>
          <span className="card-sub">{SOURCE_NOTE[stream]}</span>
        </div>
        <StreamSwitch
          noun="Source"
          value={stream}
          onChange={(s) => {
            setStream(s);
            setErr(null);
          }}
          label="Source type"
        />
      </div>
      <div className="source-row">
        <label className={`drop${dragging ? " over" : ""}`} data-testid="drop-zone-html">
          <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} aria-describedby={err ? `${id}-err` : `${id}-note`} aria-label={`${title}: HTML file`} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--navy-700)" }}>{dragging ? "Drop the HTML file here" : file ? file.name : "Drag and drop an HTML file here, or click to choose"}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }} id={`${id}-note`}>
            {file ? `${Math.round(file.size / 1024)} KB` : `.html or .htm up to ${CAPTURE_LIMITS.maxBytes / 1048576} MB · save pages with SingleFile`}
          </span>
        </label>
        <button className="btn lg" onClick={submit} disabled={!!busy} aria-label={`Process file for ${title}`}>
          {busy === "file" ? "Uploading…" : "Process file"}
        </button>
      </div>
      <div className="manual-row">
        <span>
          <b>No HTML file?</b> Send a blank {STREAM_LABEL[stream]} entry to the Eradigm Inbox and fill in every field there. You can attach the HTML later from the tracker.
        </span>
        <button className="btn secondary" onClick={() => void onManual(stream)} disabled={!!busy}>
          {busy === "manual" ? "Creating…" : "✎ Manual entry"}
        </button>
      </div>
      {err && (
        <div className="err-msg" id={`${id}-err`} role="alert">
          <b>✕</b> {err}
        </div>
      )}
    </section>
  );
}

export function InputPage({ me }: { me: Me }) {
  const manual = me.features.prefill === "manual";
  const [run, setRun] = useState<LocalRun | null>(null);
  const [busy, setBusy] = useState<"file" | "manual" | null>(null);
  const [pageErr, setPageErr] = useState<string | null>(null);
  const schema = useSchema(run?.stream ?? "primary");
  const inv = useInvalidate();
  const log = useCaptureLog(true);
  const nav = useNavigate();
  const item = useItem(run?.itemId ?? null, true);
  const d = item.data;

  // A file dropped outside a drop zone must not make the browser open (navigate to) it.
  useEffect(() => {
    const stop = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);
  const inProgress = d ? IN_PROGRESS_STATUSES.includes(d.status) : false;

  const submit = async (stream: Stream, file: File): Promise<boolean> => {
    setPageErr(null);
    setBusy("file");
    const key = crypto.randomUUID();
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("stream", stream);
      const res = await api<{ item: ItemSummary; duplicate: boolean }>("/api/submissions", { method: "POST", body: fd, headers: { "idempotency-key": key } });
      setRun({ stream, itemId: res.item.id, duplicate: res.duplicate });
      return true;
    } catch (e) {
      const ae = e as ApiError;
      const code = ae.fields?.[0]?.code ?? ae.code;
      if (ae.status === 422 || ae.status === 415 || ae.status === 413) {
        setRun({ stream, itemId: null, failAt: STAGE_OF_CODE[code] ?? 0, failDetail: ae.message });
        return false;
      }
      setPageErr(ae.message);
      return false;
    } finally {
      setBusy(null);
      await inv("capture-log", "items", "counts");
    }
  };

  const createManual = async (stream: Stream) => {
    setPageErr(null);
    setBusy("manual");
    try {
      const res = await api<{ item: ItemSummary; duplicate: boolean }>("/api/submissions/manual", { method: "POST", json: { stream }, headers: { "idempotency-key": crypto.randomUUID() } });
      setRun({ stream, itemId: res.item.id, typedIn: true });
    } catch (e) {
      setPageErr((e as ApiError).message);
    } finally {
      setBusy(null);
      await inv("items", "counts");
    }
  };

  const labels = pipelineSteps("file", me.features.prefill);
  const serverSteps = d?.attemptsDetail[0]?.steps ?? [];
  const failedIdx = run?.failAt ?? (d?.status === "failed" ? serverSteps.findIndex((s) => !s.ok) : -1);
  const doneAll = d?.status === "needs_review" || d?.status === "approved";
  const inboxName = "Eradigm Inbox";
  const inboxLink = "/inbox";

  const stepState = (i: number) => {
    if (run?.failAt != null) {
      if (i < run.failAt) return { st: "done", detail: "Passed" };
      if (i === run.failAt) return { st: "fail", detail: run.failDetail ?? "" };
      return { st: "skip", detail: "Not run" };
    }
    const s = serverSteps[i];
    if (s && !s.ok) return { st: "fail", detail: s.detail };
    if (s) return { st: "done", detail: s.detail };
    if (d?.status === "failed") {
      if (failedIdx < 0 && i === serverSteps.length) return { st: "fail", detail: d.error?.message ?? "Failed" };
      return { st: "skip", detail: "Not run" };
    }
    if (doneAll) return { st: "done", detail: "Passed" };
    if (i === serverSteps.length && (inProgress || !d)) return { st: "now", detail: "In progress…" };
    return { st: "wait", detail: "Waiting" };
  };

  const runStatus = !run
    ? ""
    : run.failAt != null
      ? `Stopped at step ${run.failAt + 1}`
      : !d || inProgress
        ? d?.status === "fetching" || d?.status === "extracting" || d?.status === "queued"
          ? `Running… (${d.status})`
          : "Running…"
        : d.status === "failed"
          ? `Stopped · ${d.error?.message ?? "failed"}`
          : run.duplicate
            ? `Already submitted as ${d.code} · not submitted twice`
            : d.duplicateOf
              ? `Complete · sent to the ${inboxName} · ⚠ possible duplicate of ${d.duplicateOf}`
              : `Complete · sent to the ${inboxName}`;
  const runColor = !run ? "" : run.failAt != null || d?.status === "failed" ? "var(--error)" : doneAll ? "var(--success-2)" : "var(--teal)";

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <section className="band" aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">Analysts and admins only</span>
            <h1 id="page-title">Input</h1>
          </div>
          <div className="band-copy">
            {manual
              ? "Upload an HTML file saved with SingleFile as a Primary or a Secondary source, or send a blank manual entry. Either goes to the Eradigm Inbox with every tracker field empty for an analyst to complete. Nothing is published automatically."
              : "Upload an HTML file saved with SingleFile as a Primary or a Secondary source. Every extracted draft goes to the Eradigm Inbox for review and is never published automatically."}
          </div>
        </div>
      </section>
      <div className="content">
        <div className="source-stack">
          <SourceCard busy={busy} onSubmit={submit} onManual={createManual} />
          <ImportCard />
        </div>
        {pageErr && (
          <div className="err-msg" role="alert">
            <b>✕</b> {pageErr}
          </div>
        )}

        {d?.duplicateOf && d.status !== "approved" && (
          <div className="banner warn dup-banner" role="alert">
            <b>⚠ Possible duplicate: this source is already in the tracker as {d.duplicateOf}</b>
            <span>
              {DUP_BASIS[d.duplicateBasis ?? "url"]}. It has still been sent to the Eradigm Inbox as {d.code}. When it is approved, the reviewer will be asked to confirm before a second tracker entry is created.
            </span>
          </div>
        )}

        {run && !run.typedIn && (
          <section className="card" aria-labelledby="pipe-title">
            <div className="card-head" style={{ alignItems: "baseline" }}>
              <h2 className="card-title" id="pipe-title">
                {manual ? "Capture" : "Capture and extraction"} · {STREAM_LABEL[run.stream]} Source{" "}
                {d ? <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>· {d.code}</span> : null}
              </h2>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: runColor }} role="status">
                {runStatus}
              </span>
            </div>
            <ol className="steps">
              {labels.map((l, i) => {
                const s = stepState(i);
                return (
                  <li key={l} className={`step ${s.st === "skip" ? "skip" : ""} ${s.st === "fail" ? "failed" : ""}`}>
                    <span className={`dot ${s.st === "done" ? "done" : s.st === "fail" ? "fail" : s.st === "now" ? "now" : ""}`} aria-hidden="true">
                      {s.st === "done" ? "✓" : s.st === "fail" ? "✕" : s.st === "now" ? "…" : i + 1}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <b>
                        {l}
                        <span className="sr-only"> — {s.st === "done" ? "done" : s.st === "fail" ? "failed" : s.st === "now" ? "in progress" : s.st === "skip" ? "not run" : "waiting"}</span>
                      </b>
                      <span className="d">{s.detail}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {d && !d.extraction && schema.data && (d.status === "needs_review" || d.status === "approved") && (
          <section className="card" aria-labelledby="sent-title">
            <div className="card-head" style={{ alignItems: "center" }}>
              <div>
                <h2 className="card-title" id="sent-title">
                  {run?.typedIn ? "Blank entry sent" : "Sent"} to the {inboxName}
                </h2>
                <span className="card-sub">
                  {d.code} · {run?.typedIn ? "blank manual entry, no source file" : "saved page stored"} · {schema.data.columns.filter((c) => c.key !== "source_tier").length} tracker fields left empty for the analyst · nothing sent to any external service
                </span>
              </div>
              <button className="btn" onClick={() => nav(inboxLink)}>
                Complete in {inboxName} →
              </button>
            </div>
          </section>
        )}

        {d && d.extraction && schema.data && (d.status === "needs_review" || d.status === "approved") && (
          <section className="card flush" aria-labelledby="mo-title">
            <div className="card-head" style={{ padding: "16px 20px 12px" }}>
              <div>
                <h2 className="card-title" id="mo-title">
                  Model output
                </h2>
                <span className="card-sub">
                  {schema.data.columns.length} fields · {Object.values(d.extraction).filter((x) => x.value == null).length} null · {d.warningsCount} with validation warnings · taxonomy enforced · {d.attemptsDetail[0]?.model ?? ""}
                </span>
              </div>
              <span className="tag warn" style={{ height: 26, lineHeight: "26px", fontSize: 12, padding: "0 11px" }}>
                {d.status === "approved" ? "Approved" : "Needs review"}
              </span>
            </div>
            <ModelOutputTable schema={schema.data} extraction={d.extraction} caption="Model output with evidence and validation" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 20px", borderTop: "1px solid var(--rule)", background: "var(--subtle)", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>The draft is in the Eradigm Inbox as Needs review. Nothing is published until it is pushed to the Tracker.</span>
              <button className="btn" onClick={() => nav(inboxLink)}>
                Review in {inboxName} →
              </button>
            </div>
          </section>
        )}

        <section className="card flush" aria-labelledby="log-title">
          <div style={{ padding: "16px 20px 12px" }}>
            <h2 className="card-title" id="log-title">
              Capture log
            </h2>
            <span className="card-sub">Final resolved URL and retrieval outcome for every submission</span>
          </div>
          <div className="table-wrap">
            <table className="data" style={{ minWidth: 760, fontSize: 12.5 }}>
              <caption className="sr-only">Capture log</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Source</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Final resolved URL</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {(log.data ?? []).map((l) => (
                  <tr key={l.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 11.5 }}>
                      {localDateTime(l.at)}
                    </td>
                    <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{l.stream ? STREAM_LABEL[l.stream] : "—"}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink)", overflowWrap: "anywhere", maxWidth: 260 }}>
                      {l.input}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5, overflowWrap: "anywhere", maxWidth: 260 }}>
                      {l.finalUrl ?? "—"}
                    </td>
                    <td style={{ fontWeight: 700, color: l.ok ? "var(--success-2)" : "var(--error)" }}>
                      <span aria-hidden="true">{l.ok ? "✓ " : "✕ "}</span>
                      <span className="sr-only">{l.ok ? "Succeeded: " : "Failed: "}</span>
                      {l.outcome}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {log.data && !log.data.length && <div className="empty">No submissions yet.</div>}
        </section>
      </div>
    </div>
  );
}
