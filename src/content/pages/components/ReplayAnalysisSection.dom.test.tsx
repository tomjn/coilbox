// @vitest-environment happy-dom

/**
 * What the replay page says about analysing and recording a replay in each
 * state, and what its buttons reach (#1157, #1158, #3788, #3962).
 *
 * One section and one button make the analysis and the track, so nothing here
 * can ask for the engine to run twice for one replay.
 *
 * The real section and the real frontend store, with the plugin commands
 * replaced. happy-dom does no layout, so nothing here says how it looks.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MIB = 1024 * 1024;

const EMPTY_QUEUE = {
  running: null,
  queued: [],
  waitingForGame: false,
  failures: [],
  stored: 0,
  tracks: 0,
};

/** What each command was handed, in order. */
const called: { command: string; args: unknown }[] = [];
/** What `content_analysis_check` answers. */
let CHECK: {
  cannot: string | null;
  gameId: string | null;
  matchSeconds: number;
  headless: string[];
};
/** The engines in the one content folder `content_state_load` answers with. */
let ENGINES: { path: string; version: string; syncVersion?: string }[] = [];
/** What `content_analysis_engine_output` answers. Null is a job not running. */
let ENGINE_OUTPUT: string[] | null = null;
/** What `content_analysis_enqueue` answers, or throws when it is an Error. */
let ENQUEUE: string | Error = "queued";

// The frame's `useSetting`, held in memory.
vi.mock("@picoframe/frame", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@picoframe/frame")>();
  const { useState } = await import("react");
  return {
    ...actual,
    useSetting: (_key: string, fallback: unknown) => useState(fallback),
  };
});

vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      called.push({ command, args });
      switch (command) {
        case "content_analysis_check":
          return CHECK;
        case "content_state_load":
          return { state: { roots: [{ path: "/data", engines: ENGINES }] } };
        case "content_analysis_enqueue":
          if (ENQUEUE instanceof Error) throw ENQUEUE;
          return { outcome: ENQUEUE, queue: EMPTY_QUEUE };
        case "content_replay_analyses":
          return { analyses: [] };
        case "content_analysis_engine_output":
          return { lines: ENGINE_OUTPUT };
        case "content_metric_registry":
          return {
            metrics: [{ key: "unitsTeleported", label: "Units beamed in" }],
            ratios: [],
          };
        default:
          return {};
      }
    },
}));

