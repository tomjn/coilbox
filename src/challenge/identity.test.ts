import { describe, expect, it } from "vitest";
import {
  challengeSettingsFromGalaxy,
  decodeConquestChallenge,
  encodeConquestChallenge,
  galaxyFromChallenge,
} from "../conquest/challenge";
import { type GenerateOptions, generateGalaxy } from "../conquest/generate";
import {
  decodeWarpathChallenge,
  encodeWarpathChallenge,
  runFromChallenge,
} from "../runlite/challenge";
import { type GenerateRunOpts, generateRun } from "../runlite/generate";
import {
  conquestIdentity,
  galaxyIdentity,
  runIdentity,
  warpathIdentity,
} from "./identity";

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));

const galaxyOpts: GenerateOptions = {
  seed: 4242,
  game: { shortname: "TG" },
  maps,
  nodeCount: 20,
  factionCount: 2,
  layout: "spiral",
  skin: "theatre",
  startingSystems: 2,
  fogOfWar: true,
  id: "generated-4242",
  title: "TG Conquest",
};

const runMaps = [
  { name: "Small", size: 64 },
  { name: "Medium", size: 256 },
];

const runOpts: GenerateRunOpts = {
  seed: 777,
  length: "standard",
  difficulty: 3,
  ascension: 1,
  game: { shortname: "ba" },
  factionId: "player",
  side: "ARM",
  skin: "galaxy",
  maps: runMaps,
  now: "2026-07-18T00:00:00.000Z",
};

function conquestSettings(over: Partial<GenerateOptions> = {}) {
  const settings = challengeSettingsFromGalaxy(
    generateGalaxy({ ...galaxyOpts, ...over }, "t0"),
  );
  if (!settings) throw new Error("expected a generated galaxy");
  return settings;
}

describe("conquest challenge identity", () => {
  it("is the same when one challenge is encoded twice with different bytes", () => {
    const galaxy = generateGalaxy(galaxyOpts, "t0");
    // Same settings, but the second copy carries different names and title, so
    // the encoded strings differ.
    const renamed = {
      ...galaxy,
      title: "Another title",
      nodes: galaxy.nodes.map((n) => ({ ...n, name: `${n.name} II` })),
    };
    const a = encodeConquestChallenge(galaxy) as string;
    const b = encodeConquestChallenge(renamed) as string;
    expect(a).not.toBe(b);
    const sa = decodeConquestChallenge(a);
    const sb = decodeConquestChallenge(b);
    if (!sa.ok || !sb.ok) throw new Error("expected both to decode");
    expect(conquestIdentity(sa.settings)).toBe(conquestIdentity(sb.settings));
  });

  it("is the same for the galaxy the code was made from and for an import of it", () => {
    const galaxy = generateGalaxy(galaxyOpts, "t0");
    const decoded = decodeConquestChallenge(
      encodeConquestChallenge(galaxy) as string,
    );
    if (!decoded.ok) throw new Error("expected a successful decode");
    const imported = galaxyFromChallenge(
      decoded.settings,
      { maps, names: undefined },
      "imported-1",
    );
    expect(galaxyIdentity(galaxy)).toBe(conquestIdentity(decoded.settings));
    expect(galaxyIdentity(imported)).toBe(galaxyIdentity(galaxy));
  });

  it("is the same when an import had to substitute a map", () => {
    const galaxy = generateGalaxy(galaxyOpts, "t0");
    const decoded = decodeConquestChallenge(
      encodeConquestChallenge(galaxy) as string,
    );
    if (!decoded.ok) throw new Error("expected a successful decode");
    const fewerMaps = maps.slice(0, 3);
    const imported = galaxyFromChallenge(
      decoded.settings,
      { maps: fewerMaps, names: undefined },
      "imported-2",
    );
    expect(galaxyIdentity(imported)).toBe(galaxyIdentity(galaxy));
  });

  it("differs for a different seed", () => {
    expect(conquestIdentity(conquestSettings())).not.toBe(
      conquestIdentity(conquestSettings({ seed: 9999 })),
    );
  });

  it("differs for a different layout, size, skin, fog or game", () => {
    const base = conquestIdentity(conquestSettings());
    for (const over of [
      { layout: "ring" as const },
      { nodeCount: 30 },
      { skin: "galaxy" as const },
      { fogOfWar: false },
      { game: { shortname: "OTHER" } },
    ]) {
      expect(conquestIdentity(conquestSettings(over))).not.toBe(base);
    }
  });

  it("is null for a galaxy with no generation knobs", () => {
    const { generated: _generated, ...authored } = generateGalaxy(
      galaxyOpts,
      "t0",
    );
    expect(galaxyIdentity(authored)).toBeNull();
  });
});

describe("warpath challenge identity", () => {
  it("is the same for the run, its code and an import of that code", () => {
    const run = generateRun(runOpts);
    const decoded = decodeWarpathChallenge(encodeWarpathChallenge(run));
    if (!decoded.ok) throw new Error("expected a successful decode");
    const imported = runFromChallenge(decoded.settings, { maps: runMaps });
    expect(warpathIdentity(decoded.settings)).toBe(runIdentity(run));
    expect(runIdentity(imported)).toBe(runIdentity(run));
  });

  it("differs for a different seed, ascension, length or difficulty", () => {
    const base = runIdentity(generateRun(runOpts));
    for (const over of [
      { seed: 778 },
      { ascension: 2 },
      { length: "long" as const },
      { difficulty: 4 },
    ]) {
      expect(runIdentity(generateRun({ ...runOpts, ...over }))).not.toBe(base);
    }
  });

  it("never matches a conquest identity", () => {
    expect(runIdentity(generateRun(runOpts))).not.toBe(
      conquestIdentity(conquestSettings()),
    );
  });
});
