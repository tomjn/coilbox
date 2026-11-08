// @vitest-environment happy-dom
/**
 * The playability panel measures a map with the chosen game's movement classes
 * and buildings and shows the numbers (issue #2169). The arithmetic is
 * `playability.test.ts`. This file is the wiring.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Heights } from "../../playability";
import { CompiledPlayability, PlayabilityPanel } from "./PlayabilityPanel";

const GAME = {
  name: "Some Game 1.0",
  primaryArchive: { name: "somegame.sdz" },
};
let archiveAsked: string | undefined;

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  useUnitsyncScan: () => ({
    data: { games: [GAME], maps: [], errors: [] },
    loading: false,
    error: null,
  }),
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
}));
const smf = vi.hoisted(() => ({
  heights: vi.fn(),
  mapinfo: vi.fn(),
}));
vi.mock("../../bindings", () => ({
  mcSmfHeights: smf.heights,
  mcReadMapinfo: smf.mapinfo,
}));
vi.mock("@/placement/terrain", () => ({
  readHeightGrid: async () => ({
    words: new Uint16Array(17 * 17).fill(32768),
    width: 17,
    height: 17,
  }),
}));
vi.mock("@/play/pages/components/GamePickerButton", () => ({
  GamePickerField: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.mock("@/workshop/config", () => ({
  useUnitDefs: (_e: string, _d: string, archive?: string) => {
    archiveAsked = archive;
    return archive
      ? {
          defs: {
            units: { mex: { footprintx: 2, footprintz: 2, maxslope: 10 } },
            moveDefs: [{ name: "KBOT2", footprintx: 2, maxslope: 30 }],
          },
          defsFor: archive,
          status: "ready",
          error: null,
        }
      : { defs: null, defsFor: null, status: "idle", error: null };
  },
}));

afterEach(cleanup);

/** A flat 16 by 16 square map. */
function flat(): Heights {
  return {
    words: new Uint16Array(17 * 17).fill(32768),
    width: 17,
    height: 17,
    minHeight: 0,
    maxHeight: 100,
  };
}

describe("the playability panel", () => {
  it("measures the map with the chosen game's classes and buildings", async () => {
    render(<PlayabilityPanel heights={flat()} starts={[]} />);
    expect(archiveAsked).toBe("somegame.sdz");
    expect(await screen.findByText("KBOT2")).toBeTruthy();
    expect(screen.getByText("mex")).toBeTruthy();
    expect(screen.getByText("100.0% of 49 spots")).toBeTruthy();
    // Flat open ground: one area, the whole map passable.
    expect(screen.getAllByText("100.0%").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the metal figures against the map's extractor radius", async () => {
    // The 16 by 16 square map has an 8 by 8 metal map. Two spots 64 elmos
    // apart, one at each end of a row, and a third far from both.
    const bytes = new Uint8Array(64);
    bytes[1 * 8 + 1] = 100;
    bytes[1 * 8 + 5] = 100;
    bytes[6 * 8 + 6] = 100;
    render(
      <PlayabilityPanel
        heights={flat()}
        starts={[{ x: 24, z: 24 }]}
        metal={{
          grid: { bytes, width: 8, height: 8 },
          extractorRadius: 90,
        }}
      />,
    );
    expect(
      await screen.findByText("3 metal spots, extractor radius is 90 elmos"),
    ).toBeTruthy();
    expect(
      screen.getByText("two spots are 64 elmos apart, at 24, 24 and 88, 24"),
    ).toBeTruthy();
    // The nearest spots to the start, which stands on the first.
    expect(screen.getByText("0, 64, 113")).toBeTruthy();
  });

  it("waits for the metal map before it measures", async () => {
    render(
      <PlayabilityPanel heights={flat()} starts={[]} metal={{ grid: null }} />,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("KBOT2")).toBeNull();
  });

  it("says why when the metal map could not be read", async () => {
    render(
      <PlayabilityPanel
        heights={flat()}
        starts={[]}
        metal={{ grid: null, error: "no file" }}
      />,
    );
    expect(
      await screen.findByText("Could not read the map's metal: no file"),
    ).toBeTruthy();
    expect(screen.getByText("KBOT2")).toBeTruthy();
  });

  it("reads a compiled map's metal map and the radius from its mapinfo.lua", async () => {
    const bytes = new Uint8Array(64);
    bytes[1 * 8 + 1] = 100;
    bytes[1 * 8 + 5] = 100;
    smf.heights.mockResolvedValue({
      file: "h.bin",
      width: 17,
      height: 17,
      minHeight: 0,
      maxHeight: 100,
      metalFile: "m.bin",
      metalWidth: 8,
      metalHeight: 8,
    });
    smf.mapinfo.mockResolvedValue({ extractorRadius: 90 });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    }));
    render(
      <CompiledPlayability smfPath="/out/a.smf" outDir="/out" starts={[]} />,
    );
    expect(
      await screen.findByText("2 metal spots, extractor radius is 90 elmos"),
    ).toBeTruthy();
    expect(smf.mapinfo).toHaveBeenCalledWith({ path: "/out" });
    vi.unstubAllGlobals();
  });

  it("falls back to the engine's radius when the folder has no mapinfo.lua", async () => {
    const bytes = new Uint8Array(64);
    bytes[1 * 8 + 1] = 100;
    smf.heights.mockResolvedValue({
      file: "h.bin",
      width: 17,
      height: 17,
      minHeight: 0,
      maxHeight: 100,
      metalFile: "m.bin",
      metalWidth: 8,
      metalHeight: 8,
    });
    smf.mapinfo.mockResolvedValue({});
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    }));
    render(
      <CompiledPlayability smfPath="/out/a.smf" outDir="/out" starts={[]} />,
    );
    expect(
      await screen.findByText("1 metal spot, extractor radius is 500 elmos"),
    ).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("says the compiled map has no metal map when the file has none", async () => {
    smf.heights.mockResolvedValue({
      file: "h.bin",
      width: 17,
      height: 17,
      minHeight: 0,
      maxHeight: 100,
    });
    render(
      <CompiledPlayability smfPath="/out/a.smf" outDir="/out" starts={[]} />,
    );
    expect(
      await screen.findByText(
        "Could not read the map's metal: the compiled map has no metal map to read",
      ),
    ).toBeTruthy();
    expect(screen.getByText("KBOT2")).toBeTruthy();
  });

  it("says why when the heights could not be read", () => {
    render(
      <PlayabilityPanel heights={null} heightsError="no file" starts={[]} />,
    );
    expect(
      screen.getByText("Could not read the map's heights: no file"),
    ).toBeTruthy();
  });
});
