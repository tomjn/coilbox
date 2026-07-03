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

import { initialMirror, mirrorReducer } from "./store";

const emptyState = {} as LobbyState;

describe("mirrorReducer join-failure handling", () => {
  it("sets lastJoinError from a joinBattleFailed delta", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "joinBattleFailed", reason: "Wrong password" } },
    });
    expect(m.lastJoinError).toBe("Wrong password");
  });

  it("sets lastJoinError from an openBattleFailed delta", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "openBattleFailed", reason: "Nope" } },
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
    expect(mirrorReducer(withErr, { type: "clearJoinError" }).lastJoinError).toBeNull();
  });

  it("snapshot preserves lastJoinError", () => {
    const withErr = { ...initialMirror, lastJoinError: "x" };
    expect(
      mirrorReducer(withErr, { type: "snapshot", state: emptyState }).lastJoinError,
    ).toBe("x");
  });
});
