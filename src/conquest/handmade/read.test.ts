import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { linkKind, parseGalaxyJson } from "../model";
import { memoryTraceCache, type TraceCache, traceCacheKey } from "./cache";
import type { HandmadeMapError, HandmadeMapErrorCode } from "./errors";
import type { MapManifest } from "./manifest";
import { decodePng } from "./png.testhelper";
import { type HandmadeMapInput, hasBlankBattle, readHandmadeMap } from "./read";
import { pointInRing } from "./trace";

/** The sample folder, which the broken-folder tests copy and damage. */
const SAMPLE = fileURLToPath(
  new URL("../../../docs/examples/handmade-map/", import.meta.url),
);
const FILES = [
  "map.json",
  "picture.png",
  "provinces.png",
  "heightmap.png",
  "cairn.gltf",
  "ironcoast-siege.json",
];
const scenarioText = readFileSync(`${SAMPLE}ironcoast-siege.json`, "utf8");
const manifestText = readFileSync(`${SAMPLE}map.json`, "utf8");
const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));
const picture = decodePng(readFileSync(`${SAMPLE}picture.png`));

/** The sample as reader input, with one thing changed. */
function sample(change: Partial<HandmadeMapInput> = {}): HandmadeMapInput {
  return {
    manifest: manifestText,
    provinces,
    picture: { width: picture.width, height: picture.height },
    urlFor: (name) =>
      FILES.includes(name) ? `asset://map/${name}` : undefined,
    scenarios: { "ironcoast-siege.json": scenarioText },
    ...change,
  };
}

/** The sample manifest after `edit`, as text. */
function manifestWith(edit: (m: MapManifest) => void): string {
  const m = JSON.parse(manifestText) as MapManifest;
  edit(m);
  return JSON.stringify(m);
}

/** A copy of the province image with a block painted one colour. */
function paintedOver(
  x0: number,
  y0: number,
  size: number,
  rgb: [number, number, number],
) {
  const data = new Uint8Array(provinces.data);
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      data.set([...rgb, 255], (y * provinces.width + x) * 4);
    }
  }
  return { ...provinces, data };
}

function errorsOf(input: HandmadeMapInput): HandmadeMapError[] {
  const result = readHandmadeMap(input);
  if (result.ok) throw new Error("expected the read to fail");
  return result.errors;
}

function only<C extends HandmadeMapErrorCode>(
  errors: HandmadeMapError[],
  code: C,
): Extract<HandmadeMapError, { code: C }>[] {
  return errors.filter(
    (e): e is Extract<HandmadeMapError, { code: C }> => e.code === code,
  );
}

function readSample() {
  const result = readHandmadeMap(sample());
  if (!result.ok) {
    throw new Error(result.errors.map((e) => e.message).join("\n"));
  }
  return result.doc;
}

