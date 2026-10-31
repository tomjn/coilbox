// @vitest-environment happy-dom

/**
 * What connects a lobby battle to Open Annihilation with no room page (issue
 * #4972): being in the battle starts OA, OA ending leaves the battle, and leaving
 * the battle ends OA. The connections are plain objects and OA is stood in for,
 * so a real engine or lobby has played no part in these.
 */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OaEvent } from "../play/bindings";

const OA = { path: "/oa/open-annihilation", version: "OA 0.8.10" };
const ME = "abcdefghijklmnopqrst";
const KEY = "server";

const { FakeChannel } = vi.hoisted(() => ({
  FakeChannel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  Channel: FakeChannel,
}));

const bindings = vi.hoisted(() => ({
  playOaLaunch: vi.fn(),
  playOaCancel: vi.fn(),
  playOaMaps: vi.fn(),
}));
vi.mock("../play/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../play/bindings")>()),
  ...bindings,
}));

const mocks = vi.hoisted(() => ({
  program: null as unknown,
  connections: {} as Record<string, unknown>,
  setIngame: vi.fn(),
  notify: vi.fn(),
  leaveBattle: vi.fn(),
}));
vi.mock("./openAnnihilation", () => ({
  useOpenAnnihilation: () => [mocks.program],
}));
vi.mock("./store", () => ({
  useMultiplayer: () => ({
    connections: mocks.connections,
    setIngame: mocks.setIngame,
  }),
  useProtocolServers: () => [],
}));
vi.mock("../notify/notify", () => ({ notify: mocks.notify }));
vi.mock("./battle/leaveBattle", () => ({ leaveBattle: mocks.leaveBattle }));

import { OaBattleKeeper } from "./OaBattleKeeper";
import {
  forgetOaPassword,
  holdOaHostPassword,
  holdOaJoinPassword,
} from "./oaPassword";

type Launch = {
  args: string[];
  onEvent: { onmessage: (event: OaEvent) => void };
  finish: (outcome: { exitCode: number | null; signal: number | null }) => void;
};
let launches: Launch[] = [];

function battle(over: Record<string, unknown> = {}) {
  return {
    id: 4021,
    host: "host",
    ip: "203.0.113.9",
    port: "8452",
    map: "Host chooses in OA",
    maxPlayers: 8,
    engine: "Open Annihilation",
    inProgress: false,
    ...over,
  };
}

/** A connection showing the player in `b`, or in no battle. */
function connection(
  b: Record<string, unknown> | null,
  { hostIngame = false, connected = true } = {},
) {
  return {
    live: connected,
    mirror: {
      connected,
      state: {
        myUsername: ME,
        currentBattle: b ? b.id : null,
        battles: b ? { [String(b.id)]: b } : {},
        users: { host: { status: { ingame: hostIngame } } },
      },
    },
  };
}

const keeper = <OaBattleKeeper />;

function show(c: unknown) {
  mocks.connections = { [KEY]: c };
  return render(keeper);
}

async function update(view: ReturnType<typeof show>, c?: unknown) {
  mocks.connections = c ? { [KEY]: c } : {};
  // A new element each time, as the provider's re-render is.
  await act(async () => view.rerender(<OaBattleKeeper />));
}

const finish = (exitCode: number | null = 0) =>
  act(async () => launches.at(-1)?.finish({ exitCode, signal: null }));

beforeEach(() => {
  forgetOaPassword();
  launches = [];
  mocks.program = OA;
  mocks.setIngame.mockReset();
  mocks.notify.mockReset().mockResolvedValue(undefined);
  mocks.leaveBattle.mockReset().mockResolvedValue(undefined);
  bindings.playOaCancel.mockReset().mockResolvedValue({ cancelled: true });
  bindings.playOaMaps.mockReset().mockResolvedValue({ maps: [] });
  bindings.playOaLaunch.mockReset().mockImplementation(
    (a: Launch) =>
      new Promise((resolve) => {
        launches.push({ args: a.args, onEvent: a.onEvent, finish: resolve });
      }),
  );
});
afterEach(async () => {
  cleanup();
  // The run is held outside the component, so one a test left up would block
  // the next.
  await act(async () => {
    for (const l of launches) l.finish({ exitCode: 0, signal: null });
  });
});

