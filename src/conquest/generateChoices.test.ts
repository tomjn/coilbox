import { describe, expect, it } from "vitest";
import { readGenerateChoices } from "./generateChoices";

describe("readGenerateChoices", () => {
  it("reads a stored planet and drops one of the wrong type", () => {
    expect(readGenerateChoices({ planet: "ice" }).planet).toBe("ice");
    expect(readGenerateChoices({ planet: 3 }).planet).toBeUndefined();
  });
});
