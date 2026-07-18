import { describe, expect, it } from "vitest";
import {
  forwardReachable,
  RUN_DIM,
  runEmphasis,
  runIdentities,
  warlordBodyFor,
} from "./galaxyAdapter";
import type { RogueliteRun, RunNode } from "./model";
import { resolveBattle } from "./progress";

// start -> {b1, b2} -> boss (a diamond).
function run(): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    settings: {
      seed: 1,
      length: "standard",
      difficulty: 2,
      ascension: 0,
      game: { shortname: "ba" },
      factionId: "p",
      skin: "galaxy",
    },
    nodes: [
      { id: "start", type: "start", col: 0, row: 0 },
      {
        id: "b1",
        type: "battle",
        col: 1,
        row: 0,
        battle: { mapName: "m", enemyAiCount: 1, handicap: 0, techTier: 2 },
      },
      {
        id: "b2",
        type: "battle",
        col: 1,
        row: 1,
        battle: { mapName: "m", enemyAiCount: 1, handicap: 0, techTier: 2 },
      },
      {
        id: "boss",
        type: "boss",
        col: 2,
        row: 0,
        battle: { mapName: "m", enemyAiCount: 3, handicap: 30, techTier: 5 },
      },
    ],
    edges: [
      ["start", "b1"],
      ["start", "b2"],
      ["b1", "boss"],
      ["b2", "boss"],
    ],
    progress: {
      currentNodeId: "start",
      visited: ["start"],
      hull: 30,
      maxHull: 100,
      salvage: 0,
      unlockedUnits: [],
      perks: [],
      status: "active",
    },
    history: [],
    createdAt: "t",
    updatedAt: "t",
  };
}

describe("runIdentities", () => {
  it("always marks the start a beacon and the warlord its lair", () => {
    const ids = runIdentities(run());
    expect(ids.get("start")).toEqual({ body: "beacon" });
    expect(ids.get("boss")?.body).toBe(warlordBodyFor(1));
    expect(ids.get("boss")?.body).toMatch(/^warlord-/);
  });

  it("danger-tints battle and elite sites but gives them no body", () => {
    const ids = runIdentities(run());
    expect(ids.get("b1")).toEqual({ starTint: "#e0473a" });
    expect(ids.get("b2")?.body).toBeUndefined();
    expect(ids.get("b2")?.starTint).toBe("#e0473a");
  });

  it("gives service nodes a sparse, deterministic special body", () => {
    // A wide column of shops: only a seeded minority should read as stations.
    const shops: RunNode[] = Array.from({ length: 40 }, (_, i) => ({
      id: `shop-${i}`,
      type: "shop" as const,
      col: 1,
      row: i,
    }));
    const r: RogueliteRun = { ...run(), nodes: [run().nodes[0], ...shops] };
    const a = runIdentities(r);
    const b = runIdentities(r);
    const stations = shops.filter((s) => a.get(s.id)?.body === "station");
    // Deterministic (same run -> same identities).
    for (const s of shops) expect(a.get(s.id)).toEqual(b.get(s.id));
    // Sparse: a clear minority, but not none across 40 nodes.
    expect(stations.length).toBeGreaterThan(0);
    expect(stations.length).toBeLessThan(shops.length / 2);
    // A shop body is either the ring-station or (testing) a dyson swarm.
    for (const s of shops) {
      const body = a.get(s.id)?.body;
      if (body) expect(["station", "dyson-swarm"]).toContain(body);
    }
  });
});

describe("warlordBodyFor", () => {
  it("is deterministic and cycles the two lairs", () => {
    expect(warlordBodyFor(0)).toBe("warlord-blackhole");
    expect(warlordBodyFor(1)).toBe("warlord-hypergiant");
    expect(warlordBodyFor(2)).toBe("warlord-blackhole");
    // Negative seeds wrap cleanly, never undefined.
    expect(warlordBodyFor(-1)).toBe("warlord-hypergiant");
  });
});

describe("forwardReachable", () => {
  it("collects the node and all its forward descendants", () => {
    expect(forwardReachable(run(), "start")).toEqual(
      new Set(["start", "b1", "b2", "boss"]),
    );
    expect(forwardReachable(run(), "b1")).toEqual(new Set(["b1", "boss"]));
  });
});

describe("runEmphasis", () => {
  it("leaves the current node and its choices at full brightness", () => {
    const e = runEmphasis(run());
    // start (current) is absent = bright.
    expect(e.has("start")).toBe(false);
    // b1/b2 (the choices ahead) stay bright (no opacity) but flash as battles.
    expect(e.get("b1")?.opacity).toBeUndefined();
    expect(e.get("b1")?.flash).toBe(true);
    expect(e.get("b2")?.opacity).toBeUndefined();
    // boss is reachable but not an immediate choice -> dimmed future, flashing.
    expect(e.get("boss")?.opacity).toBe(RUN_DIM.future);
    expect(e.get("boss")?.flash).toBe(true);
  });

  it("mutes the crossed path and greatly dims the branch not taken", () => {
    const r = resolveBattle(run(), "b1", "victory", "now"); // now at b1
    const e = runEmphasis(r);
    // boss is the only choice now -> bright (no opacity), still flashes.
    expect(e.get("boss")?.opacity).toBeUndefined();
    expect(e.get("boss")?.flash).toBe(true);
    expect(e.has("b1")).toBe(false); // current
    // start is behind you -> muted and marked done.
    expect(e.get("start")?.opacity).toBe(RUN_DIM.done);
    expect(e.get("start")?.marker).toBe("check");
    // b2 (the fork you passed on) is unreachable now -> greatly dimmed.
    expect(e.get("b2")?.opacity).toBe(RUN_DIM.unreachable);
  });
});
