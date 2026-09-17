import { describe, expect, it } from "vitest";
import type { Debriefing } from "./bindings";
import {
  type ConnectionState,
  connectionsReducer,
  hasLiveLogin,
  liveConnectionKeys,
  liveRoomKey,
  newConnection,
  pendingAgreement,
  pendingDebriefing,
} from "./connections";

function live(serverKey: string): ConnectionState {
  return { ...newConnection(serverKey), live: true };
}

function dropped(serverKey: string): ConnectionState {
  return { ...newConnection(serverKey), live: false };
}

describe("liveConnectionKeys", () => {
  it("returns nothing when there are no connections", () => {
    expect(liveConnectionKeys({}, null)).toEqual([]);
  });

  it("skips a dropped connection kept only for its error", () => {
    const connections = { a: live("a"), b: dropped("b") };
    expect(liveConnectionKeys(connections, null)).toEqual(["a"]);
  });

  it("puts the focused key first among the live ones", () => {
    const connections = { a: live("a"), b: live("b"), c: live("c") };
    expect(liveConnectionKeys(connections, "b")).toEqual(["b", "a", "c"]);
  });

  it("falls back to insertion order when the focus key is not live", () => {
    const connections = { a: live("a"), b: dropped("b") };
    expect(liveConnectionKeys(connections, "b")).toEqual(["a"]);
  });

  it("falls back to insertion order when there is no focus key", () => {
    const connections = { a: live("a"), b: live("b") };
    expect(liveConnectionKeys(connections, null)).toEqual(["a", "b"]);
  });
});

function parkedOnAgreement(serverKey: string, text = ""): ConnectionState {
  return { ...newConnection(serverKey), agreement: text };
}

describe("pendingAgreement", () => {
  it("is null when nothing is parked", () => {
    expect(pendingAgreement({ a: live("a") }, null)).toBeNull();
  });

  it("names the one connection parked on it", () => {
    const connections = { a: parkedOnAgreement("a", "Terms of service") };
    expect(pendingAgreement(connections, null)).toEqual({
      serverKey: "a",
      text: "Terms of service",
    });
  });

  it("prefers the focused connection when two are parked at once", () => {
    const connections = {
      a: parkedOnAgreement("a", "A's terms"),
      b: parkedOnAgreement("b", "B's terms"),
    };
    expect(pendingAgreement(connections, "b")).toEqual({
      serverKey: "b",
      text: "B's terms",
    });
  });

  it("queues the other one once the focused connection clears", () => {
    // The second call is what the provider sees after `submitAgreementCode`
    // nulls out the first connection's `agreement`.
    const connections = { b: parkedOnAgreement("b", "B's terms") };
    expect(pendingAgreement(connections, "a")).toEqual({
      serverKey: "b",
      text: "B's terms",
    });
  });

  it("reads a null agreement text as empty, not as absent", () => {
    const connections = { a: { ...newConnection("a"), agreement: "" } };
    expect(pendingAgreement(connections, null)).toEqual({
      serverKey: "a",
      text: "",
    });
  });
});

function debriefing(battleId: number): Debriefing {
  return {
    battleId,
    url: null,
    message: null,
    ratingCategory: null,
    chatChannel: null,
    players: [],
  };
}

/** A connection whose mirror has caught up with a debriefing result and
 * whose `debriefingShown` names it (or does not, for the "notice only"
 * case). */
function withDebriefing(
  serverKey: string,
  shown: number | null,
  report?: Debriefing,
): ConnectionState {
  const base = newConnection(serverKey);
  return {
    ...base,
    debriefingShown: shown,
    mirror: {
      ...base.mirror,
      state: report
        ? ({
            debriefing: report,
            myUsername: null,
          } as unknown as ConnectionState["mirror"]["state"])
        : null,
    },
  };
}

describe("pendingDebriefing", () => {
  it("is null when nothing is shown", () => {
    expect(pendingDebriefing({ a: live("a") }, null)).toBeNull();
  });

  it("is null while the notice has arrived but the snapshot has not caught up", () => {
    const connections = { a: withDebriefing("a", 1) };
    expect(pendingDebriefing(connections, null)).toBeNull();
  });

  it("shows the one connection whose mirror has the matching result", () => {
    const conn = withDebriefing("a", 1, debriefing(1));
    expect(pendingDebriefing({ a: conn }, null)).toEqual({
      serverKey: "a",
      report: debriefing(1),
      myUsername: null,
    });
  });

  it("prefers the focused connection when two have a result at once", () => {
    const a = withDebriefing("a", 1, debriefing(1));
    const b = withDebriefing("b", 2, debriefing(2));
    expect(pendingDebriefing({ a, b }, "b")?.serverKey).toBe("b");
  });

  it("queues the other one once the shown connection's is closed", () => {
    const b = withDebriefing("b", 2, debriefing(2));
    // `a` no longer has anything shown, matching a `closeDebriefing()` call.
    expect(pendingDebriefing({ b }, "a")?.serverKey).toBe("b");
  });
});

