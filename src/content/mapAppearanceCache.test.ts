import { describe, expect, it } from "vitest";
import { spaceMapNames } from "./mapAppearanceCache";

describe("spaceMapNames", () => {
  it("returns only maps whose appearance has voidWater === true", () => {
    const set = spaceMapNames({
      "Nova Rift": { voidWater: true },
      "Green Valley": { voidWater: false },
      "Old Map": { voidWater: null },
      Unknown: {},
    });
    expect(set.has("Nova Rift")).toBe(true);
    expect(set.has("Green Valley")).toBe(false);
    expect(set.has("Old Map")).toBe(false);
    expect(set.has("Unknown")).toBe(false);
    expect(set.size).toBe(1);
  });

  it("is empty for an empty cache", () => {
    expect(spaceMapNames({}).size).toBe(0);
  });
});
