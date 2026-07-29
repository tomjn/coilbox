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
    const lua = buildUnitDef(project("Cake Bot", "cakebot"), 32);

    expect(lua).toContain('["cakebot"] = {');
    expect(lua).toContain('objectname = "cakebot"');
    expect(lua).toContain('script = "cakebot.lua"');
  });

  it("carries the project's display name into name and description", () => {
    const lua = buildUnitDef(project("Cake Bot", "cakebot"), 32);

    expect(lua).toContain('name = "Cake Bot"');
    expect(lua).toContain("description =");
    expect(lua).toContain("Cake Bot, built with coilbox's unit builder.");
  });

  it("escapes a quote in the name so the generated file still parses", () => {
    const lua = buildUnitDef(project('6" Walker', "walker"), 32);

    expect(lua).toContain('name = "6\\" Walker"');
  });

  it("does not claim it can move, since no movement class is known here", () => {
    const lua = buildUnitDef(project("Cake Bot", "cakebot"), 32);

    expect(lua).toContain("canmove = false");
  });

  it("writes a maxdamage value", () => {
    const lua = buildUnitDef(project("Cake Bot", "cakebot"), 32);

    expect(lua).toMatch(/maxdamage = \d+/);
  });

  it("scales the footprint with the model's radius", () => {
    const small = buildUnitDef(project("Small", "small"), 8);
    const large = buildUnitDef(project("Large", "large"), 80);

    const footprintOf = (lua: string) =>
      Number(/footprintx = (\d+)/.exec(lua)?.[1]);

    expect(footprintOf(small)).toBeGreaterThanOrEqual(1);
    expect(footprintOf(large)).toBeGreaterThan(footprintOf(small));
  });

  it("never writes a footprint below 1, even for a radius of 0", () => {
    const lua = buildUnitDef(project("Tiny", "tiny"), 0);

    expect(lua).toContain("footprintx = 1");
    expect(lua).toContain("footprintz = 1");
  });

  it("gives the same output for the same project, every time", () => {
    const doc = project("Cake Bot", "cakebot");

    expect(buildUnitDef(doc, 32)).toBe(buildUnitDef(doc, 32));
  });

  it("ends with exactly one newline", () => {
    const lua = buildUnitDef(project("Cake Bot", "cakebot"), 32);

    expect(lua.endsWith("\n")).toBe(true);
    expect(lua.endsWith("\n\n")).toBe(false);
  });
});
