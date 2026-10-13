// @vitest-environment happy-dom

/**
 * What the replay page says about recording a replay for rewind, in each state,
 * and what its buttons reach (#3788).
 *
 * The real section and the real frontend stores, with the plugin commands
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
/** What `content_recording_enqueue` answers, or throws when it is an Error. */
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
        case "content_recording_enqueue":
          if (ENQUEUE instanceof Error) throw ENQUEUE;
          return { outcome: ENQUEUE, queue: EMPTY_QUEUE };
        case "content_replay_analyses":
          return { analyses: [] };
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
  RecordingCost,
  ReplayAnalysisFailure,
  ReplayAnalysisRunningJob,
  StoredReplayTrack,
} from "../../bindings";
import {
  resetReplayAnalysisForTests,
  seedReplayAnalysisForTests,
} from "../../replayAnalysis";
import {
  resetReplayTracksForTests,
  seedReplayTracksForTests,
} from "../../replayTracks";
import { ReplayRecordingSection } from "./ReplayRecordingSection";

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

const track = (over: Partial<StoredReplayTrack> = {}): StoredReplayTrack => ({
  gameId: ID,
  state: "current",
  sizeBytes: MIB,
  lastWatchedMs: 1,
  ...over,
});

/** A past recording of a match as long as INFO's: 23,070 frames in 3 minutes. */
const pastRecording = (over: Partial<RecordingCost> = {}): RecordingCost => ({
  gameId: OTHER,
  game: "Some Game 1.0",
  frames: 23_070,
  millis: 180_000,
  trackBytes: 2 * MIB,
  ...over,
});

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
    record: true,
    ...over,
  };
}

function failure(
  over: Partial<ReplayAnalysisFailure> = {},
): ReplayAnalysisFailure {
  return {
    gameId: ID,
    name: "match.sdfz",
    reason: "engineFailed",
    message: "the engine exited with code 1",
    logExcerpt: [],
    record: true,
    disagreements: [],
    ...over,
  };
}

