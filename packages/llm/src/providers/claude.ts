/**
 * Claude (Anthropic API) provider. This file and its siblings in providers/
 * are the only places in the repository allowed to import a model vendor SDK
 * (enforced by eslint.config.js).
 */
import Anthropic from "@anthropic-ai/sdk";
import { buildExtractionJsonSchema, parseExtractionOutput, type ExtractionInput } from "@eradigm/shared";
import { buildUserMessage, SYSTEM_PROMPT } from "../prompt.js";
import { buildSummaryMessage, summarySystemPrompt, SUMMARY_PROMPT_VERSION } from "../summaryPrompt.js";
import { LlmError, PROMPT_VERSION, type LlmConfig, type LlmExtractionResult, type LlmProvider, type LlmSummaryResult, type SummaryInput } from "../types.js";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

/** Beta flag for server-side refusal fallbacks ("default" routing by refusal category). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class ClaudeProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: Effort;
  private readonly fallbacks: boolean;

  constructor(config: LlmConfig) {
    if (!config.apiKey) throw new LlmError("NOT_CONFIGURED", "ANTHROPIC_API_KEY is not set for the LLM service");
    this.model = config.model || DEFAULT_CLAUDE_MODEL;
    this.effort = (EFFORTS as readonly string[]).includes(config.effort ?? "") ? (config.effort as Effort) : "medium";
    this.fallbacks = config.fallbacks ?? true;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      timeout: config.timeoutMs ?? 60_000,
      maxRetries: 2,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
  }

  async extract(input: ExtractionInput, opts: { signal?: AbortSignal } = {}): Promise<LlmExtractionResult> {
    const schema = buildExtractionJsonSchema(input.fields);
    const started = Date.now();
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(input) }],
      thinking: { type: "adaptive" },
      output_config: { effort: this.effort, format: { type: "json_schema", schema } },
    };
    if (this.fallbacks) {
      params.betas = [FALLBACK_BETA];
      params.fallbacks = "default";
    }
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(params, { signal: opts.signal });
    } catch (err) {
      throw mapError(err);
    }

    if (response.stop_reason === "refusal") {
      throw new LlmError("REFUSED", "The model declined to classify this content");
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmError("TRUNCATED", "The model output was truncated before completing the schema");
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new LlmError("INVALID_OUTPUT", "The model response was not valid JSON");
    }
    return {
      output: parseExtractionOutput(raw, input.fields),
      meta: {
        provider: this.name,
        model: response.model || this.model,
        promptVersion: PROMPT_VERSION,
        schemaVersion: input.schemaVersion,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        latencyMs: Date.now() - started,
      },
    };
  }

  summarize(input: SummaryInput, opts: { signal?: AbortSignal; model?: string } = {}): Promise<LlmSummaryResult> {
    return summarizeWith(this.client, opts.model || this.model, this.fallbacks, input, opts);
  }
}

/** Megatrends summaries are short prose: a light reasoning depth is enough. */
const SUMMARY_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string", description: "The summary paragraph, plain text" } },
  required: ["summary"],
  additionalProperties: false,
} as const;

/** Line breaks and bullet indentation kept; trailing spaces and runs of blank lines removed. */
export const keepLines = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export async function summarizeWith(
  client: Anthropic,
  model: string,
  fallbacks: boolean,
  input: SummaryInput,
  opts: { signal?: AbortSignal } = {},
): Promise<LlmSummaryResult> {
  const started = Date.now();
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: 4000,
    system: summarySystemPrompt(input),
    messages: [{ role: "user", content: buildSummaryMessage(input) }],
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
  };
  if (fallbacks) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = "default";
  }
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create(params, { signal: opts.signal });
  } catch (err) {
    throw mapError(err);
  }
  if (response.stop_reason === "refusal") throw new LlmError("REFUSED", "The model declined to summarise these entries");
  if (response.stop_reason === "max_tokens") throw new LlmError("TRUNCATED", "The summary was truncated");
  const raw = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let text: unknown;
  try {
    text = (JSON.parse(raw) as { summary?: unknown }).summary;
  } catch {
    throw new LlmError("INVALID_OUTPUT", "The model response was not valid JSON");
  }
  if (typeof text !== "string" || !text.trim()) throw new LlmError("INVALID_OUTPUT", "The model returned an empty summary");
  return {
    // Discussions keep their line breaks and nested bullets (requests 43 and 44); the others are one paragraph.
    text: input.level === "discussion" ? keepLines(text) : text.trim().replace(/\s+/g, " "),
    meta: {
      provider: "anthropic",
      model: response.model || model,
      promptVersion: SUMMARY_PROMPT_VERSION,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      latencyMs: Date.now() - started,
    },
  };
}

function mapError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  // Most specific first.
  if (err instanceof Anthropic.AuthenticationError) {
    return new LlmError("AUTH", "The Claude API rejected the API key (check ANTHROPIC_API_KEY for this environment)");
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new LlmError(
      "PERMISSION",
      "The Claude API key does not have permission for this model or workspace (organisation permission issue)",
    );
  }
  if (err instanceof Anthropic.NotFoundError) return new LlmError("BAD_REQUEST", "The configured Claude model was not found");
  if (err instanceof Anthropic.RateLimitError) return new LlmError("RATE_LIMITED", "The Claude API rate limit was reached");
  if (err instanceof Anthropic.BadRequestError) return new LlmError("BAD_REQUEST", `The Claude API rejected the request: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError("TIMEOUT", "The Claude API request timed out");
  if (err instanceof Anthropic.InternalServerError) return new LlmError("UNAVAILABLE", "The Claude API is temporarily unavailable");
  if (err instanceof Anthropic.APIConnectionError) return new LlmError("UNAVAILABLE", "Could not connect to the Claude API");
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return status >= 500 || status === 529
      ? new LlmError("UNAVAILABLE", "The Claude API is temporarily unavailable")
      : new LlmError("BAD_REQUEST", `The Claude API returned an error (${status})`);
  }
  if (err instanceof Error && err.name === "AbortError") return new LlmError("TIMEOUT", "The LLM request was aborted");
  return new LlmError("UNAVAILABLE", "Unexpected error calling the LLM service");
}
