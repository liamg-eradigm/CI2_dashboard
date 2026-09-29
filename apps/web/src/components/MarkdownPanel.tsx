import { useState } from "react";
import { request } from "../api/client";
import { useMarkdown, useSignal } from "../api/hooks";
import { useToast } from "../state/toast";
import { useFocusTrap } from "./RecordDrawer";

/** Save an entry's Markdown file (named after its ID). Returns the file name. */
export async function downloadMarkdown(id: string): Promise<string> {
  const res = await request(`/api/signals/${id}/markdown?download=1`);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${id}.md`;
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
function parse(md: string): { fm: FmLine[]; sections: { title: string; body: string }[] } {
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

function FrontMatter({ lines }: { lines: FmLine[] }) {
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

/** Side panel with a Phantoms entry's Markdown: raw or rendered, download and copy. */
export function MarkdownPanel({ id, onClose, onOpenRecord }: { id: string; onClose: () => void; onOpenRecord: (id: string) => void }) {
  const md = useMarkdown(id);
  const sig = useSignal(id);
  const ref = useFocusTrap(true, onClose);
  const [tab, setTab] = useState<"raw" | "preview">("raw");
  const toast = useToast();
  const doc = md.data ? parse(md.data) : null;
  const rid = doc?.fm.find((l) => l.key === "id")?.value;

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer md-drawer" role="dialog" aria-modal="true" aria-labelledby="md-title" ref={ref}>
        <div className="drawer-head">
          <div className="drawer-meta">
            <span className="mono" style={{ color: "var(--ink)" }}>
              {rid || sig.data?.code || "…"}
            </span>
            {sig.data && (
              <>
                <span>·</span>
                <span>{sig.data.code}</span>
                <span>·</span>
                <span>Published rev {sig.data.rev}</span>
              </>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close Markdown" data-autofocus>
            ✕
          </button>
        </div>
        <div className="drawer-body">
          <h2 id="md-title" style={{ font: "700 20px/1.3 var(--sans)", textWrap: "pretty" }}>
            {doc?.fm.find((l) => l.key === "title")?.value || sig.data?.values.title?.toString() || "Markdown"}
          </h2>
          <div className="md-toolbar">
            <div className="seg" role="group" aria-label="Markdown view" style={{ width: 220 }}>
              <button aria-pressed={tab === "raw"} onClick={() => setTab("raw")}>
                Markdown
              </button>
              <button aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>
                Preview
              </button>
            </div>
            <button
              className="btn"
              onClick={() =>
                void downloadMarkdown(id).then(
                  (name) => toast(`Downloaded ${name}`),
                  (e: Error) => toast(`Download failed · ${e.message}`, false),
                )
              }
            >
              <span aria-hidden="true">⤓</span> Download Markdown
            </button>
            <button
              className="btn secondary"
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
            <button className="btn secondary" onClick={() => onOpenRecord(id)}>
              Open full record
            </button>
          </div>
          {md.isLoading && <div className="skeleton" style={{ height: 240 }} />}
          {md.isError && (
            <p className="err-msg" role="alert">
              {(md.error as Error).message}
            </p>
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
          <p className="card-sub">Generated from this entry's tracker fields only · QC Reviewed_by is the person who approved it.</p>
        </div>
      </div>
    </>
  );
}
