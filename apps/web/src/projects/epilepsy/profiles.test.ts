import { describe, expect, it } from "vitest";
import { EPI_COLUMNS, type EpilepsyData } from "@eradigm/shared";
import { assetsOf } from "./profiles";

const data = (profiles: string[][], assets: string[][]): EpilepsyData => ({
  sheets: {
    secondary: null,
    primary: null,
    profiles: { name: "3. Platform Competitor Profiles", columns: profiles[0]!, rows: profiles.slice(1) },
    assets: { name: "4. Platform Trials & Assets", columns: assets[0]!, rows: assets.slice(1) },
  },
  colours: {},
  columnNames: {},
  dropdowns: {},
  addedOptions: {},
  syncedAt: null,
});

describe("request 66: a company's assets come from Epilepsy Assets alone", () => {
  const trials = [
    ["Company/competitor", "Asset Name", "MoA", "RoA (+frequency)", "Current Phase"],
    ["UCB", "Fintepla", "5-HT release", "Oral, BID", "Approved"],
    ["UCB", "Briviact", "SV2A", "Oral, BID", "Approved"],
    ["UCB", "Staccato", "GABA-A", "Inhaled", "Phase 3"],
  ];

  it("reads several assets in one cell, or one per row of the company's block, and ignores the profile's Asset Name", () => {
    const d = data(
      [
        ["Company/competitor", "Epilepsy Assets", "Asset Name"],
        ["UCB", "Fintepla, Briviact", "Something else"],
        ["UCB", "Staccato", "Briviact"],
        ["UCB", "", "Ghost"],
      ],
      trials,
    );
    expect(assetsOf(d, "UCB")).toEqual([
      { company: "UCB", name: "Fintepla", moa: "5-HT release", roa: "Oral, BID", phase: "Approved" },
      { company: "UCB", name: "Briviact", moa: "SV2A", roa: "Oral, BID", phase: "Approved" },
      { company: "UCB", name: "Staccato", moa: "GABA-A", roa: "Inhaled", phase: "Phase 3" },
    ]);
  });

  it("no longer lists the profile's Asset Name in Admin → Column names", () => {
    expect(EPI_COLUMNS.profiles.map((c) => c.name)).not.toContain("Asset Name");
    expect(EPI_COLUMNS.profiles.map((c) => c.name)).toContain("Epilepsy Assets");
    // Trials & Assets keeps its own Asset Name (each asset's MoA, RoA and phase).
    expect(EPI_COLUMNS.assets.map((c) => c.name)).toContain("Asset Name");
  });
});
