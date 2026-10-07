import { useEffect, useRef, useState } from "react";
import { CORE, displayValue, tableColumns, type MegatrendEntry } from "@eradigm/shared";
import { useSchema, useSignal } from "../../api/hooks";
import { formatDate } from "../../lib/format";
import { useSavedPages } from "../SavedPages";
import { impactColour } from "./model";
import { useIsNewSignal } from "./newSignals";

/** Open an entry's saved page in a popup window (the app's sandboxed source view). */
export function openSourcePopup(itemId: string, pageId: string | null = null) {
  const url = `/source/${itemId}${pageId ? `?page=${encodeURIComponent(pageId)}` : ""}`;
  const w = Math.min(1180, Math.round(window.screen.availWidth * 0.8));
  const h = Math.min(900, Math.round(window.screen.availHeight * 0.85));
  window.open(url, `eradigm-source-${itemId}${pageId ? `-${pageId}` : ""}`, `popup=yes,width=${w},height=${h},left=${Math.round((window.screen.availWidth - w) / 2)},top=40`);
}

/** The sources list of a Subtrend or competitor: shown when it is selected, until ✕ hides it (for that selection). */
export function useSourcesList(key: string | null) {
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  return {
    shown: !!key && hiddenFor !== key,
    hide: () => setHiddenFor(key),
    show: () => setHiddenFor(null),
  };
}

export interface SourcesList {
  /** The Subtrend or competitor. */
  title: string;
  /** Its entries, in list order (by Impact, High first: `bySourceOrder`). */
  entries: MegatrendEntry[];
  shown: boolean;
  onShow: () => void;
  onHide: () => void;
}

/**
 * The drawer that slides in from the right (Megatrends and Competitors).
 *
 * - Sources: selecting a Subtrend or a competitor lists its entries, High
 *   Impact first, each row an Impact dot and as much of the title as fits.
 *   ✕ (or Esc) hides it; "Signals" at the right edge brings it back.
 * - Entry: an opened entry's Tracker row (its Tracker columns, in the
 *   Tracker's order) with its saved page(s) in a popup window. ← (or Esc)
 *   goes back to the sources list, keeping its place; ✕ closes the drawer.
 */
