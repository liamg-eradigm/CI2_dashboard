/**
 * Data classification and redaction policy (6_QC_&_Compliance, "Compliance
 * Instructions"). Applied to article text before any external transmission
 * (i.e. before anything is sent to the LLM provider).
 *
 *  - "redact" findings (contact details) are masked and processing continues.
 *  - "quarantine" findings (secrets, payment/identity numbers, confidentiality
 *    markings) stop processing: the item is quarantined, only a non-sensitive
 *    incident category and timestamp are recorded and an admin is notified.
 *
 * The policy is intentionally conservative and pattern-based. Tenants can add
 * their own quarantine markers (e.g. client project code names).
 */
import { REDACTION_POLICY_VERSION } from "./version.js";

export type FindingAction = "redact" | "quarantine";

export type IncidentCategory =
  | "credential_or_secret"
  | "payment_card"
  | "national_identifier"
  | "bank_account"
  | "confidentiality_marking"
  | "tenant_marker"
  | "malicious_content";

export interface Finding {
  kind: string;
  action: FindingAction;
  category?: IncidentCategory;
  count: number;
}

export interface RedactionPolicy {
  version: string;
  redactEmails: boolean;
  redactPhones: boolean;
  /** Extra case-insensitive phrases that force quarantine (tenant-configurable). */
  quarantineMarkers: string[];
}

export const DEFAULT_REDACTION_POLICY: RedactionPolicy = {
  version: REDACTION_POLICY_VERSION,
  redactEmails: true,
  redactPhones: true,
  quarantineMarkers: [],
};

interface Rule {
  kind: string;
  re: RegExp;
  action: FindingAction;
  category?: IncidentCategory;
  validate?: (m: string) => boolean;
  enabled?: (p: RedactionPolicy) => boolean;
}

function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

const RULES: Rule[] = [
  { kind: "private_key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, action: "quarantine", category: "credential_or_secret" },
  { kind: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, action: "quarantine", category: "credential_or_secret" },
  { kind: "api_key", re: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/g, action: "quarantine", category: "credential_or_secret" },
  { kind: "password_assignment", re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S{8,}/gi, action: "quarantine", category: "credential_or_secret" },
  { kind: "payment_card", re: /\b(?:\d[ -]?){12,18}\d\b/g, action: "quarantine", category: "payment_card", validate: luhn },
  { kind: "us_ssn", re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, action: "quarantine", category: "national_identifier" },
  { kind: "uk_nino", re: /\b(?![DFIQUV])[A-CEGHJ-PR-TW-Z](?![DFIQUVO])[A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g, action: "quarantine", category: "national_identifier" },
  { kind: "iban", re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, action: "quarantine", category: "bank_account", validate: ibanValid },
  {
    kind: "confidentiality_marking",
    re: /\b(?:strictly\s+confidential|internal\s+use\s+only|privileged\s+(?:and|&)\s+confidential|attorney[- ]client\s+privileged|not\s+for\s+(?:external\s+)?distribution|do\s+not\s+(?:distribute|forward))\b/gi,
    action: "quarantine",
    category: "confidentiality_marking",
  },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, action: "redact", enabled: (p) => p.redactEmails },
  {
    kind: "phone",
    re: /(?<!\w)(?:\+\d{1,3}(?:[\s.-]?\(?\d{1,5}\)?){2,5}|\(?\d{3,5}\)?[\s.-]\d{3,4}[\s.-]\d{3,4})(?!\w)/g,
    action: "redact",
    enabled: (p) => p.redactPhones,
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface RedactionResult {
  text: string;
  findings: Finding[];
  quarantine: boolean;
  /** First (most severe) incident category when quarantined. Never contains content. */
  incidentCategory: IncidentCategory | null;
  policyVersion: string;
}

/** Classify and redact `text` according to `policy`. Never returns matched content. */
export function applyRedactionPolicy(text: string, policy: RedactionPolicy = DEFAULT_REDACTION_POLICY): RedactionResult {
  const findings: Finding[] = [];
  let out = text;
  const rules: Rule[] = [
    ...RULES,
    ...policy.quarantineMarkers
      .map((m) => m.trim())
      .filter((m) => m.length >= 3)
      .map<Rule>((m) => ({ kind: "tenant_marker", re: new RegExp(`\\b${escapeRe(m)}\\b`, "gi"), action: "quarantine", category: "tenant_marker" })),
  ];
  for (const rule of rules) {
    if (rule.enabled && !rule.enabled(policy)) continue;
    let count = 0;
    out = out.replace(rule.re, (m) => {
      if (rule.validate && !rule.validate(m)) return m;
      count++;
      return rule.action === "redact" ? `[REDACTED:${rule.kind}]` : `[WITHHELD:${rule.kind}]`;
    });
    if (count) {
      const existing = findings.find((f) => f.kind === rule.kind);
      if (existing) existing.count += count;
      else findings.push({ kind: rule.kind, action: rule.action, category: rule.category, count });
    }
  }
  const q = findings.find((f) => f.action === "quarantine");
  return {
    text: out,
    findings,
    quarantine: Boolean(q),
    incidentCategory: q?.category ?? null,
    policyVersion: policy.version,
  };
}
