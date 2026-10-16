// @vitest-environment happy-dom

/**
 * The Test drawer's "Check it loads" (issue #3319). It writes the scratch game
 * the way Launch does, hands the scratch game's name to the headless check,
 * and shows what came back: the engine's words about the unit, not its whole
 * log.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnitCheckReport } from "@/content/bindings";

vi.mock("@picoframe/frame", async (importOriginal) => {
  const react = await import("react");
  return {
    ...(await importOriginal<object>()),
    useSetting: <T,>(_key: string, initial: T) => react.useState<T>(initial),
  };
});

vi.mock("../../../content/config", () => ({
  primeScan: vi.fn(),
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useUnitsyncScan: () => ({
    data: {
      games: [
        {
          name: "SplinterFaction 0.1.89",
          primaryArchive: { name: "splinterfaction_0.1.89.sdz" },
        },
      ],
      maps: [{ name: "Small_Supreme_Battlefield_V3" }],
    },
    unvouched: null,
    error: null,
    loading: false,
    cancelled: false,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock("../../../play/config", () => ({
  gameOptionSchema: vi.fn(),
  initialParticipants: () => [{}],
  mapOptionSchema: vi.fn(),
  toBattleConfig: vi.fn(),
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

const contentUnitCheck = vi.fn();
vi.mock("../../../content/bindings", () => ({
  contentUnitCheck: (args: unknown) => contentUnitCheck(args),
  contentUnitCheckCancel: vi.fn(),
}));

vi.mock("../../bindings", () => ({ legoOpenPath: vi.fn() }));

import { newProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { TestDrawer } from "./TestDrawer";

/** The shape a real run's report has, out of a real headless run. */
function report(over: Partial<UnitCheckReport>): UnitCheckReport {
  return {
    outcome: "loaded",
    spawnedPieces: 5,
    doneFrame: 480,
    movedElmos: null,
    moveClass: null,
    problems: [],
    warnings: [],
    fatal: [],
    otherErrors: 53,
    exit: {
      code: 0,
      signal: null,
      timedOut: false,
      cancelled: false,
      wallSeconds: 11.4,
    },
    logPath: "/cache/unit-check/engine.log",
    ...over,
  };
}

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

async function check() {
  fireEvent.click(screen.getByRole("button", { name: /Check it loads/ }));
  await screen.findByTestId("unit-check");
}

beforeEach(() => {
  writeScratchGame.mockResolvedValue({
    dir: "/data/games/coilbox-lego-test.sdd",
    name: "Coilbox unit test scratch",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TestDrawer's load check", () => {
  it("checks the scratch game it wrote, on the map picked, without launching", async () => {
    contentUnitCheck.mockResolvedValue({ report: report({}) });
    open();
    await check();

    expect(writeScratchGame).toHaveBeenCalledWith(
      expect.objectContaining({ baseGame: "SplinterFaction 0.1.89" }),
    );
    expect(contentUnitCheck).toHaveBeenCalledWith({
      enginePath: "/engine",
      dataDir: "/data",
      game: "Coilbox unit test scratch",
      map: "Small_Supreme_Battlefield_V3",
      unitName: "probe_unit",
      spawnFrame: 30,
      frames: 450,
    });
    expect(launch).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "probe_unit loaded and ran for 15 seconds with no errors. How it looks is not checked.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("53 other errors in the log are not about this unit."),
    ).toBeTruthy();
  });

  it("shows a script that threw, once, with how many times", async () => {
    contentUnitCheck.mockResolvedValue({
      report: report({
        outcome: "problems",
        problems: [
          {
            text: '[unit_script.lua] Error: [string "scripts/probe_unit.lua"]:7: deliberately broken for issue 3319',
            count: 3,
          },
        ],
      }),
    });
    open();
    await check();

    expect(screen.getByText("1 problem with probe_unit.")).toBeTruthy();
    expect(screen.getByText(/deliberately broken for issue 3319/)).toBeTruthy();
    expect(screen.getByText("3 times")).toBeTruthy();
  });

  it("says the game did not load, and why, when the engine never started the match", async () => {
    contentUnitCheck.mockResolvedValue({
      report: report({
        outcome: "gameDidNotLoad",
        spawnedPieces: null,
        doneFrame: null,
        fatal: [
          {
            text: "Fatal: [ExitSpringProcess] errorMsg=\"alldefs_post.lua:64: attempt to concatenate field 'unitname' (a nil value)\"",
            count: 1,
          },
        ],
        exit: {
          code: 21,
          signal: null,
          timedOut: false,
          cancelled: false,
          wallSeconds: 3.5,
        },
      }),
    });
    open();
    await check();

    expect(
      screen.getByText("The game did not load with probe_unit in it."),
    ).toBeTruthy();
    expect(screen.getByText(/field 'unitname' \(a nil value\)/)).toBeTruthy();
  });

  it("gives the reason when there is no headless engine", async () => {
    contentUnitCheck.mockRejectedValue(
      new Error(
        "No headless engine in /engine. The check needs spring-headless, and this engine does not have it.",
      ),
    );
    open();
    fireEvent.click(screen.getByRole("button", { name: /Check it loads/ }));

    expect(
      await screen.findByText(/No headless engine in \/engine/),
    ).toBeTruthy();
  });
});
