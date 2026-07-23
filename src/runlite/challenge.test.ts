import { describe, expect, it } from "vitest";
import {
  decodeWarpathChallenge,
  encodeWarpathChallenge,
  optionsFromChallenge,
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
    expect(result).toEqual({ ok: true, settings: run.settings });
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
