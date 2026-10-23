// @vitest-environment happy-dom

/**
 * The background engine and game downloads. The queue and the content hooks are
 * stubbed, so each test reads as one rule from the spec's Engine and Games
 * sections.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GamesDecision } from "./relevance";

interface FakeItem {
  id: string;
  label: string;
  status: string;
  error: string | null;
}

let queueItems: FakeItem[] = [];
let nextId = 1;
const enqueue = vi.fn((input: { label: string }) => {
  const id = `q${nextId++}`;
  queueItems = [
    ...queueItems,
    { id, label: input.label, status: "active", error: null },
  ];
  return id;
});
const cancel = vi.fn();

vi.mock("@/downloads/DownloadQueueProvider", () => ({
  useDownloadQueue: () => ({
    enqueue,
    cancel,
    items: queueItems,
    settled: [],
  }),
}));

let setup = {
  loading: false,
  needsFolder: false,
  needsEngine: true,
  complete: false,
  missingRoot: undefined as { path: string } | undefined,
};
const refresh = vi.fn(async () => {});
vi.mock("@/content/config", () => ({
  useSetupStatus: () => ({ ...setup, refresh }),
}));

let bundled: { status: string } = { status: "none" };
vi.mock("@/content/BundledEngineSetup", () => ({
  useBundledEngine: () => ({ state: bundled, retry: () => {} }),
}));

let writePath: string | undefined = "/data";
const ensureWriteRoot = vi.fn();
vi.mock("@/downloads/config", () => ({
  useWriteRootPath: () => writePath,
  useDefaultWriteRoot: () => ensureWriteRoot,
}));

const contentCreateStandardRoot = vi.fn(async (_root: unknown) => ({
  state: {},
}));
vi.mock("@/content/bindings", () => ({
  contentCreateStandardRoot: (a: unknown) => contentCreateStandardRoot(a),
}));

const engineDownloadRequest = vi.fn();
vi.mock("@/content/engineDownloadRequest", () => ({
  engineDownloadRequest: (...a: unknown[]) => engineDownloadRequest(...a),
}));

const suggestionRequest = vi.fn();
vi.mock("@/content/pages/components/SuggestionsList", () => ({
  suggestionRequest: (...a: unknown[]) => suggestionRequest(...a),
}));

vi.mock("@/content/branding", () => ({ useGithubGameRepos: () => [] }));
vi.mock("@/downloads/gameRepos", () => ({
  GAME_REPOS: [],
  mergeGameRepos: () => [],
}));

const { useBackgroundDownloads } = await import("./useBackgroundDownloads");

const GAME = {
  id: "sf",
  title: "Splinter Faction",
  download: { kind: "rapid", tag: "sf:test" },
};
const AUTO: GamesDecision = { kind: "auto", game: GAME as never };

const onSettle = vi.fn();

function mount(args: { settled?: string[]; games?: GamesDecision | null }) {
  return renderHook(
    (p: { settled: string[]; games: GamesDecision | null }) =>
      useBackgroundDownloads({ ...p, onSettle }),
    {
      initialProps: { settled: args.settled ?? [], games: args.games ?? null },
      wrapper: StrictMode,
    },
  );
}

/** Let the async request building finish. */
const flush = () => act(async () => {});

beforeEach(() => {
  queueItems = [];
  nextId = 1;
  setup = {
    loading: false,
    needsFolder: false,
    needsEngine: true,
    complete: false,
    missingRoot: undefined,
  };
  bundled = { status: "none" };
  writePath = "/data";
  engineDownloadRequest.mockReset();
  engineDownloadRequest.mockResolvedValue({
    kind: "engineRecoil",
    label: "Engine 1",
    args: {},
  });
  suggestionRequest.mockReset();
  suggestionRequest.mockResolvedValue({
    kind: "rapid",
    label: "Game: Splinter Faction",
    args: {},
  });
  enqueue.mockClear();
  cancel.mockClear();
  onSettle.mockClear();
  contentCreateStandardRoot.mockClear();
  ensureWriteRoot.mockClear();
});

afterEach(cleanup);

// Games settle at once for anything but auto, so most engine tests pass
// `games: none` and filter on the engine call.
const NONE: GamesDecision = { kind: "none" };

it("queues the engine once when it is missing, even under StrictMode", async () => {
  const { rerender } = mount({ settled: ["game"], games: NONE });
  await flush();
  rerender({ settled: ["game"], games: NONE });
  await flush();
  expect(enqueue).toHaveBeenCalledTimes(1);
});

it("does not queue the engine while the bundled engine is copying", async () => {
  bundled = { status: "copying" };
  mount({ settled: ["game"], games: NONE });
  await flush();
  expect(enqueue).not.toHaveBeenCalled();
  expect(engineDownloadRequest).not.toHaveBeenCalled();
});

it("does not queue the engine when it is settled", async () => {
  mount({ settled: ["engine", "game"], games: NONE });
  await flush();
  expect(enqueue).not.toHaveBeenCalled();
});

it("settles the engine at once when one is found", async () => {
  setup = { ...setup, needsEngine: false, complete: true };
  mount({ settled: ["game"], games: NONE });
  await flush();
  expect(onSettle).toHaveBeenCalledWith("engine");
  expect(enqueue).not.toHaveBeenCalled();
});

