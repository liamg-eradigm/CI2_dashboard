/**
 * Epilepsy's settings on the Admin page (request 61): the SharePoint
 * workbook the pages are built from (its link, and whether it can be read),
 * and each company's colour.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EPILEPSY_SHEETS, EPILEPSY_SHEET_NAME, HEX_COLOUR, type EpilepsySyncStatus, type Me } from "@eradigm/shared";
import { api } from "../../../api/client";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { localDateTime } from "../../../lib/format";
import { useToast } from "../../../state/toast";
import { useEpilepsyData, useEpilepsyStatus, useEpilepsySync } from "../api/hooks";
import { colourMap, companies } from "../model";
import "../styles/epilepsy.css";

export function EpilepsyAdmin({ me }: { me: Me }) {
  if (me.role !== "admin") return null;
  return (
    <>
      <ErrorBoundary label="Epilepsy workbook">
        <WorkbookCard />
      </ErrorBoundary>
      <ErrorBoundary label="Company colours">
        <ColoursCard />
      </ErrorBoundary>
    </>
  );
}

function WorkbookCard() {
  const status = useEpilepsyStatus();
  const sync = useEpilepsySync();
  const qc = useQueryClient();
  const toast = useToast();
  const s = status.data;
  const [link, setLink] = useState("");
  const [fileName, setFileName] = useState("");
  useEffect(() => {
    if (s) {
      setLink(s.link ?? "");
      setFileName(s.fileName);
    }
  }, [s?.link, s?.fileName]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const changed = link.trim() !== (s.link ?? "") || fileName.trim() !== s.fileName;
  const runSync = (force: boolean) =>
    sync.mutate(force, {
      onSuccess: (r) => toast(r.status === "error" ? (r.message ?? "The workbook could not be read") : "Data synced", r.status !== "error"),
      onError: (e) => toast((e as Error).message, false),
    });
  return (
    <section className="card" aria-labelledby="epi-wb-title" data-testid="epi-workbook">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="epi-wb-title">
            SharePoint workbook
          </h2>
          <span className="card-sub">
            The Epilepsy pages are built from four sheets of this workbook, read with Microsoft Graph by the same app as CI SQUARED's Test tab. It is checked every minute and read again when it changes.
          </span>
        </div>
        <span className={`tag ${s.status === "error" ? "err" : s.lastSyncedAt ? "ok" : "warn"}`}>{s.status === "error" ? "Needs attention" : s.lastSyncedAt ? "Connected" : "Not read yet"}</span>
      </div>
      <form
        className="epi-wb-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api<EpilepsySyncStatus>("/api/epilepsy/settings", { method: "PUT", json: { link: link.trim(), fileName: fileName.trim() } });
            qc.setQueryData(["epilepsy", "status"], r);
            toast("Saved: reading the workbook…");
            runSync(true);
          } catch (err) {
            toast((err as Error).message, false);
          }
        }}
      >
        <label className="field epi-wb-link">
          <span>Workbook link (SharePoint → Share → Copy link)</span>
          <input className="control" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://eradigm.sharepoint.com/:x:/s/…" />
        </label>
        <label className="field">
          <span>File name</span>
          <input className="control" value={fileName} onChange={(e) => setFileName(e.target.value)} required />
        </label>
        <button className="btn" disabled={!changed}>
          Save
        </button>
        <button type="button" className="btn secondary" disabled={sync.isPending || !s.link} onClick={() => runSync(true)}>
          {sync.isPending ? "Reading…" : "↻ Read it now"}
        </button>
      </form>
      <ul className="epi-wb-status">
        <li>
          <b>Last read:</b> {s.lastSyncedAt ? localDateTime(s.lastSyncedAt) : "never"}
          {s.lastCheckedAt && <> · checked {localDateTime(s.lastCheckedAt)}</>}
        </li>
        {s.file.name && (
          <li>
            <b>File:</b>{" "}
            {s.file.url ? (
              <a href={s.file.url} target="_blank" rel="noopener noreferrer">
                {s.file.name}
              </a>
            ) : (
              s.file.name
            )}
            {s.file.modifiedAt && <> · saved {localDateTime(s.file.modifiedAt)}{s.file.modifiedBy ? ` by ${s.file.modifiedBy}` : ""}</>}
          </li>
        )}
        {EPILEPSY_SHEETS.map((k) => (
          <li key={k}>
            <b>{EPILEPSY_SHEET_NAME[k]}:</b> {s.counts[k] == null ? "not read" : `${s.counts[k]} rows`}
          </li>
        ))}
      </ul>
      {s.message && <div className={s.status === "error" ? "err-msg" : "card-sub"}>{s.message}</div>}
      {s.problem && (
        <div className="epi-problem" role="alert">
          <b>What to fix:</b> {s.problem.hint}
          {s.problem.code && <span className="mono"> ({s.problem.code})</span>}
        </div>
      )}
    </section>
  );
}

function ColoursCard() {
  const data = useEpilepsyData();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useMemo(() => companies(data.data), [data.data]);
  const current = useMemo(() => colourMap(data.data), [data.data]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!data.data) return null;
  const valueOf = (c: string) => draft[c] ?? current(c);
  const dirty = Object.keys(draft).length > 0;
  const bad = Object.values(draft).some((v) => !HEX_COLOUR.test(v));
  return (
    <section className="card" aria-labelledby="epi-col-title" data-testid="epi-colours">
      <div>
        <h2 className="card-title" id="epi-col-title">
          Company colours
        </h2>
        <span className="card-sub">Each company's colour on the Epilepsy charts (a hex code like #2a78d6). Companies come from the workbook.</span>
      </div>
      {list.length ? (
        <div className="epi-colours">
          {list.map((c) => (
            <label key={c} className="epi-colour">
              <input type="color" value={HEX_COLOUR.test(valueOf(c)) ? valueOf(c) : "#000000"} onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))} aria-label={`${c} colour picker`} />
              <span className="epi-colour-name">{c}</span>
              <input className="control mono" value={valueOf(c)} onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value.trim() }))} aria-label={`${c} hex colour`} aria-invalid={!HEX_COLOUR.test(valueOf(c))} maxLength={7} />
            </label>
          ))}
        </div>
      ) : (
        <div className="empty">No companies yet: read the workbook first.</div>
      )}
      <div className="row" style={{ display: "flex", gap: 8 }}>
        <button
          className="btn"
          disabled={!dirty || bad}
          onClick={async () => {
            try {
              const colours = { ...(data.data?.colours ?? {}), ...draft };
              await api("/api/epilepsy/settings", { method: "PUT", json: { colours } });
              setDraft({});
              await qc.invalidateQueries({ queryKey: ["epilepsy", "data"] });
              toast("Colours saved");
            } catch (e) {
              toast((e as Error).message, false);
            }
          }}
        >
          Save colours
        </button>
        {dirty && (
          <button className="btn secondary" onClick={() => setDraft({})}>
            Undo changes
          </button>
        )}
        {bad && <span className="err-msg">Use a hex colour like #2a78d6.</span>}
      </div>
    </section>
  );
}
