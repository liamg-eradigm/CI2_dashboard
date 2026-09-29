/**
 * Draft pre-fill — the ONE place where the pipeline decides how a new draft's
 * tracker fields are filled. Everything else (capture, storage, duplicate and
 * policy checks, the Inbox, approval, audit) is identical in both modes.
 *
 *   manual (LLM_PROVIDER = "none", the prototype default)
 *       No external service is called. The draft reaches the Inbox with every
 *       tracker field empty; the analyst reads the saved source and fills it.
 *
 *   llm    (LLM_PROVIDER = "anthropic" | "mock" | another registered adapter)
 *       The LLM adapter (packages/llm) proposes values with evidence and
 *       confidence. Values are checked against the taxonomy and data rules and
 *       the draft still always goes to Needs review — nothing is auto-published.
 *
 * Switching modes is configuration only; see docs/ENABLING-AUTOFILL.md.
 */
import {
  AUTO_KEYS,
  CORE,
  LOW_CONFIDENCE,
  MANUAL_DRAFT_STEPS,
  LLM_DRAFT_STEPS,
  buildExtractionInput,
  enforceTaxonomy,
  normaliseValues,
  prefillModeFor,
  validateValues,
  type ExtractedFieldView,
  type ItemValues,
  type PrefillMode,
  type TrackerSchema,
} from "@eradigm/shared";
import { createLlmProvider, LlmError } from "@eradigm/llm";
import type { CaptureStep } from "@eradigm/capture";
import type { Env } from "../env.js";
import type { ItemRow } from "../services/items.js";

export type Provenance = "source" | "ai" | "analyst" | null;

export function prefillMode(env: Pick<Env, "LLM_PROVIDER">): PrefillMode {
  return prefillModeFor(env.LLM_PROVIDER);
}

export interface PrefillDraft {
  values: ItemValues;
  provenance: Record<string, Provenance>;
  /** Per-field evidence/confidence (LLM mode only). */
  extraction: Record<string, ExtractedFieldView> | null;
  warnings: string[];
  fieldsWithWarnings: number;
  steps: CaptureStep[];
  meta: { provider: string; model: string | null; promptVersion: string | null; schemaVersion: string | null; inputTokens: number | null; outputTokens: number | null; latencyMs: number | null };
  /** Recorded as an `llm_draft` revision (LLM mode only). */
  revisionNote: string | null;
  audit: { action: "item.classified" | "item.routed"; details: Record<string, unknown> };
}

export type PrefillOutcome =
  | { ok: true; draft: PrefillDraft }
  | { ok: false; code: string; message: string; retryable: boolean; steps: CaptureStep[]; notifyAdmins: boolean };

export interface PrefillInput {
  schema: TrackerSchema;
  item: ItemRow;
  /** Headline and body after the redaction policy (what may leave the platform). */
  headline: string;
  body: string;
  /** Original text, used to verify evidence excerpts. */
  sourceText: string;
  redactedCount: number;
}

export async function prefillDraft(env: Env, input: PrefillInput): Promise<PrefillOutcome> {
  return prefillMode(env) === "manual" ? manualDraft(input) : llmDraft(env, input);
}

// ---------------------------------------------------------------------------
// Manual entry (no API)
// ---------------------------------------------------------------------------

function manualDraft({ schema, item }: PrefillInput): PrefillOutcome {
  // A reprocess (e.g. re-capturing the source) keeps anything the analyst already entered.
  const values = normaliseValues(schema, JSON.parse(item.draft_json || "{}"));
  const previous = JSON.parse(item.provenance_json || "{}") as Record<string, Provenance>;
  const provenance: Record<string, Provenance> = {};
  for (const c of schema.columns) provenance[c.key] = values[c.key] == null ? null : (previous[c.key] ?? "analyst");
  // Automatic fields (Source Tier) do not count: the analyst enters every other field.
  const entered = schema.columns.filter((c) => !AUTO_KEYS.includes(c.key));
  const empty = entered.filter((c) => values[c.key] == null).length;
  const [policyLabel, routedLabel] = MANUAL_DRAFT_STEPS;
  return {
    ok: true,
    draft: {
      values,
      provenance,
      extraction: null,
      warnings: [],
      fieldsWithWarnings: 0,
      steps: [
        { label: policyLabel, ok: true, detail: "Checked against the data policy · stored for analyst review only · nothing sent to any external service (automatic pre-fill is off)" },
        {
          label: routedLabel,
          ok: true,
          detail: `${item.code} created in Inbox · ${empty === entered.length ? "every tracker field empty" : `${empty} of ${entered.length} tracker fields empty`} · analyst enters values from the saved source · never auto-published`,
        },
      ],
      meta: { provider: "none", model: null, promptVersion: null, schemaVersion: null, inputTokens: null, outputTokens: null, latencyMs: null },
      revisionNote: null,
      audit: { action: "item.routed", details: { prefill: "manual", emptyFields: empty } },
    },
  };
}

// ---------------------------------------------------------------------------
// LLM pre-fill (optional; enabled by configuration)
// ---------------------------------------------------------------------------

