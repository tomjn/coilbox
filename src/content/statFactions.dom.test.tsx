// @vitest-environment happy-dom

/**
 * Issue #5489: the stats records every stats view reads name the faction each
 * player picked in the match, not the start script's side.
 */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  contentStatsIngest: vi.fn(),
  contentStatsWatchStart: vi.fn(async () => ({})),
  contentStatsWatchStop: vi.fn(async () => ({})),
  contentUnitDefSet: vi.fn(async () => null),
  unitsyncScan: vi.fn(),
  unitsyncGameInfo: vi.fn(),
  unitsyncUnitDataset: vi.fn(),
}));

vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  ...bindings,
}));
vi.mock("./contentState", () => ({
  useContentState: () => ({
    state: {
      roots: [
        {
          path: "/data",
          engines: [{ id: "e", path: "/engine", version: "105" }],
        },
      ],
    },
    loading: false,
    error: null,
    refresh: async () => {},
  }),
}));
vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

const { useReplayStats } = await import("./config");

afterEach(cleanup);

describe("useReplayStats and a faction picked in the match", () => {
  it("names the picked side from the installed game", async () => {
    bindings.contentStatsIngest.mockResolvedValue({
      summary: { total: 1 },
      records: [
        {
          filename: "a.sdfz",
          path: "/data/demos/a.sdfz",
          sizeBytes: 1,
          modifiedMs: 1,
          gameType: "Some Game 1",
          remixed: false,
          players: [
            {
              name: "Picker",
              side: "Armada",
              spectator: false,
              pick: { frame: -1, unitDefId: 2 },
            },
          ],
        },
      ],
    });
    bindings.unitsyncScan.mockResolvedValue({
      games: [
        {
          name: "Some Game 1",
          info: {},
          primaryArchive: { name: "some.sdz" },
        },
      ],
      maps: [],
      errors: [],
    });
    bindings.unitsyncGameInfo.mockResolvedValue({
      checksum: 1,
      sides: [
        { name: "Armada", startUnit: "armcom" },
        { name: "Legion", startUnit: "legcom" },
      ],
    });
    bindings.unitsyncUnitDataset.mockResolvedValue({
      checksum: 1,
      units: [{ name: "armcom" }, { name: "legcom" }],
      errors: [],
    });

    const { result } = renderHook(() => useReplayStats(["/data"], "/engine"));

    await waitFor(() =>
      expect(result.current.records[0]?.players[0].side).toBe("Legion"),
    );
  });
});
