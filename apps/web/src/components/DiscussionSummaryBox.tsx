import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { can, type DiscussionSummary, type Me } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useDiscussionSummary } from "../api/hooks";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";

const NAME = { source: "Full Discussion", kiq: "KIQ Archive" } as const;

/**
 * Analytics → Primary Tracker's AI Summary (request 43), above the table: the
 * summary of the open Full Discussion or KIQ Archive, in large type. Written
 * by the AI writer once the Claude API is connected (following the
 * instructions in Administration); admins can write or change it by hand.
 */
export function DiscussionSummaryBox({ me, id, mode, source }: { me: Me; id: string | null; mode: "source" | "kiq"; source?: string }) {
  const q = useDiscussionSummary(id, mode);
  const qc = useQueryClient();
  const toast = useToast();
  const admin = can(me.role, "settings:edit");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setEditing(false), [id, mode]);
  const s = q.data;

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
    <section className={`card ai-summary${id ? "" : " idle"}`} aria-labelledby="ai-summary-title" data-testid="ai-summary">
      <div className="ai-summary-head">
        <div>
          <h2 className="card-title" id="ai-summary-title">
            <span className="ai-spark" aria-hidden="true">
              ✦
            </span>{" "}
            AI Summary{id ? ` · ${NAME[mode]}` : ""}
          </h2>
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
          <label className="sr-only" htmlFor="ai-summary-draft">
            AI Summary of this {NAME[mode]}
          </label>
          <textarea id="ai-summary-draft" className="control" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={10_000} autoFocus />
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
          <div className="ai-summary-text" data-testid="ai-summary-text">
            {s.text.split(/\n\s*\n/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
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
    </section>
  );
}
