/**
 * The generated per-piece collision file (issue #1842).
 *
 * What matters here is that the numbers reaching
 * `Spring.SetUnitPieceCollisionVolumeData` are the ones the engine reads, since
 * nothing on this machine can open a GL context to check in a running Spring.
 * Each assertion below names the engine source it was taken from.
 */

import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";
import type { LegoPiece, LegoProject } from "./model";
import { newProject } from "./model";
import {
  buildPieceCollisionScript,
  hasPieceCollision,
  pieceCollisionInclude,
  pieceCollisionScriptPath,
} from "./pieceCollisionScript";
import type { BakedPiece } from "./s3oBuild";

/** A piece whose vertices span a box of the given size about the origin. */
function bakedBox(
  size: [number, number, number],
  offset: [number, number, number] = [0, 0, 0],
): BakedPiece {
  const half = size.map((n) => n / 2) as [number, number, number];
  const corner = (sign: number) => ({
    pos: [sign * half[0], sign * half[1], sign * half[2]] as [
      number,
      number,
      number,
    ],
    normal: [0, 1, 0] as [number, number, number],
    uv: [0, 0] as [number, number],
  });
  return {
    offset,
    vertices: [corner(-1), corner(1)],
    indices: [],
  } as unknown as BakedPiece;
}

function unit(pieces: LegoPiece[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "base",
    name: "radar",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-21T00:00:00Z",
  });
  return {
    ...base,
    unitName: "radar",
    pieces: [...base.pieces, ...pieces],
  };
}

function piece(over: Partial<LegoPiece> & { id: string }): LegoPiece {
  return {
    name: over.id,
    parentId: "base",
    partId: "part",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...over,
  };
}

const baked = (project: LegoProject) =>
  new Map(project.pieces.map((p) => [p.id, bakedBox([10, 4, 10])]));

describe("pieceCollisionScriptPath", () => {
  it("goes in a folder of coilbox's own under scripts", () => {
    expect(pieceCollisionScriptPath("radar")).toBe(
      "coilbox/radar_collision.lua",
    );
  });

  it("is included by a path relative to scripts, which is what include takes", () => {
    // unit_script.lua's ScriptInclude does UNITSCRIPT_DIR .. filename, so a
    // leading "scripts/" here would resolve to scripts/scripts/.
    expect(pieceCollisionInclude("radar")).toBe(
      'include("coilbox/radar_collision.lua")',
    );
  });
});

describe("hasPieceCollision", () => {
  it("is false for a unit where every piece keeps its derived box", () => {
    expect(hasPieceCollision(unit([piece({ id: "dish" })]))).toBe(false);
  });

  it("is true once a piece carries anything of its own", () => {
    expect(
      hasPieceCollision(
        unit([piece({ id: "dish", collision: { hit: false } })]),
      ),
    ).toBe(true);
  });
});

