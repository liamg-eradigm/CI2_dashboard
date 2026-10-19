/**
 * Minimal spreadsheet reader for the one-off tracker import: the first sheet
 * of an .xlsx workbook, or a .csv / .tsv file, as a grid of strings.
 *
 * It runs in the browser (so the Workers Free plan CPU budget is not spent on
 * parsing) and in tests. It reads cell values only: formulas give their
 * cached result, formatting is ignored, and dates stored as Excel serial
 * numbers are converted where a date is expected (see `excelDate`).
 */

export type Grid = string[][];

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

/** RFC 4180-style parsing: quoted fields, doubled quotes, CRLF/LF, optional BOM. */
export function parseDelimited(text: string, delimiter: "," | "\t"): Grid {
  const s = text.replace(/^\uFEFF/, "");
  const rows: Grid = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// XLSX (a ZIP of XML parts)
// ---------------------------------------------------------------------------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as unknown as ArrayBuffer]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read named entries from a ZIP archive (stored or deflated), via the central directory. */
async function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx file (no ZIP directory found)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Not a valid .xlsx file (damaged ZIP directory)");
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new Error(`Unsupported compression in .xlsx (method ${method})`);
  }
  return out;
}

const XML_ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (XML_ENT[e.toLowerCase()] ?? _),
  );
}

/** All text of <t> runs inside a fragment (handles rich text <r><t>…</t></r>). */
function runs(fragment: string): string {
  let out = "";
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += xmlText(m[1] ?? "");
  return out;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** How a numeric cell is shown (request 61, `formats`): a percentage, a date, or as stored. */
type NumberStyle = "percent" | "date" | null;

/** Each cell style's kind (styles.xml cellXfs → its number format). */
function numberStyles(xml: string): NumberStyle[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"/g)) custom.set(Number(m[1]), xmlText(m[2] ?? ""));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  return [...xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].map((m) => {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(m[1] ?? "")?.[1] ?? 0);
    if (id === 9 || id === 10) return "percent";
    if ((id >= 14 && id <= 17) || id === 22) return "date";
    const code = custom.get(id);
    if (!code) return null;
    // Quoted text and [colour]/[locale] parts are not the format itself.
    const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    if (bare.includes("%")) return "percent";
    if (/[dy]/i.test(bare) || /m{3,}/i.test(bare) || (/m/i.test(bare) && !/[hs]/i.test(bare) && /[dy/-]/i.test(bare))) return "date";
    return null;
  });
}

/** A stored number tidied for reading: no floating-point noise (0.30000000000000004 → 0.3). */
const tidyNumber = (n: number) => String(Number(n.toPrecision(12)));

/** A worksheet's cells as a grid of strings (shared strings resolved; with `styles`, percentages and dates as Excel shows them). */
function sheetGrid(xml: string, shared: string[], styles?: NumberStyle[]): Grid {
  const grid: Grid = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rAttr = /\br="(\d+)"/.exec(rm[1] ?? "");
    const rowIdx = rAttr ? Number(rAttr[1]) - 1 : grid.length;
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? "";
      const body = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : next;
      next = idx + 1;
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (t === "s") value = shared[Number(v)] ?? "";
      else if (t === "inlineStr") value = runs(body);
      else if (t === "b") value = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else value = v != null ? xmlText(v) : "";
      if (styles && (t == null || t === "n") && v != null && value !== "" && Number.isFinite(Number(value))) {
        const style = styles[Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0)] ?? null;
        const n = Number(value);
        value = style === "percent" ? `${tidyNumber(n * 100)}%` : style === "date" ? excelDate(value) : tidyNumber(n);
      }
      while (row.length < idx) row.push("");
      row[idx] = value;
    }
    while (grid.length < rowIdx) grid.push([]);
    grid[rowIdx] = row;
  }
  return grid;
}

