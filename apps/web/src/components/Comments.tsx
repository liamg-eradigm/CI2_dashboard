/**
 * Word-style comments on an entry's text. Highlight some text and a small
 * "Comment" button appears; type the comment and it is attached to the
 * highlighted words (shown marked, numbered, with the comment beside it).
 * Keyboard: each field also has a "Comment" button, which comments on the
 * highlighted text in that field (or on the whole field).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MAX_COMMENT_LENGTH, type ItemComment } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useInvalidate } from "../api/hooks";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";

export interface Anchor {
  comment: ItemComment;
  /** Where the quote is now (the text may have changed since), or null if it is no longer there. */
  at: [number, number] | null;
}

/** Find each comment's highlighted words in the current text (its saved position, else the nearest copy). */
export function anchor(text: string, comments: ItemComment[]): Anchor[] {
  return comments.map((c) => {
    if (text.slice(c.start, c.end) === c.quote) return { comment: c, at: [c.start, c.end] };
    let best = -1;
    for (let i = text.indexOf(c.quote); i >= 0; i = text.indexOf(c.quote, i + 1)) if (best < 0 || Math.abs(i - c.start) < Math.abs(best - c.start)) best = i;
    return { comment: c, at: best >= 0 ? [best, best + c.quote.length] : null };
  });
}

/** Character offset of (node, offset) within `root`'s text. */
function offsetIn(root: Node, node: Node, offset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = 0;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t === node) return n + offset;
    n += t.textContent?.length ?? 0;
  }
  // `node` is an element: count the text before its offset-th child.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const r = document.createRange();
    r.setStart(root, 0);
    r.setEnd(node, offset);
    return r.toString().length;
  }
  return n;
}

type Sel = { start: number; end: number; quote: string; rect: DOMRect };

/** The field's text with its comments highlighted; select text to add one (when allowed). */
export function CommentableText({
  itemId,
  field,
  label,
  text,
  comments,
  numberOf,
  canComment,
  placeholder = "—",
}: {
  itemId: string;
  field: string;
  label: string;
  text: string;
  comments: ItemComment[];
  /** The comment's number on the entry (shared with the margin). */
  numberOf: (id: string) => number;
  canComment: boolean;
  placeholder?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [writing, setWriting] = useState<Sel | null>(null);
  const anchors = useMemo(() => anchor(text, comments).filter((a) => a.at && !a.comment.resolved), [text, comments]);

  // Split the text into plain runs and highlighted runs (overlaps: the earlier comment wins).
  const runs = useMemo(() => {
    const out: { s: string; c: ItemComment | null }[] = [];
    let pos = 0;
    for (const a of [...anchors].sort((x, y) => x.at![0] - y.at![0])) {
      const [s, e] = a.at!;
      if (s < pos) continue;
      if (s > pos) out.push({ s: text.slice(pos, s), c: null });
      out.push({ s: text.slice(s, e), c: a.comment });
      pos = e;
    }
    if (pos < text.length) out.push({ s: text.slice(pos), c: null });
    return out;
  }, [anchors, text]);

  const readSelection = (): Sel | null => {
    const s = window.getSelection();
    const root = box.current;
    if (!s || s.isCollapsed || !root || !s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
    let start = offsetIn(root, r.startContainer, r.startOffset);
    let end = offsetIn(root, r.endContainer, r.endOffset);
    // Trim surrounding spaces, like Word.
    while (start < end && /\s/.test(text[start] ?? "")) start++;
    while (end > start && /\s/.test(text[end - 1] ?? "")) end--;
    if (end <= start) return null;
    return { start, end, quote: text.slice(start, end), rect: r.getBoundingClientRect() };
  };
  const onSelect = () => {
    if (!canComment || writing) return;
    setSel(readSelection());
  };
  useEffect(() => {
    if (!sel) return;
    const clear = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".ct-pop")) setSel(null);
    };
    document.addEventListener("mousedown", clear);
    return () => document.removeEventListener("mousedown", clear);
  }, [sel]);

  const start = (s: Sel | null) => {
    const whole = { start: 0, end: text.length, quote: text, rect: box.current!.getBoundingClientRect() };
    setWriting(s ?? (text.trim() ? whole : null));
    setSel(null);
  };

  return (
    <div className="ct">
      <div className="ct-head">
        <span className="dlabel">{label}</span>
        {canComment && text.trim() && (
          <button className="link-btn ct-add" onMouseDown={(e) => e.preventDefault()} onClick={() => start(readSelection())} aria-label={`Comment on ${label}`} title="Comment on the highlighted text (or the whole field)">
            ＋ Comment
          </button>
        )}
      </div>
      <div ref={box} className={`ct-text${text ? "" : " empty"}`} onMouseUp={onSelect} onKeyUp={onSelect} data-field={field}>
        {text
          ? runs.map((r, i) =>
              r.c ? (
                <mark key={i} className="ct-mark" data-n={numberOf(r.c.id)} title={`${r.c.author}: ${r.c.body}`}>
                  {r.s}
                </mark>
              ) : (
                <span key={i}>{r.s}</span>
              ),
            )
          : placeholder}
      </div>
      {sel && !writing && (
        <button className="ct-pop ct-float" style={{ top: sel.rect.top - 40, left: Math.max(8, sel.rect.left + sel.rect.width / 2 - 50) }} onMouseDown={(e) => e.preventDefault()} onClick={() => start(sel)}>
          💬 Comment
        </button>
      )}
      {writing && <CommentBox itemId={itemId} field={field} sel={writing} onDone={() => setWriting(null)} />}
    </div>
  );
}

