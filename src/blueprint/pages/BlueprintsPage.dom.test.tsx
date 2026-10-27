// @vitest-environment happy-dom
/**
 * The Terrain changes switch on the library page (issue #4792): it follows
 * what the game's units say until it is moved, and moving it changes what the
 * cards say without touching the blueprints.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredBlueprint } from "../library";
import { resetTerrainOverrides } from "../terrainSwitch";

const step = {
  kind: "raise" as const,
  shape: "wall" as const,
  points: [
    { x: 0, z: 0 },
    { x: 64, z: 0 },
  ],
  height: 24,
  before: 0,
};

const record = (
  id: string,
  game: string,
  buildings: number,
): StoredBlueprint => ({
  id,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  layout: {
    game: { name: game },
    name: `${game} layout`,
    buildings: Array.from({ length: buildings }, (_, i) => ({
      def: "armsolar",
      offset: { x: i * 32, z: 0 },
      facing: 0 as const,
    })),
    terrain: [step, step],
    footprints: { armsolar: { x: 4, z: 4 } },
  },
});

const library = vi.hoisted(() => ({ records: [] as StoredBlueprint[] }));
const gameUnits = vi.hoisted(() => ({
  byGame: {} as Record<string, { name: string }[]>,
}));

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({ data: { games: [] }, loading: false, error: null }),
  useUnitsyncGameHeaders: () => ({ headers: new Map(), loading: false }),
}));
vi.mock("@/play/config", () => ({ usePreferredTarget: () => ({}) }));
vi.mock("@/content/useGameUnits", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@/content/useGameUnits")),
  useGameUnits: (name: string) => ({
    units: gameUnits.byGame[name] ?? [],
    archive: name,
    loading: false,
    gameMissing: false,
  }),
}));
vi.mock("../useBuildingRoles", () => ({ useBuildingRoles: () => undefined }));
vi.mock("../useWidgetFiles", () => ({ useWidgetFiles: () => {} }));
vi.mock("@/deeplink/useImportParam", () => ({ useImportParam: () => ({}) }));
vi.mock("@/hub/imports", () => ({ useRecordHubImport: () => () => {} }));
vi.mock("../store", () => ({
  blueprintRoute: (id: string) => `/library/blueprints/${id}`,
  saveBlueprint: async (r: StoredBlueprint) => r,
  useBlueprintLibrary: () => ({
    records: library.records,
    loading: false,
    error: null,
  }),
}));

const { default: BlueprintsPage } = await import("./BlueprintsPage");

function stubStorage() {
  const held = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => held.set(key, value),
      removeItem: (key: string) => held.delete(key),
    },
  });
}

const page = () =>
  render(
    <MemoryRouter>
      <BlueprintsPage />
    </MemoryRouter>,
  );

const switchEl = () => screen.getByRole("switch", { name: "Terrain changes" });

beforeEach(() => {
  stubStorage();
  resetTerrainOverrides();
  gameUnits.byGame = {
    "Zero-K": [{ name: "terraunit" }, { name: "armsolar" }],
    "Splinter Faction": [{ name: "armsolar" }],
  };
});
afterEach(cleanup);

describe("the Terrain changes switch on the Blueprints page", () => {
  it("is on for a game with terraunit, with no setting changed", () => {
    library.records = [record("a", "Zero-K", 2)];
    page();
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/cannot make/)).toBeNull();
  });

  it("is off for a game without it, and the card says what it cannot make", () => {
    library.records = [record("a", "Splinter Faction", 2)];
    page();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByText("2 terrain changes this game cannot make"),
    ).toBeTruthy();
  });

  it("says a terrain only blueprint has nothing to place", () => {
    library.records = [record("a", "Splinter Faction", 0)];
    page();
    expect(
      screen.getByText(
        "2 terrain changes this game cannot make, so nothing in it can be placed",
      ),
    ).toBeTruthy();
  });

  it("can be turned on for a game detection says no to, and back", () => {
    library.records = [record("a", "Splinter Faction", 2)];
    page();
    fireEvent.click(switchEl());
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/cannot make/)).toBeNull();
    fireEvent.click(switchEl());
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByText("2 terrain changes this game cannot make"),
    ).toBeTruthy();
  });

  it("can be turned off for Zero-K, which then counts the changes it cannot make", () => {
    library.records = [record("a", "Zero-K", 2)];
    page();
    fireEvent.click(switchEl());
    expect(
      screen.getByText(/2 terrain changes this game cannot make/),
    ).toBeTruthy();
  });

  it("is not shown while every game is listed and there is more than one", () => {
    library.records = [
      record("a", "Zero-K", 2),
      record("b", "Splinter Faction", 2),
    ];
    page();
    expect(
      screen.queryByRole("switch", { name: "Terrain changes" }),
    ).toBeNull();
  });
});
