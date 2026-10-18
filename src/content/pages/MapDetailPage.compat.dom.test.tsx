// @vitest-environment happy-dom
/**
 * The map's page lists what would stop the map loading on the current engine
 * (#4565). What each finding means is `mapCompatReport.test.ts`. This file
 * checks the page reads the archive and its mapinfo.lua and shows the rows.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const HIDE: string[] = [];
const STARTS: { x: number; z: number }[] = [];
const MAP = "Some Map 1.0";
const archive = {
  name: MAP,
  path: `/data/${MAP}`,
  kind: "other",
  primary: false,
};
const TREE_FILES = {
  clean: ["mapinfo.lua", "maps/some.smf"],
  old: ["mapinfo.lua", "maps/some.smf", "objects3d/tree.3do"],
};
// The page caches each map's mapinfo.lua for the session, so every test reads
// under its own data folder.
let ROOT = "/data";
let TREE: { files: { path: string; size: number }[]; errors: string[] } | null =
  null;
const luaExec = vi.fn();

vi.mock("../bindings", async (orig) => ({
  ...(await orig<typeof import("../bindings")>()),
  unitsyncLuaExec: (args: unknown) => luaExec(args),
}));
vi.mock("../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
vi.mock("../config", () => ({
  classifyArchive: () => ({ kind: "other", primary: false }),
  useContentState: () => ({ state: { roots: [{ path: "/data" }] } }),
  useReplayStats: () => ({ records: [], ingesting: false }),
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: ROOT },
  }),
  useUnitsyncScan: () => ({
    data: {
      games: [],
      maps: [MAP, "Other Map", "Some Map 1.1"].map((name) => ({
        name,
        archives: [archive],
        info: {},
        width: 8,
        height: 4,
      })),
      errors: [],
    },
    loading: false,
    error: null,
    run: () => {},
  }),
  useUnitsyncArchiveTree: () => ({ tree: TREE, loading: false }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
  useUnitsyncMapMeta: () => ({ meta: new Map() }),
  useUnitsyncMinimap: () => ({ startPositions: STARTS }),
  useUnitsyncHeightmap: () => ({}),
  useUnitsyncMapInfo: () => ({}),
  useUnitsyncMapSkybox: () => ({}),
}));
vi.mock("../../mapconv/pages/components/MapPreview3D", () => ({
  MapPreview3D: () => null,
}));
vi.mock("../../play/pages/components/MapOverlay", () => ({
  useMapOverlayLayer: () => ({}),
  MapLayerToggle: () => null,
  MapOverlayImage: () => null,
}));
vi.mock("../mapEligibility", () => ({
  useMapEligibility: () => ({
    verdictFor: () => null,
    setPlayerExcluded: () => {},
  }),
}));
vi.mock("../usePlayMap", () => ({ usePlayMap: () => () => {} }));
vi.mock("@/general/advanced", () => ({ useAdvancedMode: () => false }));
vi.mock("../replayUserState", () => ({
  useReplayUserState: () => ({ state: null }),
  refightFilenames: () => new Set(),
}));
vi.mock("./components/MapAggregate", () => ({ MapAggregate: () => null }));

const { default: MapDetailPage } = await import("./MapDetailPage");

afterEach(() => {
  cleanup();
  TREE = null;
  ROOT = "/data";
  luaExec.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/library/maps/${encodeURIComponent(MAP)}`]}>
      <Routes>
        <Route path="/library/maps/:name" element={<MapDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const tree = (files: string[]) => ({
  files: files.map((path) => ({ path, size: 1 })),
  errors: [],
});

describe("the compatibility report on a map's page", () => {
  it("shows the archive's and mapinfo.lua's findings", async () => {
    TREE = tree(TREE_FILES.old);
    luaExec.mockResolvedValue({
      result: '"atmosphere;atmosphere.skydir;smf.minimaptex=mini.pcx"',
      errors: [],
    });
    renderPage();
    expect(screen.getByText("Compatibility")).toBeTruthy();
    expect(screen.getByText(".3do feature models")).toBeTruthy();
    expect(
      await screen.findByText(".pcx textures in mapinfo.lua"),
    ).toBeTruthy();
    expect(
      screen.getByText("mapinfo.lua keys the engine warns on"),
    ).toBeTruthy();
    expect(luaExec).toHaveBeenCalledWith(
      expect.objectContaining({ archive: MAP, dataDir: "/data" }),
    );
  });

  it("is absent for a map with nothing to report", async () => {
    ROOT = "/data-clean";
    TREE = tree(TREE_FILES.clean);
    luaExec.mockResolvedValue({ result: '"name=Some Map"', errors: [] });
    renderPage();
    await vi.waitFor(() => expect(luaExec).toHaveBeenCalled());
    expect(screen.queryByText("Compatibility")).toBeNull();
  });

  it("does not run mapinfo.lua for a map that has none", () => {
    ROOT = "/data-smd";
    TREE = tree(["maps/some.smf", "maps/some.smd"]);
    renderPage();
    expect(
      screen.getByText("No mapinfo.lua, settings from the .smd file"),
    ).toBeTruthy();
    expect(luaExec).not.toHaveBeenCalled();
  });
});