describe("the sample map", () => {
  const doc = readSample();
  const node = (id: string) => {
    const found = doc.nodes.find((n) => n.id === id);
    if (!found) throw new Error(`no node ${id}`);
    return found;
  };

  it("reads into a galaxy document", () => {
    expect(doc.id).toBe("sample-two-shores");
    expect(doc.type).toBe("conquest-galaxy");
    expect(doc.game).toEqual({ shortname: "SF" });
    expect(doc.nodes.map((n) => n.id)).toEqual([
      "northmarch",
      "westhaven",
      "midvale",
      "eastcliff",
      "southreach",
      "ironcoast",
      "highmoor",
      "redfield",
      "farwatch",
      "stonebridge",
    ]);
    expect(doc.playerFactionId).toBe("west");
    expect(doc.playableFactionIds).toEqual(["west", "east"]);
    expect(doc.factions[1]).toEqual({
      id: "east",
      name: "Eastern Crown",
      color: "#3fa374",
      aggression: 0.4,
    });
  });

  it("carries the terrain with URLs from the folder", () => {
    expect(doc.terrain).toEqual({
      image: "asset://map/picture.png",
      heightmap: "asset://map/heightmap.png",
      width: 1600,
      height: 960,
      heightScale: 120,
      projection: "flat",
    });
  });

  it("gives each faction one capital and leaves the rest neutral", () => {
    const capitals = doc.nodes.filter((n) => n.kind === "capital");
    expect(capitals.map((n) => [n.id, n.owner])).toEqual([
      ["westhaven", "west"],
      ["farwatch", "east"],
    ]);
    expect(node("northmarch").owner).toBe("neutral");
    expect(node("midvale").owner).toBe("west");
  });

  it("outlines every province in map units, with the anchor inside", () => {
    for (const n of doc.nodes) {
      if (n.id === "stonebridge") continue;
      const rings = n.outline ?? [];
      expect(rings.length, n.name).toBe(1);
      for (const [x, y] of rings[0]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1600);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(960);
      }
      expect(pointInRing(n.pos[0], n.pos[1], rings[0]), n.name).toBe(true);
    }
  });

  it("keeps province outlines to a modest number of points", () => {
    // The curved coasts are several hundred pixel corners as painted. The
    // largest outline measured on this sample is 16 points.
    for (const n of doc.nodes) {
      for (const ring of n.outline ?? []) {
        expect(ring.length, n.name).toBeLessThanOrEqual(16);
        expect(ring.length, n.name).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("makes the city a point location at its position", () => {
    expect(node("stonebridge").outline).toBeUndefined();
    expect(node("stonebridge").pos).toEqual([400, 640]);
  });

  it("links neighbours by border, crossing and road, and drops the blocked border", () => {
    expect(linkKind(doc, "westhaven", "midvale")).toBe("border");
    expect(linkKind(doc, "ironcoast", "eastcliff")).toBe("crossing");
    expect(linkKind(doc, "stonebridge", "southreach")).toBe("road");
    expect(linkKind(doc, "northmarch", "midvale")).toBeUndefined();
    expect(doc.blockedBorders).toEqual([["northmarch", "midvale"]]);
    // The two land masses share nothing but the crossing.
    const west = new Set([
      "northmarch",
      "westhaven",
      "midvale",
      "eastcliff",
      "southreach",
      "stonebridge",
    ]);
    const across = doc.links.filter(([a, b]) => west.has(a) !== west.has(b));
    expect(across).toEqual([["eastcliff", "ironcoast"]]);
    expect(doc.linkKinds).toHaveLength(doc.links.length);
  });

  it("marks a battle the author left out as blank, and keeps a given one", () => {
    expect(hasBlankBattle(node("midvale"))).toBe(true);
    expect(node("midvale").battle).toEqual({ mapName: "" });
    expect(hasBlankBattle(node("farwatch"))).toBe(false);
    expect(node("farwatch").battle).toEqual({
      mapName: "AcidicQuarry 5.17",
      enemyAiCount: 2,
    });
    expect(node("farwatch").difficulty).toBe(5);
    expect(node("midvale").difficulty).toBe(1);
  });

  it("passes the galaxy validator once the blank battles are filled", () => {
    const filled = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        hasBlankBattle(n) ? { ...n, battle: { mapName: "MapA" } } : n,
      ),
    };
    const parsed = parseGalaxyJson(JSON.stringify(filled));
    expect(parsed?.nodes).toHaveLength(doc.nodes.length);
    expect(parsed?.links).toHaveLength(doc.links.length);
    // With a battle still blank the validator refuses it, so nothing can
    // launch a location that has no map.
    expect(parseGalaxyJson(JSON.stringify(doc))).toBeNull();
  });

  it("places the manifest's models on the document", () => {
    expect(doc.models).toEqual([
      { model: { file: "cairn.gltf" }, pos: [440, 600], rotation: 30 },
      { model: { game: "ammobox" }, pos: [260, 520], rotation: 120 },
    ]);
  });

  it("reads with no errors and holds every feature the issue asks for", () => {
    const result = readHandmadeMap(sample());
    expect(result.ok).toBe(true);
    const manifest = JSON.parse(manifestText) as MapManifest;
    expect(manifest.provinces).toHaveLength(9);
    expect(manifest.locations).toHaveLength(1);
    expect(doc.nodes).toHaveLength(10);
    expect(doc.nodes.filter((n) => n.outline === undefined)).toHaveLength(1);
    expect(doc.linkKinds?.filter(([, , kind]) => kind === "crossing")).toEqual([
      ["eastcliff", "ironcoast", "crossing"],
    ]);
    expect(doc.linkKinds?.filter(([, , kind]) => kind === "road")).toHaveLength(
      2,
    );
    expect(doc.blockedBorders).toHaveLength(1);
    expect(doc.factions).toHaveLength(2);
    expect(doc.nodes.filter((n) => n.owner === "neutral").length).toBe(6);
    expect(doc.models).toHaveLength(2);
    expect(doc.warpath?.startId).toBe("westhaven");
    expect(doc.warpath?.goalId).toBe("farwatch");
    expect(Object.keys(doc.warpath?.kinds ?? {})).toHaveLength(2);
    expect(doc.nodes.filter((n) => n.scenario)).toHaveLength(1);
    expect(node("ironcoast").scenario).toBeDefined();
    expect(doc.terrain?.heightmap).toBeDefined();
  });

  it("takes a game model and a file in a folder inside the map folder", () => {
    const result = readHandmadeMap(
      sample({
        manifest: manifestWith((m) => {
          m.models = [
            { model: { game: "armcom" }, pos: [100, 100], scale: 2 },
            { model: { file: "models/Gate.GLB" }, pos: [0, 960], height: 5 },
          ];
        }),
        urlFor: (name) =>
          [...FILES, "models/Gate.GLB"].includes(name)
            ? `asset://map/${name}`
            : undefined,
      }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.doc.models).toEqual([
      { model: { game: "armcom" }, pos: [100, 100], scale: 2 },
      { model: { file: "models/Gate.GLB" }, pos: [0, 960], height: 5 },
    ]);
  });

  it("leaves models off a document whose manifest lists none", () => {
    const result = readHandmadeMap(
      sample({
        manifest: manifestWith((m) => {
          m.models = [];
        }),
      }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.doc.models).toBeUndefined();
  });

  it("ignores keys it does not know", () => {
    const result = readHandmadeMap(
      sample({
        manifest: manifestWith((m) => {
          (m as unknown as Record<string, unknown>).somethingNew = 1;
        }),
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("a broken map folder", () => {
  it("names a colour that is painted but not listed, and where it is", () => {
    const errors = errorsOf(
      sample({ provinces: paintedOver(40, 40, 9, [0x12, 0x34, 0x56]) }),
    );
    const [error] = only(errors, "color-not-listed");
    expect(error.color).toBe("#123456");
    expect(error.x).toBeGreaterThanOrEqual(40);
    expect(error.x).toBeLessThan(49);
    expect(error.y).toBeGreaterThanOrEqual(40);
    expect(error.y).toBeLessThan(49);
    expect(error.message).toContain("#123456");
    expect(error.message).toContain(`pixel ${error.x}, ${error.y}`);
    expect(errors).toHaveLength(1);
  });

  it("names a province that is listed but never painted", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.provinces.push({ color: "#ABCDEF", name: "Lost Isle" });
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "province-not-painted");
    expect(error.name).toBe("Lost Isle");
    expect(error.color).toBe("#abcdef");
    expect(error.message).toContain('"Lost Isle" (#abcdef)');
  });

  it("names every province cut off from the rest of the map", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.crossings = [];
        }),
      }),
    );
    // Without the crossing the eastern land mass is the smaller part.
    expect(only(errors, "unreachable").map((e) => e.name)).toEqual([
      "Ironcoast",
      "Highmoor",
      "Redfield",
      "Farwatch",
    ]);
    expect(errors[0].message).toContain('"Ironcoast" (#b55f9a)');
    expect(errors[0].message).toContain("cannot be reached");
    // The Warpath goal is on the far side, so the route is reported too.
    expect(only(errors, "warpath-route")).toHaveLength(1);
    expect(errors).toHaveLength(5);
  });

  it("names a point location with no road to it", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.roads = [];
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "unreachable");
    expect(error.name).toBe("Stonebridge");
    expect(error.color).toBeUndefined();
    expect(error.message).toContain('The location "Stonebridge"');
    expect(error.message).toContain("No road or crossing joins it.");
    expect(error.message).toContain("Add a road or a crossing to it");
    expect(error.message).not.toMatch(/paint|touch/i);
  });

  it("says when the province image and the map picture are different sizes", () => {
    const errors = errorsOf(sample({ picture: { width: 320, height: 192 } }));
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "size-mismatch");
    expect(error.provinces).toEqual({ width: 160, height: 96 });
    expect(error.picture).toEqual({ width: 320, height: 192 });
    expect(error.message).toContain("160 by 96");
    expect(error.message).toContain("320 by 192");
  });

  it("names a faction with no capital", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.provinces[8].capital = false;
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "capital-count");
    expect(error.factionName).toBe("Eastern Crown");
    expect(error.capitals).toEqual([]);
    expect(error.message).toContain('"Eastern Crown" has no capital');
  });

  it("names a faction with two capitals, and both of them", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.provinces[2].capital = true;
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "capital-count");
    expect(error.factionName).toBe("Western League");
    expect(error.capitals).toEqual(["Westhaven", "Midvale"]);
    expect(error.message).toContain("2 capitals: Westhaven, Midvale");
  });

  it("reports the manifest and image problems in one pass", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.provinces[8].capital = false;
          m.files.heightmap = "missing.png";
          m.blockedBorders?.push(["westhaven", "farwatch"]);
        }),
        provinces: paintedOver(40, 40, 9, [0x12, 0x34, 0x56]),
        picture: { width: 10, height: 10 },
      }),
    );
    expect(errors.map((e) => e.code).sort()).toEqual([
      "blocked-border-not-touching",
      "capital-count",
      "color-not-listed",
      "file-missing",
      "size-mismatch",
    ]);
  });

  it("says when map.json is not JSON", () => {
    const errors = errorsOf(sample({ manifest: "{ not json" }));
    expect(errors.map((e) => e.code)).toEqual(["manifest-json"]);
  });

  it("lists every missing or wrong key at once", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          const raw = m as unknown as Record<string, unknown>;
          raw.title = undefined;
          raw.size = { width: 0, height: 960 };
          raw.files = { picture: "../picture.png", provinces: "provinces.png" };
          m.provinces[0].color = "red";
          m.provinces[1].difficulty = 9;
          m.provinces[2].owner = "north";
          m.provinces[3].battle = { mapName: "" };
        }),
      }),
    );
    expect(only(errors, "manifest-field").map((e) => e.path)).toEqual([
      "title",
      "size.width",
      "files.picture",
      'provinces[0] ("Northmarch").color',
      'provinces[1] ("Westhaven").difficulty',
      'provinces[2] ("Midvale").owner',
      'provinces[3] ("Eastcliff").battle.mapName',
    ]);
    expect(errors).toHaveLength(7);
    expect(errors[5].message).toContain('"north" is not a faction id');
  });

  it("refuses a manifest written for a newer coilbox", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          (m as unknown as Record<string, unknown>).formatVersion = 2;
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Update coilbox");
  });

  it("names two provinces listed with one colour", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.provinces[1].color = m.provinces[0].color;
        }),
      }),
    );
    const [error] = only(errors, "duplicate-color");
    expect(error.message).toContain('"Northmarch" and "Westhaven"');
    expect(error.message).toContain("#c85050");
  });

  it("names two locations that end up with one id", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.locations?.push({ name: "Midvale", pos: [10, 10] });
        }),
      }),
    );
    const [error] = only(errors, "duplicate-id");
    expect(error.id).toBe("midvale");
    expect(errors).toHaveLength(1);
  });

  it("names a file the folder does not hold", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.files.picture = "europe.png";
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    expect(only(errors, "file-missing")[0].file).toBe("europe.png");
  });

  it("names a model file the folder does not hold", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.models?.push({ model: { file: "tower.glb" }, pos: [10, 10] });
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "file-missing");
    expect(error.file).toBe("tower.glb");
    expect(error.message).toContain(
      'models[2] names the model file "tower.glb"',
    );
  });

  it("names a model file that is not glTF", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.models = [{ model: { file: "tower.obj" }, pos: [10, 10] }];
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "manifest-field");
    expect(error.path).toBe('models[0] ("tower.obj").model.file');
    expect(error.message).toContain("must end in .gltf or .glb");
  });

  it("names a model placed outside the map", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.models?.push({ model: { game: "armcom" }, pos: [1700, 20] });
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "manifest-field");
    expect(error.path).toBe('models[2] ("armcom").pos');
    expect(error.message).toContain("outside the map (1600 by 960)");
  });

  it("lists every malformed model entry and does not drop one unsaid", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          (m as unknown as Record<string, unknown>).models = [
            "cairn.gltf",
            { pos: [10, 10] },
            { model: { file: "cairn.gltf", game: "armcom" }, pos: [10, 10] },
            { model: { game: " " }, pos: [10, 10] },
            { model: { file: "../cairn.gltf" }, pos: [10, 10] },
            { model: { file: "cairn.gltf" } },
            {
              model: { file: "cairn.gltf" },
              pos: [10, 10],
              height: "high",
              rotation: null,
              scale: 0,
            },
          ];
        }),
      }),
    );
    expect(only(errors, "manifest-field").map((e) => e.path)).toEqual([
      "models[0]",
      "models[1].model",
      'models[2] ("cairn.gltf").model',
      "models[3].model.game",
      'models[4] ("../cairn.gltf").model.file',
      'models[5] ("cairn.gltf").pos',
      'models[6] ("cairn.gltf").height',
      'models[6] ("cairn.gltf").rotation',
      'models[6] ("cairn.gltf").scale',
    ]);
    expect(errors).toHaveLength(9);
  });

  it("says when models is not a list", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          (m as unknown as Record<string, unknown>).models = {};
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    expect(only(errors, "manifest-field")[0].path).toBe("models");
  });

  it("names a crossing to a location that does not exist", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.crossings?.push(["eastcliff", "atlantis"]);
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "unknown-location");
    expect(error.list).toBe("crossings");
    expect(error.id).toBe("atlantis");
  });

  it("names a blocked border between provinces that do not touch", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.blockedBorders?.push(["westhaven", "farwatch"]);
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "blocked-border-not-touching");
    expect(error.message).toContain('"Westhaven" (#d9a441)');
    expect(error.message).toContain('"Farwatch" (#3fa374)');
  });

  it("names a pair that is both blocked and joined", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.roads?.push(["midvale", "northmarch"]);
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "link-conflict");
    expect(error.message).toContain("a blocked border and a road");
  });
});

