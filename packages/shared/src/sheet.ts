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

/** The first worksheet of an .xlsx workbook as a grid of strings. */
export async function parseXlsx(bytes: Uint8Array): Promise<Grid> {
  const parts = await unzip(bytes, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const dec = new TextDecoder();
  const text = (n: string) => (parts.has(n) ? dec.decode(parts.get(n)) : "");
  // First sheet in workbook order → its part via the relationships file.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const firstSheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(text("xl/workbook.xml"));
  if (firstSheet) {
    const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${firstSheet[1]}"[^>]*\\bTarget="([^"]+)"`).exec(text("xl/_rels/workbook.xml.rels"))
      ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${firstSheet[1]}"`).exec(text("xl/_rels/workbook.xml.rels"));
    if (rel?.[1]) sheetPath = rel[1].startsWith("/") ? rel[1].slice(1) : `xl/${rel[1].replace(/^\.\//, "")}`;
  }
  if (!parts.has(sheetPath)) {
    const any = [...parts.keys()].filter((n) => n.startsWith("xl/worksheets/")).sort()[0];
    if (!any) throw new Error("The workbook has no worksheet");
    sheetPath = any;
  }
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1] ?? ""));
  const grid: Grid = [];
  for (const rm of text(sheetPath).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
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
      while (row.length < idx) row.push("");
      row[idx] = value;
    }
    while (grid.length < rowIdx) grid.push([]);
    grid[rowIdx] = row;
  }
  return grid;
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
