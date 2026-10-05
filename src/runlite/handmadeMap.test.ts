import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeChallenge } from "../challenge/code";
import { runIdentity, warpathIdentity } from "../challenge/identity";
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

const { handmadeRunSource, loadChallengeRunMap, loadHandmadeRunMap } =
  await import("./handmadeMap");
const { runNodeScenario } = await import("./mapRun");
const { parseRunStateFile } = await import("./model");

const SAMPLE = fileURLToPath(
  new URL("../../docs/examples/handmade-map/", import.meta.url),
);
const manifestText = readFileSync(`${SAMPLE}map.json`, "utf8");
const scenarioText = readFileSync(`${SAMPLE}ironcoast-siege.json`, "utf8");
const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));

function read(edit: (m: MapManifest) => void = () => {}): HandmadeMapResult {
  const m = JSON.parse(manifestText) as MapManifest;
  edit(m);
  return readHandmadeMap({
    manifest: JSON.stringify(m),
    provinces,
    picture: { width: provinces.width, height: provinces.height },
    urlFor: (name) => `coilbox://sample/${name}`,
    scenarios: { "ironcoast-siege.json": scenarioText },
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
        fingerprint: doc.handmade?.fingerprint,
        title: "Two Shores",
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
      // Ironcoast is left to the seed too. It is then the depot before the
      // goal, which is what keeps a depot off Eastcliff.
      delete m.provinces[5].warpath;
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
        // Farwatch has the author's battle, and Ironcoast its scenario's map.
        if (!node.battle || node.location === "farwatch" || node.scenario) {
          continue;
        }
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
    const maps = [
      ...MAPS,
      { name: "MapA" },
      { name: "MapB" },
      { name: "Comet Catcher Redux" },
    ];
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
    // Ironcoast names a scenario, and its battle is the scenario's map.
    expect(Object.keys(source?.battles ?? {}).sort()).toEqual([
      "farwatch",
      "ironcoast",
      "westhaven",
    ]);
    expect(source?.battles?.ironcoast).toEqual({
      mapName: "Comet Catcher Redux",
    });
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
    expect(loaded.source.kinds).toEqual({
      eastcliff: "shop",
      ironcoast: "battle",
    });
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

/** The sample with its strait turned into a road: another version of the map. */
const otherVersion = (m: MapManifest) => {
  m.crossings = [];
  m.roads = [...(m.roads ?? []), ["eastcliff", "ironcoast"]];
};

describe("a Warpath challenge on a hand-made map", () => {
  const doc = readSample();
  const maps = [...MAPS, { name: "MapA" }, { name: "MapB" }];
  const run = runOn(doc, 42, { maps });
  const decode = (code: string) => {
    const decoded = decodeWarpathChallenge(code);
    if (!decoded.ok) throw new Error("expected a successful decode");
    return decoded.settings;
  };
  const settings = decode(encodeWarpathChallenge(run));

  it("carries the map's id, fingerprint and title", () => {
    expect(settings.map).toEqual({
      source: "handmade",
      id: "sample-two-shores",
      fingerprint: doc.handmade?.fingerprint,
      title: "Two Shores",
    });
  });

  it("has the map's id and fingerprint in its identity, and not its title", () => {
    const identity = warpathIdentity(settings);
    expect(identity).toBe(runIdentity(run));
    expect(identity).toContain('"sample-two-shores"');
    expect(identity).toContain(`"${doc.handmade?.fingerprint}"`);
    expect(identity).not.toContain("Two Shores");
  });

  it("is another challenge on another version of the map", () => {
    const other = runOn(readSample(otherVersion), 42, { maps });
    expect(runIdentity(other)).not.toBe(runIdentity(run));
  });

  it("is not built on another version of the map", () => {
    const other = readSample(otherVersion);
    expect(() =>
      runFromChallenge(settings, {
        maps,
        handmadeMap: () => handmadeRunSource(other),
      }),
    ).toThrow(/different version/);
  });

  it("keeps the identity it had when it was written before fingerprints", () => {
    // What main wrote for a run on a hand-made map before this: the id alone.
    const { map: _map, ...rest } = run.settings;
    const old = decode(
      encodeChallenge("warpath", {
        ...rest,
        map: { source: "handmade", id: "sample-two-shores" },
      }),
    );
    expect(old.map).toEqual({ source: "handmade", id: "sample-two-shores" });
    expect(warpathIdentity(old)).toBe(
      JSON.stringify([
        "warpath",
        old.game.shortname,
        old.seed,
        old.length,
        old.difficulty,
        old.ascension,
        old.factionId,
        old.side ?? null,
        old.skin,
        ["handmade", "sample-two-shores"],
      ]),
    );
    // With no fingerprint to hold it to, it is built on the map installed.
    const imported = runFromChallenge(old, {
      maps,
      handmadeMap: () => handmadeRunSource(readSample(otherVersion)),
    });
    expect(imported.settings.map).toEqual(old.map);
  });
});

describe("loadChallengeRunMap", () => {
  const doc = readSample();
  const ref = {
    source: "handmade" as const,
    id: "sample-two-shores",
    fingerprint: doc.handmade?.fingerprint,
    title: "Two Shores",
  };
  beforeEach(() => {
    hoisted.load.mockReset();
  });

  it("gives the run source when the installed map is the challenge's version", async () => {
    hoisted.load.mockResolvedValue(read());
    const loaded = await loadChallengeRunMap(ref, "Test Game");
    if (!loaded.ok) throw new Error(loaded.message);
    expect(hoisted.load).toHaveBeenCalledWith("sample-two-shores");
    expect(loaded.source.startId).toBe("westhaven");
    expect(loaded.source.map.handmade?.fingerprint).toBe(ref.fingerprint);
  });

  it("says which map and game are needed when the map is not installed", async () => {
    hoisted.load.mockResolvedValue({
      ok: false,
      errors: [
        {
          code: "file-missing",
          file: "map.json",
          message:
            'No hand-made map with the id "sample-two-shores" is installed.',
        },
      ],
    });
    const loaded = await loadChallengeRunMap(ref, "Test Game");
    if (loaded.ok) throw new Error("expected a refusal");
    expect(loaded.message).toContain('the hand-made map "Two Shores"');
    expect(loaded.message).toContain("made for Test Game");
    expect(loaded.message).toContain("not installed here");
  });

  it("says so when the installed map is a different version", async () => {
    hoisted.load.mockResolvedValue(read(otherVersion));
    const loaded = await loadChallengeRunMap(ref, "Test Game");
    if (loaded.ok) throw new Error("expected a refusal");
    expect(loaded.message).toContain(
      'a different version of the hand-made map "Two Shores"',
    );
    expect(loaded.message).toContain("was not started");
  });

  it("refuses a map with no Warpath markings, for a code with no fingerprint", async () => {
    hoisted.load.mockResolvedValue(
      read((m) => {
        delete m.warpath;
      }),
    );
    const loaded = await loadChallengeRunMap(
      { source: "handmade", id: "sample-two-shores" },
      "Test Game",
    );
    if (loaded.ok) throw new Error("expected a refusal");
    expect(loaded.message).toContain("no Warpath start and goal");
  });
});

describe("a scenario location on a Warpath run", () => {
  const doc = readSample();

  it("marks the fight at Ironcoast with the scenario file on every seed", () => {
    for (const seed of SEEDS) {
      const ironcoast = at(runOn(doc, seed), "ironcoast");
      expect(ironcoast.type).toBe("battle");
      expect(ironcoast.scenario).toBe("ironcoast-siege.json");
      // The skirmish to fall back on is set on the scenario's map.
      expect(ironcoast.battle?.mapName).toBe("Comet Catcher Redux");
      expect(ironcoast.battle?.mapDownload).toBeUndefined();
    }
  });

  it("marks no other location", () => {
    const run = runOn(doc, 42);
    expect(run.nodes.filter((n) => n.scenario).map((n) => n.location)).toEqual([
      "ironcoast",
    ]);
  });

  it("plays no scenario where the author made the location a depot", () => {
    const depot = readSample((m) => {
      const ironcoast = m.provinces.find((p) => p.name === "Ironcoast");
      if (ironcoast) ironcoast.warpath = { kind: "shop" };
      // One depot never follows another, so the sample's own gives way.
      delete m.provinces[3].warpath;
    });
    const ironcoast = at(runOn(depot, 42), "ironcoast");
    expect(ironcoast.type).toBe("shop");
    expect(ironcoast.scenario).toBeUndefined();
  });

  it("finds the scenario again from the map", () => {
    const ironcoast = at(runOn(doc, 42), "ironcoast");
    expect(runNodeScenario(doc, ironcoast)?.doc.name).toBe("Siege");
    expect(runNodeScenario(doc, at(runOn(doc, 42), "farwatch"))).toBe(
      undefined,
    );
  });

  it("finds nothing when the map is gone or the location changed", () => {
    const ironcoast = at(runOn(doc, 42), "ironcoast");
    expect(runNodeScenario(undefined, ironcoast)).toBeUndefined();
    const plain = readSample((m) => {
      const province = m.provinces.find((p) => p.name === "Ironcoast");
      if (province) delete province.scenario;
    });
    expect(runNodeScenario(plain, ironcoast)).toBeUndefined();
  });

  it("saves the file name and never the scenario", () => {
    const run = runOn(doc, 42);
    const json = JSON.stringify({ schemaVersion: 1, runs: { r1: run } });
    expect(json).toContain("ironcoast-siege.json");
    expect(json).not.toContain("hold the keep");
    const back = parseRunStateFile(json).runs.r1;
    expect(at(back, "ironcoast").scenario).toBe("ironcoast-siege.json");
  });
});
