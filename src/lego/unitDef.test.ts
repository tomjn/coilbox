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
    const lua = buildUnitDef(
      project(hostile, "hostile"),
      bounds({ x: 32, z: 32 }),
    );

    expect(lua).toContain(`name = "\\", os.execute(\\"rm -rf /\\"), \\""`);
    expect(lua).not.toContain('os.execute("rm');
  });

  it("keeps a newline or control character in a project name out of the source lines", () => {
    const lua = buildUnitDef(
      project("up\nreturn 1 --", "newline"),
      bounds({ x: 32, z: 32 }),
    );

    expect(lua).toContain('name = "up\\nreturn 1 --"');
    const escaped = lua
      .split("\n")
      .some((l) => l.trim().startsWith("return 1"));
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

  /** The engine adds these offsets to the unit's midPos, which is the aim
   *  point, so a unit aimed at somewhere other than the middle of its box
   *  needs offsets that put the box back where the geometry is. */
  it("offsets the derived volume back onto the box when the aim point has moved", () => {
    const doc: LegoProject = {
      ...project("Probe", "probe"),
      mid: [0, 6, 0],
    };

    const lua = buildUnitDef(
      doc,
      bounds({ x: 10, y: 40, z: 10, mid: [0, 20, 0] }),
    );

    expect(lua).toContain('collisionvolumeoffsets = "0 14 0"');
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

  it("asks for piece collision only when the unit wants it", () => {
    const off = buildUnitDef(
      project("Probe", "probe"),
      bounds({ x: 40, z: 8 }),
    );
    const on = buildUnitDef(
      { ...project("Probe", "probe"), pieceCollision: true },
      bounds({ x: 40, z: 8 }),
    );

    expect(off).not.toContain("usepiececollisionvolumes");
    expect(on).toContain("usepiececollisionvolumes = true");
  });

  it("asks for piece selection only when the unit wants it", () => {
    const off = buildUnitDef(
      project("Probe", "probe"),
      bounds({ x: 40, z: 8 }),
    );
    const on = buildUnitDef(
      { ...project("Probe", "probe"), pieceSelection: true },
      bounds({ x: 40, z: 8 }),
    );

    expect(off).not.toContain("usepieceselectionvolumes");
    expect(on).toContain("usepieceselectionvolumes = true");
  });

  it("keeps the two piece switches independent of each other", () => {
    // The engine reads them in two different functions, and shot at piece by
    // piece while clicked as one box is a unit somebody meant to build.
    const shot = buildUnitDef(
      { ...project("Probe", "probe"), pieceCollision: true },
      bounds({ x: 40, z: 8 }),
    );
    const clicked = buildUnitDef(
      { ...project("Probe", "probe"), pieceSelection: true },
      bounds({ x: 40, z: 8 }),
    );

    expect(shot).not.toContain("usepieceselectionvolumes");
    expect(clicked).not.toContain("usepiececollisionvolumes");
  });

  it("still writes the unit's own volume when pieces do the hitting", () => {
    // It is still the selection shape and still the sphere an explosion
    // measures, so dropping it would break both.
    const lua = buildUnitDef(
      { ...project("Probe", "probe"), pieceCollision: true },
      bounds({ x: 40, y: 12, z: 88 }),
    );

    expect(lua).toContain('collisionvolumescales = "40 12 88"');
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

  /**
   * `UnitDef::IsBuilderUnit` is `builder && buildSpeed > 0 && buildDistance >
   * 0`, and `builder` is `&=`'d against it immediately after being read. So a
   * definition claiming `builder` without a work rate clears its own claim and
   * the unit is not a builder, with nothing said anywhere.
   */
  describe("builder keys", () => {
    /** A build arm is what says the unit builds. There is no separate switch,
     *  because the roles already carry the answer. */
    function withArm(role = "buildarm.arm"): LegoProject {
      const base = project("Con Bot", "conbot");
      return {
        ...base,
        pieces: [
          ...base.pieces,
          {
            id: "arm",
            name: "arm",
            parentId: base.rootPieceId,
            partId: null,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            role,
          },
        ],
      };
    }

    it("writes nothing for a unit with no build arm on it", () => {
      const lua = buildUnitDef(project("Cake Bot"), bounds({ x: 32, z: 32 }));

      // The key, not the word: the file's own header says "unit builder".
      expect(lua).not.toContain("builder = ");
      expect(lua).not.toContain("workertime");
    });

    it("writes all three together, since one without the others is discarded", () => {
      const lua = buildUnitDef(withArm(), bounds({ x: 32, z: 32 }));

      expect(lua).toContain("builder = true");
      expect(lua).toContain("workertime = 100");
      expect(lua).toContain("builddistance = 128");
      expect(lua).toContain("canassist = true");
    });

    /** Any of the build roles, not just the arm: a unit can be nano points and
     *  a nozzle with no arm modelled between them. */
    it("counts a nano point or a nozzle as a build arm", () => {
      for (const role of [
        "buildarm.nano",
        "buildarm.nozzle",
        "buildarm.base",
      ]) {
        expect(buildUnitDef(withArm(role), bounds({ x: 8, z: 8 }))).toContain(
          "builder = true",
        );
      }
    });

    it("takes the numbers the unit carries over the defaults", () => {
      const lua = buildUnitDef(
        {
          ...withArm(),
          builder: { workerTime: 350, buildDistance: 420, canAssist: false },
        },
        bounds({ x: 32, z: 32 }),
      );

      expect(lua).toContain("workertime = 350");
      expect(lua).toContain("builddistance = 420");
      expect(lua).toContain("canassist = false");
    });

    /** A partial block is what a unit gets after one slider is touched, so the
     *  rest still has to come from the defaults rather than from nothing. */
    it("fills the rest from the defaults when only one is set", () => {
      const lua = buildUnitDef(
        { ...withArm(), builder: { workerTime: 250 } },
        bounds({ x: 32, z: 32 }),
      );

      expect(lua).toContain("workertime = 250");
      expect(lua).toContain("builddistance = 128");
    });
  });
});
