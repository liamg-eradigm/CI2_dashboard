# Enabling automatic field pre-fill with an AI API (next steps)

**Status of this build: manual entry, no API.** Every captured URL or uploaded
HTML file is saved and sent to the Inbox with **every tracker field empty**.
An analyst opens the saved page, enters the fields and approves. No AI
service is called and no API key or AI account is needed.

The build is designed so that switching automatic pre-fill on later is a
**configuration change, not a rewrite**. This page lists what is already in
place, then the steps to switch it on, then how to switch it off again.

---

## 1. What is already built for the switch

| Piece | Where | What it does today | What it does once pre-fill is on |
|---|---|---|---|
| **Pre-fill seam**: one function decides how a draft's fields are filled | `apps/api/src/pipeline/prefill.ts` | `LLM_PROVIDER = "none"`: returns an empty draft. On a re-capture it keeps anything the analyst already entered. | Calls the LLM adapter, then checks every value against the taxonomy and data rules. |
| **LLM adapter**: a provider interface plus the Claude implementation | `packages/llm` (`providers/claude.ts`) | Present and unit-tested with a fake transport, but never called | Makes one Claude API call per new article |
| **Offline heuristic adapter** | `packages/llm/src/providers/mock.ts` | Used by the integration tests, so the pre-fill path stays working | Useful for demos without a key (`LLM_PROVIDER = "mock"`) |
| **Extraction contract**: the minimum input to send, and an output JSON schema generated from the live taxonomy (with enums, so the model cannot invent categories) | `packages/shared/src/extraction.ts` | Present | Used for every request |
| **Article text extraction** | `packages/capture` | Runs on every capture and is stored as `body_text`. It is also used for duplicate detection. | Becomes the model input, so no new capture work is needed |
| **Data policy**: redaction and quarantine | `packages/shared/src/redaction.ts` | Runs on every capture; quarantines secrets, card numbers and confidentiality markings | Also redacts contact details before anything leaves the platform |
| **Server-side checks on model output** | `prefill.ts` | Not used | Enforces the taxonomy, validates subtrend against macrotrend, flags low confidence (< 0.65) and evidence not found in the source |
| **Inbox and Input UI for AI drafts** | `apps/web` | Hidden automatically: the API reports `features.prefill = "manual"` in `/api/me` | Shown automatically: "LLM draft · N warnings" tag, per-field AI/confidence notes, evidence & confidence table, "Model output" card, 8-step pipeline |
| **Records** | D1 `processing_attempts` / `item_revisions` | `provider = "none"`, no `llm_draft` revision | Provider, model, prompt and schema versions, input and output tokens, plus an `llm_draft` revision per attempt |
| **Quality metrics** | Administration → Extraction quality (`/api/metrics/quality`) | AI metrics stay empty (manual entries are not "corrections") | Correction rate against the AI draft, required-field completion, evidence coverage |
| **Evaluation harness** | `scripts/eval-extraction.ts`, `scripts/export-eval-set.mjs` | The export script builds a labelled test set from your approved manual entries | Measures a model on your own articles before and after go-live |

Nothing outside `packages/llm` imports a model SDK; ESLint enforces this. The
pipeline, the Inbox, approval, audit and the client-facing tracker are the
same in both modes.

## 2. Step-by-step: switching pre-fill on

### Step 1 — Organisational approval (before any article text leaves the platform)
Work through the checklist in [CLAUDE-API.md](CLAUDE-API.md):
- An Anthropic Console organisation and API key. A claude.ai Team or Enterprise subscription does not include API access.
- Approval to send client-confidential article text to a third-party processor, and the data-retention terms that apply.
- Spend limits.

### Step 2 — Build a labelled test set from the prototype period
Every item an analyst approved in manual mode is a labelled example. Export them:
```bash
node scripts/export-eval-set.mjs --env production --limit 300 > eval/labelled.jsonl
```
The file contains article text. Treat it as confidential: it is git-ignored, so delete it after use.

### Step 3 — Measure a model on your own articles
```bash
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... LLM_MODEL=claude-opus-5 npm run eval -- eval/labelled.jsonl
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... LLM_MODEL=claude-sonnet-5 npm run eval -- eval/labelled.jsonl
```
Compare category accuracy, required-field completion, evidence support and correction rate in `eval/report-*.json`, then pick the model and effort.

Estimated usage is about 12–16k tokens per 10-page article: about 10–11k input and 1.5–5k output, including thinking. There is one call per new article. Idempotent retries (the same request sent twice), blocked and quarantined items make no call. A re-submission of a source already in the tracker is processed normally and flagged as a duplicate for the reviewer.

| Model (ID) | Price per 1M tokens (input / output) | ≈ per article | ≈ per 500 articles |
|---|---|---|---|
| Claude Sonnet 5 (`claude-sonnet-5`, the configured model) | $2 / $10 | $0.04–0.07 | $20–35 |
| Claude Opus 5 (`claude-opus-5`, most capable) | $5 / $25 | $0.10–0.18 | $50–90 |

These are first-party API list prices at the time of writing; check the current price list before budgeting. Once live, the exact counts are recorded per attempt (`input_tokens`, `output_tokens`).

