import { describe, expect, it } from "vitest";
import {
  ALL,
  CORE,
  CORE_KEYS,
  DEFAULT_TAXONOMY,
  bucket,
  checkColumnLabel,
  checkOptionName,
  defaultSchema,
  enforceTaxonomy,
  getColumn,
  impactWeight,
  levelOf,
  macroOfSubtrend,
  normaliseValues,
  subtrendsOf,
  validateValues,
  type ItemValues,
} from "../src/index.js";

const schema = defaultSchema();
const valid: ItemValues = {
  date: "2026-09-24",
  competitors: ["Sanofi"],
  macrotrend: "Direct-to-Patient (DTP) Strategy",
  subtrend: "Direct-to-Employer (DTE)",
  title: "Sanofi signs direct-to-employer agreement",
  growth: "Slight Increase",
  impact: "High",
  source: "LinkedIn",
  action: "Not Actioned",
};

describe("default taxonomy (3_Frontend_Design)", () => {
  it("has the eight macrotrends plus Others, in document order", () => {
    expect(DEFAULT_TAXONOMY.map((g) => g.name)).toEqual([
      "AI Investment in R&D",
      "Workforce AI Upskilling",
      "Integrated Digital Pharma Innovation",
      "Direct-to-Patient (DTP) Strategy",
      "Geopolitics",
      "Portfolio Restructuring",
      "Medical-grade Intelligence Augmentation",
      "Robotics and Open-source Models for Pharma",
      "Others",
    ]);
  });

  it("never stores 'All' as a subtrend", () => {
    for (const g of DEFAULT_TAXONOMY) expect(g.subtrends).not.toContain(ALL);
  });

  it("has globally unique subtrend names", () => {
    const all = DEFAULT_TAXONOMY.flatMap((g) => g.subtrends);
    expect(new Set(all).size).toBe(all.length);
  });

  it("maps subtrends to their macrotrend", () => {
    expect(subtrendsOf(schema, "Geopolitics")).toEqual(["IRA Pricing/Tariffs", "Bypassing Traditional Intermediaries (PBMs, Insurers)"]);
    expect(subtrendsOf(schema, ALL).length).toBe(DEFAULT_TAXONOMY.flatMap((g) => g.subtrends).length);
    expect(macroOfSubtrend(schema, "Mergers & Acquisitions")).toBe("Portfolio Restructuring");
  });

  it("keeps the seven chart-critical columns as core", () => {
    expect(schema.columns.filter((c) => c.core).map((c) => c.key)).toEqual(CORE_KEYS);
    expect(getColumn(schema, "source")?.core).toBe(false);
    expect(getColumn(schema, "action")?.aiAssist).toBe(false);
  });

  it("encodes growth Stable=0, Slight Increase=1, Strong Increase=2", () => {
    const g = getColumn(schema, CORE.growth);
    expect(["Stable", "Slight Increase", "Strong Increase"].map((v) => levelOf(g, v))).toEqual([0, 1, 2]);
    const i = getColumn(schema, CORE.impact);
    expect(["Low", "Medium", "High"].map((v) => impactWeight(i, v))).toEqual([1, 2, 3]);
    expect([bucket(0, 3), bucket(1, 3), bucket(2, 3), bucket(-1, 3)]).toEqual([0, 1, 2, 0]);
  });
});

describe("validateValues", () => {
  it("accepts a complete, valid draft", () => {
    expect(validateValues(schema, valid, { forApproval: true })).toEqual([]);
  });

  it("requires required fields only on approval", () => {
    const draft = { ...valid, impact: null, subtrend: null };
    expect(validateValues(schema, draft, { forApproval: false })).toEqual([]);
    const errs = validateValues(schema, draft, { forApproval: true });
    expect(errs.map((e) => [e.key, e.code])).toEqual([
      ["subtrend", "required"],
      ["impact", "required"],
    ]);
  });

  it("rejects values outside the taxonomy, 'All' and mismatched subtrends", () => {
    expect(validateValues(schema, { ...valid, impact: "Critical" }, { forApproval: true })[0]?.code).toBe("not_in_taxonomy");
    expect(validateValues(schema, { ...valid, macrotrend: ALL }, { forApproval: true })[0]?.code).toBe("reserved_value");
    expect(validateValues(schema, { ...valid, subtrend: "Mergers & Acquisitions" }, { forApproval: true })[0]?.code).toBe(
      "subtrend_mismatch",
    );
    expect(validateValues(schema, { ...valid, competitors: ["Sanofi", "Bayer"] }, { forApproval: true })[0]?.message).toContain("Bayer");
    expect(validateValues(schema, { ...valid, date: "2026-02-30" }, { forApproval: true })[0]?.code).toBe("invalid_date");
  });

  it("allows multiple competitors on one item", () => {
    expect(validateValues(schema, { ...valid, competitors: ["AstraZeneca", "Roche"] }, { forApproval: true })).toEqual([]);
  });

  it("normalises comma-separated competitors and blank strings", () => {
    const v = normaliseValues(schema, { competitors: " Roche , AstraZeneca,Roche ", title: "  Hello   world ", impact: "" });
    expect(v.competitors).toEqual(["Roche", "AstraZeneca"]);
    expect(v.title).toBe("Hello world");
    expect(v.impact).toBeNull();
    expect(Object.keys(v)).toEqual(schema.columns.map((c) => c.key));
  });
});

describe("enforceTaxonomy (model can never create taxonomy values)", () => {
  it("drops invented values to null with a warning", () => {
    const { values, warnings } = enforceTaxonomy(schema, {
      ...valid,
      macrotrend: "Robotics and Open-source Models for Pharma",
      subtrend: "Autonomous Lab Operations",
      competitors: ["Pfizer", "Bayer"],
      impact: "Severe",
    });
    expect(values.subtrend).toBeNull();
    expect(values.competitors).toEqual(["Pfizer"]);
    expect(values.impact).toBeNull();
    expect(warnings.map((w) => w.key).sort()).toEqual(["competitors", "impact", "subtrend"]);
  });

  it("drops a subtrend that does not belong to the proposed macrotrend", () => {
    const { values } = enforceTaxonomy(schema, { ...valid, macrotrend: "Geopolitics", subtrend: "Direct-to-Employer (DTE)" });
    expect(values.macrotrend).toBe("Geopolitics");
    expect(values.subtrend).toBeNull();
  });

  it("infers the macrotrend from a valid subtrend when missing", () => {
    const { values } = enforceTaxonomy(schema, { ...valid, macrotrend: null, subtrend: "Industry Awards" });
    expect(values.macrotrend).toBe("Integrated Digital Pharma Innovation");
  });
});

describe("schema editing rules", () => {
  it("rejects duplicate column names case-insensitively", () => {
    expect(checkColumnLabel(schema, "impact")).toEqual({ ok: false, error: "A column called “impact” already exists" });
    expect(checkColumnLabel(schema, "Impact", "impact").ok).toBe(true);
    expect(checkColumnLabel(schema, "  Region  ")).toEqual({ ok: true, value: "Region" });
  });

  it("rejects duplicate and reserved option names", () => {
    const sub = getColumn(schema, CORE.subtrend)!;
    expect(checkOptionName(schema, sub, "industry awards").ok).toBe(false);
    expect(checkOptionName(schema, sub, "All").ok).toBe(false);
    expect(checkOptionName(schema, getColumn(schema, "impact")!, "Critical").ok).toBe(true);
  });
});
