import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  ALL,
  DEFAULT_TREND_THRESHOLDS,
  ROLES,
  baselinePeriod,
  can,
  canChangeRole,
  canCreateUserWithRole,
  canTransition,
  computePeriodStats,
  defaultDateRange,
  defaultFilters,
  defaultSchema,
  evaluateTrend,
  filtersFromParams,
  filtersToParams,
  isContractCompatible,
  isDefaultFilters,
  minusMonths,
  setFilterValue,
  todayIso,
  type Action,
} from "../src/index.js";

describe("permission rules", () => {
  it("gives clients read/export access, plus their Client Inbox", () => {
    const allowed = ACTIONS.filter((a) => can("client", a));
    expect(allowed).toEqual(["dashboard:read", "tracker:read", "tracker:export", "savedView:write", "clientInbox:read", "clientInbox:act"]);
    // Analysts work in the Eradigm Inbox, not the client's.
    expect(can("analyst", "clientInbox:read")).toBe(false);
    expect(can("admin", "clientInbox:act")).toBe(true);
  });

  it("restricts input, review and schema editing to analysts and admins", () => {
    for (const a of ["submission:create", "item:review", "schema:edit", "inbox:read"] as Action[]) {
      expect(can("analyst", a)).toBe(true);
      expect(can("admin", a)).toBe(true);
      expect(can("client", a)).toBe(false);
    }
  });

  it("lets analysts create only analyst and client accounts", () => {
    expect(canCreateUserWithRole("analyst", "analyst")).toBe(true);
    expect(canCreateUserWithRole("analyst", "client")).toBe(true);
    expect(canCreateUserWithRole("analyst", "admin")).toBe(false);
    expect(canCreateUserWithRole("client", "client")).toBe(false);
    expect(canCreateUserWithRole("admin", "admin")).toBe(true);
  });

  it("lets only admins change roles, deactivate users and read the audit log", () => {
    for (const r of ROLES) expect(canChangeRole(r)).toBe(r === "admin");
    expect(can("analyst", "user:deactivate")).toBe(false);
    expect(can("analyst", "audit:read")).toBe(false);
    expect(can(null, "dashboard:read")).toBe(false);
  });

  it("enforces the item lifecycle", () => {
    expect(canTransition("needs_review", "approved")).toBe(true);
    expect(canTransition("queued", "approved")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(true);
    expect(canTransition("deleted", "queued")).toBe(false);
  });

  it("checks contract major versions", () => {
    expect(isContractCompatible("1.4.0", "1.0.0")).toBe(true);
    expect(isContractCompatible("2.0.0", "1.0.0")).toBe(false);
  });
});

describe("date defaults (Date to = today, Date from = 3 months before)", () => {
  it("computes the range from the day of use", () => {
    expect(defaultDateRange("2026-09-28")).toEqual({ from: "2026-06-28", to: "2026-09-28" });
    expect(defaultDateRange("2027-01-15")).toEqual({ from: "2026-10-15", to: "2027-01-15" });
  });

  it("clamps to the end of shorter months", () => {
    expect(minusMonths("2026-05-31", 3)).toBe("2026-02-28");
    expect(minusMonths("2028-05-31", 3)).toBe("2028-02-29");
  });

  it("uses the supplied time zone for 'today'", () => {
    const instant = new Date("2026-09-28T23:30:00Z");
    expect(todayIso(instant, "UTC")).toBe("2026-09-28");
    expect(todayIso(instant, "Asia/Tokyo")).toBe("2026-09-29");
  });
});

describe("filter state", () => {
  const schema = defaultSchema();
  it("defaults the dates to everything in view: oldest entry to today (or the newest entry, if later)", () => {
    expect(defaultDateRange("2026-09-28", { oldest: "2019-04-02", newest: "2026-09-20" })).toEqual({ from: "2019-04-02", to: "2026-09-28" });
    expect(defaultDateRange("2026-09-28", { oldest: "2026-01-15", newest: "2026-12-01" })).toEqual({ from: "2026-01-15", to: "2026-12-01" });
    // No entries yet: the last three months.
    expect(defaultDateRange("2026-09-28", { oldest: null, newest: null })).toEqual({ from: "2026-06-28", to: "2026-09-28" });
    expect(defaultDateRange("2026-09-28")).toEqual({ from: "2026-06-28", to: "2026-09-28" });
    const f = filtersFromParams(new URLSearchParams(""), { today: "2026-09-28", bounds: { oldest: "2020-02-02", newest: "2026-09-01" } });
    expect([f.from, f.to]).toEqual(["2020-02-02", "2026-09-28"]);
    expect(isDefaultFilters(f, "2026-09-28", { oldest: "2020-02-02", newest: "2026-09-01" })).toBe(true);
  });

  it("resets the subtrend when the macrotrend changes and drops 'All'", () => {
    let f = defaultFilters("2026-09-28");
    f = setFilterValue(f, "subtrend", "Industry Awards");
    f = setFilterValue(f, "macrotrend", "Geopolitics");
    expect(f.values).toEqual({ macrotrend: "Geopolitics" });
    f = setFilterValue(f, "macrotrend", ALL);
    expect(f.values).toEqual({});
    expect(isDefaultFilters(f, "2026-09-28")).toBe(true);
  });

  it("round-trips through query parameters and ignores unknown keys", () => {
    const f = { q: "alliance", from: "2026-01-01", to: "2026-09-25", values: { macrotrend: "Geopolitics", competitors: "Roche" } };
    const p = filtersToParams(f);
    p.set("f.bogus", "x");
    expect(filtersFromParams(p, { schema, today: "2026-09-28" })).toEqual(f);
  });

  it("falls back to today's defaults for invalid dates and swaps inverted ranges", () => {
    expect(filtersFromParams(new URLSearchParams("from=nope"), { today: "2026-09-28" })).toMatchObject({ from: "2026-06-28", to: "2026-09-28" });
    expect(filtersFromParams(new URLSearchParams("from=2026-09-01&to=2026-01-01"))).toMatchObject({ from: "2026-01-01", to: "2026-09-01" });
  });
});

describe("Trend Test", () => {
  const cfg = { macrotrend: ALL, subtrend: ALL, competitors: [], growth: ALL, from: "2026-07-01", to: "2026-09-28", thresholds: DEFAULT_TREND_THRESHOLDS };

  it("derives an immediately preceding baseline of equal length", () => {
    const { current, baseline } = baselinePeriod("2026-07-01", "2026-09-28");
    expect(current.days).toBe(90);
    expect(baseline).toEqual({ from: "2026-04-02", to: "2026-06-30", days: 90 });
  });

  it("computes counts, distinct competitors, impact-weighted and growth scores", () => {
    const s = computePeriodStats([
      { competitors: ["Roche", "Pfizer"], impactIndex: 2, growthIndex: 2 },
      { competitors: ["Roche"], impactIndex: 0, growthIndex: 1 },
    ]);
    expect(s).toEqual({ count: 2, distinctCompetitors: 2, impactScore: 4, growthScore: 1.5 });
  });

  it("confirms a trend only when every rule is met", () => {
    const cur = { count: 10, distinctCompetitors: 4, impactScore: 22, growthScore: 1.4 };
    const base = { count: 6, distinctCompetitors: 3, impactScore: 12, growthScore: 1.0 };
    const r = evaluateTrend(cfg, cur, base);
    expect(r.confirmed).toBe(true);
    expect(r.verdict).toBe("Trend confirmed");
    expect(r.metrics.every((m) => m.met)).toBe(true);
    expect(r.metrics.find((m) => m.key === "count")?.change).toBe("+66.67%");
  });

  it("lists unmet rules and fails the sample-size rule", () => {
    const r = evaluateTrend(cfg, { count: 3, distinctCompetitors: 2, impactScore: 6, growthScore: 1 }, { count: 3, distinctCompetitors: 2, impactScore: 6, growthScore: 1 });
    expect(r.confirmed).toBe(false);
    expect(r.verdict).toBe("No trend detected");
    expect(r.unmetRules).toContain("Minimum sample size");
    expect(r.unmetRules).toContain("Approved signal count");
    expect(r.disclaimer).toMatch(/not statistical proof/);
  });

  it("shows Not applicable progress when the baseline denominator is zero", () => {
    const r = evaluateTrend(cfg, { count: 6, distinctCompetitors: 3, impactScore: 12, growthScore: 1 }, { count: 0, distinctCompetitors: 0, impactScore: 0, growthScore: null });
    const count = r.metrics.find((m) => m.key === "count")!;
    expect(count.progress).toBeNull();
    expect(count.change).toBe("New (baseline 0)");
    expect(count.met).toBe(true);
    const growth = r.metrics.find((m) => m.key === "growth")!;
    expect(growth.change).toBe("Not applicable");
    expect(growth.met).toBe(false);
  });
});
