// @vitest-environment happy-dom

/**
 * What the host's Start does for an Open Annihilation battle (issue #4946): it
 * starts OA, raises the host's in game flag when OA's status stream reports its
 * battle room, and lowers it when OA exits.
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
  playOaMaps: vi.fn(),
}));
vi.mock("../../play/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../play/bindings")>()),
  ...bindings,
}));

const program = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../openAnnihilation", () => ({
  useOpenAnnihilation: () => [program.value],
}));

import { endOaRunUnlessIn } from "../oaRun";
import { useOaHostLaunch } from "./useOaHostLaunch";

type Launch = {
  args: string[];
  onEvent: FakeChannel<OaEvent>;
  finish: (outcome: { exitCode: number | null; signal: number | null }) => void;
};

/** The launch the hook made, ending only when the test says OA exited. */
let launched: Launch[] = [];

const setIngame = vi.fn();

function mount(battleMap = "Host chooses in OA") {
  return renderHook(() =>
    useOaHostLaunch({
      serverKey: "me@server:8200",
      battleId: 4021,
      battleMap,
      maxPlayers: 6,
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
  bindings.playOaMaps.mockReset().mockResolvedValue({
    maps: [{ shownName: "Shew Drop", key: "Comet Catcher" }],
  });
  bindings.playOaLaunch.mockReset().mockImplementation(
    (a: { args: string[]; onEvent: FakeChannel<OaEvent> }) =>
      new Promise((resolve) => {
        launched.push({ args: a.args, onEvent: a.onEvent, finish: resolve });
      }),
  );
});
afterEach(async () => {
  cleanup();
  // The run is held outside the hook, so a test that left OA running would
  // block the next one. Every launch ends here.
  await act(async () => {
    for (const l of launched) l.finish({ exitCode: 0, signal: null });
  });
});

const screen = (name: string): OaEvent => ({ kind: "screen", name });

describe("starting Open Annihilation for the host", () => {
  it("hosts a room named after the battle, with the name cut", async () => {
    const { result } = mount();
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));
    expect(launched[0].args).toEqual([
      "--host",
      "--game-name",
      "CB4021",
      "--player-name",
      "abcdefghijklmnop",
      "--player-limit",
      "6",
    ]);
    expect(result.current.running).toBe(true);
  });

  it("passes the key of the map the lobby shows", async () => {
    const { result } = mount("Shew Drop");
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));
    expect(launched[0].args.slice(-2)).toEqual(["--map", "Comet Catcher"]);
  });

  it("raises the in game flag on OA's battle room, once, and lowers it on exit", async () => {
    const { result } = mount();
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));

    act(() => launched[0].onEvent.onmessage(screen("main_menu")));
    act(() => launched[0].onEvent.onmessage(screen("mp_new_game")));
    expect(setIngame).not.toHaveBeenCalled();

    act(() => launched[0].onEvent.onmessage(screen("mp_battleroom")));
    act(() => launched[0].onEvent.onmessage(screen("mp_battleroom")));
    expect(setIngame.mock.calls).toEqual([[true]]);

    await act(async () => launched[0].finish({ exitCode: 0, signal: null }));
    expect(setIngame.mock.calls).toEqual([[true], [false]]);
    expect(result.current.running).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("leaves the flag alone when OA never reached its battle room", async () => {
    const { result } = mount();
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));
    await act(async () => launched[0].finish({ exitCode: 0, signal: null }));
    expect(setIngame).not.toHaveBeenCalled();
  });

  it("shows OA's own words when it refuses to start", async () => {
    bindings.playOaLaunch.mockRejectedValue(
      new Error("open-annihilation: --player-limit: 11 is above 10"),
    );
    const { result } = mount();
    await act(async () => result.current.start());
    expect(result.current.error).toContain("--player-limit");
    expect(result.current.running).toBe(false);
  });

  it("says so when no program is set", async () => {
    program.value = null;
    const { result } = mount();
    await act(async () => result.current.start());
    expect(bindings.playOaLaunch).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });

  it("starts one OA at a time", async () => {
    const { result } = mount();
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));
    await act(async () => result.current.start());
    expect(launched).toHaveLength(1);
  });

  it("ends OA when the host leaves the battle", async () => {
    const { result } = mount();
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));
    act(() => result.current.cancel());
    expect(bindings.playOaCancel).toHaveBeenCalledTimes(1);
  });
});

describe("the run outlives the battle room page", () => {
  it("is still running, and cancellable, when the page comes back", async () => {
    const first = mount();
    act(() => void first.result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));
    first.unmount();

    const second = mount();
    expect(second.result.current.running).toBe(true);
    act(() => second.result.current.cancel());
    expect(bindings.playOaCancel).toHaveBeenCalledTimes(1);
    expect(bindings.playOaCancel.mock.calls[0][0].runId).toBeTruthy();
  });

  it("does not start a second OA from the page that came back", async () => {
    const first = mount();
    act(() => void first.result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));
    first.unmount();

    const second = mount();
    await act(async () => second.result.current.start());
    expect(launched).toHaveLength(1);
  });

  it("keeps the in game flag right after the page that started OA is gone", async () => {
    const first = mount();
    act(() => void first.result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));
    first.unmount();

    act(() => launched[0].onEvent.onmessage(screen("mp_battleroom")));
    expect(setIngame.mock.calls).toEqual([[true]]);

    const second = mount();
    await act(async () => launched[0].finish({ exitCode: 0, signal: null }));
    expect(setIngame.mock.calls).toEqual([[true], [false]]);
    expect(second.result.current.running).toBe(false);
  });
});

describe("the run ends with its battle", () => {
  it("ends OA when the host is no longer in the battle it was started for", async () => {
    const { result } = mount();
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));

    act(() => endOaRunUnlessIn(() => 4021));
    expect(bindings.playOaCancel).not.toHaveBeenCalled();
    act(() => endOaRunUnlessIn(() => null));
    expect(bindings.playOaCancel).toHaveBeenCalledTimes(1);
  });

  it("looks at the connection the battle is on", async () => {
    const { result } = mount();
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));

    const asked: string[] = [];
    act(() =>
      endOaRunUnlessIn((serverKey) => {
        asked.push(serverKey);
        return 4021;
      }),
    );
    expect(asked).toEqual(["me@server:8200"]);
  });

  it("does nothing while no OA runs", () => {
    endOaRunUnlessIn(() => null);
    expect(bindings.playOaCancel).not.toHaveBeenCalled();
  });
});
