import { useSearchParams } from "react-router-dom";
import { type Me, type Stream } from "@eradigm/shared";
import { useStreamParam } from "../state/stream";
import { TrackerPage } from "./TrackerPage";
import { TrendAnalysesPage } from "./TrendAnalysesPage";

type Pick = Stream | "ci";

/** Primary / Secondary (the same switch as the other tables) and CI Analysis. */
function DatabaseSwitch({ value, onChange }: { value: Pick; onChange: (v: Pick) => void }) {
  const opts: [Pick, string][] = [
    ["primary", "Primary Tracker"],
    ["secondary", "Secondary Tracker"],
    ["ci", "CI Analysis"],
  ];
  return (
    <div className="seg stream-switch" role="group" aria-label="Database to show">
      {opts.map(([k, label]) => (
        <button key={k} aria-pressed={value === k} onClick={() => onChange(k)} data-testid={k === "ci" ? "db-ci" : `stream-${k}`}>
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
 * CI Analysis is the CI analyses database as it is (no filters).
 */
export function DatabasePage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const [stream, setStream] = useStreamParam();
  const ci = params.get("db") === "ci";
  const go = (v: Pick) => {
    if (v !== "ci" && !ci) return setStream(v);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        // Open panels and paging belong to the table being left.
        for (const k of ["page", "md", "signal", "edit", "saved", "savedPage", "docx", "all"]) p.delete(k);
        if (v === "ci") p.set("db", "ci");
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
  const toggle = <DatabaseSwitch value={ci ? "ci" : stream} onChange={go} />;
  if (ci) return <TrendAnalysesPage me={me} title="Database" eyebrow="Every database in one place" above={<div className="stream-bar">{toggle}</div>} />;
  return <TrackerPage key="database" me={me} view="database" title="Database" switcher={toggle} />;
}
