import { describe, expect, it } from "vitest";

import { type LegoProject, newProject } from "./model";
import type { UnitBounds } from "./s3oBuild";
import { buildUnitDef, luaString } from "./unitDef";

/** A measured model. Most of these only care about the two ground axes, so y
 *  and the middle carry stand-in values unless a test says otherwise. */
function bounds(size: {
  x: number;
  z: number;
  y?: number;
  mid?: [number, number, number];
}): UnitBounds {
  return {
    mid: size.mid ?? [0, 0, 0],
    sizeX: size.x,
    sizeY: size.y ?? 10,
    sizeZ: size.z,
  };
}

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

describe("luaString", () => {
  it("escapes the two characters that would end the literal", () => {
    expect(luaString('a "quote" and a \\ backslash')).toBe(
      '"a \\"quote\\" and a \\\\ backslash"',
    );
  });

  it("escapes the whitespace that cannot appear raw in a short string", () => {
    expect(luaString("one\ntwo\r\nthree\tfour")).toBe(
      '"one\\ntwo\\r\\nthree\\tfour"',
    );
  });

  it("pads a control-character escape to three digits", () => {
    // "\05" would read back as byte 5, losing the digit that followed.
    expect(luaString("\x005")).toBe('"\\0005"');
    expect(luaString("\x07\x1b\x7f")).toBe('"\\007\\027\\127"');
  });

  it("leaves non-ASCII alone, so the UTF-8 bytes survive", () => {
    expect(luaString("café ← 战地")).toBe('"café ← 战地"');
  });

  it("does not let a hostile project name break out of the literal", () => {
    const hostile = '", os.execute("rm -rf /"), "';
    const lua = buildUnitDef(project(hostile, "hostile"), bounds({ x: 32, z: 32 }));

    expect(lua).toContain(`name = "\\", os.execute(\\"rm -rf /\\"), \\""`);
    expect(lua).not.toContain('os.execute("rm');
  });

  it("keeps a newline or control character in a project name out of the source lines", () => {
    const lua = buildUnitDef(
      project("up\nreturn 1 --", "newline"),
      bounds({ x: 32, z: 32 }),
    );

    expect(lua).toContain('name = "up\\nreturn 1 --"');
    const escaped = lua.split("\n").some((l) => l.trim().startsWith("return 1"));
    expect(escaped).toBe(false);
  });
});

