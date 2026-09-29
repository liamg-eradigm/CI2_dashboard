/**
 * The Primary / Secondary switch on the Inbox, Tracker and Phantoms tabs,
 * kept in the URL (?stream=secondary) so links and reloads keep it.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { isStream, type Stream } from "@eradigm/shared";

export function useStreamParam(): [Stream, (s: Stream) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("stream");
  const stream: Stream = isStream(raw) ? raw : "primary";
  const set = useCallback(
    (s: Stream) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (s === "primary") p.delete("stream");
          else p.set("stream", s);
          // Filters and sort carry over (both streams start with the same options); paging and open panels do not.
          for (const k of [...p.keys()]) if (k === "page" || k === "signal" || k === "md") p.delete(k);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [stream, set];
}
