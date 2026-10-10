// @vitest-environment happy-dom

/**
 * The topbar's view of the analysis queue, on any page (#1157): nothing when
 * there is nothing to say, and otherwise the jobs with a way to cancel each.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const called: { command: string; args: unknown }[] = [];
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      called.push({ command, args });
      return command === "content_replay_analyses" ? { analyses: [] } : {};
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

import AnalysisQueueBadge from "./AnalysisQueueBadge";
import {
  resetReplayAnalysisForTests,
  seedReplayAnalysisForTests,
} from "./replayAnalysis";

const RUNNING = {
  id: 1,
  gameId: "a".repeat(32),
  name: "first.sdfz",
  replayPath: "/replays/first.sdfz",
  matchSeconds: 100,
  startedAtMs: 0,
  phase: "playing" as const,
  frame: 1500,
  lastFrame: 3000,
  cancelling: false,
};
const QUEUED = [
  { id: 2, gameId: "b".repeat(32), name: "second.sdfz", replayPath: "/b" },
  { id: 3, gameId: "c".repeat(32), name: "third.sdfz", replayPath: "/c" },
];

beforeEach(() => {
  called.length = 0;
  HIDE = [];
  resetReplayAnalysisForTests();
  seedReplayAnalysisForTests({});
});

afterEach(() => {
  cleanup();
});

const open = () => fireEvent.click(screen.getByRole("button"));
const cancels = () =>
  called.filter((c) => c.command === "content_analysis_cancel");

describe("the topbar while analyses are queued", () => {
  it("takes no room when nothing is queued", () => {
    const { container } = render(<AnalysisQueueBadge />);
    expect(container.textContent).toBe("");
  });

  it("counts the running job and the ones waiting", () => {
    seedReplayAnalysisForTests({ queue: { running: RUNNING, queued: QUEUED } });
    render(<AnalysisQueueBadge />);
    expect(screen.getByRole("button").textContent).toBe("Analysing 3 replays");
  });

  it("lists each job, with the running one's frame", () => {
    seedReplayAnalysisForTests({ queue: { running: RUNNING, queued: QUEUED } });
    render(<AnalysisQueueBadge />);
    open();

    expect(screen.getByText("first.sdfz")).toBeTruthy();
    expect(screen.getByText("Frame 1,500 of 3,000")).toBeTruthy();
    expect(screen.getByText("second.sdfz")).toBeTruthy();
    expect(screen.getByText("third.sdfz")).toBeTruthy();
  });

  it("cancels one job by its id", async () => {
    seedReplayAnalysisForTests({ queue: { running: RUNNING, queued: QUEUED } });
    render(<AnalysisQueueBadge />);
    open();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Cancel the analysis of second.sdfz",
      }),
    );

    await waitFor(() => expect(cancels()).toHaveLength(1));
    expect(cancels()[0].args).toEqual({ id: 2 });
  });

  it("cancels everything with no id", async () => {
    seedReplayAnalysisForTests({ queue: { running: RUNNING, queued: QUEUED } });
    render(<AnalysisQueueBadge />);
    open();

    fireEvent.click(screen.getByRole("button", { name: "Cancel all" }));

    await waitFor(() => expect(cancels()).toHaveLength(1));
    expect(cancels()[0].args).toEqual({ id: undefined });
  });

  it("says the queue is paused while a game is running", () => {
    seedReplayAnalysisForTests({
      queue: { queued: QUEUED, waitingForGame: true },
    });
    render(<AnalysisQueueBadge />);

    expect(screen.getByRole("button").textContent).toBe("Analysis paused");
    open();
    expect(screen.getByText(/Paused while a game is running/)).toBeTruthy();
  });

  it("stays for a failed run until it is dismissed", async () => {
    seedReplayAnalysisForTests({
      queue: {
        failures: [
          {
            gameId: "d".repeat(32),
            name: "broken.sdfz",
            reason: "engineFailed",
            message: "the engine stopped",
            logExcerpt: [],
          },
        ],
      },
    });
    render(<AnalysisQueueBadge />);

    expect(screen.getByRole("button").textContent).toBe("1 analysis failed");
    open();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Dismiss the failed analysis of broken.sdfz",
      }),
    );

    await waitFor(() =>
      expect(called.map((c) => c.command)).toContain(
        "content_analysis_dismiss",
      ),
    );
  });

  it("shows nothing in a distribution that hides analytics.run", () => {
    HIDE = ["analytics.run"];
    seedReplayAnalysisForTests({ queue: { running: RUNNING, queued: QUEUED } });
    const { container } = render(<AnalysisQueueBadge />);
    expect(container.textContent).toBe("");
  });
});
