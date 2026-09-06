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
// Defaults to "ready". One test overrides it to "unsyncable" to prove the
// page still draws a populated dataset in that status instead of sticking on
// a loading skeleton forever. `UnitsyncInfoStatus` (config.ts) has five
// values, not the three the page used to gate rendering on.
let mockDatasetStatus: "ready" | "unsyncable" | "error" | "loading" = "ready";

// The real `useUnitsyncGameInfo`/`useUnitsyncUnitDataset` (config.ts) only
// call `setInfo`/`setDataset` once a fetch resolves, then leave that state
// alone: typing in the search box re-renders the page without either hook
// running again, so `info`/`dataset` keep the same object reference across
// those renders. These two are set once per `renderPage` call (not
// reconstructed inside the mock hooks below) so they carry the same
// stability, which is what lets a test tell a real memoisation fix apart
// from one that merely looks memoised against an unstable double.
let mockGameInfo: {
  sides: { name: string; startUnit?: string }[];
  unitCount: number;
  units: never[];
  options: never[];
  errors: never[];
} = { sides: [], unitCount: 0, units: [], options: [], errors: [] };
let mockDataset: { units: UnitDatasetEntry[]; errors: string[] } = {
  units: [],
  errors: [],
};

/** Every id list `useUnitsyncUnitBuildpics` was called with, in render order,
 * so a test can check whether typing in the search box changed it. */
let buildpicsCalls: (string[] | undefined)[] = [];

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
  useUnitsyncGameInfo: () => ({ info: mockGameInfo, loading: false }),
  useUnitsyncUnitDataset: () => ({
    dataset: mockDataset,
    status: mockDatasetStatus,
  }),
  useUnitsyncUnitBuildpics: (
    _enginePath?: string,
    _dataDir?: string,
    _gameArchive?: string,
    units?: string[],
  ) => {
    buildpicsCalls.push(units);
    return null;
  },
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
  search = "",
}: {
  units: UnitFixture[];
  sides: { name: string; startUnit?: string }[];
  datasetStatus?: "ready" | "unsyncable" | "error" | "loading";
  /** e.g. "?faction=corcom", to prove the faction filter narrows the grid. */
  search?: string;
}) {
  mockUnits = units as UnitDatasetEntry[];
  mockDatasetStatus = datasetStatus;
  mockGameInfo = {
    sides,
    unitCount: mockUnits.length,
    units: [],
    options: [],
    errors: [],
  };
  mockDataset = { units: mockUnits, errors: [] };
  buildpicsCalls = [];
  return render(
    <MemoryRouter
      initialEntries={[
        `/library/games/${encodeURIComponent(GAME_NAME)}/units${search}`,
      ]}
    >
      <Routes>
        <Route path="/library/games/:name/units" element={<GameUnitsPage />} />
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

  it("shows every faction's block with no faction param", async () => {
    renderPage({
      units: [
        { name: "armcom", buildOptions: ["armsolar"] },
        { name: "armsolar" },
        { name: "corcom", buildOptions: ["corsolar"] },
        { name: "corsolar" },
      ],
      sides: [
        { name: "Armada", startUnit: "armcom" },
        { name: "Cortex", startUnit: "corcom" },
      ],
    });
    expect(await screen.findByText("Armada")).toBeTruthy();
    expect(screen.getByText("Cortex")).toBeTruthy();
  });

  it("narrows the grid to one faction's block via ?faction=<rootId>", async () => {
    // `rootId` is the value `FactionBuildList`'s "Browse units" button links
    // with: a side's start unit id, which is also the id `encyclopediaSections`
    // keys that faction's `section.id` on.
    renderPage({
      units: [
        { name: "armcom", buildOptions: ["armsolar"] },
        { name: "armsolar" },
        { name: "corcom", buildOptions: ["corsolar"] },
        { name: "corsolar" },
      ],
      sides: [
        { name: "Armada", startUnit: "armcom" },
        { name: "Cortex", startUnit: "corcom" },
      ],
      search: "?faction=corcom",
    });
    expect(await screen.findByText("Cortex")).toBeTruthy();
    expect(screen.queryByText("Armada")).toBeNull();
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
      `/library/games/${encodeURIComponent(GAME_NAME)}/units/armcom`,
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

  it("wraps a long unit name onto a second line instead of truncating it", async () => {
    // Real example from SplinterFaction: long enough that the old `truncate`
    // class cut it to an ellipsis, making cells indistinguishable.
    const longName = "Federation of Kala Command Unit";
    renderPage({
      units: [{ name: "fedcom", fullName: longName }],
      sides: [{ name: "Federation", startUnit: "fedcom" }],
    });
    const label = await screen.findByText(longName);
    expect(label.className).toContain("line-clamp-2");
    expect(label.className).not.toContain("truncate");
  });

  it("keeps the same buildpic id list when the search query changes", async () => {
    // The id list handed to `useUnitsyncUnitBuildpics` used to be the
    // search-filtered `rows`, so it changed on every keystroke, which
    // refetches and remounts the game's archive on every keystroke
    // (config.ts:837 keys the fetch on a join of that list). It has to come
    // from the unfiltered grid instead, so it stays the same array across a
    // query change.
    renderPage({
      units: [
        { name: "armcom", fullName: "Commander", buildOptions: ["armsolar"] },
        { name: "armsolar", fullName: "Solar Collector" },
      ],
      sides: [{ name: "Armada", startUnit: "armcom" }],
    });
    await screen.findByText("Commander");
    const idsBeforeIndex = buildpicsCalls.length - 1;
    expect(idsBeforeIndex).toBeGreaterThanOrEqual(0);
    const idsBefore = buildpicsCalls[idsBeforeIndex];

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "solar" },
    });
    await screen.findByText("Solar Collector");
    expect(screen.queryByText("Commander")).toBeNull();

    const idsAfter = buildpicsCalls[buildpicsCalls.length - 1];
    expect(idsAfter).toBe(idsBefore);
    expect(idsAfter).toEqual(["armcom", "armsolar"]);
  });
});
