import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { NEWSLETTER_SECTIONS, NEWSLETTER_SECTION_LABEL, can, type Me, type Newsletter, type NewsletterSection } from "@eradigm/shared";
import { api, request, type ApiError } from "../api/client";
import { useInvalidate, useNewsletters } from "../api/hooks";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";
import { useFocusTrap } from "./RecordDrawer";
import { useFitToScreen } from "../lib/fitToScreen";

/** Save a stored alert or newsletter .docx. Returns the file name. */
export async function downloadDocx(id: string): Promise<string> {
  const res = await request(`/api/deliverables/${id}/docx?download=1`);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "deliverable.docx";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M4 5.5h12M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.5l.8 10.6a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.8-10.6M8.5 8.5v5.5M11.5 8.5v5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The document icon used for .docx deliverables (same button style as the MD and saved-page icons). */
export function DocxButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="src-btn open docx-open" onClick={onClick} aria-label={label} title="Open the .docx">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path d="M5 2.5h6.5L15.5 6.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M11.5 2.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <text x="10" y="14.6" textAnchor="middle" fontSize="4.6" fontWeight="700" fontFamily="sans-serif" fill="currentColor">
          DOC
        </text>
      </svg>
    </button>
  );
}

/**
 * Side pane showing a stored .docx, like the saved-page and Markdown panes:
 * the whole pane is the document (rendered in the browser, scrollable), with
 * Download at the top right.
 */
export function DocxPane({ id, title, kind, onClose }: { id: string; title: string; kind: string; onClose: () => void }) {
  const ref = useFocusTrap(true, onClose);
  const host = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [changed, setChanged] = useState(false);
  const [reload, setReload] = useState(0);
  /** Request 51: select text in the document, then make it bold or larger / smaller (this view only). */
  const format = (what: "bold" | "larger" | "smaller") => {
    const el = host.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.isCollapsed || !sel.rangeCount || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      toast("Select text in the document first", false);
      return;
    }
    if (what === "bold") {
      el.contentEditable = "true";
      document.execCommand("bold");
      el.contentEditable = "false";
    } else {
      const range = sel.getRangeAt(0);
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as Element) : range.startContainer.parentElement;
      const px = Number.parseFloat(getComputedStyle(start ?? el).fontSize) || 14;
      const k = what === "larger" ? 1.15 : 1 / 1.15;
      const size = (n: number) => `${Math.max(6, Math.round(n * k * 10) / 10)}px`;
      const span = document.createElement("span");
      span.style.fontSize = size(px);
      const part = range.extractContents();
      // The document's own runs carry their sizes: scale those too.
      part.querySelectorAll<HTMLElement>("*").forEach((n) => {
        const own = Number.parseFloat(n.style.fontSize);
        if (own) n.style.fontSize = size(own * (n.style.fontSize.endsWith("pt") ? 4 / 3 : 1));
      });
      span.appendChild(part);
      range.insertNode(span);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(span);
      sel.addRange(r);
    }
    setChanged(true);
  };
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const [state, setState] = useState<{ loading: boolean; fileName?: string; error?: string }>({ loading: true });
  useEffect(() => {
    let gone = false;
    setState({ loading: true });
    void (async () => {
      try {
        const res = await request(`/api/deliverables/${id}/docx`);
        const fileName = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
        const buf = await res.arrayBuffer();
        // Loaded on first use, so the rest of the dashboard does not carry the renderer.
        const { renderAsync } = await import("docx-preview");
        if (gone || !host.current) return;
        host.current.replaceChildren();
        await renderAsync(buf, host.current, undefined, { className: "docx", inWrapper: true, breakPages: true, useBase64URL: true, renderHeaders: true, renderFooters: true });
        // The templates' logos are decoration: the text says what they say.
        host.current.querySelectorAll("img:not([alt])").forEach((img) => img.setAttribute("alt", ""));
        if (!gone) setState({ loading: false, fileName });
      } catch (e) {
        if (!gone) setState({ loading: false, error: (e as Error).message || "Could not open the document" });
      }
    })();
    return () => {
      gone = true;
    };
  }, [id, reload]);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer source-drawer docx-pane" role="dialog" aria-modal="true" aria-labelledby="docx-title" ref={ref}>
        <div className="drawer-head">
          <span className="drawer-meta">
            <span className="mono" style={{ color: "var(--ink)" }}>
              {state.fileName ?? "….docx"}
            </span>
            <span>·</span>
            <span>{kind}</span>
          </span>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="fmt-bar docx-fmt" role="toolbar" aria-label="Format the selected text in this view" data-testid="docx-format">
              <button type="button" className="fmt-btn b" onMouseDown={keep} onClick={() => format("bold")} aria-label="Bold" title="Bold (select text first)" data-testid="docx-bold">
                B
              </button>
              <button type="button" className="fmt-btn small" onMouseDown={keep} onClick={() => format("smaller")} aria-label="Smaller text" title="Smaller text" data-testid="docx-smaller">
                A−
              </button>
              <button type="button" className="fmt-btn big" onMouseDown={keep} onClick={() => format("larger")} aria-label="Larger text" title="Larger text" data-testid="docx-larger">
                A+
              </button>
              {changed && (
                <button
                  type="button"
                  className="fmt-btn"
                  onClick={() => {
                    setChanged(false);
                    setReload((n) => n + 1);
                  }}
                  title="Show the document as generated"
                >
                  Reset
                </button>
              )}
            </span>
            <button
              className="link-btn"
              onClick={() =>
                void downloadDocx(id).then(
                  (name) => toast(`Downloaded ${name}`),
                  (e: Error) => toast(`Download failed · ${e.message}`, false),
                )
              }
            >
              Download .docx
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close document" data-autofocus>
              ✕
            </button>
          </div>
          <h2 id="docx-title" className="source-drawer-title">
            {title}
          </h2>
        </div>
        {changed && (
          <p className="docx-note" role="status">
            Formatting changes show here only; Download gives the document as generated.
          </p>
        )}
        <div className="docx-body" aria-label={`${kind}: ${title}`} role="document" tabIndex={0}>
          {state.loading && <div className="skeleton" style={{ height: 320, margin: 24 }} />}
          {state.error && (
            <p className="err-msg" role="alert" style={{ margin: 24 }}>
              {state.error}
            </p>
          )}
          <div ref={host} className="docx-host" />
        </div>
      </div>
    </>
  );
}

