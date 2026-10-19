/**
 * Epilepsy's settings on the Admin page (request 61): the SharePoint
 * workbook the pages are built from (its link, and whether it can be read),
 * each company's colour, and (request 65) the names of the columns the pages
 * read, with the options of the dropdown columns.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  EPILEPSY_SHEETS,
  EPILEPSY_SHEET_NAME,
  EPI_COLUMNS,
  EPI_TABLES,
  EPI_TABLE_KEYS,
  HEX_COLOUR,
  acceptedOptions,
  columnHeader,
  epiLabel,
  headerScale,
  isUsdField,
  normaliseHeader,
  orderColumns,
  type EpiTableKey,
  type EpilepsyData,
  type EpilepsySheet,
  type EpilepsySyncStatus,
  type Me,
} from "@eradigm/shared";
import { api } from "../../../api/client";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { localDateTime } from "../../../lib/format";
import { useToast } from "../../../state/toast";
import { useEpilepsyData, useEpilepsyRawData, useEpilepsyStatus, useEpilepsySync } from "../api/hooks";
import { colourMap, companies, moneyText } from "../model";
import "../styles/epilepsy.css";

export function EpilepsyAdmin({ me }: { me: Me }) {
  if (me.role !== "admin") return null;
  return (
    <>
      <ErrorBoundary label="Epilepsy workbook">
        <WorkbookCard />
      </ErrorBoundary>
      <ErrorBoundary label="Column names">
        <ColumnsCard />
      </ErrorBoundary>
      <ErrorBoundary label="Table columns">
        <TableOrderCard />
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

type BySheet<T> = Partial<Record<EpilepsySheet, Record<string, T>>>;

/**
 * Request 65: Admin → Column names. Sheet by sheet, every column the pages
 * read: where it is used, the workbook's column it is read from (found by
 * its name, or picked here) and its first value. Then the sheet's dropdown
 * columns: the options the workbook's dropdown allows, and options added
 * here that the platform accepts too (the workbook is not changed).
 */