function show(
  props: Partial<Parameters<typeof ReplayRecordingSection>[0]> = {},
) {
  return render(
    <ReplayRecordingSection
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

const commands = () => called.map((c) => c.command);
const region = () => screen.getByRole("region", { name: "Recording" });
const text = () => region().textContent ?? "";
const recordButton = (name = "Record this replay") =>
  screen.getByRole("button", { name });
const ready = (name = "Record this replay") =>
  waitFor(() => expect(recordButton(name)).toHaveProperty("disabled", false));
/** The confirmation, opened. */
async function openConfirmation(name = "Record this replay") {
  await ready(name);
  fireEvent.click(recordButton(name));
  return (await screen.findByRole("dialog")).textContent ?? "";
}

beforeEach(() => {
  called.length = 0;
  HIDE = [];
  ENQUEUE = "queued";
  CHECK = {
    cannot: null,
    gameId: ID,
    matchSeconds: 769,
    headless: [TARGET.enginePath],
  };
  resetReplayAnalysisForTests();
  seedReplayAnalysisForTests({});
  resetReplayTracksForTests();
  seedReplayTracksForTests([]);
});

afterEach(() => {
  cleanup();
});

describe("a replay that has not been recorded", () => {
  it("says so and offers the button", async () => {
    show();

    expect(text()).toContain("Not recorded");
    await ready();
  });

  it("says the game runs without a window, before anything starts", async () => {
    show();

    const said = await openConfirmation();

    expect(said).toContain("This runs the game without a window");
    expect(commands()).not.toContain("content_recording_enqueue");
  });

  it("estimates the time and size from recordings of this game on this computer, as an estimate", async () => {
    seedReplayTracksForTests([], null, [pastRecording()]);
    show();

    const said = await openConfirmation();

    expect(said).toContain("Time: about 3 minutes");
    expect(said).toContain("Size: about 2.0 MB");
    expect(said).toContain("Estimated from 1 earlier recording of this game");
  });

  it("scales the estimate to the replay's length", async () => {
    // Twice the frames of INFO took twice as long and came out twice as big.
    seedReplayTracksForTests([], null, [
      pastRecording({ frames: 46_140, millis: 360_000, trackBytes: 4 * MIB }),
    ]);
    show();

    const said = await openConfirmation();

    expect(said).toContain("Time: about 3 minutes");
    expect(said).toContain("Size: about 2.0 MB");
  });

  it("says the time and size are unknown when nothing has been recorded", async () => {
    show();

    const said = await openConfirmation();

    expect(said).toContain("Time: unknown");
    expect(said).toContain("Size: unknown");
    expect(said).not.toMatch(/about \d/);
  });

  it("does not estimate from recordings of other games", async () => {
    seedReplayTracksForTests([], null, [
      pastRecording({ game: "Another Game 3" }),
    ]);
    show();

    const said = await openConfirmation();

    expect(said).toContain("Time: unknown");
    expect(said).toContain("Size: unknown");
  });

  it("warns that older tracks will be removed when the new one will not fit the budget", async () => {
    // 2 MB is stored, the budget is 3 MB and the new track is about 2 MB.
    seedReplayTracksForTests(
      [track({ gameId: OTHER, sizeBytes: 2 * MIB })],
      3 * MIB,
      [pastRecording()],
    );
    show();

    const said = await openConfirmation();

    expect(said).toContain(
      "Older tracks will be removed to stay within the 3.0 MB limit",
    );
  });

  it("says nothing about the budget when the track fits", async () => {
    seedReplayTracksForTests([], 10 * MIB, [pastRecording()]);
    show();

    const said = await openConfirmation();

    expect(said).not.toContain("removed");
    expect(said).not.toContain("limit");
  });

  it("says nothing about the budget with no size estimate", async () => {
    seedReplayTracksForTests(
      [track({ gameId: OTHER, sizeBytes: 5 * MIB })],
      3 * MIB,
    );
    show();

    const said = await openConfirmation();

    expect(said).not.toContain("removed");
    expect(said).not.toContain("limit");
  });

  it("says a track larger than the whole budget keeps only itself", async () => {
    seedReplayTracksForTests([], MIB, [pastRecording()]);
    show();

    const said = await openConfirmation();

    expect(said).toContain("larger than the whole 1.0 MB limit");
  });

  it("starts nothing until the confirmation is answered", async () => {
    show();
    await openConfirmation();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(commands()).not.toContain("content_recording_enqueue");
  });

  it("asks for a recording with the engine and folder a replay launch would use", async () => {
    show();
    await openConfirmation();

    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(commands()).toContain("content_recording_enqueue"),
    );
    expect(
      called.find((c) => c.command === "content_recording_enqueue")?.args,
    ).toEqual({
      replayPath: PATH,
      enginePath: "/engines/2026",
      dataDir: "/data",
      force: false,
    });
  });

  it("shows a refusal from the command", async () => {
    ENQUEUE = new Error("no headless engine in /engines/2026");
    show();
    await openConfirmation();

    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    await screen.findByText(/no headless engine in/);
  });
});

describe("what asking for a recording came to", () => {
  async function ask() {
    show();
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() =>
      expect(commands()).toContain("content_recording_enqueue"),
    );
  }

  it("says nothing more for queued, because the job shows", async () => {
    await ask();
    expect(text()).not.toMatch(/already|waiting to be analysed/);
  });

  it("says a replay that was waiting as an analysis will be recorded too", async () => {
    ENQUEUE = "joined";
    await ask();
    await screen.findByText(/waiting to be analysed/);
  });

  it("says a replay already in the queue is", async () => {
    ENQUEUE = "alreadyQueued";
    await ask();
    await screen.findByText(/already in the queue/i);
  });

  it("says a replay already recorded is, and reads the tracks again", async () => {
    ENQUEUE = "alreadyRecorded";
    await ask();
    await screen.findByText(/already recorded/i);
    await waitFor(() => expect(commands()).toContain("content_replay_tracks"));
  });
});

