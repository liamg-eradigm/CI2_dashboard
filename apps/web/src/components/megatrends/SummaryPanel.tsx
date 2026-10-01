import { useEffect, useState } from "react";
import { MAX_SUMMARY_LENGTH, type TrendLevel, type TrendSummary } from "@eradigm/shared";
import { api, type ApiError } from "../../api/client";
import { useInvalidate } from "../../api/hooks";
import { localDateTime } from "../../lib/format";
import { useToast } from "../../state/toast";
import { plural } from "./model";

export interface PanelNode {
  level: TrendLevel;
  name: string;
  parent: string | null;
  count: number;
  colour: string;
  summary: TrendSummary | null;
  /** Subtrends with entries (Macrotrends only). */
  children: number;
}

function provenance(s: TrendSummary): string {
  if (s.source === "default") return "Summary provided with the dashboard";
  if (s.source === "manual") return `Written by ${s.updatedBy ?? "an analyst"}${s.updatedAt ? ` · ${localDateTime(s.updatedAt)}` : ""}`;
  return `AI summary · ${s.model ?? "Claude"} · last ${s.windowDays ?? "?"} days, ${plural(s.entries ?? 0, "entry", "entries")}${s.updatedAt ? ` · ${localDateTime(s.updatedAt)}` : ""}`;
}

/**
 * The summary of the Macrotrend / Subtrend in view, with (for analysts and
 * admins) Edit and Write with AI. Without a selection: how to use the graph.
 */
export function SummaryPanel({
  node,
  total,
  macros,
  canEdit,
  aiConnected,
  focused,
  onExplore,
}: {
  node: PanelNode | null;
  total: number;
  macros: number;
  canEdit: boolean;
  aiConnected: boolean;
  /** Shown because the view zoomed in on it (not selected). */
  focused: boolean;
  onExplore: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "save" | "ai">(null);
  const [err, setErr] = useState<string | null>(null);
  const inv = useInvalidate();
  const toast = useToast();
  const key = node ? `${node.level}:${node.name}` : "";
  useEffect(() => {
    setEditing(false);
    setErr(null);
  }, [key]);

  if (!node) {
    return (
      <aside className="mg-panel" aria-live="polite" data-testid="mg-panel">
        <span className="mg-kicker">Knowledge graph</span>
        <h2 className="mg-panel-title">Megatrends</h2>
        <p className="mg-count">
          {plural(total, "Tracker entry", "Tracker entries")} · {plural(macros, "macrotrend")}
        </p>
        <p className="mg-summary">Each sphere is a Macrotrend, sized by its number of Tracker entries. Select one to reveal its Subtrends and a short summary of what is happening in that space.</p>
        <p className="mg-hint">Drag to rotate · scroll to zoom in on a node · drag a node to move it</p>
      </aside>
    );
  }

  const run = async (kind: "save" | "ai", body: unknown) => {
    setBusy(kind);
    setErr(null);
    try {
      await api<TrendSummary>(kind === "ai" ? "/api/megatrends/summaries/generate" : "/api/megatrends/summaries", { method: kind === "ai" ? "POST" : "PUT", json: body });
      await inv("megatrends");
      setEditing(false);
      toast(kind === "ai" ? `AI summary written for ${node.name}` : `Summary saved for ${node.name}`);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  const ref = { level: node.level, name: node.name, ...(node.parent ? { parent: node.parent } : {}) };

  return (
    <aside className="mg-panel" aria-live="polite" aria-labelledby="mg-panel-title" data-testid="mg-panel">
      <span className="mg-kicker">
        <span className="dot" style={{ background: node.colour }} aria-hidden="true" />
        {node.level === "macro" ? "Macrotrend" : `Subtrend${node.parent ? ` · ${node.parent}` : ""}`}
        {focused ? " · in view" : ""}
      </span>
      <h2 className="mg-panel-title" id="mg-panel-title">
        {node.name}
      </h2>
      <p className="mg-count">
        {plural(node.count, "Tracker entry", "Tracker entries")}
        {node.level === "macro" ? ` · ${plural(node.children, "subtrend")}` : ""}
      </p>
      {editing ? (
        <div className="mg-edit">
          <label className="sr-only" htmlFor="mg-summary-text">
            Summary of {node.name}
          </label>
          <textarea id="mg-summary-text" value={text} maxLength={MAX_SUMMARY_LENGTH} rows={6} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="mg-actions">
            <button className="mg-btn" disabled={!!busy} onClick={() => void run("save", { ...ref, text: text.trim() })}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button className="mg-btn ghost" disabled={!!busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            {node.summary && node.summary.source !== "default" && (
              <button className="mg-btn ghost" disabled={!!busy} onClick={() => void run("save", { ...ref, text: "" })} title="Go back to the summary provided with the dashboard">
                Reset
              </button>
            )}
          </div>
        </div>
      ) : node.summary?.text ? (
        <>
          <p className="mg-summary" data-testid="mg-summary">
            {node.summary.text}
          </p>
          <p className="mg-prov">{provenance(node.summary)}</p>
        </>
      ) : (
        <p className="mg-summary muted">No summary yet.</p>
      )}
      {err && (
        <p className="mg-err" role="alert">
          {err}
        </p>
      )}
      <div className="mg-actions">
        {node.level === "macro" && focused && (
          <button className="mg-btn" onClick={onExplore}>
            Explore subtrends
          </button>
        )}
        {canEdit && !editing && (
          <>
            <button
              className="mg-btn ghost"
              onClick={() => {
                setText(node.summary?.text ?? "");
                setEditing(true);
              }}
            >
              Edit summary
            </button>
            <button
              className="mg-btn ghost"
              disabled={!aiConnected || !!busy || node.count < 1}
              aria-disabled={!aiConnected}
              title={aiConnected ? "Write this summary with Claude from the recent entries (Administration → Megatrends sets the time frame and length)" : "Connect the Claude API to write summaries with AI"}
              onClick={() => void run("ai", ref)}
            >
              {busy === "ai" ? "Writing…" : "✦ Write with AI"}
            </button>
          </>
        )}
      </div>
      {canEdit && !aiConnected && !editing && <p className="mg-hint">AI summaries switch on once the Claude API is connected.</p>}
    </aside>
  );
}
