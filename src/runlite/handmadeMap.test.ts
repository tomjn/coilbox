import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapManifest } from "../conquest/handmade/manifest";
import { decodePng } from "../conquest/handmade/png.testhelper";
import {
  type HandmadeMapResult,
  readHandmadeMap,
} from "../conquest/handmade/read";
import type { GalaxyDoc } from "../conquest/model";
import {
  decodeWarpathChallenge,
  encodeWarpathChallenge,
  runFromChallenge,
} from "./challenge";
import type { GenRunMap } from "./generate";
import { type GenerateMapRunOpts, generateMapRun } from "./mapRun";
import type { RogueliteRun } from "./model";

const hoisted = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../conquest/handmade/library", () => ({
  loadHandmadeMap: hoisted.load,
}));
vi.mock("../conquest/handmade/useHandmadeMaps", () => ({
  useHandmadeMap: vi.fn(),
}));

const { handmadeRunSource, loadHandmadeRunMap } = await import("./handmadeMap");

const SAMPLE = fileURLToPath(
  new URL("../../docs/examples/handmade-map/", import.meta.url),
);
const manifestText = readFileSync(`${SAMPLE}map.json`, "utf8");
const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));

function read(edit: (m: MapManifest) => void = () => {}): HandmadeMapResult {
  const m = JSON.parse(manifestText) as MapManifest;
  edit(m);
  return readHandmadeMap({
    manifest: JSON.stringify(m),
    provinces,
    picture: { width: provinces.width, height: provinces.height },
    urlFor: (name) => `coilbox://sample/${name}`,
  });
}

/** The sample map as the reader gives it, after `edit`. */
function readSample(edit?: (m: MapManifest) => void): GalaxyDoc {
  const result = read(edit);
  if (!result.ok) {
    throw new Error(result.errors.map((e) => e.message).join("\n"));
  }
  return result.doc;
}

const MAPS: GenRunMap[] = [
  { name: "Small", size: 64, mapDownload: { springName: "Small" } },
  { name: "Medium", size: 256 },
  { name: "Huge", size: 1024 },
];

const SEEDS = Array.from({ length: 25 }, (_, i) => i * 7919 + 1);

function runOn(
  doc: GalaxyDoc,
  seed: number,
  change: Partial<GenerateMapRunOpts> = {},
): RogueliteRun {
  const source = handmadeRunSource(doc);
  if (!source) throw new Error("expected a map with Warpath markings");
  return generateMapRun({
    seed,
    length: "standard",
    difficulty: 2,
    game: doc.game,
    factionId: "player",
    skin: "theatre",
    maps: MAPS,
    now: "2026-10-05T00:00:00.000Z",
    ...source,
    ...change,
  });
}

const at = (run: RogueliteRun, location: string) => {
  const node = run.nodes.find((n) => n.location === location);
  if (!node) throw new Error(`no run node at ${location}`);
  return node;
};

