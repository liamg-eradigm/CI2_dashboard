import { useState } from "react";
import type { SavedView, SavedViewState } from "@eradigm/shared";
import { api } from "../api/client";
import { useInvalidate, useViews } from "../api/hooks";
import { useToast } from "../state/toast";
import type { useFilters } from "../state/filters";

/** Load or save the current filter state (and optional trend configuration). */
export function SavedViews({ kind, f, extra, onLoad }: { kind: SavedView["kind"]; f: ReturnType<typeof useFilters>; extra?: () => Partial<SavedViewState>; onLoad?: (v: SavedView) => void }) {
  const views = useViews();
  const toast = useToast();
  const inv = useInvalidate();
  const [sel, setSel] = useState("");
  const mine = (views.data ?? []).filter((v) => v.kind === kind || (kind !== "trend" && v.kind !== "trend"));

  const save = async () => {
    const name = window.prompt("Name this view");
    if (!name?.trim()) return;
    try {
      await api("/api/views", { method: "POST", json: { name: name.trim(), kind, state: { filters: f.filters, ...(extra?.() ?? {}) }, shared: false } });
      await inv("views");
      toast(`Saved view “${name.trim()}”`);
    } catch (e) {
      toast((e as Error).message, false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select
        className="control"
        style={{ height: 28, width: "auto", fontSize: 12.5 }}
        aria-label="Saved views"
        value={sel}
        onChange={(e) => {
          const v = mine.find((x) => x.id === e.target.value);
          setSel("");
          if (!v) return;
          if (v.state.filters) f.apply(v.state.filters);
          onLoad?.(v);
          toast(`Loaded view “${v.name}”`);
        }}
      >
        <option value="">Saved views…</option>
        {mine.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.shared ? " (shared)" : ""}
          </option>
        ))}
      </select>
      <button className="btn secondary small" style={{ height: 28 }} onClick={save} title="Save the current filters as a view">
        Save
      </button>
    </div>
  );
}
