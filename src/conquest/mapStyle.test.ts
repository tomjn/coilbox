import { describe, expect, it } from "vitest";
import { conquestIdentity, galaxyIdentity } from "../challenge/identity";
import {
  challengeSettingsFromGalaxy,
  decodeConquestChallenge,
  encodeConquestChallenge,
  galaxyFromChallenge,
} from "./challenge";
import { GENERATED_CITIES_IMAGE, generateCities } from "./cities";
import { type GenerateOptions, generateGalaxy } from "./generate";
import {
  drawsAsGalaxy,
  generatedTerrainPixels,
  generateMap,
  locationNoun,
  MAP_STYLE_OPTIONS,
  mapSkinFor,
  regenerateGalaxy,
} from "./mapStyle";
import { MAP_SKINS, type MapSkin, parseGalaxyJson } from "./model";
import { TERRAIN_PIXELS } from "./terrainGen";
import {
  GENERATED_TERRITORIES_IMAGE,
  generateTerritories,
} from "./territories";

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));

const base: GenerateOptions = {
  seed: 77,
  game: { shortname: "TG" },
  maps,
  nodeCount: 18,
  factionCount: 2,
  layout: "ring",
  id: "generated-77",
  title: "TG Conquest",
};

const NOW = "2026-01-01T00:00:00.000Z";
const LAND: MapSkin[] = ["cities", "territories"];

describe("generateMap", () => {
  it("offers every style there is, once", () => {
    expect(MAP_STYLE_OPTIONS.map((o) => o.value)).toEqual([...MAP_SKINS]);
  });

  it("builds a galaxy and a theatre with the galaxy generator", () => {
    expect(generateMap(base, NOW)).toEqual(generateGalaxy(base, NOW));
    for (const skin of ["galaxy", "theatre"] as const) {
      expect(generateMap({ ...base, skin }, NOW)).toEqual(
        generateGalaxy({ ...base, skin }, NOW),
      );
    }
  });

  it("builds each land style with its own generator", () => {
    const { skin: _s, layout: _l, radiusLy: _r, ...rest } = base;
    expect(generateMap({ ...base, skin: "cities" }, NOW)).toEqual(
      generateCities({ ...rest, layout: "ring" }, NOW),
    );
    expect(generateMap({ ...base, skin: "territories" }, NOW)).toEqual(
      generateTerritories({ ...rest, layout: "ring" }, NOW),
    );
  });

  for (const skin of LAND) {
    it(`records the ${skin} style on the document and in its knobs`, () => {
      const doc = generateMap({ ...base, skin }, NOW);
      expect(doc.theme?.skin).toBe(skin);
      expect(doc.generated?.skin).toBe(skin);
      expect(doc.terrain?.image).toBe(
        skin === "cities"
          ? GENERATED_CITIES_IMAGE
          : GENERATED_TERRITORIES_IMAGE,
      );
      // The style survives being saved and read back.
      expect(parseGalaxyJson(JSON.stringify(doc))).toEqual(doc);
    });

    it(`falls back to a galaxy when real stars are asked for with ${skin}`, () => {
      const opts = { ...base, layout: "realstars" as const, radiusLy: 12 };
      expect(mapSkinFor({ ...opts, skin })).toBe("galaxy");
      const doc = generateMap({ ...opts, skin }, NOW);
      expect(doc).toEqual(generateGalaxy({ ...opts, skin: "galaxy" }, NOW));
      expect(doc.terrain).toBeUndefined();
      expect(doc.generated?.skin).toBe("galaxy");
    });
  }

  it("leaves a theatre of real stars as the galaxy generator builds it", () => {
    const opts = {
      ...base,
      layout: "realstars" as const,
      radiusLy: 12,
      skin: "theatre" as const,
    };
    expect(generateMap(opts, NOW)).toEqual(generateGalaxy(opts, NOW));
  });
});

describe("regenerateGalaxy and the map style", () => {
  for (const skin of MAP_SKINS) {
    it(`rerolls a ${skin} map as a ${skin} map`, () => {
      const doc = generateMap({ ...base, skin }, NOW);
      const re = regenerateGalaxy(doc, { maps }, 999, "t1");
      expect(re).toEqual({
        ...generateMap({ ...base, skin, seed: 999 }, "t1"),
        createdAt: NOW,
      });
      expect(re?.generated?.skin).toBe(skin);
      expect(Boolean(re?.terrain)).toBe(LAND.includes(skin));
      expect(re?.nodes.map((n) => n.pos)).not.toEqual(
        doc.nodes.map((n) => n.pos),
      );
    });
  }

  it("keeps a centre start through a reroll", () => {
    const doc = generateMap({ ...base, startPosition: "centre" }, NOW);
    const re = regenerateGalaxy(doc, { maps }, 999, "t1");
    expect(re?.generated?.startPosition).toBe("centre");
  });
});

