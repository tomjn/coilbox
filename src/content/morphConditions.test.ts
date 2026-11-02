import { describe, expect, it } from "vitest";
import { splitMorphConditions } from "./morphConditions";

describe("splitMorphConditions", () => {
  it("takes an evolution edge out of the entries", () => {
    expect(splitMorphConditions([["evolves", true]])).toEqual({
      evolves: true,
      rest: [],
    });
  });

  it("keeps a game's own keys beside an evolution", () => {
    expect(
      splitMorphConditions([
        ["energy", 500],
        ["evolves", true],
      ]),
    ).toEqual({ evolves: true, rest: [["energy", 500]] });
  });

  it("does not read evolves: false as an evolution", () => {
    expect(splitMorphConditions([["evolves", false]])).toEqual({
      evolves: false,
      rest: [["evolves", false]],
    });
  });
});