describe("buildPieceCollisionScript", () => {
  /**
   * The include line lives in a script an export never rewrites, so a unit that
   * stops overriding things must still leave a file behind. `LoadChunk` logs an
   * error for every unit created when an include finds nothing.
   */
  it("is still a file, doing nothing, when nothing is overridden", () => {
    const project = unit([piece({ id: "dish" })]);
    const lua = buildPieceCollisionScript(project, baked(project));

    expect(lua).toContain("does nothing");
    expect(lua).not.toContain("SetUnitPieceCollisionVolumeData");
  });

  it("writes only the pieces that override something", () => {
    const project = unit([
      piece({ id: "dish", collision: { hit: false } }),
      piece({ id: "hull" }),
    ]);
    const lua = buildPieceCollisionScript(project, baked(project));
    expect(lua).toContain('local dish = piece("dish")');
    expect(lua).not.toContain("hull");
  });

  it("switches a piece off with a literal false, which the call checks strictly", () => {
    // LuaSyncedCtrl.cpp: luaL_checkboolean(L, 3) is luaL_checktype LUA_TBOOLEAN,
    // so a 0 or a nil raises rather than converting.
    const project = unit([piece({ id: "aerial", collision: { hit: false } })]);
    const lua = buildPieceCollisionScript(project, baked(project));
    expect(lua).toContain(
      "Spring.SetUnitPieceCollisionVolumeData(unitID, aerial, false, 10, 4, 10, 0, 0, 0, 2, 2)",
    );
  });

  it("falls back to the derived box for a piece switched off but not resized", () => {
    // The call has no "keep what is there" sentinel: scales and offsets are
    // written on every call, so the honest numbers are the ones the engine
    // built for itself.
    const project = unit([piece({ id: "aerial", collision: { hit: false } })]);
    const lua = buildPieceCollisionScript(project, baked(project));
    expect(lua).toContain(", 10, 4, 10, 0, 0, 0,");
  });

  it("writes a resized box as full extents in the piece's own space", () => {
    // CollisionVolume::SetAxisScales keeps what it is given as fullAxisScales,
    // and CollisionHandler translates by the offsets on top of the piece's own
    // model-space matrix, so both are the piece's numbers rather than the unit's.
    const project = unit([
      piece({
        id: "dish",
        collision: {
          hit: true,
          volume: { type: "box", scales: [30, 4, 30], offsets: [0, 2, 0] },
        },
      }),
    ]);
    const lua = buildPieceCollisionScript(project, baked(project));
    expect(lua).toContain(
      "Spring.SetUnitPieceCollisionVolumeData(unitID, dish, true, 30, 4, 30, 0, 2, 0, 2, 2)",
    );
  });

  it("writes the shape as a number, not the letters a unit definition uses", () => {
    // CollisionVolume.h: 0 ellipsoid, 1 cylinder, 2 box, 3 sphere.
    const shapes = [
      ["ellipsoid", "0, 2"],
      ["cylx", "1, 0"],
      ["cyly", "1, 1"],
      ["cylz", "1, 2"],
      ["box", "2, 2"],
      ["sphere", "3, 2"],
    ] as const;
    for (const [type, args] of shapes) {
      const project = unit([
        piece({
          id: "dish",
          collision: {
            hit: true,
            volume: { type, scales: [2, 2, 2], offsets: [0, 0, 0] },
          },
        }),
      ]);
      const lua = buildPieceCollisionScript(project, baked(project));
      expect(lua).toContain(`, ${args})`);
    }
  });

  it("names a piece whose name is a Lua keyword through a safe local", () => {
    const project = unit([
      piece({ id: "end", name: "end", collision: { hit: false } }),
    ]);
    const lua = buildPieceCollisionScript(project, baked(project));
    expect(lua).toContain('local p_end = piece("end")');
    expect(lua).toContain("unitID, p_end, false");
  });

  it("compiles, with every piece name a Lua keyword could break", () => {
    const project = unit([
      piece({ id: "end", name: "end", collision: { hit: false } }),
      piece({
        id: "repeat",
        name: "repeat",
        collision: {
          hit: true,
          volume: { type: "cyly", scales: [8, 20, 8], offsets: [0, 10, 0] },
        },
      }),
    ]);
    const lua = buildPieceCollisionScript(project, baked(project));

    const result = spawnSync(
      "luajit",
      [
        "-e",
        "local src = io.read('*a'); local f, err = loadstring(src); " +
          "if not f then io.stderr:write(err); os.exit(1) end os.exit(0)",
      ],
      { input: lua },
    );
    expect(result.stderr?.toString() ?? "").toBe("");
    expect(result.status).toBe(0);
  });

  it("says in the file itself that coilbox owns it", () => {
    const project = unit([piece({ id: "dish", collision: { hit: false } })]);
    const lua = buildPieceCollisionScript(project, baked(project));
    expect(lua).toContain("Rewritten on every export");
    expect(lua.endsWith("\n")).toBe(true);
  });

  /**
   * "The unit script" has no referent inside a generated file, and the file it
   * means is the one most people call the animation script. So the header names
   * the path, which somebody reading this can go and open.
   */
  it("names the file that includes it rather than calling it the unit script", () => {
    const project = unit([piece({ id: "dish", collision: { hit: false } })]);
    const lua = buildPieceCollisionScript(project, baked(project));
    expect(lua).toContain("scripts/radar.lua");
    expect(lua).toContain("animation");
    expect(lua).not.toContain("Pulled in by the unit script");
  });
});
