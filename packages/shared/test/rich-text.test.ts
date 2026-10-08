import { describe, expect, it } from "vitest";
import { isFormatted, parseInline, parseRich, plainText, serializeRich, stepFontSize } from "../src/index.js";

describe("formatted text (request 46)", () => {
  it("reads bold, underline and font size inside a line", () => {
    expect(parseInline('Plain **bold <u>both</u>** <span style="font-size:1.3em">big <u>under</u></span> end')).toEqual([
      { text: "Plain " },
      { text: "bold ", bold: true },
      { text: "both", bold: true, underline: true },
      { text: " " },
      { text: "big ", size: 1.3 },
      { text: "under", underline: true, size: 1.3 },
      { text: " end" },
    ]);
  });
  it("keeps lone markers and unknown tags as text", () => {
    expect(parseInline("2 ** 3 is not bold")).toEqual([{ text: "2 ** 3 is not bold" }]);
    expect(parseInline("a </u> b <b>c</b>")).toEqual([{ text: "a </u> b <b>c</b>" }]);
  });
  it("round-trips titles, paragraphs, blank lines and nested bullets", () => {
    const text = '### **Pricing** update\nPayers <u>pushed back</u>.\nThen accepted it.\n\n- Rejections\n  - fell to <span style="font-size:1.5em">5%</span>\n    - **new** evidence\n1. First\n2. Second';
    expect(serializeRich(parseRich(text))).toBe(text);
    const blocks = parseRich(text);
    expect(blocks[0]).toMatchObject({ kind: "title" });
    expect(blocks[5]).toMatchObject({ kind: "item", depth: 1, ordered: false });
    expect(blocks[8]).toMatchObject({ kind: "item", depth: 0, ordered: true, marker: "2." });
  });
  it("gives the plain text, unchanged when there is no formatting", () => {
    expect(plainText('### Title\n**Bold** and <u>under</u> <span style="font-size:2em">big</span>\n  - item')).toBe("Title\nBold and under big\n  - item");
    const plain = "Nothing ** special\n- a bullet";
    expect(plainText(plain)).toBe(plain);
    expect(isFormatted(plain)).toBe(false);
    expect(isFormatted("**x**")).toBe(true);
  });
  it("steps the font size up and down", () => {
    expect(stepFontSize(null, 1)).toBe(1.15);
    expect(stepFontSize(1.15, 1)).toBe(1.3);
    expect(stepFontSize(2, 1)).toBe(2);
    expect(stepFontSize(1, -1)).toBe(0.85);
    expect(stepFontSize(1.3, -1)).toBe(1.15);
  });
});
