import { describe, expect, it } from "vitest";
import { moneyText, parseAmount } from "./model";

describe("request 65: money in the Epilepsy workbook", () => {
  it("reads amounts however they are written", () => {
    expect(parseAmount("1,000,000,000")).toBe(1e9);
    expect(parseAmount("$30B")).toBe(30e9);
    expect(parseAmount("USD 30.5bn")).toBe(30.5e9);
    expect(parseAmount("~$30bn (Oct 2025)")).toBe(30e9);
    expect(parseAmount("30B+")).toBe(30e9);
    expect(parseAmount("US$ 540 m")).toBe(540e6);
    expect(parseAmount("1.2 billion")).toBe(1.2e9);
    expect(parseAmount("(1,234)")).toBe(-1234);
    expect(parseAmount("-25%")).toBe(-25);
    expect(parseAmount("3e+10")).toBe(3e10);
    expect(parseAmount("n/a")).toBeNull();
    expect(parseAmount("")).toBeNull();
    // A column named “… (USD m)”: plain numbers are millions; a written unit wins.
    expect(parseAmount("540", 1e6)).toBe(540e6);
    expect(parseAmount("1.2bn", 1e6)).toBe(1.2e9);
  });

  it("abbreviates them for reading", () => {
    expect(moneyText("1000000000")).toBe("1 bn");
    expect(moneyText("$30,500,000,000")).toBe("30.5 bn");
    expect(moneyText("540000000")).toBe("540 m");
    expect(moneyText("12500")).toBe("12.5 k");
    expect(moneyText("1234567890")).toBe("1.23 bn");
    expect(moneyText("12", 1e9)).toBe("12 bn");
    expect(moneyText("Not disclosed")).toBe("Not disclosed");
  });
});