/** A cell reference's column and row (“$AB$12” → 27, 11), 0-based; the row is null for a whole column. */
function cellRef(ref: string): { col: number; row: number | null } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)?$/i.exec(ref.trim());
  if (!m) return null;
  return { col: colIndex(m[1]!.toUpperCase()), row: m[2] ? Number(m[2]) - 1 : null };
}

/** Request 65: one sheet's dropdowns: column (0-based) → the options its data validation list allows. */
export type SheetLists = Record<number, string[]>;

/**
 * Request 65: each worksheet's dropdowns (data validation of type “list”):
 * the options typed into the rule (“A,B,C”), or the cells of the range it
 * names (on any sheet, directly or by a defined name). Rules Excel works out
 * as it goes (INDIRECT, OFFSET…) are left out.
 */
function sheetLists(xml: string, sheetName: string, gridOf: (name: string) => Grid | null, names: Map<string, string>): SheetLists {
  const out: SheetLists = {};
  const rules: { sqref: string; formula: string }[] = [];
  for (const m of xml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)) {
    if (!/\btype="list"/.test(m[1] ?? "")) continue;
    rules.push({ sqref: /\bsqref="([^"]+)"/.exec(m[1] ?? "")?.[1] ?? "", formula: xmlText(/<formula1>([\s\S]*?)<\/formula1>/.exec(m[2] ?? "")?.[1] ?? "") });
  }
  // Excel 2010+ writes rules that point at another sheet in an extension.
  for (const m of xml.matchAll(/<x14:dataValidation\b([^>]*)>([\s\S]*?)<\/x14:dataValidation>/g)) {
    if (!/\btype="list"/.test(m[1] ?? "")) continue;
    const body = m[2] ?? "";
    rules.push({ sqref: /<xm:sqref>([\s\S]*?)<\/xm:sqref>/.exec(body)?.[1] ?? "", formula: xmlText(/<x14:formula1>\s*<xm:f>([\s\S]*?)<\/xm:f>/.exec(body)?.[1] ?? "") });
  }
  const resolve = (formula: string, depth = 0): string[] | null => {
    const f = formula.trim().replace(/^=/, "");
    if (!f) return null;
    const literal = /^"([\s\S]*)"$/.exec(f);
    if (literal) return literal[1]!.split(",").map((x) => x.trim());
    const named = names.get(f.toLowerCase());
    if (named && depth < 3) return resolve(named, depth + 1);
    const r = /^(?:'((?:[^']|'')+)'|([^!'"()]+))?!?(\$?[A-Z]{1,3}\$?\d*)(?::(\$?[A-Z]{1,3}\$?\d*))?$/i.exec(f);
    if (!r || /[()]/.test(f)) return null;
    const sheet = r[1] ? r[1].replace(/''/g, "'") : r[2] && f.includes("!") ? r[2] : sheetName;
    const grid = gridOf(sheet);
    const from = cellRef(r[3]!);
    const to = r[4] ? cellRef(r[4]) : from;
    if (!grid || !from || !to) return null;
    const values: string[] = [];
    const lastRow = Math.min(to.row ?? grid.length - 1, grid.length - 1);
    for (let row = from.row ?? 0; row <= lastRow; row++) for (let col = from.col; col <= to.col; col++) values.push(grid[row]?.[col] ?? "");
    return values;
  };
  for (const rule of rules) {
    const options = resolve(rule.formula);
    if (!options) continue;
    const clean = [...new Set(options.map((o) => o.trim()).filter(Boolean))];
    if (!clean.length) continue;
    for (const part of rule.sqref.split(/\s+/).filter(Boolean)) {
      const [a, b] = part.split(":");
      const from = cellRef(a ?? "");
      const to = b ? cellRef(b) : from;
      if (!from || !to) continue;
      for (let col = from.col; col <= to.col; col++) out[col] = [...new Set([...(out[col] ?? []), ...clean])];
    }
  }
  return out;
}

