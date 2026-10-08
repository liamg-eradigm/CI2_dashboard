import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { can, type DiscussionSummary, type Me } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useDiscussionSummary } from "../api/hooks";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";
import { BulletText } from "./BulletText";
import { RICH_HINT, RichTextField } from "./RichTextField";
import { SizedHeading } from "./TextSize";

/** Request 44: keep the box stuck to the bottom of the sticky filter bar, whatever its height. */
function useStickUnderFilters() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>(".filterbar");
    const el = ref.current;
    if (!bar || !el) return;
    const place = () => {
      el.style.top = `${Math.round(bar.getBoundingClientRect().height)}px`;
    };
    place();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    ro?.observe(bar);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);
  return ref;
}

/** Remembered per viewer (a convenience only: without storage it starts at its natural height). */
const HEIGHT_KEY = "eradigm.ptr.aiSummaryHeight";
const MIN_HEIGHT = 96;
/** The smallest box an edit happens in (a few lines, the hint and the buttons). */
const EDIT_MIN_HEIGHT = 240;
/** The smallest height the table's rows keep when the summary is dragged taller (the table fills the rest). */
const TABLE_ROOM = 160;
const readHeight = () => {
  try {
    const v = Number(window.localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(v) && v >= MIN_HEIGHT ? v : null;
  } catch {
    return null;
  }
};
const storeHeight = (h: number | null) => {
  try {
    if (h == null) window.localStorage.removeItem(HEIGHT_KEY);
    else window.localStorage.setItem(HEIGHT_KEY, String(Math.round(h)));
  } catch {
    /* storage unavailable: the height lasts for this visit */
  }
};

/**
 * Request 45: drag the bottom edge of the AI Summary (or use the arrow keys on
 * it) to make it taller or shorter; the table below takes the rest of the
 * window. Double-click goes back to its natural height.
 */
function useResizableHeight(box: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState<number | null>(readHeight);
  // As tall as leaves the table (its top bar, pager and at least its smallest height) on screen below it.
  const max = () => {
    const el = box.current;
    if (!el) return MIN_HEIGHT;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const scroll = document.querySelector<HTMLElement>('.ptr-content [data-testid="table-scroll"]');
    const card = scroll?.closest<HTMLElement>(".card");
    const room = scroll && card ? card.getBoundingClientRect().height - scroll.getBoundingClientRect().height + TABLE_ROOM : TABLE_ROOM;
    return Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - top - room));
  };
  const clamp = (h: number) => Math.round(Math.min(max(), Math.max(MIN_HEIGHT, h)));
  const set = (h: number | null) => {
    const v = h == null ? null : clamp(h);
    setHeight(v);
    storeHeight(v);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !box.current) return;
    e.preventDefault();
    const startY = e.clientY;
    const start = box.current.getBoundingClientRect().height;
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    // No page scrollbar while dragging (the table follows the summary in the same frame).
    document.body.classList.add("resizing-rows");
    document.documentElement.classList.add("resizing-rows");
    const move = (ev: PointerEvent) => setHeight(clamp(start + ev.clientY - startY));
    const up = (ev: PointerEvent) => {
      grip.releasePointerCapture(ev.pointerId);
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing-rows");
      document.documentElement.classList.remove("resizing-rows");
      storeHeight(clamp(start + ev.clientY - startY));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const cur = height ?? box.current?.getBoundingClientRect().height ?? MIN_HEIGHT;
    const step = e.shiftKey ? 96 : 24;
    const next = e.key === "ArrowUp" ? cur - step : e.key === "ArrowDown" ? cur + step : e.key === "Home" ? MIN_HEIGHT : e.key === "End" ? max() : null;
    if (next == null) return;
    e.preventDefault();
    set(next);
  };
  return { height, reset: () => set(null), onPointerDown, onKeyDown, max };
}

const NAME = { source: "Full Discussion", kiq: "KIQ Archive" } as const;

/**
 * Analytics → Primary Tracker's AI Summary (request 43), above the table: the
 * summary of the open Full Discussion or KIQ Archive, in large type. Written
 * by the AI writer once the Claude API is connected (following the
 * instructions in Administration); admins can write or change it by hand.
 * Request 44: it stays attached to the bottom of the sticky filter bar, and
 * keeps line breaks and nested bullets (Tab / Shift+Tab while editing).
 * Request 45: the table is attached to its bottom edge, which is dragged to
 * resize it (the table takes the rest of the window).
 */
