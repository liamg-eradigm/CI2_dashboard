/**
 * Deterministic, offline heuristic provider for local development, CI and
 * demos without an API key. It never leaves the process. Output is clearly
 * labelled with model "mock-heuristic" and low confidences so it cannot be
 * mistaken for a real classification.
 */
import { type ExtractedField, type ExtractionInput, type FieldValue } from "@eradigm/shared";
import { SUMMARY_PROMPT_VERSION } from "../summaryPrompt.js";
import { PROMPT_VERSION, type LlmExtractionResult, type LlmProvider, type LlmSummaryResult, type SummaryInput } from "../types.js";

const STOP = new Set(["and", "the", "for", "of", "to", "in", "ai", "&", "or", "into", "with", "a", "an", "dtp", "dtc"]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function excerptWith(text: string, needle: string): string | null {
  const s = sentences(text).find((x) => x.toLowerCase().includes(needle.toLowerCase()));
  return s ? `“${s.length > 160 ? `${s.slice(0, 157)}…` : s}”` : null;
}

export class MockProvider implements LlmProvider {
  readonly name = "mock";
  readonly model = "mock-heuristic";

  async extract(input: ExtractionInput): Promise<LlmExtractionResult> {
    const text = `${input.headline}. ${input.bodyText}`;
    const lower = text.toLowerCase();
    const tokens = new Set(words(text));
    const fields: Record<string, ExtractedField> = {};
    const none = (reason: string): ExtractedField => ({ value: null, confidence: null, evidence: null, nullReason: reason });
    const val = (value: FieldValue, confidence: number, evidence: string | null): ExtractedField => ({
      value,
      confidence,
      evidence,
      nullReason: null,
    });

    // Score subtrends by word overlap; the best subtrend implies its macrotrend.
    let best: { macro: string; sub: string; score: number } | null = null;
    for (const g of input.taxonomy) {
      for (const sub of g.subtrends) {
        const score = words(`${sub} ${g.name}`).filter((w) => tokens.has(w)).length;
        if (score > 0 && (!best || score > best.score)) best = { macro: g.name, sub, score };
      }
    }

    for (const f of input.fields) {
      switch (f.type) {
        case "date": {
          const m = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
          const date = input.publicationDate ?? m?.[1] ?? null;
          fields[f.key] = date ? val(date, input.publicationDate ? 0.9 : 0.6, input.publicationDate ? "Page metadata" : `“${date}”`) : none("No publication date found");
          break;
        }
        case "multi": {
          const found = (f.options ?? []).filter((o) => lower.includes(o.toLowerCase()));
          fields[f.key] = found.length ? val(found, 0.7, excerptWith(text, found[0] as string)) : none("No tracked competitor named");
          break;
        }
        case "macro":
          fields[f.key] = best ? val(best.macro, 0.55, excerptWith(text, words(best.sub)[0] ?? best.sub)) : none("No taxonomy match");
          break;
        case "sub":
          fields[f.key] = best ? val(best.sub, 0.5, excerptWith(text, words(best.sub)[0] ?? best.sub)) : none("No taxonomy match");
          break;
        case "long":
          fields[f.key] = none("Not stated in article");
          break;
        case "text":
          fields[f.key] = f.key === "title" ? val(input.headline.slice(0, 200), 0.9, "Article headline") : none("Not stated in article");
          break;
        case "select": {
          const opts = f.options ?? [];
          if (f.key === "growth" && opts.length >= 3) {
            const strong = /\b(double|triple|record|major|billion|\$\d+bn|expan\w+|launch\w*)\b/i.exec(text);
            const slight = /\b(pilot\w*|plan\w*|extend\w*|partner\w*|rolls? out)\b/i.exec(text);
            const idx = strong ? 2 : slight ? 1 : 0;
            fields[f.key] = val(opts[idx] as string, 0.5, strong || slight ? excerptWith(text, (strong ?? slight)?.[0] ?? "") : null);
          } else if (f.key === "source") {
            const pick = /press release|newsroom|announced today/i.test(text)
              ? "PR"
              : /linkedin/i.test(text)
                ? "LinkedIn"
                : null;
            fields[f.key] = pick && opts.includes(pick) ? val(pick, 0.6, excerptWith(text, pick === "PR" ? "announ" : "linkedin")) : none("Source type not evident");
          } else {
            const hit = opts.find((o) => lower.includes(o.toLowerCase()));
            fields[f.key] = hit ? val(hit, 0.5, excerptWith(text, hit)) : none("Insufficient evidence");
          }
          break;
        }
      }
    }
    return {
      output: { fields, warnings: ["Mock heuristic provider: configure LLM_PROVIDER=anthropic for real classification"] },
      meta: { provider: this.name, model: this.model, promptVersion: PROMPT_VERSION, schemaVersion: input.schemaVersion, latencyMs: 0 },
    };
  }

  /** Lists the most recent titles: clearly not an AI summary. */
  async summarize(input: SummaryInput): Promise<LlmSummaryResult> {
    const n = input.entries.length;
    const recent = input.entries
      .slice(-3)
      .map((e) => e.title)
      .join("; ");
    const text = n
      ? `Mock summary of ${n} entr${n === 1 ? "y" : "ies"} in ${input.name} from the last ${input.windowDays} days. Most recent: ${recent}.`
      : `No ${input.name} entries in the last ${input.windowDays} days.`;
    return { text, meta: { provider: this.name, model: this.model, promptVersion: SUMMARY_PROMPT_VERSION, latencyMs: 0 } };
  }
}
