import { describe, expect, it } from "vitest";
import {
  MAX_PLAYERS_RANGE,
  type NewZerokBattleForm,
  newZerokBattleProblem,
  seatedBy,
  ZEROK_BATTLE_MODES,
} from "./zerokBattle";

function form(patch: Partial<NewZerokBattleForm> = {}): NewZerokBattleForm {
  return {
    title: "Comet Catcher teams",
    mode: "custom",
    maxPlayers: 8,
    ...patch,
  };
}

describe("newZerokBattleProblem", () => {
  it("passes a filled-in form", () => {
    expect(newZerokBattleProblem(form())).toBeNull();
  });

  it("wants a title that is not only spaces", () => {
    expect(newZerokBattleProblem(form({ title: "" }))).toBe(
      "Give the battle a title.",
    );
    expect(newZerokBattleProblem(form({ title: "   " }))).toBe(
      "Give the battle a title.",
    );
  });

  it("holds the size to something a Spring match can be played with", () => {
    expect(newZerokBattleProblem(form({ maxPlayers: 1 }))).toBe(
      `A battle seats between ${MAX_PLAYERS_RANGE.min} and ${MAX_PLAYERS_RANGE.max} players.`,
    );
    expect(newZerokBattleProblem(form({ maxPlayers: 33 }))).not.toBeNull();
  });

  it("asks for no map, because the server picks one when we name none", () => {
    expect(newZerokBattleProblem(form())).toBeNull();
  });
});

describe("seatedBy", () => {
  // Every number here is `ServerBattle.ValidateAndFillDetails` upstream, which
  // runs after the header arrives and is what actually decides the size.
  it("keeps the size a custom battle asked for", () => {
    expect(seatedBy("custom", 8)).toBe(8);
  });

  it("seats two in a 1v1 whatever was asked for", () => {
    expect(seatedBy("1v1", 8)).toBe(2);
  });

  it("raises a size below the mode's own minimum", () => {
    expect(seatedBy("teams", 2)).toBe(16);
    expect(seatedBy("ffa", 2)).toBe(16);
    expect(seatedBy("coop", 1)).toBe(10);
  });

  it("leaves a size at or above the minimum alone", () => {
    expect(seatedBy("teams", 4)).toBe(4);
    expect(seatedBy("ffa", 3)).toBe(3);
    expect(seatedBy("coop", 2)).toBe(2);
  });
});

describe("ZEROK_BATTLE_MODES", () => {
  it("is labelled the way the game labels the modes", () => {
    expect(ZEROK_BATTLE_MODES.map((m) => m.label)).toEqual([
      "Custom",
      "Teams",
      "1v1",
      "FFA",
      "Cooperative",
    ]);
  });
});
