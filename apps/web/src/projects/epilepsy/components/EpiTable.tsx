/**
 * The Epilepsy pages' tables (request 61), in the CI Squared Database's
 * style: sortable columns, a sticky header, scrolling both ways inside the
 * window (so the horizontal scrollbar is always on screen) and rows that open.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useFitToScreen } from "../../../lib/fitToScreen";
import { isoDate, showDate, type Rec } from "../model";

export type EpiColumn = {
  /** The workbook's column name. */
  name: string;
  /** Shown as (default: the name). */
  label?: string;
  kind?: "date" | "long" | "title" | "url" | "plain";
  width?: number;
  render?: (r: Rec) => ReactNode;
};

const cmp = (a: string, b: string) => {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const na = Number(a.replace(/[%,$]/g, ""));
  const nb = Number(b.replace(/[%,$]/g, ""));
  if (a.trim() !== "" && b.trim() !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
};

export function cellText(r: Rec, c: EpiColumn): string {
  const v = r.get(c.name);
  return c.kind === "date" && isoDate(v) ? showDate(v) : v;
}

export function EpiTable({
  rows,
  columns,
  label,
  initialSort,
  onOpen,
  openIndex,
  extra,
  minWidth,
  fitOffset = 150,
  testId,
}: {
  rows: Rec[];
  columns: EpiColumn[];
  label: string;
  initialSort?: { name: string; dir: "asc" | "desc" };
  onOpen?: (r: Rec) => void;
  /** The row open (highlighted). */
  openIndex?: number | null;
  /** Extra columns at the end (e.g. Full Discussion / KIQ Archive). */
  extra?: { header: ReactNode; className?: string; cell: (r: Rec) => ReactNode }[];
  minWidth?: number;
  fitOffset?: number;
  testId?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const fitRef = useFitToScreen(fitOffset, 1, true);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const s = [...rows].sort((a, b) => cmp(a.get(sort.name), b.get(sort.name)) || a.i - b.i);
    if (sort.dir === "desc") {
      // Empty values stay last either way.
      const full = s.filter((r) => r.get(sort.name)).reverse();
      return [...full, ...s.filter((r) => !r.get(sort.name))];
    }
    return s;
  }, [rows, sort]);
  const width = minWidth ?? columns.reduce((n, c) => n + (c.width ?? (c.kind === "long" ? 320 : 160)), 0) + (extra?.length ?? 0) * 120;
  return (
    <div ref={fitRef} className="table-wrap fit epi-wrap" tabIndex={0} role="region" aria-label={`${label} (scrollable)`} data-testid={testId}>
      <table className="data epi-table" style={{ minWidth: width }}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const on = sort?.name === c.name;
              return (
                <th key={c.name} scope="col" style={c.width ? { minWidth: c.width } : undefined} aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}>
                  <button onClick={() => setSort(on && sort!.dir === "asc" ? { name: c.name, dir: "desc" } : on ? null : { name: c.name, dir: "asc" })} title={`Sort by ${c.label ?? c.name}`}>
                    {c.label ?? c.name}
                    {on && <span aria-hidden="true">{sort!.dir === "asc" ? " ▲" : " ▼"}</span>}
                  </button>
                </th>
              );
            })}
            {extra?.map((x, i) => (
              <th key={`x${i}`} scope="col" className={x.className}>
                {x.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.i}
              className={`${onOpen ? "clickable" : ""}${openIndex === r.i ? " open" : ""}`}
              onClick={(e) => {
                if (!onOpen || (e.target as HTMLElement).closest("button, a, input, select")) return;
                onOpen(r);
              }}
            >
              {columns.map((c, ci) => {
                const text = cellText(r, c);
                if (c.render) return <td key={c.name}>{c.render(r)}</td>;
                if (ci === 0 && onOpen)
                  return (
                    <td key={c.name} className={c.kind === "date" ? "date" : "title"}>
                      <button className="epi-open" onClick={() => onOpen(r)} aria-label={`Open: ${text || "row"}`}>
                        {text || "—"}
                      </button>
                    </td>
                  );
                if (c.kind === "long")
                  return (
                    <td key={c.name} className="long">
                      <div className="clamp" title={text}>
                        {text}
                      </div>
                    </td>
                  );
                if (c.kind === "url") return <td key={c.name}>{text ? <UrlLink v={text} /> : ""}</td>;
                return (
                  <td key={c.name} className={c.kind === "date" ? "date" : c.kind === "title" ? "title" : undefined}>
                    {text}
                  </td>
                );
              })}
              {extra?.map((x, i) => (
                <td key={`x${i}`} className={x.className}>
                  {x.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="empty">Nothing to show{columns.length ? " with these filters" : ""}.</div>}
    </div>
  );
}

export function UrlLink({ v }: { v: string }) {
  const s = v.trim();
  const ok = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(s) ? `https://${s}` : null;
  if (!ok) return <>{s}</>;
  return (
    <a href={ok} target="_blank" rel="noopener noreferrer" className="epi-url" title={s}>
      {s.replace(/^https?:\/\/(www\.)?/i, "").slice(0, 48)}
      {s.length > 56 ? "…" : ""}
    </a>
  );
}
