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

import { observeOaAutoLaunch, observeOaBattle } from "../oaRun";
import { useOaHostLaunch } from "./useOaHostLaunch";

type Launch = {
  args: string[];
  onEvent: FakeChannel<OaEvent>;
  finish: (outcome: { exitCode: number | null; signal: number | null }) => void;
};

/** The launch the hook made, ending only when the test says OA exited. */
let launched: Launch[] = [];

const setIngame = vi.fn();

/** The lobby with the host out of the battle, which ends its memory. */
const GONE = { connected: true, battleId: null, hostIngame: false };

function mount(battleMap = "Host chooses in OA", autoStart = false) {
  return renderHook(() =>
    useOaHostLaunch({
      serverKey: "me@server:8200",
      battleId: 4021,
      battleMap,
      maxPlayers: 6,
      username: "abcdefghijklmnopqrst",
      setIngame,
      autoStart,
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
  // The once-per-battle memory is held outside the hook as well.
  act(() => observeOaAutoLaunch(() => GONE));
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

  it("raises the flag when the match starts without the battle room having been seen", async () => {
    const { result } = mount();
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));

    act(() =>
      launched[0].onEvent.onmessage({ kind: "match", change: "ended" }),
    );
    expect(setIngame).not.toHaveBeenCalled();

    act(() =>
      launched[0].onEvent.onmessage({ kind: "match", change: "started" }),
    );
    act(() => launched[0].onEvent.onmessage(screen("mp_battleroom")));
    expect(setIngame.mock.calls).toEqual([[true]]);

    await act(async () => launched[0].finish({ exitCode: 0, signal: null }));
    expect(setIngame.mock.calls).toEqual([[true], [false]]);
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

describe("starting by itself for a battle the host has just opened", () => {
  const STILL_OPEN = { connected: true, battleId: 4021, hostIngame: false };

  it("starts OA once with no click, with the same arguments as the button", async () => {
    mount("Host chooses in OA", true);
    await waitFor(() => expect(launched).toHaveLength(1));
    expect(launched[0].args.slice(0, 3)).toEqual([
      "--host",
      "--game-name",
      "CB4021",
    ]);
  });

  it("starts nothing when autoStart is off", async () => {
    mount();
    await act(async () => {});
    expect(bindings.playOaLaunch).not.toHaveBeenCalled();
  });

  it("does not start again when the host quits OA and comes back to the room", async () => {
    const first = mount("Host chooses in OA", true);
    await waitFor(() => expect(launched).toHaveLength(1));
    act(() => launched[0].onEvent.onmessage(screen("mp_battleroom")));
    await act(async () => launched[0].finish({ exitCode: 0, signal: null }));
    // OA's exit lowered the host's own flag, which says nothing of the battle.
    act(() => observeOaAutoLaunch(() => STILL_OPEN));
    first.unmount();

    const second = mount("Host chooses in OA", true);
    await act(async () => {});
    expect(launched).toHaveLength(1);
    expect(second.result.current.running).toBe(false);

    act(() => void second.result.current.start());
    await waitFor(() => expect(launched).toHaveLength(2));
  });

  it("starts again for the next battle once the first has closed", async () => {
    const first = mount("Host chooses in OA", true);
    await waitFor(() => expect(launched).toHaveLength(1));
    await act(async () => launched[0].finish({ exitCode: 0, signal: null }));
    act(() => observeOaAutoLaunch(() => STILL_OPEN));
    act(() => observeOaAutoLaunch(() => GONE));
    first.unmount();

    mount("Host chooses in OA", true);
    await waitFor(() => expect(launched).toHaveLength(2));
  });

  it("waits for a program to be set, and spends nothing until then", async () => {
    program.value = null;
    const { rerender } = mount("Host chooses in OA", true);
    await act(async () => {});
    expect(bindings.playOaLaunch).not.toHaveBeenCalled();
    program.value = OA;
    rerender();
    await waitFor(() => expect(launched).toHaveLength(1));
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

describe("the run ends when the lobby shows the player left the battle", () => {
  const IN = { connected: true, battleId: 4021 };
  const OUT = { connected: true, battleId: null };
  const DROPPED = { connected: false, battleId: 4021 };

  async function running() {
    const { result } = mount();
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));
    return result;
  }

  it("ends OA when a connected session shows the host left, or the battle closed", async () => {
    await running();
    act(() => observeOaBattle(() => IN));
    expect(bindings.playOaCancel).not.toHaveBeenCalled();
    act(() => observeOaBattle(() => OUT));
    expect(bindings.playOaCancel).toHaveBeenCalledTimes(1);
  });

  it("ends OA when the host is moved to another battle", async () => {
    await running();
    act(() => observeOaBattle(() => ({ connected: true, battleId: 77 })));
    expect(bindings.playOaCancel).toHaveBeenCalledTimes(1);
  });

  it("leaves OA running through a dropped connection", async () => {
    await running();
    act(() => observeOaBattle(() => IN));
    act(() => observeOaBattle(() => DROPPED));
    // The mirror can lose the battle before anything reconnects.
    act(() => observeOaBattle(() => ({ connected: false, battleId: null })));
    expect(bindings.playOaCancel).not.toHaveBeenCalled();
  });

  it("leaves OA running when the connection is gone", async () => {
    await running();
    act(() => observeOaBattle(() => IN));
    act(() => observeOaBattle(() => null));
    act(() => observeOaBattle(() => OUT));
    expect(bindings.playOaCancel).not.toHaveBeenCalled();
  });

  it("leaves OA running after a reconnect that comes back with no battle", async () => {
    await running();
    act(() => observeOaBattle(() => IN));
    act(() => observeOaBattle(() => DROPPED));
    act(() => observeOaBattle(() => OUT));
    act(() => observeOaBattle(() => OUT));
    expect(bindings.playOaCancel).not.toHaveBeenCalled();
  });

  it("ends OA when the host leaves the battle after rejoining it on the new session", async () => {
    await running();
    act(() => observeOaBattle(() => DROPPED));
    act(() => observeOaBattle(() => OUT));
    act(() => observeOaBattle(() => IN));
    act(() => observeOaBattle(() => OUT));
    expect(bindings.playOaCancel).toHaveBeenCalledTimes(1);
  });

  it("looks at the connection the battle is on", async () => {
    await running();
    const asked: string[] = [];
    act(() =>
      observeOaBattle((serverKey) => {
        asked.push(serverKey);
        return IN;
      }),
    );
    expect(asked).toEqual(["me@server:8200"]);
  });

  it("does nothing while no OA runs", () => {
    observeOaBattle(() => OUT);
    expect(bindings.playOaCancel).not.toHaveBeenCalled();
  });
});

describe("what is undone when OA ends", () => {
  it("lets a failing undo leave the run ended, so OA can start again", async () => {
    setIngame.mockImplementation((ingame: boolean) => {
      if (!ingame) throw new Error("the connection is gone");
    });
    const { result } = mount();
    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(1));
    act(() => launched[0].onEvent.onmessage(screen("mp_battleroom")));

    await act(async () => launched[0].finish({ exitCode: 0, signal: null }));
    expect(result.current.running).toBe(false);

    act(() => void result.current.start());
    await waitFor(() => expect(launched).toHaveLength(2));
  });
});