describe("Warpath markings", () => {
  it("puts the start, the goal and the marked kinds on the document", () => {
    expect(readSample().warpath).toEqual({
      startId: "westhaven",
      goalId: "farwatch",
      kinds: { eastcliff: "shop", ironcoast: "battle" },
    });
  });

  it("reads a map with neither end as one for Conquest only", () => {
    const result = readHandmadeMap(
      sample({
        manifest: manifestWith((m) => {
          delete m.warpath;
        }),
      }),
    );
    if (!result.ok) throw new Error("expected the read to pass");
    expect(result.doc.warpath).toBeUndefined();
  });

  it("keeps the markings out of a saved galaxy", () => {
    const doc = readSample();
    const filled = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        hasBlankBattle(n) ? { ...n, battle: { mapName: "MapA" } } : n,
      ),
    };
    const parsed = parseGalaxyJson(JSON.stringify(filled));
    expect(parsed).not.toBeNull();
    expect(parsed?.warpath).toBeUndefined();
  });

  it("names the start and the goal when one cannot be reached from the other", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.crossings = [];
        }),
      }),
    );
    const [error] = only(errors, "warpath-route");
    expect(error.startId).toBe("westhaven");
    expect(error.goalId).toBe("farwatch");
    expect(error.message).toContain('the start "Westhaven" (#d9a441)');
    expect(error.message).toContain('the goal "Farwatch" (#3fa374)');
  });

  it("refuses a start and a goal that are one location", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.warpath = { start: "midvale", goal: "midvale" };
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "warpath-same-location");
    expect(error.name).toBe("Midvale");
    expect(error.message).toContain('both "Midvale"');
  });

  it("names a location marked with a kind Warpath does not know", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          (m.provinces[2] as { warpath?: unknown }).warpath = { kind: "shpo" };
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "warpath-kind");
    expect(error.name).toBe("Midvale");
    expect(error.kind).toBe("shpo");
    expect(error.message).toContain('"Midvale" has the Warpath kind "shpo"');
    expect(error.message).toContain("battle, elite, shop, event, reward");
  });

  it.each([
    ["start", "goal"],
    ["goal", "start"],
  ] as const)("refuses a %s with no %s", (has, missing) => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.warpath = { [has]: "westhaven" };
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "warpath-one-end");
    expect(error.missing).toBe(missing);
    expect(error.message).toContain(`a ${has} and no ${missing}`);
  });

  it("names a start that is not the id of any location", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.warpath = { start: "atlantis", goal: "farwatch" };
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "warpath-unknown-location");
    expect(error.end).toBe("start");
    expect(error.id).toBe("atlantis");
  });

  it("refuses a kind on the start or the goal", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          m.provinces[1].warpath = { kind: "shop" };
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    const [error] = only(errors, "warpath-kind-on-end");
    expect(error.end).toBe("start");
    expect(error.message).toContain('"Westhaven" is the Warpath start');
  });

  it("says when warpath is not an object", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          (m as unknown as Record<string, unknown>).warpath = "westhaven";
        }),
      }),
    );
    expect(only(errors, "manifest-field").map((e) => e.path)).toEqual([
      "warpath",
    ]);
  });
});

