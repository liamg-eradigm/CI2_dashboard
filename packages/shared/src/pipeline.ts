/**
 * Processing steps shown on the Input page and recorded per attempt. The API
 * records steps in this order, so the dashboard can label them.
 *
 * Draft pre-fill is pluggable (see docs/ENABLING-AUTOFILL.md):
 *   manual  – no external service; the draft reaches the Inbox with every
 *             tracker field empty and the analyst fills it from the saved source.
 *   llm     – a configured LLM proposes values, evidence and confidence; the
 *             draft still always goes to Needs review.
 */
export type PrefillMode = "manual" | "llm";

export const URL_CAPTURE_STEPS = ["Validate and normalise", "Destination check", "Isolated capture worker", "Access restrictions", "Content scan before storage"] as const;
export const FILE_CAPTURE_STEPS = ["File check", "Source URL", "Isolated parse worker", "Access restrictions", "Content scan before storage"] as const;

export const MANUAL_DRAFT_STEPS = ["Data policy check", "Routed to Needs review"] as const;
export const LLM_DRAFT_STEPS = ["Minimum extraction to LLM", "Schema-constrained classification", "Routed to Needs review"] as const;

export function pipelineSteps(input: "url" | "file", mode: PrefillMode): string[] {
  return [...(input === "url" ? URL_CAPTURE_STEPS : FILE_CAPTURE_STEPS), ...(mode === "llm" ? LLM_DRAFT_STEPS : MANUAL_DRAFT_STEPS)];
}

/** `LLM_PROVIDER` values that mean "no automatic pre-fill". */
export function prefillModeFor(provider: string | null | undefined): PrefillMode {
  const p = (provider ?? "").trim().toLowerCase();
  return p === "" || p === "none" || p === "manual" || p === "off" ? "manual" : "llm";
}
