/**
 * Provider-agnostic contract between the processing pipeline and whichever
 * LLM is configured (2_Input_Architecture / 4_Backend_Design).
 *
 *  - Only the minimum article content and taxonomy context is sent.
 *  - Output is schema-constrained JSON with explicit nulls, an evidence
 *    excerpt and a confidence value for every field, plus warnings.
 *  - The schema uses enums so the model cannot create taxonomy values; the
 *    pipeline re-checks every value server-side regardless.
 */
import { EXTRACTION_SCHEMA_VERSION } from "./version.js";
import {
  CORE,
  allSubtrends,
  macrotrends,
  sortedColumns,
  type MacrotrendGroup,
  type TrackerColumn,
  type TrackerSchema,
} from "./schema.js";
import type { FieldValue } from "./validation.js";

/** Minimum content sent to the model. Never raw HTML, images, cookies or URL query strings. */
export interface ExtractionInput {
  headline: string;
  bodyText: string;
  publicationDate: string | null;
  fields: ExtractionFieldSpec[];
  taxonomy: MacrotrendGroup[];
  schemaVersion: string;
}

export interface ExtractionFieldSpec {
  key: string;
  label: string;
  type: TrackerColumn["type"];
  options?: string[];
  instructions: string;
}

export interface ExtractedField {
  value: FieldValue;
  /** 0–1, or null when no value was proposed. */
  confidence: number | null;
  /** Verbatim excerpt from the article supporting the value (or "Article headline"). */
  evidence: string | null;
  /** Why the value is null, when it is. */
  nullReason: string | null;
}

export interface ExtractionOutput {
  fields: Record<string, ExtractedField>;
  warnings: string[];
}

export interface ExtractionRunMeta {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

export const LOW_CONFIDENCE = 0.65;

function fieldInstructions(col: TrackerColumn): string {
  switch (col.key) {
    case CORE.date:
      return "Publication date of the news item (YYYY-MM-DD). Prefer the supplied publication date; otherwise a date stated in the article.";
    case CORE.competitors:
      return "Every tracked competitor that is a principal party in the news. Only names from the options list.";
    case CORE.macrotrend:
      return "The single macrotrend that best fits the news.";
    case CORE.subtrend:
      return "The single subtrend that best fits the news. It must belong to the chosen macrotrend.";
    case CORE.title:
      return "A concise factual news title (the article headline, lightly cleaned).";
    case CORE.growth:
      return "Intensity of observed growth of the trend signalled by this news. This is not a bidirectional measure.";
    case CORE.impact:
      return "Competitive impact of the news. Return null if the article gives insufficient evidence.";
    default:
      return col.type === "text"
        ? `Value for “${col.label}” if the article states it explicitly.`
        : `Value for “${col.label}” if the article supports it.`;
  }
}

/** Build the field list sent to the model from the tenant's current schema. */
export function extractionFields(schema: TrackerSchema): ExtractionFieldSpec[] {
  return sortedColumns(schema)
    .filter((c) => c.aiAssist)
    .map((c) => {
      const options =
        c.type === "macro" ? macrotrends(schema) : c.type === "sub" ? allSubtrends(schema) : c.options ? [...c.options] : undefined;
      return { key: c.key, label: c.label, type: c.type, options, instructions: fieldInstructions(c) };
    });
}

export function buildExtractionInput(
  schema: TrackerSchema,
  article: { headline: string; bodyText: string; publicationDate: string | null },
): ExtractionInput {
  return {
    headline: article.headline,
    bodyText: article.bodyText,
    publicationDate: article.publicationDate,
    fields: extractionFields(schema),
    taxonomy: schema.taxonomy.map((g) => ({ name: g.name, subtrends: [...g.subtrends] })),
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
  };
}

type JsonSchema = Record<string, unknown>;
const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: "null" }] });

function valueSchema(f: ExtractionFieldSpec): JsonSchema {
  const withEnum = (s: JsonSchema) => (f.options && f.options.length ? { ...s, enum: f.options } : s);
  switch (f.type) {
    case "multi":
      return nullable({ type: "array", items: withEnum({ type: "string" }) });
    case "select":
    case "macro":
    case "sub":
      return nullable(withEnum({ type: "string" }));
    case "date":
      return nullable({ type: "string", format: "date" });
    default:
      return nullable({ type: "string" });
  }
}

/**
 * JSON Schema for the model's output, generated from the tenant schema.
 * Compatible with structured-output constraints (no numeric/string limits,
 * `additionalProperties: false` on every object, all properties required).
 */
export function buildExtractionJsonSchema(fields: ExtractionFieldSpec[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const f of fields) {
    properties[f.key] = {
      type: "object",
      description: `${f.label}: ${f.instructions}`,
      properties: {
        value: valueSchema(f),
        confidence: { ...nullable({ type: "number" }), description: "0 to 1" },
        evidence: { ...nullable({ type: "string" }), description: "Short verbatim excerpt from the article" },
        null_reason: { ...nullable({ type: "string" }), description: "Why value is null, if it is" },
      },
      required: ["value", "confidence", "evidence", "null_reason"],
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    properties: {
      fields: { type: "object", properties, required: fields.map((f) => f.key), additionalProperties: false },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["fields", "warnings"],
    additionalProperties: false,
  };
}

function clamp01(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/**
 * Parse raw model JSON defensively into ExtractionOutput. Missing fields
 * become explicit nulls; malformed entries become nulls with a warning.
 */
export function parseExtractionOutput(raw: unknown, fields: ExtractionFieldSpec[]): ExtractionOutput {
  const warnings: string[] = [];
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawFields = (root.fields && typeof root.fields === "object" ? root.fields : {}) as Record<string, unknown>;
  const out: Record<string, ExtractedField> = {};
  for (const f of fields) {
    const r = rawFields[f.key] as Record<string, unknown> | undefined;
    if (!r || typeof r !== "object") {
      out[f.key] = { value: null, confidence: null, evidence: null, nullReason: "Missing from model output" };
      warnings.push(`${f.label}: missing from model output`);
      continue;
    }
    let value: FieldValue = null;
    const v = r.value;
    if (f.type === "multi") {
      value = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
      if (Array.isArray(value) && value.length === 0) value = null;
    } else if (typeof v === "string") {
      value = v.trim() || null;
    }
    const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 500) : null);
    out[f.key] = {
      value,
      confidence: value == null ? null : clamp01(r.confidence),
      evidence: str(r.evidence),
      nullReason: value == null ? (str(r.null_reason) ?? "No value proposed") : null,
    };
  }
  const modelWarnings = Array.isArray(root.warnings) ? root.warnings.filter((w): w is string => typeof w === "string") : [];
  return { fields: out, warnings: [...modelWarnings.map((w) => w.slice(0, 300)), ...warnings] };
}
