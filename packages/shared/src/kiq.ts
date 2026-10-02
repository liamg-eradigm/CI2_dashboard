/**
 * Primary entries (contract 1.15): a primary source is an interview with key
 * people, asked several questions across topics. In the Inbox its Insight
 * Topic, Key Intelligence Question, Key Details and Key Metrics are entered as
 * a list:
 *
 *   Topic 1
 *     KIQ 1 · Key details · Key metrics
 *     KIQ 2 · Key details · Key metrics
 *   Topic 2
 *     KIQ 1 · …
 *
 * and pushing it to the Tracker makes one Tracker entry per Key Intelligence
 * Question (each with its topic, details and metrics, and every other field
 * shared). The Tracker columns stay the same.
 *
 * Every entry's ID is filled in automatically: Date_Competitor_Title
 * (Secondary) or Date_Competitor_Key Intelligence Question (Primary).
 */
import { z } from "zod";
import { CORE, FIELDS, type Stream } from "./schema.js";
import { MAX_LONG_TEXT_LENGTH, MAX_TEXT_LENGTH, splitMulti, type ItemValues } from "./validation.js";

export const KiqSchema = z.object({
  question: z.string().max(MAX_LONG_TEXT_LENGTH),
  details: z.string().max(MAX_LONG_TEXT_LENGTH),
  metrics: z.string().max(MAX_LONG_TEXT_LENGTH),
});
export const KiqTopicSchema = z.object({
  topic: z.string().max(MAX_TEXT_LENGTH),
  kiqs: z.array(KiqSchema).max(40),
});
/** At most this many Key Intelligence Questions in one entry (one Tracker entry each). */
export const MAX_KIQS = 40;
export const KiqTopicsSchema = z
  .array(KiqTopicSchema)
  .max(20)
  .refine((t) => t.reduce((n, x) => n + x.kiqs.length, 0) <= MAX_KIQS, `At most ${MAX_KIQS} Key Intelligence Questions in one entry`);
export type Kiq = z.infer<typeof KiqSchema>;
export type KiqTopic = z.infer<typeof KiqTopicSchema>;

/** One Tracker entry's worth: a Key Intelligence Question with its topic. */
export interface KiqRow extends Kiq {
  topic: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The topics as a flat list, in order, without Key Intelligence Questions left entirely empty. */
export function flattenKiqs(topics: readonly KiqTopic[]): KiqRow[] {
  return topics.flatMap((t) => t.kiqs.filter((k) => k.question.trim() || k.details.trim() || k.metrics.trim()).map((k) => ({ topic: t.topic, ...k })));
}

/** An entry with no list yet: its own Insight Topic, Key Intelligence Question, Key Details and Key Metrics as one topic. */
export function kiqsFromValues(values: ItemValues): KiqTopic[] {
  return [
    {
      topic: str(values[FIELDS.insightTopic]),
      kiqs: [{ question: str(values[FIELDS.keyQuestion]), details: str(values[FIELDS.keyDetails]), metrics: str(values[FIELDS.keyMetrics]) }],
    },
  ];
}

/** The entry's values with one row's topic, question, details and metrics. */
export function withKiq(values: ItemValues, row: KiqRow | undefined): ItemValues {
  const v = (s: string | undefined) => (s && s.trim() ? s : null);
  return {
    ...values,
    [FIELDS.insightTopic]: v(row?.topic),
    [FIELDS.keyQuestion]: v(row?.question),
    [FIELDS.keyDetails]: v(row?.details),
    [FIELDS.keyMetrics]: v(row?.metrics),
  };
}

/**
 * The entry's ID, from its mandatory fields: Event Date, Competitors and the
 * Title (Secondary) or Key Intelligence Question (Primary, else its Title).
 * Null until those are filled in.
 */
export function autoRecordId(stream: Stream, values: ItemValues): string | null {
  const date = str(values[CORE.date]).trim();
  const raw = values[CORE.competitors];
  const comps = splitMulti(Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw : null);
  const third = (stream === "primary" ? str(values[FIELDS.keyQuestion]).trim() || str(values[CORE.title]).trim() : str(values[CORE.title]).trim()).replace(/\s+/g, " ");
  if (!date || !comps.length || !third) return null;
  return `${date}_${comps.join(" & ")}_${third.length > 120 ? `${third.slice(0, 119).trimEnd()}…` : third}`;
}
