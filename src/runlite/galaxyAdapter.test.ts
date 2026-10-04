import { describe, expect, it } from "vitest";
import type { GalaxyDoc } from "../conquest/model";
import {
  forwardReachable,
  mapRunEmphasis,
  mapRunIdentities,
  mapRunOwners,
  mapRunPathLinks,
  mapRunToGalaxyDoc,
  PLAYER_FACTION,
  RUN_DIM,
  runEmphasis,
  runIdentities,
  runLocations,
  runOwners,
  runPathLinks,
  runToGalaxyDoc,
  warlordBodyFor,
} from "./galaxyAdapter";
import type { RogueliteRun, RunNode } from "./model";
import { resolveBattle } from "./progress";

// start -> {b1, b2} -> boss (a diamond).
function run(): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name: "Test Reach",
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

describe("a Galaxy or Theatre run", () => {
  it("is laid out in columns, each centred on the lane", () => {
    const doc = runToGalaxyDoc(run());
    expect(doc.nodes.map((n) => [n.id, n.pos])).toEqual([
      ["start", [0, 0]],
      ["b1", [1, -0.5]],
      ["b2", [1, 0.5]],
      ["boss", [2, 0]],
    ]);
    expect(doc.links).toEqual(run().edges);
    expect(doc.terrain).toBeUndefined();
    expect(doc.theme?.skin).toBe("galaxy");
    expect(
      runToGalaxyDoc({
        ...run(),
        settings: { ...run().settings, skin: "theatre" },
      }).theme?.skin,
    ).toBe("theatre");
  });

  it("mutes what was crossed and gives the rest its type colour", () => {
    const r = resolveBattle(run(), "b1", "victory", "now");
    expect(runOwners(r)).toEqual({
      start: "done",
      b1: PLAYER_FACTION,
      b2: "type-battle",
      boss: "type-boss",
    });
  });
});

// The diamond run laid on a map. The run's node ids are not the map's ids, so
// every answer has to be moved from one to the other. The map also has a link
// between the two middle locations, and two locations on no route: `far`,
// joined to the goal, and `isle`, joined to `far` alone.
function landMap(): GalaxyDoc {
  const at = (id: string, x: number, y: number) => ({
    id,
    name: `Place ${id}`,
    pos: [x, y] as [number, number],
    outline: [
      [
        [x, y],
        [x + 10, y],
        [x, y + 10],
      ] as [number, number][],
    ],
    owner: "enemy-1",
    kind: id === "east" ? ("capital" as const) : undefined,
    difficulty: 4,
    battle: { mapName: "A conquest map" },
  });
  return {
    schemaVersion: 1,
    id: "land",
    type: "conquest-galaxy",
    title: "Land",
    description: "",
    game: { shortname: "ba" },
    playerFactionId: "player",
    factions: [{ id: "player", name: "Player", color: "#ffffff" }],
    nodes: [
      at("gate", 100, 200),
      at("north", 300, 100),
      at("south", 300, 300),
      at("east", 500, 200),
      at("far", 700, 200),
      at("isle", 900, 200),
    ],
    // Written against the direction of travel where it matters.
    links: [
      ["north", "gate"],
      ["gate", "south"],
      ["east", "north"],
      ["south", "east"],
      ["north", "south"],
      ["east", "far"],
      ["far", "isle"],
    ],
    linkKinds: [
      ["north", "gate", "border"],
      ["gate", "south", "border"],
      ["east", "north", "border"],
      ["south", "east", "border"],
      ["north", "south", "border"],
      ["east", "far", "crossing"],
      ["far", "isle", "crossing"],
    ],
    terrain: { image: "data:,", width: 1000, height: 400 },
    createdAt: "t",
    updatedAt: "t",
  };
}

const AT: Record<string, string> = {
  start: "gate",
  b1: "north",
  b2: "south",
  boss: "east",
};

function landRun(): RogueliteRun {
  const r = run();
  return { ...r, nodes: r.nodes.map((n) => ({ ...n, location: AT[n.id] })) };
}

function located(r: RogueliteRun): Map<string, string> {
  const locations = runLocations(r, landMap());
  if (!locations) throw new Error("the run fits the map");
  return locations;
}

describe("runLocations", () => {
  it("maps each run node to its location", () => {
    expect(Object.fromEntries(located(landRun()))).toEqual(AT);
  });

  it("is null for a column run, a location the map lacks and a step the map does not join", () => {
    expect(runLocations(run(), landMap())).toBeNull();
    const lost = landRun();
    lost.nodes[1] = { ...lost.nodes[1], location: "atlantis" };
    expect(runLocations(lost, landMap())).toBeNull();
    const unjoined = { ...landMap(), links: landMap().links.slice(1) };
    expect(runLocations(landRun(), unjoined)).toBeNull();
  });
});

