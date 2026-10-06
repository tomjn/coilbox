import { describe, expect, it } from "vitest";
import type { GalaxyDoc } from "./model";
import {
  linkKind,
  newConquestState,
  parseConquestStateFile,
  parseGalaxyJson,
  reconcileState,
  wrapGalaxyForExport,
} from "./model";
import { generatedTerrain, generateTerritories } from "./territories";

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
  it("opens a save with a planet nobody defined as Temperate", () => {
    const opts = {
      seed: 5,
      game: { shortname: "TG" },
      maps: [{ name: "M", width: 8, height: 8 }],
      nodeCount: 12,
      factionCount: 2,
    };
    const plain = generateTerritories(opts, "t0");
    const unknown = {
      ...plain,
      generated: { ...plain.generated, planet: "pluto" },
    } as unknown as GalaxyDoc;
    const want = generatedTerrain(plain);
    const parsed = parseGalaxyJson(JSON.stringify(unknown));
    if (!parsed || !want) throw new Error("expected a generated map");
    // Through the parser the unknown planet is dropped.
    const viaParser = generatedTerrain(parsed);
    expect(viaParser?.planet).toBe("temperate");
    expect(viaParser?.land).toEqual(want.land);
    expect(viaParser?.heightmap).toEqual(want.heightmap);
    // Without the parser, resolvePlanet is the last line of defence.
    const direct = generatedTerrain(unknown);
    expect(direct?.planet).toBe("temperate");
    expect(direct?.land).toEqual(want.land);
    expect(direct?.heightmap).toEqual(want.heightmap);
  }, 60_000);

  it("keeps a known planet and drops an unknown one", () => {
    const planetOf = (planet: string) =>
      parseGalaxyJson(
        JSON.stringify(galaxy({ generated: { seed: 1, planet } as never })),
      )?.generated?.planet;
    expect(planetOf("moon")).toBe("moon");
    expect(planetOf("random")).toBe("random");
    expect(planetOf("pluto")).toBeUndefined();
  });

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
    expect(parsed?.generated?.nodeCount).toBe(160);
  });

  it("filters playableFactionIds to known factions", () => {
    const doc = galaxy({ playableFactionIds: ["p", "e", "zz"] });
    expect(parseGalaxyJson(JSON.stringify(doc))?.playableFactionIds).toEqual([
      "p",
      "e",
    ]);
  });
});

/** A land map: three provinces in a row and a city reached by road. */
function landMap(overrides: Partial<GalaxyDoc> = {}): GalaxyDoc {
  const base = galaxy();
  const square = (x: number): [number, number][][] => [
    [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
      [x, 10],
    ],
  ];
  return {
    ...base,
    nodes: [
      { ...base.nodes[0], pos: [5, 5], outline: square(0) },
      { ...base.nodes[1], pos: [15, 5], outline: square(10) },
      {
        ...base.nodes[2],
        pos: [25, 5],
        outline: [...square(20), ...square(40)],
      },
      {
        id: "d",
        name: "D",
        pos: [35, 5],
        owner: "neutral",
        difficulty: 1,
        battle: { mapName: "MapD" },
      },
    ],
    links: [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
    ],
    terrain: {
      image: "data:image/png;base64,AAAA",
      heightmap: "generated:territories",
      width: 50,
      height: 10,
      heightScale: 8,
      projection: "flat",
    },
    linkKinds: [
      ["a", "b", "border"],
      ["c", "d", "road"],
    ],
    blockedBorders: [["a", "c"]],
    ...overrides,
  };
}

/** Parse a raw document and return the reason it was refused, if it was. */
function refusal(raw: unknown): string | undefined {
  let reason: string | undefined;
  const parsed = parseGalaxyJson(JSON.stringify(raw), (r) => {
    reason = r;
  });
  expect(parsed).toBeNull();
  return reason;
}