export interface DeliverableTarget {
  /** The stored deliverable's ID. */
  id: string;
  code?: string;
  label: string;
}

/**
 * Confirm deleting alerts or newsletters (request 36). An alert's entry leaves
 * the Alerts table and gets no new alert; its Phantom stays. One request each
 * (soft delete, audited).
 */
export function DeleteDeliverables({ kind, items, onCancel, onDone }: { kind: "alert" | "newsletter"; items: DeliverableTarget[]; onCancel: () => void; onDone: (deletedIds: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const trap = useFocusTrap(true, busy ? () => undefined : onCancel);
  const toast = useToast();
  const inv = useInvalidate();
  const n = items.length;
  const noun = kind === "alert" ? (n === 1 ? "alert" : "alerts") : n === 1 ? "newsletter" : "newsletters";
  const run = async () => {
    setBusy(true);
    setErr(null);
    const deleted: string[] = [];
    for (const it of items) {
      try {
        await api(`/api/deliverables/${it.id}`, { method: "DELETE" });
        deleted.push(it.id);
        setDone(deleted.length);
      } catch (x) {
        setErr(`Stopped at ${it.code || it.label}: ${(x as ApiError).message}. ${deleted.length} of ${n} deleted.`);
        break;
      }
    }
    await inv("tracker", "newsletters");
    if (deleted.length === n) toast(n === 1 ? `Deleted ${kind === "alert" ? "the alert" : "newsletter"} “${items[0]?.label}”` : `Deleted ${n} ${noun}`);
    setBusy(false);
    onDone(deleted);
  };
  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div className="modal delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dd-title" aria-describedby="dd-desc" ref={trap} data-testid="delete-deliverables">
        <b id="dd-title">
          Delete {n === 1 ? `this ${noun}` : `${n} ${noun}`}?
        </b>
        <p id="dd-desc">
          {kind === "alert"
            ? `${n === 1 ? "The entry leaves" : "The entries leave"} the Alerts table and ${n === 1 ? "gets" : "get"} no new alert. ${n === 1 ? "Its Phantom stays" : "Their Phantoms stay"} in the Phantoms Database and the Newsletter table.`
            : `The ${noun} ${n === 1 ? "and its .docx are" : "and their .docx files are"} removed for everyone. The Phantoms ${n === 1 ? "it was" : "they were"} built from stay.`}{" "}
          This cannot be undone from the dashboard; the audit log keeps a record.
        </p>
        <ul className="bulk-del-list">
          {items.map((it) => (
            <li key={it.id}>
              {it.code && <span className="mono">{it.code}</span>} {it.label}
            </li>
          ))}
        </ul>
        {err && (
          <div className="err-msg" role="alert">
            ✕ {err}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn secondary" disabled={busy} onClick={onCancel} data-autofocus>
            Cancel
          </button>
          <button className="btn danger confirm" disabled={busy} onClick={() => void run()}>
            {busy ? `Deleting… ${done} of ${n}` : `Delete ${n === 1 ? noun : `${n} ${noun}`}`}
          </button>
        </div>
      </div>
    </>
  );
}

/** The newsletters created so far (Deliverables → Newsletter), above the entries they are built from. */
export function NewslettersCard({ me }: { me?: Me }) {
  const q = useNewsletters();
  const canDelete = !!me && can(me.role, "item:delete");
  const [deleting, setDeleting] = useState<Newsletter | null>(null);
  const fitRef = useFitToScreen(200);
  const [, setParams] = useSearchParams();
  const open = (id: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("docx", id);
        return n;
      },
      { replace: false },
    );
  const list = q.data ?? [];
  return (
    <section className="card flush" aria-labelledby="nl-title" data-testid="newsletters">
      <div className="table-top">
        <div>
          <h2 className="card-title" id="nl-title">
            Newsletters
          </h2>
          <span className="card-sub">{q.data ? `${list.length} created · each built from the Phantoms listed` : "Loading…"}</span>
        </div>
      </div>
      <div ref={fitRef} className="table-wrap fit" tabIndex={0} role="region" aria-label="Newsletters (scrollable)">
        <table className="data nl-table">
          <caption className="sr-only">Newsletters</caption>
          <thead>
            <tr>
              <th scope="col" className="src-col">
                <span>Newsletter</span>
              </th>
              <th scope="col">
                <span>Name</span>
              </th>
              <th scope="col">
                <span>Phantoms used</span>
              </th>
              {canDelete && (
                <th scope="col" className="nl-del-col">
                  <span className="sr-only">Delete</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((n) => (
              <tr key={n.id}>
                <td className="src-col">
                  <DocxButton label={`Open newsletter ${n.name}`} onClick={() => open(n.id)} />
                </td>
                <td className="nl-name">
                  <b>{n.name}</b>
                  <span>
                    {n.createdBy} · {localDateTime(n.createdAt)}
                  </span>
                </td>
                <td>
                  <ul className="nl-items">
                    {n.items.map((i) => (
                      <li key={i.id} className={i.deleted ? "deleted" : undefined}>
                        <span className="mono">{i.recordId || i.code || "—"}</span> {i.title}
                        {i.deleted ? " (deleted)" : ""}
                      </li>
                    ))}
                  </ul>
                </td>
                {canDelete && (
                  <td className="nl-del-col">
                    <button className="icon-btn danger" onClick={() => setDeleting(n)} aria-label={`Delete newsletter ${n.name}`} title="Delete this newsletter" data-testid="nl-delete">
                      <TrashIcon />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.data && !list.length && <div className="empty">No newsletters yet. Tick entries below and choose Create Newsletter.</div>}
      {deleting && <DeleteDeliverables kind="newsletter" items={[{ id: deleting.id, label: deleting.name }]} onCancel={() => setDeleting(null)} onDone={() => setDeleting(null)} />}
    </section>
  );
}

export interface NewsletterPick {
  id: string;
  code: string;
  label: string;
}

/** Name and create a newsletter from the ticked entries. */
export function NewsletterCreate({ entries, onCancel, onCreated }: { entries: NewsletterPick[]; onCancel: () => void; onCreated: (n: Newsletter) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useFocusTrap(true, busy ? () => undefined : onCancel);
  const toast = useToast();
  const inv = useInvalidate();
  const submit = async () => {
    if (!name.trim()) return setErr("Name the newsletter first.");
    setBusy(true);
    setErr(null);
    try {
      const n = await api<Newsletter>("/api/newsletters", { method: "POST", json: { name: name.trim(), itemIds: entries.map((e) => e.id) } });
      await inv("newsletters");
      toast(`Created newsletter “${n.name}”`);
      onCreated(n);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  };
  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div className="modal nl-create" role="dialog" aria-modal="true" aria-labelledby="nl-create-title" ref={ref}>
        <b id="nl-create-title">Create newsletter</b>
        <p>
          From {entries.length} {entries.length === 1 ? "entry" : "entries"}. The .docx is stored in the Newsletters table.
        </p>
        <ul className="bulk-del-list">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="mono">{e.code}</span> {e.label}
            </li>
          ))}
        </ul>
        <label className="field">
          <span>Newsletter name</span>
          <input
            className="control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            maxLength={120}
            placeholder="e.g. AI in pharma · October 2026"
            data-autofocus
          />
        </label>
        {err && (
          <div className="err-msg" role="alert">
            ✕ {err}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" disabled={busy} onClick={() => void submit()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </>
  );
}

/** Who can build newsletters (analysts and admins; everyone can view and download). */
export const canCreateNewsletter = (me: Me) => can(me.role, "item:edit");

/**
 * Request 51: Database → Generate Newsletter. Each ticked entry is put in a
 * section of the newsletter template (Technology, People or Process) before
 * Confirm writes it; several entries can share a section.
 */
export function NewsletterSections({ entries, onCancel, onDone }: { entries: NewsletterPick[]; onCancel: () => void; onDone: (n: Newsletter) => void }) {
  const [sections, setSections] = useState<Record<string, NewsletterSection>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useFocusTrap(true, busy ? () => undefined : onCancel);
  const left = entries.filter((e) => !sections[e.id]).length;
  const confirm = async () => {
    if (left) return setErr(`Choose Technology, People or Process for ${left === 1 ? "the last entry" : `${left} more entries`}.`);
    setBusy(true);
    setErr(null);
    try {
      const n = await api<Newsletter>("/api/newsletters/generate", { method: "POST", json: { itemIds: entries.map((e) => e.id), sections } });
      onDone(n);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  };
  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div className="modal nl-sections" role="dialog" aria-modal="true" aria-labelledby="nl-sections-title" ref={ref} data-testid="newsletter-sections">
        <b id="nl-sections-title">Generate newsletter</b>
        <p>Put each signal in a section of the newsletter. Several can share a section; they follow one another in it.</p>
        <ul className="nl-sec-list">
          {entries.map((e, i) => (
            <li key={e.id}>
              <span className="nl-sec-title">
                {e.code && <span className="mono">{e.code}</span>} {e.label}
              </span>
              <span className="seg nl-sec-seg" role="radiogroup" aria-label={`Section for ${e.label}`}>
                {NEWSLETTER_SECTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={sections[e.id] === s}
                    data-autofocus={i === 0 && s === "technology" ? true : undefined}
                    onClick={() => setSections((cur) => ({ ...cur, [e.id]: s }))}
                    data-testid={`nl-sec-${s}`}
                  >
                    {NEWSLETTER_SECTION_LABEL[s]}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        {err && (
          <div className="err-msg" role="alert">
            ✕ {err}
          </div>
        )}
        <div className="nl-sec-foot">
          <span className="card-sub" aria-live="polite">
            {left ? `${left} of ${entries.length} still to place` : "Every signal has a section"}
          </span>
          <button className="btn secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" disabled={busy || left > 0} onClick={() => void confirm()} data-testid="nl-confirm">
            {busy ? "Generating…" : "Confirm"}
          </button>
        </div>
      </div>
    </>
  );
}