describe("a replay being recorded", () => {
  it("shows the frame and a progress bar, and cancels the job by its id", async () => {
    seedReplayAnalysisForTests({ queue: { running: job() } });
    show();

    expect(text()).toContain("Recording the match");
    expect(text()).toContain("Frame 11,535 of 23,070");
    const bar = screen.getByRole("progressbar", {
      name: "Recording progress",
    });
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(screen.queryByRole("button", { name: /Record/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(commands()).toContain("content_analysis_cancel"),
    );
    expect(
      called.find((c) => c.command === "content_analysis_cancel")?.args,
    ).toEqual({ id: 7 });
  });

  it("names the stage before there is a frame, with no bar", () => {
    seedReplayAnalysisForTests({
      queue: { running: job({ phase: "loading", frame: 0 }) },
    });
    show();

    expect(text()).toContain("Loading the match");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows the thinning as a stage of its own, with no bar, and cancels it", async () => {
    seedReplayAnalysisForTests({
      queue: { running: job({ id: 9, phase: "thinning" }) },
    });
    show();

    expect(text()).toContain("Making the track");
    expect(text()).not.toContain("Frame");
    expect(screen.queryByRole("progressbar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(commands()).toContain("content_analysis_cancel"),
    );
    expect(
      called.find((c) => c.command === "content_analysis_cancel")?.args,
    ).toEqual({ id: 9 });
  });

  it("stops offering the cancel once it has been asked for", () => {
    seedReplayAnalysisForTests({
      queue: { running: job({ cancelling: true }) },
    });
    show();

    expect(text()).toContain("Stopping");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows where a queued recording stands, and cancels it", async () => {
    seedReplayAnalysisForTests({
      queue: {
        running: job({ gameId: OTHER, id: 3, record: false }),
        queued: [
          {
            id: 8,
            gameId: ID,
            name: "match.sdfz",
            replayPath: PATH,
            record: true,
          },
        ],
      },
    });
    show();

    expect(text()).toContain("Queued, with 1 job ahead of it");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(commands()).toContain("content_analysis_cancel"),
    );
    expect(
      called.find((c) => c.command === "content_analysis_cancel")?.args,
    ).toEqual({ id: 8 });
  });

  it("says a queued recording waits for the game that is being played", () => {
    seedReplayAnalysisForTests({
      queue: {
        waitingForGame: true,
        queued: [
          {
            id: 8,
            gameId: ID,
            name: "match.sdfz",
            replayPath: PATH,
            record: true,
          },
        ],
      },
    });
    show();

    expect(text()).toContain("It starts when the game you are playing ends");
  });

  it("is not the recording of a replay that is only being analysed", async () => {
    seedReplayAnalysisForTests({ queue: { running: job({ record: false }) } });
    show();

    expect(text()).toContain("Not recorded");
    await ready();
  });
});

describe("a replay with a track", () => {
  it("says it is recorded, with the size, and offers no second recording", () => {
    seedReplayTracksForTests([track({ sizeBytes: 3 * MIB })]);
    show();

    expect(text()).toContain("Recorded");
    expect(text()).toContain("3.0 MB");
    expect(screen.queryByRole("button", { name: /Record/ })).toBeNull();
  });

  it("says a stale track is out of date, and offers to record again by force", async () => {
    seedReplayTracksForTests([track({ state: "stale" })]);
    show();

    expect(text()).toContain("out of date");
    await openConfirmation("Record again");
    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(commands()).toContain("content_recording_enqueue"),
    );
    expect(
      called.find((c) => c.command === "content_recording_enqueue")?.args,
    ).toMatchObject({ force: true });
  });

  it("does not count the replay's own track against the budget when recording it again", async () => {
    // 3 MB stored of which 2 MB is this replay's, the budget 3 MB, the new
    // track about 2 MB: replacing the old one leaves 3 MB.
    seedReplayTracksForTests(
      [
        track({ state: "stale", sizeBytes: 2 * MIB }),
        track({ gameId: OTHER, sizeBytes: MIB }),
      ],
      3 * MIB,
      [pastRecording()],
    );
    show();

    const said = await openConfirmation("Record again");

    expect(said).not.toContain("removed");
  });
});

describe("a recording that ended without a track", () => {
  it("says the playback diverged, names the figures that disagreed, and dismisses it", async () => {
    seedReplayAnalysisForTests({
      queue: {
        failures: [
          failure({
            reason: "diverged",
            message: "the playback did not reproduce the recorded match",
            disagreements: [
              { figure: "winners", recorded: "0", observed: "1" },
              {
                figure: "unitsTeleported",
                team: 1,
                recorded: "4",
                observed: "9",
              },
            ],
          }),
        ],
      },
    });
    show();

    expect(text()).toContain("did not reproduce the match");
    expect(text()).toContain(
      "Who won: the replay recorded 0, the playback gave 1.",
    );
    await screen.findByText(
      /Units beamed in for team 1: the replay recorded 4/,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(commands()).toContain("content_analysis_dismiss"),
    );
    expect(
      called.find((c) => c.command === "content_analysis_dismiss")?.args,
    ).toEqual({ gameId: ID });
  });

  it("says a failed run failed and shows the end of the engine's log", async () => {
    seedReplayAnalysisForTests({
      queue: {
        failures: [
          failure({ logExcerpt: ["[f=0] loading", "[f=0] Fatal: no map"] }),
        ],
      },
    });
    show();

    expect(text()).toContain("The engine stopped before the match ended");
    expect(text()).toContain("The engine exited with code 1");
    fireEvent.click(
      screen.getByRole("button", { name: /What the engine said/ }),
    );
    expect(await screen.findByText(/Fatal: no map/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(commands()).toContain("content_analysis_dismiss"),
    );
  });

  it("offers to try again, and does not ask until it is pressed", async () => {
    seedReplayAnalysisForTests({ queue: { failures: [failure()] } });
    show();

    await ready("Try again");
    expect(commands()).not.toContain("content_recording_enqueue");
  });

  it("says an earlier track is kept when the thinning failed over one", () => {
    seedReplayTracksForTests([track()]);
    seedReplayAnalysisForTests({
      queue: {
        failures: [
          failure({ reason: "thinFailed", message: "the dump is damaged" }),
        ],
      },
    });
    show();

    expect(text()).toContain("could not be made into a track");
    expect(text()).toContain("earlier track");
  });

  it("is not the failure of an analysis that did not record", async () => {
    seedReplayAnalysisForTests({
      queue: { failures: [failure({ record: false })] },
    });
    show();

    expect(text()).toContain("Not recorded");
    await ready();
  });
});

describe("a replay that cannot be recorded", () => {
  it("names the engine that is not installed, beside a disabled button", async () => {
    show({ target: null });

    await screen.findByText(/Engine 2026.07.01 is not installed/);
    expect(recordButton()).toHaveProperty("disabled", true);
    fireEvent.click(recordButton());
    expect(commands()).not.toContain("content_recording_enqueue");
  });

  it("names the game that is not installed", async () => {
    show({ missingGame: true });

    await screen.findByText("The game is not installed.");
    expect(recordButton()).toHaveProperty("disabled", true);
  });

  it("names the map that is not installed and a dependency the game lacks", async () => {
    show({ missingMap: true, dependencyBlock: "It needs the Base archive." });

    await screen.findByText("The map is not installed.");
    expect(screen.getByText("It needs the Base archive.")).toBeTruthy();
    expect(recordButton()).toHaveProperty("disabled", true);
  });

  it("says an engine with no headless build cannot", async () => {
    CHECK = { ...CHECK, headless: [] };
    show();

    await screen.findByText(/has no headless build/);
    expect(recordButton()).toHaveProperty("disabled", true);
  });

  it("says a match that was quit cannot be recorded", async () => {
    CHECK = { ...CHECK, cannot: "noGameOver", gameId: null };
    show();

    await screen.findByText(/never recorded a game over/);
    expect(recordButton()).toHaveProperty("disabled", true);
  });

  it("gives a remix no track of its own, even its original's", async () => {
    CHECK = { ...CHECK, cannot: "remix", gameId: null };
    seedReplayTracksForTests([track()]);
    seedReplayAnalysisForTests({ queue: { running: job() } });
    show({ info: { ...INFO, remixed: true } as DemoInfo });

    await screen.findByText(/This is a remix/);
    expect(text()).not.toContain("Recorded");
    expect(text()).not.toContain("Recording the match");
    expect(recordButton()).toHaveProperty("disabled", true);
  });

  it("is not there when the distribution hides the run and nothing is recorded", () => {
    HIDE = ["analytics.run"];
    show();

    expect(screen.queryByRole("region", { name: "Recording" })).toBeNull();
    expect(commands()).not.toContain("content_analysis_check");
  });

  it("still shows a track that exists when the distribution hides the run, with no button", () => {
    HIDE = ["analytics.run"];
    seedReplayTracksForTests([track({ state: "stale" })]);
    show();

    expect(text()).toContain("out of date");
    expect(screen.queryByRole("button", { name: /Record/ })).toBeNull();
  });
});

describe("the page never starts a recording on its own", () => {
  const tracks: [string, StoredReplayTrack[]][] = [
    ["no track", []],
    ["a current track", [track()]],
    ["a stale track", [track({ state: "stale" })]],
  ];
  const jobs: [string, Parameters<typeof seedReplayAnalysisForTests>[0]][] = [
    ["no job", {}],
    [
      "a queued job",
      {
        queue: {
          queued: [
            { id: 8, gameId: ID, name: "m", replayPath: PATH, record: true },
          ],
        },
      },
    ],
    ["a recording job", { queue: { running: job() } }],
    ["a thinning job", { queue: { running: job({ phase: "thinning" }) } }],
    [
      "a diverged run",
      { queue: { failures: [failure({ reason: "diverged" })] } },
    ],
    ["a failed run", { queue: { failures: [failure()] } }],
  ];

  for (const [trackName, stored] of tracks) {
    for (const [jobName, queue] of jobs) {
      it(`asks for nothing with ${trackName} and ${jobName}`, async () => {
        seedReplayTracksForTests(stored, 10 * MIB, [pastRecording()]);
        seedReplayAnalysisForTests(queue);

        show();
        await waitFor(() =>
          expect(commands()).toContain("content_analysis_check"),
        );
        // Let everything the mount started settle.
        await new Promise((r) => setTimeout(r, 20));

        expect(commands()).not.toContain("content_recording_enqueue");
        expect(commands()).not.toContain("content_analysis_enqueue");
      });
    }
  }
});
