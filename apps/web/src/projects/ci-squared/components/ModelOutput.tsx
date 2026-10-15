import { LOW_CONFIDENCE, displayValue, sortedColumns, type ExtractedFieldView, type TrackerSchema } from "@eradigm/shared";

/** Field · Value · Confidence · Evidence excerpt · Validation — used on Input and in the Inbox. */
export function ModelOutputTable({ schema, extraction, caption }: { schema: TrackerSchema; extraction: Record<string, ExtractedFieldView>; caption: string }) {
  return (
    <div className="table-wrap">
      <table className="data" style={{ minWidth: 820, fontSize: 12.5 }}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Value</th>
            <th scope="col">Confidence</th>
            <th scope="col">Evidence excerpt</th>
            <th scope="col">Validation</th>
          </tr>
        </thead>
        <tbody>
          {sortedColumns(schema).map((c) => {
            const e = extraction[c.key];
            const v = e?.value ?? null;
            const conf = e?.confidence ?? null;
            const low = conf != null && conf < LOW_CONFIDENCE;
            const warns = e?.warnings ?? ["Not in extraction schema · analyst to complete"];
            return (
              <tr key={c.key}>
                <th scope="row" style={{ textAlign: "left", padding: "10px 12px 10px 20px", fontWeight: 700, whiteSpace: "nowrap", color: "var(--ink)" }}>
                  {c.label}
                </th>
                <td style={{ minWidth: 150, color: v == null ? "var(--muted)" : "var(--ink)", fontFamily: v == null ? "var(--mono)" : undefined }}>{v == null ? "null" : displayValue(c, v)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <div className="conf">
                    <div className="bar" aria-hidden="true">
                      <i style={{ width: conf == null ? 0 : `${Math.round(conf * 100)}%`, background: conf == null ? "var(--border-input)" : low ? "var(--medium)" : "var(--chart-teal)" }} />
                    </div>
                    <span>
                      {conf == null ? "—" : `${Math.round(conf * 100)}%`}
                      {low ? " (low)" : ""}
                    </span>
                  </div>
                </td>
                <td style={{ minWidth: 220, fontStyle: "italic", lineHeight: 1.45 }}>{e?.evidence ?? "—"}</td>
                <td style={{ minWidth: 180, lineHeight: 1.45, color: warns.length ? "var(--warning)" : "var(--success-2)" }}>
                  {warns.length ? (
                    <>
                      <span aria-hidden="true">⚠ </span>
                      {warns.join(" · ")}
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">✓ </span>Passed
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
