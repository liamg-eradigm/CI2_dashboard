import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CAPTURE_LIMITS, IN_PROGRESS_STATUSES, checkAndNormaliseUrl, pipelineSteps, type ItemSummary, type Me } from "@eradigm/shared";
import type { ApiError } from "../api/client";
import { api } from "../api/client";
import { useCaptureLog, useInvalidate, useItem, useSchema } from "../api/hooks";
import { ModelOutputTable } from "../components/ModelOutput";
import { localDateTime } from "../lib/format";


const SAMPLES: [string, string][] = [
  ["Public article", "newsroom.example.com/roche-autonomous-lab?utm_source=li#top"],
  ["Private IP", "http://10.0.0.12/admin"],
  ["Metadata", "http://169.254.169.254/latest/meta-data"],
  ["Paywall", "https://news.example.com/login?next=/pfizer"],
  ["FTP", "ftp://files.example.com/a.html"],
];

const STAGE_OF_CODE: Record<string, number> = { EMPTY: 0, INVALID: 0, SCHEME: 0, CREDENTIALS: 0, TOO_LONG: 0, BLOCKED_HOST: 1, PORT: 1, CONTENT_TYPE: 2, TOO_LARGE: 0, MALICIOUS_CONTENT: 4 };

interface LocalRun {
  mode: "url" | "file";
  itemId: string | null;
  duplicate?: boolean;
  /** Failure before an item was created (policy rejection). */
  failAt?: number;
  failDetail?: string;
  firstDetail?: string;
}

export function InputPage({ me }: { me: Me }) {
  const manual = me.features.prefill === "manual";
  const [mode, setMode] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState<LocalRun | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const schema = useSchema();
  const inv = useInvalidate();
  const log = useCaptureLog(true);
  const nav = useNavigate();
  const item = useItem(run?.itemId ?? null, true);
  const d = item.data;
  const inProgress = d ? IN_PROGRESS_STATUSES.includes(d.status) : false;

  const submit = async () => {
    setErr(null);
    if (mode === "url") {
      if (!url.trim()) return setErr("Enter a URL to capture.");
    } else {
      if (!file) return setErr("Choose an HTML file first.");
      if (!/\.html?$/i.test(file.name)) return setErr("Only .html or .htm files are accepted.");
      if (file.size > CAPTURE_LIMITS.maxBytes) return setErr(`File exceeds the ${CAPTURE_LIMITS.maxBytes / 1048576} MB limit.`);
    }
    setBusy(true);
    const key = crypto.randomUUID();
    try {
      let res: { item: ItemSummary; duplicate: boolean };
      if (mode === "url") {
        res = await api("/api/submissions", { method: "POST", json: { url }, headers: { "idempotency-key": key } });
      } else {
        const fd = new FormData();
        fd.append("file", file as File);
        res = await api("/api/submissions", { method: "POST", body: fd, headers: { "idempotency-key": key } });
      }
      setRun({ mode, itemId: res.item.id, duplicate: res.duplicate });
    } catch (e) {
      const ae = e as ApiError;
      const code = ae.fields?.[0]?.code ?? ae.code;
      if (ae.status === 422 || ae.status === 415 || ae.status === 413) {
        const at = STAGE_OF_CODE[code] ?? 0;
        const norm = mode === "url" ? checkAndNormaliseUrl(url) : null;
        setRun({ mode, itemId: null, failAt: at, failDetail: ae.message, firstDetail: at > 0 && norm && "url" in norm && norm.url ? `Normalised to ${norm.url}` : undefined });
      } else setErr(ae.message);
    } finally {
      setBusy(false);
      await inv("capture-log", "items");
    }
  };

  const labels = pipelineSteps(run?.mode ?? mode, me.features.prefill);
  const serverSteps = d?.attemptsDetail[0]?.steps ?? [];
  const failedIdx = run?.failAt ?? (d?.status === "failed" ? serverSteps.findIndex((s) => !s.ok) : -1);
  const doneAll = d?.status === "needs_review" || d?.status === "approved";

  const stepState = (i: number) => {
    if (run?.failAt != null) {
      if (i < run.failAt) return { st: "done", detail: i === 0 && run.firstDetail ? run.firstDetail : "Passed" };
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
            ? `Already captured as ${d.code} · no duplicate created`
            : "Complete · sent to Needs review";
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
              ? "Paste the URL of a news update, or upload an HTML file saved with SingleFile when a login portal blocks capture. The page is saved and sent to the Inbox with every tracker field empty for an analyst to complete. Nothing is published automatically."
              : "Paste the URL of a news update, or upload an HTML file saved with SingleFile when a login portal blocks capture. Every extracted draft goes to the Inbox for review and is never published automatically."}
          </div>
        </div>
      </section>
      <div className="content">
        <section className="card" aria-labelledby="new-src">
          <div className="card-head" style={{ alignItems: "center" }}>
            <h2 className="card-title" id="new-src">
              New source
            </h2>
            <div className="seg" role="group" aria-label="Input type" style={{ width: 260 }}>
              {(["url", "file"] as const).map((m) => (
                <button key={m} aria-pressed={mode === m} onClick={() => (setMode(m), setErr(null))}>
                  {m === "url" ? "URL" : "HTML file"}
                </button>
              ))}
            </div>
          </div>
          {mode === "url" ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ flex: "1 1 320px", display: "flex" }}>
                  <span className="sr-only">News URL</span>
                  <input
                    className="url-input"
                    value={url}
                    onChange={(e) => (setUrl(e.target.value), setErr(null))}
                    onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
                    placeholder="https://newsroom.example.com/article"
                    inputMode="url"
                    aria-invalid={!!err}
                    aria-describedby={err ? "input-err" : undefined}
                  />
                </label>
                <button className="btn lg" onClick={submit} disabled={busy}>
                  {busy ? "Submitting…" : "Capture source"}
                </button>
              </div>
              <div className="chips">
                <span>Try:</span>
                {SAMPLES.map(([l, u]) => (
                  <button key={l} className="chip" onClick={() => (setUrl(u), setErr(null))}>
                    {l}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
              <label className="drop">
                <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="sr-only" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setErr(null))} aria-describedby={err ? "input-err" : "file-note"} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--navy-700)" }}>{file ? file.name : "Choose an HTML file"}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }} id="file-note">
                  {file ? `${Math.round(file.size / 1024)} KB` : `.html or .htm up to ${CAPTURE_LIMITS.maxBytes / 1048576} MB · use SingleFile when a login portal blocks URL capture`}
                </span>
              </label>
              <button className="btn lg" style={{ alignSelf: "center" }} onClick={submit} disabled={busy}>
                {busy ? "Uploading…" : "Process file"}
              </button>
            </div>
          )}
          {err && (
            <div className="err-msg" id="input-err" role="alert">
              <b>✕</b> {err}
            </div>
          )}
        </section>

        {run && (
          <section className="card" aria-labelledby="pipe-title">
            <div className="card-head" style={{ alignItems: "baseline" }}>
              <h2 className="card-title" id="pipe-title">
                {manual ? "Capture" : "Capture and extraction"} {d ? <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>· {d.code}</span> : null}
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
                  Sent to the Inbox
                </h2>
                <span className="card-sub">
                  {d.code} · saved page stored · {schema.data.columns.length} tracker fields left empty for the analyst · nothing sent to any external service
                </span>
              </div>
              <button className="btn" onClick={() => nav("/inbox")}>
                Complete in Inbox →
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
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>The draft is in the Inbox as Needs review. Nothing is published until an analyst approves it.</span>
              <button className="btn" onClick={() => nav("/inbox")}>
                Review in Inbox →
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
