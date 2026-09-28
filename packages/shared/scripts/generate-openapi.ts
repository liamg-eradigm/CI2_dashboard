// Generates packages/shared/openapi.json from the ENDPOINTS table in src/api.ts.
// Run: npm run openapi  (from the repo root)
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { ENDPOINTS, ErrorSchema } from "../src/api.js";
import { CONTRACT_VERSION } from "../src/version.js";

const toSchema = (s: z.ZodType) => z.toJSONSchema(s, { unrepresentable: "any", target: "openapi-3.0" });

const paths: Record<string, Record<string, unknown>> = {};
for (const e of ENDPOINTS) {
  const params = [
    ...[...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } })),
    ...(e.query ?? []).map((q) => ({ name: q, in: "query", required: false, schema: { type: "string" } })),
  ];
  const op: Record<string, unknown> = {
    summary: e.summary,
    description: e.roles.length ? `Roles: ${e.roles.join(", ")}` : "Public",
    parameters: params,
    responses: {
      "200": e.response
        ? { description: "OK", content: { "application/json": { schema: toSchema(e.response) } } }
        : { description: e.raw ?? "OK" },
      default: { description: "Error", content: { "application/json": { schema: toSchema(ErrorSchema) } } },
    },
  };
  if (e.request) {
    const content: Record<string, unknown> = { "application/json": { schema: toSchema(e.request) } };
    if (e.multipart) content["multipart/form-data"] = { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } };
    op.requestBody = { required: true, content };
  }
  if (e.roles.length) op.security = [{ cloudflareAccess: [] }];
  (paths[e.path] ??= {})[e.method] = op;
}

const doc = {
  openapi: "3.0.3",
  info: {
    title: "Eradigm Competitive Intelligence API",
    version: CONTRACT_VERSION,
    description:
      "Generated from packages/shared/src/api.ts. Every request is checked for both role and tenant server-side. Send X-Tenant-Id to select a tenant when the user belongs to more than one.",
  },
  components: {
    securitySchemes: {
      cloudflareAccess: { type: "apiKey", in: "header", name: "Cf-Access-Jwt-Assertion" },
    },
  },
  paths,
};
writeFileSync(new URL("../openapi.json", import.meta.url), JSON.stringify(doc, null, 2) + "\n");
console.log(`openapi.json written (${ENDPOINTS.length} operations, contract ${CONTRACT_VERSION})`);
