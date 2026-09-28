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