describe("parseGalaxyJson map fields", () => {
  it("round-trips outlines, terrain, link kinds and blocked borders", () => {
    const doc = landMap();
    expect(parseGalaxyJson(JSON.stringify(doc))).toEqual(doc);
  });

  it("round-trips them through the export wrapper", () => {
    const doc = landMap();
    const wrapped = JSON.stringify(wrapGalaxyForExport(doc));
    expect(parseGalaxyJson(wrapped)).toEqual(doc);
  });

  it("leaves a document with none of them as it was", () => {
    const parsed = parseGalaxyJson(JSON.stringify(galaxy()));
    expect(parsed?.terrain).toBeUndefined();
    expect(parsed?.linkKinds).toBeUndefined();
    expect(parsed?.blockedBorders).toBeUndefined();
    expect(parsed?.nodes.every((n) => n.outline === undefined)).toBe(true);
  });

  it("refuses a location that cannot be reached and names it", () => {
    const doc = landMap({ linkKinds: [["a", "b", "border"]] });
    doc.links = [
      ["a", "b"],
      ["b", "c"],
    ];
    expect(refusal(doc)).toBe(
      'location "d" (D) cannot be reached from the rest of the map',
    );
  });

  it("names the stray location when it is the first one listed", () => {
    const doc = galaxy({ links: [["b", "c"]] });
    expect(refusal(doc)).toBe(
      'location "a" (A) cannot be reached from the rest of the map',
    );
  });

  it("refuses a projection other than flat", () => {
    const doc = landMap();
    const raw = { ...doc, terrain: { ...doc.terrain, projection: "globe" } };
    expect(refusal(raw)).toBe(
      'terrain projection "globe" is not supported, only "flat" is',
    );
  });

  it("refuses terrain without an image or a size above 0", () => {
    const doc = landMap();
    expect(refusal({ ...doc, terrain: { ...doc.terrain, image: "" } })).toBe(
      "terrain has no image",
    );
    for (const bad of [{ width: 0 }, { height: -1 }, { width: "50" }]) {
      expect(refusal({ ...doc, terrain: { ...doc.terrain, ...bad } })).toBe(
        "terrain width and height must be numbers above 0",
      );
    }
    expect(refusal({ ...doc, terrain: "map.png" })).toBe(
      "terrain is not an object",
    );
  });

  it("takes any non-empty string as a terrain image", () => {
    const doc = landMap();
    const terrain = {
      image: "generated:cities",
      width: 50,
      height: 10,
    };
    const parsed = parseGalaxyJson(JSON.stringify({ ...doc, terrain }));
    expect(parsed?.terrain).toEqual(terrain);
  });

  it("refuses an outline polygon with fewer than 3 points", () => {
    const doc = landMap();
    doc.nodes[1].outline = [
      [
        [0, 0],
        [1, 1],
      ],
    ];
    expect(refusal(doc)).toBe(
      'location "b" has an outline that is not a list of polygons of 3 or more [x, y] points',
    );
  });

  it("refuses an outline that is not polygons of points", () => {
    for (const outline of [
      [],
      "square",
      [
        [
          [0, 0],
          [1, "1"],
          [2, 2],
        ],
      ],
    ]) {
      const raw = JSON.parse(JSON.stringify(landMap()));
      raw.nodes[0].outline = outline;
      expect(refusal(raw)).toContain('location "a" has an outline');
    }
  });

  it("refuses a link kind for a pair that is not a link", () => {
    expect(refusal(landMap({ linkKinds: [["a", "c", "crossing"]] }))).toBe(
      "linkKinds names a and c, which are not linked in links",
    );
    expect(refusal(landMap({ linkKinds: [["a", "zz", "road"]] }))).toBe(
      "linkKinds names a and zz, which are not linked in links",
    );
  });

  it("refuses a link kind it does not know", () => {
    const raw = { ...landMap(), linkKinds: [["a", "b", "tunnel"]] };
    expect(refusal(raw)).toBe(
      'linkKinds gives a and b the kind "tunnel", which is not border, crossing or road',
    );
  });

  it("refuses a blocked border that is also a link", () => {
    expect(refusal(landMap({ blockedBorders: [["b", "a"]] }))).toBe(
      "blockedBorders names b and a, which are also linked in links",
    );
  });

  it("refuses a blocked border naming an unknown location", () => {
    expect(refusal(landMap({ blockedBorders: [["a", "zz"]] }))).toBe(
      "blockedBorders names zz, which is not a location",
    );
  });

  it("refuses link kinds and blocked borders of the wrong shape", () => {
    const doc = landMap();
    expect(refusal({ ...doc, linkKinds: "border" })).toBe(
      "linkKinds is not a list",
    );
    expect(refusal({ ...doc, linkKinds: [["a"]] })).toBe(
      "linkKinds has an entry that is not [id, id, kind]",
    );
    expect(refusal({ ...doc, blockedBorders: {} })).toBe(
      "blockedBorders is not a list",
    );
    expect(refusal({ ...doc, blockedBorders: [["a", "a"]] })).toBe(
      "blockedBorders has an entry that is not two different ids",
    );
  });

  it("still refuses a faction with two capitals", () => {
    const doc = landMap();
    doc.nodes[3] = { ...doc.nodes[3], owner: "e", kind: "capital" };
    expect(parseGalaxyJson(JSON.stringify(doc))).toBeNull();
  });
});

describe("linkKind", () => {
  it("finds a link's kind in either order", () => {
    const doc = landMap();
    expect(linkKind(doc, "a", "b")).toBe("border");
    expect(linkKind(doc, "b", "a")).toBe("border");
    expect(linkKind(doc, "d", "c")).toBe("road");
  });

  it("is undefined for a link with no stated kind and for a plain galaxy", () => {
    expect(linkKind(landMap(), "b", "c")).toBeUndefined();
    expect(linkKind(galaxy(), "a", "b")).toBeUndefined();
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

describe("parseConquestStateFile", () => {
  it("reads an empty string and the plugin default as no conquests", () => {
    for (const text of ["", "  \n", '{"schemaVersion":1,"conquests":{}}']) {
      expect(parseConquestStateFile(text).conquests).toEqual({});
    }
  });

  it("fails on text that is not JSON", () => {
    expect(() => parseConquestStateFile("not json")).toThrow(/not valid JSON/);
  });

  it("fails on JSON of the wrong shape", () => {
    for (const text of ["[]", "null", "42", '"text"', "true"]) {
      expect(() => parseConquestStateFile(text)).toThrow(/not a JSON object/);
    }
    for (const text of ["{}", '{"conquests":[]}', '{"conquests":null}']) {
      expect(() => parseConquestStateFile(text)).toThrow(/no conquests object/);
    }
  });

  it("fails on a file made by a newer version", () => {
    expect(() =>
      parseConquestStateFile('{"schemaVersion":2,"conquests":{}}'),
    ).toThrow(/newer version of coilbox/);
  });

  it("passes the saved runs through untouched", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      conquests: { g1: { seed: 1, extra: true } },
    });
    expect(parseConquestStateFile(text)).toEqual(JSON.parse(text));
  });
});
