import { describe, expect, it } from "vitest";
import {
  type ConquestNames,
  factionSpecs,
  makeStarNamer,
  mergeConquestNames,
  resolveConquestNames,
  sectorName,
  sectorNameForSeed,
  toRoman,
} from "./names";
import { mulberry32 } from "./rng";

describe("mergeConquestNames", () => {
  it("returns undefined when neither source sets anything", () => {
    expect(mergeConquestNames()).toBeUndefined();
    expect(mergeConquestNames({}, {})).toBeUndefined();
  });

  it("lets profile win field-by-field over branding", () => {
    const profile: ConquestNames = {
      factionNames: ["Profile A", "Profile B"],
    };
    const branding: ConquestNames = {
      factionNames: ["Brand A"],
      starNames: ["Brand Star"],
    };
    const merged = mergeConquestNames(profile, branding);
    expect(merged?.factionNames).toEqual(["Profile A", "Profile B"]);
    // Branding fills fields the profile leaves unset.
    expect(merged?.starNames).toEqual(["Brand Star"]);
  });

  it("treats empty arrays as absent", () => {
    const merged = mergeConquestNames(
      { starNames: [] },
      { starNames: ["Kept"] },
    );
    expect(merged?.starNames).toEqual(["Kept"]);
  });

  it("carries limitToNamed profile-over-branding", () => {
    expect(mergeConquestNames({ limitToNamed: true }, {})?.limitToNamed).toBe(
      true,
    );
    expect(mergeConquestNames({}, { limitToNamed: true })?.limitToNamed).toBe(
      true,
    );
    // Profile explicitly off wins over branding on.
    expect(
      mergeConquestNames({ limitToNamed: false }, { limitToNamed: true })
        ?.limitToNamed,
    ).toBe(false);
  });
});

describe("resolveConquestNames", () => {
  it("falls back to built-in pools when nothing is supplied", () => {
    const r = resolveConquestNames();
    expect(r.starNames.length).toBeGreaterThan(0);
    expect(r.starPrefixes.length).toBeGreaterThan(0);
    expect(r.starSuffixes.length).toBeGreaterThan(0);
    expect(r.factions).toBeUndefined();
  });

  it("keeps an explicit override and ignores empty pools", () => {
    const r = resolveConquestNames({ starNames: ["Only"], starPrefixes: [] });
    expect(r.starNames).toEqual(["Only"]);
    // Empty prefixes never blank the synthesis pool.
    expect(r.starPrefixes.length).toBeGreaterThan(0);
  });

  it("surfaces limitToNamed, defaulting to false", () => {
    expect(resolveConquestNames().limitToNamed).toBe(false);
    expect(resolveConquestNames({ limitToNamed: true }).limitToNamed).toBe(
      true,
    );
  });
});

describe("makeStarNamer", () => {
  it("hands out unique names, draining the explicit pool first", () => {
    const names = resolveConquestNames({ starNames: ["Vega", "Altair"] });
    const namer = makeStarNamer(mulberry32(1), names);
    const used = new Set<string>();
    const out = Array.from({ length: 6 }, () => namer(used));
    expect(new Set(out).size).toBe(6); // all unique
    expect(out).toEqual(expect.arrayContaining(["Vega", "Altair"]));
  });

  it("extends an exhausted pool with roman numerals before synthesis", () => {
    const names = resolveConquestNames({ starNames: ["Vega", "Altair"] });
    const namer = makeStarNamer(mulberry32(1), names);
    const used = new Set<string>();
    const out = Array.from({ length: 6 }, () => namer(used));
    expect(new Set(out).size).toBe(6);
    // Two base names, then the same two with II, then III — never invented.
    expect(out).toEqual(
      expect.arrayContaining([
        "Vega",
        "Altair",
        "Vega II",
        "Altair II",
        "Vega III",
        "Altair III",
      ]),
    );
  });

  it("falls back to synthesis only when the pool is empty", () => {
    const names = resolveConquestNames({
      starNames: [],
      starPrefixes: ["Xo"],
      starSuffixes: ["ra"],
    });
    // resolveConquestNames refills starNames from the built-ins, so force empty.
    const namer = makeStarNamer(mulberry32(1), { ...names, starNames: [] });
    const used = new Set<string>();
    const out = Array.from({ length: 3 }, () => namer(used));
    for (const n of out) expect(n.startsWith("Xora")).toBe(true);
  });
});

describe("toRoman", () => {
  it("converts the numerals we actually use", () => {
    expect(toRoman(2)).toBe("II");
    expect(toRoman(3)).toBe("III");
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(9)).toBe("IX");
    expect(toRoman(40)).toBe("XL");
  });
});

describe("factionSpecs", () => {
  it("assigns presets in order, filling colour/name gaps", () => {
    const names = resolveConquestNames({
      factions: [
        { name: "Cortex", side: "Core" },
        { name: "Arm", color: "#00ff00", aggression: 0.9 },
      ],
    });
    const specs = factionSpecs(mulberry32(2), names, 3);
    expect(specs).toHaveLength(3);
    expect(specs[0].name).toBe("Cortex");
    expect(specs[0].side).toBe("Core");
    expect(specs[0].color).toBe("#2f7dff"); // palette fallback
    expect(specs[1].color).toBe("#00ff00");
    expect(specs[1].aggression).toBe(0.9);
    // The unpresetted slot gets a synthesized name and palette colour.
    expect(specs[2].name.length).toBeGreaterThan(0);
    expect(specs[2].color).toMatch(/^#/);
  });

  it("uses explicit factionNames when no presets are given", () => {
    const names = resolveConquestNames({ factionNames: ["Red", "Blue"] });
    const specs = factionSpecs(mulberry32(3), names, 2);
    expect(specs.map((s) => s.name)).toEqual(["Red", "Blue"]);
  });
});

describe("sectorName", () => {
  it("composes an adjective + place-noun", () => {
    expect(sectorName(mulberry32(1))).toMatch(/^\S+ \S+$/);
  });

  it("is deterministic from a seed and independent of the main stream", () => {
    // Same seed -> same name, always.
    expect(sectorNameForSeed(42)).toBe(sectorNameForSeed(42));
    // Different seeds generally differ (spot-check a couple).
    expect(sectorNameForSeed(1)).not.toBe(sectorNameForSeed(999));
  });
});
