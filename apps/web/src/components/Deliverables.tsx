import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { can, type Me, type Newsletter } from "@eradigm/shared";
import { api, request, type ApiError } from "../api/client";
import { useInvalidate, useNewsletters } from "../api/hooks";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";
import { useFocusTrap } from "./RecordDrawer";

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
        if (!gone) setState({ loading: false, fileName });
      } catch (e) {
        if (!gone) setState({ loading: false, error: (e as Error).message || "Could not open the document" });
      }
    })();
    return () => {
      gone = true;
    };
  }, [id]);

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

/** The newsletters created so far (Deliverables → Newsletter), above the entries they are built from. */
export function NewslettersCard() {
  const q = useNewsletters();
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
      <div className="table-wrap">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.data && !list.length && <div className="empty">No newsletters yet. Tick entries below and choose Create Newsletter.</div>}
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
