import { describe, expect, it } from "vitest";
import {
  applyRedactionPolicy,
  blockedIpReason,
  buildExtractionJsonSchema,
  checkAndNormaliseUrl,
  dedupeKey,
  defaultSchema,
  trackerColumns,
  extractionFields,
  isAcceptedContentType,
  parseExtractionOutput,
  parseIPv6,
  safeCell,
  toCsv,
  toTable,
  toTsv,
  toXlsx,
} from "../src/index.js";

describe("URL validation and normalisation", () => {
  it("adds https, strips fragments and tracking parameters and sorts the query", () => {
    const r = checkAndNormaliseUrl("newsroom.example.com/roche-lab?utm_source=li&b=2&a=1&fbclid=x#top");
    expect(r).toEqual({
      ok: true,
      url: "https://newsroom.example.com/roche-lab?a=1&b=2",
      host: "newsroom.example.com",
      notes: ["added https://", "fragment removed", "2 tracking parameters removed"],
    });
  });

  it.each([
    ["ftp://files.example.com/a.html", "SCHEME"],
    ["javascript:alert(1)", "SCHEME"],
    ["file:///etc/passwd", "SCHEME"],
    ["https://user:pw@example.com/", "CREDENTIALS"],
    ["http://10.0.0.12/admin", "BLOCKED_HOST"],
    ["http://169.254.169.254/latest/meta-data", "BLOCKED_HOST"],
    ["http://127.0.0.1:443/", "BLOCKED_HOST"],
    ["http://2130706433/", "BLOCKED_HOST"],
    ["http://0x7f.0.0.1/", "BLOCKED_HOST"],
    ["http://[::1]/", "BLOCKED_HOST"],
    ["http://[::ffff:10.0.0.1]/", "BLOCKED_HOST"],
    ["http://[fd00::1]/", "BLOCKED_HOST"],
    ["http://[fe80::1]/", "BLOCKED_HOST"],
    ["http://100.64.0.1/", "BLOCKED_HOST"],
    ["http://localhost/", "BLOCKED_HOST"],
    ["http://intranet/", "BLOCKED_HOST"],
    ["http://metadata.google.internal/", "BLOCKED_HOST"],
    ["http://printer.local/", "BLOCKED_HOST"],
    ["https://example.com:8443/", "PORT"],
    ["https://example.com/report.pdf", "CONTENT_TYPE"],
    ["", "EMPTY"],
  ])("rejects %s (%s)", (input, code) => {
    const r = checkAndNormaliseUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it("classifies IP addresses after DNS resolution", () => {
    expect(blockedIpReason("8.8.8.8")).toBeNull();
    expect(blockedIpReason("2606:4700:4700::1111")).toBeNull();
    expect(blockedIpReason("192.168.1.10")).toMatch(/private/);
    expect(blockedIpReason("224.0.0.1")).toMatch(/multicast/);
    expect(blockedIpReason("::ffff:169.254.169.254")).toMatch(/metadata/);
    expect(blockedIpReason("64:ff9b::a00:1")).toMatch(/NAT64/);
  });

  it("parses IPv6 forms", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::ffff:10.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0a00, 0x0001]);
    expect(parseIPv6("1::2::3")).toBeNull();
  });

  it("builds a stable dedupe key", () => {
    expect(dedupeKey("https://www.example.com/a/")).toBe(dedupeKey("http://example.com/a"));
  });

  it("accepts only HTML content types", () => {
    expect(isAcceptedContentType("text/html; charset=utf-8")).toBe(true);
    expect(isAcceptedContentType("application/pdf")).toBe(false);
    expect(isAcceptedContentType(null)).toBe(false);
  });
});