export function EntrySheet({
  entry,
  colour,
  position,
  onClose,
  onStep,
  sources = null,
  onOpen,
  onBack,
  stepIn = "on the timeline",
}: {
  entry: MegatrendEntry | null;
  colour: string;
  position: { index: number; total: number } | null;
  /** ✕ on an entry: closes the drawer (the sources list too). */
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  sources?: SourcesList | null;
  onOpen?: (id: string) => void;
  /** ← on an entry: back to the sources list. */
  onBack?: () => void;
  /** Where ‹ › step: "on the timeline" or "in the sources list". */
  stepIn?: string;
}) {
  // Keep showing the last entry while the drawer slides away.
  const [shown, setShown] = useState<MegatrendEntry | null>(entry);
  useEffect(() => {
    if (entry) setShown(entry);
  }, [entry]);
  const listing = !entry && !!sources?.shown;
  const open = !!entry || listing;
  const canBack = !!sources && !!onBack;
  const e = entry ?? shown;
  const signal = useSignal(e?.id ?? null);
  const schema = useSchema(e?.stream ?? "primary");
  const isNew = useIsNewSignal();
  const hasPage = !!signal.data?.hasSnapshot;
  const pages = useSavedPages(e?.id ?? null, hasPage && (signal.data?.pages ?? 0) > 1);
  const head = useRef<HTMLHeadingElement>(null);
  const listHead = useRef<HTMLHeadingElement>(null);
  const listBox = useRef<HTMLUListElement>(null);
  // Back in the list: focus the row of the entry just read.
  const lastRead = useRef<string | null>(null);
  const listScroll = useRef(0);
  useEffect(() => {
    if (entry) {
      lastRead.current = entry.id;
      head.current?.focus({ preventScroll: true });
    } else if (listing) {
      if (listBox.current) listBox.current.scrollTop = listScroll.current;
      const row = lastRead.current ? listBox.current?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(lastRead.current)}"]`) : null;
      (row ?? listHead.current)?.focus({ preventScroll: true });
    }
  }, [entry, entry?.id, listing]);
  // A new Subtrend or competitor: its list starts at the top.
  useEffect(() => {
    lastRead.current = null;
    listScroll.current = 0;
    if (listBox.current) listBox.current.scrollTop = 0;
  }, [sources?.title]);
  const keys = useRef({ entry, listing, canBack, onBack, onClose, sources });
  keys.current = { entry, listing, canBack, onBack, onClose, sources };
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      const k = keys.current;
      if (k.entry) return k.canBack ? k.onBack?.() : k.onClose();
      if (k.listing) k.sources?.onHide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const cols = schema.data ? tableColumns(schema.data, "tracker").filter((c) => c.key !== CORE.title) : [];
  const values = signal.data?.values;
  const many = (pages.data?.length ?? 0) > 1;

  return (
    <>
      {sources && !sources.shown && !entry && sources.entries.length > 0 && (
        <button className="mg-sources-open" onClick={sources.onShow} data-testid="mg-sources-open" aria-label={`Show the signals of ${sources.title}`}>
          ☰ Signals <span className="ct">{sources.entries.length}</span>
        </button>
      )}
      <aside className={`mg-drawer${open ? " open" : ""}`} data-testid="mg-sheet" aria-hidden={!open} aria-label={listing ? "Signals" : "Signal"} inert={!open}>
        {sources && (
          <div className="mg-sources" hidden={!listing} data-testid="mg-sources">
            <header className="mg-sheet-head">
              <div className="mg-sheet-meta">
                <span className="mg-pages-label">Signals</span>
                <span>{sources.entries.length} · by Impact, high to low</span>
              </div>
              <h2 ref={listHead} tabIndex={-1}>
                {sources.title}
              </h2>
              <div className="mg-sheet-ctl">
                <button className="mg-icon" onClick={sources.onHide} aria-label="Close the signals list" title="Close (Esc)">
                  ✕
                </button>
              </div>
            </header>
            {sources.entries.length === 0 ? (
              <p className="mg-hint">No signals.</p>
            ) : (
              <ul className="mg-source-list" ref={listBox} aria-label={`Signals of ${sources.title}`}>
                {sources.entries.map((x) => (
                  <li key={x.id}>
                    <button
                      data-id={x.id}
                      onClick={() => {
                        listScroll.current = listBox.current?.scrollTop ?? 0;
                        onOpen?.(x.id);
                      }}
                      title={`${x.title || x.code} · ${formatDate(x.date)}`}
                    >
                      <span className="dot" style={{ background: impactColour(x.impact) }} aria-hidden="true" />
                      <span className="sr-only">{x.impact ? `${x.impact} impact: ` : "No impact: "}</span>
                      <span className="nm">{x.title || x.code}</span>
                      {(isNew(x.date) || x.ci) && (
                        <span className="mg-tags">
                          {isNew(x.date) && (
                            <span className="mg-new-tag" data-testid="new-tag" title="A new signal: its Event Date is recent">
                              New
                            </span>
                          )}
                          {x.ci && (
                            <span className="mg-ci-tag" data-testid="ci-tag" title="This signal's Phantom has a CI Perspective">
                              CI Perspective
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {e && !listing && (
          <>
            {/* Request 36: the title beside the Impact dot (no ID); the stream, date and place below it. */}
            <header className="mg-sheet-head entry">
              <div className="mg-sheet-titlebar">
                {canBack && (
                  <button className="mg-icon sm mg-back" onClick={onBack} aria-label={`Back to the signals of ${sources!.title}`} title="Back to the signals (Esc)" data-testid="mg-back">
                    ←
                  </button>
                )}
                <span className="dot" style={{ background: colour }} aria-hidden="true" />
                <h2 ref={head} tabIndex={-1}>
                  {e.title || e.code}
                </h2>
              </div>
              <div className="mg-sheet-meta">
                <span className={`mg-stream ${e.stream}`}>{e.stream === "primary" ? "Primary" : "Secondary"}</span>
                <span>{formatDate(e.date)}</span>
                {position && (
                  <span className="mg-pos">
                    {position.index + 1} of {position.total}
                  </span>
                )}
              </div>
              <div className="mg-sheet-ctl">
                <button className="mg-icon" onClick={() => onStep(-1)} disabled={!position || position.index === 0} aria-label={`Previous entry ${stepIn}`} title="Previous entry">
                  ‹
                </button>
                <button className="mg-icon" onClick={() => onStep(1)} disabled={!position || position.index >= position.total - 1} aria-label={`Next entry ${stepIn}`} title="Next entry">
                  ›
                </button>
                <button className="mg-icon" onClick={onClose} aria-label="Close entry" title="Close (Esc)">
                  ✕
                </button>
              </div>
            </header>
            {/* One scroll for the whole signal, so its CI Perspective never covers the fields. */}
            <div className="mg-entry-body" tabIndex={0} aria-label="Signal details">
              {signal.data && (
                <div className="mg-pages">
                  {!hasPage ? (
                    <span className="mg-hint">No saved page attached.</span>
                  ) : many ? (
                    <>
                      <span className="mg-pages-label">Saved pages</span>
                      {pages.data!.map((p, i) => (
                        <button key={p.id} className="mg-btn ghost sm" onClick={() => openSourcePopup(e.id, p.first ? null : p.id)} title={`Open ${p.name} in a popup window`}>
                          ⧉ {i + 1}. {p.name}
                        </button>
                      ))}
                    </>
                  ) : (
                    <button className="mg-btn sm" onClick={() => openSourcePopup(e.id)} data-testid="mg-open-page">
                      ⧉ Open saved page
                    </button>
                  )}
                </div>
              )}
              <dl className="mg-fields">
                {signal.isError && <p className="mg-err">Could not load this entry.</p>}
                {!values &&
                  !signal.isError &&
                  Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="mg-field skel">
                      <dt>&nbsp;</dt>
                      <dd>&nbsp;</dd>
                    </div>
                  ))}
                {values &&
                  cols.map((c) => {
                    const text = displayValue(c, values[c.key]) || "—";
                    return (
                      <div key={c.key} className={`mg-field${c.type === "long" ? " long" : ""}`}>
                        <dt>{c.label}</dt>
                        <dd>{text}</dd>
                      </div>
                    );
                  })}
              </dl>
              {signal.data?.ciPerspective && (
                <section className="mg-ci" aria-labelledby="mg-ci-title" data-testid="mg-ci">
                  <h3 id="mg-ci-title">
                    <span className="mg-ci-orb" aria-hidden="true" /> CI Perspective
                  </h3>
                  <div className="mg-ci-text" tabIndex={0} aria-label="CI Perspective (scrolls)">
                    <p>{signal.data.ciPerspective}</p>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
