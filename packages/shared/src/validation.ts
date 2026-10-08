/**
 * Data rules applied to every draft and every approval. The API runs these
 * server-side; the dashboard runs the same functions for instant feedback.
 */
import { plainText } from "./richText.js";
import {
  ALL,
  CORE,
  MAX_OPTION_LENGTH,
  getColumn,
  macroOfSubtrend,
  macrotrends,
  optionsOf,
  sortedColumns,
  subtrendsOf,
  type TrackerColumn,
  type TrackerSchema,
} from "./schema.js";

export type FieldValue = string | string[] | null;
export type ItemValues = Record<string, FieldValue>;

export type FieldErrorCode =
  | "required"
  | "not_in_taxonomy"
  | "invalid_date"
  | "reserved_value"
  | "subtrend_mismatch"
  | "too_long";

export interface FieldError {
  key: string;
  label: string;
  code: FieldErrorCode;
  message: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TEXT_LENGTH = 2000;
/** Long text (Header, Key Details, CI Perspective): paragraphs and line breaks are kept. */
export const MAX_LONG_TEXT_LENGTH = 20000;

export function isIsoDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function isEmpty(v: FieldValue | undefined): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return v.trim() === "";
}

/** Split a comma-separated competitor entry into a clean, de-duplicated list. */
export function splitMulti(v: FieldValue | undefined): string[] {
  if (v == null) return [];
  const parts = Array.isArray(v) ? v : v.split(",");
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Normalise raw values against the schema: trims text, turns multi-select
 * values into arrays, converts empty strings to null and drops unknown keys.
 */
export function normaliseValues(schema: TrackerSchema, raw: Record<string, unknown>): ItemValues {
  const out: ItemValues = {};
  for (const col of schema.columns) {
    const v = raw[col.key];
    if (col.type === "multi") {
      const list = splitMulti(Array.isArray(v) ? v.map(String) : typeof v === "string" ? v : null);
      out[col.key] = list.length ? list : null;
    } else if (v == null) {
      out[col.key] = null;
    } else if (col.type === "long") {
      const s = String(v)
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      out[col.key] = s === "" ? null : s;
    } else {
      const s = String(v).replace(/\s+/g, " ").trim();
      out[col.key] = s === "" ? null : s;
    }
  }
  return out;
}

/**
 * Validate values. With `forApproval`, required fields must be present.
 * Without it (saving a draft) only the value rules are checked.
 */
export function validateValues(
  schema: TrackerSchema,
  values: ItemValues,
  opts: { forApproval: boolean },
): FieldError[] {
  const errors: FieldError[] = [];
  const err = (col: TrackerColumn, code: FieldErrorCode, message: string) =>
    errors.push({ key: col.key, label: col.label, code, message });

  for (const col of sortedColumns(schema)) {
    const v = values[col.key];
    if (isEmpty(v)) {
      if (opts.forApproval && col.required) err(col, "required", `${col.label} is required`);
      continue;
    }
    switch (col.type) {
      case "date": {
        if (typeof v !== "string" || !isIsoDate(v)) err(col, "invalid_date", `${col.label} must be a valid date (YYYY-MM-DD)`);
        break;
      }
      case "text": {
        if (typeof v !== "string") err(col, "too_long", `${col.label} must be text`);
        else if (v.length > MAX_TEXT_LENGTH) err(col, "too_long", `${col.label} must be ${MAX_TEXT_LENGTH} characters or fewer`);
        break;
      }
      case "long": {
        if (typeof v !== "string") err(col, "too_long", `${col.label} must be text`);
        else if (v.length > MAX_LONG_TEXT_LENGTH) err(col, "too_long", `${col.label} must be ${MAX_LONG_TEXT_LENGTH} characters or fewer`);
        break;
      }
      case "multi": {
        const list = splitMulti(v);
        const allowed = optionsOf(schema, col);
        const bad = list.filter((x) => !allowed.includes(x));
        if (list.some((x) => x === ALL)) err(col, "reserved_value", `“${ALL}” cannot be stored as a ${col.label} value`);
        else if (bad.length) err(col, "not_in_taxonomy", `${col.label}: “${bad.join(", ")}” is not a tracked value`);
        break;
      }
      case "macro":
      case "sub":
      case "select": {
        if (typeof v !== "string" || v.length > MAX_OPTION_LENGTH) {
          err(col, "not_in_taxonomy", `${col.label} must be one of the configured options`);
          break;
        }
        if (v === ALL) {
          err(col, "reserved_value", `“${ALL}” is only available in filters and cannot be stored`);
          break;
        }
        if (col.type === "sub") {
          const macro = values[CORE.macrotrend];
          const allowed = typeof macro === "string" && macro ? subtrendsOf(schema, macro) : [];
          if (!optionsOf(schema, col).includes(v)) err(col, "not_in_taxonomy", `${col.label}: “${v}” is not in the taxonomy`);
          else if (typeof macro === "string" && macro && !allowed.includes(v)) {
            err(col, "subtrend_mismatch", `${col.label} “${v}” does not belong to “${macro}”`);
          }
        } else if (!optionsOf(schema, col).includes(v)) {
          err(col, "not_in_taxonomy", `${col.label}: “${v}” is not in the taxonomy`);
        }
        break;
      }
    }
  }
  return errors;
}

export interface TaxonomyWarning {
  key: string;
  message: string;
}

/**
 * Enforce the taxonomy on model-proposed values: anything outside the current
 * options is dropped to null with a warning. The model can never create
 * taxonomy values (2_Input_Architecture).
 */
export function enforceTaxonomy(
  schema: TrackerSchema,
  proposed: ItemValues,
): { values: ItemValues; warnings: TaxonomyWarning[] } {
  const values: ItemValues = {};
  const warnings: TaxonomyWarning[] = [];
  const macros = macrotrends(schema);
  // Macrotrend first so the subtrend can be checked against it.
  const ordered = sortedColumns(schema).sort((a, b) => Number(b.type === "macro") - Number(a.type === "macro"));
  for (const col of ordered) {
    let v = proposed[col.key] ?? null;
    if (v != null && col.type === "multi") {
      const list = splitMulti(v);
      const allowed = optionsOf(schema, col);
      const ok = list.filter((x) => allowed.includes(x));
      const bad = list.filter((x) => !allowed.includes(x));
      if (bad.length) warnings.push({ key: col.key, message: `Removed “${bad.join(", ")}” · not a tracked value` });
      v = ok.length ? ok : null;
    } else if (typeof v === "string" && (col.type === "select" || col.type === "macro" || col.type === "sub")) {
      const macro = values[CORE.macrotrend];
      const allowed =
        col.type === "macro"
          ? macros
          : col.type === "sub"
            ? subtrendsOf(schema, typeof macro === "string" ? macro : null)
            : optionsOf(schema, col);
      if (v === ALL || !allowed.includes(v)) {
        warnings.push({ key: col.key, message: `Proposed “${v}” is not in the taxonomy · set to null` });
        v = null;
      }
    } else if (typeof v === "string" && col.type === "date" && !isIsoDate(v)) {
      warnings.push({ key: col.key, message: `Proposed date “${v}” is not a valid date · set to null` });
      v = null;
    }
    values[col.key] = v;
  }
  // A subtrend implies its macrotrend; make sure the pair is consistent.
  const sub = values[CORE.subtrend];
  if (typeof sub === "string" && !values[CORE.macrotrend]) {
    const m = macroOfSubtrend(schema, sub);
    if (m) values[CORE.macrotrend] = m;
  }
  return { values, warnings };
}

/** Human-readable rendering of a stored value. */
export function displayValue(col: TrackerColumn | undefined, v: FieldValue | undefined): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (col?.type === "date") return formatDate(v);
  // Long text may carry formatting (request 46): shown as plain text in tables and lists.
  if (col?.type === "long") return plainText(v);
  return v;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-24" -> "24 Sep 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** ISO timestamp -> "24 Sep 2026, 10:42" (UTC). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

export function monthLabel(monthIndex: number): string {
  return MON[monthIndex] ?? "";
}

export { getColumn };
