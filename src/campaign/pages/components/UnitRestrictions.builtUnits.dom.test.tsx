// @vitest-environment happy-dom
/**
 * A campaign's units from the unit builder are restrictable like the game's
 * own (issue #4516), so the picker lists them under the builders that build
 * them.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/content/config", () => ({
  invalidateGameInfo: () => {},
  useUnitsyncScan: () => ({
    data: {
      games: [{ name: "Splinter Faction", primaryArchive: { name: "sf.sdz" } }],
    },
    error: null,
    loading: false,
    run: () => {},
  }),
  useUnitsyncGameInfo: () => ({ info: null, loading: false, reload: () => {} }),
  useUnitsyncUnitDataset: () => ({
    dataset: {
      units: [{ name: "armlab", buildOptions: ["armpw"] }, { name: "armpw" }],
    },
    loading: false,
    reload: () => {},
  }),
}));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({ target: {} }),
}));
// The picker itself is tested elsewhere. This lists what it was handed.
vi.mock("@/content/pages/components/UnitPicker", () => ({
  UnitPicker: ({
    units,
    selected,
  }: {
    units: { name: string; fullName?: string; buildOptions?: string[] }[];
    selected: string[];
  }) => (
    <ul>
      {units.map((u) => (
        <li key={u.name}>
          {u.name}|{u.fullName ?? ""}|{(u.buildOptions ?? []).join(",")}|
          {selected.includes(u.name) ? "allowed" : "banned"}
        </li>
      ))}
    </ul>
  ),
}));

import { UnitRestrictions } from "./UnitRestrictions";

afterEach(cleanup);

describe("UnitRestrictions with a campaign's units", () => {
  it("lists them with the game's own, on their builders' lists", () => {
    render(
      <UnitRestrictions
        gameName="Splinter Faction"
        disabledUnits={["tank"]}
        onChange={() => {}}
        builtUnits={[{ unitName: "tank", name: "Tank", builtBy: ["armlab"] }]}
      />,
    );
    expect(screen.getByText("armlab||armpw,tank|allowed")).toBeTruthy();
    expect(screen.getByText("tank|Tank||banned")).toBeTruthy();
    // A ban on a unit the picker now knows is a checkbox, not a leftover tag.
    expect(screen.queryByText(/Banned but not in this game/)).toBeNull();
  });
});