it("creates the standard folder before queueing the engine", async () => {
  setup = { ...setup, needsFolder: true, needsEngine: false };
  const { rerender } = mount({ settled: ["game"], games: NONE });
  await flush();
  expect(contentCreateStandardRoot).toHaveBeenCalledTimes(1);
  expect(ensureWriteRoot).toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
  setup = { ...setup, needsFolder: false, needsEngine: true };
  rerender({ settled: ["game"], games: NONE });
  await flush();
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(contentCreateStandardRoot).toHaveBeenCalledTimes(1);
});

it("settles the engine when the platform has no release", async () => {
  engineDownloadRequest.mockResolvedValue(null);
  mount({ settled: ["game"], games: NONE });
  await flush();
  expect(onSettle).toHaveBeenCalledWith("engine");
  expect(enqueue).not.toHaveBeenCalled();
});

it("settles the engine when queueing throws", async () => {
  engineDownloadRequest.mockRejectedValue(new Error("offline"));
  mount({ settled: ["game"], games: NONE });
  await flush();
  expect(onSettle).toHaveBeenCalledWith("engine");
});

it("settles the engine when its item turns canceled", async () => {
  const { rerender } = mount({ settled: ["game"], games: NONE });
  await flush();
  expect(onSettle).not.toHaveBeenCalled();
  queueItems = queueItems.map((i) => ({ ...i, status: "canceled" }));
  rerender({ settled: ["game"], games: NONE });
  await flush();
  expect(onSettle).toHaveBeenCalledWith("engine");
  expect(onSettle).toHaveBeenCalledTimes(1);
});

it("returns only the items it queued", async () => {
  queueItems = [{ id: "other", label: "Map", status: "active", error: null }];
  const { result } = mount({ settled: ["game"], games: NONE });
  await flush();
  expect(result.current.items.map((i) => i.label)).toEqual(["Engine 1"]);
});

it("queues the game for an auto decision", async () => {
  mount({ settled: ["engine"], games: AUTO });
  await flush();
  expect(suggestionRequest).toHaveBeenCalledTimes(1);
  expect(suggestionRequest.mock.calls[0][0]).toEqual(GAME.download);
  expect(suggestionRequest.mock.calls[0][1]).toBe("game");
  expect(suggestionRequest.mock.calls[0][3]).toBe("/data");
  expect(enqueue).toHaveBeenCalledTimes(1);
});

it("waits for a write path before queueing the game", async () => {
  writePath = undefined;
  const { rerender } = mount({ settled: ["engine"], games: AUTO });
  await flush();
  expect(enqueue).not.toHaveBeenCalled();
  writePath = "/data";
  rerender({ settled: ["engine"], games: AUTO });
  await flush();
  expect(enqueue).toHaveBeenCalledTimes(1);
});

it("settles the game at once for a pick decision", async () => {
  mount({
    settled: ["engine"],
    games: { kind: "pick", games: [GAME as never] },
  });
  await flush();
  expect(onSettle).toHaveBeenCalledWith("game");
  expect(enqueue).not.toHaveBeenCalled();
});

it("waits while the games decision is unknown", async () => {
  mount({ settled: ["engine"], games: null });
  await flush();
  expect(onSettle).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
});

it("retries by queueing the same request again, even once settled", async () => {
  const { result, rerender } = mount({ settled: ["game"], games: NONE });
  await flush();
  queueItems = queueItems.map((i) => ({
    ...i,
    status: "error",
    error: "boom",
  }));
  rerender({ settled: ["game"], games: NONE });
  await flush();
  expect(onSettle).toHaveBeenCalledWith("engine");
  rerender({ settled: ["engine", "game"], games: NONE });
  await act(async () => result.current.retry("q1"));
  expect(enqueue).toHaveBeenCalledTimes(2);
  expect(enqueue.mock.calls[1][0]).toEqual(enqueue.mock.calls[0][0]);
  rerender({ settled: ["engine", "game"], games: NONE });
  expect(result.current.items.map((i) => i.id)).toEqual(["q2"]);
  // The failure settled once. The retry does not settle it again.
  expect(onSettle).toHaveBeenCalledTimes(1);
});

it("cancels through the queue", async () => {
  const { result } = mount({ settled: ["game"], games: NONE });
  await flush();
  result.current.cancel("q1");
  expect(cancel).toHaveBeenCalledWith("q1");
});

it("shows a failed download with its error and a retry control", async () => {
  const { DownloadsPill } = await import("./DownloadsPill");
  const { fireEvent, render, screen } = await import("@testing-library/react");
  const onRetry = vi.fn();
  const onCancel = vi.fn();
  const item = (over: object) =>
    ({
      id: "a",
      label: "Engine 1",
      status: "active",
      error: null,
      progress: {
        percent: 41.6,
        phase: "downloading",
        downloadedBytes: 0,
        totalBytes: null,
        bytesPerSec: null,
      },
      rate: { stalled: false, bytesPerSec: null, secondsLeft: null },
      startedAt: null,
      ...over,
    }) as never;
  const view = render(
    <DownloadsPill items={[item({})]} onCancel={onCancel} onRetry={onRetry} />,
  );
  expect(screen.getByText("42%")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel Engine 1" }));
  expect(onCancel).toHaveBeenCalledWith("a");
  view.rerender(
    <DownloadsPill
      items={[item({ status: "error", error: "no route" })]}
      onCancel={onCancel}
      onRetry={onRetry}
    />,
  );
  expect(screen.getByText("no route")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry Engine 1" }));
  expect(onRetry).toHaveBeenCalledWith("a");
});
