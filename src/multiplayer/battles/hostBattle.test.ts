import { describe, expect, it } from "vitest";
import { battleTitleProblem, hostBattleFailure } from "./hostBattle";

describe("hostBattleFailure", () => {
  it("carries the refusal, which is the only account of it there is", () => {
    expect(
      hostBattleFailure(new Error("a battle password cannot contain spaces")),
    ).toBe(
      "Could not host the battle: a battle password cannot contain spaces",
    );
  });

  it("takes something thrown that is not an Error", () => {
    expect(hostBattleFailure("connection is closed")).toBe(
      "Could not host the battle: connection is closed",
    );
  });

  // Rather than a colon with nothing after it, which reads as a truncated
  // message and tells the host less than saying nothing would.
  it("stands alone when there is nothing to carry", () => {
    expect(hostBattleFailure(new Error(""))).toBe("Could not host the battle.");
    expect(hostBattleFailure(undefined)).toBe("Could not host the battle.");
  });
});

describe("battleTitleProblem", () => {
  it("takes the titles a host types and a preset names", () => {
    expect(battleTitleProblem("")).toBeNull();
    expect(battleTitleProblem("Fun & games: 8v8 [no rush] - héllo")).toBeNull();
  });

  // The form trims the title before it sends it, so an edge is not a problem.
  it("does not mind a tab at either end, which the form trims", () => {
    expect(battleTitleProblem("\tFun\t")).toBeNull();
  });

  it("refuses a tab or another control character inside the title", () => {
    for (const title of [
      "Fun\tOther game",
      "Fun\u0001x",
      "Fun\u007fx",
      "a\nb",
    ]) {
      expect(battleTitleProblem(title), JSON.stringify(title)).toBe(
        "The title cannot contain a tab or another control character.",
      );
    }
  });
});
