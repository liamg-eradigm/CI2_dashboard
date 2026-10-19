/**
 * Epilepsy → News (request 61): the Primary and Secondary news from the
 * workbook (sheets “2. Platform Primary” and “1. Platform Secondary”), as CI
 * SQUARED's Database trackers show them: filters, sortable columns, a row
 * opening all its fields, and for Primary the Full Discussion (the other
 * answers of the same conversation: same Source Company, Source Role and
 * Event Date) and the KIQ Archive (earlier answers from the same source to
 * the same Insight Topic and KIQ) beside the table.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EPI_PRIMARY_FIELDS, EPI_SECONDARY_FIELDS, normaliseHeader, type Me } from "@eradigm/shared";
import { StreamSwitch } from "../../../components/StreamSwitch";
import { useEpilepsyData } from "../api/hooks";
import { EpiTable, UrlLink, cellText, type EpiColumn } from "../components/EpiTable";
import { Filters, distinct } from "../components/Filters";
import { PageHead } from "../components/PageHead";
import { FieldList, SidePanel } from "../components/SidePanel";
import { acceptedFor, isoDate, records, showDate, type Rec } from "../model";

type Stream = "primary" | "secondary";
const DATE: Record<Stream, string> = { primary: "Event Date", secondary: "Date of News Article" };
const FILTERS: Record<Stream, string[]> = {
  primary: ["Source Company", "Source Role", "Insight Topic", "KIQ", "Source Confidence", "Employee Status"],
  secondary: ["Article Topic"],
};
const LONG = new Set(["Key Details", "CI Perspective", "KIQ"].map(normaliseHeader));
const columnsOf = (stream: Stream): EpiColumn[] =>
  (stream === "primary" ? EPI_PRIMARY_FIELDS : EPI_SECONDARY_FIELDS).map((name) => ({
    name,
    kind: /date/i.test(name) ? "date" : name === "URL" ? "url" : LONG.has(normaliseHeader(name)) ? "long" : name === "Article Title" ? "title" : "plain",
    width: LONG.has(normaliseHeader(name)) ? 340 : name === "Article Title" ? 260 : /date/i.test(name) ? 120 : 150,
  }));

/** Full Discussion (request 42): a speech bubble. */
function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" data-icon="chat">
      <path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3.6 2.8v-2.8H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 8.2h7M6.5 10.8h4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** KIQ Archive (request 42): a link. */
function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" data-icon="link">
      <path d="M8.2 11.8a3.2 3.2 0 0 0 4.5 0l2.6-2.6a3.2 3.2 0 0 0-4.5-4.5l-1 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11.8 8.2a3.2 3.2 0 0 0-4.5 0l-2.6 2.6a3.2 3.2 0 0 0 4.5 4.5l1-1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const k = (v: string) => normaliseHeader(v);
const sameSource = (a: Rec, b: Rec) => k(a.get("Source Company")) === k(b.get("Source Company")) && k(a.get("Source Role")) === k(b.get("Source Role")) && !!(a.get("Source Company") || a.get("Source Role"));
/** The rest of an answer's conversation: same source and Event Date. */
const discussionOf = (all: Rec[], r: Rec) => all.filter((o) => o.i !== r.i && sameSource(o, r) && o.get("Event Date") === r.get("Event Date"));
/** Earlier answers from the same source to the same Insight Topic and KIQ. */
const archiveOf = (all: Rec[], r: Rec) =>
  all.filter((o) => o.i !== r.i && sameSource(o, r) && k(o.get("Insight Topic")) === k(r.get("Insight Topic")) && k(o.get("KIQ")) === k(r.get("KIQ")) && !!r.get("KIQ") && (o.get("Event Date") || "") < (r.get("Event Date") || ""));

