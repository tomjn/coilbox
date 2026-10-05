import { describe, expect, it } from "vitest";
import { hidesGeneratedStyles } from "./ownMapsOnly";

describe("hidesGeneratedStyles", () => {
  const maps = [{}];
  const none = { onlyOwnMaps: [] as string[] };

  it("hides nothing with no flag set", () => {
    expect(hidesGeneratedStyles({ name: "A" }, maps, none, false)).toBe(false);
  });

  it("hides on the profile switch alone", () => {
    expect(hidesGeneratedStyles({ name: "A" }, maps, none, true)).toBe(true);
  });

  it("hides on the archive flag alone, and only for the game that sets it", () => {
    const list = { onlyOwnMaps: ["A"] };
    expect(hidesGeneratedStyles({ name: "A" }, maps, list, false)).toBe(true);
    expect(hidesGeneratedStyles({ name: "B" }, maps, list, false)).toBe(false);
  });

  it("keeps the styles when there is no map, whichever flag is set", () => {
    const list = { onlyOwnMaps: ["A"] };
    expect(hidesGeneratedStyles({ name: "A" }, [], list, true)).toBe(false);
  });
});
