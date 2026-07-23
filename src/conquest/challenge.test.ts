import { describe, expect, it } from "vitest";
import {
  challengeSettingsFromGalaxy,
  decodeConquestChallenge,
  encodeConquestChallenge,
  optionsFromChallenge,
} from "./challenge";
import { type GenerateOptions, generateGalaxy } from "./generate";

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));
const ais = [
  { kind: "native" as const, shortName: "BARb", name: "BARbarIAn" },
  { kind: "lua" as const, shortName: "STAI" },
];

const base: GenerateOptions = {
  seed: 4242,
  game: { shortname: "TG" },
  maps,
  ais,
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
      { maps, ais, names: undefined, aiConfig: undefined },
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

  it("rejects a code for a different challenge kind", async () => {
    const { encodeChallenge } = await import("../challenge/code");
    const code = encodeChallenge("warpath", {
      seed: 1,
      game: { shortname: "x" },
    });
    expect(decodeConquestChallenge(code).ok).toBe(false);
  });
});
