import { describe, expect, it } from "vitest";
import { defaultSchema, entryMarkdown, markdownFileName, mergeSchemas, normaliseValues, trackerColumns, validateValues, yamlScalar } from "../src/index";

describe("Phantoms Markdown", () => {
  it("quotes only values YAML would misread", () => {
    expect(yamlScalar("Roche")).toBe("Roche");
    expect(yamlScalar("Roche, Pfizer")).toBe("Roche, Pfizer");
    expect(yamlScalar("https://x.com/a?b=1#c")).toBe("https://x.com/a?b=1#c");
    expect(yamlScalar("2026-09-24")).toBe("2026-09-24");
    for (const v of ["Roche: new lab", "#1 launch", "a #tag", "true", "No", "null", "007", "1e3", "-lead", "[x]", "'quoted'", " padded"]) {
      expect(yamlScalar(v).startsWith('"')).toBe(true);
    }
    expect(yamlScalar('He said "hi": ok')).toBe('"He said \\"hi\\": ok"');
    expect(yamlScalar("")).toBe("");
  });

  it("writes empty fields as bare keys and keeps the agreed layout", () => {
    const md = entryMarkdown({ record_id: "P-1", title: "T" }, { reviewedBy: null });
    expect(md.split("\n").slice(0, 6)).toEqual(["---", "id: P-1", "title: T", "event_date:", "source_type:", "Source:"]);
    expect(md).toContain("QC:\n  Reviewed_by:\n  Review_date:\n  Accurate_as_of:\n---\n## Header\n\n\n## Key Details\n\n\n## CI Perspective\n\n");
  });

  it("names the file after the ID, safely", () => {
    expect(markdownFileName({ record_id: "P-1001" }, "SIG-1")).toBe("P-1001.md");
    expect(markdownFileName({ record_id: "../a b/c" }, "SIG-1")).toBe("a_b_c.md");
    expect(markdownFileName({}, "SIG-1")).toBe("SIG-1.md");
  });
});

describe("streams and the 22-column default", () => {
  it("keeps the previous nine columns in the Tracker", () => {
    expect(trackerColumns(defaultSchema()).map((c) => c.key)).toEqual(["macrotrend", "subtrend", "title", "date", "impact", "growth", "source", "competitors", "action"]);
  });

  it("keeps paragraphs in long text and validates its length", () => {
    const s = defaultSchema();
    const v = normaliseValues(s, { key_details: "  One.\r\n\r\n\r\n\r\nTwo.  \n" , title: " a   b " });
    expect(v.key_details).toBe("One.\n\nTwo.");
    expect(v.title).toBe("a b");
    expect(validateValues(s, { key_details: "x".repeat(20001) }, { forApproval: false }).map((e) => e.key)).toEqual(["key_details"]);
  });

  it("merges both streams for the Dashboard (union of options, Primary order first)", () => {
    const p = defaultSchema();
    const s = defaultSchema();
    s.columns.find((c) => c.key === "competitors")!.options!.push("Bayer");
    s.taxonomy[0]!.subtrends.push("New secondary subtrend");
    s.taxonomy.push({ name: "Secondary-only macro", subtrends: ["Only here"] });
    const m = mergeSchemas(p, s);
    expect(m.columns.find((c) => c.key === "competitors")!.options).toEqual([...p.columns.find((c) => c.key === "competitors")!.options!, "Bayer"]);
    expect(m.taxonomy[0]!.subtrends.at(-1)).toBe("New secondary subtrend");
    expect(m.taxonomy.at(-1)).toEqual({ name: "Secondary-only macro", subtrends: ["Only here"] });
  });
});