describe("mapRunToGalaxyDoc", () => {
  const doc = mapRunToGalaxyDoc(landRun(), landMap(), located(landRun()));
  const node = (id: string) => doc.nodes.find((n) => n.id === id);

  it("draws every location where the map has it, and invents no position", () => {
    expect(doc.nodes.map((n) => [n.id, n.name, n.pos, n.outline])).toEqual(
      landMap().nodes.map((n) => [n.id, n.name, n.pos, n.outline]),
    );
    expect(doc.terrain).toEqual(landMap().terrain);
    expect(doc.id).toBe("land");
  });

  it("gives a route location its run node's type, tier and battle map", () => {
    expect(node("gate")?.owner).toBe("type-start");
    expect(node("gate")?.kind).toBe("capital");
    expect(node("north")?.owner).toBe("type-battle");
    expect(node("north")?.kind).toBeUndefined();
    expect(node("north")?.difficulty).toBe(2);
    expect(node("north")?.battle).toEqual({ mapName: "m" });
    expect(node("east")?.owner).toBe("type-boss");
    expect(node("east")?.kind).toBe("capital");
    expect(doc.playerFactionId).toBe(PLAYER_FACTION);
  });

  it("makes scenery neutral, with no battle and no capital", () => {
    for (const id of ["far", "isle"]) {
      expect(node(id)?.owner).toBe("neutral");
      expect(node(id)?.battle).toEqual({ mapName: "" });
      expect(node(id)?.kind).toBeUndefined();
    }
  });

  it("writes each step forward, scenery first, and drops the link between two of one rank", () => {
    expect(doc.links).toEqual([
      ["gate", "north"],
      ["gate", "south"],
      ["north", "east"],
      ["south", "east"],
      ["far", "east"],
      ["far", "isle"],
    ]);
    expect(doc.linkKinds?.map(([a, b]) => `${a} ${b}`)).not.toContain(
      "north south",
    );
    expect(doc.linkKinds).toHaveLength(6);
  });
});

describe("a land run's live state", () => {
  const map = landMap();
  const moved = resolveBattle(landRun(), "b1", "victory", "now"); // at north

  it("shows the passed location as taken, the one gone around in its own colour and scenery neutral", () => {
    expect(mapRunOwners(moved, map, located(moved))).toEqual({
      gate: "taken",
      north: PLAYER_FACTION,
      south: "type-battle",
      east: "type-boss",
      far: "neutral",
      isle: "neutral",
    });
    const doc = mapRunToGalaxyDoc(moved, map, located(moved));
    const color = (id: string) => doc.factions.find((f) => f.id === id)?.color;
    expect(color("taken")).toBe(color(PLAYER_FACTION));
  });

  it("dims scenery right back and keeps the location gone around clear", () => {
    const e = mapRunEmphasis(moved, map, located(moved));
    expect(e.get("far")).toEqual({ opacity: RUN_DIM.unreachable });
    expect(e.get("isle")).toEqual({ opacity: RUN_DIM.unreachable });
    expect(e.get("south")?.opacity).toBe(RUN_DIM.future);
    expect(e.get("gate")).toEqual({ opacity: RUN_DIM.done, marker: "check" });
    // Where the player stands, and the one choice ahead, are at full strength.
    expect(e.has("north")).toBe(false);
    expect(e.get("east")?.opacity).toBeUndefined();
    expect(e.has("b2")).toBe(false);
  });

  it("marks the start and the goal, by location", () => {
    const ids = mapRunIdentities(moved, located(moved));
    expect(ids.get("gate")).toEqual({ body: "beacon" });
    expect(ids.get("east")?.body).toBe(warlordBodyFor(1));
    expect(ids.has("far")).toBe(false);
  });

  it("names the path taken in the order the document writes its links", () => {
    expect(runPathLinks(moved)).toEqual(new Set(["start b1"]));
    const path = mapRunPathLinks(moved, located(moved));
    expect(path).toEqual(new Set(["gate north"]));
    const doc = mapRunToGalaxyDoc(moved, map, located(moved));
    const written = new Set(doc.links.map(([a, b]) => `${a} ${b}`));
    for (const key of path) expect(written.has(key)).toBe(true);
  });
});
