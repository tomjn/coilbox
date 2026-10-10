/**
 * The words and figures of replay analysis, and the gate (#1157).
 *
 * The gate is the part that matters most here. A distribution that hides
 * `analytics.run` must not be able to start a run from anywhere, and
 * `requestAnalysis` is the only call that reaches the enqueue command, so it
 * is shown to refuse without the command ever being called.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const called: { command: string; args: unknown }[] = [];
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      called.push({ command, args });
      if (command === "content_analysis_enqueue") {
        return {
          outcome: "queued",
          queue: {
            running: null,
            queued: [],
            waitingForGame: false,
            failures: [],
            stored: 0,
          },
        };
      }
      if (command === "content_replay_analyses") return { analyses: [] };
      return {};
    },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

let HIDE: string[] = [];
vi.mock("../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));

import type {
  ReplayAnalysisRunningJob,
  StoredReplayAnalysis,
} from "./bindings";
import {
  analysisBlockers,
  analysisPercent,
  analysisProgressLabel,
  analysisRunHidden,
  cancelAnalysis,
  disagreementInWords,
  dismissAnalysisFailure,
  estimateAnalysisSeconds,
  requestAnalysis,
} from "./replayAnalysis";

const ARGS = {
  replayPath: "/replays/a.sdfz",
  enginePath: "/engines/1",
  dataDir: "/data",
};

function stored(over: Partial<StoredReplayAnalysis>): StoredReplayAnalysis {
  return {
    state: "current",
    sizeBytes: 2526,
    kind: "analysis",
    storeFormat: 1,
    outcome: "reproduced",
    gameId: "a".repeat(32),
    loggerFormat: 1,
    loggerVersion: 1,
    engine: "2026.07.01",
    game: "Some Game 1.0",
    map: "Some Map",
    analysedAtMs: 0,
    matchSeconds: 600,
    wallSeconds: 30,
    counts: {
      header: 1,
      gameStart: 1,
      unitCreated: 57,
      unitFinished: 54,
      unitDestroyed: 22,
      unitGiven: 0,
      startUnitPosition: 0,
      gameOver: 1,
      unknown: 0,
    },
    disagreements: [],
    ...over,
  };
}

function running(
  over: Partial<ReplayAnalysisRunningJob>,
): ReplayAnalysisRunningJob {
  return {
    id: 1,
    gameId: "a".repeat(32),
    name: "a.sdfz",
    replayPath: "/replays/a.sdfz",
    matchSeconds: 100,
    startedAtMs: 0,
    phase: "playing",
    frame: 1500,
    lastFrame: 3000,
    cancelling: false,
    ...over,
  };
}

beforeEach(() => {
  called.length = 0;
  HIDE = [];
});

describe("the analytics.run gate", () => {
  it("asks for a run when the distribution allows it", async () => {
    expect(analysisRunHidden()).toBe(false);
    await expect(requestAnalysis(ARGS)).resolves.toBe("queued");
    expect(called.map((c) => c.command)).toContain("content_analysis_enqueue");
  });

  it("refuses a run, and never reaches the command, when the distribution hides it", async () => {
    HIDE = ["analytics.run"];
    expect(analysisRunHidden()).toBe(true);

    await expect(requestAnalysis(ARGS)).rejects.toThrow(/turned off/);
    await expect(requestAnalysis({ ...ARGS, force: true })).rejects.toThrow(
      /turned off/,
    );
    await cancelAnalysis(1);
    await dismissAnalysisFailure("a".repeat(32));

    expect(called).toEqual([]);
  });
});

describe("why a replay cannot be analysed", () => {
  const installed = {
    cannot: null,
    engineVersion: "2026.07.01",
    engineInstalled: true,
    missingGame: false,
    missingMap: false,
    dependencyBlock: null,
  } as const;

  it("has nothing to say for a replay with everything in place", () => {
    expect(analysisBlockers(installed)).toEqual([]);
  });

  it("says a match that was quit has nothing to check a playback against", () => {
    const [reason, ...rest] = analysisBlockers({
      ...installed,
      cannot: "noGameOver",
    });
    expect(reason).toMatch(/never recorded a game over/);
    expect(rest).toEqual([]);
  });

  it("sends a remix back to its original", () => {
    expect(analysisBlockers({ ...installed, cannot: "remix" })[0]).toMatch(
      /Analyse the original/,
    );
  });

  it("names each thing that is not installed", () => {
    const blockers = analysisBlockers({
      ...installed,
      engineInstalled: false,
      missingGame: true,
      missingMap: true,
      dependencyBlock: "Archive not installed: Base. Some Game depends on it.",
    });
    expect(blockers).toEqual([
      "Engine 2026.07.01 is not installed, and no other engine is installed.",
      "The game is not installed.",
      "The map is not installed.",
      "Archive not installed: Base. Some Game depends on it.",
    ]);
  });

  it("does not block on the engine when another installed engine can run it", () => {
    expect(
      analysisBlockers({
        ...installed,
        engineInstalled: false,
        otherEngines: 2,
        installedEngines: 2,
      }),
    ).toEqual([]);
  });

  it("says when engines are installed and none can run headless", () => {
    expect(
      analysisBlockers({
        ...installed,
        engineInstalled: false,
        otherEngines: 0,
        installedEngines: 3,
      }),
    ).toEqual([
      "Engine 2026.07.01 is not installed, and none of the engines that are installed can run an analysis, which needs one with a headless build.",
    ]);
  });

  it("does not block on a missing game when another version of it stands in", () => {
    expect(
      analysisBlockers({ ...installed, missingGame: true, otherGame: true }),
    ).toEqual([]);
  });

  it("still blocks on a missing map whatever else stands in", () => {
    expect(
      analysisBlockers({
        ...installed,
        engineInstalled: false,
        otherEngines: 1,
        missingGame: true,
        otherGame: true,
        missingMap: true,
      }),
    ).toEqual(["The map is not installed."]);
  });

  it("lets what the replay is outrank what is installed", () => {
    expect(
      analysisBlockers({
        ...installed,
        cannot: "noGameOver",
        engineInstalled: false,
        missingGame: true,
      }),
    ).toHaveLength(1);
  });
});

describe("the estimate", () => {
  it("is nothing until this machine has finished a run", () => {
    expect(estimateAnalysisSeconds([], 600)).toBeNull();
  });

  it("comes from this machine's own runs, and says how many", () => {
    // 30s for 600s and 90s for 1800s: a twentieth of the match's length.
    const runs = [
      stored({ matchSeconds: 600, wallSeconds: 30 }),
      stored({ matchSeconds: 1800, wallSeconds: 90 }),
    ];
    expect(estimateAnalysisSeconds(runs, 1200)).toEqual({
      seconds: 60,
      runs: 2,
    });
  });

  it("counts a diverged run, which played the whole match too", () => {
    const runs = [
      stored({ state: "diverged", outcome: "diverged", wallSeconds: 60 }),
    ];
    expect(estimateAnalysisSeconds(runs, 600)).toEqual({
      seconds: 60,
      runs: 1,
    });
  });

  it("leaves out a record with no times in it", () => {
    expect(
      estimateAnalysisSeconds([stored({ wallSeconds: 0 })], 600),
    ).toBeNull();
  });
});

describe("progress", () => {
  it("is a share of the match once frames are arriving", () => {
    expect(analysisPercent(running({}))).toBe(50);
    expect(analysisProgressLabel(running({}))).toBe("Frame 1,500 of 3,000");
  });

  it("claims nothing before the match has begun", () => {
    const starting = running({ phase: "starting", frame: 0 });
    expect(analysisPercent(starting)).toBe(0);
    expect(analysisProgressLabel(starting)).toBe("Starting the engine");
    expect(analysisProgressLabel(running({ phase: "loading", frame: 0 }))).toBe(
      "Loading the match",
    );
  });

  it("does not run past the end when the last event lands after the header's whole seconds", () => {
    const over = running({ frame: 3021 });
    expect(analysisPercent(over)).toBe(100);
    expect(analysisProgressLabel(over)).toBe("Frame 3,000 of 3,000");
  });

  it("says a cancelled run is stopping", () => {
    expect(analysisProgressLabel(running({ cancelling: true }))).toBe(
      "Stopping",
    );
  });
});

describe("a disagreement in words", () => {
  const figure = {
    figure: "unitsTeleported",
    team: 0,
    recorded: "1500",
    observed: "1750",
    difference: 250,
  };

  it("names a team's statistic the way the metric registry does", () => {
    const labels = new Map([["unitsTeleported", "Units beamed in"]]);
    expect(disagreementInWords(figure, labels)).toBe(
      "Units beamed in for team 0: the replay recorded 1500, the playback gave 1750.",
    );
  });

  it("falls back to the figure's own name in words", () => {
    expect(disagreementInWords(figure)).toMatch(
      /^Units teleported for team 0:/,
    );
  });

  it("names the winner, and says nobody for an empty list", () => {
    expect(
      disagreementInWords({ figure: "winners", recorded: "0", observed: "" }),
    ).toBe("Who won: the replay recorded 0, the playback gave nobody.");
  });

  it("puts the logger's own counts in plain words", () => {
    expect(
      disagreementInWords({
        figure: "unitDestroyedLines",
        team: 1,
        recorded: "20",
        observed: "19",
      }),
    ).toMatch(/^Units lost for team 1:/);
  });
});
