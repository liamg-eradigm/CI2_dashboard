import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../api/client";
import { MAX_SAVED_PAGES } from "@eradigm/shared";
import { useFocusTrap } from "./RecordDrawer";
import { useAttachPage, useSavedPages } from "./SavedPages";

/**
 * Renders a stored, sanitised source snapshot in a fully sandboxed iframe
 * (no scripts, no same-origin access). The HTML is fetched through the API
 * so authorisation is checked like any other request.
 */
export function SnapshotFrame({ itemId, pageId = null, title, height = 300 }: { itemId: string; pageId?: string | null; title: string; height?: number | string }) {
  const q = useQuery({
    queryKey: ["snapshot", itemId, pageId],
    queryFn: async () => (await request(`/api/items/${itemId}/snapshot${pageId ? `?page=${encodeURIComponent(pageId)}` : ""}`)).text(),
    staleTime: Infinity,
    retry: false,
  });
  if (q.isLoading) return <div className="skeleton" style={{ height }} />;
  if (q.isError) return <div className="snapshot-none">Snapshot unavailable</div>;
  return <iframe className="snapshot-frame" style={{ height }} title={title} srcDoc={q.data} sandbox="" referrerPolicy="no-referrer" />;
}

/** "Open in new tab" and "Download HTML" for a saved source (one of its pages, if given). */
export function SnapshotActions({ itemId, code, pageId = null }: { itemId: string; code: string; pageId?: string | null }) {
  const pageQs = pageId ? `page=${encodeURIComponent(pageId)}` : "";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await request(`/api/items/${itemId}/snapshot?download=1${pageQs ? `&${pageQs}` : ""}`);
      if (!res.ok) throw new Error("Snapshot unavailable");
      const url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${code}-source.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="snap-actions">
      <a className="link-btn" href={`/source/${itemId}${pageQs ? `?${pageQs}` : ""}`} target="_blank" rel="noopener">
        Open saved page in new tab<span aria-hidden="true"> ↗</span>
      </a>
      <button className="link-btn" onClick={download} disabled={busy}>
        {busy ? "Downloading…" : "Download HTML"}
      </button>
      {err && (
        <span className="err-msg" role="alert">
          {err}
        </span>
      )}
    </span>
  );
}

/**
 * Side pane showing a tracker entry's saved source page: the whole pane is the
 * (sandboxed, scrollable) page itself, under a slim header.
 */
export function SourceDrawer({
  itemId,
  pageId = null,
  pages = 1,
  canAttach = false,
  code,
  title,
  onPage,
  onClose,
}: {
  itemId: string;
  pageId?: string | null;
  /** How many saved pages the entry has (more than one: a page picker in the header). */
  pages?: number;
  canAttach?: boolean;
  code: string;
  title: string;
  onPage?: (pageId: string | null) => void;
  onClose: () => void;
}) {
  const ref = useFocusTrap(true, onClose);
  const list = useSavedPages(itemId, pages > 1);
  const attach = useAttachPage({ id: itemId, code });
  const current = list.data?.find((p) => p.id === pageId) ?? list.data?.[0];
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer source-drawer" role="dialog" aria-modal="true" aria-labelledby="source-drawer-title" ref={ref}>
        <div className="drawer-head">
          <span className="drawer-meta">
            <span className="mono" style={{ color: "var(--ink)" }}>
              {code}
            </span>
            <span>·</span>
            <span>{pages > 1 ? `Saved page ${list.data ? list.data.findIndex((p) => p.id === current?.id) + 1 : 1} of ${pages}` : "Saved source page"}</span>
          </span>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {pages > 1 && list.data && (
              <label className="page-pick">
                <span className="sr-only">Saved page</span>
                <select className="control" value={current?.id ?? ""} onChange={(e) => onPage?.(e.target.value === list.data?.[0]?.id ? null : e.target.value)}>
                  {list.data.map((p, i) => (
                    <option key={p.id} value={p.id}>
                      {i + 1}. {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <SnapshotActions itemId={itemId} code={code} pageId={pageId} />
            {canAttach && pages < MAX_SAVED_PAGES && (
              <>
                {attach.input}
                <button className="link-btn" onClick={attach.pick} disabled={attach.busy} title="Upload another saved HTML page for this entry">
                  {attach.busy ? "Attaching…" : "＋ Attach another page"}
                </button>
              </>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="Close saved page" data-autofocus>
              ✕
            </button>
          </div>
          <h2 id="source-drawer-title" className="source-drawer-title">
            {title}
          </h2>
        </div>
        <SnapshotFrame key={pageId ?? "first"} itemId={itemId} pageId={pageId} title={`Saved source page for ${code}${current && pages > 1 ? `: ${current.name}` : ""}`} height="100%" />
      </div>
    </>
  );
}
