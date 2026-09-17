import { describe, expect, it } from "vitest";
import type { Debriefing } from "./bindings";
import {
  type ConnectionState,
  liveConnectionKeys,
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