describe("a connection that is a room (issue #2850)", () => {
  it("records whether a connection is a room when it opens", () => {
    const opened = connectionsReducer(
      {},
      { type: "open", serverKey: "AF@127.0.0.1:8200", direct: true },
    );
    expect(opened["AF@127.0.0.1:8200"].direct).toBe(true);
    const lobby = connectionsReducer(
      {},
      { type: "open", serverKey: "AF@lobby:8200" },
    );
    expect(lobby["AF@lobby:8200"].direct).toBe(false);
  });

  it("marks an entry that already exists when it reopens as a room", () => {
    const before = { a: dropped("a") };
    const after = connectionsReducer(before, {
      type: "open",
      serverKey: "a",
      direct: true,
    });
    expect(after.a.direct).toBe(true);
    // Reopening with nothing to change keeps the same object.
    expect(connectionsReducer(after, { type: "open", serverKey: "a" })).toBe(
      after,
    );
  });

  it("names the live room among lobby logins", () => {
    const room = { ...live("room"), direct: true };
    expect(liveRoomKey({ a: live("a"), room, b: live("b") })).toBe("room");
  });

  it("names no room when there is none, or when the room has dropped", () => {
    expect(liveRoomKey({ a: live("a") })).toBeNull();
    const gone = { ...dropped("room"), direct: true };
    expect(liveRoomKey({ a: live("a"), room: gone })).toBeNull();
  });
});

// A room is not a lobby login (issue #2850), so it must not count as
// "connected" for the Login sidebar item and its `/lobby` route (issue #2905),
// the same split `lobbyDotStatus` already makes for the top bar (issue #2904).
describe("hasLiveLogin", () => {
  it("is false with no connections", () => {
    expect(hasLiveLogin({})).toBe(false);
  });

  it("is false while only a room is live", () => {
    const room = { ...live("room"), direct: true };
    expect(hasLiveLogin({ room })).toBe(false);
  });

  it("is true while a lobby login is live, even beside a live room", () => {
    const room = { ...live("room"), direct: true };
    expect(hasLiveLogin({ a: live("a") })).toBe(true);
    expect(hasLiveLogin({ a: live("a"), room })).toBe(true);
  });

  it("is false for a login that exists but has not gone live, or has dropped", () => {
    expect(hasLiveLogin({ a: dropped("a") })).toBe(false);
    expect(hasLiveLogin({ a: newConnection("a") })).toBe(false);
  });
});

// Issue #2776: the level starts at "mod" (see serverAdmin.test.ts for how a
// GETUSERINFO answer settles it) and is kept per connection, not shared.
describe("ConnectionState.adminLevel", () => {
  it("starts at mod for a new connection", () => {
    expect(newConnection("a").adminLevel).toBe("mod");
  });

  it("keeps two connections' levels independent", () => {
    let connections = connectionsReducer({}, { type: "open", serverKey: "a" });
    connections = connectionsReducer(connections, {
      type: "open",
      serverKey: "b",
    });
    connections = connectionsReducer(connections, {
      type: "update",
      serverKey: "a",
      update: (c) => ({ ...c, adminLevel: "admin" }),
    });
    expect(connections.a.adminLevel).toBe("admin");
    expect(connections.b.adminLevel).toBe("mod");
  });

  it("clears back to mod on disconnect: a reopened entry does not inherit the old level", () => {
    let connections = connectionsReducer({}, { type: "open", serverKey: "a" });
    connections = connectionsReducer(connections, {
      type: "update",
      serverKey: "a",
      update: (c) => ({ ...c, adminLevel: "admin" }),
    });
    expect(connections.a.adminLevel).toBe("admin");

    connections = connectionsReducer(connections, {
      type: "close",
      serverKey: "a",
    });
    expect(connections.a).toBeUndefined();

    connections = connectionsReducer(connections, {
      type: "open",
      serverKey: "a",
    });
    expect(connections.a.adminLevel).toBe("mod");
  });
});