/** Type a comment for the highlighted words. */
function CommentBox({ itemId, field, sel, onDone }: { itemId: string; field: string; sel: Sel; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const inv = useInvalidate();
  const toast = useToast();
  useLayoutEffect(() => {
    const w = 320;
    setPos({ top: Math.min(window.innerHeight - 220, sel.rect.bottom + 8), left: Math.max(8, Math.min(window.innerWidth - w - 8, sel.rect.left)) });
  }, [sel]);
  const save = async () => {
    if (!body.trim()) return setErr("Write a comment first.");
    setBusy(true);
    try {
      await api(`/api/items/${itemId}/comments`, { method: "POST", json: { field, start: sel.start, end: sel.end, quote: sel.quote, body: body.trim() } });
      await inv("comments", "client-inbox", "items");
      toast("Comment added");
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  };
  return (
    <div className="ct-pop ct-box" role="dialog" aria-label="Add a comment" ref={ref} style={{ top: pos.top, left: pos.left }}>
      <blockquote>“{sel.quote.length > 140 ? `${sel.quote.slice(0, 137)}…` : sel.quote}”</blockquote>
      <label className="sr-only" htmlFor={`ct-${itemId}-${field}`}>
        Comment
      </label>
      <textarea
        id={`ct-${itemId}-${field}`}
        value={body}
        maxLength={MAX_COMMENT_LENGTH}
        rows={3}
        autoFocus
        placeholder="Your comment…"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
        }}
      />
      {err && (
        <p className="err-msg" role="alert">
          {err}
        </p>
      )}
      <div className="ct-box-actions">
        <button className="btn secondary small" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button className="btn small" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Comment"}
        </button>
      </div>
    </div>
  );
}

/**
 * The comments on an entry, in the margin (like Word): numbered, with the
 * highlighted words, who wrote it and when. Eradigm can resolve them; authors
 * can delete their own. `onShow` jumps to the words in the field.
 */
export function CommentsMargin({
  itemId,
  comments,
  labelOf,
  numberOf,
  canResolve,
  onShow,
  title = "Comments",
}: {
  itemId: string;
  comments: ItemComment[];
  labelOf: (field: string) => string;
  numberOf: (id: string) => number;
  canResolve: boolean;
  onShow?: (c: ItemComment) => void;
  title?: string;
}) {
  const inv = useInvalidate();
  const toast = useToast();
  const [showResolved, setShowResolved] = useState(false);
  const open = comments.filter((c) => !c.resolved);
  const shown = showResolved ? comments : open;
  const act = async (c: ItemComment, method: "PATCH" | "DELETE") => {
    try {
      await api(`/api/items/${itemId}/comments/${c.id}`, { method, ...(method === "PATCH" ? { json: { resolved: !c.resolved } } : {}) });
      await inv("comments", "items", "client-inbox");
      toast(method === "DELETE" ? "Comment deleted" : c.resolved ? "Comment reopened" : "Comment resolved");
    } catch (e) {
      toast((e as ApiError).message, false);
    }
  };
  if (!comments.length) return null;
  return (
    <aside className="ct-margin" aria-label={title} data-testid="comments">
      <div className="ct-margin-head">
        <b>
          {title} · {open.length} open
        </b>
        {comments.length > open.length && (
          <button className="link-btn" onClick={() => setShowResolved((s) => !s)}>
            {showResolved ? "Hide resolved" : `Show ${comments.length - open.length} resolved`}
          </button>
        )}
      </div>
      <ol>
        {shown.map((c) => (
          <li key={c.id} className={`ct-card${c.resolved ? " resolved" : ""}`}>
            <div className="ct-card-head">
              <span className="ct-n" aria-hidden="true">
                {numberOf(c.id)}
              </span>
              <b>{c.author}</b>
              <span>
                {c.authorRole === "client" ? "Client" : "Eradigm"} · {localDateTime(c.at)}
              </span>
            </div>
            <button className="ct-quote" onClick={() => onShow?.(c)} disabled={!onShow} title={onShow ? "Show the highlighted text" : undefined}>
              <span className="ct-field">{labelOf(c.field)}</span> “{c.quote.length > 160 ? `${c.quote.slice(0, 157)}…` : c.quote}”
            </button>
            <p className="ct-body">{c.body}</p>
            {c.resolved && (
              <span className="ct-resolved">
                ✓ Resolved by {c.resolved.by} · {localDateTime(c.resolved.at)}
              </span>
            )}
            <div className="ct-card-actions">
              {canResolve && (
                <button className="link-btn" onClick={() => void act(c, "PATCH")}>
                  {c.resolved ? "Reopen" : "✓ Resolve"}
                </button>
              )}
              {c.mine && (
                <button className="link-btn danger" onClick={() => void act(c, "DELETE")} aria-label={`Delete comment ${numberOf(c.id)}`}>
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

/** Comment numbers in reading order (field order, then position). */
export function useCommentNumbers(comments: ItemComment[], fieldOrder: string[]) {
  return useMemo(() => {
    const idx = new Map(fieldOrder.map((f, i) => [f, i]));
    const sorted = [...comments].sort((a, b) => (idx.get(a.field) ?? 999) - (idx.get(b.field) ?? 999) || a.start - b.start || a.at.localeCompare(b.at));
    const n = new Map(sorted.map((c, i) => [c.id, i + 1]));
    return { sorted, numberOf: (id: string) => n.get(id) ?? 0 };
  }, [comments, fieldOrder]);
}
