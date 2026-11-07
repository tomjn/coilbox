// @vitest-environment happy-dom
/**
 * The playability panel measures a map with the chosen game's movement classes
 * and buildings and shows the numbers (issue #2169). The arithmetic is
 * `playability.test.ts`. This file is the wiring.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Heights } from "../../playability";
import { PlayabilityPanel } from "./PlayabilityPanel";

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

  it("says why when the heights could not be read", () => {
    render(
      <PlayabilityPanel heights={null} heightsError="no file" starts={[]} />,
    );
    expect(
      screen.getByText("Could not read the map's heights: no file"),
    ).toBeTruthy();
  });
});
