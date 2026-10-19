/**
 * Epilepsy → RCA (request 61): the assets and trials of “4. Platform Trials &
 * Assets” in a table, filterable by its main columns; a row opens all its
 * fields, one per line, in a scrolling panel over the right half.
 */
import { useMemo, useState } from "react";
import { EPI_RCA_PANEL, EPI_RCA_TABLE, type Me } from "@eradigm/shared";
import { useEpilepsyData } from "../api/hooks";
import { EpiTable, cellText, type EpiColumn } from "../components/EpiTable";
import { Filters, distinct } from "../components/Filters";
import { PageHead } from "../components/PageHead";
import { FieldList, SidePanel } from "../components/SidePanel";
import { acceptedFor, records, type Rec } from "../model";

const COLUMNS: EpiColumn[] = EPI_RCA_TABLE.map((name) => ({ name, kind: /date/i.test(name) ? "date" : name === "Asset Name" ? "title" : "plain", width: name === "Epilepsy Indication/ Syndrome" ? 240 : /date/i.test(name) ? 150 : 170 }));
const FILTERS = ["Asset Name", "RoA (+frequency)", "MoA", "Current Phase", "Epilepsy Indication/ Syndrome"];
const isDate = (name: string) => /date|start$|pcd$/i.test(name);

export function RcaPage({ me }: { me: Me }) {
  const data = useEpilepsyData();
  const all = useMemo(() => records(data.data?.sheets.assets), [data.data]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState<Rec | null>(null);
  const rows = all.filter((r) => {
    for (const [name, vals] of Object.entries(picked)) if (vals.length && !vals.includes(r.get(name))) return false;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      const text = [...EPI_RCA_TABLE, "Company/competitor"].map((n) => r.get(n)).join(" ").toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
  return (
    <>
      <PageHead me={me} title="RCA" intro="Every asset and trial in “4. Platform Trials & Assets”. Open a row for all of its fields." />
      <div className="content">
        <Filters
          search={q}
          onSearch={setQ}
          choices={FILTERS.map((name) => ({ name, options: distinct([...all.map((r) => r.get(name)), ...acceptedFor(data.data, "assets", name)]), value: picked[name] ?? [] }))}
          onChoice={(name, v) => setPicked((p) => ({ ...p, [name]: v }))}
          onClear={() => {
            setQ("");
            setPicked({});
          }}
        />
        <section className="card flush pop-host" aria-label="RCA">
          <div className="table-top">
            <div className="ptr-head">
              <h2 className="card-title">Assets and trials</h2>
              <span className="card-sub info" aria-live="polite">
                {data.isLoading ? "Loading…" : `Showing ${rows.length} of ${all.length}`}
              </span>
            </div>
          </div>
          <EpiTable rows={rows} columns={COLUMNS} label="Assets and trials" initialSort={{ name: "Asset Name", dir: "asc" }} onOpen={setOpen} openIndex={open?.i} testId="rca-table" />
        </section>
      </div>
      {open && (
        <SidePanel title={open.get("Asset Name") || "Asset"} sub={<span>{[open.get("Company/competitor"), open.get("NCT Number")].filter(Boolean).join(" · ")}</span>} onClose={() => setOpen(null)} testId="rca-panel">
          <FieldList
            fields={EPI_RCA_PANEL.map((name) => {
              const v = cellText(open, { name, kind: isDate(name) ? "date" : "plain" });
              return { name, value: v ? <span className="epi-text">{v}</span> : "" };
            })}
          />
        </SidePanel>
      )}
    </>
  );
}