export function DiscussionSummaryBox({ me, id, mode, source }: { me: Me; id: string | null; mode: "source" | "kiq"; source?: string }) {
  const q = useDiscussionSummary(id, mode);
  const qc = useQueryClient();
  const toast = useToast();
  const admin = can(me.role, "settings:edit");
  const [editing, setEditing] = useState(false);
  // Request 47: editing keeps the box at the height it had (its text scrolls inside), however long the text.
  const [editHeight, setEditHeight] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setEditing(false), [id, mode]);
  useEffect(() => {
    if (!editing) setEditHeight(null);
  }, [editing]);
  const s = q.data;
  const stick = useStickUnderFilters();
  const size = useResizableHeight(stick);

  const save = async (text: string) => {
    if (!id) return;
    setBusy(true);
    try {
      const next = await api<DiscussionSummary>(`/api/signals/${id}/summary`, { method: "PUT", json: { mode, text } });
      qc.setQueryData(["signal", id, "summary", mode], next);
      setEditing(false);
      toast(text ? "AI Summary saved" : "AI Summary removed");
    } catch (e) {
      toast(`Could not save it · ${(e as ApiError).message}`, false);
    } finally {
      setBusy(false);
    }
  };
  const regenerate = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const next = await api<DiscussionSummary>(`/api/signals/${id}/summary/generate`, { method: "POST", json: { mode } });
      qc.setQueryData(["signal", id, "summary", mode], next);
      toast("AI Summary written again");
    } catch (e) {
      toast((e as ApiError).message, false);
    } finally {
      setBusy(false);
    }
  };

  const meta = !s?.text
    ? null
    : s.source === "ai"
      ? `Written by AI${s.model ? ` (${s.model})` : ""} from ${s.entries} ${s.entries === 1 ? "answer" : "answers"} · ${localDateTime(s.updatedAt)}`
      : `Written by ${s.updatedBy ?? "an admin"} · ${localDateTime(s.updatedAt)}`;

  return (
    <section
      className={`ai-summary${id ? "" : " idle"}${(size.height ?? editHeight) != null ? " sized" : ""}`}
      aria-labelledby="ai-summary-title"
      data-testid="ai-summary"
      data-sticky-under=""
      ref={stick}
      style={(size.height ?? editHeight) != null ? { height: size.height ?? editHeight! } : undefined}
    >
      <div className="ai-summary-head">
        <div>
          <SizedHeading className="card-title" id="ai-summary-title" sizeKey="heading:ai-summary" label="AI Summary heading">
            <span className="ai-spark" aria-hidden="true">
              ✦
            </span>{" "}
            AI Summary{id ? ` · ${NAME[mode]}` : ""}
          </SizedHeading>
          {id && (
            <span className="card-sub">
              {[source, s ? `${s.entries} ${s.entries === 1 ? "answer" : "answers"}` : null, meta].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
        {id && admin && !editing && s && (
          <div className="ai-summary-actions">
            {s.aiConnected && (
              <button className="btn secondary small" disabled={busy} onClick={() => void regenerate()}>
                ✦ Write again with AI
              </button>
            )}
            <button
              className="btn secondary small"
              disabled={busy}
              onClick={() => {
                setDraft(s.text ?? "");
                // At least room for a few lines, the hint and the buttons.
                if (size.height == null && stick.current) setEditHeight(Math.max(EDIT_MIN_HEIGHT, Math.round(stick.current.getBoundingClientRect().height)));
                setEditing(true);
              }}
            >
              {s.text ? "Edit" : "Write the summary"}
            </button>
          </div>
        )}
      </div>
      {!id ? (
        <p className="ai-summary-text muted">Open a Full Discussion (chat icon) or KIQ Archive (link icon) in the table below to read the summary of that discussion here.</p>
      ) : editing ? (
        <div className="ai-summary-edit">
          <RichTextField id="ai-summary-draft" className="control" value={draft} onValueChange={setDraft} autoFocus rows={5} aria-label={`AI Summary of this ${NAME[mode]}`} aria-describedby="ai-summary-hint" />
          <span className="list-hint" id="ai-summary-hint">
            {RICH_HINT} · Enter starts a new line
          </span>
          <div className="ai-summary-actions">
            <button className="btn small" disabled={busy || !draft.trim()} onClick={() => void save(draft.trim())}>
              Save
            </button>
            <button className="btn secondary small" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            {s?.text && (
              <button className="link-btn danger" disabled={busy} onClick={() => void save("")}>
                Remove the summary
              </button>
            )}
          </div>
        </div>
      ) : q.isLoading ? (
        <p className="ai-summary-text muted" aria-live="polite">
          Loading the summary…
        </p>
      ) : q.isError ? (
        <p className="err-msg" role="alert">
          Could not load the summary · {(q.error as Error).message}
        </p>
      ) : s?.text ? (
        <>
          {s.stale && (
            <p className="ai-summary-stale" role="note">
              The discussion has changed since this summary was written.{admin && s.aiConnected ? " Write it again with AI, or edit it." : admin ? " Edit it to bring it up to date." : ""}
            </p>
          )}
          <BulletText className="ai-summary-text" testId="ai-summary-text" text={s.text} />
        </>
      ) : (
        <p className="ai-summary-text muted">
          {s?.error
            ? admin
              ? s.error
              : "The summary could not be written just now. Try again later."
            : s?.aiConnected
              ? "No summary yet."
              : `No summary yet. Once the Claude API is connected, the AI writer summarises each ${NAME[mode]} here automatically.${admin ? " Until then, an admin can write it by hand." : ""}`}
        </p>
      )}
      <div
        className="ai-summary-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the AI Summary (drag, or use the arrow keys; double-click for its natural height)"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={Math.round(size.max())}
        aria-valuenow={Math.round(size.height ?? stick.current?.getBoundingClientRect().height ?? MIN_HEIGHT)}
        tabIndex={0}
        onPointerDown={size.onPointerDown}
        onKeyDown={size.onKeyDown}
        onDoubleClick={size.reset}
        data-testid="ai-summary-grip"
        title="Drag to resize · double-click for the natural height"
      >
        <span aria-hidden="true" />
      </div>
    </section>
  );
}
