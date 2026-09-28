#!/usr/bin/env node
/**
 * Lightweight secret scan over tracked files (CI also runs gitleaks).
 * Exits non-zero if anything that looks like a credential is committed.
 */
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = [
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9]{32,}\b/],
  ["AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Private key", /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ["Cloudflare API token assignment", /CLOUDFLARE_API_TOKEN\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/],
  ["Generic secret assignment", /\b(api[_-]?key|secret|password|token)\s*[=:]\s*["'][A-Za-z0-9+/_=-]{24,}["']/i],
];
// Test fixtures deliberately contain fake secrets to exercise the redaction policy.
const ALLOW = [/packages\/shared\/test\//, /packages\/llm\/test\//, /apps\/api\/test\//, /scripts\/scan-secrets\.mjs$/, /packages\/shared\/src\/redaction\.ts$/, /\.docx$|\.zip$|\.webp$|\.png$/];

const files = execSync("git ls-files -co --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
const hits = [];
for (const f of files) {
  if (ALLOW.some((a) => a.test(f))) continue;
  try {
    if (statSync(f).size > 2_000_000) continue;
  } catch {
    continue;
  }
  const text = readFileSync(f, "utf8");
  text.split("\n").forEach((line, i) => {
    for (const [name, re] of PATTERNS) if (re.test(line)) hits.push(`${f}:${i + 1}  ${name}`);
  });
}
if (hits.length) {
  console.error(`Possible secrets found:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} files).`);
