// @vitest-environment happy-dom
/**
 * Drives `GameUnitPage` under a real DOM, following the mocking shape
 * `GameUnitsPage.dom.test.tsx` uses: the unitsync hooks are mocked so the test
 * exercises the rendered page rather than a real scan. `useUnitsyncUnitModel`
 * is mocked too, because `UnitModelPanel` (embedded here) calls it directly.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnitDatasetEntry } from "../bindings";

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

const GAME_NAME = "Test Game";

let mockUnits: UnitDatasetEntry[] = [];
let mockModelPending = false;

vi.mock("../config", () => ({
  useScanTargetSelection: () => ({ selected: SELECTED }),
  useUnitsyncScan: () => ({
    data: {
      games: [
        {
          name: GAME_NAME,
          primaryArchive: { name: "test.sdz" },
          dependencyArchives: [],
          info: {},
        },
      ],
      maps: [],
      errors: [],
    },
    loading: false,
    error: null,
    run: () => {},
  }),
  useUnitsyncGameInfo: () => ({
    info: {
      sides: [],
      unitCount: mockUnits.length,
      units: [],
      options: [],
      errors: [],
    },
    loading: false,
  }),
  useUnitsyncUnitDataset: () => ({
    dataset: { units: mockUnits, errors: [] },
    status: "ready",
  }),
  useUnitsyncUnitBuildpics: () => null,
  useUnitsyncUnitModel: () =>
    mockModelPending
      ? { model: null, loading: true, failed: false }
      : { model: null, loading: false, failed: false },
}));

const { default: GameUnitPage } = await import("./GameUnitPage");

afterEach(cleanup);

interface UnitFixture {
  name: string;
  fullName?: string;
}

function renderUnit(
  id: string,
  units: UnitFixture[],
  opts: { modelPending?: boolean } = {},
) {
  mockUnits = units as UnitDatasetEntry[];
  mockModelPending = opts.modelPending ?? false;
  return render(
    <MemoryRouter
      initialEntries={[
        `/content/games/${encodeURIComponent(GAME_NAME)}/units/${id}`,
      ]}
    >
      <Routes>
        <Route
          path="/content/games/:name/units/:unit"
          element={<GameUnitPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GameUnitPage", () => {
  it("names the unit and shows its def key", async () => {
    renderUnit("armsolar", [{ name: "armsolar", fullName: "Solar Collector" }]);
    expect(
      await screen.findByRole("heading", { name: "Solar Collector" }),
    ).toBeTruthy();
    expect(screen.getByText("armsolar")).toBeTruthy();
  });

  it("is readable while the model is still loading", async () => {
    // The model hook never resolves here. Leading with the model is a layout
    // decision, so everything the dataset already holds must be on screen anyway.
    // Task 4 adds the stats and relationships below this, and they inherit the
    // same guarantee.
    renderUnit(
      "armsolar",
      [{ name: "armsolar", fullName: "Solar Collector" }],
      { modelPending: true },
    );
    expect(
      await screen.findByRole("heading", { name: "Solar Collector" }),
    ).toBeTruthy();
    expect(screen.getByText("armsolar")).toBeTruthy();
  });

  it("says plainly when the game has no such unit", async () => {
    renderUnit("nosuchunit", [{ name: "armsolar" }]);
    expect(await screen.findByText(/not in this game/i)).toBeTruthy();
  });
});
