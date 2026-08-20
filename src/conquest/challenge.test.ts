import { describe, expect, it } from "vitest";
import { encodeChallenge } from "../challenge/code";
import {
  challengeSettingsFromGalaxy,
  decodeConquestChallenge,
  encodeConquestChallenge,
  galaxyFromChallenge,
  optionsFromChallenge,
  substitutedMapCount,
} from "./challenge";
import { type GenerateOptions, generateGalaxy } from "./generate";

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));

const base: GenerateOptions = {
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

describe("conquest challenge codec", () => {
  it("encodes a generated galaxy and decodes back to equivalent settings", () => {
    const galaxy = generateGalaxy(base, "t0");
    const code = encodeConquestChallenge(galaxy);
    expect(code).not.toBeNull();
    const result = decodeConquestChallenge(code as string);
    expect(result).toEqual({
      ok: true,
      settings: challengeSettingsFromGalaxy(galaxy),
    });
  });

  it("returns null for a galaxy with no generation knobs (authored/bundled)", () => {
    const galaxy = generateGalaxy(base, "t0");
    const { generated: _generated, ...authored } = galaxy;
    expect(encodeConquestChallenge(authored)).toBeNull();
  });

  it("recreates an identical galaxy from a decoded challenge", () => {
    const galaxy = generateGalaxy(base, "t0");
    const code = encodeConquestChallenge(galaxy);
    const result = decodeConquestChallenge(code as string);
    if (!result.ok) throw new Error("expected a successful decode");
    const options = optionsFromChallenge(
      result.settings,
      { maps, names: undefined },
      "generated-4242",
    );
    const recreated = generateGalaxy(options, "t1");
    // Everything the player sees should match; only createdAt/updatedAt (the
    // import timestamp) legitimately differs.
    expect(recreated.nodes).toEqual(galaxy.nodes);
    expect(recreated.links).toEqual(galaxy.links);
    expect(recreated.factions).toEqual(galaxy.factions);
    expect(recreated.generated).toEqual(galaxy.generated);
  });

  it("produces a different galaxy for a different seed", () => {
    const a = generateGalaxy(base, "t0");
    const b = generateGalaxy({ ...base, seed: 9999 }, "t0");
    const codeA = decodeConquestChallenge(encodeConquestChallenge(a) as string);
    const codeB = decodeConquestChallenge(encodeConquestChallenge(b) as string);
    expect(codeA).not.toEqual(codeB);
  });

  it("rejects malformed input", () => {
    expect(decodeConquestChallenge("not-a-real-code").ok).toBe(false);
    expect(decodeConquestChallenge("").ok).toBe(false);
  });

  it("rejects a truncated code", () => {
    const galaxy = generateGalaxy(base, "t0");
    const code = encodeConquestChallenge(galaxy) as string;
    const result = decodeConquestChallenge(code.slice(0, code.length - 6));
    expect(result.ok).toBe(false);
  });

  it("names the map every system uses", () => {
    const galaxy = generateGalaxy(base, "t0");
    const settings = challengeSettingsFromGalaxy(galaxy);
    expect(settings?.nodeMaps).toEqual(
      Object.fromEntries(galaxy.nodes.map((n) => [n.id, n.battle.mapName])),
    );
  });

  it("shares the map a system should have used, not its local stand-in", () => {
    const galaxy = generateGalaxy(base, "t0");
    const substituted = {
      ...galaxy,
      nodes: galaxy.nodes.map((n, i) =>
        i === 0
          ? {
              ...n,
              battle: {
                ...n.battle,
                mapName: "Stand-in",
                mapSubstitutedFrom: "Map 7",
              },
            }
          : n,
      ),
    };
    expect(challengeSettingsFromGalaxy(substituted)?.nodeMaps?.["node-0"]).toBe(
      "Map 7",
    );
  });

  it("rebuilds the same maps on an install with a different map pool", () => {
    const galaxy = generateGalaxy(base, "t0");
    const code = encodeConquestChallenge(galaxy) as string;
    const result = decodeConquestChallenge(code);
    if (!result.ok) throw new Error("expected a successful decode");
    // A second machine holding the same maps plus a pile of others, which on
    // its own would shift every tier and hand most systems a different map.
    const theirs = [
      ...Array.from({ length: 20 }, (_, i) => ({
        name: `Their Map ${i}`,
        width: 2 + i,
        height: 2 + i,
      })),
      ...maps,
    ];
    const rebuilt = galaxyFromChallenge(
      result.settings,
      { maps: theirs, names: undefined },
      "generated-4242",
      "t1",
    );
    for (const [i, node] of rebuilt.nodes.entries()) {
      expect(node.battle.mapName).toBe(galaxy.nodes[i].battle.mapName);
    }
    // And this is not the seed doing the work: resolving the maps locally the
    // way coilbox used to is what put the two players on different ground.
    const localDraw = generateGalaxy(
      { ...base, maps: theirs, seed: result.settings.seed },
      "t1",
    );
    expect(localDraw.nodes.map((n) => n.battle.mapName)).not.toEqual(
      galaxy.nodes.map((n) => n.battle.mapName),
    );
  });

  it("marks a system whose named map the recipient does not have", () => {
    const galaxy = generateGalaxy(base, "t0");
    const wanted = galaxy.nodes[0].battle.mapName;
    const code = encodeConquestChallenge(galaxy) as string;
    const result = decodeConquestChallenge(code);
    if (!result.ok) throw new Error("expected a successful decode");
    const theirs = maps.filter((m) => m.name !== wanted);
    const rebuilt = galaxyFromChallenge(
      result.settings,
      { maps: theirs, names: undefined },
      "generated-4242",
      "t1",
    );
    expect(rebuilt.nodes[0].battle.mapName).not.toBe(wanted);
    expect(rebuilt.nodes[0].battle.mapSubstitutedFrom).toBe(wanted);
    expect(substitutedMapCount(rebuilt)).toBeGreaterThan(0);
  });

  it("opens a challenge shared before maps were named", () => {
    const galaxy = generateGalaxy(base, "t0");
    const settings = challengeSettingsFromGalaxy(galaxy);
    if (!settings) throw new Error("expected shareable settings");
    const { nodeMaps: _named, ...old } = settings;
    const code = encodeChallenge("conquest", old);
    const result = decodeConquestChallenge(code);
    if (!result.ok) throw new Error("expected a successful decode");
    expect(result.settings.nodeMaps).toBeUndefined();
    const rebuilt = galaxyFromChallenge(
      result.settings,
      { maps, names: undefined },
      "generated-4242",
      "t1",
    );
    // Same install, so the local draw still lands on the original maps.
    expect(rebuilt.nodes.map((n) => n.battle.mapName)).toEqual(
      galaxy.nodes.map((n) => n.battle.mapName),
    );
    expect(substitutedMapCount(rebuilt)).toBe(0);
  });

  it("stays small enough to paste for the biggest galaxy coilbox makes", () => {
    const big = generateGalaxy(
      {
        ...base,
        nodeCount: 80,
        // Map names as long as the longest real ones in circulation.
        maps: Array.from({ length: 40 }, (_, i) => ({
          name: `All That Glitters Remake Reforged v1.${i}`,
          width: 8 + i,
          height: 8 + i,
        })),
      },
      "t0",
    );
    const code = encodeConquestChallenge(big) as string;
    expect(code.length).toBeLessThan(4096);
  });

  it("rejects a code for a different challenge kind", async () => {
    const { encodeChallenge } = await import("../challenge/code");
    const code = encodeChallenge("warpath", {
      seed: 1,
      game: { shortname: "x" },
    });
    expect(decodeConquestChallenge(code).ok).toBe(false);
  });
});
