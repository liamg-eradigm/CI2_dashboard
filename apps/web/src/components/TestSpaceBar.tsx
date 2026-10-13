import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EXCEL_WORKBOOK_NAME, sheetKindOf, type ExcelCheck, type ExcelSyncStatus } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";

const STATUS_KEY = ["excel-status"];

/** "2 minutes ago" (or the date, after a day). */
function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return localDateTime(iso);
}

const KIND_LABEL: Record<string, string> = { primary: "Primary Tracker", secondary: "Secondary Tracker", competitor: "Company Profiles", macrotrend: "Macrotrend sections", ignored: "Not read" };

/**
 * Request 55: the Test tab's bar, above every Test page. The test space holds
 * only what the SharePoint workbook says; the bar says when it was last
 * synced, syncs now, checks the connection to Microsoft (the test endpoint:
 * sign-in, the workbook, its worksheets and their columns) and lists the rows
 * that were left out and why. When a sync (the every-minute one included)
 * brings changes, the page shows them at once.
 */
export function TestSpaceBar() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => api<ExcelSyncStatus>("/api/excel/status"), refetchInterval: 20_000 });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ExcelCheck | null>(null);
  const [details, setDetails] = useState(false);
  const s = status.data;

  // A change made by a sync (on its own every minute, or Sync now): every page reads again.
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!s) return;
    if (seen.current !== undefined && s.lastChangeAt !== seen.current) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== STATUS_KEY[0] });
    seen.current = s.lastChangeAt;
  }, [s, qc]);

  const syncNow = async () => {
    setBusy(true);
    try {
      let r = await api<ExcelSyncStatus>("/api/excel/sync", { method: "POST", json: { force: true } });
      // Large changes are applied a few rows at a time: carry on until they are all in.
      for (let n = 0; r.more && n < 60; n++) r = await api<ExcelSyncStatus>("/api/excel/sync", { method: "POST", json: {} });
      qc.setQueryData(STATUS_KEY, r);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== STATUS_KEY[0] });
      seen.current = r.lastChangeAt;
      if (r.status === "error") toast(`Sync failed · ${r.message ?? "see the bar above"}`, false);
      else {
        const a = r.applied;
        const changes = a.created + a.updated + a.deleted + a.trends;
        toast(changes ? `Synced · ${a.created} added, ${a.updated} updated, ${a.deleted} removed, ${a.trends} profiles or sections` : "Synced · nothing changed");
      }
    } catch (e) {
      toast(`Sync failed · ${(e as ApiError).message}`, false);
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await api<ExcelCheck>("/api/excel/check"));
    } catch (e) {
      toast(`Check failed · ${(e as ApiError).message}`, false);
    } finally {
      setChecking(false);
    }
  };

  const name = s?.file?.name ?? EXCEL_WORKBOOK_NAME;
  const counts = s?.counts;
  const line = !s
    ? status.isError
      ? `Could not read the sync status · ${(status.error as Error).message}`
      : "Loading…"
    : !s.configured
      ? `Not connected: set ${s.missing.join(", ")} (Cloudflare secrets), then deploy the API again.`
      : s.status === "error"
        ? `Last sync failed: ${s.message ?? "unknown error"}`
        : s.status === "syncing" || s.more
          ? "Applying the workbook's changes a few rows at a time…"
          : s.status === "never"
            ? "Not synced yet: press Sync now."
            : `Synced ${ago(s.lastSyncedAt)} · checked for changes ${ago(s.lastCheckedAt)} (every minute)`;
  const issues = s?.issues ?? [];

  return (
    <section className={`test-bar${s?.status === "error" || (s && !s.configured) ? " problem" : ""}`} aria-label="Test space" data-testid="test-bar">
      <div className="test-bar-main">
        <span className="test-badge">Test</span>
        <div className="test-bar-text">
          <b>
            Contents from{" "}
            {s?.file?.url ? (
              <a href={s.file.url} target="_blank" rel="noopener noreferrer">
                {name}
              </a>
            ) : (
              name
            )}{" "}
            on SharePoint
          </b>
          <span role="status" data-testid="test-bar-status">
            {line}
            {counts && (
              <>
                {" "}
                · Holds {counts.primary} Primary, {counts.secondary} Secondary, {counts.competitors} Company Profile{counts.competitors === 1 ? "" : "s"}, {counts.macrotrends} Macrotrend
                {counts.macrotrends === 1 ? "" : "s"}
              </>
            )}
          </span>
          {s?.problem && <span className="test-bar-hint">{s.problem.hint}</span>}
        </div>
        <div className="test-bar-actions">
          {(issues.length > 0 || (s?.sheets.length ?? 0) > 0) && (
            <button className="link-btn" aria-expanded={details} aria-controls="test-bar-details" onClick={() => setDetails((d) => !d)} data-testid="test-bar-issues">
              {issues.length ? `${issues.length} problem${issues.length === 1 ? "" : "s"}` : "Sheets read"}
            </button>
          )}
          <button className="btn secondary small" onClick={() => void runCheck()} disabled={checking} data-testid="test-check">
            {checking ? "Checking…" : "Check connection"}
          </button>
          <button className="btn small" onClick={() => void syncNow()} disabled={busy} data-testid="test-sync">
            {busy ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>
      {details && s && (
        <div className="test-bar-details" id="test-bar-details">
          <table className="data test-sheets">
            <caption className="sr-only">Sheets read from the workbook</caption>
            <thead>
              <tr>
                <th scope="col">Sheet</th>
                <th scope="col">Feeds</th>
                <th scope="col">Rows</th>
                <th scope="col">Columns read</th>
                <th scope="col">Columns left out</th>
              </tr>
            </thead>
            <tbody>
              {s.sheets.map((x) => (
                <tr key={x.name}>
                  <td>{x.name}</td>
                  <td>{KIND_LABEL[x.kind]}</td>
                  <td>{x.rows}</td>
                  <td>{x.columns.join(", ") || "—"}</td>
                  <td>{x.ignored.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {issues.length > 0 ? (
            <>
              <p className="test-bar-sub">Left out (fix them in the workbook; the next sync picks them up):</p>
              <ul className="test-issues" data-testid="test-issues">
                {issues.map((i, n) => (
                  <li key={n}>
                    <b>
                      {i.sheet}
                      {i.row ? `, row ${i.row}` : ""}
                      {i.column ? ` · ${i.column}` : ""}
                    </b>
                    : {i.message}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="test-bar-sub">Every row was read.</p>
          )}
        </div>
      )}
      {check && (
        <div className="test-bar-details" role="region" aria-label="Connection check" data-testid="test-check-result">
          <div className="test-check-head">
            <b>{check.ok ? "✓ Connected to the workbook" : "✕ Could not read the workbook"}</b>
            <button className="icon-btn" onClick={() => setCheck(null)} aria-label="Close the connection check">
              ✕
            </button>
          </div>
          <ol className="test-steps">
            {check.steps.map((st) => (
              <li key={st.name} className={st.ok ? "ok" : "fail"}>
                <span aria-hidden="true">{st.ok ? "✓" : "✕"}</span> <b>{st.name}</b>: {st.detail}
              </li>
            ))}
          </ol>
          {check.error && (
            <p className="test-bar-hint">
              <b>What to do:</b> {check.error.hint}
              {check.error.code ? ` (${check.error.code}${check.error.status ? `, HTTP ${check.error.status}` : ""})` : ""}
            </p>
          )}
          {check.sheets.length > 0 && (
            <ul className="test-check-sheets">
              {check.sheets.map((sh) => (
                <li key={sh.name}>
                  <b>{sh.name}</b> ({sh.rows} row{sh.rows === 1 ? "" : "s"}){sheetKindOf(sh.name) ? "" : " · not one of the four sheets"}: {sh.columns.join(", ") || "no columns"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
