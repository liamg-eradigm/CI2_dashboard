import { useMemo, useState, type ReactNode } from "react";
import { useFitToScreen } from "../lib/fitToScreen";
import { Link, useSearchParams } from "react-router-dom";
import { TREND_ANALYSIS_COLUMNS, TREND_CATEGORY_LABEL, TREND_LEVEL_LABEL, can, type Me, type TrendAnalysis, type TrendAnalysisCategory } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useInvalidate, useTrendAnalyses, useTrendAnalysisMarkdown } from "../api/hooks";
import { FrontMatter, parseMarkdown, saveMarkdown } from "../components/MarkdownPanel";
import { useFocusTrap } from "../components/RecordDrawer";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";

const download = (a: TrendAnalysis) => saveMarkdown(`/api/trend-analyses/${a.id}/markdown?download=1`, `${a.id}.md`);

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
 * Trackers → Trend Analyses (request 29): every trend analysis submitted on
 * the Input page, newest first, each kept as a Markdown file (the four
 * spreadsheet columns as rows, and the date of submission).
 */
export function TrendAnalysesPage({ me, title = "CI analyses", eyebrow = "Databases", above }: { me: Me | undefined; title?: string; eyebrow?: string; above?: ReactNode }) {
  const q = useTrendAnalyses();
  const [params, setParams] = useSearchParams();
  const [find, setFind] = useState("");
  const fitRef = useFitToScreen(200);
  const [cat, setCat] = useState<TrendAnalysisCategory | "all">("all");
  const inv = useInvalidate();
  const toast = useToast();
  const staff = !!me && can(me.role, "item:edit");
  const openId = params.get("md");
  const setMd = (id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set("md", id);
        else n.delete("md");
        return n;
      },
      { replace: !id },
    );

  const list = useMemo(() => {
    const f = find.trim().toLowerCase();
    return (q.data ?? []).filter((a) => (cat === "all" || a.category === cat) && (!f || `${a.name} ${a.parent ?? ""} ${a.text} ${a.submittedBy}`.toLowerCase().includes(f)));
  }, [q.data, find, cat]);
  const opened = q.data?.find((a) => a.id === openId) ?? null;

  const remove = async (a: TrendAnalysis) => {
    if (!window.confirm(`Remove this trend analysis of ${a.name} (${localDateTime(a.submittedAt)}) from CI analyses?\n\nThe ${TREND_LEVEL_LABEL[a.level]} keeps the analysis it shows now.`)) return;
    try {
      await api(`/api/trend-analyses/${a.id}`, { method: "DELETE" });
      if (openId === a.id) setMd(null);
      await inv("trend-analyses");
      toast("Trend analysis removed");
    } catch (e) {
      toast(`Could not remove it · ${(e as ApiError).message}`, false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }} data-testid="trend-analyses">
      <section className="band" aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h1 id="page-title">{title}</h1>
          </div>
          <div className="band-copy">
            Every trend analysis submitted on the Input page, newest first. Each is a Markdown file with the columns {TREND_ANALYSIS_COLUMNS.category}, {TREND_ANALYSIS_COLUMNS.level},{" "}
            {TREND_ANALYSIS_COLUMNS.name} and {TREND_ANALYSIS_COLUMNS.text}, and the date of submission. The latest for a trend is the analysis shown on its Trend analysis subtab and in the knowledge
            graph.
          </div>
        </div>
      </section>
      <div className="content">
        {above}
        <section className="card flush" aria-labelledby="ta-list-title">
          <div className="table-top">
            <div>
              <h2 className="card-title" id="ta-list-title">
                CI analyses
              </h2>
              <span className="card-sub">{q.data ? `${list.length} of ${q.data.length} submitted · open the Markdown from the MD icon` : "Loading…"}</span>
            </div>
            <div className="tas-tools">
              <div className="seg" role="group" aria-label="Show trend analyses of">
                {(["all", "macrotrend", "competitor"] as const).map((k) => (
                  <button key={k} aria-pressed={cat === k} onClick={() => setCat(k)}>
                    {k === "all" ? "All" : `${TREND_CATEGORY_LABEL[k]}s`}
                  </button>
                ))}
              </div>
              <input className="control tas-find" type="search" placeholder="Find a trend, text or person…" aria-label="Find trend analyses" value={find} onChange={(e) => setFind(e.target.value)} />
              {staff && (
                <Link className="btn secondary small" to="/input">
                  + Input a trend analysis
                </Link>
              )}
            </div>
          </div>
          {q.isError && (
            <div className="err-msg" role="alert" style={{ margin: 20 }}>
              Could not load the trend analyses · {(q.error as Error).message}
            </div>
          )}
          <div ref={fitRef} className="table-wrap fit tas-wrap" tabIndex={0} role="region" aria-label="CI analyses (scrollable)">
            <table className="data tas-table" data-testid="trend-analyses-table">
              <caption className="sr-only">CI analyses</caption>
              <thead>
                <tr>
                  <th scope="col" className="md-col">
                    <span>Markdown</span>
                  </th>
                  <th scope="col">
                    <span>Date of submission</span>
                  </th>
                  <th scope="col">
                    <span>{TREND_ANALYSIS_COLUMNS.category}</span>
                  </th>
                  <th scope="col">
                    <span>{TREND_ANALYSIS_COLUMNS.level}</span>
                  </th>
                  <th scope="col">
                    <span>{TREND_ANALYSIS_COLUMNS.name}</span>
                  </th>
                  <th scope="col" className="tas-text-col">
                    <span>{TREND_ANALYSIS_COLUMNS.text}</span>
                  </th>
                  <th scope="col">
                    <span>Submitted by</span>
                  </th>
                  {staff && (
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td className="md-col">
                      <button className="src-btn open md-open" onClick={() => setMd(a.id)} aria-label={`Open the Markdown of the trend analysis of ${a.name}`} title="Open the Markdown file">
                        <MdIcon />
                      </button>
                    </td>
                    <td className="nowrap">{localDateTime(a.submittedAt)}</td>
                    <td>{TREND_CATEGORY_LABEL[a.category]}</td>
                    <td>{TREND_LEVEL_LABEL[a.level]}</td>
                    <td className="tas-name">
                      <b>{a.name}</b>
                      {a.level === "sub" && a.parent && <span>in {a.parent}</span>}
                    </td>
                    <td className="tas-text">
                      <div>{a.text}</div>
                    </td>
                    <td className="tas-by">
                      {a.submittedBy}
                      <span>{a.source === "import" ? `Imported · ${a.fileName ?? "spreadsheet"}` : "Input form"}</span>
                    </td>
                    {staff && (
                      <td>
                        <button
                          className="icon-btn"
                          onClick={() => void remove(a)}
                          aria-label={`Remove the trend analysis of ${a.name} from ${localDateTime(a.submittedAt)}`}
                          title="Remove from CI analyses"
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.data && !list.length && <div className="empty">{q.data.length ? "No trend analysis matches." : "No trend analyses yet. Submit one on the Input page (Input Trend Analysis)."}</div>}
        </section>
      </div>
      {opened && <TrendAnalysisMarkdownPane a={opened} onClose={() => setMd(null)} />}
    </div>
  );
}

/** A submission's Markdown file in the side pane, with Copy and Download at the top right. */
function TrendAnalysisMarkdownPane({ a, onClose }: { a: TrendAnalysis; onClose: () => void }) {
  const md = useTrendAnalysisMarkdown(a.id);
  const ref = useFocusTrap(true, onClose);
  const [tab, setTab] = useState<"raw" | "preview">("raw");
  const toast = useToast();
  const doc = md.data ? parseMarkdown(md.data) : null;
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer source-drawer md-pane tas-md" role="dialog" aria-modal="true" aria-labelledby="tas-md-title" ref={ref} data-testid="trend-analysis-md">
        <div className="drawer-head">
          <span className="drawer-meta">
            <span className="mono md-file" style={{ color: "var(--ink)" }}>
              Trend analysis · {TREND_LEVEL_LABEL[a.level]}
            </span>
            <span>·</span>
            <span>{localDateTime(a.submittedAt)}</span>
          </span>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
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
                void download(a).then(
                  (name) => toast(`Downloaded ${name}`),
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
          <h2 id="tas-md-title" className="source-drawer-title">
            {a.name}
          </h2>
        </div>
        <div className="md-pane-body">
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
          {doc && tab === "preview" && (
            <div className="md-preview">
              <FrontMatter lines={doc.fm} />
              {doc.sections.map((sec) => (
                <section key={sec.title}>
                  <h3>{sec.title}</h3>
                  {sec.body.split(/\n{2,}/).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
