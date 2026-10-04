import { describe, expect, it } from "vitest";
import { friendBattleAction } from "./friendBattleAction";

const open = {
  id: 7,
  passworded: false,
  locked: false,
  host: "hostie",
  members: { joiner: {} },
  playerCount: null,
  maxPlayers: 8,
};

const ready = { ready: true, busy: false, joinedId: null };

function act(
  over: {
    status?: "online" | "inBattle" | "ingame" | "offline" | "unknown";
    battle?: Partial<typeof open> | null;
    running?: boolean;
    session?: Partial<typeof ready>;
  } = {},
) {
  return friendBattleAction({
    status: over.status ?? "inBattle",
    battle: over.battle === null ? null : { ...open, ...over.battle },
    running: over.running ?? false,
    session: { ...ready, ...over.session },
  } as Parameters<typeof friendBattleAction>[0]);
}

describe("friendBattleAction", () => {
  it("offers Join for a friend in an open battle", () => {
    expect(act()).toEqual({
      kind: "join",
      label: "Join",
      disabled: false,
      reason: null,
      asksPassword: false,
    });
  });

  it("offers Watch for a friend in a running game", () => {
    const a = act({ status: "ingame", running: true });
    expect(a).toMatchObject({ kind: "watch", label: "Watch", disabled: false });
  });

  it("offers nothing when the friend is in no battle", () => {
    expect(act({ status: "online", battle: null })).toBeNull();
  });

  it("offers nothing for a friend on a server that is not connected", () => {
    expect(act({ status: "unknown", battle: null })).toBeNull();
    expect(act({ status: "unknown" })).toBeNull();
  });

  it("offers nothing for an offline friend", () => {
    expect(act({ status: "offline" })).toBeNull();
  });

  it("says Locked and disables the button on a locked battle", () => {
    expect(act({ battle: { locked: true } })).toMatchObject({
      label: "Locked",
      disabled: true,
      reason: "This battle is locked",
    });
  });

  it("says Full and disables the button on a full open battle", () => {
    // host plus one member is 2 of 2
    expect(act({ battle: { maxPlayers: 2 } })).toMatchObject({
      label: "Full",
      disabled: true,
    });
  });

  it("counts players from playerCount when the server supplies it", () => {
    const a = act({ battle: { playerCount: 8, maxPlayers: 8 } });
    expect(a).toMatchObject({ label: "Full", disabled: true });
  });

  it("does not call a running battle full, since watching takes no slot", () => {
    const a = act({
      status: "ingame",
      running: true,
      battle: { maxPlayers: 2 },
    });
    expect(a).toMatchObject({ kind: "watch", label: "Watch", disabled: false });
  });

  it("asks for the password on a passworded battle", () => {
    expect(act({ battle: { passworded: true } })).toMatchObject({
      label: "Join",
      disabled: false,
      asksPassword: true,
    });
  });

  it("asks for the password to watch a passworded running battle", () => {
    const a = act({
      status: "ingame",
      running: true,
      battle: { passworded: true },
    });
    expect(a).toMatchObject({ label: "Watch", asksPassword: true });
  });

  it("says Locked before it asks for a password", () => {
    const a = act({ battle: { locked: true, passworded: true } });
    expect(a).toMatchObject({ label: "Locked", disabled: true });
  });

  it("offers nothing when you are already in the friend's battle", () => {
    expect(act({ session: { joinedId: 7 } })).toBeNull();
  });

  it("disables the button while you are in a different battle on that server", () => {
    expect(act({ session: { joinedId: 3 } })).toMatchObject({
      label: "Join",
      disabled: true,
      reason: "Leave your current battle first",
    });
  });

  it("disables the button while a join is already under way", () => {
    expect(act({ session: { busy: true } })).toMatchObject({
      disabled: true,
      reason: "Another action is in progress",
    });
  });

  it("disables the button until the connection is ready", () => {
    expect(act({ session: { ready: false } })).toMatchObject({
      disabled: true,
      reason: "Not connected yet",
    });
  });
});
