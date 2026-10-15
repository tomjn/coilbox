// @vitest-environment happy-dom

/**
 * Watch with rewind on the replay page (#3803): what the button does in each
 * state of the replay's track, and that one confirmation leads to the engine
 * opening on the playback game.
 *
 * The real button, the real analysis and track stores, and the plugin commands
 * replaced. happy-dom does no layout, so nothing here says how it looks.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EMPTY_QUEUE: ReplayAnalysisQueue = {
  running: null,
  queued: [],
  waitingForGame: false,
  failures: [],
  stored: 0,
  tracks: 0,
};

const ID = "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
const PATH = "/replays/match.sdfz";

/** What each command was handed, in order. */
const called: { command: string; args: unknown }[] = [];
let CHECK: { cannot: string | null; headless: string[] };
/** What `content_analysis_enqueue` answers. */
let ENQUEUE: { outcome: string; queue: typeof EMPTY_QUEUE };
/** The tracks and analyses "on disk", which a refresh reads. */
let DISK_TRACKS: { gameId: string; state: string; sizeBytes: number }[] = [];
let DISK_ANALYSES: unknown[] = [];

const LAUNCH = vi.fn();
const LAUNCH_PLAIN = vi.fn();
let RUNNING = false;

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
          return { state: { roots: [] } };
        case "content_analysis_enqueue":
          return ENQUEUE;
        case "content_replay_analyses":
          return { analyses: DISK_ANALYSES };
        case "content_replay_tracks":
          return {
            tracks: DISK_TRACKS.map((t) => ({ ...t, lastWatchedMs: 1 })),
            totalBytes: 0,
            defaultBudgetBytes: null,
            recordingCosts: [],
          };
        default:
          return {};
      }
    },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

vi.mock("../../../play/PlayProvider", () => ({
  usePlay: () => ({
    running: RUNNING,
    launchReplay: LAUNCH_PLAIN,
    launchReplayPlayback: LAUNCH,
  }),
}));
vi.mock("../../../play/LaunchContentProvider", () => ({
  useLaunchContent: () => ({ ensureContent: async () => ({ ready: true }) }),
}));
vi.mock("../../../play/config", () => ({
  useReplayTarget: () => ({
    resolved: {
      matched: true,
      target: {
        enginePath: "/engines/2026",
        executable: "/engines/2026/spring",
        dataDir: "/data",
        engineVersion: "2026.07.01",
      },
    },
  }),
}));
vi.mock("../../replayUserState", () => ({
  useReplayUserState: () => ({ setWatched: () => {} }),
}));

import type {
  DemoInfo,
  ReplayAnalysisFailure,
  ReplayAnalysisQueue,
  ReplayAnalysisRunningJob,
} from "../../bindings";
import {
  resetReplayAnalysisForTests,
  seedReplayAnalysisForTests,
} from "../../replayAnalysis";
import {
  resetReplayTracksForTests,
  seedReplayTracksForTests,
} from "../../replayTracks";
import { WatchWithRewindButton } from "./WatchWithRewindButton";

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

const job = (): ReplayAnalysisRunningJob => ({
  id: 7,
  gameId: ID,
  name: "match.sdfz",
  replayPath: PATH,
  matchSeconds: 769,
  startedAtMs: 0,
  phase: "playing",
  frame: 100,
  lastFrame: 23070,
  cancelling: false,
});
const RUNNING_QUEUE = { ...EMPTY_QUEUE, running: job() };

const track = (state: "current" | "stale") => ({
  gameId: ID,
  state,
  sizeBytes: 1024 * 1024,
  lastWatchedMs: 1,
});

const failure = (): ReplayAnalysisFailure => ({
  gameId: ID,
  name: "match.sdfz",
  reason: "engineFailed",
  message: "the engine exited with status 1",
  logExcerpt: [],
});

function diverged() {
  return { gameId: ID, state: "diverged", disagreements: [] };
}

/** Put tracks where the store and a refresh from disk both find them. */
function setTracks(list: ReturnType<typeof track>[]) {
  DISK_TRACKS = list;
  seedReplayTracksForTests(list);
}

function show(
  props: Partial<Parameters<typeof WatchWithRewindButton>[0]> = {},
) {
  return render(
    <WatchWithRewindButton
      replayPath={PATH}
      info={INFO}
      watch={{ kind: "recorded" }}
      dependencyBlock={null}
      playbackBlock={null}
      missingGame={false}
      missingMap={false}
      {...props}
    />,
  );
}

const rewind = () => screen.getByRole("button", { name: /Watch with rewind/ });
const commands = () => called.map((c) => c.command);
const enqueued = () =>
  called.filter((c) => c.command === "content_analysis_enqueue");

/** Press the button and wait for the answer to the readiness check. */
async function openOffer() {
  await waitFor(() => expect(rewind().hasAttribute("disabled")).toBe(false));
  fireEvent.click(rewind());
}

beforeEach(() => {
  called.length = 0;
  CHECK = { cannot: null, headless: ["/engines/2026"] };
  ENQUEUE = { outcome: "queued", queue: RUNNING_QUEUE };
  DISK_TRACKS = [];
  DISK_ANALYSES = [];
  RUNNING = false;
  LAUNCH.mockReset().mockResolvedValue({ exitCode: 0 });
  LAUNCH_PLAIN.mockReset().mockResolvedValue({ exitCode: 0 });
  seedReplayAnalysisForTests({});
  setTracks([]);
});

afterEach(() => {
  cleanup();
  resetReplayAnalysisForTests();
  resetReplayTracksForTests();
});