describe("caching", () => {
  /** A cache that counts how often a trace was stored. */
  function counting(): TraceCache & { stored: number } {
    const inner = memoryTraceCache();
    const cache = {
      stored: 0,
      get: inner.get,
      set: (key: string, value: Parameters<TraceCache["set"]>[1]) => {
        cache.stored++;
        inner.set(key, value);
      },
    };
    return cache;
  }

  it("traces a map once and serves the same document after that", () => {
    const cache = counting();
    const first = readHandmadeMap(sample({ cache }));
    const second = readHandmadeMap(sample({ cache }));
    expect(cache.stored).toBe(1);
    expect(second).toEqual(first);
  });

  it("traces again when the province image changes", () => {
    const cache = counting();
    readHandmadeMap(sample({ cache }));
    // One sea pixel in Eastcliff's colour: a speck, so the map still reads.
    const result = readHandmadeMap(
      sample({ cache, provinces: paintedOver(85, 46, 1, [0x4f, 0x9d, 0xa6]) }),
    );
    expect(result.ok).toBe(true);
    expect(cache.stored).toBe(2);
  });

  it("traces again when the manifest changes", () => {
    const cache = counting();
    readHandmadeMap(sample({ cache }));
    readHandmadeMap(
      sample({
        cache,
        manifest: manifestWith((m) => {
          m.title = "Two Shores, second edition";
        }),
      }),
    );
    expect(cache.stored).toBe(2);
  });

  it("keys on the manifest text and every pixel", () => {
    const key = traceCacheKey(manifestText, provinces);
    expect(traceCacheKey(manifestText, provinces)).toBe(key);
    expect(traceCacheKey(`${manifestText} `, provinces)).not.toBe(key);
    expect(
      traceCacheKey(manifestText, paintedOver(0, 0, 1, [1, 2, 3])),
    ).not.toBe(key);
  });
});

