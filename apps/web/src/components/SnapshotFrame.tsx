import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../api/client";

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
