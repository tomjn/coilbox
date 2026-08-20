import { describe, expect, it } from "vitest";
import { encodeChallenge } from "../challenge/code";
import {
  decodeWarpathChallenge,
  encodeWarpathChallenge,
  optionsFromChallenge,
  runFromChallenge,
  substitutedMapCount,
} from "./challenge";
import {
  type GenBuildGraph,
  type GenerateRunOpts,
  generateRun,
} from "./generate";

const MAPS = [
  { name: "Small", size: 64 },
  { name: "Medium", size: 256 },
  { name: "Huge", size: 1024 },
];

const BUILD: GenBuildGraph = {
  startUnit: "com",
  edges: new Map<string, string[]>([
    ["com", ["mex", "vplant"]],
    ["mex", []],
    ["vplant", ["tank"]],
    ["tank", []],
  ]),
  names: new Map<string, string>(),
};

function opts(over: Partial<GenerateRunOpts> = {}): GenerateRunOpts {
  return {
    seed: 777,
    length: "standard",
    difficulty: 3,
    ascension: 1,
    game: { shortname: "ba" },
    factionId: "player",
    side: "ARM",
    skin: "galaxy",
    maps: MAPS,
    build: BUILD,
    enemyAiKey: "native:BARb",
    now: "2026-07-18T00:00:00.000Z",
    ...over,
  };
}

describe("warpath challenge codec", () => {
  it("encodes a run's settings and decodes back to the same settings", () => {
    const run = generateRun(opts());
    const code = encodeWarpathChallenge(run);
    const result = decodeWarpathChallenge(code);
    if (!result.ok) throw new Error("expected a successful decode");
    const { nodeMaps, ...settings } = result.settings;
    expect(settings).toEqual(run.settings);
    expect(nodeMaps).toEqual(
      Object.fromEntries(
        run.nodes
          .filter((n) => n.battle)
          .map((n) => [n.id, n.battle?.mapName as string]),
      ),
    );
  });

  it("rebuilds the same maps on an install with a different map pool", () => {
    const run = generateRun(opts());
    const result = decodeWarpathChallenge(encodeWarpathChallenge(run));
    if (!result.ok) throw new Error("expected a successful decode");
    // The same three maps plus a pile of others, which on its own shifts the
    // depth-biased draw and hands most encounters a different map.
    const theirs = [
      ...MAPS,
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `Their Map ${i}`,
        size: 32 * (i + 1),
      })),
    ];
    const rebuilt = runFromChallenge(result.settings, { maps: theirs });
    for (const [i, node] of rebuilt.nodes.entries()) {
      expect(node.battle?.mapName).toBe(run.nodes[i].battle?.mapName);
    }
    const localDraw = generateRun(opts({ maps: theirs }));
    expect(localDraw.nodes.map((n) => n.battle?.mapName)).not.toEqual(
      run.nodes.map((n) => n.battle?.mapName),
    );
  });

  it("marks an encounter whose named map the recipient does not have", () => {
    const run = generateRun(opts());
    const result = decodeWarpathChallenge(encodeWarpathChallenge(run));
    if (!result.ok) throw new Error("expected a successful decode");
    const theirs = MAPS.filter((m) => m.name !== "Huge");
    const rebuilt = runFromChallenge(result.settings, { maps: theirs });
    expect(substitutedMapCount(rebuilt)).toBeGreaterThan(0);
    for (const node of rebuilt.nodes) {
      expect(node.battle?.mapName).not.toBe("Huge");
      if (node.battle?.mapSubstitutedFrom) {
        expect(node.battle.mapSubstitutedFrom).toBe("Huge");
      }
    }
  });

  it("opens a challenge shared before maps were named", () => {
    const run = generateRun(opts());
    const code = encodeChallenge("warpath", run.settings);
    const result = decodeWarpathChallenge(code);
    if (!result.ok) throw new Error("expected a successful decode");
    expect(result.settings.nodeMaps).toBeUndefined();
    const rebuilt = runFromChallenge(result.settings, {
      maps: MAPS,
      build: BUILD,
      enemyAiKey: "native:BARb",
    });
    expect(rebuilt.nodes.map((n) => n.battle?.mapName)).toEqual(
      run.nodes.map((n) => n.battle?.mapName),
    );
    expect(substitutedMapCount(rebuilt)).toBe(0);
  });

  it("recreates an identical run from a decoded challenge", () => {
    const run = generateRun(opts());
    const code = encodeWarpathChallenge(run);
    const result = decodeWarpathChallenge(code);
    if (!result.ok) throw new Error("expected a successful decode");
    const options = optionsFromChallenge(result.settings, {
      maps: MAPS,
      build: BUILD,
      enemyAiKey: "native:BARb",
    });
    const recreated = generateRun({
      ...options,
      now: "2026-07-19T00:00:00.000Z",
    });
    expect(recreated.nodes).toEqual(run.nodes);
    expect(recreated.edges).toEqual(run.edges);
    expect(recreated.settings).toEqual(run.settings);
    expect(recreated.name).toBe(run.name);
  });

  it("produces different settings/encoding for a different seed", () => {
    const a = generateRun(opts({ seed: 1 }));
    const b = generateRun(opts({ seed: 2 }));
    expect(encodeWarpathChallenge(a)).not.toBe(encodeWarpathChallenge(b));
  });

  it("rejects malformed input", () => {
    expect(decodeWarpathChallenge("garbage").ok).toBe(false);
    expect(decodeWarpathChallenge("").ok).toBe(false);
  });

  it("rejects a truncated code", () => {
    const run = generateRun(opts());
    const code = encodeWarpathChallenge(run);
    const result = decodeWarpathChallenge(code.slice(0, code.length - 6));
    expect(result.ok).toBe(false);
  });

  it("rejects a code for a different challenge kind", async () => {
    const { encodeChallenge } = await import("../challenge/code");
    const code = encodeChallenge("conquest", { seed: 1 });
    expect(decodeWarpathChallenge(code).ok).toBe(false);
  });
});