/** Does the evidence excerpt actually appear in the source text? */
export function evidenceSupported(evidence: string | null, text: string): boolean {
  if (!evidence) return false;
  if (/^(article headline|page metadata|trade publication byline|page marked as press release)$/i.test(evidence.trim())) return true;
  const clean = (s: string) => s.toLowerCase().replace(/[“”"‘’'…]/g, "").replace(/\s+/g, " ").trim();
  const e = clean(evidence);
  if (e.length < 6) return false;
  const t = clean(text);
  if (t.includes(e)) return true;
  // Accept excerpts that were lightly trimmed: require the first 40 chars to match.
  return e.length > 40 && t.includes(e.slice(0, 40));
}

async function llmDraft(env: Env, { schema, item, headline, body, sourceText, redactedCount }: PrefillInput): Promise<PrefillOutcome> {
  const [minLabel, classifyLabel, routedLabel] = LLM_DRAFT_STEPS;
  const words = body ? body.split(/\s+/).length : 0;
  const steps: CaptureStep[] = [
    {
      label: minLabel,
      ok: true,
      detail: `Sent: headline, body text (${words} words), publication date, current taxonomy lists · Not sent: raw HTML, images, cookies, URL query${redactedCount ? ` · ${redactedCount} contact detail(s) redacted by policy` : ""}`,
    },
  ];

  let llm;
  try {
    llm = createLlmProvider({ provider: env.LLM_PROVIDER, apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL, effort: env.LLM_EFFORT, timeoutMs: 60_000 });
  } catch (err) {
    const m = err instanceof LlmError ? err.message : "LLM provider not configured";
    steps.push({ label: classifyLabel, ok: false, detail: m });
    return { ok: false, code: "LLM_NOT_CONFIGURED", message: m, retryable: false, steps, notifyAdmins: true };
  }

  let result;
  try {
    result = await llm.extract(buildExtractionInput(schema, { headline, bodyText: body, publicationDate: item.publication_date }));
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    steps.push({ label: classifyLabel, ok: false, detail: err.message });
    return { ok: false, code: `LLM_${err.code}`, message: err.message, retryable: err.retryable, steps, notifyAdmins: err.code === "AUTH" || err.code === "PERMISSION" || err.code === "NOT_CONFIGURED" };
  }

  // Check the AI response against the approved categories and data rules.
  const proposed: ItemValues = {};
  for (const [k, f] of Object.entries(result.output.fields)) proposed[k] = f.value;
  const { values, warnings: taxWarnings } = enforceTaxonomy(schema, proposed);
  const extraction: Record<string, ExtractedFieldView> = {};
  const provenance: Record<string, Provenance> = {};
  let fieldsWithWarnings = 0;
  for (const col of schema.columns) {
    const f = result.output.fields[col.key];
    const w: string[] = taxWarnings.filter((t) => t.key === col.key).map((t) => t.message);
    const v = values[col.key] ?? null;
    if (!col.aiAssist) {
      w.push("Null · analyst-owned field, not inferred");
    } else if (!f) {
      w.push("Not in extraction schema · analyst to complete");
    } else {
      if (v == null && f.nullReason && !w.length) w.push(`Null · ${f.nullReason}`);
      if (v != null && f.confidence != null && f.confidence < LOW_CONFIDENCE) w.push("Low confidence · verify against source");
      if (v != null && !evidenceSupported(f.evidence, sourceText)) w.push("Evidence excerpt not found in source · verify");
    }
    if (w.length) fieldsWithWarnings++;
    extraction[col.key] = { value: v, confidence: v == null ? null : (f?.confidence ?? null), evidence: f?.evidence ?? null, nullReason: v == null ? (f?.nullReason ?? null) : null, warnings: w };
    provenance[col.key] = v == null ? null : col.key === CORE.date && item.publication_date === v ? "source" : col.key === CORE.title && v === item.headline ? "source" : "ai";
  }
  // Server-side data rules (values must be valid; required-ness is checked at approval).
  const ruleErrors = validateValues(schema, values, { forApproval: false });
  for (const e of ruleErrors) {
    values[e.key] = null;
    const ex = extraction[e.key];
    if (ex) {
      ex.warnings.push(`${e.message} · set to null`);
      ex.value = null;
    }
  }
  const dropped = taxWarnings.length + ruleErrors.length;
  const nulls = schema.columns.filter((c) => values[c.key] == null).length;
  steps.push({
    label: classifyLabel,
    ok: true,
    detail: `Valid JSON against tracker schema · explicit nulls · evidence and confidence per field · ${dropped ? `${dropped} value(s) outside the taxonomy set to null` : "model cannot add taxonomy values"} · ${result.meta.model}`,
  });
  steps.push({ label: routedLabel, ok: true, detail: `${item.code} created in Inbox · never auto-published` });
  return {
    ok: true,
    draft: {
      values,
      provenance,
      extraction,
      warnings: result.output.warnings,
      fieldsWithWarnings,
      steps,
      meta: {
        provider: result.meta.provider,
        model: result.meta.model,
        promptVersion: result.meta.promptVersion,
        schemaVersion: result.meta.schemaVersion,
        inputTokens: result.meta.inputTokens ?? null,
        outputTokens: result.meta.outputTokens ?? null,
        latencyMs: result.meta.latencyMs ?? null,
      },
      revisionNote: `LLM draft · ${result.meta.model}`,
      audit: { action: "item.classified", details: { provider: result.meta.provider, model: result.meta.model, promptVersion: result.meta.promptVersion, nulls, fieldsWithWarnings, dropped } },
    },
  };
}
