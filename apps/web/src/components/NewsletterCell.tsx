import { useEffect, useId, useRef, useState } from "react";

/** The Newsletter column's icon (request 43): a folded newspaper. */
export function NewspaperIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" data-icon="newspaper">
      <path d="M4 4h10.5a.5.5 0 0 1 .5.5V15a1.5 1.5 0 0 0 1.5 1.5H5.5A1.5 1.5 0 0 1 4 15V4Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M15 7.5h1.5a.5.5 0 0 1 .5.5v7a1.5 1.5 0 0 1-3 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="6.3" y="6.3" width="3.6" height="3" rx=".4" fill="currentColor" />
      <path d="M11.2 6.8h1.6M11.2 9h1.6M6.3 11.6h6.5M6.3 13.8h6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The Database page's Newsletter cell (request 43): the newsletters the entry
 * was used in. One opens straight away; with more, a menu to pick from
 * (newest first; each is named after when it was generated).
 */
export function NewsletterCell({ title, newsletters, onOpen }: { title: string; newsletters: { id: string; name: string; createdAt: string }[]; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  // Placed against the window: the table scrolls inside its own box, which would clip it.
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const toggle = (btn: HTMLElement) => {
    const r = btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom > 220;
    setAt({ left: Math.min(r.left, window.innerWidth - 300), ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
    setOpen((o) => !o);
  };
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    // Scrolling the table or the page moves the button away from the menu: close it.
    const onScroll = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onClick);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [open]);

  if (!newsletters.length)
    return (
      <span className="src-none" aria-label="In no newsletter" title="Tick entries, then Generate Newsletter">
        —
      </span>
    );
  const many = newsletters.length > 1;
  return (
    <div className="nl-cell" ref={ref}>
      <button
        className={`src-btn open nl-open${open ? " on" : ""}`}
        data-testid="newsletter-cell"
        onClick={(e) => (many ? toggle(e.currentTarget) : onOpen(newsletters[0]!.id))}
        aria-label={many ? `${newsletters.length} newsletters use ${title}: choose one` : `Open the newsletter ${newsletters[0]!.name}`}
        aria-haspopup={many ? "menu" : undefined}
        aria-expanded={many ? open : undefined}
        aria-controls={many && open ? menuId : undefined}
        title={many ? `${newsletters.length} newsletters` : newsletters[0]!.name}
      >
        <NewspaperIcon />
        {many && <span className="nl-count">{newsletters.length}</span>}
      </button>
      {open && (
        <div className="nl-menu" role="menu" id={menuId} aria-label={`Newsletters that use ${title}`} style={at}>
          {newsletters.map((n) => (
            <button
              key={n.id}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpen(n.id);
              }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
                const i = items.indexOf(e.currentTarget);
                items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
              }}
            >
              <b>{n.name}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
