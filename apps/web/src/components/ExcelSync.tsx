import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EXCEL_WORKBOOK_NAME, sheetKindOf, type ExcelCheck, type ExcelSyncStatus } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";

const STATUS_KEY = ["excel-status"];
/** Request 56: the Test pages check the workbook this often while they are open and in view. */
export const TEST_SYNC_MS = 10_000;
/** The Admin page's section about it (the Test pages' ! link opens it). */
export const EXCEL_SECTION_ID = "excel-sync";

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

/** Whether the sync needs an admin's attention (rows left out, or the workbook could not be read). */
export const syncNeedsAttention = (s: ExcelSyncStatus | undefined) => !!s && (s.issues.length > 0 || s.status === "error" || !s.configured);

/**
 * Request 56: Admin → Test tab · SharePoint workbook (it was the Test pages'
 * bar, request 55). When the test space was last synced and what it holds;
 * Sync now; Check connection (the test endpoint: sign-in, the workbook, its
 * worksheets and their columns); the sheets read and every row left out, and why.
 */
export function ExcelSyncCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => api<ExcelSyncStatus>("/api/excel/status"), refetchInterval: 15_000 });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ExcelCheck | null>(null);
  const ref = useRef<HTMLElement>(null);
  const s = status.data;

  // Opened from a Test page's ! link: scroll here.
  useEffect(() => {
    if (window.location.hash === `#${EXCEL_SECTION_ID}` && s) ref.current?.scrollIntoView({ block: "start" });
  }, [s]);

  const syncNow = async () => {
    setBusy(true);
    try {
      let r = await api<ExcelSyncStatus>("/api/excel/sync", { method: "POST", json: { force: true } });
      // Large changes are applied a few rows at a time: carry on until they are all in.
      for (let n = 0; r.more && n < 60; n++) r = await api<ExcelSyncStatus>("/api/excel/sync", { method: "POST", json: {} });
      qc.setQueryData(STATUS_KEY, r);
      if (r.status === "error") toast(`Sync failed · ${r.message ?? "see the Test tab section"}`, false);
      else toast("Synced from the workbook");
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
            : `Synced ${ago(s.lastSyncedAt)} · last checked ${ago(s.lastCheckedAt)} (every 10 seconds while a Test page is open, else every minute)`;
  const issues = s?.issues ?? [];
  const attention = syncNeedsAttention(s);

  return (
    <section className={`card excel-card${attention ? " problem" : ""}`} aria-labelledby="excel-title" id={EXCEL_SECTION_ID} data-testid="excel-sync" ref={ref}>
      <div className="card-head excel-head">
        <div>
          <h2 className="card-title" id="excel-title">
            Test tab · SharePoint workbook
          </h2>
          <span className="card-sub">
            The Test tab shows only what{" "}
            {s?.file?.url ? (
              <a href={s.file.url} target="_blank" rel="noopener noreferrer">
                {name}
              </a>
            ) : (
              name
            )}{" "}
            says.
          </span>
        </div>
        <div className="excel-actions">
          <button className="btn secondary small" onClick={() => void runCheck()} disabled={checking} data-testid="test-check">
            {checking ? "Checking…" : "Check connection"}
          </button>
          <button className="btn small" onClick={() => void syncNow()} disabled={busy} data-testid="test-sync">
            {busy ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>
      <p className="excel-status" role="status" data-testid="test-bar-status">
        {line}
        {counts && (
          <>
            {" "}
            · Holds {counts.primary} Primary, {counts.secondary} Secondary, {counts.competitors} Company Profile{counts.competitors === 1 ? "" : "s"}, {counts.macrotrends} Macrotrend
            {counts.macrotrends === 1 ? "" : "s"}
          </>
        )}
      </p>
      {s?.problem && <p className="excel-hint">{s.problem.hint}</p>}
      {check && (
        <div className="excel-box" role="region" aria-label="Connection check" data-testid="test-check-result">
          <div className="excel-box-head">
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
            <p className="excel-hint">
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
      {s && s.sheets.length > 0 && (
        <div className="excel-box">
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
        </div>
      )}
      {issues.length > 0 && (
        <div className="excel-box problems" data-testid="test-issues">
          <b>
            {issues.length} problem{issues.length === 1 ? "" : "s"}: left out (fix them in the workbook; the next sync picks them up)
          </b>
          <ul className="test-issues">
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
        </div>
      )}
    </section>
  );
}

interface TestSync {
  status: ExcelSyncStatus | null;
  /** When this page last heard from the workbook (every check, not only those the API records). */
  checkedAt: number | null;
  busy: boolean;
  /** A sync just changed the test space: "Data synced" shows for a moment. */
  synced: boolean;
  syncNow: () => void;
}
const TestSyncContext = createContext<TestSync | null>(null);

/**
 * Request 56: on the Test pages, the workbook is checked every 10 seconds while
 * the page is open and in view (Cloudflare's schedules run at most once a
 * minute, which stays the fallback when no Test page is open). A check that
 * finds nothing new costs one call to Microsoft and no database write. When a
 * sync changes the test space, the page reads it again and a small green
 * "Data synced" shows for a moment. Problems are on the Admin page: a ! here
 * says there are some and leads there. Request 57: the pages' Sync now button
 * (TestSyncButton) reads the whole workbook at once, through the same loop,
 * and "Data synced" shows beside it.
 */
export function TestSpaceSync({ enabled = true, children }: { enabled?: boolean; children?: ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<ExcelSyncStatus | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [synced, setSynced] = useState(0);
  const [manual, setManual] = useState(false);
  const seen = useRef<string | null | undefined>(undefined);
  const busy = useRef(false);
  /** Sync now was pressed: the next check reads the whole workbook (now, or as soon as the one under way ends). */
  const wanted = useRef(false);
  const tickRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const applied = (x: ExcelSyncStatus) => x.applied.created + x.applied.updated + x.applied.deleted + x.applied.trends;
    const tick = async () => {
      if (busy.current || (!wanted.current && document.visibilityState !== "visible")) return;
      busy.current = true;
      const force = wanted.current;
      wanted.current = false;
      if (force) setManual(true);
      try {
        let r = await api<ExcelSyncStatus>("/api/excel/sync", { method: "POST", json: force ? { force: true } : {} });
        let changed = applied(r);
        for (let n = 0; r.more && n < 60 && (force || !stop); n++) {
          r = await api<ExcelSyncStatus>("/api/excel/sync", { method: "POST", json: {} });
          changed += applied(r);
        }
        // (Kept even if this page was left meanwhile: the next look compares with it.)
        setStatus(r);
        setCheckedAt(Date.now());
        // A change made by this check, or since the page last looked (the every-minute one's): read it, and say so.
        if (changed > 0 || (seen.current !== undefined && r.lastChangeAt && r.lastChangeAt !== seen.current)) {
          await qc.invalidateQueries();
          setSynced(Date.now());
        } else if (force) {
          toast(r.status === "error" ? `Sync failed · ${r.message ?? "see Admin → Test tab · SharePoint workbook"}` : `Already up to date with the workbook${r.file?.modifiedAt ? ` (last saved ${localDateTime(r.file.modifiedAt)})` : ""}`, r.status !== "error");
        }
        seen.current = r.lastChangeAt;
      } catch (e) {
        if (force) toast(`Sync failed · ${(e as ApiError).message}`, false);
        /* Otherwise tried again at the next tick. */
      } finally {
        busy.current = false;
        if (force) setManual(false);
        // Sync now pressed during a check: run it now.
        if (wanted.current && !stop) void tick();
      }
    };
    tickRef.current = tick;
    void tick();
    const id = setInterval(() => void tick(), TEST_SYNC_MS);
    const onShow = () => document.visibilityState === "visible" && void tick();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [qc, toast, enabled]);

  // The green note goes by itself.
  useEffect(() => {
    if (!synced) return;
    const id = setTimeout(() => setSynced(0), 2600);
    return () => clearTimeout(id);
  }, [synced]);

  const value = useMemo<TestSync>(
    () => ({
      status,
      checkedAt,
      busy: manual,
      synced: synced > 0,
      syncNow: () => {
        wanted.current = true;
        setManual(true);
        void tickRef.current();
      },
    }),
    [status, checkedAt, manual, synced],
  );
  if (!enabled) return <>{children}</>;

  const n = status?.issues.length ?? 0;
  const label = !status
    ? ""
    : !status.configured
      ? "The Test tab is not connected to the workbook"
      : status.status === "error"
        ? "The last sync from the workbook failed"
        : `${n} row${n === 1 ? "" : "s"} of the workbook ${n === 1 ? "was" : "were"} left out`;
  return (
    <TestSyncContext.Provider value={value}>
      <span className="sr-only" role="status">
        {synced > 0 ? "Data synced" : ""}
      </span>
      {syncNeedsAttention(status ?? undefined) && (
        <a className="sync-alert" href={`/admin#${EXCEL_SECTION_ID}`} title={`${label}: see Admin`} aria-label={`${label}: see Admin`} data-testid="sync-alert">
          !
        </a>
      )}
      {children}
    </TestSyncContext.Provider>
  );
}

/** "Checked 5 s ago" (the time since this page last heard from the workbook). */
function checkedLine(at: number | null, now: number): string {
  if (!at) return "Checking the workbook…";
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 5 ? "Checked just now" : s < 60 ? `Checked ${s} s ago` : `Checked ${ago(new Date(at).toISOString())}`;
}

/**
 * Request 57: Sync now, at the top right of every Test page: in its header,
 * level with the bottom of the title (on the full-page graphs, in the corner
 * across from the graph toggle). When the page last checked the workbook sits
 * beside it. Nothing outside the Test pages.
 */
export function TestSyncButton() {
  const sync = useContext(TestSyncContext);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sync) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [sync]);
  if (!sync) return null;
  const saved = sync.status?.file?.modifiedAt;
  return (
    <div className="test-sync" data-testid="test-sync-bar">
      {sync.synced ? (
        <span className="synced-pop" aria-hidden="true" data-testid="data-synced">
          ✓ Data synced
        </span>
      ) : (
      <span className="test-sync-meta" title={saved ? `The workbook was last saved ${localDateTime(saved)}${sync.status?.file?.modifiedBy ? ` by ${sync.status.file.modifiedBy}` : ""}` : undefined} data-testid="test-sync-checked">
        {checkedLine(sync.checkedAt, Math.max(now, sync.checkedAt ?? 0))}
      </span>
      )}
      <button className="test-sync-btn" onClick={sync.syncNow} disabled={sync.busy} aria-label={sync.busy ? "Syncing the Test tab from the workbook" : "Sync the Test tab from the workbook now"} data-testid="test-sync-now">
        <svg className={sync.busy ? "spin" : undefined} viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
          <path d="M16 10a6 6 0 1 1-1.76-4.24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <path d="M16.2 3.2v3.6h-3.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{sync.busy ? "Syncing…" : "Sync now"}</span>
      </button>
    </div>
  );
}
