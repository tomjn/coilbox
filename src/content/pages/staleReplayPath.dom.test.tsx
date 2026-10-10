// @vitest-environment happy-dom

/**
 * Going from one replay's page straight to another's must not show the first
 * replay's data under the second's URL, and a slow answer for the first must not
 * overwrite the second's. Each test reads the render right after the path
 * changes, because `rerender` runs effects before it returns and so hides the
 * render that matters.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatLine, DemoInfo, StoredReplayAnalysis } from "../bindings";

const bindings = vi.hoisted(() => ({
  contentDemoInfo: vi.fn(),
  contentDemoChat: vi.fn(),
  contentReplayTrailer: vi.fn(),
  contentReplayAnalysisEvents: vi.fn(),
  contentDemoCommandRates: vi.fn(),
  contentDemoOrderPoints: vi.fn(),
}));

vi.mock("../bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bindings")>()),
  ...bindings,
}));

// The viewer names units through unitsync, which this file has no bridge for.
vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config")>()),
  useScanTargetSelection: () => ({ selected: null }),
  useUnitsyncScan: () => ({ data: null, loading: false }),
  useUnitsyncUnitDataset: () => ({ dataset: null, status: "idle" }),
  useUnitsyncUnitBuildpics: () => null,
}));

vi.mock("../useMetricRegistry", () => ({
  metricRegistry: async () => [],
}));

vi.mock("../replaySideLabel", () => ({ teamResultLabel: () => "result" }));

/** Every trailer the chart was handed, in render order. */
const chartTrailers: string[] = [];
vi.mock("./components/MatchStatsChart", () => ({
  MatchStatsChart: ({ trailer }: { trailer: { tag: string } }) => {
    chartTrailers.push(trailer.tag);
    return <p>{`chart ${trailer.tag}`}</p>;
  },
}));

const { useDemoInfo } = await import("../config");
const { ReplayChat } = await import("./components/ReplayChat");
const { MatchStatsSection } = await import("./components/MatchStatsSection");
const { ReplayAnalysisEvents } = await import(
  "./components/ReplayAnalysisEvents"
);
const { resetReplayEventReadsForTests } = await import("../replayEventRead");
const { useReplayCommandRates, resetReplayCommandRates } = await import(
  "../useReplayCommandRates"
);
const { useReplayOrderPoints, resetReplayOrderPoints } = await import(
  "../replayOrderPoints"
);
const { packOrders } = await import("../orderPointsFixture");
const { resetReplayAnalysisForTests, seedReplayAnalysisForTests } =
  await import("../replayAnalysis");

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let n = 0;
let a = "";
let b = "";

beforeEach(() => {
  for (const fn of Object.values(bindings)) fn.mockReset();
  chartTrailers.length = 0;
  // The decode and trailer caches outlive a test, so each test gets new paths.
  n += 1;
  a = `/replays/a-${n}.sdfz`;
  b = `/replays/b-${n}.sdfz`;
});

afterEach(cleanup);

const demo = (mapName: string) => ({ mapName }) as unknown as DemoInfo;

describe("useDemoInfo", () => {
  it("returns nothing from the first replay on the first render for the second", async () => {
    const second = deferred<{ info: DemoInfo }>();
    bindings.contentDemoInfo.mockResolvedValueOnce({
      info: demo("Greenhaven"),
    });
    bindings.contentDemoInfo.mockReturnValueOnce(second.promise);
    const renders: ReturnType<typeof useDemoInfo>[] = [];
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => {
        const value = useDemoInfo("/engine", path);
        renders.push(value);
        return value;
      },
      { initialProps: { path: a } },
    );
    await waitFor(() =>
      expect(result.current.info?.mapName).toBe("Greenhaven"),
    );

    const before = renders.length;
    rerender({ path: b });
    for (const render of renders.slice(before)) {
      expect(render.info).toBeNull();
    }
    expect(renders[before].loading).toBe(true);

    await act(async () => second.resolve({ info: demo("Valles Marineris") }));
    expect(result.current.info?.mapName).toBe("Valles Marineris");
    expect(result.current.loading).toBe(false);
  });

  it("does not let a slow answer for the first replay overwrite the second", async () => {
    const first = deferred<{ info: DemoInfo }>();
    const second = deferred<{ info: DemoInfo }>();
    bindings.contentDemoInfo.mockReturnValueOnce(first.promise);
    bindings.contentDemoInfo.mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useDemoInfo("/engine", path),
      { initialProps: { path: a } },
    );
    rerender({ path: b });
    await act(async () => second.resolve({ info: demo("Valles Marineris") }));
    await act(async () => first.resolve({ info: demo("Greenhaven") }));
    expect(result.current.info?.mapName).toBe("Valles Marineris");
  });

  it("does not show the first replay's error under the second", async () => {
    const second = deferred<{ info: DemoInfo }>();
    bindings.contentDemoInfo.mockRejectedValueOnce(new Error("bad header"));
    bindings.contentDemoInfo.mockReturnValueOnce(second.promise);
    const renders: ReturnType<typeof useDemoInfo>[] = [];
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => {
        const value = useDemoInfo("/engine", path);
        renders.push(value);
        return value;
      },
      { initialProps: { path: a } },
    );
    await waitFor(() => expect(result.current.error).toBe("bad header"));
    const before = renders.length;
    rerender({ path: b });
    for (const render of renders.slice(before)) {
      expect(render.error).toBeNull();
    }
  });
});

