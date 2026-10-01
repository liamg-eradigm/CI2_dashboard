import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { can, type Me } from "@eradigm/shared";
import { useItem } from "../api/hooks";
import { SnapshotActions, SnapshotFrame } from "../components/SnapshotFrame";
import { localDateTime } from "../lib/format";

/**
 * Full-window view of a saved source (opened in a new tab from the Inbox), so
 * the analyst can read the page side by side with the tracker draft.
 * The page is rendered inert in a sandboxed iframe.
 */
export function SourcePage({ me }: { me: Me }) {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const pageId = params.get("page");
  const staff = can(me.role, "inbox:read");
  const item = useItem(staff ? id : null);
  const d = item.data;
  useEffect(() => {
    document.title = `${d ? `${d.code} · ` : ""}Saved source · Eradigm Competitive Intelligence`;
  }, [d]);
  return (
    <div className="source-page">
      <header className="source-page-bar">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Saved source{d ? ` · ${d.code}` : ""}</span>
          <h1>{d?.title ?? "Saved copy of the page"}</h1>
          {d && (
            <div className="source-page-meta">
              <span className="mono">{d.url ?? "Uploaded HTML file"}</span>
              <span>Captured {localDateTime(d.receivedAt)}</span>
              {d.publicationDate && <span>Page publication date {d.publicationDate}</span>}
            </div>
          )}
        </div>
        <SnapshotActions itemId={id} code={d?.code ?? "source"} pageId={pageId} />
      </header>
      <SnapshotFrame itemId={id} pageId={pageId} title={`Saved source${d ? ` for ${d.code}` : ""}`} height="calc(100vh - 120px)" />
    </div>
  );
}
