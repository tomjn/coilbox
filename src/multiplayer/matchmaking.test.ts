import { describe, expect, it } from "vitest";
import type { Matchmaking, MatchQueue } from "./bindings";
import {
  countdown,
  describeQueue,
  searchingIn,
  secondsLeft,
} from "./matchmaking";

function queue(id: string, name: string, ranked = true): MatchQueue {
  return {
    id,
    name,
    teams: 2,
    teamSize: 1,
    ranked,
    maps: ["Theta Crystals 1.3"],
    games: ["Beyond All Reason test-27414"],
    engines: ["2025.01.6"],
  };
}

function state(partial: Partial<Matchmaking> = {}): Matchmaking {
  return {
    supported: true,
    queues: [],
    searching: [],
    found: null,
    ...partial,
  };
}

describe("secondsLeft", () => {
  it("rounds up so the last part second still reads as a second", () => {
    expect(secondsLeft(10_500, 0)).toBe(11);
  });

  it("never goes below zero once the deadline has passed", () => {
    expect(secondsLeft(1_000, 9_000)).toBe(0);
  });
});

describe("countdown", () => {
  it("pads the seconds", () => {
    expect(countdown(65)).toBe("1:05");
    expect(countdown(9)).toBe("0:09");
  });
});

describe("describeQueue", () => {
  it("says the shape and whether it counts", () => {
    expect(describeQueue(queue("1v1", "Duel"))).toBe("2 teams of 1, ranked");
    expect(describeQueue(queue("1v1", "Duel", false))).toBe("2 teams of 1");
  });
});

describe("searchingIn", () => {
  it("names each queue we are searching in", () => {
    const mm = state({ queues: [queue("1v1", "Duel")], searching: ["1v1"] });
    expect(searchingIn(mm)).toEqual(["Duel"]);
  });

  // A party member can put us into a queue the list never described.
  it("falls back to the id for a queue we have no description of", () => {
    const mm = state({ searching: ["2v2"] });
    expect(searchingIn(mm)).toEqual(["2v2"]);
  });
});
