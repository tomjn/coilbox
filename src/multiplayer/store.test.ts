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
// ringEffect touches `window` at module top-level for its audio-unlock listeners,
// which the `node` test environment lacks; the reducer tests never ring, so stub it.
vi.mock("./ringEffect", () => ({
  triggerRing: () => {},
}));

import { initialMirror, mirrorReducer } from "./store";

const emptyState = {} as LobbyState;

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
