import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultSchema, entryMarkdown, excelDate, parseDelimited, parseSpreadsheet, toXlsx } from "../src/index";

describe("spreadsheet reader (tracker import)", () => {
  it("reads the first sheet of a real (deflate-compressed) .xlsx made by a spreadsheet app", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("./fixtures/legacy.xlsx", import.meta.url)));
    const grid = await parseSpreadsheet(bytes, "legacy.xlsx");
    expect(grid[0]).toEqual(["ID", "Title", "Event Date", "Competitors", "Key Details"]);
    expect(grid[1]?.slice(0, 2)).toEqual(["P-1", 'Roche: new lab & "more"']);
    expect(excelDate(grid[1]?.[2] ?? "")).toBe("2025-09-24");
    expect(grid[1]?.[3]).toBe("Roche, Pfizer");
    expect(grid[1]?.[4]).toBe("Line one\nLine two");
    expect(grid[2]).toEqual(["P-2", "1234", "2025-01-31", "", "Ünïcødé ✓"]);
    expect(grid[3]?.filter(Boolean) ?? []).toEqual([]);
    expect(grid[4]?.[1]).toBe("Title, with a comma");
    expect(excelDate(grid[4]?.[2] ?? "")).toBe("2024-02-29");
  });

  it("reads the stored (uncompressed) .xlsx files this platform exports, e.g. the import template", async () => {
    const bytes = toXlsx([["ID", "Title"], ["S-1", "Sanofi, Inc."]]);
    expect(await parseSpreadsheet(bytes, "t.xlsx")).toEqual([["ID", "Title"], ["S-1", "Sanofi, Inc."]]);
  });

  it("reads CSV and TSV with quotes, embedded delimiters, line breaks and a BOM", async () => {
    const csv = '﻿ID,Title,Key Details\r\nP-1,"Roche, Pfizer","Line ""one""\nLine two"\r\nP-2,Plain,\r\n';
    expect(parseDelimited(csv, ",")).toEqual([["ID", "Title", "Key Details"], ["P-1", "Roche, Pfizer", 'Line "one"\nLine two'], ["P-2", "Plain", ""]]);
    const tsv = new TextEncoder().encode("ID\tTitle\nP-1\tA, B\n");
    expect(await parseSpreadsheet(tsv, "x.tsv")).toEqual([["ID", "Title"], ["P-1", "A, B"]]);
    await expect(parseSpreadsheet(tsv, "x.xls")).rejects.toThrow(/xlsx, .csv or .tsv/);
  });

  it("converts dates: ISO, Excel serial numbers and DD/MM/YYYY", () => {
    expect(excelDate("2025-09-24")).toBe("2025-09-24");
    expect(excelDate("2025-9-4T10:00:00")).toBe("2025-09-04");
    expect(excelDate("45924")).toBe("2025-09-24");
    expect(excelDate("45924.5")).toBe("2025-09-24");
    expect(excelDate("24/09/2025")).toBe("2025-09-24");
    expect(excelDate("next week")).toBe("next week");
    expect(excelDate("")).toBe("");
  });
});

describe("Primary layout", () => {
  it("keeps the Tracker/Dashboard columns and leaves them out of the Primary Markdown", () => {
    const s = defaultSchema("primary");
    expect(s.columns.filter((c) => c.inTracker).map((c) => c.label)).toEqual(["Title", "Event Date", "Macrotrend", "Subtrend", "Growth Intensity", "Impact", "Source Type", "Competitors", "Action"]);
    const md = entryMarkdown(
      { record_id: "P-1", title: "T", date: "2026-01-02", macrotrend: "Geopolitics", impact: "High", competitors: ["Roche"], source: "PR", action: "Actioned", key_metrics: "5%" },
      { reviewedBy: "X" },
      "primary",
    );
    expect(md).not.toMatch(/Geopolitics|High|Roche|source_type|QC:/);
    expect(md).toContain("Action: Actioned\n");
    expect(md.endsWith("## Key Metrics\n5%\n")).toBe(true);
  });
});

describe("import rules (follow the Inbox columns)", () => {
  it("matches dropdown values whatever their capitals, spacing, quotes or dashes, but only to one option", async () => {
    const { matchOption, foldOption } = await import("../src/index");
    expect(matchOption("  press   RELEASE ", ["PR", "Press Release"])).toBe("Press Release");
    expect(matchOption("Pfizer’s pick – AI", ["Pfizer's pick - AI"])).toBe("Pfizer's pick - AI");
    expect(matchOption("Unknown", ["PR"])).toBeNull();
    expect(matchOption("ab", ["AB", "ab ", "Ab"])).toBeNull(); // ambiguous
    expect(foldOption("R&D  Hub")).toBe("r&d hub");
  });

  it("describes every column from the current schema and writes the options into the template", async () => {
    const { defaultSchema, importRules, optionSheets, toXlsxSheets, parseXlsx } = await import("../src/index");
    const s = defaultSchema("secondary");
    s.columns.find((c) => c.key === "source")!.options!.push("Analyst Call");
    const rules = importRules(s);
    expect(rules.map((r) => r.label)).not.toContain("Source Tier"); // set automatically
    const src = rules.find((r) => r.key === "source")!;
    expect(src).toMatchObject({ required: true, accepts: "One of the options" });
    expect(src.options).toContain("Analyst Call");
    expect(rules.find((r) => r.key === "competitors")!.accepts).toMatch(/separated by commas/);
    const sheets = optionSheets(s);
    expect(sheets.map((x) => x.name)).toEqual(["Options", "Subtrends"]);
    const col = sheets[0]!.table[0]!.indexOf("Source Type");
    expect(sheets[0]!.table.map((r) => r[col])).toContain("Analyst Call");
    expect(sheets[1]!.table[0]).toEqual(["Macrotrend", "Subtrend"]);
    // A real multi-sheet workbook; the first sheet (the template) is what an import reads.
    const bytes = toXlsxSheets([{ name: "Secondary Tracker", table: [rules.map((r) => r.label)] }, ...sheets]);
    const grid = await parseXlsx(bytes);
    expect(grid[0]).toEqual(rules.map((r) => r.label));
  });
});
