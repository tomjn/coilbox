import { describe, expect, it } from "vitest";

import { newProject } from "./model";
import { buildUnitDef } from "./unitDef";

function project(name: string, unitName?: string) {
  return newProject({
    id: "p",
    rootPieceId: "root",
    name,
    unitName,
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
}

describe("buildUnitDef", () => {
  it("keys the table by the unit name and points objectname and script at it", () => {
    const lua = buildUnitDef(project("Cake Bot", "cakebot"), { x: 32, z: 32 });

    expect(lua).toContain('["cakebot"] = {');
    expect(lua).toContain('objectname = "cakebot"');
    expect(lua).toContain('script = "cakebot.lua"');
  });

  it("carries the project's display name into name and description", () => {
    const lua = buildUnitDef(project("Cake Bot", "cakebot"), { x: 32, z: 32 });

    expect(lua).toContain('name = "Cake Bot"');
    expect(lua).toContain("description =");
    expect(lua).toContain("Cake Bot, built with coilbox's unit builder.");
  });

  it("escapes a quote in the name so the generated file still parses", () => {
    const lua = buildUnitDef(project('6" Walker', "walker"), { x: 32, z: 32 });

    expect(lua).toContain('name = "6\\" Walker"');
  });

  it("does not claim it can move, since no movement class is known here", () => {
    const lua = buildUnitDef(project("Cake Bot", "cakebot"), { x: 32, z: 32 });

    expect(lua).toContain("canmove = false");
  });

  it("writes a maxdamage value", () => {
    const lua = buildUnitDef(project("Cake Bot", "cakebot"), { x: 32, z: 32 });

    expect(lua).toMatch(/maxdamage = \d+/);
  });

  it("scales each footprint axis with the model's own extent on that axis", () => {
    const small = buildUnitDef(project("Small", "small"), { x: 8, z: 8 });
    const large = buildUnitDef(project("Large", "large"), { x: 80, z: 80 });

    const footprintOf = (lua: string) =>
      Number(/footprintx = (\d+)/.exec(lua)?.[1]);

    expect(footprintOf(small)).toBeGreaterThanOrEqual(1);
    expect(footprintOf(large)).toBeGreaterThan(footprintOf(small));
  });

  it("writes a different footprint per axis for a unit longer than it is wide", () => {
    // 40.25 by 87.63, the probe from #679: a square footprint derived from a
    // radius would claim 112 by 112. Measuring each axis gives 48 by 96.
    const lua = buildUnitDef(project("Probe", "probe"), { x: 40.25, z: 87.63 });

    expect(lua).toContain("footprintx = 3");
    expect(lua).toContain("footprintz = 6");
  });

  it("rounds a size up to the next step rather than to the nearest one", () => {
    // 17 elmos is just past one 16-elmo step: rounding to nearest would give
    // 1 and leave part of the unit outside its own footprint.
    const lua = buildUnitDef(project("Wide", "wide"), { x: 17, z: 8 });

    expect(lua).toContain("footprintx = 2");
    expect(lua).toContain("footprintz = 1");
  });

  it("does not round a size on a step boundary up to the next step", () => {
    // Exactly two steps. Ceiling a value already on the boundary should not
    // push it to 3.
    const lua = buildUnitDef(project("Boundary", "boundary"), {
      x: 32,
      z: 32,
    });

    expect(lua).toContain("footprintx = 2");
    expect(lua).toContain("footprintz = 2");
  });

  it("never writes a footprint below 1, even for a size of 0", () => {
    const lua = buildUnitDef(project("Tiny", "tiny"), { x: 0, z: 0 });

    expect(lua).toContain("footprintx = 1");
    expect(lua).toContain("footprintz = 1");
  });

  it("gives the same output for the same project, every time", () => {
    const doc = project("Cake Bot", "cakebot");

    expect(buildUnitDef(doc, { x: 32, z: 32 })).toBe(
      buildUnitDef(doc, { x: 32, z: 32 }),
    );
  });

  it("ends with exactly one newline", () => {
    const lua = buildUnitDef(project("Cake Bot", "cakebot"), { x: 32, z: 32 });

    expect(lua.endsWith("\n")).toBe(true);
    expect(lua.endsWith("\n\n")).toBe(false);
  });
});