// The tracks are seeded, so the command that reads them answers nothing new.
vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentReplayTracks: async () => {
      called.push({ command: "content_replay_tracks", args: undefined });
      throw new Error("seeded in the test");
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

let HIDE: string[] = [];
vi.mock("../../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));

import type {
  DemoInfo,
  GameItem,
  RecordingCost,
  ReplayAnalysisFailure,
  ReplayAnalysisRunningJob,
  StoredReplayAnalysis,
  StoredReplayTrack,
} from "../../bindings";
import { resetContentState } from "../../contentState";
import {
  resetReplayAnalysisForTests,
  seedReplayAnalysisForTests,
} from "../../replayAnalysis";
import {
  resetReplayTracksForTests,
  seedReplayTracksForTests,
} from "../../replayTracks";
import { ReplayAnalysisSection } from "./ReplayAnalysisSection";

const ID = "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
const OTHER = "b0b1b2b3b4b5b6b7b8b9babbbcbdbebf";
const PATH = "/replays/match.sdfz";
const TARGET = { enginePath: "/engines/2026", dataDir: "/data" };

const INFO = {
  engineVersion: "2026.07.01",
  gameId: ID,
  startTimeMs: 0,
  durationSec: 769,
  wallclockSec: 800,
  mapName: "Some Map",
  gameType: "Some Game 1.0",
  winningAllyTeams: [0],
  winnersKnown: true,
  numAllyTeams: 2,
  allyTeams: [],
  players: [],
  ais: [],
  modOptions: {},
  mapOptions: {},
} as unknown as DemoInfo;

function stored(
  over: Partial<StoredReplayAnalysis> = {},
): StoredReplayAnalysis {
  return {
    state: "current",
    sizeBytes: 2526,
    kind: "analysis",
    storeFormat: 1,
    outcome: "reproduced",
    gameId: ID,
    loggerFormat: 1,
    loggerVersion: 1,
    engine: "2026.07.01 (Headless)",
    game: "Some Game 1.0",
    map: "Some Map",
    analysedAtMs: 1_700_000_000_000,
    matchSeconds: 769,
    wallSeconds: 24.5,
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

function job(
  over: Partial<ReplayAnalysisRunningJob> = {},
): ReplayAnalysisRunningJob {
  return {
    id: 7,
    gameId: ID,
    name: "match.sdfz",
    replayPath: PATH,
    matchSeconds: 769,
    startedAtMs: 0,
    phase: "playing",
    frame: 11535,
    lastFrame: 23070,
    cancelling: false,
    ...over,
  };
}

const track = (over: Partial<StoredReplayTrack> = {}): StoredReplayTrack => ({
  gameId: ID,
  state: "current",
  sizeBytes: MIB,
  lastWatchedMs: 1,
  ...over,
});

/** A past run of a match as long as INFO's: 23,070 frames in 3 minutes. */
const pastRun = (over: Partial<RecordingCost> = {}): RecordingCost => ({
  gameId: OTHER,
  game: "Some Game 1.0",
  frames: 23_070,
  millis: 180_000,
  trackBytes: 2 * MIB,
  ...over,
});

function failure(
  over: Partial<ReplayAnalysisFailure> = {},
): ReplayAnalysisFailure {
  return {
    gameId: ID,
    name: "match.sdfz",
    reason: "engineFailed",
    message: "the engine exited with status 1",
    logExcerpt: [],
    ...over,
  };
}

function show(
  props: Partial<Parameters<typeof ReplayAnalysisSection>[0]> = {},
) {
  return render(
    <ReplayAnalysisSection
      replayPath={PATH}
      info={INFO}
      target={TARGET}
      missingGame={false}
      missingMap={false}
      dependencyBlock={null}
      {...props}
    />,
  );
}

/** The section's help entry, opened. Why and how long are said there. */
const help = () => {
  fireEvent.click(
    screen.getByRole("button", { name: "About the analysis and recording" }),
  );
  return screen.getByRole("dialog").textContent ?? "";
};
const commands = () => called.map((c) => c.command);
const region = () =>
  screen.getByRole("region", { name: "Analysis and recording" }).textContent ??
  "";
const FRESH = "Analyse and record this replay";
const analyseButton = (name: string | RegExp = FRESH) =>
  screen.getByRole("button", { name });
/** The confirmation, opened: what the run will cost, before it starts. */
async function openConfirmation(name: string | RegExp = FRESH) {
  await waitFor(() =>
    expect(analyseButton(name)).toHaveProperty("disabled", false),
  );
  fireEvent.click(analyseButton(name));
  return (await screen.findByRole("dialog")).textContent ?? "";
}
/** Press the button and answer the confirmation, which is what starts a run. */
async function start(name: string | RegExp = FRESH) {
  await openConfirmation(name);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await waitFor(() => expect(commands()).toContain("content_analysis_enqueue"));
}
const enqueued = () =>
  called.find((c) => c.command === "content_analysis_enqueue")?.args;

beforeEach(() => {
  called.length = 0;
  HIDE = [];
  CHECK = {
    cannot: null,
    gameId: ID,
    matchSeconds: 769,
    headless: [TARGET.enginePath],
  };
  ENGINES = [];
  ENGINE_OUTPUT = null;
  ENQUEUE = "queued";
  resetContentState();
  resetReplayAnalysisForTests();
  seedReplayAnalysisForTests({});
  resetReplayTracksForTests();
  seedReplayTracksForTests([]);
});

afterEach(() => {
  cleanup();
});

describe("a replay that has not been analysed or recorded", () => {
  it("says what pressing the button will do in the help and not in the section", async () => {
    show();

    const text = region();
    expect(text).not.toContain("plays this match back");
    expect(text).not.toContain("The result is kept only if");
    expect(text).not.toContain("The match is 12:49 long");
    expect(text).not.toContain("playback runs faster than the match did");
    const said = help();
    expect(said).toContain(
      "Analysing plays the match back in the game's engine on this computer",
    );
    expect(said).toContain("The same playback records the whole match");
    expect(said).toContain(
      "The result is kept only if the playback matches the recorded match",
    );
    expect(said).toContain("The match is 12:49 long");
    expect(said).toContain("playback runs faster than the match did");
    expect(said).toContain(
      "The engine and the game the replay used must be installed",
    );
    expect(said).toContain("The result is kept, so this happens once");
    await waitFor(() =>
      expect(analyseButton()).toHaveProperty("disabled", false),
    );
  });

  it("is one section with one button, and says nothing of a track it has no reason to", async () => {
    show();

    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(region()).not.toContain("Not recorded");
    await waitFor(() =>
      expect(analyseButton()).toHaveProperty("disabled", false),
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "",
      FRESH,
    ]);
  });

  it("says the game runs once, without a window, before anything starts", async () => {
    show();

    const said = await openConfirmation();

    expect(said).toContain("This runs the game once, without a window");
    expect(commands()).not.toContain("content_analysis_enqueue");
  });

  it("estimates the time and the track's size from runs of this game on this computer", async () => {
    seedReplayTracksForTests([], null, [pastRun()]);
    show();

    const said = await openConfirmation();

    expect(said).toContain("Time: about 3 minutes");
    expect(said).toContain("Track size: about 2.0 MB");
    expect(said).toContain("Estimated from 1 earlier recording of this game");
    cleanup();
    show();
    const helped = help();
    expect(helped).toContain("Expect about 3 minutes.");
    expect(helped).toContain(
      "The estimate goes by the 1 recording of this game this computer has finished.",
    );
  });

  it("scales the estimate to the replay's length", async () => {
    // Twice the frames of INFO took twice as long and came out twice as big.
    seedReplayTracksForTests([], null, [
      pastRun({ frames: 46_140, millis: 360_000, trackBytes: 4 * MIB }),
    ]);
    show();

    const said = await openConfirmation();

    expect(said).toContain("Time: about 3 minutes");
    expect(said).toContain("Track size: about 2.0 MB");
  });

  it("says the time and size are unknown when nothing has been run, or only other games", async () => {
    seedReplayTracksForTests([], null, [pastRun({ game: "Another Game 3" })]);
    show();

    const said = await openConfirmation();

    expect(said).toContain("Time: unknown");
    expect(said).toContain("Track size: unknown");
    expect(said).not.toMatch(/about \d/);
    expect(region()).not.toMatch(/expect about/i);
  });

  it("warns that older tracks will be removed when the new one will not fit the limit", async () => {
    // 2 MB is stored, the limit is 3 MB and the new track is about 2 MB.
    seedReplayTracksForTests(
      [track({ gameId: OTHER, sizeBytes: 2 * MIB })],
      3 * MIB,
      [pastRun()],
    );
    show();

    const said = await openConfirmation();

    expect(said).toContain(
      "Older tracks will be removed to stay within the 3.0 MB limit",
    );
  });

  it("says nothing about the limit when the track fits, or when there is no size to go by", async () => {
    seedReplayTracksForTests([], 10 * MIB, [pastRun()]);
    show();
    expect(await openConfirmation()).not.toMatch(/removed|limit/);
    cleanup();

    seedReplayTracksForTests(
      [track({ gameId: OTHER, sizeBytes: 5 * MIB })],
      3 * MIB,
    );
    show();
    expect(await openConfirmation()).not.toMatch(/removed|limit/);
  });

  it("says a track larger than the whole limit keeps only itself", async () => {
    seedReplayTracksForTests([], MIB, [pastRun()]);
    show();

    const said = await openConfirmation();

    expect(said).toContain("larger than the whole 1.0 MB limit");
  });

  it("starts nothing by being shown, or until the confirmation is answered", async () => {
    show();
    await openConfirmation();
    expect(commands()).not.toContain("content_analysis_enqueue");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(commands()).not.toContain("content_analysis_enqueue");
  });

  it("asks once, for one run, with the engine and folder a replay launch would use", async () => {
    show();

    await start();

    expect(
      called.filter((c) => c.command === "content_analysis_enqueue"),
    ).toHaveLength(1);
    expect(enqueued()).toEqual({
      replayPath: PATH,
      enginePath: "/engines/2026",
      dataDir: "/data",
      force: false,
    });
  });

  it("shows a refusal from the command", async () => {
    ENQUEUE = new Error("no headless engine in /engines/2026");
    show();

    await start();

    await screen.findByText(/no headless engine in/);
  });

  it("says a replay already in the queue is", async () => {
    ENQUEUE = "alreadyQueued";
    show();

    await start();

    await screen.findByText("This replay is already in the queue.");
  });

  it("says a replay that is already done is, and reads both stores again", async () => {
    ENQUEUE = "alreadyDone";
    show();
    called.length = 0;

    await start();

    await screen.findByText("This replay is already analysed and recorded.");
    expect(commands()).toContain("content_replay_analyses");
    expect(commands()).toContain("content_replay_tracks");
  });
});

/**
 * One run makes both, and a replay can still end up with one: tracks go when
 * the limit on disk space is reached, and an analysis can be deleted by itself.
 */
describe("a replay with only one of the two (#3962)", () => {
  it("offers to record a replay that is analysed and has no track, and replaces the analysis", async () => {
    seedReplayAnalysisForTests({ analyses: [stored()] });
    show();

    expect(region()).toContain("Analysed. 57 units made");
    expect(region()).toContain("Not recorded for rewind.");
    await start("Record this replay");

    expect(enqueued()).toMatchObject({ force: true });
  });

  it("offers to analyse a replay that is recorded and has no analysis", async () => {
    seedReplayTracksForTests([track()]);
    show();

    expect(region()).toContain("Recorded for rewind. The track takes 1.0 MB.");
    expect(region()).not.toContain("Analysed.");
    await start("Analyse this replay");

    expect(enqueued()).toMatchObject({ force: true });
  });

  it("offers one new run for a current analysis whose track is out of date", async () => {
    seedReplayAnalysisForTests({ analyses: [stored()] });
    seedReplayTracksForTests([track({ state: "stale" })]);
    show();

    expect(region()).toContain("The recorded track is out of date");
    await start("Analyse and record again");

    expect(enqueued()).toMatchObject({ force: true });
  });

  it("does not count the replay's own track against the limit when it is replaced", async () => {
    // Its 4 MB track is all that is stored, the limit is 5 MB and the new one
    // is about 2 MB.
    seedReplayTracksForTests(
      [track({ state: "stale", sizeBytes: 4 * MIB })],
      5 * MIB,
      [pastRun()],
    );
    show();

    const said = await openConfirmation("Analyse and record again");

    expect(said).not.toMatch(/removed|limit/);
  });

  it("offers nothing more once it has both", () => {
    seedReplayAnalysisForTests({ analyses: [stored()] });
    seedReplayTracksForTests([track()]);
    show();

    expect(region()).toContain("Analysed.");
    expect(region()).toContain("Recorded for rewind.");
    expect(
      screen.queryByRole("button", { name: /Analyse|Record|Try/ }),
    ).toBeNull();
  });

  it("says the run that made the analysis could not make the track, once", () => {
    seedReplayAnalysisForTests({
      analyses: [stored()],
      queue: {
        failures: [
          failure({
            reason: "thinFailed",
            message: "the recording is damaged",
          }),
        ],
      },
    });
    show();

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const said = screen.getByRole("alert").textContent;
    expect(said).toContain("The recording could not be made into a track.");
    expect(said).toContain("The recording is damaged. No track was made.");
    expect(region()).toContain("Analysed.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("says an earlier track is kept when the new one could not be made", () => {
    seedReplayTracksForTests([track()]);
    seedReplayAnalysisForTests({
      queue: { failures: [failure({ reason: "thinFailed", message: "bad" })] },
    });
    show();

    expect(screen.getByRole("alert").textContent).toContain(
      "Bad. The earlier track was kept.",
    );
  });
});

describe("a replay that cannot be analysed", () => {
  it("says a match that was quit cannot be, beside a disabled button", async () => {
    CHECK = {
      cannot: "noGameOver",
      gameId: null,
      matchSeconds: 0,
      headless: [],
    };
    show();

    await screen.findByText(/never recorded a game over/);
    expect(analyseButton()).toHaveProperty("disabled", true);
    fireEvent.click(analyseButton());
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(commands()).not.toContain("content_analysis_enqueue");
  });

  it("says an engine with no headless build cannot play it back", async () => {
    CHECK = { ...CHECK, headless: [] };
    show();

    await screen.findByText(
      "Engine 2026.07.01 has no headless build, which the playback needs.",
    );
    expect(analyseButton()).toHaveProperty("disabled", true);
  });

  it("names the engine, the game and the map that are not installed", async () => {
    show({ target: null, missingGame: true, missingMap: true });

    await screen.findByText(/Engine 2026.07.01 is not installed/);
    expect(screen.getByText("The game is not installed.")).toBeTruthy();
    expect(screen.getByText("The map is not installed.")).toBeTruthy();
    expect(analyseButton()).toHaveProperty("disabled", true);
  });

  it("gives a remix no analysis and no track, even its original's", async () => {
    CHECK = {
      cannot: "remix",
      gameId: null,
      matchSeconds: 0,
      headless: [],
    };
    seedReplayAnalysisForTests({ analyses: [stored()] });
    seedReplayTracksForTests([track()]);
    show({ info: { ...INFO, remixed: true } as DemoInfo });

    await screen.findByText(/This is a remix/);
    expect(screen.queryByText(/^Analysed\./)).toBeNull();
    expect(region()).not.toContain("Recorded for rewind");
    expect(analyseButton()).toHaveProperty("disabled", true);
  });
});

describe("a replay with something stored", () => {
  it("shows when it was analysed, with what, and the counts, and offers no second run", () => {
    seedReplayAnalysisForTests({ analyses: [stored()] });
    seedReplayTracksForTests([track()]);
    show();

    const text = region();
    expect(text).toContain("Analysed. 57 units made, 54 finished and 22 lost.");
    expect(text).toContain(
      "with Some Game 1.0 on engine 2026.07.01 (Headless)",
    );
    expect(text).toContain("in 25 seconds");
    expect(screen.queryByRole("button", { name: /Analyse/ })).toBeNull();
  });

  it("deletes the analysis by its game id and leaves the replay alone", async () => {
    seedReplayAnalysisForTests({ analyses: [stored()] });
    show();

    fireEvent.click(screen.getByRole("button", { name: "Delete analysis" }));
    const confirm = await screen.findAllByRole("button", {
      name: "Delete analysis",
    });
    fireEvent.click(confirm[confirm.length - 1]);

    await waitFor(() =>
      expect(commands()).toContain("content_replay_analysis_delete"),
    );
    expect(
      called.find((c) => c.command === "content_replay_analysis_delete")?.args,
    ).toEqual({ gameId: ID });
    expect(commands()).not.toContain("content_delete_replay");
    // The list is read again, and it is empty, so the page is back to the offer.
    await waitFor(() => expect(analyseButton()).toBeTruthy());
  });

  it("offers a new run for an analysis from an earlier logger, and asks for it by force", async () => {
    seedReplayAnalysisForTests({ analyses: [stored({ state: "outdated" })] });
    show();

    expect(
      screen.getByText(/made by an earlier version of coilbox/),
    ).toBeTruthy();
    await start("Analyse and record again");

    expect(enqueued()).toMatchObject({ force: true });
  });

  it("says a diverged playback did not reproduce the match, names the figures and the usual reason", async () => {
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          state: "diverged",
          outcome: "diverged",
          disagreements: [
            { figure: "winners", recorded: "0", observed: "1" },
            {
              figure: "unitsTeleported",
              team: 0,
              recorded: "1500",
              observed: "1750",
              difference: 250,
            },
          ],
        }),
      ],
    });
    show();

    // The statistic's name arrives with the metric registry.
    await screen.findByText(/Units beamed in for team 0/);
    const text = region();
    expect(text).toContain("did not reproduce the recorded match");
    expect(text).not.toContain(
      "is not exactly the one the match was played on",
    );
    expect(help()).toContain(
      "the installed game or engine is not exactly the one the match was played on",
    );
    expect(text).toContain(
      "Who won: the replay recorded 0, the playback gave 1.",
    );
    expect(text).not.toContain("units made");
    // The stored analysis is what says it, and it says it once.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(text).not.toContain("Not recorded for rewind");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("a replay in the queue", () => {
  it("shows the frame it has reached and cancels by job id", async () => {
    seedReplayAnalysisForTests({ queue: { running: job() } });
    show();

    expect(screen.getByText(/Frame 11,535 of 23,070/)).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "Playback progress" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(commands()).toContain("content_analysis_cancel"),
    );
    expect(
      called.find((c) => c.command === "content_analysis_cancel")?.args,
    ).toEqual({ id: 7 });
  });

  it("says how long it has been running", () => {
    seedReplayAnalysisForTests({
      queue: { running: job({ startedAtMs: Date.now() - 192_000 }) },
    });
    show();

    expect(screen.getByText(/Running for 3:1\d\./)).toBeTruthy();
  });

  it("reads the engine's output only once it is asked for, by job id", async () => {
    ENGINE_OUTPUT = ["[t=00:00:09.1][f=0000000] paused the demo"];
    seedReplayAnalysisForTests({ queue: { running: job() } });
    show();

    expect(commands()).not.toContain("content_analysis_engine_output");
    fireEvent.click(
      screen.getByRole("button", { name: "What the engine is saying" }),
    );

    expect(await screen.findByText(/paused the demo/)).toBeTruthy();
    expect(
      called.find((c) => c.command === "content_analysis_engine_output")?.args,
    ).toEqual({ id: 7 });
  });

  it("says so when the engine has written nothing", async () => {
    ENGINE_OUTPUT = [];
    seedReplayAnalysisForTests({ queue: { running: job() } });
    show();

    fireEvent.click(
      screen.getByRole("button", { name: "What the engine is saying" }),
    );

    expect(
      await screen.findByText("The engine has written nothing yet."),
    ).toBeTruthy();
  });

  it("draws no bar while the engine is still starting", () => {
    seedReplayAnalysisForTests({
      queue: { running: job({ phase: "starting", frame: 0 }) },
    });
    show();

    expect(screen.getByText(/Starting the engine/)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows the making of the track as a stage, and draws no bar for it", () => {
    seedReplayAnalysisForTests({
      queue: { running: job({ phase: "thinning" }) },
    });
    show();

    expect(
      screen.getByText(/Making the track from the recording/),
    ).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeTruthy();
  });

  it("shows one job, with one bar and one cancel, and no offer beside it", () => {
    seedReplayAnalysisForTests({
      queue: { running: job() },
      analyses: [stored()],
    });
    show();

    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /Analyse|Record|Try/ }),
    ).toBeNull();
  });

  it("stops offering the cancel once it has been asked for", () => {
    seedReplayAnalysisForTests({
      queue: { running: job({ cancelling: true }) },
    });
    show();

    expect(screen.getByText(/Stopping/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("says how many are ahead of a queued one", () => {
    const other = {
      id: 3,
      gameId: "b".repeat(32),
      name: "b.sdfz",
      replayPath: "/b",
    };
    const mine = {
      id: 4,
      gameId: ID,
      name: "match.sdfz",
      replayPath: PATH,
    };
    seedReplayAnalysisForTests({
      queue: {
        running: job({ gameId: "c".repeat(32) }),
        queued: [other, mine],
      },
    });
    show();

    expect(screen.getByText("Queued, with 1 replay ahead of it.")).toBeTruthy();
  });

  it("says it is waiting for the game when one is running", () => {
    const mine = {
      id: 4,
      gameId: ID,
      name: "match.sdfz",
      replayPath: PATH,
    };
    seedReplayAnalysisForTests({
      queue: { queued: [mine], waitingForGame: true },
    });
    show();

    expect(
      screen.getByText("Queued. It starts when the game you are playing ends."),
    ).toBeTruthy();
  });
});

describe("a run that failed", () => {
  it("says a run that took too long was not a divergence, and stored nothing", () => {
    seedReplayAnalysisForTests({
      queue: {
        failures: [
          {
            gameId: ID,
            name: "match.sdfz",
            reason: "tookTooLong",
            message: "the playback did not finish in the time allowed",
            limitSeconds: 1069,
            logExcerpt: [],
          },
        ],
      },
    });
    show();

    const text = screen.getByRole("alert").textContent;
    expect(text).toContain("The playback took too long and was stopped.");
    expect(text).toContain("It was allowed 18 minutes");
    expect(text).toContain("Nothing was stored.");
    expect(text).not.toMatch(/did not reproduce/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the engine's last lines behind a disclosure", () => {
    seedReplayAnalysisForTests({
      queue: {
        failures: [
          {
            gameId: ID,
            name: "match.sdfz",
            reason: "engineFailed",
            message:
              "the engine exited with status 3 before the replay logger loaded",
            logExcerpt: ["GAME-section missing"],
          },
        ],
      },
    });
    show();

    expect(screen.queryByText("GAME-section missing")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "What the engine said" }),
    );
    expect(screen.getByText("GAME-section missing")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "The engine exited with status 3 before the replay logger loaded.",
    );
  });
});

describe("a distribution that hides analytics.run", () => {
  beforeEach(() => {
    HIDE = ["analytics.run"];
  });

  it("shows nothing at all for a replay with nothing stored", () => {
    const { container } = show();
    expect(container.textContent).toBe("");
    expect(commands()).toEqual([]);
  });

  it("still shows a track that exists, with no way to make an analysis", () => {
    seedReplayTracksForTests([track()]);
    show();

    expect(region()).toContain("Recorded for rewind.");
    expect(
      screen.queryByRole("button", { name: /Analyse|Record|Try/ }),
    ).toBeNull();
  });

  it("still shows a stored analysis, with no way to run another", () => {
    seedReplayAnalysisForTests({ analyses: [stored({ state: "outdated" })] });
    show();

    expect(screen.getByText(/^Analysed\./)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Analyse|Try again/ }),
    ).toBeNull();
    expect(commands()).not.toContain("content_analysis_check");
  });

  it("shows no running job and no cancel", () => {
    seedReplayAnalysisForTests({
      queue: { running: job() },
      analyses: [stored()],
    });
    show();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByText(/^Analysed\./)).toBeTruthy();
  });
});