### Step 4 — Configure staging (configuration only)
```bash
npx wrangler secret put ANTHROPIC_API_KEY --env staging -c apps/api/wrangler.jsonc
```
In `apps/api/wrangler.jsonc`, set the following in `env.staging.vars`:
```jsonc
"LLM_PROVIDER": "anthropic",
"LLM_MODEL": "claude-sonnet-5", // already set; or the model chosen in step 3
"LLM_EFFORT": "medium"           // low | medium | high
```
Deploy the API worker: push to `main`, or run `npm run deploy:staging -w apps/api`. The web and capture workers do not change.

### Step 5 — Verify on staging
- Check **Administration → Deployment status**. It should read "LLM pre-fill: Claude API key configured".
- On **Input**, submit an article. The pipeline shows *Minimum extraction to LLM* → *Schema-constrained classification* → *Routed to Needs review*.
- In the **Inbox**, the draft arrives pre-filled, with AI and confidence notes per field, an evidence & confidence table and validation warnings. Nothing is published until an analyst approves.
- If the key is wrong or lacks permission, items fail with `LLM_AUTH`, `LLM_PERMISSION` or `LLM_NOT_CONFIGURED`, and admins get an in-app notification and a webhook alert.

### Step 6 — Production
Repeat step 4 with `--env production` and `env.production.vars`, then deploy
through the production workflow. After a week, check the correction rate in
**Administration → Extraction quality** and the token counts per attempt.

### Step 7 — Megatrends summaries (same connection)
The same `LLM_PROVIDER` and `ANTHROPIC_API_KEY` switch on **✦ Write with AI**
on the Megatrends tab (until then it is disabled and summaries are written by
hand). Under **Administration → Workspace settings → Megatrends · AI
summaries**, choose the time frame (entries from the last N days), the maximum
number of sentences, the company the summaries are written for, and the model
(Claude Opus 5.5, Sonnet 5.5 or Haiku 4.5). Each summary is one short request
(at most 40 recent entries; low reasoning effort), written only when an
analyst asks for it, and stored with the model, time frame and number of
entries it was written from. The prompt is in `packages/llm/src/summaryPrompt.ts`.

### Step 8 — Primary Tracker AI Summary (same connection)
With the same connection, **Analytics → Primary Tracker** writes the **AI
Summary** of each Full Discussion and KIQ Archive the first time it is
opened, and again once one of its answers changes (a summary an admin wrote
by hand is kept). Claude follows the instructions under **Administration →
Workspace settings → Primary Tracker · AI Summary**, with the model and
company set for the Megatrends summaries. Each summary is one short request
(low reasoning effort) from the answers in that discussion, newest first.

## 3. Switching it off again (rollback)
Set `LLM_PROVIDER` back to `"none"` and redeploy the API worker. New
captures return to empty drafts. Drafts that already exist, approved items and
their history are not changed. You can also delete the secret:
`npx wrangler secret delete ANTHROPIC_API_KEY --env <env>`.

## 4. Behaviour that changes when pre-fill is on
- **Reprocess** re-runs capture and pre-fill, and replaces the draft with a new AI draft. In manual mode, Re-capture keeps the analyst's values.
- Per-field provenance becomes `ai`, `source` or `analyst`. Analyst edits to an AI draft count as corrections in the quality metrics.
- Contact details are redacted from the text sent to the model (tenant setting under Administration). Quarantine rules are unchanged.
- The Input page shows 8 steps instead of 7.

## 5. Cloudflare plan considerations
- **The Workers Free plan is enough for the API call itself.** The call runs in the background queue consumer. Waiting on the network does not count as CPU time, and parsing the JSON response takes a few milliseconds. It uses 1 of the 50 external subrequests allowed per invocation.
- Large pages are limited by HTML parsing CPU time, not by the AI call. See [DEPLOYMENT.md § Free plan](DEPLOYMENT.md#workers-free-plan).
- If volume grows, or pages fail with *PROCESSING_LIMIT*, move to Workers Paid ($5/month). No code changes: the CPU limit becomes 30 s per invocation.

## 6. Other providers (same seam)
The pipeline only depends on the provider-neutral `LlmProvider` interface
(`packages/llm/src/types.ts`). To use a different service:
1. Add `packages/llm/src/providers/<name>.ts` implementing `extract(input)`. It must return values and a per-field confidence, evidence and null reason.
2. Register it in `packages/llm/src/index.ts`.
3. Set `LLM_PROVIDER = "<name>"`, plus its secret or binding.

Options that fit the "no new vendor" or "existing contract" constraints:
- **Cloudflare Workers AI** (open models such as Llama, Mistral and Qwen, running in your Cloudflare account). Add an `AI` binding to `apps/api/wrangler.jsonc` and an adapter that asks for JSON output. It has a daily free allocation; accuracy is lower than Claude, so measure it with step 3.
- **Claude through Amazon Bedrock, Google Vertex AI or Microsoft Foundry**, if your organisation already has one of those contracts. Anthropic publishes a separate SDK client for each; the adapter differs only in client construction and model IDs.

After changing the prompt or request shape, bump `PROMPT_VERSION` in
`packages/llm/src/types.ts` and re-run the evaluation.
