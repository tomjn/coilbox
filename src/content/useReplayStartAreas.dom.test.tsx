// @vitest-environment happy-dom
/**
 * What a replay's map draws for its start areas (#5314): the shaped areas a
 * Beyond All Reason replay carries in its options, or its rectangles.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoInfo } from "./bindings";
import { useReplayStartAreas } from "./useReplayStartAreas";

const zerok = vi.hoisted(() => ({
  config: null as unknown,
  loading: false,
}));

vi.mock("./config", () => ({
  useScanTargetSelection: () => ({ selected: undefined }),
  useUnitsyncScan: () => ({ data: undefined }),
}));
vi.mock("@/startbox/useZerokStartBoxes", () => ({
  useZerokStartBoxes: () => zerok,
}));

const EXTENT = { x: 8192, z: 4096 };

// The host's own areas from a replay recorded headless in Beyond All Reason: a
// five sided shape and a triangle.
const OVERRIDE =
  "eJyrViouSSwqScqvSC1WsoquVirIz6kEMyqUrAwNdJSAHGODWh0w3xzCN4LxLSF8CxjfFMI3hCuAGmBoYFAbCxJCMRyq2wSu2BihGioCVWJoDtIfq6OUm1gRkJNYmVpUHJBaFAx1OFC-FgAbNTk6";

function replay(modOptions: Record<string, string>): DemoInfo {
  return {
    engineVersion: "105",
    startTimeMs: 0,
    durationSec: 600,
    wallclockSec: 600,
    mapName: "Map",
    gameType: "Beyond All Reason test-30922-8064a43",
    winningAllyTeams: [],
    winnersKnown: false,
    numAllyTeams: 2,
    allyTeams: [
      {
        id: 0,
        color: [1, 0, 0],
        startBox: { left: 0, top: 0, right: 0.25, bottom: 1 },
      },
      {
        id: 1,
        color: [0, 0, 1],
        startBox: { left: 0.75, top: 0, right: 1, bottom: 1 },
      },
    ],
    players: [],
    ais: [],
    modOptions,
    mapOptions: {},
  } as DemoInfo;
}

const draw = (info: DemoInfo, extent: typeof EXTENT | null = EXTENT) =>
  renderHook(() => useReplayStartAreas({ info, extent })).result.current;

describe("useReplayStartAreas for Beyond All Reason", () => {
  beforeEach(() => {
    zerok.config = null;
    zerok.loading = false;
  });

  it("draws the shaped areas and not the rectangles when the options carry them", () => {
    const { areas, extent } = draw(
      replay({ mapmetadata_startbox_override: OVERRIDE }),
    );
    expect(extent).toEqual(EXTENT);
    expect(areas.map((a) => [a.label, a.color])).toEqual([
      ["1", "#ff0000"],
      ["2", "#0000ff"],
    ]);
    // A rectangle has four corners. The first shape has five before any curve.
    expect(areas[0].polygons[0].length).toBeGreaterThan(4);
  });

  it("draws the rectangles when both options are missing", () => {
    const { areas, extent } = draw(replay({}));
    expect(extent).toEqual({ x: 1, z: 1 });
    expect(areas.map((a) => a.polygons[0])).toEqual([
      [
        [0, 0],
        [0.25, 0],
        [0.25, 1],
        [0, 1],
      ],
      [
        [0.75, 0],
        [1, 0],
        [1, 1],
        [0.75, 1],
      ],
    ]);
  });

  it("draws the rectangles when both options are empty", () => {
    const { extent } = draw(
      replay({
        mapmetadata_startbox_override: "",
        mapmetadata_startboxes_set: "",
      }),
    );
    expect(extent).toEqual({ x: 1, z: 1 });
  });

  it("draws the rectangles when an option cannot be decoded, with no error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { areas, extent } = draw(
      replay({
        mapmetadata_startbox_override: "this is not base64 data!",
        mapmetadata_startboxes_set: "AAAA",
      }),
    );
    expect(extent).toEqual({ x: 1, z: 1 });
    expect(areas).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("draws the rectangles when the map's size is not known", () => {
    const { extent } = draw(
      replay({ mapmetadata_startbox_override: OVERRIDE }),
      null,
    );
    expect(extent).toEqual({ x: 1, z: 1 });
  });
});
