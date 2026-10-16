import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EARNINGS_CALL_FIELDS, can, type EarningsCall, type Me } from "@eradigm/shared";
import { api, type ApiError } from "../../../api/client";
import { useEarningsCallMarkdown, useEarningsCalls, useInvalidate } from "../api/hooks";
import { DocxButton, DocxPane } from "../components/Deliverables";
import { saveMarkdown } from "../components/MarkdownPanel";
import { useFocusTrap } from "../components/RecordDrawer";
import { useFitToScreen } from "../../../lib/fitToScreen";
import { localDateTime } from "../../../lib/format";
import { useToast } from "../../../state/toast";
import "../styles/earnings.css";

const name = (c: EarningsCall) => `${c.company} ${c.quarter}`;

function MdIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M5 2.5h6.5L15.5 6.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11.5 2.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <text x="10" y="14.6" textAnchor="middle" fontSize="5.6" fontWeight="700" fontFamily="sans-serif" fill="currentColor">
        MD
      </text>
    </svg>
  );
}

/**
 * Database → Earnings Calls (request 64): every earnings call submitted on
 * the Input page, newest first. Report opens the attached .docx and Markdown
 * the Markdown file made from the fields, each in the side pane; then one
 * column per field.
 */
export function EarningsCallsPage({ me, strip }: { me: Me; strip: ReactNode }) {
  const q = useEarningsCalls();
  const [params, setParams] = useSearchParams();
  const [find, setFind] = useState("");
  const fitRef = useFitToScreen(160, 1, true);
  const inv = useInvalidate();
  const toast = useToast();
  const staff = can(me.role, "item:edit");
  const set = (key: "md" | "docx", id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete("md");
        n.delete("docx");
        if (id) n.set(key, id);
        return n;
      },
      { replace: !id },
    );

  const list = useMemo(() => {
    const f = find.trim().toLowerCase();
    return (q.data ?? []).filter((c) => !f || [...EARNINGS_CALL_FIELDS.map((x) => c[x.key]), c.reportName, c.submittedBy ?? ""].join(" ").toLowerCase().includes(f));
  }, [q.data, find]);
  const mdOpen = q.data?.find((c) => c.id === params.get("md")) ?? null;
  const docxOpen = q.data?.find((c) => c.id === params.get("docx")) ?? null;

  const remove = async (c: EarningsCall) => {
    if (!window.confirm(`Remove the earnings call ${name(c)} (${localDateTime(c.submittedAt)}) from the Database?\n\nIts report and Markdown are deleted with it.`)) return;
    try {
      await api(`/api/earnings-calls/${c.id}`, { method: "DELETE" });
      if (mdOpen?.id === c.id || docxOpen?.id === c.id) set("md", null);
      await inv("earnings-calls");
      toast("Earnings call removed");
    } catch (e) {
      toast(`Could not remove it · ${(e as ApiError).message}`, false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }} data-testid="earnings-calls">
      <section className="band" aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">Every database in one place</span>
            <h1 id="page-title">Database</h1>
          </div>
        </div>
      </section>
      {strip}
      <div className="content ptr-content">
        <section className="card flush ptr-card" aria-labelledby="ec-list-title">
          <div className="table-top">
            <div>
              <h2 className="card-title" id="ec-list-title">
                Earnings Calls
              </h2>
              <span className="card-sub">{q.data ? `${list.length} of ${q.data.length} submitted · open the report or the Markdown from its icon` : "Loading…"}</span>
            </div>
            <div className="tas-tools">
              <input className="control tas-find" type="search" placeholder="Find a company, quarter or text…" aria-label="Find earnings calls" value={find} onChange={(e) => setFind(e.target.value)} />
              {staff && (
                <Link className="btn secondary small" to="/input#earnings-call">
                  + Input an earnings call
                </Link>
              )}
            </div>
          </div>
          {q.isError && (
            <div className="err-msg" role="alert" style={{ margin: 20 }}>
              Could not load the earnings calls · {(q.error as Error).message}
            </div>
          )}
          <div ref={fitRef} className="table-wrap fit tas-wrap" tabIndex={0} role="region" aria-label="Earnings Calls (scrollable)">
            <table className="data ec-table" data-testid="earnings-calls-table">
              <caption className="sr-only">Earnings Calls</caption>
              <thead>
                <tr>
                  <th scope="col" className="md-col">
                    <span>Report</span>
                  </th>
                  <th scope="col" className="md-col">
                    <span>Markdown</span>
                  </th>
                  {EARNINGS_CALL_FIELDS.map((f) => (
                    <th scope="col" key={f.key} className={f.long ? "ec-long-col" : f.key === "tagline" ? "ec-tag-col" : undefined}>
                      <span>{f.label}</span>
                    </th>
                  ))}
                  <th scope="col">
                    <span>Submitted</span>
                  </th>
                  {staff && (
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {q.data && !list.length && (
                  <tr>
                    <td colSpan={99} className="empty">
                      {q.data.length ? "No earnings call matches." : "No earnings calls yet. Submit one on the Input page (Input Earnings Call)."}
                    </td>
                  </tr>
                )}
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="md-col">
                      <DocxButton label={`Open the report of the earnings call ${name(c)}`} onClick={() => set("docx", c.id)} />
                    </td>
                    <td className="md-col">
                      <button className="src-btn open md-open" onClick={() => set("md", c.id)} aria-label={`Open the Markdown of the earnings call ${name(c)}`} title="Open the Markdown file">
                        <MdIcon />
                      </button>
                    </td>
                    {EARNINGS_CALL_FIELDS.map((f) =>
                      f.long ? (
                        <td key={f.key}>
                          <div className={`ec-cell${c[f.key] ? "" : " empty-val"}`}>{c[f.key] || "—"}</div>
                        </td>
                      ) : (
                        <td key={f.key} className={f.key === "tagline" ? undefined : "nowrap"}>
                          {f.key === "company" ? <b>{c.company}</b> : c[f.key] || <span className="empty-val">—</span>}
                        </td>
                      ),
                    )}
                    <td className="ec-by nowrap">
                      {localDateTime(c.submittedAt)}
                      <span>{c.submittedBy ?? ""}</span>
                    </td>
                    {staff && (
                      <td>
                        <button className="icon-btn" onClick={() => void remove(c)} aria-label={`Remove the earnings call ${name(c)}`} title="Remove from the Database">
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {mdOpen && <EarningsCallMarkdownPane c={mdOpen} onClose={() => set("md", null)} />}
      {docxOpen && <DocxPane id={docxOpen.id} src={`/api/earnings-calls/${docxOpen.id}/report`} kind="Earnings call report" title={name(docxOpen)} onClose={() => set("docx", null)} />}
    </div>
  );
}

/** An earnings call's Markdown in the side pane, with Copy and Download at the top right. */
function EarningsCallMarkdownPane({ c, onClose }: { c: EarningsCall; onClose: () => void }) {
  const md = useEarningsCallMarkdown(c.id);
  const ref = useFocusTrap(true, onClose);
  const [tab, setTab] = useState<"raw" | "preview">("raw");
  const toast = useToast();
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer source-drawer md-pane" role="dialog" aria-modal="true" aria-labelledby="ec-md-title" ref={ref} data-testid="earnings-call-md">
        <div className="drawer-head">
          <span className="drawer-meta">
            <span className="mono md-file" style={{ color: "var(--ink)" }}>
              Earnings call
            </span>
            <span>·</span>
            <span>{localDateTime(c.submittedAt)}</span>
          </span>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div className="seg md-seg" role="group" aria-label="Markdown view">
              <button aria-pressed={tab === "raw"} onClick={() => setTab("raw")}>
                Markdown
              </button>
              <button aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>
                Preview
              </button>
            </div>
            <button
              className="link-btn"
              disabled={!md.data}
              onClick={() =>
                void navigator.clipboard.writeText(md.data ?? "").then(
                  () => toast("Markdown copied"),
                  () => toast("Could not copy · select the text instead", false),
                )
              }
            >
              Copy
            </button>
            <button
              className="link-btn"
              onClick={() =>
                void saveMarkdown(`/api/earnings-calls/${c.id}/markdown?download=1`, `${c.id}.md`).then(
                  (n) => toast(`Downloaded ${n}`),
                  (e: Error) => toast(`Download failed · ${e.message}`, false),
                )
              }
            >
              Download Markdown
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close Markdown" data-autofocus>
              ✕
            </button>
          </div>
          <h2 id="ec-md-title" className="source-drawer-title">
            {name(c)}
          </h2>
        </div>
        <div className="md-pane-body ec-md-body">
          {md.isLoading && <div className="skeleton" style={{ height: 240, margin: 16 }} />}
          {md.isError && (
            <p className="err-msg" role="alert" style={{ margin: 24 }}>
              {(md.error as Error).message}
            </p>
          )}
          {md.data && tab === "raw" && (
            <pre className="md-raw" tabIndex={0} aria-label="Markdown source">
              {md.data}
            </pre>
          )}
          {tab === "preview" && (
            <div className="md-preview">
              {EARNINGS_CALL_FIELDS.map((f) => (
                <section key={f.key}>
                  <h3>{f.label}</h3>
                  <p>{c[f.key] || "—"}</p>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
