import { describe, expect, it } from "vitest";
import { BUILD_SQUARE } from "./footprint";
import {
  type BlueprintPayload,
  BUILD_SQUARE_ELMOS,
  parseBlueprintPayload,
  payloadFootprint,
} from "./payload";

const solar: BlueprintPayload = {
  name: "Opening",
  buildings: [
    { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
    { def: "armlab", offset: { x: 96, z: -32 }, facing: 1 },
  ],
  footprints: { armsolar: { x: 5, z: 5 }, armlab: { x: 8, z: 5 } },
};

describe("blueprint payload", () => {
  it("measures offsets in the same elmos the footprint module does", () => {
    expect(BUILD_SQUARE_ELMOS).toBe(BUILD_SQUARE);
  });

  it("reads a payload back unchanged", () => {
    expect(parseBlueprintPayload(structuredClone(solar))).toEqual(solar);
  });

  it("keeps the build order flag and the game", () => {
    const parsed = parseBlueprintPayload({
      ...solar,
      ordered: true,
      game: { name: "Beyond All Reason test", shortname: "BAR" },
    });
    expect(parsed?.ordered).toBe(true);
    expect(parsed?.game).toEqual({
      name: "Beyond All Reason test",
      shortname: "BAR",
    });
  });

  it("leaves out a flag that was not set rather than writing false", () => {
    expect(parseBlueprintPayload(structuredClone(solar))).not.toHaveProperty(
      "ordered",
    );
  });

  it("refuses a payload with no name", () => {
    expect(parseBlueprintPayload({ buildings: [], footprints: {} })).toBeNull();
  });

  it("refuses a layout with a damaged building rather than dropping it", () => {
    expect(
      parseBlueprintPayload({
        name: "Broken",
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armlab", offset: { x: "over there" }, facing: 0 },
        ],
        footprints: {},
      }),
    ).toBeNull();
  });

  it("refuses a facing the engine does not have", () => {
    expect(
      parseBlueprintPayload({
        name: "Broken",
        buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 4 }],
        footprints: {},
      }),
    ).toBeNull();
  });

  it("drops a damaged footprint but keeps the layout", () => {
    const parsed = parseBlueprintPayload({
      ...structuredClone(solar),
      footprints: { armsolar: { x: 5, z: 5 }, armlab: { x: 0, z: null } },
    });
    expect(parsed?.buildings).toHaveLength(2);
    expect(parsed?.footprints).toEqual({ armsolar: { x: 5, z: 5 } });
  });

  it("looks a footprint up whatever case the def was written in", () => {
    expect(payloadFootprint(solar, "ArmSolar")).toEqual({ x: 5, z: 5 });
  });

  it("stands a def it was told nothing about on one square", () => {
    expect(payloadFootprint(solar, "armwin")).toEqual({ x: 1, z: 1 });
  });

  it("is not fooled by a def named after an inherited property", () => {
    expect(payloadFootprint(solar, "constructor")).toEqual({ x: 1, z: 1 });
  });
});