describe("Watch with rewind", () => {
  it("launches the playback game at once when the track is current", async () => {
    setTracks([track("current")]);
    show();
    fireEvent.click(rewind());
    await waitFor(() => expect(LAUNCH).toHaveBeenCalledTimes(1));
    expect(LAUNCH).toHaveBeenCalledWith({
      replayPath: PATH,
      executable: "/engines/2026/spring",
      dataDir: "/data",
      game: undefined,
    });
    expect(commands()).not.toContain("content_analysis_enqueue");
    expect(LAUNCH_PLAIN).not.toHaveBeenCalled();
  });

  it("states the cost, records after one confirmation and then launches", async () => {
    show();
    await openOffer();
    // Nothing runs until the person confirms.
    expect(enqueued()).toHaveLength(0);
    expect(screen.getByText(/^Time:/)).toBeTruthy();
    expect(screen.getByText(/^Track size:/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(enqueued()).toHaveLength(1));
    expect(enqueued()[0].args).toMatchObject({
      replayPath: PATH,
      enginePath: "/engines/2026",
      dataDir: "/data",
      force: false,
    });
    // Recording: the engine has not opened and there is no second click.
    expect(LAUNCH).not.toHaveBeenCalled();
    await waitFor(() => expect(rewind().hasAttribute("disabled")).toBe(true));

    // The recording finishes: the track is on disk and the job has gone.
    DISK_TRACKS = [track("current")];
    act(() => seedReplayAnalysisForTests({ queue: EMPTY_QUEUE }));
    await waitFor(() => expect(LAUNCH).toHaveBeenCalledTimes(1));
    expect(enqueued()).toHaveLength(1);
  });

  it("launches straight away when the run answers that it is already done", async () => {
    ENQUEUE = { outcome: "alreadyDone", queue: EMPTY_QUEUE };
    setTracks([track("stale")]);
    show();
    await openOffer();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(LAUNCH).toHaveBeenCalledTimes(1));
  });

  it("offers to record again when the track is out of date, and replaces it", async () => {
    setTracks([track("stale")]);
    show();
    await openOffer();
    expect(screen.getByText(/out of date/i)).toBeTruthy();
    expect(LAUNCH).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(enqueued()).toHaveLength(1));
    expect(enqueued()[0].args).toMatchObject({ force: true });
  });

  it("says the playback diverged and offers plain Watch", async () => {
    seedReplayAnalysisForTests({
      analyses: [diverged() as never],
    });
    DISK_ANALYSES = [diverged()];
    show();
    await openOffer();
    expect(screen.getByText(/did not reproduce this match/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    await waitFor(() => expect(LAUNCH_PLAIN).toHaveBeenCalledTimes(1));
    expect(LAUNCH).not.toHaveBeenCalled();
    expect(enqueued()).toHaveLength(0);
  });

  it("is unavailable while a game is running", async () => {
    RUNNING = true;
    setTracks([track("current")]);
    show();
    expect(rewind().hasAttribute("disabled")).toBe(true);
    expect(rewind().getAttribute("title")).toBe("A game is already running.");
  });

  it("is unavailable for a replay that cannot be recorded", async () => {
    CHECK = { cannot: "playbackGame", headless: [] };
    show();
    await waitFor(() =>
      expect(rewind().getAttribute("title")).toMatch(/playback game/),
    );
    expect(rewind().hasAttribute("disabled")).toBe(true);
  });

  it("shows a failed recording and offers to try again", async () => {
    seedReplayAnalysisForTests({
      queue: { ...EMPTY_QUEUE, failures: [failure()] },
    });
    show();
    expect(
      await screen.findByText("The engine stopped before the match ended."),
    ).toBeTruthy();
    await openOffer();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("does not launch when the recording fails", async () => {
    show();
    await openOffer();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(enqueued()).toHaveLength(1));
    act(() =>
      seedReplayAnalysisForTests({
        queue: { ...EMPTY_QUEUE, failures: [failure()] },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("The engine stopped before the match ended."),
      ).toBeTruthy(),
    );
    expect(LAUNCH).not.toHaveBeenCalled();
  });

  it("does not launch when the recording is cancelled", async () => {
    show();
    await openOffer();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(enqueued()).toHaveLength(1));
    // The job leaves the queue, no failure, and no track on disk.
    act(() => seedReplayAnalysisForTests({ queue: EMPTY_QUEUE }));
    await waitFor(() => expect(rewind().hasAttribute("disabled")).toBe(false));
    expect(LAUNCH).not.toHaveBeenCalled();
  });

  it("does not launch when the page was left during the recording", async () => {
    const view = show();
    await openOffer();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(enqueued()).toHaveLength(1));
    view.unmount();
    DISK_TRACKS = [track("current")];
    act(() => seedReplayTracksForTests([track("current")]));
    act(() => seedReplayAnalysisForTests({ queue: EMPTY_QUEUE }));
    await new Promise((r) => setTimeout(r, 20));
    expect(LAUNCH).not.toHaveBeenCalled();
  });

  it("does not open over a game that started during the recording", async () => {
    const view = show();
    await openOffer();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(enqueued()).toHaveLength(1));
    RUNNING = true;
    view.rerender(
      <WatchWithRewindButton
        replayPath={PATH}
        info={INFO}
        watch={{ kind: "recorded" }}
        dependencyBlock={null}
        playbackBlock={null}
        missingGame={false}
        missingMap={false}
      />,
    );
    DISK_TRACKS = [track("current")];
    act(() => seedReplayAnalysisForTests({ queue: EMPTY_QUEUE }));
    await waitFor(() =>
      expect(screen.getByText(/A game is running/)).toBeTruthy(),
    );
    expect(LAUNCH).not.toHaveBeenCalled();
  });
});
