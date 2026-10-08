/**
 * Primary entries: Insight Topics, each with its Key Intelligence Questions
 * (and their Key Details and Key Metrics). Each question becomes its own
 * Tracker entry when the entry is pushed. Laid out like the column editor:
 * add a topic, add a question to a topic, remove either.
 */
import { FIELDS, type KiqTopic, type TrackerSchema } from "@eradigm/shared";
import { ListTextarea } from "./ListTextarea";
import { RichTextField } from "./RichTextField";

export const KIQ_KEYS: readonly string[] = [FIELDS.insightTopic, FIELDS.keyQuestion, FIELDS.keyDetails, FIELDS.keyMetrics];
const EMPTY_KIQ = { question: "", details: "", metrics: "" };
export const emptyTopic = (): KiqTopic => ({ topic: "", kiqs: [{ ...EMPTY_KIQ }] });

/** The column labels (editable in the column editor), with the usual names as fallback. */
export function kiqLabels(schema: TrackerSchema) {
  const l = (k: string, d: string) => schema.columns.find((c) => c.key === k)?.label ?? d;
  return { topic: l(FIELDS.insightTopic, "Insight Topic"), question: l(FIELDS.keyQuestion, "Key Intelligence Question"), details: l(FIELDS.keyDetails, "Key Details"), metrics: l(FIELDS.keyMetrics, "Key Metrics") };
}

/** "_kiq.0.1.details" → "Topic 1 · Question 2 · Key Details" (comments on these parts). */
export function kiqFieldLabel(field: string, schema: TrackerSchema): string | null {
  const m = /^_kiq\.(\d+)\.(?:(topic)|(\d+)\.(question|details|metrics))$/.exec(field);
  if (!m) return null;
  const L = kiqLabels(schema);
  if (m[2]) return `${L.topic} ${Number(m[1]) + 1}`;
  return `Topic ${Number(m[1]) + 1} · Question ${Number(m[3]) + 1} · ${L[m[4] as "question" | "details" | "metrics"]}`;
}

