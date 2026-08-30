// @vitest-environment happy-dom
/**
 * Drives `GameUnitsPage` under a real DOM, following the mocking shape
 * `UnitPicker.dom.test.tsx` uses: the unitsync hooks are mocked so the test
 * exercises the rendered grid rather than a real scan.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
let mockSides: { name: string; startUnit?: string }[] = [];
// Defaults to "ready". One test overrides it to "unsyncable" to prove the
// page still draws a populated dataset in that status instead of sticking on
// a loading skeleton forever. `UnitsyncInfoStatus` (config.ts) has five
// values, not the three the page used to gate rendering on.
let mockDatasetStatus: "ready" | "unsyncable" | "error" | "loading" = "ready";

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
      sides: mockSides,
      unitCount: mockUnits.length,
      units: [],
      options: [],
      errors: [],
    },
    loading: false,
  }),
  useUnitsyncUnitDataset: () => ({
    dataset: { units: mockUnits, errors: [] },
    status: mockDatasetStatus,
  }),
  useUnitsyncUnitBuildpics: () => null,
}));

const { default: GameUnitsPage } = await import("./GameUnitsPage");

afterEach(cleanup);

interface UnitFixture {
  name: string;
  fullName?: string;
  buildOptions?: string[];
  morphTargets?: { into: string }[];
}

function renderPage({
  units,
  sides,
  datasetStatus = "ready",
}: {
  units: UnitFixture[];
  sides: { name: string; startUnit?: string }[];
  datasetStatus?: "ready" | "unsyncable" | "error" | "loading";
}) {
  mockUnits = units as UnitDatasetEntry[];
  mockSides = sides;
  mockDatasetStatus = datasetStatus;
  return render(
    <MemoryRouter
      initialEntries={[`/content/games/${encodeURIComponent(GAME_NAME)}/units`]}
    >
      <Routes>
        <Route path="/content/games/:name/units" element={<GameUnitsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GameUnitsPage", () => {
  it("shows one cell for a commander and its upgrades", async () => {
    renderPage({
      units: [
        {
          name: "armcom",
          fullName: "Commander",
          morphTargets: [{ into: "armcom1" }],
        },
        { name: "armcom1", fullName: "Commander" },
      ],
      sides: [{ name: "Armada", startUnit: "armcom" }],
    });
    expect(await screen.findByText("Commander")).toBeTruthy();
    expect(screen.queryByText("armcom1")).toBeNull();
    expect(screen.getByText(/1 upgrade/)).toBeTruthy();
  });

  it("finds a folded stage by its def key", async () => {
    renderPage({
      units: [
        {
          name: "armcom",
          fullName: "Commander",
          morphTargets: [{ into: "armcom1" }],
        },
        { name: "armcom1", fullName: "Commander" },
        { name: "armsolar", fullName: "Solar Collector" },
      ],
      sides: [{ name: "Armada", startUnit: "armcom" }],
    });
    await screen.findByText("Commander");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "armcom1" },
    });
    expect(screen.getByText("Commander")).toBeTruthy();
    expect(screen.queryByText("Solar Collector")).toBeNull();
  });

  it("heads each block with its faction", async () => {
    renderPage({
      units: [
        { name: "armcom", buildOptions: ["armsolar"] },
        { name: "armsolar" },
        { name: "armghost" },
      ],
      sides: [{ name: "Armada", startUnit: "armcom" }],
    });
    expect(await screen.findByText("Armada")).toBeTruthy();
    expect(screen.getByText("Other units")).toBeTruthy();
  });

  it("links a cell to the unit's own page as an absolute path", async () => {
    // Picoframe registers a plugin's whole route path as one flat match, so a
    // relative `../units/{id}` pops the entire `content/games/:name/units`
    // match and lands on `/units/{id}`. The link has to be built absolute.
    renderPage({
      units: [{ name: "armcom", fullName: "Commander" }],
      sides: [{ name: "Armada", startUnit: "armcom" }],
    });
    const cell = await screen.findByText("Commander");
    const link = cell.closest("a");
    expect(link?.getAttribute("href")).toBe(
      `/content/games/${encodeURIComponent(GAME_NAME)}/units/armcom`,
    );
  });

  it("draws the grid from an unsyncable dataset instead of loading forever", async () => {
    renderPage({
      units: [{ name: "armcom", fullName: "Commander" }],
      sides: [{ name: "Armada", startUnit: "armcom" }],
      datasetStatus: "unsyncable",
    });
    expect(await screen.findByText("Commander")).toBeTruthy();
  });

  it("stays on the loading state while the dataset is still parsing, even once game info is ready", async () => {
    // `gameInfo` resolves long before the dataset (which parses every unit
    // def in the game), so gating on `gameInfoLoading` alone would render
    // this page's "No units found for this game" text while the dataset is
    // still in flight: a confident false claim rather than a spinner.
    renderPage({
      units: [{ name: "armcom", fullName: "Commander" }],
      sides: [{ name: "Armada", startUnit: "armcom" }],
      datasetStatus: "loading",
    });
    expect(await screen.findByText("Back")).toBeTruthy();
    expect(screen.queryByText("No units found for this game.")).toBeNull();
    expect(screen.queryByText("Commander")).toBeNull();
  });
});
