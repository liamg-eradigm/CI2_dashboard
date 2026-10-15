/** Filters above an Epilepsy table or plot (request 61): search, and multi-choice by column. */
import type { ReactNode } from "react";
import { Combobox } from "../../../components/Combobox";

export type Choice = { name: string; label?: string; options: string[]; value: string[] };

export function Filters({ search, onSearch, choices, onChoice, children, onClear }: { search?: string; onSearch?: (v: string) => void; choices: Choice[]; onChoice: (name: string, v: string[]) => void; children?: ReactNode; onClear?: () => void }) {
  return (
    <div className="epi-filters" role="search">
      {onSearch && (
        <label className="field epi-search">
          <span>Search</span>
          <input className="control" type="search" value={search ?? ""} onChange={(e) => onSearch(e.target.value)} placeholder="Any word…" />
        </label>
      )}
      {choices.map((c) => (
        <div className="field" key={c.name}>
          <span>{c.label ?? c.name}</span>
          <Combobox multiple label={c.label ?? c.name} options={c.options} value={c.value} onChange={(v) => onChoice(c.name, v)} placeholder="All" testId={`filter-${c.name}`} />
        </div>
      ))}
      {children}
      {onClear && (
        <button className="btn secondary small epi-clear" onClick={onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}

/** The distinct values of a column (sorted), for a filter. */
export const distinct = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
