// @vitest-environment happy-dom

/**
 * Issue #5182. Test in game sets the skeleton overlay up before it launches,
 * and launches with what that gives back. A setup that fails says so and does
 * not stop the launch.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@picoframe/frame", async (importOriginal) => {
  const react = await import("react");
  return {
    ...(await importOriginal<object>()),
    useSetting: <T,>(_key: string, initial: T) => react.useState<T>(initial),
  };
});

const GAME = {
  name: "SplinterFaction 0.1.96",
  primaryArchive: { name: "splinterfaction_0.1.96.sdz" },
};

vi.mock("../../../content/config", () => ({
  primeScan: vi.fn(),
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useUnitsyncScan: () => ({
    data: { games: [GAME], maps: [{ name: "AcidicQuarry 5.17" }] },
    unvouched: null,
    error: null,
    loading: false,
    cancelled: false,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("../../../play/compatTarget", () => ({
  resolveCompatTarget: async () => ({ kind: "off" }),
}));
vi.mock("@/workshop/config", () => ({
  useUnitDefs: () => ({ defs: null, defsFor: null }),
}));
vi.mock("@/workshop/project", () => ({
  useModProjects: () => ({ projects: [] }),
}));

const toBattleConfig = vi.fn();
vi.mock("../../../play/config", () => ({
  initialParticipants: () => [{}],
  toBattleConfig: (args: unknown) => toBattleConfig(args),
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      dataDir: "/data",
      executable: "/engine/spring",
    },
    loading: false,
  }),
}));

const launch = vi.fn();
vi.mock("../../../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launch, cancel: vi.fn() }),
}));
vi.mock("../../../play/bindings", () => ({ playAskLuaRules: vi.fn() }));
vi.mock("../../../content/bindings", () => ({
  contentUnitCheck: vi.fn(),
  contentUnitCheckCancel: vi.fn(),
}));
vi.mock("../../bindings", () => ({ legoOpenPath: vi.fn() }));
vi.mock("../../writeScratchGame", () => ({
  writeScratchGame: async () => ({
    dir: "/data/games/coilbox-lego-test.sdd",
    name: "Coilbox unit test scratch",
    weaponsLeftOut: [],
    buildListLeftOut: [],
  }),
  writeScratchUnit: vi.fn(),
}));

const prepareTestSkeleton = vi.fn();
vi.mock("../../testSkeleton", () => ({
  prepareTestSkeleton: (args: unknown) => prepareTestSkeleton(args),
}));

import { newProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { TestDrawer } from "./TestDrawer";

function open() {
  render(
    <TestDrawer
      open
      onOpenChange={() => {}}
      project={newProject({
        id: "p1",
        rootPieceId: "root",
        name: "Probe unit",
        unitName: "probe_unit",
        packId: "base",
        packVersion: "1",
        now: "",
      })}
      pack={{} as LoadedPack}
      raw={null}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /^Launch with it as start unit$/ }),
  );
}

beforeEach(() => {
  toBattleConfig.mockReturnValue({ battle: true });
  launch.mockResolvedValue({ exitCode: 0, signal: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TestDrawer and the skeleton overlay", () => {
  it("sets it up for the game being built on and launches with the options it returns", async () => {
    prepareTestSkeleton.mockResolvedValue({
      modOptions: { allowuserwidgets: "1" },
      problem: null,
    });
    open();
    await waitFor(() => expect(launch).toHaveBeenCalled());

    expect(prepareTestSkeleton).toHaveBeenCalledWith(
      expect.objectContaining({
        baseArchive: GAME.primaryArchive.name,
        project: expect.objectContaining({ unitName: "probe_unit" }),
        modOptions: {},
      }),
    );
    expect(toBattleConfig).toHaveBeenCalledWith(
      expect.objectContaining({ modOptions: { allowuserwidgets: "1" } }),
    );
  });

  it("says when the overlay could not be set up, and still launches", async () => {
    prepareTestSkeleton.mockResolvedValue({
      modOptions: {},
      problem: "read only folder",
    });
    open();
    await waitFor(() => expect(launch).toHaveBeenCalled());

    expect(
      await screen.findByText(/could not be set up.*read only folder/),
    ).toBeTruthy();
  });
});
