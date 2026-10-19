import { describe, expect, it } from "vitest";
import { EPI_COLUMNS, abbreviate, acceptedOptions, columnHeader, columnIndex, epiLabel, headerScale, parseXlsxBook, toXlsxSheets, withColumnNames } from "../src/index.js";

describe("request 65: Epilepsy column names", () => {
  it("abbreviates amounts: 1,000,000,000 is “1 bn”", () => {
    expect([1e9, 30.5e9, 540e6, 12500, 999, 1234567890, -2.5e9, 1e12].map(abbreviate)).toEqual(["1 bn", "30.5 bn", "540 m", "12.5 k", "999", "1.23 bn", "-2.5 bn", "1 tn"]);
  });

  it("puts (USD) after the money columns' names", () => {
    expect(epiLabel("Market Cap")).toBe("Market Cap (USD)");
    expect(epiLabel("Q3 2026 Epilepsy Revenue")).toBe("Q3 2026 Epilepsy Revenue (USD)");
    expect(epiLabel("HQ")).toBe("HQ");
  });

  it("finds a column whatever currency note its name carries, and reads the note's unit", () => {
    const sheet = { columns: ["Company/competitor", "Market Cap (USD)", "Q1 2026 Epilepsy Revenue (USD m)", "RoA", "RoA (+frequency)"] };
    expect(columnHeader(sheet, "Market Cap")).toBe("Market Cap (USD)");
    expect(columnHeader(sheet, "Q1 2026 Epilepsy Revenue")).toBe("Q1 2026 Epilepsy Revenue (USD m)");
    // Notes that are not currencies still count as part of the name.
    expect(columnIndex(sheet, "RoA")).toBe(3);
    expect(columnIndex(sheet, "RoA (+frequency)")).toBe(4);
    expect(headerScale("Market Cap (USD)")).toBe(1);
    expect(headerScale("Revenue (USD m)")).toBe(1e6);
    expect(headerScale("Market Cap ($bn)")).toBe(1e9);
    expect(headerScale("Revenue in USD")).toBe(1);
  });

  it("reads a column an admin picked under the page's name, and sets aside one of that name", () => {
    const sheet = { name: "3. Platform Competitor Profiles", columns: ["Company/competitor", "Market Cap", "Mkt cap (USD bn)"], rows: [["UCB", "", "30"]] };
    const named = withColumnNames(sheet, { "Market Cap": "Mkt cap (USD bn)" });
    expect(named.columns).toEqual(["Company/competitor", "Market Cap [not used]", "Market Cap (USD bn)"]);
    expect(columnIndex(named, "Market Cap")).toBe(2);
    expect(headerScale(columnHeader(named, "Market Cap"))).toBe(1e9);
    // A picked column the sheet no longer has changes nothing.
    expect(withColumnNames(sheet, { "Market Cap": "Gone" }).columns).toEqual(sheet.columns);
  });

  it("lists every column the pages read, sheet by sheet, with the pages that use it", () => {
    expect(EPI_COLUMNS.profiles.map((c) => c.name)).toContain("Market Cap");
    const phase = EPI_COLUMNS.assets.find((c) => c.name === "Current Phase");
    expect(phase?.usedOn).toEqual(["Competitor Profiles · Assets", "RCA", "Trial Tracker"]);
    expect(new Set(EPI_COLUMNS.assets.map((c) => c.name)).size).toBe(EPI_COLUMNS.assets.length);
  });

  it("reads each sheet's dropdowns: typed options or a range on another sheet (not formulas)", async () => {
    const book = await parseXlsxBook(
      toXlsxSheets([
        {
          name: "4. Platform Trials & Assets",
          table: [["Company/competitor", "Current Phase", "RoA"], ["UCB", "Approved", "Oral"]],
          lists: [
            { sqref: "B2:B500", formula: "'Lists'!$A$2:$A$6" },
            { sqref: "C2:C500", formula: '"Oral,IV, Nasal,Oral"' },
            { sqref: "A2:A500", formula: "INDIRECT(\"x\")" },
          ],
        },
        { name: "Lists", table: [["Phases"], ["Phase 1"], ["Phase 2"], ["Phase 3"], ["Approved"]] },
      ]),
      (n) => n.startsWith("4."),
      { lists: true },
    );
    expect(book).toHaveLength(1);
    expect(book[0]?.lists).toEqual({ 1: ["Phase 1", "Phase 2", "Phase 3", "Approved"], 2: ["Oral", "IV", "Nasal"] });
  });

  it("accepts the workbook's options and those added in Admin, each once", () => {
    expect(acceptedOptions(["Phase 1", "Approved"], ["Phase 4", "approved", " "])).toEqual(["Phase 1", "Approved", "Phase 4"]);
  });
});
