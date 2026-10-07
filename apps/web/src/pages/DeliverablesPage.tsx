import { useSearchParams } from "react-router-dom";
import type { Me } from "@eradigm/shared";
import { NewslettersCard } from "../components/Deliverables";
import { TrackerPage } from "./TrackerPage";

type Tab = "alerts" | "newsletter";

/**
 * Deliverables: Alerts and Newsletters built from Phantoms, switched with the
 * central toggle. Both tables are the Phantoms table (same columns, Markdown
 * and saved page); Alerts add each entry's .docx alert, and the Newsletter
 * page lists the newsletters created so far above the entries to build from.
 */
export function DeliverablesPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("d") === "newsletter" ? "newsletter" : "alerts";
  const go = (t: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const k of ["page", "md", "saved", "docx", "signal", "sort", "dir"]) n.delete(k);
        if (t === "alerts") n.delete("d");
        else n.set("d", t);
        return n;
      },
      { replace: false },
    );
  const toggle = (
    <div className="deliv-switch">
      <div className="seg deliv-seg" role="group" aria-label="Deliverable">
        <button aria-pressed={tab === "alerts"} onClick={() => go("alerts")} data-testid="deliv-alerts">
          Alerts
        </button>
        <button aria-pressed={tab === "newsletter"} onClick={() => go("newsletter")} data-testid="deliv-newsletter">
          Newsletter
        </button>
      </div>
    </div>
  );
  return (
    <TrackerPage
      key={tab}
      me={me}
      view={tab}
      title="Deliverables"
      above={
        <>
          {toggle}
          {tab === "newsletter" && <NewslettersCard me={me} />}
        </>
      }
    />
  );
}
