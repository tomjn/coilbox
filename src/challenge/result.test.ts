import { describe, expect, it } from "vitest";
import { generateGalaxy } from "../conquest/generate";
import {
  type ConquestState,
  type GalaxyDoc,
  newConquestState,
} from "../conquest/model";
import { generateRun } from "../runlite/generate";
import type { RogueliteRun } from "../runlite/model";
import { galaxyIdentity, runIdentity } from "./identity";
import {
  betterScore,
  type ChallengeScore,
  conquestRunResult,
  warpathRunResult,
} from "./result";

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));

const galaxy: GalaxyDoc = generateGalaxy(
  {
    seed: 4242,
    game: { shortname: "TG" },
    maps,
    nodeCount: 20,
    factionCount: 2,
    id: "generated-4242",
    title: "TG Conquest",
  },
  "t0",
);

function ended(
  status: "won" | "lost" | "active",
  turn: number,
  seed = 11,
): ConquestState {
  return { ...newConquestState(galaxy, { seed }), status, turn };
}

const run: RogueliteRun = generateRun({
  seed: 777,
  length: "standard",
  difficulty: 3,
  ascension: 1,
  game: { shortname: "ba" },
  factionId: "player",
  side: "ARM",
  skin: "galaxy",
  maps: [
    { name: "Small", size: 64 },
    { name: "Medium", size: 256 },
  ],
  now: "2026-07-18T00:00:00.000Z",
});

function warpathEnded(
  status: "won" | "lost" | "active",
  depth: number,
): RogueliteRun {
  const visited = run.nodes.filter((n) => n.col <= depth).map((n) => n.id);
  return { ...run, progress: { ...run.progress, status, visited } };
}

const win = (measure: number): ChallengeScore => ({ won: true, measure });
const loss = (measure: number): ChallengeScore => ({ won: false, measure });

describe("conquest: a win in fewer turns is better, a loss that lasted longer is better", () => {
  it("any win beats any loss", () => {
    expect(betterScore("conquest", win(90), loss(80))).toBe(true);
    expect(betterScore("conquest", loss(80), win(90))).toBe(false);
  });
  it("a faster win beats a slower one", () => {
    expect(betterScore("conquest", win(14), win(20))).toBe(true);
    expect(betterScore("conquest", win(20), win(14))).toBe(false);
  });
  it("an equal win is not better", () => {
    expect(betterScore("conquest", win(14), win(14))).toBe(false);
  });
  it("a loss that lasted more turns beats one that lasted fewer", () => {
    expect(betterScore("conquest", loss(30), loss(10))).toBe(true);
    expect(betterScore("conquest", loss(10), loss(30))).toBe(false);
  });
});

describe("warpath: a win beats a loss, then further beats nearer", () => {
  it("any win beats any loss, even one that reached as far", () => {
    expect(betterScore("warpath", win(7), loss(7))).toBe(true);
    expect(betterScore("warpath", loss(7), win(7))).toBe(false);
  });
  it("a loss that reached a deeper column beats a nearer one", () => {
    expect(betterScore("warpath", loss(5), loss(3))).toBe(true);
    expect(betterScore("warpath", loss(3), loss(5))).toBe(false);
  });
  it("equal depth is not better", () => {
    expect(betterScore("warpath", loss(4), loss(4))).toBe(false);
    expect(betterScore("warpath", win(7), win(7))).toBe(false);
  });
});

describe("conquestRunResult", () => {
  it("reads turns and the outcome from a finished run", () => {
    expect(conquestRunResult(galaxy, ended("won", 14))).toEqual({
      mode: "conquest",
      identity: galaxyIdentity(galaxy),
      runId: `${galaxy.id}:11`,
      score: { won: true, measure: 14 },
    });
    expect(conquestRunResult(galaxy, ended("lost", 9))?.score).toEqual({
      won: false,
      measure: 9,
    });
  });
  it("is null while the run is still active", () => {
    expect(conquestRunResult(galaxy, ended("active", 3))).toBeNull();
  });
  it("tells two runs of the same galaxy apart by their seed", () => {
    const a = conquestRunResult(galaxy, ended("won", 14, 1));
    const b = conquestRunResult(galaxy, ended("won", 14, 2));
    expect(a?.runId).not.toBe(b?.runId);
  });
  it("is null for a galaxy no code can be made from", () => {
    const { generated: _generated, ...authored } = galaxy;
    expect(conquestRunResult(authored, ended("won", 14))).toBeNull();
  });
  it("is null when a system stands in for a map the code named", () => {
    const drifted: GalaxyDoc = {
      ...galaxy,
      nodes: galaxy.nodes.map((n, i) =>
        i === 0
          ? { ...n, battle: { ...n.battle, mapSubstitutedFrom: "Elsewhere" } }
          : n,
      ),
    };
    expect(conquestRunResult(drifted, ended("won", 14))).toBeNull();
  });
  it("files a run whose settings changed under a different identity", () => {
    const rerolled: GalaxyDoc = {
      ...galaxy,
      generated: galaxy.generated && { ...galaxy.generated, seed: 1 },
    };
    const original = conquestRunResult(galaxy, ended("won", 14));
    const drifted = conquestRunResult(rerolled, ended("won", 14));
    expect(drifted?.identity).not.toBe(original?.identity);
  });
});

describe("warpathRunResult", () => {
  it("reads the deepest column and the outcome", () => {
    const result = warpathRunResult("run-1", warpathEnded("lost", 3));
    expect(result).toEqual({
      mode: "warpath",
      identity: runIdentity(run),
      runId: "run-1",
      score: { won: false, measure: 3 },
    });
    expect(warpathRunResult("run-1", warpathEnded("won", 7))?.score.won).toBe(
      true,
    );
  });
  it("is null while the run is still active", () => {
    expect(warpathRunResult("run-1", warpathEnded("active", 2))).toBeNull();
  });
  it("is null when an encounter stands in for a map the code named", () => {
    const drifted: RogueliteRun = {
      ...warpathEnded("won", 7),
      nodes: run.nodes.map((n) =>
        n.battle
          ? { ...n, battle: { ...n.battle, mapSubstitutedFrom: "Elsewhere" } }
          : n,
      ),
    };
    expect(warpathRunResult("run-1", drifted)).toBeNull();
  });
});
