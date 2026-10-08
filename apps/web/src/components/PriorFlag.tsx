import { Link } from "react-router-dom";
import { PRIOR_PRIMARY_TEXT, type PrimarySource } from "@eradigm/shared";
import { formatDate } from "../lib/format";

/** A Primary entry from a source already in the Primary Tracker: flagged, and linked to those entries once pushed. */
export function PriorFlag({ code, role, company, prior }: { code: string; role: string; company: string; prior: PrimarySource[] }) {
  const latest = prior[0]!;
  return (
    <div className="prior-flag" role="note" aria-labelledby={`prior-${code}`} data-testid="prior-flag">
      <span className="prior-icon" aria-hidden="true">
        🔗
      </span>
      <div style={{ minWidth: 0 }}>
        <b id={`prior-${code}`}>{PRIOR_PRIMARY_TEXT}</b>
        <p>
          {role.trim()} at {company.trim()} · {prior.length === 1 ? "1 entry" : `${prior.length} entries`} from this source in the Primary Tracker, the latest {latest.code} “{latest.title}”
          {latest.date ? ` (${formatDate(latest.date)})` : ""}. Once pushed, this entry is linked to them (🔗 in the Primary Tracker and Phantoms).{" "}
          <Link to={`/database?stream=primary&signal=${encodeURIComponent(latest.id)}`} target="_blank" rel="noopener">
            Open {latest.code} in the Database ↗
          </Link>
        </p>
      </div>
    </div>
  );
}
