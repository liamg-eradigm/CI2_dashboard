import { describe, expect, it } from "vitest";
import { fromDoc, toDoc } from "./richDoc";

describe("formatted text in the editor (request 46)", () => {
  it("round-trips paragraphs, blank lines, titles, nested bullets, numbered lists and marks", () => {
    const text = [
      '### **Pricing** <span style="font-size:1.3em">update</span>',
      "Payers <u>pushed back</u>.",
      "",
      "- Rejections",
      "  - fell to **5%**",
      "    - new evidence",
      "- Uptake",
      "1. First",
      "2. Second",
      "Last line",
    ].join("\n");
    expect(fromDoc(toDoc(text))).toBe(text);
  });
  it("keeps plain text as it is, and an empty value empty", () => {
    expect(fromDoc(toDoc("Just text\nTwo lines"))).toBe("Just text\nTwo lines");
    expect(fromDoc(toDoc(""))).toBe("");
  });
  it("nests a bullet that skips a level under the one above", () => {
    expect(fromDoc(toDoc("- a\n    - b"))).toBe("- a\n  - b");
  });
});