describe("hosting an Open Annihilation battle", () => {
  const hosted = () => battle({ host: ME, map: "Two Shores" });

  it("starts OA at once, with the host's arguments", async () => {
    bindings.playOaMaps.mockResolvedValue({
      maps: [{ key: "two_shores", shownName: "Two Shores" }],
    });
    show(connection(hosted()));
    await waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0].args).toEqual([
      "--host",
      "--game-name",
      "CB4021",
      "--player-name",
      "abcdefghijklmnop",
      "--player-limit",
      "8",
      "--map",
      "two_shores",
    ]);
  });

  it("raises the flag on the room screen, once, and lowers it on exit", async () => {
    show(connection(hosted()));
    await waitFor(() => expect(launches).toHaveLength(1));
    expect(mocks.setIngame).not.toHaveBeenCalled();
    const screen: OaEvent = { kind: "screen", name: "mp_battleroom" };
    act(() => launches[0].onEvent.onmessage(screen));
    act(() => launches[0].onEvent.onmessage(screen));
    expect(mocks.setIngame.mock.calls).toEqual([[true]]);
    await finish();
    expect(mocks.setIngame.mock.calls).toEqual([[true], [false]]);
  });

  it("leaves the battle when OA exits, which closes a host's battle", async () => {
    show(connection(hosted()));
    await waitFor(() => expect(launches).toHaveLength(1));
    await finish();
    expect(mocks.leaveBattle.mock.calls).toEqual([[KEY]]);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("does not start OA if the host left while the map list loaded", async () => {
    let answer: (r: { maps: never[] }) => void = () => {};
    bindings.playOaMaps.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const view = show(connection(hosted()));
    await update(view, connection(null));
    await act(async () => answer({ maps: [] }));
    expect(launches).toHaveLength(0);
  });
});

describe("joining an Open Annihilation battle", () => {
  it("waits, launching nothing, until the host is in game", async () => {
    const view = show(connection(battle()));
    await update(view, connection(battle()));
    expect(launches).toHaveLength(0);
    await update(view, connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0].args).toEqual([
      "--join",
      "203.0.113.9",
      "--player-name",
      "abcdefghijklmnop",
      "--game-name",
      "CB4021",
    ]);
    expect(bindings.playOaLaunch.mock.calls[0][0].executable).toBe(OA.path);
  });

  it("starts straight away for a player who arrives with the host in game", async () => {
    show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
  });

  it("raises the flag only when the match starts, and lowers it on exit", async () => {
    show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    act(() =>
      launches[0].onEvent.onmessage({ kind: "screen", name: "mp_battleroom" }),
    );
    expect(mocks.setIngame).not.toHaveBeenCalled();
    act(() =>
      launches[0].onEvent.onmessage({ kind: "match", change: "started" }),
    );
    expect(mocks.setIngame.mock.calls).toEqual([[true]]);
    await finish();
    expect(mocks.setIngame.mock.calls).toEqual([[true], [false]]);
  });

  it("leaves the battle when OA exits, and does not start it again before the leave lands", async () => {
    const view = show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    await finish();
    expect(mocks.leaveBattle.mock.calls).toEqual([[KEY]]);
    await update(view, connection(battle(), { hostIngame: true }));
    expect(launches).toHaveLength(1);
  });

  it("starts again when the player joins the battle again after leaving", async () => {
    const view = show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    await finish();
    await update(view, connection(null));
    await update(view, connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(2));
  });

  it("ends OA when the player leaves the battle, with no second leave", async () => {
    const view = show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    await update(view, connection(null));
    expect(bindings.playOaCancel).toHaveBeenCalledOnce();
    await act(async () => launches[0].finish({ exitCode: null, signal: null }));
    expect(mocks.leaveBattle).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("says so when the leave after OA exits fails", async () => {
    mocks.leaveBattle.mockRejectedValue(new Error("no route"));
    show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    await finish();
    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "You are still in the Open Annihilation battle",
          level: "error",
        }),
      ),
    );
  });
});

