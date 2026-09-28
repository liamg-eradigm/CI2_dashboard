/**
 * Evaluate extraction + classification against examples people have already
 * reviewed and labelled (6_QC_&_Compliance). Re-run after any significant
 * change to the prompt, approved categories or model.
 *
 *   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run eval -- eval/labelled.jsonl
 *   npm run eval                       # uses eval/examples.sample.jsonl with the offline mock provider
 *
 * Each JSONL line: { id, headline, bodyText, publicationDate?, expected: { field: value }, duplicateOf? }
 * Measures: required-field completion, per-field category accuracy, evidence
 * support, taxonomy drops, duplicate handling and the share of examples that
 * would need an analyst correction. Writes eval/report-<timestamp>.json.
 * If no labelled data file exists the evaluation is skipped (exit 0).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildExtractionInput, defaultSchema, enforceTaxonomy, splitMulti, type ItemValues } from "@eradigm/shared";
import { createLlmProvider } from "@eradigm/llm";

interface Example {
  id: string;
  headline: string;
  bodyText: string;
  publicationDate?: string;
  expected: Record<string, string | string[]>;
  duplicateOf?: string;
}

const file = process.argv[2] ?? "eval/examples.sample.jsonl";
if (!existsSync(file)) {
  console.log(`No labelled examples at ${file} · evaluation skipped.`);
  process.exit(0);
}
const examples: Example[] = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const schema = defaultSchema();
const provider = process.env.LLM_PROVIDER ?? "mock";
const llm = createLlmProvider({ provider, apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.LLM_MODEL, effort: process.env.LLM_EFFORT });
const required = schema.columns.filter((c) => c.required && c.aiAssist).map((c) => c.key);
const norm = (v: unknown) => (Array.isArray(v) ? splitMulti(v as string[]).sort().join("|") : v == null ? "" : String(v));
const fp = (e: Example) => createHash("sha256").update(`${e.headline}\n${e.bodyText}`.toLowerCase().replace(/\s+/g, " ")).digest("hex");

const seen = new Map<string, string>();
const perField: Record<string, { n: number; correct: number }> = {};
let reqFilled = 0, reqTotal = 0, evidenced = 0, proposed = 0, dropped = 0, needsCorrection = 0, dupExpected = 0, dupCaught = 0;
const rows: unknown[] = [];

for (const ex of examples) {
  const h = fp(ex);
  if (ex.duplicateOf) dupExpected++;
  if (seen.has(h)) {
    if (ex.duplicateOf === seen.get(h)) dupCaught++;
    rows.push({ id: ex.id, duplicateOf: seen.get(h) });
    continue; // the pipeline stops duplicates before any LLM call
  }
  seen.set(h, ex.id);
  const input = buildExtractionInput(schema, { headline: ex.headline, bodyText: ex.bodyText, publicationDate: ex.publicationDate ?? null });
  const { output, meta } = await llm.extract(input);
  const proposedValues: ItemValues = Object.fromEntries(Object.entries(output.fields).map(([k, f]) => [k, f.value]));
  const { values, warnings } = enforceTaxonomy(schema, proposedValues);
  dropped += warnings.length;
  for (const k of required) {
    reqTotal++;
    if (values[k] != null) reqFilled++;
  }
  let wrong = 0;
  for (const [k, exp] of Object.entries(ex.expected)) {
    const s = (perField[k] ??= { n: 0, correct: 0 });
    s.n++;
    if (norm(values[k]) === norm(exp)) s.correct++;
    else wrong++;
  }
  if (wrong) needsCorrection++;
  const text = `${ex.headline}\n${ex.bodyText}`.toLowerCase();
  for (const [k, f] of Object.entries(output.fields)) {
    if (values[k] == null) continue;
    proposed++;
    const e = (f.evidence ?? "").toLowerCase().replace(/[“”"…]/g, "").trim();
    if (e === "article headline" || e === "page metadata" || (e.length > 5 && text.includes(e.slice(0, 40)))) evidenced++;
  }
  rows.push({ id: ex.id, model: meta.model, values, wrongFields: Object.keys(ex.expected).filter((k) => norm(values[k]) !== norm(ex.expected[k])) });
}

const labelled = examples.filter((e) => !e.duplicateOf).length;
const report = {
  file,
  provider,
  model: llm.model,
  examples: examples.length,
  requiredFieldCompletion: reqTotal ? reqFilled / reqTotal : null,
  categoryAccuracy: Object.fromEntries(Object.entries(perField).map(([k, s]) => [k, s.n ? s.correct / s.n : null])),
  evidenceSupport: proposed ? evidenced / proposed : null,
  taxonomyDrops: dropped,
  duplicatesHandled: `${dupCaught}/${dupExpected}`,
  correctionRate: labelled ? needsCorrection / labelled : null,
  rows,
};
const out = `eval/report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify(report, null, 2));
const pc = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
console.log(`Evaluation (${provider}/${llm.model}) on ${examples.length} examples → ${out}`);
console.log(`  required-field completion ${pc(report.requiredFieldCompletion)} · evidence support ${pc(report.evidenceSupport)} · correction rate ${pc(report.correctionRate)} · duplicates ${report.duplicatesHandled} · taxonomy drops ${dropped}`);
for (const [k, v] of Object.entries(report.categoryAccuracy)) console.log(`  ${k.padEnd(12)} accuracy ${pc(v)}`);
