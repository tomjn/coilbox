import { describe, expect, it } from "vitest";
import { missingDependencyNotes } from "./gameDependencies";

describe("missingDependencyNotes", () => {
  it("says each missing archive by name", () => {
    expect(
      missingDependencyNotes({
        missingDependencies: ["zero-k v1.7.6.4", "other v2"],
      }),
    ).toEqual([
      'Depends on "zero-k v1.7.6.4", which is not installed.',
      'Depends on "other v2", which is not installed.',
    ]);
  });

  it("says nothing for a game whose dependencies all resolve", () => {
    expect(missingDependencyNotes({ missingDependencies: [] })).toEqual([]);
  });

  it("says nothing when an older worker sent no field", () => {
    expect(missingDependencyNotes({})).toEqual([]);
  });
});
