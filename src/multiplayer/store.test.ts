import { describe, expect, it, vi } from "vitest";
import type { LobbyState } from "./bindings";

// store.tsx transitively pulls in @picoframe/frame and @picoframe/plugin-sdk,
// whose published dist uses extensionless relative imports that Vitest's node
// resolver won't load from node_modules. The reducer tests never touch the
// provider or any command, so stubbing these leaf packages is enough to let the
// module load.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
// ringEffect, ingameCue and mentionCue all touch `window` at module top-level for
// their audio-unlock listeners, which the `node` test environment lacks; the reducer
// tests never ring or cue, so stub all three.
vi.mock("./ringEffect", () => ({
  triggerRing: () => {},
}));
vi.mock("./ingameCue", () => ({
  triggerIngameCue: () => {},
}));
vi.mock("./chat/mentionCue", () => ({
  triggerMentionCue: () => {},
}));

import {
  connectBlockedReason,
  initialMirror,
  mirrorReducer,
  RECONNECT_DELAYS_MS,
  reconnectDelay,
} from "./store";

const emptyState = {} as LobbyState;

describe("reconnectDelay backoff", () => {
  it("returns the scheduled delay per attempt", () => {
    expect(reconnectDelay(0)).toBe(RECONNECT_DELAYS_MS[0]);
    expect(reconnectDelay(1)).toBe(RECONNECT_DELAYS_MS[1]);
  });

  it("clamps beyond the budget to the final (capped) delay", () => {
    const last = RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1];
    expect(reconnectDelay(RECONNECT_DELAYS_MS.length)).toBe(last);
    expect(reconnectDelay(999)).toBe(last);
  });

  it("clamps a negative attempt to the first delay", () => {
    expect(reconnectDelay(-1)).toBe(RECONNECT_DELAYS_MS[0]);
  });
});

describe("mirrorReducer Tachyon phases", () => {
  it("records the two phases a Tachyon connect reports before its socket exists", () => {
    let m = mirrorReducer(initialMirror, { type: "connecting" });
    expect(m.phase).toBeNull();
    for (const phase of ["tachyonAuthorizing", "tachyonOpening"] as const) {
      m = mirrorReducer(m, {
        type: "event",
        ev: { kind: "phase", phase, agreement: null },
      });
      expect(m.phase).toBe(phase);
    }
    // Then straight to ready, because a socket that opened is already
    // authenticated. Everything that gates on a live connection reads this.
    m = mirrorReducer(m, {
      type: "event",
      ev: { kind: "phase", phase: "ready", agreement: null },
    });
    expect(m.phase).toBe("ready");
  });

  it("puts a Tachyon frame in the console the way a wire line goes there", () => {
    const frame = '{"type":"event","commandId":"user/updated"}';
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "console", direction: "in", line: frame },
    });
    expect(m.consoleLines).toEqual([`<< ${frame}`]);
  });
});

describe("mirrorReducer join-failure handling", () => {
  it("sets lastJoinError from a joinBattleFailed delta", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: {
        kind: "delta",
        delta: { kind: "joinBattleFailed", reason: "Wrong password" },
      },
    });
    expect(m.lastJoinError).toBe("Wrong password");
  });

  it("sets lastJoinError from an openBattleFailed delta", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: {
        kind: "delta",
        delta: { kind: "openBattleFailed", reason: "Nope" },
      },
    });
    expect(m.lastJoinError).toBe("Nope");
  });

  it("puts a refused relay credential in front of whoever was hosting", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: {
        kind: "delta",
        delta: {
          kind: "turnCredentialsRefused",
          reason: "you asked too often",
        },
      },
    });
    expect(m.lastJoinError).toBe(
      "the lobby would not hand out a relay credential: you asked too often",
    );
  });

  it("says nothing about a relay credential that was minted", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: {
        kind: "delta",
        delta: { kind: "turnCredentials", expiresAt: 1786086400000 },
      },
    });
    expect(m.lastJoinError).toBeNull();
  });

  it("ignores unrelated deltas", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "battleOpened", id: 4 } },
    });
    expect(m.lastJoinError).toBeNull();
  });

  it("clearJoinError resets it", () => {
    const withErr = { ...initialMirror, lastJoinError: "x" };
    expect(
      mirrorReducer(withErr, { type: "clearJoinError" }).lastJoinError,
    ).toBeNull();
  });

  it("snapshot preserves lastJoinError", () => {
    const withErr = { ...initialMirror, lastJoinError: "x" };
    expect(
      mirrorReducer(withErr, { type: "snapshot", state: emptyState })
        .lastJoinError,
    ).toBe("x");
  });
});

