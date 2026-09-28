# Claude API integration and organisational permissions

> **The current prototype does not use the Claude API (or any AI service).**
> `LLM_PROVIDER` is `"none"` in every environment: captured sources reach the
> Inbox with every field empty and analysts enter them. The integration below is
> built but switched off. To switch it on, follow
> [ENABLING-AUTOFILL.md](ENABLING-AUTOFILL.md). The permission items below are
> prerequisites for that step; none of them block the prototype.

## ⚠️ Flag: organisational permissions are required before enabling pre-fill

When enabled, the platform calls the Claude API once for every new submission.
The code is complete, but these items need someone with the right authority at Eradigm:

1. **An Anthropic Console (API) organisation and API key.** A claude.ai
   Team/Enterprise subscription does not by itself provide API access; API usage
   is billed separately in the Claude Console. An organisation admin must create
   a workspace and an API key (ideally one key per environment: staging and
   production).
2. **Permission to send client-confidential text to a third-party AI
   provider.** 6_QC_&_Compliance treats submitted URLs, snapshots, extracted text
   and model inputs/outputs as potentially confidential. The platform minimises
   and redacts what it sends (below), but a data-protection / client-contract
   review should approve the use of Anthropic as a processor, and confirm the
   applicable data-retention terms (including whether zero-data-retention is
   available under your agreement) for the chosen model.
3. **Model access and spend limits.** Confirm the chosen model is enabled for
   your workspace and set a spend limit/alerts in the Console.
4. **Deletion claims.** The platform never claims that data was removed from the
   provider. Deleting or quarantining an item removes *our* copies only.

**How problems show up in the product (only once pre-fill is enabled):** if the key is missing, invalid or lacks
permission, items end in **Failed** with `LLM_NOT_CONFIGURED`, `LLM_AUTH` or
`LLM_PERMISSION`, admins get an in-app notification plus a webhook alert
(`ALERT_WEBHOOK_URL`), and the Administration → Deployment status panel shows the
check as needing attention. Nothing is ever published without an analyst.

This build was **not** tested against the live Claude API (no Eradigm API key
was available). The request/response handling is covered by tests using a
recorded-shape fake transport; run `npm run eval` with a real key on labelled
examples before release (see QC report).

## What is sent

Only the minimum needed (2_Input_Architecture):

| Sent | Never sent |
|---|---|
| Headline, extracted article body text (after redaction), publication date, the tenant's current field list and taxonomy | Raw HTML, images, scripts, cookies, URL query strings, user identities, other tenants' data |

Before transmission the **data classification & redaction policy**
(`packages/shared/src/redaction.ts`, version `redaction/1.0.0`) runs:
- contact details (email, phone) are masked and processing continues;
- secrets/credentials, payment card numbers (Luhn-checked), national
  identifiers, IBANs, confidentiality markings (“strictly confidential”,
  “internal use only”, …) and tenant-defined terms **quarantine** the item:
  processing stops, nothing is sent, only a non-sensitive category + timestamp is
  recorded, admins are notified and the stored copy is deleted.

## Request shape

`packages/llm/src/providers/claude.ts` (the only file that imports
`@anthropic-ai/sdk`, enforced by ESLint):

- model: `LLM_MODEL` (default `claude-opus-5`; change per environment in
  `apps/api/wrangler.jsonc`, e.g. `claude-sonnet-5` to reduce cost)
- adaptive thinking, `output_config.effort` = `LLM_EFFORT` (default `medium`)
- **structured outputs**: `output_config.format = { type: "json_schema", schema }`.
  The schema is generated from the tenant's live taxonomy with `enum`s, so the
  model cannot invent categories; every field returns `value` (or explicit
  `null`), `confidence`, `evidence` and `null_reason`, plus `warnings`.
- server-side refusal fallbacks enabled (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`).
- 60 s timeout, 2 SDK retries; rate-limit/5xx/timeouts are retried by the queue
  with backoff; auth/permission/400 errors fail fast with a clear message.

After the response the API **re-checks everything**: values outside the current
taxonomy are dropped to null with a warning, subtrends must belong to the chosen
macrotrend, dates are validated, low confidence (< 0.65) and evidence that cannot
be found in the source text are flagged. The result is saved as a
**Needs review** draft with prompt version, schema version, extraction version
and model recorded on the processing attempt.

## Switching provider

1. Add `packages/llm/src/providers/<vendor>.ts` implementing `LlmProvider`.
2. Register it in `packages/llm/src/index.ts`.
3. Set `LLM_PROVIDER` (and the vendor's secret) for the environment.

Nothing outside `packages/llm` changes; the pipeline only depends on the
provider-agnostic `ExtractionInput` / `ExtractionOutput` contract in
`packages/shared/src/extraction.ts`.

## Configuration

```bash
npx wrangler secret put ANTHROPIC_API_KEY --env staging    -c apps/api/wrangler.jsonc
npx wrangler secret put ANTHROPIC_API_KEY --env production -c apps/api/wrangler.jsonc
```
Vars (per environment, `apps/api/wrangler.jsonc`): `LLM_PROVIDER` (`none` — the
prototype default, manual entry | `anthropic` | `mock`), `LLM_MODEL`, `LLM_EFFORT`.

Bump `PROMPT_VERSION` in `packages/llm/src/types.ts` whenever the prompt or
request shape changes, and re-run the evaluation (`npm run eval`).
