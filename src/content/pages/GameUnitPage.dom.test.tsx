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
const mockIconSrc = "mock-icon-src";

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
  // Keys the result by exactly the id(s) it was handed, the way the real
  // worker keys its map with exactly the string it was passed (it does not
  // lowercase anything itself). This is what makes a fetch/read key mismatch
  // in the page visible: fetching under the dataset's original-case name but
  // reading under the lowercased route param would look up a key this mock
  // never populated.
  useUnitsyncUnitBuildpics: (
    _enginePath?: string,
    _dataDir?: string,
    _gameArchive?: string,
    units?: string[],
  ) =>
    units && units.length > 0
      ? {
          units: Object.fromEntries(
            units.map((u) => [u, { icon: mockIconSrc }]),
          ),
        }
      : null,
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

  it("labels the model panel's button by what it does here (navigate back), not by the drawer's close wording", async () => {
    renderUnit("armsolar", [{ name: "armsolar", fullName: "Solar Collector" }]);
    await screen.findByRole("heading", { name: "Solar Collector" });
    expect(
      screen.getByRole("button", { name: "Back to the units grid" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Close model view")).toBeNull();
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

  it("fetches and reads the buildpic under the same key, even when the dataset's def key isn't lowercase", async () => {
    // The dataset entry's own name is mixed-case, as a game may write it. The
    // route param ("armsolar") is always lowercase. A page that fetched with
    // `unit.name` but read with the lowercased id would ask the mock for
    // "ArmSolar" and look up "armsolar", missing every time.
    const { container } = renderUnit("armsolar", [
      { name: "ArmSolar", fullName: "Solar Collector" },
    ]);
    await screen.findByRole("heading", { name: "Solar Collector" });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(mockIconSrc);
  });
});
