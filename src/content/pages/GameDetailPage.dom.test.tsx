// @vitest-environment happy-dom
/**
 * The Sides section on a game's detail page, covering the state Zero-K hit:
 * a unit dataset that reads fine (614 units, no errors) whose one side reports
 * a start unit (`update_your_damn_engine`) the dataset never defines, so every
 * per-faction Build tree/Browse units button is correctly disabled while All
 * units, which never depended on a side resolving, still worked. Before this
 * fix All units stayed a live link even when the dataset read failed outright,
 * and nothing explained why the per-faction buttons were dead when the read
 * had actually succeeded.
 *
 * Everything not under test (GameHeader, StartModeActions,
 * MissionRuntimeSection, GameEquivalents) is stubbed out, following
 * `GameUnitsPage.dom.test.tsx`'s mocking shape for the unitsync hooks.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigOption, UnitDatasetEntry } from "../bindings";

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: () => ["", () => {}],
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));

// The drawer never opens in this test (no button is clicked), so its own
// React Flow dependency tree never has to load (matches
// `FactionBuildList.test.ts`).
vi.mock("./components/BuildTreeDrawer", () => ({
  BuildTreeDrawer: () => null,
}));

// Stubbed: none of these bear on the Sides section, and several reach for
// hooks (scenarios, equivalents tables) that need a real Tauri context.
vi.mock("./components/GameHeader", () => ({ GameHeader: () => null }));
vi.mock("./components/StartModeActions", () => ({
  StartModeActions: () => null,
}));
vi.mock("./components/MissionRuntimeSection", () => ({
  MissionRuntimeSection: () => null,
}));
vi.mock("@/blueprint/pages/components/GameEquivalents", () => ({
  GameEquivalents: () => null,
}));

vi.mock("../branding", () => ({ useBrandingEntry: () => null }));
vi.mock("@/factions/logos", () => ({ useFactionLogos: () => ({}) }));
vi.mock("@/profile/hidden", () => ({ isProfileHidden: () => true }));
vi.mock("../usePlayGame", () => ({ usePlayGame: () => () => {} }));
vi.mock("../replayUserState", () => ({
  useReplayUserState: () => ({ state: null }),
  refightFilenames: () => [],
}));

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

const GAME_NAME = "Test Game";

let mockGameInfo: {
  sides: { name: string; startUnit?: string }[];
  unitCount: number;
  units: never[];
  options: ConfigOption[];
  errors: never[];
  checksum?: string;
} = { sides: [], unitCount: 0, units: [], options: [], errors: [] };
let mockDataset: { units: UnitDatasetEntry[]; errors: string[] } = {
  units: [],
  errors: [],
};
let mockDatasetStatus: "ready" | "unsyncable" | "error" | "loading" = "ready";

vi.mock("../config", () => ({
  classifyArchive: () => ({ kind: "other", primary: false }),
  useContentState: () => ({ state: { roots: [] } }),
  useReplayStats: () => ({ records: [], ingesting: false }),
  useScanTargetSelection: () => ({ selected: SELECTED }),
  useUnitsyncGameInfo: () => ({ info: mockGameInfo, loading: false }),
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
  useUnitsyncUnitBuildpics: () => null,
  useUnitsyncUnitDataset: () => ({
    dataset: mockDataset,
    status: mockDatasetStatus,
  }),
}));

const { default: GameDetailPage } = await import("./GameDetailPage");

afterEach(cleanup);

function unit(name: string, buildOptions: string[] = []): UnitDatasetEntry {
  return { name, buildOptions } as UnitDatasetEntry;
}

function renderPage({
  sides,
  units,
  datasetStatus,
  errors = [],
  options = [],
}: {
  sides: { name: string; startUnit?: string }[];
  units: UnitDatasetEntry[];
  datasetStatus: "ready" | "unsyncable" | "error" | "loading";
  errors?: string[];
  options?: ConfigOption[];
}) {
  mockGameInfo = {
    sides,
    unitCount: units.length,
    units: [],
    options,
    errors: [],
    checksum: "abc123",
  };
  mockDataset = { units, errors };
  mockDatasetStatus = datasetStatus;
  return render(
    <MemoryRouter
      initialEntries={[`/library/games/${encodeURIComponent(GAME_NAME)}`]}
    >
      <Routes>
        <Route path="/library/games/:name" element={<GameDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GameDetailPage's Sides section", () => {
  it("disables All units and lists the read errors when the dataset failed outright", async () => {
    renderPage({
      sides: [{ name: "Robots", startUnit: "armcom" }],
      units: [],
      datasetStatus: "error",
      errors: ["could not parse unitdef armcom.lua"],
    });
    const allUnits = await screen.findByText("All units");
    // Disabled means a <button>, not a live <a href>.
    expect(allUnits.closest("a")).toBeNull();
    expect(allUnits.closest("button")?.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Could not read this game's units")).toBeTruthy();
    expect(screen.getByText("could not parse unitdef armcom.lua")).toBeTruthy();
    expect(screen.queryByText(/sides resolve to a start unit/)).toBeNull();
  });

  it("keeps All units live and explains the dead sides when the read succeeded but no side resolves (Zero-K)", async () => {
    // Mirrors Zero-K v1.14.8.0's real worker output: 614 real units, zero
    // errors, one side whose reported start unit isn't among them.
    renderPage({
      sides: [{ name: "Robots", startUnit: "update_your_damn_engine" }],
      units: [unit("armcom", ["armsolar"]), unit("armsolar")],
      datasetStatus: "ready",
    });
    const allUnits = await screen.findByText("All units");
    expect(allUnits.closest("a")).not.toBeNull();
    expect(allUnits.closest("button")).toBeNull();
    expect(
      screen.getByText(/sides resolve to a start unit in its roster/),
    ).toBeTruthy();
    // The per-faction buttons stay disabled: this side's start unit still
    // resolves to nothing, same as before the fix.
    expect(screen.getByText("Build tree").closest("button")).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows neither error nor dead-sides message for a game whose sides resolve fine", async () => {
    renderPage({
      sides: [{ name: "Arm", startUnit: "armcom" }],
      units: [unit("armcom", ["armsolar"]), unit("armsolar")],
      datasetStatus: "ready",
    });
    const allUnits = await screen.findByText("All units");
    expect(allUnits.closest("a")).not.toBeNull();
    expect(screen.queryByText("Could not read this game's units")).toBeNull();
    expect(screen.queryByText(/sides resolve to a start unit/)).toBeNull();
    expect(screen.getByText("Build tree").closest("button")).toHaveProperty(
      "disabled",
      false,
    );
  });
});

describe("GameDetailPage's Game options section", () => {
  it("starts closed and shows an option's description only once opened", async () => {
    renderPage({
      sides: [],
      units: [],
      datasetStatus: "ready",
      options: [
        {
          key: "fixedallies",
          name: "Fixed Allies",
          description: "Allies are set before the game starts.",
        },
      ],
    });
    const trigger = await screen.findByRole("button", {
      name: /Game options \(1\)/,
    });
    expect(
      screen.queryByText("Allies are set before the game starts."),
    ).toBeNull();

    fireEvent.click(trigger);

    expect(
      await screen.findByText("Allies are set before the game starts."),
    ).toBeTruthy();
  });
});
