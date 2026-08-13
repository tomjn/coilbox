import { describe, expect, it } from "vitest";
import { identify } from "../container/container";
import { buildingFootprints, declaredFootprints } from "./footprint";
import type { BaseBlueprint } from "./model";
import { payloadFootprint } from "./payload";
import {
  blueprintFromPayload,
  blueprintPayload,
  encodeBlueprintCode,
  encodeBlueprintJson,
  encodePayloadCode,
  encodePayloadJson,
  readBlueprintContainer,
} from "./transfer";

const units = [
  { name: "armsolar", footprintX: 5, footprintZ: 5 },
  { name: "armlab", footprintX: 8, footprintZ: 5 },
];

const footprintOf = buildingFootprints(units);

const layout: BaseBlueprint = {
  id: "local-id",
  name: "Opening",
  ordered: true,
  buildings: [
    { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
    { def: "armsolar", offset: { x: 80, z: 0 }, facing: 0 },
    { def: "armlab", offset: { x: 0, z: -96 }, facing: 1 },
  ],
};

describe("blueprint transfer", () => {
  it("carries a layout out through a container and back unchanged", () => {
    const json = encodeBlueprintJson(layout, {
      footprintOf,
      gameName: "Beyond All Reason test",
    });
    const read = readBlueprintContainer(json);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(blueprintFromPayload(read.payload)).toEqual({
      name: layout.name,
      ordered: true,
      buildings: layout.buildings,
    });
  });

  it("carries what a substituted building was drawn as out and back", () => {
    // A layout converted to another side is still a layout somebody shares, and
    // the name it was drawn as is what makes the conversion reversible at the
    // far end (issue #1314).
    const converted: BaseBlueprint = {
      ...layout,
      buildings: [
        {
          def: "corsolar",
          offset: { x: 0, z: 0 },
          facing: 0,
          originalName: "armsolar",
        },
      ],
    };
    const read = readBlueprintContainer(
      encodeBlueprintJson(converted, { footprintOf }),
    );
    expect(read.ok && blueprintFromPayload(read.payload).buildings).toEqual(
      converted.buildings,
    );
  });

  it("round-trips through a share code as well as a file", () => {
    const code = encodeBlueprintCode(layout, { footprintOf });
    expect(code.ok).toBe(true);
    if (!code.ok) return;
    const read = readBlueprintContainer(code.code);
    expect(read.ok && read.payload.buildings).toEqual(layout.buildings);
  });

  it("sends a stored layout without rebuilding it", () => {
    // The library keeps the wire shape, footprints and all, so sharing one is
    // wrapping what is already on disk rather than deriving it again from a
    // unitsync read the sharer may no longer be able to do.
    const stored = blueprintPayload(layout, {
      footprintOf,
      gameName: "Beyond All Reason test",
    });
    const read = readBlueprintContainer(encodePayloadJson(stored));
    expect(read.ok && read.payload).toEqual(stored);

    const code = encodePayloadCode(stored);
    expect(code.ok).toBe(true);
    if (!code.ok) return;
    expect(readBlueprintContainer(code.code)).toEqual({
      ok: true,
      payload: stored,
    });
  });

  /** Issue #1315 put the map a layout was shaped around on the layout. A layout
   *  leaving a mission for the library or for somebody else is exactly where
   *  that provenance is worth having, so it travels. */
  it("carries the map the layout was drawn for", () => {
    const payload = blueprintPayload(
      { ...layout, designedFor: "Comet Catcher Remake 1.8" },
      { footprintOf },
    );
    expect(payload.designedFor).toBe("Comet Catcher Remake 1.8");
    const read = readBlueprintContainer(encodePayloadJson(payload));
    expect(read.ok && blueprintFromPayload(read.payload).designedFor).toBe(
      "Comet Catcher Remake 1.8",
    );
  });

  it("says nothing about a map for a layout drawn on none", () => {
    const payload = blueprintPayload(layout, { footprintOf });
    expect(payload).not.toHaveProperty("designedFor");
    expect(blueprintFromPayload(payload)).not.toHaveProperty("designedFor");
  });

  it("mints no id, because the machine reading it owns that", () => {
    const payload = blueprintPayload(layout, { footprintOf });
    expect(payload).not.toHaveProperty("id");
    expect(blueprintFromPayload(payload)).not.toHaveProperty("id");
  });

  it("carries what each building stands on, so a reader can size it", () => {
    const payload = blueprintPayload(layout, { footprintOf });
    expect(payload.footprints).toEqual({
      armsolar: { x: 5, z: 5 },
      armlab: { x: 8, z: 5 },
    });
  });

  it("names a def's footprint once however many times it is placed", () => {
    const payload = blueprintPayload(layout, { footprintOf });
    expect(Object.keys(payload.footprints)).toHaveLength(2);
  });

  it("records nothing for a def the game has not got (issue #1463)", () => {
    // A layout naming a unit this game never had is a real thing to save: a
    // mission whose game was changed under it, or one imported from another
    // game's file. One square is the engine's floor rather than the truth, and
    // a stored one travels to the hub as a claim about a unit nobody read.
    const stranger: BaseBlueprint = {
      ...layout,
      buildings: [
        ...layout.buildings,
        { def: "legmex", offset: { x: 160, z: 0 }, facing: 0 },
      ],
    };
    const payload = blueprintPayload(stranger, {
      footprintOf: declaredFootprints(units),
    });
    expect(payload.footprints).not.toHaveProperty("legmex");
    expect(payload.footprints.armsolar).toEqual({ x: 5, z: 5 });
    expect(payloadFootprint(payload, "legmex")).toEqual({ x: 1, z: 1 });
  });

  it("records nothing at all when the game's units are unread", () => {
    const payload = blueprintPayload(layout, {});
    expect(payload.footprints).toEqual({});
    expect(payload.buildings).toHaveLength(3);
  });

  it("names the game the way every other kind does", () => {
    const payload = blueprintPayload(layout, {
      footprintOf,
      gameName: "Beyond All Reason test",
      installed: [
        { name: "Beyond All Reason test", info: { shortname: "BAR" } },
      ],
    });
    expect(payload.game).toEqual({
      name: "Beyond All Reason test",
      shortname: "BAR",
    });
  });

  it("identifies itself as a blueprint, with the game it is for", () => {
    const json = encodeBlueprintJson(layout, {
      footprintOf,
      gameName: "Beyond All Reason test",
    });
    const found = identify(json);
    expect(found.kind).toBe("blueprint");
    expect(found.compatibility).toBe("ok");
    expect(found.game?.name).toBe("Beyond All Reason test");
  });

  it("refuses to read a container of another kind", () => {
    const json = encodeBlueprintJson(layout, { footprintOf });
    const scenario = json.replace('"kind": "blueprint"', '"kind": "scenario"');
    expect(readBlueprintContainer(scenario)).toEqual({
      ok: false,
      error: "wrong-kind",
    });
  });

  it("gives a big layout a code somebody can actually paste", () => {
    const big: BaseBlueprint = {
      id: "big",
      name: "Everything",
      buildings: Array.from({ length: 400 }, (_, i) => ({
        def: i % 2 === 0 ? "armsolar" : "armlab",
        offset: { x: (i % 20) * 96, z: Math.floor(i / 20) * 96 },
        facing: (i % 4) as 0 | 1 | 2 | 3,
      })),
    };
    const code = encodeBlueprintCode(big, { footprintOf });
    expect(code.ok).toBe(true);
    if (!code.ok) return;
    // Comfortably inside the 512 KB a code may inflate to, which is the point
    // of measuring it: the footprints add a fixed dictionary, not a field per
    // building.
    expect(code.code.length).toBeLessThan(8000);
  });

  it("refuses a code for a layout past what a code can carry", () => {
    const huge: BaseBlueprint = {
      id: "huge",
      name: "Absurd",
      buildings: Array.from({ length: 12000 }, (_, i) => ({
        def: `armunit${i}`,
        offset: { x: i * 16, z: i * 16 },
        facing: 0 as const,
      })),
    };
    const code = encodeBlueprintCode(huge, { footprintOf });
    expect(code.ok).toBe(false);
    if (code.ok) return;
    expect(code.message).toContain("Export it as a file");
  });
});
