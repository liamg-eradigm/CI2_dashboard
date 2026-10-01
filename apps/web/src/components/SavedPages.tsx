import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MAX_SAVED_PAGES, type SavedPage } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useInvalidate } from "../api/hooks";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";

/** An entry's saved HTML pages, first page first. */
export const useSavedPages = (itemId: string | null, enabled = true) =>
  useQuery({ queryKey: ["pages", itemId], queryFn: () => api<SavedPage[]>(`/api/items/${itemId}/snapshots`), enabled: !!itemId && enabled, staleTime: 30_000 });

/** Upload an HTML file to an entry: its first page, or another page for its list. */
export function useAttachPage(entry: { id: string; code: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const inv = useInvalidate();
  const upload = async (f: File | null) => {
    if (!f) return;
    if (!/\.html?$/i.test(f.name)) return toast("Only .html or .htm files are accepted", false);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api<{ pages: number }>(`/api/items/${entry.id}/snapshot`, { method: "POST", body: fd });
      toast(r.pages > 1 ? `Page ${r.pages} attached to ${entry.code}` : `Saved page attached to ${entry.code}`);
      await inv("tracker", "signal", "pages");
    } catch (e) {
      toast(`Could not attach the page · ${(e as ApiError).message}`, false);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };
  const input = <input ref={ref} type="file" accept=".html,.htm,text/html" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void upload(e.target.files?.[0] ?? null)} />;
  return { input, pick: () => ref.current?.click(), busy };
}

export function PageIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M5 2.5h6.5L15.5 6.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11.5 2.5v4h4M7 10h6M7 13h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The saved-page icon of a Tracker / Phantoms row. One page: opens it. Several:
 * the icon extends into a list to pick the page from (and, for analysts and
 * admins, to attach another).
 */
export function SavedPagesButton({
  entry,
  pages,
  canAttach,
  onOpen,
}: {
  entry: { id: string; code: string; title: string };
  pages: number;
  canAttach: boolean;
  onOpen: (pageId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const attach = useAttachPage(entry);
  if (pages <= 1) {
    return (
      <button className="src-btn open" onClick={() => onOpen(null)} aria-label={`Open saved page for ${entry.title}`} title="Open the saved page">
        <PageIcon />
      </button>
    );
  }
  return (
    <>
      {attach.input}
      <button
        ref={btn}
        className={`src-btn open multi${open ? " on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${pages} saved pages for ${entry.title}: choose one`}
        title={`${pages} saved pages · choose one`}
        data-testid="pages-menu-button"
      >
        <PageIcon />
        <span className="src-count" aria-hidden="true">
          {pages}
        </span>
        <span className="src-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <PagesMenu
          anchor={btn}
          entry={entry}
          onClose={() => setOpen(false)}
          onOpen={(id) => {
            setOpen(false);
            onOpen(id);
          }}
          extra={
            canAttach && pages < MAX_SAVED_PAGES ? (
              <button
                role="menuitem"
                className="pages-add"
                disabled={attach.busy}
                onClick={() => {
                  setOpen(false);
                  attach.pick();
                }}
              >
                ＋ Attach another HTML page
              </button>
            ) : null
          }
        />
      )}
    </>
  );
}

/** The list of an entry's pages, under its button (fixed position, so a table's scroll box cannot clip it). */
function PagesMenu({
  anchor,
  entry,
  onClose,
  onOpen,
  extra,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  entry: { id: string; title: string };
  onClose: () => void;
  onOpen: (pageId: string) => void;
  extra: ReactNode;
}) {
  const q = useSavedPages(entry.id);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = 320;
      setPos({ top: Math.min(r.bottom + 6, window.innerHeight - 60), left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        anchor.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);
  useEffect(() => {
    if (q.data) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [q.data]);
  if (!pos) return null;
  return (
    <div className="pages-menu" role="menu" aria-label={`Saved pages of ${entry.title}`} ref={menu} style={{ top: pos.top, left: pos.left }} data-testid="pages-menu">
      <div className="pages-menu-head">Saved pages</div>
      {q.isLoading && <div className="pages-menu-note">Loading…</div>}
      {q.isError && <div className="pages-menu-note err-msg">Could not load the pages.</div>}
      {q.data?.map((p, i) => (
        <button key={p.id} role="menuitem" className="pages-item" onClick={() => onOpen(p.id)}>
          <span className="pages-n" aria-hidden="true">
            {i + 1}
          </span>
          <span className="pages-name">
            <b>{p.name}</b>
            <span>
              {p.first ? "First page · " : ""}
              {localDateTime(p.savedAt)}
            </span>
          </span>
        </button>
      ))}
      {extra}
    </div>
  );
}
