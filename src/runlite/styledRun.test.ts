import { describe, expect, it } from "vitest";
import { runIdentity } from "../challenge/identity";
import { MAP_SKINS } from "../conquest/model";
import { resolvePlanet } from "../conquest/planets";
import { generatedPlanet } from "../conquest/territories";
import {
  decodeWarpathChallenge,
  encodeWarpathChallenge,
  runFromChallenge,
} from "./challenge";
import { type GenerateRunOpts, type GenRunMap, generateRun } from "./generate";
import {
  choiceOnSteps,
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
        // Seed 2 keeps its first map at every size, so the map is its own.
        const run = generateStyledRun({ ...base, seed: 2, skin, length });
        expect(run.settings.skin).toBe(skin);
        expect(run.settings.map).toEqual({
          source: "generated",
          style: skin,
          seed: 2,
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
          generateMapRun({
            ...base,
            seed: 2,
            skin,
            length,
            ...source,
            mapRef: ref,
          }),
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

  it("builds the land as the planet asked for, on every map it tries", () => {
    for (const skin of LAND) {
      const run = generateStyledRun({ ...base, skin, planet: "volcanic" });
      const ref = run.settings.map;
      if (ref?.source !== "generated") throw new Error("expected a map");
      expect(ref.planet).toBe("volcanic");
      const source = resolveRunMap(ref, run.settings.game);
      expect(source?.map.generated?.planet).toBe("volcanic");
      expect(source ? generatedPlanet(source.map) : null).toBe("volcanic");
    }
  });

  it("picks one planet from the seed for a random one, and stores it", () => {
    const run = generateStyledRun({
      ...base,
      skin: "territories",
      planet: "random",
    });
    const ref = run.settings.map;
    if (ref?.source !== "generated") throw new Error("expected a map");
    expect(ref.planet).toBe(resolvePlanet("random", base.seed));
  });

  it("carries the planet in a challenge code and in the identity", () => {
    const plain = generateStyledRun({ ...base, skin: "territories" });
    const run = generateStyledRun({
      ...base,
      skin: "territories",
      planet: "moon",
    });
    expect(runIdentity(run)).not.toBe(runIdentity(plain));
    const decoded = decodeWarpathChallenge(encodeWarpathChallenge(run));
    if (!decoded.ok) throw new Error("expected a successful decode");
    const rebuilt = runFromChallenge(decoded.settings, {
      maps: MAPS,
      enemyAiKey: "native:BARb",
    });
    expect(rebuilt.settings).toEqual(run.settings);
    expect(rebuilt.nodes).toEqual(run.nodes);
    expect(parseRunJson(JSON.stringify(run))).toEqual(run);
  });

  it("reads a planet it does not know as no planet", () => {
    const run = generateStyledRun({ ...base, skin: "cities", planet: "ice" });
    const settings = parseRunSettings({
      ...run.settings,
      map: { ...run.settings.map, planet: "gas giant" },
    });
    expect(settings?.map).toEqual({ ...run.settings.map, planet: undefined });
    expect(settings?.map && "planet" in settings.map).toBe(false);
  });

  it("gives each style a challenge identity of its own", () => {
    const ids = MAP_SKINS.map((skin) =>
      runIdentity(generateStyledRun({ ...base, skin })),
    );
    expect(new Set(ids).size).toBe(MAP_SKINS.length);
  });
});

/**
 * Issue #3571: a run with one location at every step offers no choice of
 * route. Seeds 1 to 8 at each of the six sizes a setup can ask for, built
 * while the file loads so no single test carries the cost of the maps.
 */
describe("the choice of route on a generated land map", () => {
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
  // How many of the eight seeds got a route with no choice on their own map
  // and so ended on a later one. A small land map is often close
  // to a tree, and across a tree there is one way between any two places.
  const SWAPPED = {
    cities: { quick: 2, standard: 1, long: 1 },
    territories: { quick: 2, standard: 1, long: 0 },
  };

  for (const skin of LAND) {
    for (const length of LENGTHS) {
      const runs = SEEDS.map((seed) =>
        generateStyledRun({ ...base, seed, skin, length }),
      );
      const swapped = runs.filter(
        (run, i) =>
          run.settings.map?.source === "generated" &&
          run.settings.map.seed !== SEEDS[i],
      );

      it(`offers two next steps somewhere on every ${length} ${skin} run, whichever way the player goes`, () => {
        for (const run of runs) {
          const choice = choiceOnSteps(
            run.nodes.map((n) => n.id),
            run.edges,
          );
          expect(choice.fewest).toBeGreaterThanOrEqual(1);
        }
      });

      it(`moves ${SWAPPED[skin][length]} of the ${SEEDS.length} ${length} ${skin} runs to another map`, () => {
        expect(swapped).toHaveLength(SWAPPED[skin][length]);
      });

      it(`rebuilds a ${length} ${skin} run that moved map from its code`, () => {
        for (const run of swapped) {
          const decoded = decodeWarpathChallenge(encodeWarpathChallenge(run));
          if (!decoded.ok) throw new Error("expected a successful decode");
          const rebuilt = runFromChallenge(decoded.settings, {
            maps: MAPS,
            enemyAiKey: "native:BARb",
          });
          expect(rebuilt.nodes).toEqual(run.nodes);
          expect(rebuilt.edges).toEqual(run.edges);
          expect(rebuilt.settings.map).toEqual(run.settings.map);
        }
      });
    }
  }

  it("gives the same run from the same seed, on a seed that moves map", () => {
    const opts: GenerateRunOpts = {
      ...base,
      seed: 1,
      skin: "territories",
      length: "quick",
    };
    const run = generateStyledRun(opts);
    const ref = run.settings.map;
    expect(ref?.source === "generated" && ref.seed).not.toBe(1);
    expect(generateStyledRun(opts)).toEqual(run);
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
