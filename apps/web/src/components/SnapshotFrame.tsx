import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../api/client";
import { useFocusTrap } from "./RecordDrawer";

/**
 * Renders a stored, sanitised source snapshot in a fully sandboxed iframe
 * (no scripts, no same-origin access). The HTML is fetched through the API
 * so authorisation is checked like any other request.
 */
export function SnapshotFrame({ itemId, title, height = 300 }: { itemId: string; title: string; height?: number | string }) {
  const q = useQuery({ queryKey: ["snapshot", itemId], queryFn: async () => (await request(`/api/items/${itemId}/snapshot`)).text(), staleTime: Infinity, retry: false });
  if (q.isLoading) return <div className="skeleton" style={{ height }} />;
  if (q.isError) return <div className="snapshot-none">Snapshot unavailable</div>;
  return <iframe className="snapshot-frame" style={{ height }} title={title} srcDoc={q.data} sandbox="" referrerPolicy="no-referrer" />;
}

/** "Open in new tab" and "Download HTML" for a saved source. */
export function SnapshotActions({ itemId, code }: { itemId: string; code: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await request(`/api/items/${itemId}/snapshot?download=1`);
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
      <a className="link-btn" href={`/source/${itemId}`} target="_blank" rel="noopener">
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
export function SourceDrawer({ itemId, code, title, onClose }: { itemId: string; code: string; title: string; onClose: () => void }) {
  const ref = useFocusTrap(true, onClose);
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
            <span>Saved source page</span>
          </span>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <SnapshotActions itemId={itemId} code={code} />
            <button className="icon-btn" onClick={onClose} aria-label="Close saved page" data-autofocus>
              ✕
            </button>
          </div>
          <h2 id="source-drawer-title" className="source-drawer-title">
            {title}
          </h2>
        </div>
        <SnapshotFrame itemId={itemId} title={`Saved source page for ${code}`} height="100%" />
      </div>
    </>
  );
}
