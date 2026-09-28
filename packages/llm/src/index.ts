/**
 * @eradigm/llm — the LLM "container". Everything model-specific lives here.
 *
 *   const llm = createLlmProvider({ provider: env.LLM_PROVIDER, apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL });
 *   const { output, meta } = await llm.extract(input);
 *
 * To switch vendor: add providers/<vendor>.ts implementing LlmProvider,
 * register it below and set LLM_PROVIDER. No other package changes.
 */
import { ClaudeProvider } from "./providers/claude.js";
import { MockProvider } from "./providers/mock.js";
import { LlmError, type LlmConfig, type LlmProvider } from "./types.js";

export * from "./types.js";
export { buildUserMessage, SYSTEM_PROMPT } from "./prompt.js";

const REGISTRY: Record<string, (c: LlmConfig) => LlmProvider> = {
  anthropic: (c) => new ClaudeProvider(c),
  claude: (c) => new ClaudeProvider(c),
  mock: () => new MockProvider(),
};

export const SUPPORTED_PROVIDERS = Object.keys(REGISTRY);

export function createLlmProvider(config: LlmConfig): LlmProvider {
  const factory = REGISTRY[(config.provider || "").toLowerCase()];
  if (!factory) throw new LlmError("NOT_CONFIGURED", `Unknown LLM provider “${config.provider}”. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`);
  return factory(config);
}