describe("mirrorReducer login-denial handling", () => {
  it("sets loginError from a loginDenied delta", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: {
        kind: "delta",
        delta: { kind: "loginDenied", reason: "wrong password" },
      },
    });
    expect(m.loginError).toBe("wrong password");
  });

  it("preserves loginError across the following disconnected event", () => {
    // The delta arrives just before teardown; the inline "Login failed" must
    // survive the disconnected handler so it isn't replaced by "Disconnected: …".
    const denied = mirrorReducer(initialMirror, {
      type: "event",
      ev: {
        kind: "delta",
        delta: { kind: "loginDenied", reason: "wrong password" },
      },
    });
    const closed = mirrorReducer(denied, {
      type: "event",
      ev: { kind: "disconnected", reason: "wrong password" },
    });
    expect(closed.loginError).toBe("wrong password");
  });

  it("clears loginError when a new connect attempt starts", () => {
    const withErr = { ...initialMirror, loginError: "wrong password" };
    expect(
      mirrorReducer(withErr, { type: "connecting" }).loginError,
    ).toBeNull();
  });

  it("leaves loginError untouched for unrelated deltas", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "battleOpened", id: 4 } },
    });
    expect(m.loginError).toBeNull();
  });
});

describe("mirrorReducer channel-list completion", () => {
  it("starts the completion counter at zero", () => {
    expect(initialMirror.channelListReceivedSeq).toBe(0);
  });

  it("advances the counter on each channelListReceived delta", () => {
    const once = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "channelListReceived" } },
    });
    expect(once.channelListReceivedSeq).toBe(1);
    const twice = mirrorReducer(once, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "channelListReceived" } },
    });
    expect(twice.channelListReceivedSeq).toBe(2);
  });

  it("leaves the counter untouched for unrelated deltas", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "battleOpened", id: 4 } },
    });
    expect(m.channelListReceivedSeq).toBe(0);
  });

  it("snapshot preserves the counter", () => {
    const withSeq = { ...initialMirror, channelListReceivedSeq: 3 };
    expect(
      mirrorReducer(withSeq, { type: "snapshot", state: emptyState })
        .channelListReceivedSeq,
    ).toBe(3);
  });
});

describe("mirrorReducer Tachyon battle start", () => {
  it("starts the counter at zero", () => {
    expect(initialMirror.battleStartSeq).toBe(0);
  });

  it("advances the counter each time the server says where the match is", () => {
    const once = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "battleStarting" },
    });
    expect(once.battleStartSeq).toBe(1);
    // A second match in the same lobby has to read as a second launch, not as
    // the first one still standing.
    const twice = mirrorReducer(once, {
      type: "event",
      ev: { kind: "battleStarting" },
    });
    expect(twice.battleStartSeq).toBe(2);
  });

  it("survives the snapshot the room fetches after it", () => {
    const started = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "battleStarting" },
    });
    expect(
      mirrorReducer(started, { type: "snapshot", state: emptyState })
        .battleStartSeq,
    ).toBe(1);
  });

  it("leaves the counter alone for everything else", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "battleOpened", id: 4 } },
    });
    expect(m.battleStartSeq).toBe(0);
  });
});

describe("connectBlockedReason", () => {
  const lobby = "AF_@server4.beyondallreason.info:8201";
  const room = "AF@127.0.0.1:8200";

  it("lets a connect through when there is nothing to be in the way", () => {
    expect(connectBlockedReason(null, null, room)).toBeNull();
  });

  it("refuses a second connection and names where the first one is", () => {
    const reason = connectBlockedReason(lobby, null, room);
    expect(reason).toContain("server4.beyondallreason.info:8201");
    expect(reason).toContain("one lobby connection");
  });

  it("refuses a connect racing one that is still shaking hands", () => {
    const reason = connectBlockedReason(null, lobby, room);
    expect(reason).toContain("server4.beyondallreason.info:8201");
    expect(reason).toContain("already opening");
  });

  it("names the connection that exists over the one still opening", () => {
    // Both can be set at once: a connect that has registered its key has not
    // yet cleared it when the snapshot lands. The live one is the one somebody
    // can act on, so it is the one worth naming.
    expect(connectBlockedReason(lobby, room, "AF@127.0.0.1:8300")).toContain(
      "server4.beyondallreason.info:8201",
    );
  });

  it("leaves a connect to the key it already holds to the Rust side", () => {
    // Reconnecting under a live key is a duplicate, which the registry refuses
    // with its own words. This rule is about a *second* connection, so it says
    // nothing about that one rather than shadowing a better message.
    expect(connectBlockedReason(lobby, null, lobby)).toBeNull();
    expect(connectBlockedReason(null, lobby, lobby)).toBeNull();
  });

  it("never uses a word the room join failure reads as a socket error", () => {
    // A refused `connectDirect` reaches the join form through
    // `joinRoomFailure`, which rewrites anything that looks like a dead socket
    // and passes everything else through. This reason has to be everything
    // else, or the join drawer would tell somebody their address was wrong.
    const reasons = [
      connectBlockedReason(lobby, null, room),
      connectBlockedReason(null, lobby, room),
    ];
    for (const reason of reasons) {
      const lower = String(reason).toLowerCase();
      for (const word of [
        "refused",
        "timed out",
        "timeout",
        "unreachable",
        "no route",
        "dns",
        "resolve",
        "nodename",
        "not known",
      ]) {
        expect(lower).not.toContain(word);
      }
    }
  });
});
