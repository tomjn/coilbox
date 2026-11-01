// @vitest-environment happy-dom

/**
 * The Test drawer on a game with compatibility mode (issue #4664). The scratch
 * game the unit is written into depends on the game's compat mutator when the
 * game's switch is on, for the launch, the sandbox and the load check alike.
 * The mutator being missing or stale stops the run and names the Rebuild
 * action. A switch that is off reads nothing.
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
const USE = {
  kind: "use",
  gameType: "SplinterFaction 0.1.89 (compat 2)",
  gameArchive: "coilbox-compat-splinterfaction_0.1.89-2.sdd",
  baseName: "SplinterFaction 0.1.89",
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

const resolveCompatTarget = vi.fn();
vi.mock("../../../play/compatTarget", () => ({
  resolveCompatTarget: (args: unknown) => resolveCompatTarget(args),
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

const writeScratchGame = vi.fn();
vi.mock("../../writeScratchGame", () => ({
  writeScratchGame: (args: unknown) => writeScratchGame(args),
  writeScratchUnit: vi.fn(),
}));

const prepareSandbox = vi.fn();
vi.mock("../../sandbox", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareSandbox: (args: unknown) => prepareSandbox(args),
  sandboxModOptions: () => ({ coilbox_mission: "coilbox-lego-sandbox" }),
}));

const contentUnitCheck = vi.fn();
vi.mock("../../../content/bindings", () => ({
  contentUnitCheck: (args: unknown) => contentUnitCheck(args),
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

const press = (name: RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const LAUNCH = /^Launch with it as start unit$/;
const SANDBOX = /^Launch sandbox with targets$/;
const CHECK = /Check it loads/;

beforeEach(() => {
  resolveCompatTarget.mockResolvedValue({ kind: "off" });
  writeScratchGame.mockResolvedValue({
    dir: "/data/games/coilbox-lego-test.sdd",
    name: "Coilbox unit test scratch",
    textures: "atlas",
    textureFiles: [],
    files: [],
    weaponsLeftOut: [],
    buildListLeftOut: [],
  });
  prepareSandbox.mockResolvedValue({
    sandbox: { missionId: "coilbox-lego-sandbox" },
    scenario: { setup: { participants: [{ id: "player" }], startPosType: 0 } },
  });
  toBattleConfig.mockReturnValue({ battle: true });
  launch.mockResolvedValue({ exitCode: 0, signal: null });
  contentUnitCheck.mockResolvedValue({
    report: {
      outcome: "loaded",
      spawnedPieces: 5,
      doneFrame: 480,
      movedElmos: null,
      moveClass: null,
      problems: [],
      warnings: [],
      fatal: [],
      otherErrors: 0,
      exit: {
        code: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        wallSeconds: 1,
      },
      logPath: "/cache/engine.log",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TestDrawer on a game with compatibility mode", () => {
  it("resolves the picked game", async () => {
    open();
    press(LAUNCH);
    await waitFor(() => expect(launch).toHaveBeenCalled());

    expect(resolveCompatTarget.mock.calls[0][0].game).toBe(GAME);
  });

  it("writes the scratch game over the compat mutator and names the base game", async () => {
    resolveCompatTarget.mockResolvedValue(USE);
    open();
    press(LAUNCH);
    await waitFor(() => expect(launch).toHaveBeenCalled());

    expect(writeScratchGame).toHaveBeenCalledWith(
      expect.objectContaining({
        baseGame: USE.gameType,
        baseArchive: USE.gameArchive,
      }),
    );
    expect(toBattleConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        gameType: "Coilbox unit test scratch",
        compatBase: USE.baseName,
      }),
    );
  });

  it("writes the scratch game over the game itself when the switch is off", async () => {
    open();
    press(LAUNCH);
    await waitFor(() => expect(launch).toHaveBeenCalled());

    expect(writeScratchGame).toHaveBeenCalledWith(
      expect.objectContaining({
        baseGame: GAME.name,
        baseArchive: GAME.primaryArchive.name,
      }),
    );
    expect(toBattleConfig.mock.calls[0][0].compatBase).toBeUndefined();
  });

  it("launches the sandbox over the compat mutator", async () => {
    resolveCompatTarget.mockResolvedValue(USE);
    open();
    press(SANDBOX);
    await waitFor(() => expect(launch).toHaveBeenCalled());

    expect(writeScratchGame).toHaveBeenCalledWith(
      expect.objectContaining({
        baseGame: USE.gameType,
        baseArchive: USE.gameArchive,
      }),
    );
  });

  it("checks the load over the compat mutator", async () => {
    resolveCompatTarget.mockResolvedValue(USE);
    open();
    press(CHECK);
    await screen.findByTestId("unit-check");

    expect(writeScratchGame).toHaveBeenCalledWith(
      expect.objectContaining({ baseGame: USE.gameType }),
    );
    expect(contentUnitCheck).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Launch", LAUNCH],
    ["Launch sandbox", SANDBOX],
    ["Check it loads", CHECK],
  ])("%s stops and names Rebuild when the mutator is not usable", async (_n, button) => {
    const message = `Compatibility mode is on for ${GAME.name}, but its mutator has not been built. Open ${GAME.name} under Library > Games and choose Rebuild.`;
    resolveCompatTarget.mockResolvedValue({ kind: "blocked", message });
    open();
    press(button);

    expect(await screen.findByText(message)).toBeTruthy();
    expect(writeScratchGame).not.toHaveBeenCalled();
    expect(prepareSandbox).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(contentUnitCheck).not.toHaveBeenCalled();
  });
});
