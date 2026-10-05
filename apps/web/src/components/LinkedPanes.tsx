import { useEffect, useState, type ReactNode } from "react";
import { CORE, FIELDS, type SignalDetail } from "@eradigm/shared";
import { useSignal } from "../api/hooks";
import { formatDate } from "../lib/format";

type Which = "earlier" | "later";

/**
 * Two Primary entries from the same source (Source Role + Source Company),
 * side by side: the earlier on the left, the later on the right, each
 * scrolling on its own and labelled. Opened from either one; ‹ Earlier and
 * Later › walk along the entries from that source (request 27).
 */
export function LinkedPanes({ opened, render }: { opened: SignalDetail; render: (s: SignalDetail, titleId: string) => ReactNode }) {
  const start = (s: SignalDetail): [string, string] => (s.linkedEarlier ? [s.linkedEarlier, s.id] : [s.id, s.linkedLater ?? s.id]);
  const [pair, setPair] = useState<[string, string]>(() => start(opened));
  useEffect(() => setPair(start(opened)), [opened.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const older = useSignal(pair[0]);
  const newer = useSignal(pair[1]);
  const role = String(opened.values[FIELDS.sourceRole] ?? "").trim();
  const company = String(opened.values[FIELDS.sourceCompany] ?? "").trim();
  const earlierOf = older.data?.linkedEarlier;
  const laterOf = newer.data?.linkedLater;
  return (
    <div className="linked-wrap">
      {!pair.includes(opened.id) && (
        <h2 id="drawer-title" className="sr-only">
          {String(opened.values[CORE.title] ?? opened.code)}
        </h2>
      )}
      <p className="linked-note" data-testid="linked-note">
        <span aria-hidden="true">🔗 </span>
        <b>Linked: the same source</b>
        {role || company ? ` · ${[role, company].filter(Boolean).join(" at ")}` : ""}. The earlier entry is on the left, the later one on the right.
      </p>
      <div className="linked-panes" data-testid="linked-panes">
        <Pane which="earlier" sig={older.data} loading={older.isLoading} openedId={opened.id} render={render} nav={earlierOf ? () => setPair([earlierOf, pair[0]]) : null} />
        <Pane which="later" sig={newer.data} loading={newer.isLoading} openedId={opened.id} render={render} nav={laterOf ? () => setPair([pair[1], laterOf]) : null} />
      </div>
    </div>
  );
}

function Pane({
  which,
  sig,
  loading,
  openedId,
  render,
  nav,
}: {
  which: Which;
  sig: SignalDetail | undefined;
  loading: boolean;
  openedId: string;
  render: (s: SignalDetail, titleId: string) => ReactNode;
  nav: (() => void) | null;
}) {
  const label = which === "earlier" ? "Earlier entry" : "Later entry";
  const opened = sig?.id === openedId;
  return (
    <section className={`linked-pane ${which}`} aria-label={`${label}${sig ? `: ${String(sig.values[CORE.title] ?? sig.code)}` : ""}`} data-testid={`linked-${which}`}>
      <div className="linked-pane-head">
        <span className={`linked-badge ${which}`}>{label}</span>
        {sig && (
          <>
            <span className="mono">{sig.code}</span>
            <span>Event Date {formatDate(String(sig.values[CORE.date] ?? "")) || "—"}</span>
          </>
        )}
        {opened && <span className="tag info">Opened</span>}
        {nav && (
          <button className="link-btn linked-nav" onClick={nav}>
            {which === "earlier" ? "‹ Earlier from this source" : "Later from this source ›"}
          </button>
        )}
      </div>
      <div className="linked-pane-body" tabIndex={0} aria-label={`${label}, scrollable`}>
        {loading && <div className="skeleton" style={{ height: 160 }} />}
        {sig && render(sig, opened ? "drawer-title" : `linked-title-${which}`)}
      </div>
    </section>
  );
}
