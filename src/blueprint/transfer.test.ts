import { describe, expect, it } from "vitest";
import { identify } from "../container/container";
import { buildingFootprints } from "./footprint";
import type { BaseBlueprint } from "./model";
import {
  blueprintFromPayload,
  blueprintPayload,
  encodeBlueprintCode,
  encodeBlueprintJson,
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

  it("round-trips through a share code as well as a file", () => {
    const code = encodeBlueprintCode(layout, { footprintOf });
    expect(code.ok).toBe(true);
    if (!code.ok) return;
    const read = readBlueprintContainer(code.code);
    expect(read.ok && read.payload.buildings).toEqual(layout.buildings);
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
