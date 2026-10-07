import { describe, expect, it } from "vitest";
import {
  type FollowAction,
  type FollowMemo,
  type FollowNow,
  FRESH_FOLLOW,
  followStep,
} from "./followStep";

const open = {
  passworded: false,
  locked: false,
  host: "amy",
  members: {},
  playerCount: null,
  maxPlayers: 8,
} as unknown as NonNullable<FollowNow["battle"]>;

function now(over: Partial<FollowNow> = {}): FollowNow {
  return {
    connected: true,
    ready: true,
    friend: true,
    playing: false,
    busy: false,
    target: null,
    mine: null,
    battle: null,
    running: false,
    ...over,
  };
}

/** Feed a run of states through and collect what each one called for. */
function run(steps: Partial<FollowNow>[], memo: FollowMemo = FRESH_FOLLOW) {
  const actions: FollowAction[] = [];
  for (const step of steps) {
    const out = followStep(memo, now(step));
    memo = out.memo;
    actions.push(out.action);
  }
  return actions;
}

const NONE = { kind: "none" };
const LEAVE = { kind: "leave" };

describe("followStep", () => {
  it("does nothing while the friend is in no battle", () => {
    expect(run([{}])).toEqual([NONE]);
  });

  it("joins the battle the friend is already in when the follow starts", () => {
    expect(run([{ target: 5, battle: open }])).toEqual([
      { kind: "join", id: 5 },
    ]);
  });

  it("joins once, however many times the state is seen again", () => {
    expect(
      run([
        { target: 5, battle: open },
        { target: 5, battle: open },
      ]),
    ).toEqual([{ kind: "join", id: 5 }, NONE]);
  });

  it("leaves when the friend leaves, and sends that once", () => {
    expect(
      run([
        { target: 5, battle: open },
        { target: 5, mine: 5, battle: open },
        { mine: 5 },
        { mine: 5 },
        {},
      ]),
    ).toEqual([{ kind: "join", id: 5 }, NONE, LEAVE, NONE, NONE]);
  });

  it("moves with a friend who goes from one battle to another", () => {
    expect(
      run([
        { target: 5, mine: 5, battle: open },
        { target: 7, mine: 5, battle: open },
        { target: 7, battle: open },
        { target: 7, mine: 7, battle: open },
      ]),
    ).toEqual([NONE, LEAVE, { kind: "join", id: 7 }, NONE]);
  });

  it("leaves a battle of the player's own to join the friend", () => {
    expect(
      run([
        { target: 5, mine: 9, battle: open },
        { target: 5, battle: open },
      ]),
    ).toEqual([LEAVE, { kind: "join", id: 5 }]);
  });

  it("leaves the player's own battle alone while the friend is in none", () => {
    expect(run([{ mine: 9 }])).toEqual([NONE]);
  });

  it("stops when the player leaves the friend's battle themselves", () => {
    expect(
      run([
        { target: 5, mine: 5, battle: open },
        { target: 5, battle: open },
      ]),
    ).toEqual([NONE, { kind: "stop", reason: "leftByHand" }]);
  });

  it("does not move a player who is in a running game, then catches up", () => {
    expect(
      run([
        { target: 5, mine: 5, battle: open, playing: true },
        { target: 7, mine: 5, battle: open, playing: true },
        { target: 7, mine: 5, battle: open },
      ]),
    ).toEqual([NONE, NONE, LEAVE]);
  });

  it("says once why a battle cannot be entered, and joins when it can", () => {
    const locked = { ...open, locked: true };
    expect(
      run([
        { target: 5, battle: locked },
        { target: 5, battle: locked },
        { target: 5, battle: open },
      ]),
    ).toEqual([
      { kind: "blocked", id: 5, reason: "locked" },
      NONE,
      { kind: "join", id: 5 },
    ]);
  });

  it("asks for a password instead of joining a passworded battle", () => {
    expect(run([{ target: 5, battle: { ...open, passworded: true } }])).toEqual(
      [{ kind: "blocked", id: 5, reason: "passworded" }],
    );
  });

  it("treats a full battle as blocked, unless it is running", () => {
    const full = { ...open, maxPlayers: 1 };
    expect(run([{ target: 5, battle: full }])).toEqual([
      { kind: "blocked", id: 5, reason: "full" },
    ]);
    expect(run([{ target: 5, battle: full, running: true }])).toEqual([
      { kind: "join", id: 5 },
    ]);
  });

  it("keeps the player's own battle when the friend's cannot be entered", () => {
    expect(
      run([{ target: 5, mine: 9, battle: { ...open, locked: true } }]),
    ).toEqual([{ kind: "blocked", id: 5, reason: "locked" }]);
  });

  it("waits for another lobby action to finish before joining", () => {
    expect(
      run([
        { target: 5, battle: open, busy: true },
        { target: 5, battle: open },
      ]),
    ).toEqual([NONE, { kind: "join", id: 5 }]);
  });

  it("waits for a battle the server has not described yet", () => {
    expect(run([{ target: 5 }])).toEqual([NONE]);
  });

  it("stops when the friend's server disconnects", () => {
    expect(run([{ connected: false }])).toEqual([
      { kind: "stop", reason: "disconnected" },
    ]);
  });

  it("stops when the person is no longer a friend", () => {
    expect(run([{ friend: false }])).toEqual([
      { kind: "stop", reason: "unfriended" },
    ]);
  });

  it("does not read an unloaded friend list as an unfriending", () => {
    expect(run([{ ready: false, friend: false }])).toEqual([NONE]);
  });

  it("keeps following a friend who goes offline, and rejoins them", () => {
    expect(
      run([
        { target: 5, mine: 5, battle: open },
        { mine: 5 },
        {},
        { target: 6, battle: open },
      ]),
    ).toEqual([NONE, LEAVE, NONE, { kind: "join", id: 6 }]);
  });
});