describe("the towns switch", () => {
  const read = (edit: (m: Record<string, unknown>) => void) => {
    const m = JSON.parse(manifestText) as Record<string, unknown>;
    edit(m);
    return readHandmadeMap(sample({ manifest: JSON.stringify(m) }));
  };

  it("is on in the sample and sits on the document's handmade block", () => {
    const doc = readSample();
    expect(doc.handmade?.towns).toBe(true);
  });

  it("is off when absent or false, with no key on the document", () => {
    for (const edit of [
      (m: Record<string, unknown>) => {
        delete m.towns;
      },
      (m: Record<string, unknown>) => {
        m.towns = false;
      },
    ]) {
      const result = read(edit);
      if (!result.ok) throw new Error("the read failed");
      expect(result.doc.handmade).toBeDefined();
      expect("towns" in (result.doc.handmade ?? {})).toBe(false);
    }
  });

  it("draws nothing else differently, so the rest of the document is the same", () => {
    const on = readSample();
    const off = read((m) => {
      delete m.towns;
    });
    if (!off.ok) throw new Error("the read failed");
    const { towns: _towns, ...handmade } = on.handmade ?? { mapId: "" };
    expect({ ...on, handmade }).toEqual(off.doc);
  });

  it("refuses a value that is not true or false", () => {
    for (const bad of ["yes", 1, null, {}]) {
      const errors = errorsOf(
        sample({
          manifest: manifestWith((m) => {
            (m as unknown as Record<string, unknown>).towns = bad;
          }),
        }),
      );
      const found = only(errors, "manifest-field");
      expect(found.map((e) => e.path)).toEqual(["towns"]);
      expect(found[0].message).toBe(
        "map.json: towns must be true or false.",
      );
    }
  });

  it("is not read back from a saved document", () => {
    const doc = readSample();
    expect(parseGalaxyJson(JSON.stringify(doc))?.handmade).toBeUndefined();
  });
});
