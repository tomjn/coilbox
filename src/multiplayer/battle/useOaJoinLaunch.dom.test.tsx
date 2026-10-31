// @vitest-environment happy-dom

/**
 * What a player's client does to join an Open Annihilation battle (issue
 * #4947): it starts OA with the host's address, the cut name and the room name,
 * follows OA's status stream with the in game flag, and shows a refusal.
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OaEvent } from "../../play/bindings";

const OA = {
  path: "/oa/open-annihilation",
  version: "Open Annihilation 0.8.10",
};

const { FakeChannel } = vi.hoisted(() => ({
  FakeChannel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));
type FakeChannel<T> = { onmessage: (event: T) => void };
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  Channel: FakeChannel,
}));

const bindings = vi.hoisted(() => ({
  playOaLaunch: vi.fn(),
  playOaCancel: vi.fn(),
}));
vi.mock("../../play/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../play/bindings")>()),
  ...bindings,
}));

const program = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../openAnnihilation", () => ({
  useOpenAnnihilation: () => [program.value],
}));

import { useOaJoinLaunch } from "./useOaJoinLaunch";

type Launch = {
  args: string[];
  onEvent: FakeChannel<OaEvent>;
  finish: (outcome: { exitCode: number | null; signal: number | null }) => void;
};

/** The launch the hook made, ending only when the test says OA exited. */
let launched: Launch[] = [];

const setIngame = vi.fn();

function mount(hostIp = "203.0.113.9") {
  return renderHook(() =>
    useOaJoinLaunch({
      serverKey: "server",
      battleId: 4021,
      hostIp,
      hostPort: "8452",
      username: "abcdefghijklmnopqrst",
      setIngame,
    }),
  );
}

beforeEach(() => {
  launched = [];
  program.value = OA;
  setIngame.mockReset();
  bindings.playOaCancel.mockReset().mockResolvedValue({ cancelled: true });
  bindings.playOaLaunch.mockReset().mockImplementation(
    (a: { args: string[]; onEvent: FakeChannel<OaEvent> }) =>
      new Promise((resolve) => {
        launched.push({ args: a.args, onEvent: a.onEvent, finish: resolve });
      }),
  );
});
afterEach(async () => {
  cleanup();
  // The run is held outside the hook, so one a test left up would block the next.
  await act(async () => {
    for (const l of launched) l.finish({ exitCode: 0, signal: null });
  });
});

const started: OaEvent = { kind: "match", change: "started" };

describe("joining an Open Annihilation battle", () => {
  it("joins the host's address with the cut name and the battle's room name", async () => {
    const { result } = mount();
    act(() => void result.current.join());
    await waitFor(() => expect(launched).toHaveLength(1));
    expect(bindings.playOaLaunch.mock.calls[0][0].executable).toBe(OA.path);
    expect(launched[0].args).toEqual([
      "--join",
      "203.0.113.9",
      "--player-name",
      "abcdefghijklmnop",
      "--game-name",
      "CB4021",
    ]);
    expect(result.current.running).toBe(true);
  });

  it("sets the in game flag when the match starts, once, and clears it on exit", async () => {
    const { result } = mount();
    act(() => void result.current.join());
    await waitFor(() => expect(launched).toHaveLength(1));

    act(() =>
      launched[0].onEvent.onmessage({ kind: "screen", name: "mp_battleroom" }),
    );
    expect(setIngame).not.toHaveBeenCalled();

    act(() => launched[0].onEvent.onmessage(started));
    act(() => launched[0].onEvent.onmessage(started));
    expect(setIngame.mock.calls).toEqual([[true]]);

    await act(async () => launched[0].finish({ exitCode: 0, signal: null }));
    expect(setIngame.mock.calls).toEqual([[true], [false]]);
    expect(result.current.running).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("leaves the flag alone when the match never started", async () => {
    const { result } = mount();
    act(() => void result.current.join());
    await waitFor(() => expect(launched).toHaveLength(1));
    await act(async () => launched[0].finish({ exitCode: 0, signal: null }));
    expect(setIngame).not.toHaveBeenCalled();
  });

  it("shows OA's own line when it refuses before it says hello", async () => {
    bindings.playOaLaunch.mockRejectedValue(
      new Error("--player-name: longer than 16 characters"),
    );
    const { result } = mount();
    await act(async () => result.current.join());
    expect(result.current.error).toContain("--player-name");
    expect(result.current.running).toBe(false);
  });

  it("says OA refused when the refusal comes as an exit event after the stream began", async () => {
    const { result } = mount();
    act(() => void result.current.join());
    await waitFor(() => expect(launched).toHaveLength(1));
    act(() =>
      launched[0].onEvent.onmessage({ kind: "exit", reason: "refused" }),
    );
    await act(async () => launched[0].finish({ exitCode: 2, signal: null }));
    expect(result.current.error).toBe(
      "Open Annihilation refused to join this battle.",
    );
  });

  it("names the exit code when OA fails some other way", async () => {
    const { result } = mount();
    act(() => void result.current.join());
    await waitFor(() => expect(launched).toHaveLength(1));
    await act(async () => launched[0].finish({ exitCode: 3, signal: null }));
    expect(result.current.error).toBe("Open Annihilation exited with code 3.");
  });

  it("does not launch without a program path", async () => {
    program.value = null;
    const { result } = mount();
    expect(result.current.canRun).toBe(false);
    await act(async () => result.current.join());
    expect(bindings.playOaLaunch).not.toHaveBeenCalled();
  });

  it("does not launch at an address that cannot work", async () => {
    const { result } = mount("127.0.0.1");
    await act(async () => result.current.join());
    expect(bindings.playOaLaunch).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });

  it("starts one OA at a time", async () => {
    const { result } = mount();
    act(() => void result.current.join());
    await waitFor(() => expect(launched).toHaveLength(1));
    await act(async () => result.current.join());
    expect(launched).toHaveLength(1);
  });

  it("ends OA when the player leaves the battle", async () => {
    const { result } = mount();
    act(() => void result.current.join());
    await waitFor(() => expect(launched).toHaveLength(1));
    act(() => result.current.cancel());
    expect(bindings.playOaCancel).toHaveBeenCalledTimes(1);
  });
});