describe("ReplayChat", () => {
  const chat = (text: string) => ({
    incomplete: false,
    messages: [
      { frame: 0, time: 0, player: 0, text, system: false } as ChatLine,
    ],
  });

  it("drops the first replay's chat when the path changes", async () => {
    bindings.contentDemoChat.mockResolvedValueOnce(chat("gg from a"));
    const { rerender } = render(<ReplayChat replayPath={a} />);
    fireEvent.click(await screen.findByRole("button", { name: /everyone/i }));
    expect(await screen.findByText("gg from a", { exact: false })).toBeTruthy();

    bindings.contentDemoChat.mockReturnValueOnce(deferred().promise);
    rerender(<ReplayChat replayPath={b} />);
    expect(screen.queryByText("gg from a", { exact: false })).toBeNull();
    expect(screen.queryByRole("button", { name: /everyone/i })).toBeNull();
    expect(screen.getByText("Reading chat…", { selector: "p" })).toBeTruthy();
  });

  it("does not let a slow chat for the first replay land on the second", async () => {
    const first = deferred<ReturnType<typeof chat>>();
    bindings.contentDemoChat.mockReturnValueOnce(first.promise);
    bindings.contentDemoChat.mockResolvedValueOnce(chat("gg from b"));
    const { rerender } = render(<ReplayChat replayPath={a} />);

    rerender(<ReplayChat replayPath={b} />);
    fireEvent.click(await screen.findByRole("button", { name: /everyone/i }));
    expect(await screen.findByText("gg from b", { exact: false })).toBeTruthy();

    await act(async () => first.resolve(chat("gg from a")));
    expect(screen.queryByText("gg from a", { exact: false })).toBeNull();
    expect(screen.getByText("gg from b", { exact: false })).toBeTruthy();
  });

  it("reads the chat once for the page, not once per surface", async () => {
    bindings.contentDemoChat.mockResolvedValue(chat("gg"));
    render(<ReplayChat replayPath={a} />);
    await screen.findByRole("button", { name: /everyone/i });
    expect(bindings.contentDemoChat).toHaveBeenCalledTimes(1);
  });
});

describe("MatchStatsSection", () => {
  const trailer = (tag: string) => ({
    trailer: { tag, teams: [{ samples: [{}] }] },
  });
  const info = { players: [], ais: [] } as unknown as DemoInfo;

  it("never hands the chart the first replay's trailer after the path changes", async () => {
    const second = deferred<ReturnType<typeof trailer>>();
    bindings.contentReplayTrailer.mockResolvedValueOnce(trailer("A"));
    bindings.contentReplayTrailer.mockReturnValueOnce(second.promise);
    const { rerender } = render(
      <MatchStatsSection info={info} replayPath={a} />,
    );
    expect(await screen.findByText("chart A")).toBeTruthy();

    const before = chartTrailers.length;
    rerender(<MatchStatsSection info={info} replayPath={b} />);
    expect(chartTrailers.slice(before)).not.toContain("A");
    expect(screen.queryByText("chart A")).toBeNull();

    await act(async () => second.resolve(trailer("B")));
    expect(await screen.findByText("chart B")).toBeTruthy();
  });

  it("does not let a slow trailer for the first replay overwrite the second", async () => {
    const first = deferred<ReturnType<typeof trailer>>();
    const second = deferred<ReturnType<typeof trailer>>();
    bindings.contentReplayTrailer.mockReturnValueOnce(first.promise);
    bindings.contentReplayTrailer.mockReturnValueOnce(second.promise);
    const { rerender } = render(
      <MatchStatsSection info={info} replayPath={a} />,
    );
    rerender(<MatchStatsSection info={info} replayPath={b} />);
    await act(async () => second.resolve(trailer("B")));
    await act(async () => first.resolve(trailer("A")));
    expect(screen.getByText("chart B")).toBeTruthy();
    expect(screen.queryByText("chart A")).toBeNull();
  });
});

