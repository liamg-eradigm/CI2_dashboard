/**
 * The Primary / Secondary switch on the Database (and the Tracker and Phantoms)
 * tabs, kept in the URL (?stream=primary) so links and reloads keep it.
 * Secondary is the default.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { isStream, type Stream } from "@eradigm/shared";

export function useStreamParam(): [Stream, (s: Stream) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("stream");
  const stream: Stream = isStream(raw) ? raw : "secondary";
  const set = useCallback(
    (s: Stream) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (s === "secondary") p.delete("stream");
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
