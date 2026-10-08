import type { ExtractionInput, ExtractionOutput, ExtractionRunMeta } from "@eradigm/shared";

/**
 * Provider-agnostic interface. The processing pipeline only ever sees this
 * interface, so changing the LLM vendor means adding a provider here and
 * changing `LLM_PROVIDER` — nothing else in the platform changes.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  extract(input: ExtractionInput, opts?: { signal?: AbortSignal }): Promise<LlmExtractionResult>;
  /** A short summary of one Macrotrend / Subtrend (Megatrends) or competitor (Competitors) from its entries. */
  summarize(input: SummaryInput, opts?: { signal?: AbortSignal; model?: string }): Promise<LlmSummaryResult>;
}

export interface SummaryEntry {
  date: string;
  title: string;
  competitors?: string[];
  /** Key details or an excerpt of the source (kept short by the caller). */
  details?: string;
  /** Competitors: the entry's Impact (High / Medium / Low) and its CI perspective. */
  impact?: string;
  ciPerspective?: string;
  /** Discussions (request 43): who answered, the topic and question, and the metrics given. */
  source?: string;
  topic?: string;
  question?: string;
  metrics?: string;
}

export interface SummaryInput {
  /** discussion (request 43): a Primary Tracker Full Discussion or KIQ Archive (entries newest first). */
  level: "macro" | "sub" | "competitor" | "discussion";
  name: string;
  parent?: string;
  /** At most this many sentences. */
  sentences: number;
  /** The company the summary is written for ("For AbbVie, …"). */
  perspective: string;
  /** Trends: entries from the last N days. Competitors: recency half-life in days (older high-impact entries still count). */
  windowDays: number;
  entries: SummaryEntry[];
  /** Discussions: the admin's instructions for the summary (Administration). */
  instructions?: string;
}

export interface LlmSummaryResult {
  text: string;
  meta: { provider: string; model: string; promptVersion: string; inputTokens?: number; outputTokens?: number; latencyMs: number };
}

export interface LlmExtractionResult {
  output: ExtractionOutput;
  meta: ExtractionRunMeta;
}

export interface LlmConfig {
  provider: string;
  apiKey?: string;
  model?: string;
  /** Provider-specific reasoning depth; for Claude: low | medium | high | xhigh | max. */
  effort?: string;
  timeoutMs?: number;
  baseUrl?: string;
  /** Enable server-side refusal fallbacks where the provider supports them. */
  fallbacks?: boolean;
  /** Custom fetch implementation (tests, or egress through a proxy binding). */
  fetch?: typeof fetch;
}

export type LlmErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH"
  | "PERMISSION"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "BAD_REQUEST"
  | "REFUSED"
  | "TRUNCATED"
  | "INVALID_OUTPUT";

const RETRYABLE: readonly LlmErrorCode[] = ["RATE_LIMITED", "UNAVAILABLE", "TIMEOUT"];

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly retryable: boolean;
  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.retryable = RETRYABLE.includes(code);
  }
}

/** Bump whenever the prompt text or request shape changes (recorded on every attempt). */
export const PROMPT_VERSION = "prompt/2026-09-28.1";