describe("a Warpath run on the sample map", () => {
  const doc = readSample();

  it("starts at the author's start and ends at the author's goal", () => {
    for (const seed of SEEDS) {
      const run = runOn(doc, seed);
      expect(at(run, "westhaven").type).toBe("start");
      expect(at(run, "farwatch").type).toBe("boss");
      expect(run.progress.currentNodeId).toBe(at(run, "westhaven").id);
      expect(run.settings.map).toEqual({
        source: "handmade",
        id: "sample-two-shores",
      });
    }
  });

  it("can be walked from the start to the goal by forward steps", () => {
    const run = runOn(doc, 42);
    const goal = at(run, "farwatch").id;
    const seen = new Set([run.progress.currentNodeId]);
    const queue = [run.progress.currentNodeId];
    for (let head = 0; head < queue.length; head++) {
      for (const [a, b] of run.edges) {
        if (a !== queue[head] || seen.has(b)) continue;
        seen.add(b);
        queue.push(b);
      }
    }
    expect(seen.has(goal)).toBe(true);
    // Every location on the route can be reached, and none is a dead end.
    expect(seen.size).toBe(run.nodes.length);
    for (const node of run.nodes) {
      if (node.id === goal) continue;
      expect(run.edges.some(([a]) => a === node.id)).toBe(true);
    }
  });

  it("makes the location marked as a shop a shop on every seed", () => {
    for (const seed of SEEDS) {
      const node = at(runOn(doc, seed), "eastcliff");
      expect(node.type).toBe("shop");
      expect(node.shop).toBeDefined();
    }
  });

  it("never makes that location a shop when the author did not mark it", () => {
    const unmarked = readSample((m) => {
      delete m.provinces[3].warpath;
    });
    expect(unmarked.warpath?.kinds).toEqual({});
    for (const seed of SEEDS) {
      expect(at(runOn(unmarked, seed), "eastcliff").type).not.toBe("shop");
    }
  });

  it("fights the author's battle where one is set", () => {
    for (const seed of SEEDS) {
      const boss = at(runOn(doc, seed), "farwatch");
      expect(boss.battle?.mapName).toBe("MapB");
      expect(boss.battle?.enemyAiCount).toBe(2);
      // The map is the author's, so the generated map's download hint goes.
      expect(boss.battle?.mapDownload).toBeUndefined();
    }
  });

  it("keeps the generated encounter's own values where the author gave none", () => {
    const run = runOn(doc, 42);
    const plain = runOn(doc, 42, { battles: {} });
    const boss = at(run, "farwatch").battle;
    const generated = at(plain, "farwatch").battle;
    expect(MAPS.map((m) => m.name)).toContain(generated?.mapName);
    expect(boss?.handicap).toBe(generated?.handicap);
    expect(boss?.techTier).toBe(generated?.techTier);
  });

  it("generates an encounter for a location with no battle", () => {
    for (const seed of SEEDS) {
      const run = runOn(doc, seed);
      for (const node of run.nodes) {
        if (!node.battle || node.location === "farwatch") continue;
        expect(MAPS.map((m) => m.name)).toContain(node.battle.mapName);
      }
    }
  });

  it("takes the same draws with and without the author's battles", () => {
    const strip = (run: RogueliteRun) =>
      run.nodes.map(({ battle: _battle, ...rest }) => rest);
    expect(strip(runOn(doc, 42))).toEqual(
      strip(runOn(doc, 42, { battles: {} })),
    );
  });

  it("is rebuilt from a challenge code when the map can be looked up", () => {
    // The importing install has the author's maps too, so none is stood in for.
    const maps = [...MAPS, { name: "MapA" }, { name: "MapB" }];
    const run = runOn(doc, 42, { maps });
    const decoded = decodeWarpathChallenge(encodeWarpathChallenge(run));
    if (!decoded.ok) throw new Error("expected a successful decode");
    const imported = runFromChallenge(decoded.settings, {
      maps,
      handmadeMap: (id) => (id === doc.id ? handmadeRunSource(doc) : null),
    });
    expect(imported.nodes).toEqual(run.nodes);
    expect(imported.edges).toEqual(run.edges);
  });
});

describe("handmadeRunSource", () => {
  it("is null for a map with no start and goal", () => {
    const doc = readSample((m) => {
      delete m.warpath;
    });
    expect(handmadeRunSource(doc)).toBeNull();
  });

  it("carries only the battles the author set", () => {
    const source = handmadeRunSource(readSample());
    expect(Object.keys(source?.battles ?? {}).sort()).toEqual([
      "farwatch",
      "westhaven",
    ]);
  });
});

describe("loadHandmadeRunMap", () => {
  beforeEach(() => {
    hoisted.load.mockReset();
  });

  it("gives the run source of a map with markings", async () => {
    hoisted.load.mockResolvedValue(read());
    const loaded = await loadHandmadeRunMap("sample-two-shores");
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.source.startId).toBe("westhaven");
    expect(loaded.source.goalId).toBe("farwatch");
    expect(loaded.source.kinds).toEqual({ eastcliff: "shop" });
  });

  it("says a map with no markings is for Conquest only", async () => {
    hoisted.load.mockResolvedValue(
      read((m) => {
        delete m.warpath;
      }),
    );
    const loaded = await loadHandmadeRunMap("sample-two-shores");
    expect(loaded).toEqual({
      ok: false,
      message:
        'The hand-made map "Two Shores" has no Warpath start and goal, so it can only be played in Conquest.',
    });
  });

  it("passes on the library's sentence for a map that is not installed", async () => {
    hoisted.load.mockResolvedValue({
      ok: false,
      errors: [
        {
          code: "file-missing",
          file: "map.json",
          message: 'No hand-made map with the id "gone" is installed.',
        },
      ],
    });
    expect(await loadHandmadeRunMap("gone")).toEqual({
      ok: false,
      message: 'No hand-made map with the id "gone" is installed.',
    });
  });

  it("gives the reader's first error and counts the rest", async () => {
    hoisted.load.mockResolvedValue(
      read((m) => {
        m.crossings = [];
      }),
    );
    const loaded = await loadHandmadeRunMap("sample-two-shores");
    if (loaded.ok) throw new Error("expected the load to fail");
    expect(loaded.message).toContain(
      'The hand-made map "sample-two-shores" could not be read.',
    );
    expect(loaded.message).toContain('"Ironcoast" (#b55f9a)');
    expect(loaded.message).toContain("There are 4 more problems with it.");
  });

  it("says when the map folders could not be listed", async () => {
    hoisted.load.mockRejectedValue(new Error("disk unplugged"));
    expect(await loadHandmadeRunMap("sample-two-shores")).toEqual({
      ok: false,
      message: "The hand-made maps could not be listed. disk unplugged",
    });
  });
});