describe("redaction and classification policy", () => {
  it("redacts contact details and continues", () => {
    const r = applyRedactionPolicy("Contact jane.doe@pfizer.com or +44 20 7946 0958 for details.");
    expect(r.quarantine).toBe(false);
    expect(r.text).toBe("Contact [REDACTED:email] or [REDACTED:phone] for details.");
    expect(r.findings.map((f) => f.kind)).toEqual(["email", "phone"]);
  });

  it.each([
    ["Card 4111 1111 1111 1111 was charged", "payment_card"],
    ["key AKIAIOSFODNN7EXAMPLE leaked", "credential_or_secret"],
    ["SSN 123-45-6789", "national_identifier"],
    ["IBAN GB82 WEST 1234 5698 7654 32", "bank_account"],
    ["STRICTLY CONFIDENTIAL — board minutes", "confidentiality_marking"],
  ])("quarantines %s", (text, category) => {
    const r = applyRedactionPolicy(text);
    expect(r.quarantine).toBe(true);
    expect(r.incidentCategory).toBe(category);
    expect(JSON.stringify(r.findings)).not.toMatch(/4111|AKIA|6789|WEST/);
  });

  it("does not flag ordinary numbers or non-Luhn digit strings", () => {
    const r = applyRedactionPolicy("Revenue grew 12% to $4.2bn in 2026; 1234 5678 9012 3456 units shipped.");
    expect(r.quarantine).toBe(false);
  });

  it("supports tenant-specific quarantine markers", () => {
    const r = applyRedactionPolicy("Project Nightjar update", { version: "t", redactEmails: true, redactPhones: true, quarantineMarkers: ["Project Nightjar"] });
    expect(r.incidentCategory).toBe("tenant_marker");
  });
});

describe("extraction output contract", () => {
  const schema = defaultSchema();
  const fields = extractionFields(schema);

  it("excludes analyst-owned fields and constrains dropdowns with enums", () => {
    expect(fields.map((f) => f.key)).not.toContain("action");
    const js = buildExtractionJsonSchema(fields) as { properties: { fields: { properties: Record<string, { properties: { value: { anyOf: { enum?: string[] }[] } } }>; required: string[] } } };
    const impact = js.properties.fields.properties.impact!.properties.value.anyOf[0]!;
    expect(impact.enum).toEqual(["Low", "Medium", "High"]);
    expect(js.properties.fields.required).toEqual(fields.map((f) => f.key));
    expect(JSON.stringify(js)).not.toMatch(/minimum|maxLength|minLength/);
  });

  it("parses model output with explicit nulls for missing fields", () => {
    const out = parseExtractionOutput(
      { fields: { title: { value: "Roche opens lab", confidence: 1.4, evidence: "Article headline", null_reason: null } }, warnings: ["check date"] },
      fields,
    );
    expect(out.fields.title).toEqual({ value: "Roche opens lab", confidence: 1, evidence: "Article headline", nullReason: null });
    expect(out.fields.impact).toMatchObject({ value: null, confidence: null });
    expect(out.warnings[0]).toBe("check date");
    expect(out.warnings.some((w) => w.includes("missing"))).toBe(true);
  });
});

describe("exports", () => {
  const schema = defaultSchema();
  const rows = [{ signalId: "SIG-1", values: { date: "2026-09-01", competitors: ["Roche", "Pfizer"], title: '=HYPERLINK("x")', impact: "High" } }];

  it("includes Signal ID and every column, neutralising formula injection", () => {
    const t = toTable(schema, rows);
    // The Tracker columns (the Inbox-only Phantoms fields are not exported from the Tracker).
    expect(t[0]).toEqual(["Signal ID", ...trackerColumns(schema).map((c) => c.label)]);
    const csv = toCsv(t);
    expect(csv.startsWith("\uFEFFSignal ID,Title,Event Date,Macrotrend,")).toBe(true);
    expect(csv).toContain('"Roche, Pfizer"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(toTsv(t).split("\r\n")[1]?.split("\t")[0]).toBe("SIG-1");
    expect(safeCell("-5")).toBe("'-5");
  });

  it("writes a valid ZIP-based workbook", () => {
    const bytes = toXlsx(toTable(schema, rows));
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("Roche, Pfizer");
  });
});
