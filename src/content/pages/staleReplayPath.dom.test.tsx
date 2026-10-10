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
import type { ChatLine, DemoInfo } from "../bindings";

const bindings = vi.hoisted(() => ({
  contentDemoInfo: vi.fn(),
  contentDemoChat: vi.fn(),
  contentReplayTrailer: vi.fn(),
}));

vi.mock("../bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bindings")>()),
  ...bindings,
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