/** Every worksheet of an .xlsx workbook, in workbook order, by name (request 55: the SharePoint workbook). With `lists`, each sheet's dropdowns too (request 65). */
export async function parseXlsxBook(bytes: Uint8Array, only?: (name: string) => boolean, opts: { formats?: boolean; lists?: boolean } = {}): Promise<{ name: string; grid: Grid; lists?: SheetLists }[]> {
  const parts = await unzip(
    bytes,
    (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || (!!opts.formats && n === "xl/styles.xml") || /^xl\/worksheets\/[^/]+\.xml$/.test(n),
  );
  const dec = new TextDecoder();
  const text = (n: string) => (parts.has(n) ? dec.decode(parts.get(n)) : "");
  const rels = text("xl/_rels/workbook.xml.rels");
  const target = (rid: string) => {
    const rel =
      new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`).exec(rels) ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid}"`).exec(rels);
    return rel?.[1] ? (rel[1].startsWith("/") ? rel[1].slice(1) : `xl/${rel[1].replace(/^\.\//, "")}`) : null;
  };
  const sheets = [...text("xl/workbook.xml").matchAll(/<sheet\b([^>]*)\/?>/g)].map((m, i) => ({
    name: xmlText(/\bname="([^"]*)"/.exec(m[1] ?? "")?.[1] ?? `Sheet${i + 1}`),
    path: target(/\br:id="([^"]+)"/.exec(m[1] ?? "")?.[1] ?? "") ?? `xl/worksheets/sheet${i + 1}.xml`,
  }));
  if (!sheets.length) {
    const any = [...parts.keys()].filter((n) => n.startsWith("xl/worksheets/")).sort()[0];
    if (!any) throw new Error("The workbook has no worksheet");
    sheets.push({ name: "Sheet1", path: any });
  }
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1] ?? ""));
  const styles = opts.formats ? numberStyles(text("xl/styles.xml")) : undefined;
  const grids = new Map<string, Grid>();
  const gridOf = (name: string): Grid | null => {
    const sh = sheets.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!sh) return null;
    if (!grids.has(sh.name)) grids.set(sh.name, parts.has(sh.path) ? sheetGrid(text(sh.path), shared, styles) : []);
    return grids.get(sh.name)!;
  };
  const names = new Map<string, string>();
  if (opts.lists) for (const m of text("xl/workbook.xml").matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) names.set(xmlText(/\bname="([^"]*)"/.exec(m[1] ?? "")?.[1] ?? "").toLowerCase(), xmlText(m[2] ?? ""));
  return sheets
    .filter((sh) => !only || only(sh.name))
    .map((sh) => ({ name: sh.name, grid: gridOf(sh.name)!, ...(opts.lists ? { lists: parts.has(sh.path) ? sheetLists(text(sh.path), sh.name, gridOf, names) : {} } : {}) }));
}

/** The first worksheet of an .xlsx workbook as a grid of strings. */
export async function parseXlsx(bytes: Uint8Array): Promise<Grid> {
  const [first] = await parseXlsxBook(bytes);
  return first?.grid ?? [];
}

/** Read a spreadsheet by file name (.xlsx, .csv or .tsv). */
export async function parseSpreadsheet(bytes: Uint8Array, fileName: string): Promise<Grid> {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (ext === "xlsx") return parseXlsx(bytes);
  const text = new TextDecoder().decode(bytes);
  if (ext === "csv") return parseDelimited(text, ",");
  if (ext === "tsv" || ext === "tab") return parseDelimited(text, "\t");
  throw new Error("Choose an .xlsx, .csv or .tsv file");
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * A date cell as YYYY-MM-DD: accepts ISO dates (or ISO date-times), Excel
 * serial numbers (days since 1899-12-30, the 1900 date system) and
 * DD/MM/YYYY. Anything else is returned unchanged (and fails validation).
 */
export function excelDate(v: string): string {
  const s = v.trim();
  if (!s) return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n > 59 && n < 2958466) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
  }
  const uk = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (uk) return `${uk[3]}-${uk[2]!.padStart(2, "0")}-${uk[1]!.padStart(2, "0")}`;
  return s;
}
