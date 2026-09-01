// @vitest-environment happy-dom
/**
 * What the drawer says about a run that has finished (issue #2165).
 *
 * The case this exists for is a mission that spawned nothing: it exits with code
 * 0 and reads exactly like a mission that worked, so nothing about the exit
 * status can tell them apart. Only the runtime's own lines in the engine log
 * can, which is why the panel is not gated on an abnormal exit and why every
 * test here runs with `exitCode: 0`.
 *
 * `runLog.test.ts` covers which lines belong to a run. This covers the wiring:
 * that the log is read at all, that it is read for the author and not the
 * player, and that a quiet run is told apart from a log that could not be read.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { launchScenario, playInfolog } = vi.hoisted(() => ({
  launchScenario: vi.fn(),
  playInfolog: vi.fn(),
}));

// The launch itself is `launch.test.ts`'s. What is under test is what the drawer
// does once one has come back, so it is stubbed down to the callback it makes
// and the result it returns.
vi.mock("../../launch", () => ({
  launchScenario,
  scenarioLaunchBlocker: () => null,
  missionIssueSummary: () => "",
}));
vi.mock("@/play/bindings", () => ({ playInfolog }));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: {
      dataDir: "/data",
      enginePath: "/engine",
      executable: "/engine/spring",
    },
    loading: false,
  }),
  gameOptionSchema: async () => ({}),
  mapOptionSchema: async () => ({}),
}));
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({ data: { games: [] }, error: null }),
  primeScan: async () => ({ games: [] }),
}));
vi.mock("@/content/useGameUnits", () => ({
  useGameUnits: () => ({ units: [], archive: null }),
}));
vi.mock("@/play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launch: async () => ({}) }),
}));
// The adopted route, so the mutator's offer is not part of what is on screen.
vi.mock("./useScenarioGate", () => ({
  useScenarioGate: () => ({ route: "adopted", reason: null, available: null }),
}));
vi.mock("./useScenarioMapExtent", () => ({
  useScenarioMapExtent: () => null,
}));
vi.mock("../../storage", () => ({
  ensureBundledScenarioMedia: async () => {},
}));

import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import { ScenarioTestDrawer } from "./ScenarioTestDrawer";

/** A refusal the runtime logs, in the shape Spring's formatter writes it. */
const REFUSED =
  "[t=00:00:25.001200][f=0000030] [coilbox-mission] Error: the engine refused to spawn corkrog for team 1 at 900,800, so it is not on the map";
/** One of the engine's own, which every run has and none of which is the news. */
const DEPRECATED =
  '[t=00:00:22.144642][f=-000001] Error: [SetConfigString] key "UsePBO" is deprecated';

/** A run that ends cleanly, which is the only kind this panel is for. */
function clean() {
  launchScenario.mockImplementation(
    async (input: { launch: (config: unknown) => Promise<unknown> }) => {
      await input.launch({});
      return {
        ok: true,
        route: "adopted",
        reason: "",
        dir: "/games/Example",
        mission: "missions/demo/mission.lua",
        gameType: "Example",
        config: {},
        exitCode: 0,
        warnings: [],
      };
    },
  );
}

function withLog(lines: string[]) {
  playInfolog.mockResolvedValue({
    log: {
      path: "/data/infolog.txt",
      // Comfortably after the launch, so the tail belongs to this run.
      modifiedMs: Date.now() + 60_000,
      totalLines: lines.length,
      lines,
      truncated: false,
    },
  });
}

async function press(mode: "test" | "play") {
  render(<ScenarioTestDrawer scenario={newScenario("Demo")} mode={mode} />);
  const label = mode === "test" ? "Test in game" : "Play";
  screen.getByRole("button", { name: label }).click();
}

beforeEach(() => {
  vi.clearAllMocks();
  clean();
});
afterEach(cleanup);

