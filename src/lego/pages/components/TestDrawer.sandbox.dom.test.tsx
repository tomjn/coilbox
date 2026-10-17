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
const unitDefs = vi.hoisted(() => ({
  defs: null as { weaponDefs: Record<string, unknown> } | null,
}));
vi.mock("@/workshop/config", () => ({
  useUnitDefs: () => ({
    defs: unitDefs.defs,
    defsFor: unitDefs.defs ? "splinterfaction_0.1.89.sdz" : null,
  }),
}));
vi.mock("@/workshop/project", () => ({
  useModProjects: () => ({ projects: [] }),
}));

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
const cancel = vi.fn();
const play = { running: false };
vi.mock("../../../play/PlayProvider", () => ({
  usePlay: () => ({ running: play.running, launch, cancel }),
}));

const playAskLuaRules = vi.fn();
vi.mock("../../../play/bindings", () => ({
  playAskLuaRules: (args: unknown) => playAskLuaRules(args),
}));

const writeScratchGame = vi.fn();
const writeScratchUnit = vi.fn();
vi.mock("../../writeScratchGame", () => ({
  writeScratchGame: (args: unknown) => writeScratchGame(args),
  writeScratchUnit: (args: unknown) => writeScratchUnit(args),
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
vi.mock("../../sandbox", async (importOriginal) => ({
  ...(await importOriginal<object>()),
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

const DIR = "/data/games/coilbox-lego-test.sdd";

/** The unit as an export writes it, with any file's digest changed. */
function unitFiles(
  changed: { script?: boolean; model?: boolean; texture?: boolean } = {},
) {
  return {
    dir: DIR,
    textures: changed.texture ? "atlas-2" : "atlas",
    textureFiles: ["coilbox_atlas.png"],
    weaponsLeftOut: [],
    files: [
      {
        path: `${DIR}/objects3d/probe_unit.s3o`,
        sha256: changed.model ? "m2" : "m1",
      },
      {
        path: `${DIR}/scripts/probe_unit.lua`,
        sha256: changed.script ? "s2" : "s1",
      },
      { path: `${DIR}/units/probe_unit.lua`, sha256: "d1" },
    ],
  };
}

beforeEach(() => {
  play.running = false;
  writeScratchGame.mockResolvedValue({
    ...unitFiles(),
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

describe("TestDrawer's weapons", () => {
  it("hands the scratch game the test game's weapons and names those left out", async () => {
    unitDefs.defs = { weaponDefs: { gun: {} } };
    writeScratchGame.mockResolvedValue({
      ...unitFiles(),
      name: "Coilbox unit test scratch",
      weaponsLeftOut: ["armcom_laser (not in this game)."],
    });
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Launch$/ }));
    await waitFor(() => expect(launch).toHaveBeenCalled());

    expect(writeScratchGame).toHaveBeenCalledWith(
      expect.objectContaining({
        gameWeapons: { gun: {} },
        workshopProjects: [],
      }),
    );
    expect(
      screen.getByText("Left out: armcom_laser (not in this game)."),
    ).toBeTruthy();
    unitDefs.defs = null;
  });
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
      autohost: true,
      onEngineStarted: expect.any(Function),
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
    expect(launch).toHaveBeenCalledWith("skirmish", {
      config: { battle: true },
      executable: "/engine/spring",
      dataDir: "/data",
    });
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

describe("TestDrawer's Reload in the sandbox (issue #3346)", () => {
  const reloadButton = () =>
    screen.getByRole("button", { name: /Reload in the sandbox/ });

  /**
   * Press Play with this unit and leave the game running: the launch only
   * settles when `cancel` is called, the way a real one settles on exit.
   */
  async function sandboxRunning() {
    launch.mockImplementation(
      (_kind: string, opts: { onEngineStarted?: (id: string) => void }) =>
        new Promise((settle) => {
          play.running = true;
          opts.onEngineStarted?.("run-1");
          cancel.mockImplementation(() =>
            settle({ exitCode: null, signal: null }),
          );
        }),
    );
    open();
    fireEvent.click(
      screen.getByRole("button", { name: /Play with this unit/ }),
    );
    await waitFor(() =>
      expect(reloadButton()).not.toHaveProperty("disabled", true),
    );
  }

  it("is there but cannot be pressed with no sandbox running", () => {
    open();
    expect(reloadButton()).toHaveProperty("disabled", true);
  });

  it("is not for a game the plain Launch started", async () => {
    launch.mockImplementation(() => {
      play.running = true;
      return new Promise(() => {});
    });
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Launch$/ }));
    await waitFor(() => expect(launch).toHaveBeenCalled());
    expect(reloadButton()).toHaveProperty("disabled", true);
  });

  it("reloads a changed script in the running game and says so", async () => {
    await sandboxRunning();
    writeScratchUnit.mockResolvedValue(unitFiles({ script: true }));
    playAskLuaRules.mockResolvedValue({
      answer: "coilbox_sandbox:loaded",
      seconds: 0.02,
    });

    fireEvent.click(reloadButton());

    expect(
      await screen.findByText(
        "Reloaded the script. Every probe_unit in the game runs it now.",
      ),
    ).toBeTruthy();
    expect(writeScratchUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        baseGame: "SplinterFaction 0.1.89",
        sandbox: SANDBOX,
      }),
    );
    expect(playAskLuaRules).toHaveBeenCalledWith({
      runId: "run-1",
      message: "coilbox_sandbox reload_scripts",
      reply: "coilbox_sandbox:",
    });
    expect(screen.queryByRole("button", { name: /^Relaunch$/ })).toBeNull();
  });

  it("does not reload the same script twice", async () => {
    await sandboxRunning();
    writeScratchUnit.mockResolvedValue(unitFiles({ script: true }));
    playAskLuaRules.mockResolvedValue({
      answer: "coilbox_sandbox:loaded",
      seconds: 0.02,
    });
    fireEvent.click(reloadButton());
    await screen.findByText(/Reloaded the script/);

    fireEvent.click(reloadButton());

    expect(
      await screen.findByText("Nothing has changed since the game started."),
    ).toBeTruthy();
    expect(playAskLuaRules).toHaveBeenCalledTimes(1);
  });

  it("says a changed model needs a relaunch, and relaunches", async () => {
    await sandboxRunning();
    writeScratchUnit.mockResolvedValue(
      unitFiles({ model: true, script: true }),
    );

    fireEvent.click(reloadButton());

    expect(
      await screen.findByText(
        "The model changed. The engine cannot reload a model in a running game, so relaunch to see it.",
      ),
    ).toBeTruthy();
    expect(playAskLuaRules).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Relaunch$/ }));

    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(prepareSandbox).toHaveBeenCalledTimes(2);
  });

  // Issue #4146.
  it("reloads a texture changed under the same name and says so", async () => {
    await sandboxRunning();
    writeScratchUnit.mockResolvedValue(unitFiles({ texture: true }));
    playAskLuaRules.mockResolvedValue({
      answer: "coilbox_sandbox:textures",
      seconds: 0.02,
    });

    fireEvent.click(reloadButton());

    expect(
      await screen.findByText(
        "Reloaded the texture. Every probe_unit in the game shows it now.",
      ),
    ).toBeTruthy();
    expect(playAskLuaRules).toHaveBeenCalledWith({
      runId: "run-1",
      message: "coilbox_sandbox reload_textures",
      reply: "coilbox_sandbox:",
    });
    expect(screen.queryByRole("button", { name: /^Relaunch$/ })).toBeNull();

    fireEvent.click(reloadButton());
    expect(
      await screen.findByText("Nothing has changed since the game started."),
    ).toBeTruthy();
    expect(playAskLuaRules).toHaveBeenCalledTimes(1);
  });

  it("reloads the script and the texture together", async () => {
    await sandboxRunning();
    writeScratchUnit.mockResolvedValue(
      unitFiles({ script: true, texture: true }),
    );
    playAskLuaRules.mockImplementation(({ message }: { message: string }) =>
      Promise.resolve({
        answer: message.endsWith("reload_textures")
          ? "coilbox_sandbox:textures"
          : "coilbox_sandbox:loaded",
        seconds: 0.02,
      }),
    );

    fireEvent.click(reloadButton());

    expect(
      await screen.findByText(
        "Reloaded the script. Every probe_unit in the game runs it now. Reloaded the texture. Every probe_unit in the game shows it now.",
      ),
    ).toBeTruthy();
    expect(playAskLuaRules).toHaveBeenCalledTimes(2);
  });

  it("says why when the game did not reload the texture", async () => {
    await sandboxRunning();
    writeScratchUnit.mockResolvedValue(unitFiles({ texture: true }));
    playAskLuaRules.mockResolvedValue({
      answer: "coilbox_sandbox:something else",
      seconds: 0.01,
    });

    fireEvent.click(reloadButton());

    expect(
      await screen.findByText("coilbox_sandbox:something else"),
    ).toBeTruthy();
  });

  it("says why when the game could not reload the script", async () => {
    await sandboxRunning();
    writeScratchUnit.mockResolvedValue(unitFiles({ script: true }));
    playAskLuaRules.mockResolvedValue({
      answer: "coilbox_sandbox:failed:This game runs no Lua unit scripts.",
      seconds: 0.01,
    });

    fireEvent.click(reloadButton());

    expect(
      await screen.findByText("This game runs no Lua unit scripts."),
    ).toBeTruthy();
  });
});