export function NewsPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const stream: Stream = params.get("news") === "secondary" ? "secondary" : "primary";
  const data = useEpilepsyData();
  const sheet = data.data?.sheets[stream];
  const all = useMemo(() => records(sheet), [sheet]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<Rec | null>(null);
  const [arch, setArch] = useState<{ r: Rec; mode: "source" | "kiq" } | null>(null);
  const columns = columnsOf(stream);
  const filters = FILTERS[stream];

  const setStream = (s: Stream) => {
    const p = new URLSearchParams(params);
    if (s === "primary") p.delete("news");
    else p.set("news", s);
    setParams(p, { replace: true });
    setPicked({});
    setOpen(null);
    setArch(null);
  };

  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((r) => {
      for (const [name, vals] of Object.entries(picked)) if (vals.length && !vals.includes(r.get(name))) return false;
      const d = isoDate(r.get(DATE[stream])) ?? "";
      if (from && (!d || d < from)) return false;
      if (to && (!d || d > to)) return false;
      if (words.length) {
        const text = columns.map((c) => r.get(c.name)).join(" ").toLowerCase();
        if (!words.every((w) => text.includes(w))) return false;
      }
      return true;
    });
  }, [all, picked, q, from, to, stream, columns]);

  const extra =
    stream === "primary"
      ? [
          {
            header: <span>Full Discussion</span>,
            className: "arch-col",
            cell: (r: Rec) => {
              const n = discussionOf(all, r).length;
              if (!n) return null;
              const on = arch?.r.i === r.i && arch.mode === "source";
              return (
                <button
                  className={`icon-btn arch-btn${on ? " on" : ""}`}
                  aria-pressed={on}
                  aria-label={`Full Discussion: the ${n} other ${n === 1 ? "answer" : "answers"} of the same conversation`}
                  title="Full Discussion · the other answers of the same conversation (same source and Event Date)"
                  onClick={() => setArch(on ? null : { r, mode: "source" })}
                >
                  <ChatIcon />
                </button>
              );
            },
          },
          {
            header: <span>KIQ Archive</span>,
            className: "arch-col",
            cell: (r: Rec) => {
              const n = archiveOf(all, r).length;
              if (!n) return null;
              const on = arch?.r.i === r.i && arch.mode === "kiq";
              return (
                <button
                  className={`icon-btn arch-btn${on ? " on" : ""}`}
                  aria-pressed={on}
                  aria-label={`KIQ Archive: ${n} earlier ${n === 1 ? "answer" : "answers"} from the same source to the same KIQ`}
                  title="KIQ Archive · earlier answers from the same source, Insight Topic and Key Intelligence Question"
                  onClick={() => setArch(on ? null : { r, mode: "kiq" })}
                >
                  <LinkIcon />
                </button>
              );
            },
          },
        ]
      : undefined;

  const linked = arch ? (arch.mode === "kiq" ? archiveOf(all, arch.r) : discussionOf(all, arch.r)) : [];
  const sorted = { name: DATE[stream], dir: "desc" as const };

  return (
    <>
      <PageHead me={me} title="News" intro="Primary research and secondary news on epilepsy, from the project's workbook. Open a row for all its fields." />
      <div className="content">
        <div className="stream-bar">
          <StreamSwitch noun="News" value={stream} onChange={(s) => setStream(s as Stream)} label="News to show" />
          <span className="stream-note">{stream === "primary" ? "From “2. Platform Primary”" : "From “1. Platform Secondary”"}</span>
        </div>
        <Filters
          search={q}
          onSearch={setQ}
          choices={filters.map((name) => ({ name, options: distinct([...all.map((r) => r.get(name)), ...acceptedFor(data.data, stream, name)]), value: picked[name] ?? [] }))}
          onChoice={(name, v) => setPicked((p) => ({ ...p, [name]: v }))}
          onClear={() => {
            setQ("");
            setPicked({});
            setFrom("");
            setTo("");
          }}
        >
          <label className="field epi-date">
            <span>{DATE[stream]} from</span>
            <input className="control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field epi-date">
            <span>to</span>
            <input className="control" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </Filters>
        <div className={arch ? "arch-split" : undefined} data-testid={arch ? "arch-split" : undefined}>
          <section className="card flush pop-host" aria-label={`${stream === "primary" ? "Primary" : "Secondary"} news`}>
            <div className="table-top">
              <div className="ptr-head">
                <h2 className="card-title">{stream === "primary" ? "Primary News" : "Secondary News"}</h2>
                <span className="card-sub info" aria-live="polite">
                  {data.isLoading ? "Loading…" : !sheet ? "This sheet has not been read from the workbook yet" : `Showing ${rows.length} of ${all.length}`}
                </span>
              </div>
            </div>
            <EpiTable key={stream} rows={rows} columns={columns} label={`${stream} news`} initialSort={sorted} onOpen={setOpen} openIndex={open?.i} extra={extra} testId={`news-${stream}`} />
          </section>
          {arch && (
            <section className="card flush arch-panel" aria-labelledby="arch-title" data-testid="archived-panel">
              <div className="table-top">
                <div>
                  <h2 className="card-title" id="arch-title">
                    {arch.mode === "kiq" ? "KIQ Archive" : "Full Discussion"}
                  </h2>
                  <span className="card-sub">
                    {[arch.r.get("Source Role"), arch.r.get("Source Company")].filter(Boolean).join(" · ")} ·{" "}
                    {arch.mode === "kiq"
                      ? `${linked.length} earlier ${linked.length === 1 ? "answer" : "answers"} from the same source to the same Insight Topic and KIQ`
                      : `${linked.length} other ${linked.length === 1 ? "answer" : "answers"} in the same conversation (${showDate(arch.r.get("Event Date"))})`}
                  </span>
                </div>
                <button className="icon-btn" onClick={() => setArch(null)} aria-label={`Close ${arch.mode === "kiq" ? "KIQ Archive" : "Full Discussion"}`} title="Close">
                  ✕
                </button>
              </div>
              <EpiTable rows={linked} columns={columns} label={arch.mode === "kiq" ? "KIQ Archive" : "Full Discussion"} initialSort={sorted} onOpen={setOpen} openIndex={open?.i} />
            </section>
          )}
        </div>
      </div>
      {open && sheet && (
        <SidePanel
          title={stream === "primary" ? [open.get("Source Company"), open.get("Source Role")].filter(Boolean).join(" · ") || "Primary answer" : open.get("Article Title") || "News article"}
          sub={<span>{showDate(open.get(DATE[stream]))}</span>}
          onClose={() => setOpen(null)}
          testId="news-panel"
        >
          <FieldList
            fields={sheet.columns.filter(Boolean).map((name) => {
              const v = cellText(open, { name, kind: /date/i.test(name) ? "date" : "plain" });
              return { name, value: !v ? "" : k(name) === "url" ? <UrlLink v={v} /> : <span className="epi-text">{v}</span> };
            })}
          />
        </SidePanel>
      )}
    </>
  );
}
