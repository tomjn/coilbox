import { describe, expect, it } from "vitest";
import { bumpAiHandicap, describeOutcome } from "./debrief";
import type { Participant } from "./participants";

describe("describeOutcome", () => {
  it("reports victory without hedging", () => {
    expect(describeOutcome("victory")).toEqual({
      outcome: "victory",
      headline: "Victory!",
    });
  });

  it("reports defeat without hedging", () => {
    expect(describeOutcome("defeat")).toEqual({
      outcome: "defeat",
      headline: "Defeat.",
    });
  });

  it("never fabricates a winner when ambiguous", () => {
    const { outcome, headline } = describeOutcome("ambiguous");
    expect(outcome).toBe("unknown");
    expect(headline).not.toMatch(/victory|defeat/i);
  });

  it("distinguishes no replay from an undecodable one", () => {
    expect(describeOutcome("no-replay").headline).toMatch(/no replay/i);
    expect(describeOutcome("decode-failed").headline).toMatch(
      /couldn't be read/i,
    );
  });
});

function ai(overrides: Partial<Participant> = {}): Participant {
  return {
    id: "a1",
    kind: "ai",
    name: "AI 1",
    side: "",
    color: [0, 0, 0],
    allyTeam: 1,
    spectator: false,
    ...overrides,
  };
}

function you(overrides: Partial<Participant> = {}): Participant {
  return {
    id: "you",
    kind: "you",
    name: "You",
    side: "",
    color: [1, 1, 1],
    allyTeam: 0,
    spectator: false,
    ...overrides,
  };
}

describe("bumpAiHandicap", () => {
  it("bumps only AI participants, leaving you untouched", () => {
    const result = bumpAiHandicap([you(), ai()], 10);
    expect(result[0].handicap).toBeUndefined();
    expect(result[1].handicap).toBe(10);
  });

  it("adds to an existing handicap", () => {
    const result = bumpAiHandicap([ai({ handicap: 15 })], 10);
    expect(result[0].handicap).toBe(25);
  });

  it("clamps at 0 and clears back to undefined rather than storing 0", () => {
    const result = bumpAiHandicap([ai({ handicap: 5 })], -10);
    expect(result[0].handicap).toBeUndefined();
  });

  it("clamps at 100", () => {
    const result = bumpAiHandicap([ai({ handicap: 95 })], 25);
    expect(result[0].handicap).toBe(100);
  });
});