export function KiqEditor({
  idPrefix,
  schema,
  topics,
  disabled,
  invalid,
  onChange,
  onBlur,
  openOn,
}: {
  /** Prefix of the inputs' ids ("f-<item>"), so comments can jump to them. */
  idPrefix: string;
  schema: TrackerSchema;
  topics: KiqTopic[];
  disabled: boolean;
  /** The first question is required (it names the entry). */
  invalid: boolean;
  onChange: (t: KiqTopic[]) => void;
  onBlur: () => void;
  /** Open comments on a part, if any. */
  openOn?: (field: string) => number;
}) {
  const L = kiqLabels(schema);
  const total = topics.reduce((n, t) => n + t.kiqs.length, 0);
  const setTopic = (ti: number, patch: Partial<KiqTopic>) => onChange(topics.map((t, i) => (i === ti ? { ...t, ...patch } : t)));
  const setKiq = (ti: number, ki: number, patch: Partial<KiqTopic["kiqs"][number]>) => setTopic(ti, { kiqs: topics[ti]!.kiqs.map((k, i) => (i === ki ? { ...k, ...patch } : k)) });
  const badge = (f: string) => {
    const n = openOn?.(f) ?? 0;
    return n > 0 ? <span className="dlabel-c"> 💬 {n}</span> : null;
  };
  return (
    <div className="kiq-block" role="group" aria-label={`${L.topic}s and ${L.question}s`} data-testid="kiq-editor">
      <div className="kiq-intro">
        <b>
          {L.topic}s and {L.question}s
        </b>
        <span>
          Each {L.question} becomes its own Tracker entry ({total} so far), with its topic, {L.details.toLowerCase()} and {L.metrics.toLowerCase()}; the other fields are shared.
        </span>
      </div>
      {topics.map((t, ti) => (
        <div className="kiq-topic" key={ti} data-testid="kiq-topic">
          <div className="kiq-topic-head">
            <label className="dlabel" htmlFor={`${idPrefix}-_kiq.${ti}.topic`}>
              {L.topic} {ti + 1}
              {badge(`_kiq.${ti}.topic`)}
            </label>
            <input id={`${idPrefix}-_kiq.${ti}.topic`} className="dcell" value={t.topic} disabled={disabled} onChange={(e) => setTopic(ti, { topic: e.target.value })} onBlur={onBlur} />
            {!disabled && topics.length > 1 && (
              <button
                type="button"
                className="btn danger small"
                aria-label={`Remove ${L.topic} ${ti + 1}`}
                onClick={() => {
                  if (window.confirm(`Remove ${L.topic} ${ti + 1} and its ${t.kiqs.length} question${t.kiqs.length === 1 ? "" : "s"}?`)) {
                    onChange(topics.filter((_, i) => i !== ti));
                    queueMicrotask(onBlur);
                  }
                }}
              >
                Remove topic
              </button>
            )}
          </div>
          {t.kiqs.map((k, ki) => {
            const id = (part: string) => `${idPrefix}-_kiq.${ti}.${ki}.${part}`;
            const first = ti === 0 && ki === 0;
            return (
              <div className="kiq" key={ki} data-testid="kiq">
                <div className="kiq-head">
                  <label className="dlabel" htmlFor={id("question")}>
                    {L.question} {ki + 1}
                    {badge(`_kiq.${ti}.${ki}.question`)}
                  </label>
                  {!disabled && total > 1 && (
                    <button
                      type="button"
                      className="link-btn danger"
                      aria-label={`Remove ${L.topic} ${ti + 1}, ${L.question} ${ki + 1}`}
                      onClick={() => {
                        const next = t.kiqs.filter((_, i) => i !== ki);
                        onChange(next.length ? topics.map((x, i) => (i === ti ? { ...x, kiqs: next } : x)) : topics.filter((_, i) => i !== ti));
                        queueMicrotask(onBlur);
                      }}
                    >
                      ✕ Remove
                    </button>
                  )}
                </div>
                <ListTextarea
                  id={id("question")}
                  className={`dcell long ${first && invalid ? "invalid" : ""}`}
                  aria-invalid={(first && invalid) || undefined}
                  rows={2}
                  disabled={disabled}
                  value={k.question}
                  onValueChange={(v) => setKiq(ti, ki, { question: v })}
                  onBlur={onBlur}
                />
                <div className="kiq-parts">
                  <div>
                    <label className="dlabel" htmlFor={id("details")} id={`${id("details")}-label`}>
                      {L.details}
                      {badge(`_kiq.${ti}.${ki}.details`)}
                    </label>
                    <RichTextField id={id("details")} aria-labelledby={`${id("details")}-label`} className="dcell long" rows={4} disabled={disabled} value={k.details} onValueChange={(v) => setKiq(ti, ki, { details: v })} onBlur={onBlur} />
                  </div>
                  <div>
                    <label className="dlabel" htmlFor={id("metrics")} id={`${id("metrics")}-label`}>
                      {L.metrics}
                      {badge(`_kiq.${ti}.${ki}.metrics`)}
                    </label>
                    <RichTextField id={id("metrics")} aria-labelledby={`${id("metrics")}-label`} className="dcell long" rows={4} disabled={disabled} value={k.metrics} onValueChange={(v) => setKiq(ti, ki, { metrics: v })} onBlur={onBlur} />
                  </div>
                </div>
              </div>
            );
          })}
          {!disabled && (
            <button type="button" className="btn secondary small kiq-add" onClick={() => setTopic(ti, { kiqs: [...t.kiqs, { ...EMPTY_KIQ }] })}>
              ＋ Add {L.question}
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" className="btn secondary kiq-add" onClick={() => onChange([...topics, emptyTopic()])}>
          ＋ Add {L.topic}
        </button>
      )}
    </div>
  );
}
