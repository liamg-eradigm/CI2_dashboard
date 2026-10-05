import { useState } from "react";
import { request } from "../api/client";
import { useMarkdown, useSignal } from "../api/hooks";
import { useToast } from "../state/toast";
import { LinkedPanes } from "./LinkedPanes";
import { useFocusTrap } from "./RecordDrawer";

/** Save an entry's Markdown file (named after its ID). Returns the file name. */
export function downloadMarkdown(id: string): Promise<string> {
  return saveMarkdown(`/api/signals/${id}/markdown?download=1`, `${id}.md`);
}

/** Save the Markdown file an API path returns, under the name it gives. Returns the file name. */
export async function saveMarkdown(path: string, fallback: string): Promise<string> {
  const res = await request(path);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallback;
  const url = URL.createObjectURL(new Blob([await res.text()], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

interface FmLine {
  key: string;
  value: string;
  children: FmLine[];
}

const unquote = (v: string) => {
  if (!v.startsWith('"')) return v;
  try {
    return JSON.parse(v) as string;
  } catch {
    return v.slice(1, -1);
  }
};

/** Parse the front matter this platform generates (two-space nesting, one key per line). */
export function parseMarkdown(md: string): { fm: FmLine[]; sections: { title: string; body: string }[] } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md);
  if (!m) return { fm: [], sections: [{ title: "", body: md }] };
  const fm: FmLine[] = [];
  for (const line of (m[1] ?? "").split("\n")) {
    const lm = /^( *)([^:]+):\s?(.*)$/.exec(line);
    if (!lm) continue;
    const entry = { key: lm[2] ?? "", value: unquote(lm[3] ?? ""), children: [] };
    if ((lm[1] ?? "").length > 0 && fm.length) fm[fm.length - 1]?.children.push(entry);
    else fm.push(entry);
  }
  const sections = (m[2] ?? "")
    .split(/^## /m)
    .filter((x) => x.trim())
    .map((chunk) => {
      const [title, ...rest] = chunk.split("\n");
      return { title: title ?? "", body: rest.join("\n").trim() };
    });
  return { fm, sections };
}

export function FrontMatter({ lines }: { lines: FmLine[] }) {
  return (
    <dl className="md-fm">
      {lines.map((l) => (
        <div key={l.key} className={l.children.length ? "group" : ""}>
          <dt>{l.key}</dt>
          <dd>{l.children.length ? <FrontMatter lines={l.children} /> : l.value || <span className="md-empty">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Side pane with a Phantoms entry's Markdown file: like the saved-page pane,
 * the whole pane is the file (scrollable), under a slim header with Download
 * at the top right. A Preview switch shows it rendered.
 */
export function MarkdownPanel({ id, onClose, onOpenRecord, onEdit }: { id: string; onClose: () => void; onOpenRecord: (id: string) => void; onEdit?: (id: string) => void }) {
  const md = useMarkdown(id);
  const sig = useSignal(id);
  const ref = useFocusTrap(true, onClose);
  const [tab, setTab] = useState<"raw" | "preview">("raw");
  const toast = useToast();
  const doc = md.data ? parseMarkdown(md.data) : null;
  const rid = doc?.fm.find((l) => l.key === "id")?.value;
  const title = doc?.fm.find((l) => l.key === "title")?.value || sig.data?.values.title?.toString() || "Markdown";
  // A Primary entry linked to others from the same source: its Markdown beside the earlier (or later) one's.
  const linked = !!sig.data && !!(sig.data.linkedEarlier || sig.data.linkedLater);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className={`drawer source-drawer md-pane${linked ? " linked-drawer" : ""}`} role="dialog" aria-modal="true" aria-labelledby="md-title" ref={ref}>
        <div className="drawer-head">
          <span className="drawer-meta">
            <span className="mono md-file" style={{ color: "var(--ink)" }} title={`${rid || sig.data?.code || ""}.md`}>
              {rid || sig.data?.code || "…"}.md
            </span>
            {sig.data && (
              <>
                <span>·</span>
                <span>{sig.data.code}</span>
                <span>·</span>
                <span>Published rev {sig.data.rev}</span>
              </>
            )}
          </span>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div className="seg md-seg" role="group" aria-label="Markdown view">
              <button aria-pressed={tab === "raw"} onClick={() => setTab("raw")}>
                Markdown
              </button>
              <button aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>
                Preview
              </button>
            </div>
            <button
              className="link-btn"
              disabled={!md.data}
              onClick={() =>
                void navigator.clipboard.writeText(md.data ?? "").then(
                  () => toast("Markdown copied"),
                  () => toast("Could not copy · select the text instead", false),
                )
              }
            >
              Copy
            </button>
            <button className="link-btn" onClick={() => onOpenRecord(id)}>
              Open full record
            </button>
            {onEdit && (
              <button className="link-btn" onClick={() => onEdit(id)}>
                ✎ Edit
              </button>
            )}
            <button
              className="link-btn"
              onClick={() =>
                void downloadMarkdown(id).then(
                  (name) => toast(`Downloaded ${name}`),
                  (e: Error) => toast(`Download failed · ${e.message}`, false),
                )
              }
            >
              Download Markdown
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close Markdown" data-autofocus>
              ✕
            </button>
          </div>
          <h2 id="md-title" className="source-drawer-title">
            {title}
          </h2>
        </div>
        {linked && sig.data ? (
          <LinkedPanes opened={sig.data} render={(x) => <MdDoc id={x.id} tab={tab} own={x.id === id} />} />
        ) : (
          <div className="md-pane-body">
            <MdDoc id={id} tab={tab} own />
          </div>
        )}
      </div>
    </>
  );
}

/** One entry's Markdown file, as source or rendered (in the pane, or one side of two linked entries). */
function MdDoc({ id, tab, own }: { id: string; tab: "raw" | "preview"; own: boolean }) {
  const md = useMarkdown(id);
  const toast = useToast();
  const doc = md.data ? parseMarkdown(md.data) : null;
  return (
    <>
      {md.isLoading && <div className="skeleton" style={{ height: 240, margin: 16 }} />}
      {md.isError && (
        <p className="err-msg" role="alert" style={{ margin: 24 }}>
          {(md.error as Error).message}
        </p>
      )}
      {!own && md.data && (
        <div className="md-doc-bar">
          <button
            className="link-btn"
            onClick={() =>
              void downloadMarkdown(id).then(
                (name) => toast(`Downloaded ${name}`),
                (e: Error) => toast(`Download failed · ${e.message}`, false),
              )
            }
          >
            Download this Markdown
          </button>
        </div>
      )}
      {md.data && tab === "raw" && (
        <pre className="md-raw" tabIndex={0} aria-label="Markdown source">
          {md.data}
        </pre>
      )}
      {doc && tab === "preview" && (
        <div className="md-preview">
          <FrontMatter lines={doc.fm} />
          {doc.sections.map((sec) => (
            <section key={sec.title}>
              <h3>{sec.title}</h3>
              {sec.body ? sec.body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : <p className="md-empty">Empty</p>}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
