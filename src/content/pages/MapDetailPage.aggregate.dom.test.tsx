// @vitest-environment happy-dom
/**
 * The map's page shows the picture of every match on it (#1161), unless the
 * distribution profile hides the map insight or the stats it is built from.
 * What the picture holds is `MapAggregate.dom.test.tsx`. This file is the gate.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

let HIDE: string[] = [];
let mounts = 0;
let STARTS: { x: number; z: number }[] = [];
const MAP = "Some Map 1.0";
const archive = {
  name: MAP,
  path: `/data/${MAP}`,
  kind: "other",
  primary: false,
};

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
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  useUnitsyncScan: () => ({
    data: {
      games: [],
      maps: [MAP, "Other Map"].map((name) => ({
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
  useUnitsyncArchiveTree: () => ({ tree: null, loading: false }),
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
vi.mock("./components/MapAggregate", () => ({
  MapAggregate: (props: {
    mapName: string;
    world: { worldWidth: number; worldHeight: number };
    declared?: { x: number; z: number }[];
  }) => {
    useEffect(() => {
      mounts++;
    }, []);
    return (
      <div data-testid="map-aggregate">
        {props.mapName} {props.world.worldWidth}x{props.world.worldHeight}
        <span data-testid="declared">{JSON.stringify(props.declared)}</span>
      </div>
    );
  },
}));

const { default: MapDetailPage } = await import("./MapDetailPage");

afterEach(() => {
  cleanup();
  HIDE = [];
  STARTS = [];
  mounts = 0;
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/library/maps/${encodeURIComponent(MAP)}`]}>
      <Link to="/library/maps/Other%20Map">Another map</Link>
      <Routes>
        <Route path="/library/maps/:name" element={<MapDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the picture of every match on a map's page", () => {
  it("is shown, for the map by its exact name and at the map's size", () => {
    renderPage();
    // No heightmap here, so the size is the map's own: 16 elmos a square.
    expect(screen.getByTestId("map-aggregate").textContent).toMatch(
      /^Some Map 1.0 128x64/,
    );
  });

  it("hands the section the positions the map declares, which the records are numbered by", () => {
    STARTS = [
      { x: 10, z: 20 },
      { x: 30, z: 40 },
    ];
    renderPage();
    expect(
      JSON.parse(screen.getByTestId("declared").textContent ?? ""),
    ).toEqual(STARTS);
  });

  it("starts again for another map, so one map's filters are not the next one's", () => {
    renderPage();
    expect(mounts).toBe(1);
    fireEvent.click(screen.getByText("Another map"));
    expect(screen.getByTestId("map-aggregate").textContent).toMatch(
      /^Other Map/,
    );
    expect(mounts).toBe(2);
  });

  it("is hidden by the map insight key", () => {
    HIDE = ["analytics.mapInsight"];
    renderPage();
    expect(screen.queryByTestId("map-aggregate")).toBeNull();
    // The rest of the page is still there.
    expect(screen.getByText("Play this map")).toBeTruthy();
  });

  it("is hidden with the stats it is built from", () => {
    HIDE = ["multiplayer.stats"];
    renderPage();
    expect(screen.queryByTestId("map-aggregate")).toBeNull();
  });

  it("is not hidden by the other analytics keys", () => {
    HIDE = ["analytics.spatialLayers", "analytics.matchStats", "analytics.run"];
    renderPage();
    expect(screen.getByTestId("map-aggregate")).toBeTruthy();
  });
});
