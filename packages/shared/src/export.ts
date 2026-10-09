/**
 * Tracker export (3_Frontend_Design: "exported as csv, xlsx, tsv etc.").
 * Rows include Signal ID plus every current column, in the current sort order.
 *
 * The XLSX writer is a small dependency-free OOXML generator (stored ZIP, inline
 * strings, auto-fit column widths) so the API can produce workbooks inside a
 * Worker without shipping a large spreadsheet library.
 */
import { plainText } from "./richText.js";
import { trackerColumns, type TrackerColumn, type TrackerSchema } from "./schema.js";
import type { ItemValues } from "./validation.js";

export const EXPORT_FORMATS = ["csv", "xlsx", "tsv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  json: "application/json; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export interface ExportRow {
  signalId: string;
  values: ItemValues;
}

/** e.g. eradigm-tracker-filtered-2026-09-24.csv, eradigm-secondary-phantoms-all-2026-09-24.xlsx */
export function exportFilename(scope: "filtered" | "all", format: ExportFormat, today: string, view: { stream?: string; name?: "tracker" | "phantoms" | "database" } = {}): string {
  const prefix = view.stream && view.stream !== "primary" ? `${view.stream}-` : "";
  return `eradigm-${prefix}${view.name ?? "tracker"}-${scope}-${today}.${format}`;
}

function cellText(v: ItemValues[string] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? v.join(", ") : v;
}

/** Array-of-arrays with a header row. */
export function toTable(schema: TrackerSchema, rows: ExportRow[], cols: TrackerColumn[] = trackerColumns(schema)): string[][] {
  // Spreadsheets get long text without its formatting markup (request 46).
  return [["Signal ID", ...cols.map((c) => c.label)], ...rows.map((r) => [r.signalId, ...cols.map((c) => (c.type === "long" ? plainText(cellText(r.values[c.key])) : cellText(r.values[c.key])))])];
}

/** Neutralise spreadsheet formula injection (=, +, -, @, tab, CR at the start of a cell). */
export function safeCell(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(table: string[][]): string {
  const q = (x: string) => {
    const s = safeCell(x);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // UTF-8 BOM so Excel opens accented characters correctly.
  return "﻿" + table.map((r) => r.map(q).join(",")).join("\r\n");
}

export function toTsv(table: string[][]): string {
  return table.map((r) => r.map((x) => safeCell(x).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\r\n");
}

export function toJson(schema: TrackerSchema, rows: ExportRow[], cols: TrackerColumn[] = trackerColumns(schema)): string {
  return JSON.stringify(
    rows.map((r) => {
      const o: Record<string, unknown> = { "Signal ID": r.signalId };
      for (const c of cols) o[c.label] = c.type === "multi" ? (r.values[c.key] ?? []) : (r.values[c.key] ?? "");
      return o;
    }),
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Minimal XLSX writer
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

let CRC_TABLE: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = (CRC_TABLE[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP archive of uncompressed ("stored") entries: enough for .xlsx and .docx packages. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function xmlEscape(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these control characters
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function toXlsx(table: string[][], sheetName = "Tracker"): Uint8Array {
  return toXlsxSheets([{ name: sheetName, table }]);
}

/** Excel sheet names: at most 31 characters, none of : \\ / ? * [ ]. */
const sheetName = (s: string) => s.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet";

function sheetXml(table: string[][]): string {
  const width = Math.max(...table.map((r) => r.length), 1);
  const cols = Array.from({ length: width }, (_, i) => {
    const w = Math.min(60, Math.max(...table.map((r) => (r[i] ?? "").length), 4) + 2);
    return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
  }).join("");
  const rows = table
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r
          .map(
            (v, ci) =>
              `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
}

/** A workbook with one or more sheets (the first row of each in bold, frozen). */
export function toXlsxSheets(sheets: { name: string; table: string[][] }[]): Uint8Array {
  const n = sheets.length;
  const idx = Array.from({ length: n }, (_, i) => i + 1);
  const files = [
    {
      name: "[Content_Types].xml",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${idx.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(sheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${idx.map((i) => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join("")}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, xml: sheetXml(s.table) })),
  ];
  return zipStore(files.map((f) => ({ name: f.name, data: enc.encode(f.xml) })));
}