describe("a lobby drop", () => {
  it("leaves OA running, and sends nothing when OA exits with no battle to leave", async () => {
    const view = show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    await update(
      view,
      connection(battle(), { hostIngame: true, connected: false }),
    );
    expect(bindings.playOaCancel).not.toHaveBeenCalled();
    await finish();
    expect(mocks.leaveBattle).not.toHaveBeenCalled();
  });

  it("does not end OA when the connection comes back with no battle", async () => {
    const view = show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    await update(
      view,
      connection(battle(), { hostIngame: true, connected: false }),
    );
    await update(view, connection(null));
    expect(bindings.playOaCancel).not.toHaveBeenCalled();
  });

  it("does not start OA twice when the player rejoins the battle it runs for", async () => {
    const view = show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    await update(view);
    await update(view, connection(battle(), { hostIngame: true }));
    expect(launches).toHaveLength(1);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe("a failure", () => {
  const leftWith = (body: unknown) =>
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Left the Open Annihilation battle",
        body,
        level: "error",
      }),
    );

  it("notifies with OA's refusal before it said hello, and leaves", async () => {
    bindings.playOaLaunch.mockRejectedValue(
      new Error("open-annihilation: no game named CB4021 answered"),
    );
    show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(mocks.leaveBattle).toHaveBeenCalledOnce());
    leftWith(expect.stringContaining("no game named CB4021 answered"));
  });

  it("notifies with OA's own line when it refuses after its stream began", async () => {
    show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    act(() =>
      launches[0].onEvent.onmessage({
        kind: "exit",
        reason: "refused",
        message: "the room is full",
      }),
    );
    await finish(2);
    leftWith("the room is full");
    expect(mocks.leaveBattle).toHaveBeenCalledOnce();
  });

  it("says OA refused when the refusal carries no line", async () => {
    show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    act(() =>
      launches[0].onEvent.onmessage({ kind: "exit", reason: "refused" }),
    );
    await finish(2);
    leftWith("Open Annihilation refused to join this battle.");
  });

  it("names the exit code when OA fails some other way", async () => {
    show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    await finish(3);
    leftWith("Open Annihilation exited with code 3.");
  });

  it("notifies and leaves when OA is already running for another battle", async () => {
    const view = show(connection(battle(), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    await update(view);
    await update(view, connection(battle({ id: 4022 }), { hostIngame: true }));
    await waitFor(() => leftWith("Open Annihilation is already running."));
    expect(launches).toHaveLength(1);
    expect(mocks.leaveBattle.mock.calls).toEqual([[KEY]]);
  });

  it("notifies and leaves when a link joined a battle with no OA set", async () => {
    mocks.program = null;
    show(connection(battle()));
    await waitFor(() =>
      leftWith("Set where Open Annihilation is in Settings first."),
    );
    expect(mocks.leaveBattle.mock.calls).toEqual([[KEY]]);
    expect(launches).toHaveLength(0);
  });

  it("notifies and leaves at an address that cannot work", async () => {
    show(connection(battle({ ip: "127.0.0.1" }), { hostIngame: true }));
    await waitFor(() => expect(mocks.leaveBattle).toHaveBeenCalledOnce());
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(launches).toHaveLength(0);
  });
});

describe("a battle with a password", () => {
  const hosted = () => battle({ host: ME, passworded: true });

  it("gives the host's room the password", async () => {
    holdOaHostPassword(KEY, null, {
      engine: "Open Annihilation",
      key: "s3cret",
    });
    show(connection(hosted()));
    await waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0].args.slice(-2)).toEqual(["--game-password", "s3cret"]);
  });

  it("gives a joiner the key they typed, once the host is in game", async () => {
    holdOaJoinPassword(
      KEY,
      { id: 4021, engine: "Open Annihilation" },
      "s3cret",
    );
    const view = show(connection(battle({ passworded: true })));
    await update(
      view,
      connection(battle({ passworded: true }), { hostIngame: true }),
    );
    await waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0].args.slice(-2)).toEqual(["--game-password", "s3cret"]);
  });

  it("starts a joiner with no key, as OA's room is the one to refuse", async () => {
    show(connection(battle({ passworded: true }), { hostIngame: true }));
    await waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0].args).not.toContain("--game-password");
  });

  it("refuses to host when the password is gone, rather than open an unprotected room", async () => {
    show(connection(hosted()));
    await waitFor(() => expect(mocks.leaveBattle).toHaveBeenCalledOnce());
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Left the Open Annihilation battle",
        body: expect.stringContaining("password"),
        level: "error",
      }),
    );
    expect(bindings.playOaLaunch).not.toHaveBeenCalled();
    expect(bindings.playOaMaps).not.toHaveBeenCalled();
  });

  it("hosts a battle with no password without asking for one", async () => {
    show(connection(battle({ host: ME, passworded: false })));
    await waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0].args).not.toContain("--game-password");
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe("a Recoil battle", () => {
  it("starts nothing and leaves nothing", async () => {
    show(connection(battle({ engine: "spring" }), { hostIngame: true }));
    await act(async () => {});
    expect(bindings.playOaLaunch).not.toHaveBeenCalled();
    expect(mocks.leaveBattle).not.toHaveBeenCalled();
  });
});
