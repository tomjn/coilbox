import { describe, expect, it } from "vitest";
import { paintsTowns } from "./townGate";

const handmade = (towns?: boolean) => ({
  handmade: { mapId: "m", ...(towns === undefined ? {} : { towns }) },
});

describe("paintsTowns", () => {
  it("paints on a generated map", () => {
    expect(paintsTowns({}, true, false)).toBe(true);
  });

  it("paints on a hand-made map only when its manifest asked", () => {
    expect(paintsTowns(handmade(true), false, false)).toBe(true);
    expect(paintsTowns(handmade(false), false, false)).toBe(false);
    expect(paintsTowns(handmade(), false, false)).toBe(false);
  });

  it("paints nothing on a map with no pixels and no hand-made block", () => {
    expect(paintsTowns({}, false, false)).toBe(false);
  });

  it("goes without in performance mode, whatever the map asked", () => {
    expect(paintsTowns(handmade(true), false, true)).toBe(false);
    expect(paintsTowns({}, true, true)).toBe(false);
  });
});
