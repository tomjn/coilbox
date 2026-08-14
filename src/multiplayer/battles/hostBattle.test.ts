import { describe, expect, it } from "vitest";
import { hostBattleFailure } from "./hostBattle";

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