function ColumnsCard() {
  const raw = useEpilepsyRawData();
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<EpilepsySheet>("profiles");
  const [draft, setDraft] = useState<BySheet<string> | null>(null);
  const d = raw.data;
  if (!d) return null;
  const saved = d.columnNames ?? {};
  const names = draft ?? saved;
  const s = d.sheets[sheet];
  const pickedOf = (name: string) => names[sheet]?.[name] ?? "";
  const setPick = (name: string, header: string) => {
    const next: BySheet<string> = { ...names, [sheet]: { ...(names[sheet] ?? {}) } };
    if (header) next[sheet]![name] = header;
    else delete next[sheet]![name];
    setDraft(next);
  };
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(saved);
  const firstValue = (header: string | null) => {
    if (!s || !header) return "";
    const i = s.columns.indexOf(header);
    return i < 0 ? "" : (s.rows.map((r) => (r[i] ?? "").trim()).find(Boolean) ?? "");
  };
  const read = new Set<string>();
  const rows = EPI_COLUMNS[sheet].map((c) => {
    const picked = pickedOf(c.name);
    const pickedHere = picked ? (s?.columns.find((h) => normaliseHeader(h) === normaliseHeader(picked)) ?? null) : null;
    const header = picked ? pickedHere : columnHeader(s, c.name);
    if (header) read.add(header);
    return { ...c, picked, header };
  });
  const missing = rows.filter((r) => !r.header).length;
  const unused = (s?.columns ?? []).filter((h) => h && !read.has(h));

  const save = async () => {
    try {
      // Only the columns the pages read now (a column they no longer read is dropped).
      const current = Object.fromEntries(
        EPILEPSY_SHEETS.map((k) => {
          const known = new Set(EPI_COLUMNS[k].map((c) => normaliseHeader(c.name)));
          return [k, Object.fromEntries(Object.entries(names[k] ?? {}).filter(([n]) => known.has(normaliseHeader(n))))];
        }),
      );
      await api("/api/epilepsy/settings", { method: "PUT", json: { columnNames: current } });
      await qc.invalidateQueries({ queryKey: ["epilepsy", "data"] });
      setDraft(null);
      toast("Column names saved");
    } catch (e) {
      toast((e as Error).message, false);
    }
  };

  return (
    <section className="card" aria-labelledby="epi-cols-title" data-testid="epi-columns">
      <div>
        <h2 className="card-title" id="epi-cols-title">
          Column names
        </h2>
        <span className="card-sub">
          What each column must be called in the workbook for the Epilepsy pages to read it. A column is found by its name: capitals, spaces, punctuation and a currency note such as “(USD)” do not matter. If the
          workbook calls a column something else, pick it under “Read from”. Money columns are in US dollars; a note such as “(USD m)” in the name counts plain numbers in millions.
        </span>
      </div>
      <div className="seg epi-sheet-seg" role="group" aria-label="Sheet">
        {EPILEPSY_SHEETS.map((k) => (
          <button key={k} aria-pressed={sheet === k} onClick={() => setSheet(k)}>
            {EPILEPSY_SHEET_NAME[k]}
          </button>
        ))}
      </div>
      <p className="card-sub epi-cols-note">
        {s ? (
          <>
            Read from the sheet “{s.name}” · {EPI_COLUMNS[sheet].length} columns read by the pages
            {missing ? (
              <b className="epi-missing">
                {" "}
                · {missing} not found in the sheet
              </b>
            ) : (
              " · all found"
            )}
          </>
        ) : (
          <>Not in the workbook yet: the sheet's name must start with its number and “Platform”, as in “{EPILEPSY_SHEET_NAME[sheet]}”.</>
        )}
      </p>
      <div className="table-wrap epi-cols-wrap">
        <table className="data epi-cols" data-testid="epi-columns-table">
          <caption className="sr-only">Columns read from {EPILEPSY_SHEET_NAME[sheet]}</caption>
          <thead>
            <tr>
              <th scope="col">Column name the pages read</th>
              <th scope="col">Used on</th>
              <th scope="col">Read from (the workbook's column)</th>
              <th scope="col">First value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const first = firstValue(r.header);
              return (
                <tr key={r.name} className={r.header ? undefined : "epi-col-missing"}>
                  <th scope="row" className="epi-col-name">
                    {epiLabel(r.name)}
                  </th>
                  <td className="epi-col-used">{r.usedOn.join(" · ")}</td>
                  <td>
                    <select className="control" value={r.picked} onChange={(e) => setPick(r.name, e.target.value)} aria-label={`Workbook column for ${r.name}`} disabled={!s}>
                      <option value="">{r.picked ? "Find it by its name" : r.header ? `Found by its name: “${r.header}”` : "Not found by its name: pick its column"}</option>
                      {(s?.columns ?? []).filter(Boolean).map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                      {r.picked && !r.header && <option value={r.picked}>{r.picked} (not in the sheet now)</option>}
                    </select>
                    {!r.header && <span className="epi-col-status">✕ Not found</span>}
                  </td>
                  <td className="epi-col-first">
                    {first ? (
                      <>
                        <span>{first}</span>
                        {isUsdField(r.name) && <span className="epi-col-reads">reads as {moneyText(first, headerScale(r.header))} (USD)</span>}
                      </>
                    ) : (
                      <span className="epi-col-reads">{r.header ? "empty" : "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {unused.length > 0 && <p className="card-sub">Other columns in this sheet (not read by the pages): {unused.join(", ")}</p>}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn" disabled={!dirty} onClick={() => void save()} data-testid="epi-columns-save">
          Save column names
        </button>
        {dirty && (
          <button className="btn secondary" onClick={() => setDraft(null)}>
            Undo changes
          </button>
        )}
      </div>
      <DropdownOptions data={d} sheet={sheet} />
    </section>
  );
}

/** Request 65: a sheet's dropdown columns: the workbook's options, and options added here (the platform accepts them; the workbook is not changed). */
function DropdownOptions({ data, sheet }: { data: EpilepsyData; sheet: EpilepsySheet }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const s = data.sheets[sheet];
  const workbook = data.dropdowns?.[sheet];
  const added = data.addedOptions?.[sheet] ?? {};
  const columns = [...new Set([...Object.keys(workbook ?? {}), ...Object.keys(added)])].sort((a, b) => (s?.columns.indexOf(a) ?? 0) - (s?.columns.indexOf(b) ?? 0));
  const send = async (column: string, options: string[], done: string) => {
    const next = { ...(data.addedOptions ?? {}), [sheet]: { ...added, [column]: options } };
    if (!options.length) delete next[sheet]![column];
    try {
      await api("/api/epilepsy/settings", { method: "PUT", json: { addedOptions: next } });
      await qc.invalidateQueries({ queryKey: ["epilepsy", "data"] });
      toast(done);
      return true;
    } catch (e) {
      toast((e as Error).message, false);
      return false;
    }
  };
  const add = async (column: string, option: string) => {
    const o = option.trim();
    if (!o) return;
    if (acceptedOptions(workbook?.[column], added[column]).some((x) => x.toLowerCase() === o.toLowerCase())) return toast(`“${o}” is already an option of ${column}`, false);
    if (await send(column, [...(added[column] ?? []), o], `“${o}” added to ${column}`)) setTyped((t) => ({ ...t, [column]: "" }));
  };
  return (
    <div className="epi-dropdowns" data-testid="epi-dropdowns">
      <h3 className="epi-sub-title">Dropdown columns</h3>
      <p className="card-sub">
        The options each dropdown column allows in the workbook, read with the sheet. Options added here are accepted by the platform too (the page filters offer them); the workbook is not changed, so use the value in
        Excel when you need it.
      </p>
      {workbook === undefined && <div className="empty">This sheet's dropdowns have not been read yet: use “↻ Read it now” above.</div>}
      {workbook !== undefined && !columns.length && <div className="empty">This sheet has no dropdown columns in the workbook.</div>}
      {columns.map((column) => {
        const own = workbook?.[column] ?? [];
        const extra = added[column] ?? [];
        const accepted = acceptedOptions(own, extra);
        const i = s?.columns.indexOf(column) ?? -1;
        const used = i < 0 ? [] : [...new Set((s?.rows ?? []).map((r) => (r[i] ?? "").trim()).filter(Boolean))];
        const outside = used.filter((v) => !accepted.some((a) => a.toLowerCase() === v.toLowerCase()));
        const id = `epi-dd-${normaliseHeader(column)}`;
        return (
          <div className="epi-dropdown" key={column} data-testid="epi-dropdown">
            <div className="epi-dropdown-head">
              <b>{column}</b>
              <span className="card-sub">
                {accepted.length} {accepted.length === 1 ? "option" : "options"}
                {extra.length ? ` · ${extra.length} added here` : ""}
                {i < 0 ? " · not in the sheet now" : ""}
              </span>
            </div>
            <ul className="epi-chips" aria-label={`Options of ${column}`}>
              {own.map((o) => (
                <li key={`w-${o}`} className="epi-chip" title="In the workbook's dropdown">
                  {o}
                </li>
              ))}
              {extra.map((o) => (
                <li key={`a-${o}`} className="epi-chip added" title="Added here (accepted by the platform)">
                  {o}
                  <button className="epi-chip-x" onClick={() => void send(column, extra.filter((x) => x !== o), `“${o}” removed from ${column}`)} aria-label={`Remove the option ${o} from ${column}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {outside.length > 0 && (
              <div className="epi-outside" role="note">
                <span>In the sheet but not an option:</span>
                {outside.map((v) => (
                  <button key={v} className="btn secondary small" onClick={() => void add(column, v)} aria-label={`Add ${v} as an option of ${column}`}>
                    + {v}
                  </button>
                ))}
              </div>
            )}
            <form
              className="epi-add-option"
              onSubmit={(e) => {
                e.preventDefault();
                void add(column, typed[column] ?? "");
              }}
            >
              <label htmlFor={id} className="sr-only">
                New option for {column}
              </label>
              <input id={id} className="control" value={typed[column] ?? ""} onChange={(e) => setTyped((t) => ({ ...t, [column]: e.target.value }))} placeholder="New option…" maxLength={300} />
              <button className="btn secondary small" disabled={!(typed[column] ?? "").trim()}>
                + Add option
              </button>
            </form>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Request 67: Admin → Table columns. Each Epilepsy table's columns in the
 * order its page shows them: drag a column (or use its arrows) to move it,
 * then Save. Reset puts the table back in its default order.
 */
function TableOrderCard() {
  const raw = useEpilepsyRawData();
  const qc = useQueryClient();
  const toast = useToast();
  const [table, setTable] = useState<EpiTableKey>("rca");
  const [draft, setDraft] = useState<Partial<Record<EpiTableKey, string[]>>>({});
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const d = raw.data;
  if (!d) return null;
  const saved = (k: EpiTableKey) => orderColumns(EPI_TABLES[k].columns, d.columnOrder?.[k]);
  const order = draft[table] ?? saved(table);
  const isDefault = order.join("|") === [...EPI_TABLES[table].columns].join("|");
  const dirty = EPI_TABLE_KEYS.some((k) => draft[k] && draft[k]!.join("|") !== saved(k).join("|"));
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= order.length) return;
    const next = [...order];
    const [c] = next.splice(from, 1);
    next.splice(to, 0, c!);
    setDraft((x) => ({ ...x, [table]: next }));
  };
  const save = async () => {
    try {
      const columnOrder: Partial<Record<EpiTableKey, string[]>> = {};
      for (const k of EPI_TABLE_KEYS) {
        const o = draft[k] ?? saved(k);
        // A table in its default order is not kept (it follows the defaults, new columns included).
        if (o.join("|") !== [...EPI_TABLES[k].columns].join("|")) columnOrder[k] = o;
      }
      await api("/api/epilepsy/settings", { method: "PUT", json: { columnOrder } });
      await qc.invalidateQueries({ queryKey: ["epilepsy", "data"] });
      setDraft({});
      toast("Column order saved");
    } catch (e) {
      toast((e as Error).message, false);
    }
  };
  return (
    <section className="card" aria-labelledby="epi-order-title" data-testid="epi-table-order">
      <div>
        <h2 className="card-title" id="epi-order-title">
          Table columns
        </h2>
        <span className="card-sub">The order of the columns in each Epilepsy table. Drag a column to move it (or use its arrows), then save.</span>
      </div>
      <div className="seg epi-sheet-seg" role="group" aria-label="Table">
        {EPI_TABLE_KEYS.map((k) => (
          <button key={k} aria-pressed={table === k} onClick={() => setTable(k)}>
            {EPI_TABLES[k].label}
            {draft[k] && draft[k]!.join("|") !== saved(k).join("|") ? " •" : ""}
          </button>
        ))}
      </div>
      <ol className="epi-order" aria-label={`Columns of ${EPI_TABLES[table].label}, in order`} data-testid="epi-order-list">
        {order.map((c, i) => (
          <li
            key={c}
            className={`epi-order-item${dragging === i ? " dragging" : ""}${over === i && dragging !== null && dragging !== i ? " over" : ""}`}
            draggable
            onDragStart={(e) => {
              setDragging(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", c);
            }}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) move(dragging, i);
              setDragging(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
          >
            <span className="epi-order-grip" aria-hidden="true">
              ⋮⋮
            </span>
            <span className="epi-order-n">{i + 1}</span>
            <span className="epi-order-name">{c}</span>
            <button type="button" className="icon-btn" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${c} up`} title="Move up">
              ↑
            </button>
            <button type="button" className="icon-btn" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label={`Move ${c} down`} title="Move down">
              ↓
            </button>
          </li>
        ))}
      </ol>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" disabled={!dirty} onClick={() => void save()} data-testid="epi-order-save">
          Save column order
        </button>
        {dirty && (
          <button className="btn secondary" onClick={() => setDraft({})}>
            Undo changes
          </button>
        )}
        <button className="btn secondary" disabled={isDefault} onClick={() => setDraft((x) => ({ ...x, [table]: [...EPI_TABLES[table].columns] }))}>
          Reset to the default order
        </button>
      </div>
    </section>
  );
}
