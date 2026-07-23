import { describe, expect, it } from "vitest";
import type { PlayerRelation } from "@/content/stats";
import { relationSummary } from "./statsRelationSummary";

function rel(patch: Partial<PlayerRelation>): PlayerRelation {
  return {
    name: "foe",
    gamesShared: 0,
    gamesTogether: 0,
    winsTogether: 0,
    gamesAgainst: 0,
    winsAgainst: 0,
    lastPlayedMs: 0,
    commonMaps: [],
    ...patch,
  };
}

describe("relationSummary", () => {
  it("is null with no shared games or no relation at all", () => {
    expect(relationSummary(null)).toBeNull();
    expect(relationSummary(rel({ gamesShared: 0 }))).toBeNull();
  });

  it("summarises a single shared game", () => {
    expect(relationSummary(rel({ gamesShared: 1 }))).toBe(
      "1 game with this player",
    );
  });

  it("breaks out the teammate and opponent records when present", () => {
    const summary = relationSummary(
      rel({
        gamesShared: 5,
        gamesTogether: 3,
        winsTogether: 2,
        gamesAgainst: 2,
        winsAgainst: 1,
      }),
    );
    expect(summary).toBe(
      "5 games with this player · 2W/1L as teammates · 1W/1L as opponents",
    );
  });
});
