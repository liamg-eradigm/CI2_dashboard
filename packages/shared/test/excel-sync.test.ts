import { describe, expect, it } from "vitest";
import { COMPETITOR_COLUMNS, MACROTREND_COLUMNS, columnIs, parseXlsxBook, sheetKindOf, toXlsxSheets } from "../src/index";

describe("request 55: the SharePoint workbook", () => {
  it("reads every sheet of a workbook, in order, by name", async () => {
    const bytes = toXlsxSheets([
      { name: "Primary", table: [["ID", "Title"], ["P-1", "One & two"]] },
      { name: "Macrotrend Analysis", table: [["Macrotrend"], ["Geopolitics"]] },
    ]);
    const book = await parseXlsxBook(bytes);
    expect(book.map((s) => s.name)).toEqual(["Primary", "Macrotrend Analysis"]);
    expect(book[0]!.grid).toEqual([["ID", "Title"], ["P-1", "One & two"]]);
    expect(book[1]!.grid).toEqual([["Macrotrend"], ["Geopolitics"]]);
  });

  it("knows the four sheets by name, in any case or spacing", () => {
    expect(sheetKindOf("Primary")).toBe("primary");
    expect(sheetKindOf(" secondary tracker ")).toBe("secondary");
    expect(sheetKindOf("Competitor Trend Analysis")).toBe("competitor");
    expect(sheetKindOf("macrotrend_analysis")).toBe("macrotrend");
    expect(sheetKindOf("Notes")).toBeNull();
  });

  it("matches the trend sheets' columns (the field's name, or the form's question)", () => {
    expect(columnIs("Company profile", COMPETITOR_COLUMNS.text)).toBe(true);
    expect(columnIs("Trend Analysis", COMPETITOR_COLUMNS.text)).toBe(true);
    expect(columnIs("Competitor", COMPETITOR_COLUMNS.name)).toBe(true);
    expect(columnIs("What is Geopolitics?", MACROTREND_COLUMNS.sections.overview)).toBe(true);
    expect(columnIs("Macrotrend overview", MACROTREND_COLUMNS.sections.overview)).toBe(true);
    expect(columnIs("Why does it matter", MACROTREND_COLUMNS.sections.why)).toBe(true);
    expect(columnIs("Impact on AbbVie", MACROTREND_COLUMNS.sections.abbvie)).toBe(true);
    expect(columnIs("What is", MACROTREND_COLUMNS.sections.overview)).toBe(false);
    expect(columnIs("Notes", MACROTREND_COLUMNS.sections.next)).toBe(false);
  });
});
