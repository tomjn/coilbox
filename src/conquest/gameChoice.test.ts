import { describe, expect, it } from "vitest";
import { conquestGameRef, withGameChoice } from "./gameChoice";
import type { ConquestState, GalaxyDoc } from "./model";

const galaxy = (game: GalaxyDoc["game"]) => ({ game }) as GalaxyDoc;
const state = (extra: Partial<ConquestState> = {}) =>
  ({ seed: 1, turn: 0, owners: {}, ...extra }) as ConquestState;

describe("conquestGameRef", () => {
  it("is the galaxy's game when the run has no answer", () => {
    expect(conquestGameRef(galaxy({ shortname: "ZK" }), state())).toEqual({
      shortname: "ZK",
    });
    expect(conquestGameRef(galaxy({ shortname: "ZK" }), undefined)).toEqual({
      shortname: "ZK",
    });
  });

  it("uses the galaxy's pinned name, and the run's answer over it", () => {
    const g = galaxy({ shortname: "ZK", pinnedName: "Zero-K v1.14.8.0" });
    expect(conquestGameRef(g, state()).pinnedName).toBe("Zero-K v1.14.8.0");
    expect(
      conquestGameRef(g, state({ pinnedGame: "Zero-K v1.14.10.1" })).pinnedName,
    ).toBe("Zero-K v1.14.10.1");
  });
});

describe("withGameChoice", () => {
  it("stores the answer on the run state, not the galaxy", () => {
    const after = withGameChoice(state(), { pinnedName: "Zero-K v1.14.10.1" });
    expect(after.pinnedGame).toBe("Zero-K v1.14.10.1");
    expect(after.declinedGameUpdate).toBeUndefined();
  });

  it("keeps an earlier answer when a later one names only the other field", () => {
    const after = withGameChoice(state({ pinnedGame: "Zero-K v1.14.10.1" }), {
      declinedUpdate: "Zero-K v1.15.0.0",
    });
    expect(after.pinnedGame).toBe("Zero-K v1.14.10.1");
    expect(after.declinedGameUpdate).toBe("Zero-K v1.15.0.0");
  });
});
