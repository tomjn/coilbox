import { describe, expect, it } from "vitest";
import { generateCities } from "./cities";
import { generateGalaxy } from "./generate";
import {
  type ConquestNames,
  LAND_NAME_POOLS,
  makeLandNamer,
  resolveLandNames,
} from "./names";
import { PLANETS } from "./planets";
import { generateTerritories } from "./territories";

const NOW = "2026-01-01T00:00:00.000Z";
const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));
const base = {
  seed: 1,
  game: { shortname: "TG" },
  maps,
  nodeCount: 160,
  factionCount: 2,
};

/** Every built-in star name, which a land map must not use. */
const STAR_SAMPLE = ["Vega", "Deneb", "Rigel", "Sirius", "Altair", "Polaris"];

const LAYOUTS = ["scatter", "spiral", "clusters", "ring"] as const;

const names = (doc: { nodes: { name: string }[] }) =>
  doc.nodes.map((n) => n.name);

describe.each(PLANETS)("built-in land names on %s", (planet) => {
  const { first, last } = LAND_NAME_POOLS[planet];
  const composed = first.flatMap((a) =>
    last.map((b) => `${a}${b}`.toLowerCase()),
  );

  it("compose to a name no two combinations share", () => {
    expect(new Set(composed).size).toBe(composed.length);
  });

  it("hold enough combinations that 160 locations need no number suffix", () => {
    expect(composed.length).toBeGreaterThan(160 * 4);
  });

  it("contain no obvious profanity in any combination", () => {
    const banned = [
      "ass",
      "arse",
      "anal",
      "anus",
      "bitch",
      "cock",
      "coon",
      "crap",
      "cum",
      "cunt",
      "damn",
      "dick",
      "dyke",
      "fag",
      "fuck",
      "hell",
      "homo",
      "kike",
      "nazi",
      "nig",
      "paki",
      "piss",
      "porn",
      "rape",
      "sex",
      "shit",
      "slut",
      "spic",
      "tit",
      "twat",
      "wank",
      "whore",
    ];
    const hits = composed.filter((name) =>
      banned.some((b) => name.includes(b)),
    );
    expect(hits).toEqual([]);
  });

  it("do not spell a country, a well-known city or a place out of Tolkien", () => {
    const real = [
      "england",
      "ireland",
      "iceland",
      "finland",
      "poland",
      "holland",
      "scotland",
      "norway",
      "sweden",
      "spain",
      "france",
      "germany",
      "italy",
      "russia",
      "china",
      "india",
      "japan",
      "korea",
      "chad",
      "mali",
      "peru",
      "cuba",
      "london",
      "paris",
      "berlin",
      "rome",
      "madrid",
      "moscow",
      "tokyo",
      "boston",
      "dublin",
      "oslo",
      "mordor",
      "moria",
      "morgul",
      "gorgoroth",
      "khazadum",
      "khazad-dum",
      "barad-dur",
      "angband",
      "gundabad",
    ];
    expect(composed.filter((name) => real.includes(name))).toEqual([]);
  });
});

describe("land map naming", () => {
  for (const layout of LAYOUTS) {
    for (const seed of [1, 2, 7]) {
      it(`gives Cities ${layout} seed ${seed} 160 distinct place names`, () => {
        const list = names(generateCities({ ...base, seed, layout }, NOW));
        expect(new Set(list).size).toBe(160);
        expect(list.filter((n) => /\d| [IVX]+$/.test(n))).toEqual([]);
        expect(list.filter((n) => STAR_SAMPLE.includes(n))).toEqual([]);
      });

      it(`gives Territories ${layout} seed ${seed} 160 distinct place names`, () => {
        const list = names(generateTerritories({ ...base, seed, layout }, NOW));
        expect(new Set(list).size).toBe(160);
        expect(list.filter((n) => /\d| [IVX]+$/.test(n))).toEqual([]);
        expect(list.filter((n) => STAR_SAMPLE.includes(n))).toEqual([]);
      });
    }
  }

  it("names each planet from its own lists", () => {
    for (const planet of PLANETS) {
      const { first, last } = LAND_NAME_POOLS[planet];
      const list = names(
        generateTerritories({ ...base, nodeCount: 24, planet }, NOW),
      );
      for (const name of list) {
        expect(
          first.some(
            (a) => name.startsWith(a) && last.includes(name.slice(a.length)),
          ),
          `${name} on ${planet}`,
        ).toBe(true);
      }
    }
  });

  it("gives two planets of one seed different names", () => {
    const on = (planet: "moon" | "volcanic") =>
      names(generateTerritories({ ...base, nodeCount: 24, planet }, NOW));
    const volcanic = on("volcanic");
    expect(on("moon").some((n) => volcanic.includes(n))).toBe(false);
  });

  it("keeps Galaxy and Theatre on star names", () => {
    const galaxy = names(generateGalaxy({ ...base, nodeCount: 24 }, NOW));
    const theatre = names(
      generateGalaxy({ ...base, nodeCount: 24, skin: "theatre" }, NOW),
    );
    expect(galaxy.some((n) => STAR_SAMPLE.includes(n))).toBe(true);
    expect(theatre).toEqual(galaxy);
  });

  it("is the same from the same seed", () => {
    const a = generateCities({ ...base, nodeCount: 40 }, NOW);
    const b = generateCities({ ...base, nodeCount: 40 }, NOW);
    expect(names(a)).toEqual(names(b));
  });

  it("changes only the names, not what else the seed draws", () => {
    const land = generateCities({ ...base, nodeCount: 40 }, NOW);
    const renamed = generateCities(
      {
        ...base,
        nodeCount: 40,
        names: {
          placeNames: Array.from({ length: 200 }, (_, i) => `Placename${i}`),
        },
      },
      NOW,
    );
    expect(names(renamed)).not.toEqual(names(land));
    expect(renamed.factions).toEqual(land.factions);
    expect(renamed.links).toEqual(land.links);
    expect(
      renamed.nodes.map((n) => [n.pos, n.owner, n.difficulty, n.battle]),
    ).toEqual(land.nodes.map((n) => [n.pos, n.owner, n.difficulty, n.battle]));
  });

  it("uses a game's star pool on a land map, as before", () => {
    const supplied: ConquestNames = {
      starNames: Array.from({ length: 200 }, (_, i) => `Starname${i}`),
    };
    const list = names(generateTerritories({ ...base, names: supplied }, NOW));
    expect(list.every((n) => n.startsWith("Starname"))).toBe(true);
  });

  it("lets a game supply place names for land without touching stars", () => {
    const supplied: ConquestNames = {
      starNames: Array.from({ length: 200 }, (_, i) => `Starname${i}`),
      placeNames: Array.from({ length: 200 }, (_, i) => `Placename${i}`),
    };
    const land = names(generateCities({ ...base, names: supplied }, NOW));
    const galaxy = names(generateGalaxy({ ...base, names: supplied }, NOW));
    expect(land.every((n) => n.startsWith("Placename"))).toBe(true);
    expect(galaxy.every((n) => n.startsWith("Starname"))).toBe(true);
  });

  it("composes from a game's place syllables", () => {
    const supplied: ConquestNames = {
      placePrefixes: ["Zz"],
      placeSuffixes: ["a", "b", "c"],
    };
    const resolved = resolveLandNames(supplied);
    const namer = makeLandNamer(1, resolved as NonNullable<typeof resolved>);
    const used = new Set<string>();
    expect(["Zza", "Zzb", "Zzc"]).toContain(namer(used));
  });
});
