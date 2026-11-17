// @vitest-environment happy-dom
/**
 * The playability figures read and decode the whole height and metal maps and
 * then measure them, so the map's page does none of it until its Playability
 * tab is opened. What the panel shows is `PlayabilityPanel`'s own business.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const MAP = "Some Map 1.0";
const heightField = vi.fn((..._args: unknown[]) => ({}));
const metalField = vi.fn((..._args: unknown[]) => ({}));

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
      maps: [
        {
          name: MAP,
          archives: [{ name: MAP, kind: "other", primary: false }],
          info: {},
          width: 8,
          height: 4,
        },
      ],
      errors: [],
    },
    loading: false,
    error: null,
    run: () => {},
  }),
  useUnitsyncArchiveTree: () => ({ tree: null, loading: false }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
  useUnitsyncMapMeta: () => ({ meta: new Map() }),
  useUnitsyncMinimap: () => ({ startPositions: [] }),
  useUnitsyncHeightmap: () => ({}),
  useUnitsyncHeightField: (...args: unknown[]) => heightField(...args),
  useUnitsyncMetalField: (...args: unknown[]) => metalField(...args),
  useUnitsyncMapInfo: () => ({}),
  useUnitsyncMapSkybox: () => ({}),
}));
vi.mock("../../mapconv/pages/components/PlayabilityPanel", () => ({
  PlayabilityPanel: () => <div data-testid="playability" />,
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
vi.mock("@/general/features", () => ({ useFeature: () => false }));
vi.mock("../replayUserState", () => ({
  useReplayUserState: () => ({ state: null }),
  refightFilenames: () => new Set(),
}));
vi.mock("./components/MapAggregate", () => ({ MapAggregate: () => null }));

const { default: MapDetailPage } = await import("./MapDetailPage");

afterEach(() => {
  cleanup();
  heightField.mockClear();
  metalField.mockClear();
});

describe("the playability tab on a map's page", () => {
  it("reads nothing until it is opened, then reads this map", () => {
    render(
      <MemoryRouter
        initialEntries={[`/library/maps/${encodeURIComponent(MAP)}`]}
      >
        <Routes>
          <Route path="/library/maps/:name" element={<MapDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("playability")).toBeNull();
    expect(heightField).not.toHaveBeenCalled();
    expect(metalField).not.toHaveBeenCalled();

    // Radix picks a tab on mouse down rather than on click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Passability" }));
    expect(screen.getByTestId("playability")).toBeTruthy();
    expect(heightField).toHaveBeenCalledWith("/engine", "/data", MAP);
    expect(metalField).toHaveBeenCalledWith("/engine", "/data", MAP);
  });
});