describe("the engine log after a scenario test run", () => {
  it("shows what the runtime refused, on a run that exited with code 0", async () => {
    withLog([REFUSED, DEPRECATED]);
    await press("test");

    expect(
      await screen.findByText(/reported 1 problem while it played/),
    ).toBeTruthy();
    expect(screen.getByText(REFUSED)).toBeTruthy();
    expect(playInfolog).toHaveBeenCalledWith({
      dataDir: "/data",
      maxLines: 500,
    });
  });

  it("folds the engine's own errors away rather than burying the runtime's", async () => {
    withLog([REFUSED, DEPRECATED]);
    await press("test");

    // The count is offered, and the line itself is behind the trigger: an
    // author looking for their own mistake should not have to read past the
    // engine's routine deprecation notices to find it.
    expect(
      await screen.findByText(/logged one error or warning of its own/),
    ).toBeTruthy();
    expect(screen.queryByText(DEPRECATED)).toBeNull();
  });

  it("says a quiet runtime means everything reached the map", async () => {
    withLog([DEPRECATED]);
    await press("test");

    expect(
      await screen.findByText(/reported nothing, so everything/),
    ).toBeTruthy();
  });

  it("says so when the log could not be read at all", async () => {
    playInfolog.mockRejectedValue(new Error("no infolog anywhere"));
    await press("test");

    expect(
      await screen.findByText(/log could not be read for this run/),
    ).toBeTruthy();
  });

  it("says so when the newest log predates the run", async () => {
    playInfolog.mockResolvedValue({
      log: {
        path: "/data/infolog.txt",
        modifiedMs: Date.now() - 60_000,
        totalLines: 1,
        lines: [REFUSED],
        truncated: false,
      },
    });
    await press("test");

    // Yesterday's refusal is not this run's evidence, and showing it would read
    // as though it were.
    expect(
      await screen.findByText(/log could not be read for this run/),
    ).toBeTruthy();
    expect(screen.queryByText(REFUSED)).toBeNull();
  });

  it("reads no log for a player, who has nothing to debug", async () => {
    withLog([REFUSED]);
    await press("play");

    expect(
      await screen.findByText(/The game has closed. Play it again from here./),
    ).toBeTruthy();
    expect(playInfolog).not.toHaveBeenCalled();
    expect(screen.queryByText(REFUSED)).toBeNull();
  });
});

/**
 * Issue #2164. The choice is offered by the same drawer the Scenarios page
 * opens, so a player pressing Play and an author testing a change pick their
 * difficulty in one place.
 */
describe("choosing a difficulty before the launch", () => {
  /** A scenario with one thing in it that only exists on hard. */
  function varying(): Scenario {
    const scenario = newScenario("Demo");
    return {
      ...scenario,
      actors: [
        {
          id: "boss",
          unitDef: "corcom",
          team: "enemy",
          pos: { x: 500, z: 500 },
          facing: 0,
          difficulty: { atLeast: "hard" },
        },
      ],
    };
  }

  it("offers nothing for a scenario that plays the same either way", () => {
    render(<ScenarioTestDrawer scenario={newScenario("Demo")} mode="play" />);

    expect(screen.queryByText("How hard should it be?")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Hard" })).toBeNull();
  });

  it("launches at the middle of the ladder without being touched", async () => {
    render(<ScenarioTestDrawer scenario={varying()} mode="play" />);
    screen.getByText("How hard should it be?");
    screen.getByRole("button", { name: "Play" }).click();

    await vi.waitFor(() =>
      expect(launchScenario.mock.calls[0][0].difficulty).toBe("normal"),
    );
  });

  it("launches at the one that was picked", async () => {
    render(<ScenarioTestDrawer scenario={varying()} mode="play" />);
    fireEvent.click(screen.getByRole("radio", { name: "Hard" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await vi.waitFor(() =>
      expect(launchScenario.mock.calls[0][0].difficulty).toBe("hard"),
    );
  });

  // The launch has to be told nothing rather than told the default, or a
  // scenario that gates nothing gets a modoption it never had.
  it("says nothing about difficulty for a scenario that does not vary", async () => {
    render(<ScenarioTestDrawer scenario={newScenario("Demo")} mode="play" />);
    screen.getByRole("button", { name: "Play" }).click();

    await vi.waitFor(() =>
      expect(launchScenario.mock.calls[0][0].difficulty).toBeUndefined(),
    );
  });
});
