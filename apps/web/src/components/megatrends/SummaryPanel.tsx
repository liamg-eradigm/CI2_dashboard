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

/** What the panel shows with nothing selected. */
export interface PanelIntro {
  title: string;
  count: string;
  text: string;
}

function provenance(s: TrendSummary, level: TrendLevel): string {
  if (s.source === "default") return "Summary provided with the dashboard";
  if (s.source === "manual") return `Written by ${s.updatedBy ?? "an analyst"}${s.updatedAt ? ` · ${localDateTime(s.updatedAt)}` : ""}`;
  const from = level === "competitor" ? `${plural(s.entries ?? 0, "entry", "entries")}, high-impact and recent first` : `last ${s.windowDays ?? "?"} days, ${plural(s.entries ?? 0, "entry", "entries")}`;
  return `AI summary · ${s.model ?? "Claude"} · ${from}${s.updatedAt ? ` · ${localDateTime(s.updatedAt)}` : ""}`;
}

const KICKER: Record<TrendLevel, string> = { macro: "Macrotrend", sub: "Subtrend", competitor: "Competitor" };

/**
 * The summary of the Macrotrend / Subtrend (Megatrends) or competitor
 * (Competitors) in view, with (for analysts and admins) Edit and Write with
 * AI. Without a selection: what the spheres are. The box at the top of the
 * column over the graph's left edge, above the list.
 */
export function SummaryPanel({
  node,
  intro,
  canEdit,
  aiConnected,
  focused,
  exploreLabel,
  onExplore,
  invalidate = "megatrends",
}: {
  node: PanelNode | null;
  intro: PanelIntro;
  canEdit: boolean;
  aiConnected: boolean;
  /** Shown because the view zoomed in on it (not selected). */
  focused: boolean;
  /** The button that opens the hub in view ("Explore subtrends"); none when null. */
  exploreLabel: string | null;
  onExplore: () => void;
  /** The query to refresh after a summary changes. */
  invalidate?: string;
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
      <section className="mg-panel" tabIndex={0} aria-live="polite" aria-label="Summary" data-testid="mg-panel">
        <div className="mg-panel-id">
          <h2 className="mg-panel-title">{intro.title}</h2>
          <p className="mg-count">{intro.count}</p>
        </div>
        <div className="mg-panel-body">
          <p className="mg-summary">{intro.text}</p>
        </div>
      </section>
    );
  }

  const run = async (kind: "save" | "ai", body: unknown) => {
    setBusy(kind);
    setErr(null);
    try {
      await api<TrendSummary>(kind === "ai" ? "/api/megatrends/summaries/generate" : "/api/megatrends/summaries", { method: kind === "ai" ? "POST" : "PUT", json: body });
      await inv(invalidate);
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
    <section className="mg-panel" tabIndex={0} aria-live="polite" aria-labelledby="mg-panel-title" data-testid="mg-panel">
      <div className="mg-panel-id">
        <span className="mg-kicker">
          <span className="dot" style={{ background: node.colour }} aria-hidden="true" />
          {KICKER[node.level]}
          {node.level === "sub" && node.parent ? ` · ${node.parent}` : ""}
          {focused ? " · in view" : ""}
        </span>
        <h2 className="mg-panel-title" id="mg-panel-title">
          {node.name}
        </h2>
        <p className="mg-count">
          {plural(node.count, "Tracker entry", "Tracker entries")}
          {node.level === "macro" ? ` · ${plural(node.children, "subtrend")}` : ""}
        </p>
      </div>
      <div className="mg-panel-body">
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
            <p className="mg-prov">{provenance(node.summary, node.level)}</p>
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
          {exploreLabel && focused && (
            <button className="mg-btn" onClick={onExplore}>
              {exploreLabel}
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
                title={
                  aiConnected
                    ? node.level === "competitor"
                      ? "Write this summary with Claude from the competitor's entries, high-impact and recent first (Administration → Megatrends sets the length)"
                      : "Write this summary with Claude from the recent entries (Administration → Megatrends sets the time frame and length)"
                    : "Connect the Claude API to write summaries with AI"
                }
                onClick={() => void run("ai", ref)}
              >
                {busy === "ai" ? "Writing…" : "✦ Write with AI"}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
