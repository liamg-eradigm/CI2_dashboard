import { useSearchParams } from "react-router-dom";
import { type Me, type Stream } from "@eradigm/shared";
import { useNewsletters } from "../api/hooks";
import { DocxPane, NewslettersCard } from "../components/Deliverables";
import { useStreamParam } from "../state/stream";
import { TrackerPage } from "./TrackerPage";
import { TrendAnalysesPage } from "./TrendAnalysesPage";

type Pick = Stream | "ci" | "newsletters";

/** Primary / Secondary (the same switch as the other tables), CI Analysis and (request 52) Newsletter. */
function DatabaseSwitch({ value, onChange }: { value: Pick; onChange: (v: Pick) => void }) {
  const opts: [Pick, string, string][] = [
    ["primary", "Primary Tracker", "stream-primary"],
    ["secondary", "Secondary Tracker", "stream-secondary"],
    ["ci", "CI Analysis", "db-ci"],
    ["newsletters", "Newsletter", "db-newsletters"],
  ];
  return (
    <div className="seg stream-switch" role="group" aria-label="Database to show">
      {opts.map(([k, label, testId]) => (
        <button key={k} aria-pressed={value === k} onClick={() => onChange(k)} data-testid={testId}>
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Database (request 43): the Signals Database, Phantoms Database, CI analyses
 * and Deliverables on one page. Primary and Secondary show every Tracker
 * entry with all its fields, its saved page, Markdown, alert and newsletters;
 * CI Analysis is the CI analyses database as it is (no filters); Newsletter
 * (request 52, moved from Admin → Deliverables) lists the newsletters made
 * with Generate Newsletter, to open, download or delete.
 */
export function DatabasePage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const [stream, setStream] = useStreamParam();
  const which = params.get("db");
  const other: Pick | null = which === "ci" || which === "newsletters" ? which : null;
  const go = (v: Pick) => {
    if (v !== "ci" && v !== "newsletters" && !other) return setStream(v);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        // Open panels and paging belong to the table being left.
        for (const k of ["page", "md", "signal", "edit", "saved", "savedPage", "docx", "all"]) p.delete(k);
        if (v === "ci" || v === "newsletters") p.set("db", v);
        else {
          p.delete("db");
          if (v === "secondary") p.delete("stream");
          else p.set("stream", v);
        }
        return p;
      },
      { replace: false },
    );
  };
  const toggle = <DatabaseSwitch value={other ?? stream} onChange={go} />;
  if (other === "ci") return <TrendAnalysesPage me={me} title="Database" eyebrow="Every database in one place" above={<div className="stream-bar">{toggle}</div>} />;
  if (other === "newsletters") return <NewslettersDatabase me={me} toggle={toggle} />;
  return <TrackerPage key="database" me={me} view="database" title="Database" switcher={toggle} />;
}

/** Database → Newsletter: every newsletter, newest first; each opens as a side pane (download there) or is deleted. */
function NewslettersDatabase({ me, toggle }: { me: Me; toggle: React.ReactNode }) {
  const [params, setParams] = useSearchParams();
  const q = useNewsletters();
  const open = params.get("docx");
  const shown = open ? q.data?.find((n) => n.id === open) : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column" }} data-testid="db-newsletters-page">
      <section className="band" aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">Every database in one place</span>
            <h1 id="page-title">Database</h1>
          </div>
          <div className="band-copy">
            Every newsletter made with Generate Newsletter (tick two or more entries on the Primary or Secondary Tracker), newest first. Open one to read or download it.
          </div>
        </div>
      </section>
      <div className="content">
        <div className="stream-bar">{toggle}</div>
        <NewslettersCard me={me} />
      </div>
      {open && (
        <DocxPane
          id={open}
          kind="Newsletter"
          title={shown?.name ?? "Newsletter"}
          onClose={() =>
            setParams(
              (p) => {
                const n = new URLSearchParams(p);
                n.delete("docx");
                return n;
              },
              { replace: true },
            )
          }
        />
      )}
    </div>
  );
}