describe("a replay whose engine is not installed (#3869)", () => {
  const OLD = { path: "/engines/2025.06.19", version: "2025.06.19" };
  const NEW = {
    path: "/engines/2026.07.04-46-g04f42e2 macos_integration",
    version: "2026.07.04-46-g04f42e2 macos_integration",
  };
  const NO_HEADLESS = { path: "/engines/2027.01.01", version: "2027.01.01" };

  function withEngines(headless: { path: string }[] = [OLD, NEW]) {
    ENGINES = [OLD, NEW, NO_HEADLESS];
    CHECK = {
      ...CHECK,
      headless: [TARGET.enginePath, ...headless.map((e) => e.path)],
    };
  }

  it("says which engine recorded it, which will be used, and when the result is kept", async () => {
    withEngines();
    show({ target: null });

    await screen.findByRole("button", {
      name: "Analyse and record with 2026.07.04-46-g04f42e2 macos_integration",
    });
    expect(region()).toContain(
      "This replay was recorded on engine 2026.07.01, which is not installed.",
    );
    expect(region()).toContain(
      "The analysis will use engine 2026.07.04-46-g04f42e2 macos_integration instead.",
    );
    expect(region()).not.toContain("The result is kept only if");
    expect(region()).not.toContain("often computes a different match");
    const said = help();
    expect(said).toContain(
      "The result is kept only if the playback matches the recorded match",
    );
    expect(said).toContain("often computes a different match");
    expect(said).toContain(
      "who won, how long it lasted and every team's final totals",
    );
    // No odds are quoted.
    expect(region()).not.toMatch(/usually|likely to work|%/);
  });

  it("offers only engines that can run headless, newest first", async () => {
    withEngines();
    show({ target: null });
    await screen.findByRole("button", { name: /^Analyse and record with/ });

    fireEvent.click(screen.getByRole("combobox", { name: "Engine to use" }));
    const options = (await screen.findAllByRole("option")).map(
      (o) => o.textContent,
    );
    expect(options).toEqual([NEW.version, OLD.version]);
  });

  it("runs nothing until the button is pressed, then asks for the chosen engine and its folder", async () => {
    withEngines();
    show({ target: null });
    await screen.findByRole("button", { name: /^Analyse and record with/ });
    expect(enqueued()).toBeUndefined();

    await start(/^Analyse and record with/);

    expect(enqueued()).toEqual({
      replayPath: PATH,
      enginePath: NEW.path,
      dataDir: "/data",
      game: undefined,
      force: false,
    });
  });

  it("says so when engines are installed and none can run headless", async () => {
    withEngines([]);
    show({ target: null });

    await screen.findByText(/none of the engines that are installed can run/);
    expect(analyseButton()).toHaveProperty("disabled", true);
  });

  it("offers the download for a missing map in its own place, and no run", async () => {
    withEngines();
    show({
      missingMap: true,
      downloads: <button type="button">Download map</button>,
    });

    await screen.findByText("The map is not installed.");
    expect(screen.getByRole("button", { name: "Download map" })).toBeTruthy();
    expect(analyseButton()).toHaveProperty("disabled", true);
    expect(commands()).not.toContain("content_analysis_enqueue");
  });

  it("shows no download offer when nothing is in the way", async () => {
    show({ downloads: <button type="button">Download map</button> });
    await waitFor(() =>
      expect(analyseButton()).toHaveProperty("disabled", false),
    );
    expect(screen.queryByRole("button", { name: "Download map" })).toBeNull();
  });

  it("depends on another installed version of the game, and says so", async () => {
    withEngines();
    const games = [
      { name: "Some Game 0.9" },
      { name: "Some Game 1.2" },
    ] as unknown as GameItem[];
    show({
      info: { ...INFO, gameType: "Some Game 1.0" } as DemoInfo,
      target: null,
      missingGame: true,
      installedGames: games,
    });

    await screen.findByRole("button", { name: /^Analyse and record with/ });
    expect(region()).toContain(
      "The game this replay was recorded on, Some Game 1.0, is not installed. The analysis will use Some Game 1.2, another version of it.",
    );
    await start(/^Analyse and record with/);
    expect(enqueued()).toMatchObject({ game: "Some Game 1.2" });
  });

  it("does not offer an engine again that did not reproduce the match, until it is asked for", async () => {
    withEngines();
    const attempt = (engine: string) => ({
      engine,
      game: "Some Game 1.0",
      analysedAtMs: 1,
      disagreements: [],
    });
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          state: "diverged",
          outcome: "diverged",
          engine: NEW.version,
          attempts: [attempt(NEW.version)],
        }),
      ],
    });
    show({ target: null });

    // The untried engine is the one picked.
    await screen.findByRole("button", {
      name: "Try with 2025.06.19",
    });
    expect(region()).toContain(
      `Already tried, and did not reproduce the match: ${NEW.version}.`,
    );
  });

  it("leaves the choice to the person when every engine has been tried", async () => {
    withEngines();
    const attempt = (engine: string) => ({
      engine,
      game: "Some Game 1.0",
      analysedAtMs: 1,
      disagreements: [],
    });
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          state: "diverged",
          outcome: "diverged",
          attempts: [attempt(NEW.version), attempt(OLD.version)],
        }),
      ],
    });
    show({ target: null });

    await screen.findByText(/Every installed engine has been tried/);
    expect(screen.getByRole("button", { name: "Try again" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("offers nothing new when the recorded engine is installed", async () => {
    withEngines();
    show();
    await waitFor(() =>
      expect(analyseButton()).toHaveProperty("disabled", false),
    );
    expect(region()).not.toContain("which is not installed");
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("a stored analysis made with another engine (#3869)", () => {
  it("says a different engine was used, and that the events are kept because the match matched", () => {
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          engine: "2026.07.04-46-g04f42e2",
          recordedEngine: "2025.06.21",
          engineDiffers: true,
          gameDiffers: false,
        }),
      ],
    });
    show();

    expect(region()).toContain(
      "It used engine 2026.07.04-46-g04f42e2, and the replay was recorded on engine 2025.06.21.",
    );
    expect(region()).toContain(
      "The playback still matched the recorded match exactly, so the events are kept.",
    );
  });

  it("names a different engine as the likely reason a run did not reproduce", () => {
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          state: "diverged",
          outcome: "diverged",
          engine: "2026.07.04-46-g04f42e2",
          recordedEngine: "2025.06.21",
          engineDiffers: true,
          disagreements: [
            {
              figure: "winners",
              recorded: "0",
              observed: "1",
            },
          ],
        }),
      ],
    });
    show({ target: null });

    expect(region()).toContain("A different engine is the likely reason.");
    expect(region()).toContain("the replay recorded 0, the playback gave 1.");
  });

  it("says nothing about a different engine for a file written before it was recorded", () => {
    seedReplayAnalysisForTests({
      analyses: [stored({ engineDiffers: null, gameDiffers: null })],
    });
    show();

    expect(region()).not.toMatch(/It used engine|different engine|same engine/);
  });

  it("lists every engine a match has been tried on", () => {
    seedReplayAnalysisForTests({
      analyses: [
        stored({
          state: "diverged",
          outcome: "diverged",
          attempts: [
            {
              engine: "2026.07.01",
              game: "G 1",
              analysedAtMs: 1,
              disagreements: [],
            },
            {
              engine: "2026.07.04",
              game: "G 1",
              analysedAtMs: 2,
              disagreements: [],
            },
          ],
        }),
      ],
    });
    show({ target: null });

    expect(region()).toContain(
      "Tried so far, and none reproduced the match: engine 2026.07.01 with G 1, engine 2026.07.04 with G 1.",
    );
  });
});

describe("a distribution that hides analytics.run (#3869)", () => {
  it("offers no other engine and does not ask which engines there are", () => {
    HIDE = ["analytics.run"];
    ENGINES = [{ path: "/engines/2025.06.19", version: "2025.06.19" }];
    seedReplayAnalysisForTests({ analyses: [stored()] });
    show({ target: null });

    expect(commands()).not.toContain("content_state_load");
    expect(commands()).not.toContain("content_analysis_check");
    expect(screen.queryByRole("button", { name: /Analyse/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
