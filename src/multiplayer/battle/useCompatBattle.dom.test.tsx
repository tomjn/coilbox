// @vitest-environment happy-dom
/**
 * Issue #4564. A joiner with the base game builds the mutator the host named,
 * at the host's manifest version, or is told to update when that version is
 * newer than any this coilbox carries. Nothing is built for a plain game, and
 * the player's own compatibility switch is never touched.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const build = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => vi.fn());
const info = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ Channel: class {} }));
vi.mock("../../compat/bindings", () => ({
  compatBuild: (args: unknown) => build(args),
  compatStatus: (args: unknown) => status(args),
}));
vi.mock("../../content/config", () => ({
  primeGameInfo: (...args: unknown[]) => info(...args),
}));

const { useCompatBattle } = await import("./useCompatBattle");

const xta = { name: "XTA 9.65", primaryArchive: { name: "xta-9.65.sd7" } };
const mutator = (n: number) => ({
  name: `XTA 9.65 (compat ${n})`,
  primaryArchive: { name: `coilbox-compat-xta-9.65-${n}.sdd` },
});

function setup(
  gameName: string,
  games: (typeof xta)[],
  rescan = vi.fn(async () => [...games, mutator(4)]),
) {
  return {
    rescan,
    ...renderHook(() =>
      useCompatBattle({
        gameName,
        games,
        enginePath: "/engine/spring",
        dataDir: "/data",
        contentKnown: true,
        rescan,
      }),
    ),
  };
}

beforeEach(() => {
  build.mockReset().mockResolvedValue({});
  status.mockReset().mockResolvedValue({ latest: 5, folder: null, stale: [] });
  info.mockReset().mockResolvedValue({ checksum: "abc" });
});

describe("useCompatBattle", () => {
  it("builds the host's manifest version when the base game is present and the mutator is not", async () => {
    const { result, rescan } = setup("XTA 9.65 (compat 4)", [xta]);

    expect(result.current.state.status).toBe("building");
    await waitFor(() => expect(rescan).toHaveBeenCalledWith());
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith({
      dataDir: "/data",
      enginePath: "/engine/spring",
      archiveName: "xta-9.65.sd7",
      gameName: "XTA 9.65",
      baseChecksum: "abc",
      manifestVersion: 4,
      onProgress: expect.anything(),
    });
  });

  it("carries the build's count to the card, and to a remount mid build", async () => {
    let finish: (v: unknown) => void = () => {};
    build.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = setup("XTA 9.65 (compat 4)", [xta]);
    await waitFor(() => expect(build).toHaveBeenCalledTimes(1));
    const channel = build.mock.calls[0][0].onProgress;

    act(() => channel.onmessage({ phase: "model", done: 40, total: 300 }));
    expect(first.result.current.state).toMatchObject({
      status: "building",
      progress: { done: 40, total: 300 },
    });

    first.unmount();
    const second = setup("XTA 9.65 (compat 4)", [xta]);
    expect(second.result.current.state).toMatchObject({
      status: "building",
      progress: { done: 40, total: 300 },
    });
    await act(async () => {});
    expect(build).toHaveBeenCalledTimes(1);

    act(() => channel.onmessage({ phase: "model", done: 41, total: 300 }));
    expect(second.result.current.state).toMatchObject({
      progress: { done: 41, total: 300 },
    });

    await act(async () => finish({}));
    await waitFor(() => expect(first.rescan).toHaveBeenCalled());
    expect(second.result.current.state).not.toHaveProperty("progress.done");
  });

  it("builds a version below the latest and says nothing about it", async () => {
    const { result } = setup(
      "XTA 9.65 (compat 1)",
      [xta],
      vi.fn(async () => [mutator(1)]),
    );
    await waitFor(() => expect(build).toHaveBeenCalled());
    expect(build.mock.calls[0][0].manifestVersion).toBe(1);
    expect(result.current.state.status).not.toBe("update");
  });

  it("asks for an update, and builds nothing, when the host's version is above the latest", async () => {
    const { result } = setup("XTA 9.65 (compat 6)", [xta]);
    await waitFor(() => expect(result.current.state.status).toBe("update"));
    expect(result.current.state).toEqual({
      status: "update",
      baseName: "XTA 9.65",
      version: 6,
      latest: 5,
    });
    expect(build).not.toHaveBeenCalled();
  });

  it("reads the latest version from the plugin rather than a number of its own", async () => {
    status.mockResolvedValue({ latest: 9, folder: null, stale: [] });
    setup("XTA 9.65 (compat 8)", [xta]);
    await waitFor(() => expect(build).toHaveBeenCalled());
    expect(build.mock.calls[0][0].manifestVersion).toBe(8);
  });

  it("does nothing for a game that is not a mutator", async () => {
    const { result } = setup("XTA 9.65", [xta]);
    expect(result.current.state.status).toBe("idle");
    await act(async () => {});
    expect(status).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it("does nothing when the base game is missing, which is the download's job", async () => {
    const { result } = setup("XTA 9.65 (compat 4)", []);
    expect(result.current.state.status).toBe("idle");
    await act(async () => {});
    expect(build).not.toHaveBeenCalled();
  });

  it("does nothing when the mutator is already installed", async () => {
    const { result } = setup("XTA 9.65 (compat 4)", [xta, mutator(4)] as never);
    expect(result.current.state.status).toBe("idle");
    await act(async () => {});
    expect(build).not.toHaveBeenCalled();
  });

  it("waits for the scan to settle before it builds", async () => {
    const rescan = vi.fn(async () => []);
    renderHook(() =>
      useCompatBattle({
        gameName: "XTA 9.65 (compat 4)",
        games: [xta],
        enginePath: "/engine/spring",
        dataDir: "/data",
        contentKnown: false,
        rescan,
      }),
    );
    await act(async () => {});
    expect(build).not.toHaveBeenCalled();
  });

  it("reports a failed build and builds again on retry", async () => {
    build.mockRejectedValueOnce(new Error("disk full"));
    const { result } = setup("XTA 9.65 (compat 4)", [xta]);
    await waitFor(() => expect(result.current.state.status).toBe("failed"));
    expect(result.current.state).toMatchObject({ error: "disk full" });

    act(() => result.current.retry());
    await waitFor(() => expect(build).toHaveBeenCalledTimes(2));
  });

  it("fails when the engine does not list the mutator it was handed", async () => {
    const { result } = setup(
      "XTA 9.65 (compat 4)",
      [xta],
      vi.fn(async () => [xta]),
    );
    await waitFor(() => expect(result.current.state.status).toBe("failed"));
  });
});
