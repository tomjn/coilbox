import { describe, expect, it } from "vitest";
import { runIdentity } from "../challenge/identity";
import { MAP_SKINS } from "../conquest/model";
import {
  decodeWarpathChallenge,
  encodeWarpathChallenge,
  runFromChallenge,
} from "./challenge";
import { type GenerateRunOpts, type GenRunMap, generateRun } from "./generate";
import {
  generateMapRun,
  generateStyledRun,
  LAND_RUN_SIZES,
  resolveRunMap,
} from "./mapRun";
import { parseRunJson, parseRunSettings, type RunLength } from "./model";

/**
 * The run a Warpath setup starts in each of the four map styles (issue
 * #3507): columns for Galaxy and Theatre, and a generated land map for Cities
 * and Territories.
 */

const MAPS: GenRunMap[] = Array.from({ length: 8 }, (_, i) => ({
  name: `Map ${i}`,
  size: 64 + i * 32,
}));
const NOW = "2026-01-01T00:00:00.000Z";
const LENGTHS: RunLength[] = ["quick", "standard", "long"];
const LAND = ["cities", "territories"] as const;

const base: GenerateRunOpts = {
  seed: 4242,
  length: "standard",
  difficulty: 2,
  ascension: 0,
  game: { shortname: "ba" },
  factionId: "player",
  side: "ARM",
  skin: "galaxy",
  maps: MAPS,
  enemyAiKey: "native:BARb",
  now: NOW,
};

describe("generateStyledRun", () => {
  for (const skin of ["galaxy", "theatre"] as const) {
    it(`is the column run for ${skin}`, () => {
      const run = generateStyledRun({ ...base, skin });
      expect(run).toEqual(generateRun({ ...base, skin }));
      expect(run.settings.map).toBeUndefined();
      expect(run.settings.skin).toBe(skin);
    });
  }

  for (const skin of LAND) {
    for (const length of LENGTHS) {
      it(`crosses a generated ${skin} map for a ${length} run`, () => {
        const run = generateStyledRun({ ...base, skin, length });
        expect(run.settings.skin).toBe(skin);
        expect(run.settings.map).toEqual({
          source: "generated",
          style: skin,
          seed: 4242,
          nodeCount: LAND_RUN_SIZES[skin][length],
          layout: "random",
        });
        // Every run node stands on a location of the map the run names.
        const ref = run.settings.map;
        if (!ref) throw new Error("expected a map reference");
        const source = resolveRunMap(ref, run.settings.game);
        if (!source) throw new Error("expected the map to rebuild");
        expect(source.map.nodes).toHaveLength(LAND_RUN_SIZES[skin][length]);
        expect(source.map.theme?.skin).toBe(skin);
        const locations = new Set(source.map.nodes.map((n) => n.id));
        for (const node of run.nodes) {
          expect(locations.has(node.location ?? "")).toBe(true);
        }
        expect(run.nodes.filter((n) => n.type === "start")).toHaveLength(1);
        expect(run.nodes.filter((n) => n.type === "boss")).toHaveLength(1);
        // It is the run the map generator builds on that map.
        expect(run).toEqual(
          generateMapRun({ ...base, skin, length, ...source, mapRef: ref }),
        );
      });
    }

    it(`saves and reads back a ${skin} run with its style and map`, () => {
      const run = generateStyledRun({ ...base, skin });
      expect(parseRunJson(JSON.stringify(run))).toEqual(run);
    });

    it(`rebuilds the same ${skin} run for another player from its code`, () => {
      const run = generateStyledRun({ ...base, skin });
      const decoded = decodeWarpathChallenge(encodeWarpathChallenge(run));
      if (!decoded.ok) throw new Error("expected a successful decode");
      expect(decoded.settings.skin).toBe(skin);
      const rebuilt = runFromChallenge(decoded.settings, {
        maps: MAPS,
        enemyAiKey: "native:BARb",
      });
      expect(rebuilt.nodes).toEqual(run.nodes);
      expect(rebuilt.edges).toEqual(run.edges);
      expect(rebuilt.settings).toEqual(run.settings);
      expect(runIdentity(rebuilt)).toBe(runIdentity(run));
    });
  }

  it("gives each style a challenge identity of its own", () => {
    const ids = MAP_SKINS.map((skin) =>
      runIdentity(generateStyledRun({ ...base, skin })),
    );
    expect(new Set(ids).size).toBe(MAP_SKINS.length);
  });
});

describe("a stored run's style", () => {
  const settings = generateRun(base).settings;

  it("reads all four styles", () => {
    for (const skin of MAP_SKINS) {
      expect(parseRunSettings({ ...settings, skin })?.skin).toBe(skin);
    }
  });

  it("reads a style it does not know, or none, as a galaxy", () => {
    expect(parseRunSettings({ ...settings, skin: "globe" })?.skin).toBe(
      "galaxy",
    );
    const { skin: _skin, ...rest } = settings;
    expect(parseRunSettings(rest)?.skin).toBe("galaxy");
  });
});