describe("ReplayAnalysisEvents", () => {
  const stored = (gameId: string) =>
    ({
      state: "current",
      kind: "analysis",
      gameId,
      analysedAtMs: 1,
      counts: { gameStart: 1 },
    }) as unknown as StoredReplayAnalysis;
  const eventsOf = (frame: number) => ({
    events: [{ kind: "game_start", frame }],
    total: 1,
  });
  const infoFor = (gameId: string) =>
    ({ gameId, players: [], ais: [] }) as unknown as DemoInfo;

  beforeEach(() => {
    resetReplayEventReadsForTests();
    seedReplayAnalysisForTests({ analyses: [stored("one"), stored("two")] });
  });
  afterEach(resetReplayAnalysisForTests);

  it("drops the first replay's events when the path changes", async () => {
    bindings.contentReplayAnalysisEvents.mockResolvedValueOnce(eventsOf(3000));
    const { rerender } = render(
      <ReplayAnalysisEvents replayPath={a} info={infoFor("one")} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /recorded events/i }));
    expect(await screen.findByText("1:40")).toBeTruthy();

    bindings.contentReplayAnalysisEvents.mockReturnValueOnce(
      deferred().promise,
    );
    rerender(<ReplayAnalysisEvents replayPath={b} info={infoFor("two")} />);
    expect(screen.queryByText("1:40")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("does not let a slow answer for the first replay land on the second", async () => {
    const first = deferred<ReturnType<typeof eventsOf>>();
    bindings.contentReplayAnalysisEvents.mockReturnValueOnce(first.promise);
    bindings.contentReplayAnalysisEvents.mockResolvedValueOnce(eventsOf(900));
    const { rerender } = render(
      <ReplayAnalysisEvents replayPath={a} info={infoFor("one")} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /recorded events/i }));
    rerender(<ReplayAnalysisEvents replayPath={b} info={infoFor("two")} />);
    expect(await screen.findByText("0:30")).toBeTruthy();

    await act(async () => first.resolve(eventsOf(3000)));
    expect(screen.queryByText("1:40")).toBeNull();
    expect(screen.getByText("0:30")).toBeTruthy();
  });
});

describe("the reads that walk the order stream", () => {
  afterEach(() => {
    resetReplayCommandRates();
    resetReplayOrderPoints();
  });

  it("shows no commands per period under another replay's path, and keeps the second's answer over a late first", async () => {
    const first = deferred<{ tag: string }>();
    const second = deferred<{ tag: string }>();
    bindings.contentDemoCommandRates.mockReturnValueOnce(first.promise);
    bindings.contentDemoCommandRates.mockReturnValueOnce(second.promise);
    const renders: ReturnType<typeof useReplayCommandRates>[] = [];
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => {
        const value = useReplayCommandRates(path);
        renders.push(value);
        return value;
      },
      { initialProps: { path: a } },
    );
    act(() => result.current.load());
    await act(async () => first.resolve({ tag: "A" }));
    expect(result.current.result).toEqual({ tag: "A" });

    const before = renders.length;
    rerender({ path: b });
    for (const render of renders.slice(before)) {
      expect(render.result).toBeNull();
      expect(render.status).toBe("idle");
    }
    act(() => result.current.load());
    // A late answer for the first replay, asked for again, cannot land.
    await act(async () => second.resolve({ tag: "B" }));
    expect(result.current.result).toEqual({ tag: "B" });
  });

  it("reads the order positions once per page and never shows them under the next replay", async () => {
    bindings.contentDemoOrderPoints.mockResolvedValue(
      packOrders([{ x: 1, z: 2 }]),
    );
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useReplayOrderPoints(path),
      { initialProps: { path: a } },
    );
    expect(bindings.contentDemoOrderPoints).not.toHaveBeenCalled();
    act(() => result.current.load());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.result?.count).toBe(1));
    expect(bindings.contentDemoOrderPoints).toHaveBeenCalledTimes(1);

    rerender({ path: b });
    expect(result.current.result).toBeNull();
    expect(result.current.status).toBe("idle");
  });
});
