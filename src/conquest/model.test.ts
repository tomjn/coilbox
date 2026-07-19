import { describe, expect, it } from "vitest";
import type { GalaxyDoc } from "./model";
import {
  compareGameVersions,
  newConquestState,
  parseGalaxyJson,
  reconcileState,
  resolveGameByShortname,
  wrapGalaxyForExport,
} from "./model";

function galaxy(overrides: Partial<GalaxyDoc> = {}): GalaxyDoc {
  return {
    schemaVersion: 1,
    id: "g",
    type: "conquest-galaxy",
    title: "G",
    description: "",
    game: { shortname: "TG" },
    playerFactionId: "p",
    factions: [
      { id: "p", name: "Player", color: "#4f8cff" },
      { id: "e", name: "Enemy", color: "#e63c33", aggression: 0.5 },
    ],
    nodes: [
      {
        id: "a",
        name: "A",
        pos: [0, 0],
        owner: "p",
        kind: "capital",
        difficulty: 1,
        battle: { mapName: "MapA" },
      },
      {
        id: "b",
        name: "B",
        pos: [1, 0],
        owner: "neutral",
        difficulty: 2,
        battle: { mapName: "MapB" },
      },
      {
        id: "c",
        name: "C",
        pos: [2, 0],
        owner: "e",
        kind: "capital",
        difficulty: 5,
        battle: { mapName: "MapC" },
      },
    ],
    links: [
      ["a", "b"],
      ["b", "c"],
    ],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("parseGalaxyJson", () => {
  it("round-trips a valid doc", () => {
    const doc = galaxy();
    expect(parseGalaxyJson(JSON.stringify(doc))).toEqual(doc);
  });

  it("accepts the export wrapper", () => {
    const wrapped = wrapGalaxyForExport(galaxy());
    expect(parseGalaxyJson(JSON.stringify(wrapped))?.id).toBe("g");
  });

  it("rejects malformed JSON and wrong types", () => {
    expect(parseGalaxyJson("{nope")).toBeNull();
    expect(parseGalaxyJson(JSON.stringify({ type: "ta" }))).toBeNull();
  });

  it("rejects duplicate node ids", () => {
    const doc = galaxy();
    doc.nodes.push({ ...doc.nodes[1] });
    expect(parseGalaxyJson(JSON.stringify(doc))).toBeNull();
  });

  it("rejects an unknown playerFactionId", () => {
    expect(
      parseGalaxyJson(JSON.stringify(galaxy({ playerFactionId: "zz" }))),
    ).toBeNull();
  });

  it("rejects a faction without exactly one owned capital", () => {
    const doc = galaxy();
    doc.nodes[2].kind = undefined; // enemy loses its capital
    expect(parseGalaxyJson(JSON.stringify(doc))).toBeNull();
  });

  it("rejects a node without a battle map", () => {
    const doc = galaxy();
    doc.nodes[1].battle = { mapName: "" };
    expect(parseGalaxyJson(JSON.stringify(doc))).toBeNull();
  });

  it("normalizes unknown owners to neutral and drops bad links", () => {
    const doc = galaxy();
    doc.nodes[1].owner = "who";
    doc.links = [
      ["a", "b"],
      ["a", "b"], // duplicate
      ["b", "b"], // self
      ["a", "zz"], // unknown
      ["b", "c"],
    ];
    const parsed = parseGalaxyJson(JSON.stringify(doc));
    expect(parsed?.nodes[1].owner).toBe("neutral");
    expect(parsed?.links).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("clamps difficulty and graceTurns", () => {
    const doc = galaxy({ rules: { graceTurns: 99 } });
    doc.nodes[1].difficulty = 42;
    const parsed = parseGalaxyJson(JSON.stringify(doc));
    expect(parsed?.nodes[1].difficulty).toBe(5);
    expect(parsed?.rules?.graceTurns).toBe(10);
  });

  it("round-trips generation knobs and drops invalid ones", () => {
    const doc = galaxy({
      generated: {
        seed: 7,
        nodeCount: 16,
        factionCount: 2,
        layout: "ring",
        skin: "galaxy",
        startingSystems: 2,
        fogOfWar: true,
      },
    });
    expect(parseGalaxyJson(JSON.stringify(doc))).toEqual(doc);

    const raw = JSON.parse(JSON.stringify(doc));
    raw.generated.layout = "hexagon";
    raw.generated.nodeCount = 900;
    const parsed = parseGalaxyJson(JSON.stringify(raw));
    expect(parsed?.generated?.seed).toBe(7);
    expect(parsed?.generated?.layout).toBeUndefined();
    expect(parsed?.generated?.nodeCount).toBe(80);
  });

  it("filters playableFactionIds to known factions", () => {
    const doc = galaxy({ playableFactionIds: ["p", "e", "zz"] });
    expect(parseGalaxyJson(JSON.stringify(doc))?.playableFactionIds).toEqual([
      "p",
      "e",
    ]);
  });
});

describe("reconcileState", () => {
  it("drops unknown nodes, seeds new ones, keeps valid entries", () => {
    const doc = galaxy();
    const state = newConquestState(doc, { seed: 1 }, "t0");
    state.owners.gone = "p"; // node that no longer exists
    state.owners.b = "e"; // valid capture survives
    delete state.owners.c; // newly added node seeds from authored owner
    const healed = reconcileState(doc, state);
    expect(healed.owners).toEqual({ a: "p", b: "e", c: "e" });
  });

  it("seeds a missing revealed set and drops stale ids under fog", () => {
    const doc = galaxy({ rules: { fogOfWar: true } });
    // A save from before fog existed: no `revealed`, plus a stale id.
    const state = newConquestState(doc, { seed: 1 }, "t0");
    const healed = reconcileState(doc, {
      ...state,
      revealed: ["a", "gone"],
    });
    expect(healed.revealed).toContain("a");
    expect(healed.revealed).not.toContain("gone");
    // Player holds capital a; b is within two jumps and seeds in.
    expect(healed.revealed).toContain("b");
  });

  it("resets a vanished player faction and dangling incursion", () => {
    const doc = galaxy();
    const state = newConquestState(
      doc,
      { playerFactionId: "e", seed: 1 },
      "t0",
    );
    state.incursions = [{ nodeId: "a", factionId: "e", expiresOnTurn: 2 }];
    const smaller = galaxy({
      factions: doc.factions,
      playerFactionId: "p",
    });
    const healed = reconcileState(smaller, {
      ...state,
      playerFactionId: "gone-faction",
    });
    expect(healed.playerFactionId).toBe("p");
    // Incursion node "a" is owned by "p" in the healed map, so it survives.
    expect(healed.incursions).toHaveLength(1);
  });

  it("migrates a legacy singular incursion into the array", () => {
    const doc = galaxy();
    const state = newConquestState(doc, { seed: 1 }, "t0");
    // An old save that predates the incursions array.
    const legacy = {
      ...state,
      incursions: undefined,
      incursion: { nodeId: "a", factionId: "e", expiresOnTurn: 2 },
    } as unknown as Parameters<typeof reconcileState>[1];
    const healed = reconcileState(doc, legacy);
    expect(healed.incursions).toEqual([
      { nodeId: "a", factionId: "e", expiresOnTurn: 2 },
    ]);
  });
});

describe("compareGameVersions / resolveGameByShortname", () => {
  it("compares numeric segments numerically", () => {
    expect(compareGameVersions("1.10", "1.9")).toBeGreaterThan(0);
    expect(compareGameVersions("test-26575", "test-9999")).toBeGreaterThan(0);
    expect(compareGameVersions("2.0", "2.0")).toBe(0);
  });

  it("resolves the newest installed version of a shortname", () => {
    const games = [
      { name: "Game 1.9", info: { shortname: "TG", version: "1.9" } },
      { name: "Game 1.10", info: { shortname: "TG", version: "1.10" } },
      { name: "Other 9", info: { shortname: "XX", version: "9" } },
    ];
    expect(resolveGameByShortname({ shortname: "tg" }, games)?.name).toBe(
      "Game 1.10",
    );
    expect(
      resolveGameByShortname({ shortname: "nope" }, games),
    ).toBeUndefined();
  });

  it("prefers an exact pinned archive name", () => {
    const games = [
      { name: "Game 1.9", info: { shortname: "TG", version: "1.9" } },
      { name: "Game 1.10", info: { shortname: "TG", version: "1.10" } },
    ];
    expect(
      resolveGameByShortname({ shortname: "TG", pinnedName: "Game 1.9" }, games)
        ?.name,
    ).toBe("Game 1.9");
  });
});