describe("buildUnitDef", () => {
  it("keys the table by the unit name and points objectname and script at it", () => {
    const lua = buildUnitDef(
      project("Cake Bot", "cakebot"),
      bounds({ x: 32, z: 32 }),
    );

    expect(lua).toContain('["cakebot"] = {');
    expect(lua).toContain('objectname = "cakebot"');
    expect(lua).toContain('script = "cakebot.lua"');
  });

  it("carries the project's display name into name and description", () => {
    const lua = buildUnitDef(
      project("Cake Bot", "cakebot"),
      bounds({ x: 32, z: 32 }),
    );

    expect(lua).toContain('name = "Cake Bot"');
    expect(lua).toContain("description =");
    expect(lua).toContain("Cake Bot, built with coilbox's unit builder.");
  });

  it("escapes a quote in the name so the generated file still parses", () => {
    const lua = buildUnitDef(
      project('6" Walker', "walker"),
      bounds({ x: 32, z: 32 }),
    );

    expect(lua).toContain('name = "6\\" Walker"');
  });

  it("does not claim it can move, since no movement class is known here", () => {
    const lua = buildUnitDef(
      project("Cake Bot", "cakebot"),
      bounds({ x: 32, z: 32 }),
    );

    expect(lua).toContain("canmove = false");
  });

  it("writes a maxdamage value", () => {
    const lua = buildUnitDef(
      project("Cake Bot", "cakebot"),
      bounds({ x: 32, z: 32 }),
    );

    expect(lua).toMatch(/maxdamage = \d+/);
  });

  it("scales each footprint axis with the model's own extent on that axis", () => {
    const small = buildUnitDef(
      project("Small", "small"),
      bounds({ x: 8, z: 8 }),
    );
    const large = buildUnitDef(
      project("Large", "large"),
      bounds({ x: 80, z: 80 }),
    );

    const footprintOf = (lua: string) =>
      Number(/footprintx = (\d+)/.exec(lua)?.[1]);

    expect(footprintOf(small)).toBeGreaterThanOrEqual(1);
    expect(footprintOf(large)).toBeGreaterThan(footprintOf(small));
  });

  it("writes a different footprint per axis for a unit longer than it is wide", () => {
    // 40.25 by 87.63, the probe from #679: a square footprint derived from a
    // radius would claim 112 by 112. Measuring each axis gives 48 by 96.
    const lua = buildUnitDef(
      project("Probe", "probe"),
      bounds({ x: 40.25, z: 87.63 }),
    );

    expect(lua).toContain("footprintx = 3");
    expect(lua).toContain("footprintz = 6");
  });

  it("rounds a size up to the next step rather than to the nearest one", () => {
    // 17 elmos is just past one 16-elmo step: rounding to nearest would give
    // 1 and leave part of the unit outside its own footprint.
    const lua = buildUnitDef(project("Wide", "wide"), bounds({ x: 17, z: 8 }));

    expect(lua).toContain("footprintx = 2");
    expect(lua).toContain("footprintz = 1");
  });

  it("does not round a size on a step boundary up to the next step", () => {
    // Exactly two steps. Ceiling a value already on the boundary should not
    // push it to 3.
    const lua = buildUnitDef(
      project("Boundary", "boundary"),
      bounds({ x: 32, z: 32 }),
    );

    expect(lua).toContain("footprintx = 2");
    expect(lua).toContain("footprintz = 2");
  });

  it("never writes a footprint below 1, even for a size of 0", () => {
    const lua = buildUnitDef(project("Tiny", "tiny"), bounds({ x: 0, z: 0 }));

    expect(lua).toContain("footprintx = 1");
    expect(lua).toContain("footprintz = 1");
  });

  it("writes a collision volume off the bounding box when the unit has none", () => {
    const lua = buildUnitDef(
      project("Probe", "probe"),
      bounds({ x: 40, y: 12, z: 88 }),
    );

    expect(lua).toContain('collisionvolumetype = "box"');
    expect(lua).toContain('collisionvolumescales = "40 12 88"');
    // The engine measures offsets from the model's middle, and the derived box
    // is centred on exactly that.
    expect(lua).toContain('collisionvolumeoffsets = "0 0 0"');
  });

  it("writes the unit's own volume rather than the derived one", () => {
    const doc: LegoProject = {
      ...project("Probe", "probe"),
      collisionVolume: {
        type: "cyly",
        scales: [20, 30, 20],
        offsets: [0, -4, 2],
      },
    };

    const lua = buildUnitDef(doc, bounds({ x: 40, y: 12, z: 88 }));

    expect(lua).toContain('collisionvolumetype = "cyly"');
    expect(lua).toContain('collisionvolumescales = "20 30 20"');
    expect(lua).toContain('collisionvolumeoffsets = "0 -4 2"');
  });

  it("rounds a measured volume rather than writing its full float", () => {
    const lua = buildUnitDef(
      project("Probe", "probe"),
      bounds({ x: 40.123456, y: 12, z: 88 }),
    );

    expect(lua).toContain('collisionvolumescales = "40.123 12 88"');
  });

  it("writes zeros for a unit with no geometry, deferring to the engine", () => {
    const lua = buildUnitDef(
      project("Empty", "empty"),
      bounds({ x: 0, y: 0, z: 0 }),
    );

    // The engine reads an all-zero volume as none at all and puts its own
    // sphere round the model, which is the same deferral the s3o header makes.
    expect(lua).toContain('collisionvolumescales = "0 0 0"');
  });

  it("gives the same output for the same project, every time", () => {
    const doc = project("Cake Bot", "cakebot");

    expect(buildUnitDef(doc, bounds({ x: 32, z: 32 }))).toBe(
      buildUnitDef(doc, bounds({ x: 32, z: 32 })),
    );
  });

  it("ends with exactly one newline", () => {
    const lua = buildUnitDef(
      project("Cake Bot", "cakebot"),
      bounds({ x: 32, z: 32 }),
    );

    expect(lua.endsWith("\n")).toBe(true);
    expect(lua.endsWith("\n\n")).toBe(false);
  });
});
