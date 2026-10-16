// @vitest-environment happy-dom

/**
 * The Test drawer's "Play with this unit" (issue #3341). It writes the scratch
 * game with the sandbox's files in it and launches the sandbox mission, with the
 * scenario's own participants and start positions.
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
  name: "SplinterFaction 0.1.89",
  primaryArchive: { name: "splinterfaction_0.1.89.sdz" },
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

const toBattleConfig = vi.fn();
vi.mock("../../../play/config", () => ({
  gameOptionSchema: vi.fn().mockResolvedValue([]),
  initialParticipants: () => [{}],
  mapOptionSchema: vi.fn().mockResolvedValue([]),
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
  usePlay: () => ({ running: false, launch }),
}));

const writeScratchGame = vi.fn();
vi.mock("../../writeScratchGame", () => ({
  writeScratchGame: (args: unknown) => writeScratchGame(args),
}));

const SANDBOX = {
  download: "[MENUENTRY1]",
  gadget: "-- sandbox",
  missionId: "coilbox-lego-sandbox",
  mission: "return {}",
  shipRuntime: true,
};
const PARTICIPANTS = [{ id: "player" }, { id: "targets" }];
const prepareSandbox = vi.fn();
vi.mock("../../sandbox", () => ({
  prepareSandbox: (args: unknown) => prepareSandbox(args),
  sandboxModOptions: () => ({ coilbox_mission: "coilbox-lego-sandbox" }),
}));

vi.mock("../../../content/bindings", () => ({
  contentUnitCheck: vi.fn(),
  contentUnitCheckCancel: vi.fn(),
}));

vi.mock("../../bindings", () => ({ legoOpenPath: vi.fn() }));

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
}

beforeEach(() => {
  writeScratchGame.mockResolvedValue({
    dir: "/data/games/coilbox-lego-test.sdd",
    name: "Coilbox unit test scratch",
  });
  prepareSandbox.mockResolvedValue({
    sandbox: SANDBOX,
    scenario: { setup: { participants: PARTICIPANTS, startPosType: 0 } },
  });
  toBattleConfig.mockReturnValue({ battle: true });
  launch.mockResolvedValue({ exitCode: 0, signal: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TestDrawer's Play with this unit", () => {
  it("writes the sandbox into the scratch game and launches its mission", async () => {
    open();
    fireEvent.click(
      screen.getByRole("button", { name: /Play with this unit/ }),
    );
    await waitFor(() => expect(launch).toHaveBeenCalled());

    expect(prepareSandbox).toHaveBeenCalledWith({
      enginePath: "/engine",
      dataDir: "/data",
      game: GAME,
      mapName: "AcidicQuarry 5.17",
      unitName: "probe_unit",
    });
    expect(writeScratchGame).toHaveBeenCalledWith(
      expect.objectContaining({
        baseGame: "SplinterFaction 0.1.89",
        sandbox: SANDBOX,
      }),
    );
    expect(toBattleConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        participants: PARTICIPANTS,
        startPosType: 0,
        gameType: "Coilbox unit test scratch",
        mapName: "AcidicQuarry 5.17",
        modOptions: { coilbox_mission: "coilbox-lego-sandbox" },
      }),
    );
    expect(launch).toHaveBeenCalledWith("skirmish", {
      config: { battle: true },
      executable: "/engine/spring",
      dataDir: "/data",
    });
  });

  it("leaves Launch as it was, with no sandbox and no mission", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Launch$/ }));
    await waitFor(() => expect(launch).toHaveBeenCalled());

    expect(prepareSandbox).not.toHaveBeenCalled();
    expect(writeScratchGame).toHaveBeenCalledWith(
      expect.objectContaining({ sandbox: undefined }),
    );
    expect(toBattleConfig).toHaveBeenCalledWith(
      expect.objectContaining({ modOptions: {}, startPosType: 1 }),
    );
  });

  it("says why when the sandbox cannot be set up, and launches nothing", async () => {
    prepareSandbox.mockRejectedValue(
      new Error(
        "AcidicQuarry 5.17 has no start positions, so there is nowhere to put the targets. Pick another map.",
      ),
    );
    open();
    fireEvent.click(
      screen.getByRole("button", { name: /Play with this unit/ }),
    );

    expect(await screen.findByText(/nowhere to put the targets/)).toBeTruthy();
    expect(writeScratchGame).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });
});
