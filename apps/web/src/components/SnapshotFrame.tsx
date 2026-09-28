import { useQuery } from "@tanstack/react-query";
import { request } from "../api/client";

/**
 * Renders a stored, sanitised source snapshot in a fully sandboxed iframe
 * (no scripts, no same-origin access). The HTML is fetched through the API
 * so authorisation is checked like any other request.
 */
export function SnapshotFrame({ itemId, title, height = 300 }: { itemId: string; title: string; height?: number }) {
  const q = useQuery({ queryKey: ["snapshot", itemId], queryFn: async () => (await request(`/api/items/${itemId}/snapshot`)).text(), staleTime: Infinity, retry: false });
  if (q.isLoading) return <div className="skeleton" style={{ height }} />;
  if (q.isError) return <div className="snapshot-none">Snapshot unavailable</div>;
  return <iframe className="snapshot-frame" style={{ height }} title={title} srcDoc={q.data} sandbox="" referrerPolicy="no-referrer" />;
}