describe("a challenge code on a land style", () => {
  // The importer has other maps and other names installed.
  const theirs = {
    maps: [{ name: "Elsewhere", width: 8, height: 8 }, ...maps.slice(0, 3)],
    names: { starNames: ["Aa", "Bb", "Cc"] },
  };

  for (const skin of LAND) {
    it(`rebuilds the same ${skin} map for another player`, () => {
      const doc = generateMap({ ...base, skin, startingSystems: 2 }, NOW);
      const decoded = decodeConquestChallenge(
        encodeConquestChallenge(doc) as string,
      );
      if (!decoded.ok) throw new Error("expected a successful decode");
      expect(decoded.settings.skin).toBe(skin);

      const rebuilt = galaxyFromChallenge(
        decoded.settings,
        theirs,
        doc.id,
        NOW,
      );
      expect(rebuilt.theme).toEqual(doc.theme);
      expect(rebuilt.terrain).toEqual(doc.terrain);
      expect(rebuilt.generated).toEqual(doc.generated);
      expect(rebuilt.links).toEqual(doc.links);
      expect(rebuilt.linkKinds).toEqual(doc.linkKinds);
      expect(rebuilt.nodes.map(({ battle: _b, ...node }) => node)).toEqual(
        doc.nodes.map(({ battle: _b, ...node }) => node),
      );
      // Their land is the sender's land, pixel for pixel.
      expect(generatedTerrainPixels(rebuilt)).toEqual(
        generatedTerrainPixels(doc),
      );
      expect(galaxyIdentity(rebuilt)).toBe(galaxyIdentity(doc));
    });
  }

  it("gives each style an identity of its own", () => {
    const settings = challengeSettingsFromGalaxy(generateMap(base, NOW));
    if (!settings) throw new Error("expected settings");
    const ids = MAP_SKINS.map((skin) =>
      conquestIdentity({ ...settings, skin }),
    );
    expect(new Set(ids).size).toBe(MAP_SKINS.length);
    // The two styles that existed before keep the identity they had.
    expect(ids[0]).toBe(
      '["conquest","TG",77,18,2,"ring",null,"galaxy",null,false]',
    );
    expect(ids[1]).toBe(
      '["conquest","TG",77,18,2,"ring",null,"theatre",null,false]',
    );
  });

  it("reads a style it does not know as a galaxy", () => {
    const settings = challengeSettingsFromGalaxy(generateMap(base, NOW));
    const code = encodeConquestChallenge({
      ...generateMap(base, NOW),
      generated: { ...settings, seed: 77, skin: "globe" as MapSkin },
    });
    const decoded = decodeConquestChallenge(code as string);
    if (!decoded.ok) throw new Error("expected a successful decode");
    expect(decoded.settings.skin).toBe("galaxy");
  });
});

describe("drawsAsGalaxy", () => {
  it("is true for a galaxy alone", () => {
    expect(drawsAsGalaxy(generateMap(base, NOW))).toBe(true);
    for (const skin of ["theatre", "cities", "territories"] as const) {
      expect(drawsAsGalaxy(generateMap({ ...base, skin }, NOW))).toBe(false);
    }
  });

  it("is false for a document with land whatever its style says", () => {
    const land = generateMap({ ...base, skin: "cities" }, NOW);
    expect(drawsAsGalaxy({ ...land, theme: undefined })).toBe(false);
  });
});

describe("generatedTerrainPixels", () => {
  it("is undefined for a map with no generated land", () => {
    expect(generatedTerrainPixels(generateMap(base, NOW))).toBeUndefined();
  });

  for (const skin of LAND) {
    it(`gives the view a picture and heights for a ${skin} map`, () => {
      const pixels = generatedTerrainPixels(
        generateMap({ ...base, skin }, NOW),
      );
      const count = TERRAIN_PIXELS * TERRAIN_PIXELS;
      expect(pixels?.color).toMatchObject({
        width: TERRAIN_PIXELS,
        height: TERRAIN_PIXELS,
      });
      expect(pixels?.height?.data).toHaveLength(count);
    });
  }
});

describe("locationNoun", () => {
  it("names a location in the style's own word", () => {
    expect(locationNoun(undefined).many).toBe("systems");
    expect(locationNoun("galaxy").one).toBe("system");
    expect(locationNoun("theatre").many).toBe("locations");
    expect(locationNoun("cities")).toEqual({ one: "city", many: "cities" });
    expect(locationNoun("territories").many).toBe("provinces");
  });
});
