import { spawnSync } from "node:child_process";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildLuaScript } from "./luaScript";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  pieceById,
} from "./model";
import { worldMatrix } from "./reparent";
import { shapeMesh } from "./shapes";
import {
  addShapePiece,
  setPieceRole,
  setPieceShape,
  turnWheelAxleToSpin,
  wheelAxleProblems,
} from "./wheelAxle";

function unit(): LegoProject {
  return {
    ...newProject({
      id: "unit",
      rootPieceId: "root",
      name: "Unit",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-17T00:00:00Z",
    }),
    animations: [{ presetId: "wheels.roll", params: {} }],
  };
}

function cylinder(
  id: string,
  axis: number | undefined,
  parentId = "root",
  extra: Partial<LegoPiece> = {},
): LegoPiece {
  const size: [number, number, number] = [10, 10, 10];
  if (axis !== undefined) size[axis] = 4;
  return {
    id,
    name: id,
    parentId,
    partId: null,
    shape: {
      kind: "cylinder",
      size,
      ...(axis === undefined ? {} : { options: { axis } }),
    },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

function withPieces(...pieces: LegoPiece[]): LegoProject {
  const project = unit();
  return { ...project, pieces: [...project.pieces, ...pieces] };
}

/** The cylinder's axle in the unit's frame, from the option and the matrix. */
function axleOf(project: LegoProject, id: string): THREE.Vector3 {
  const piece = pieceById(project, id) as LegoPiece;
  const axis = piece.shape?.options?.axis ?? 1;
  const direction = new THREE.Vector3();
  direction.setComponent(axis, 1);
  const matrix = worldMatrix(project, id);
  return direction.transformDirection(matrix);
}

/**
 * Runs a unit script under luajit with the engine calls stubbed, calls
 * `Create` and then `StartMoving`, and returns the axis index (0 for x) that
 * `Spin` was called with, by piece name. The unit moves at one elmo a frame.
 * A thread the call starts runs to its first `Sleep`.
 */
function spunOnStartMoving(lua: string): Record<string, number> {
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
local moving = false
local spun = {}
function piece(...) return ... end
function Spin(p, axis, speed) if moving then spun[p] = axis - 1 end end
function StopSpin() end
function Turn() end
function Move() end
function Signal() end
function SetSignalMask() end
function Explode() end
function WaitForTurn() end
function WaitForMove() end
-- A thread runs to its first Sleep, which is where the wheels have spun.
function Sleep() error("sleep") end
function StartThread(fn) pcall(fn) end
COB = { CURRENT_SPEED = 29, REVERSING = 109 }
function GetUnitValue(id) if id == COB.CURRENT_SPEED then return 65536 end return 0 end
SFX = { SHATTER = 1 }
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()
if script.Create then script.Create() end
moving = true
script.StartMoving()
for name, axis in pairs(spun) do io.write(name .. "=" .. axis .. "\\n") end
`;
  const result = spawnSync("luajit", ["-e", harness], { input: lua });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  return Object.fromEntries(
    result.stdout
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, axis] = line.split("=");
        return [name, Number(axis)];
      }),
  );
}

/**
 * Whether turning the cylinder's vertices by `angle` about the spin axis
 * through the piece's origin leaves the set of vertices where it was, which is
 * what turning about its own axle does.
 */
function turnsOntoItself(
  project: LegoProject,
  id: string,
  spinAxis: number,
  angle: number,
): boolean {
  const piece = pieceById(project, id) as LegoPiece;
  const mesh = shapeMesh(piece.shape as NonNullable<LegoPiece["shape"]>);
  if (!mesh) return false;
  const matrix = worldMatrix(project, id);
  const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
  const axis = new THREE.Vector3();
  axis.setComponent(spinAxis, 1);
  const key = (v: THREE.Vector3) =>
    [v.x, v.y, v.z].map((n) => Math.round(n * 1000) / 1000 + 0).join(",");
  const before = new Set<string>();
  const after = new Set<string>();
  for (let i = 0; i < mesh.vCount; i++) {
    const v = new THREE.Vector3(
      mesh.vertices[i * 8],
      mesh.vertices[i * 8 + 1],
      mesh.vertices[i * 8 + 2],
    ).applyMatrix4(matrix);
    before.add(key(v));
    after.add(
      key(v.clone().sub(origin).applyAxisAngle(axis, angle).add(origin)),
    );
  }
  return before.size === after.size && [...before].every((k) => after.has(k));
}

const ALONG = (v: THREE.Vector3, axis: number) =>
  Math.abs(Math.abs(v.getComponent(axis)) - 1) < 1e-6;

describe("a cylinder that gets the wheel role", () => {
  it.each([
    { label: "default (y)", axis: undefined },
    { label: "x", axis: 0 },
    { label: "y", axis: 1 },
    { label: "z", axis: 2 },
  ])("turns about its axle when its axis is $label", ({ axis }) => {
    const project = setPieceRole(
      withPieces(cylinder("wheel", axis)),
      "wheel",
      "wheel",
    );
    expect(pieceById(project, "wheel")?.role).toBe("wheel");

    const spun = spunOnStartMoving(buildLuaScript(project));
    expect(spun).toEqual({ wheel: 0 });
    expect(ALONG(axleOf(project, "wheel"), 0)).toBe(true);
    // A twelve sided ring maps onto itself every 30 degrees, so a quarter of a
    // turn about the spin axis only does when that axis is the axle.
    expect(turnsOntoItself(project, "wheel", spun.wheel, Math.PI / 6)).toBe(
      true,
    );
  });

  it("would not turn about its axle without the alignment", () => {
    const project = withPieces(cylinder("wheel", 1, "root", { role: "wheel" }));
    const spun = spunOnStartMoving(buildLuaScript(project));
    expect(spun).toEqual({ wheel: 0 });
    expect(turnsOntoItself(project, "wheel", 0, Math.PI / 6)).toBe(false);
  });

  it("keeps its position and any turn it already had about the axle", () => {
    const project = setPieceRole(
      withPieces(
        cylinder("wheel", 0, "root", {
          position: [3, 4, 5],
          rotation: [0.3, 0, 0],
        }),
      ),
      "wheel",
      "wheel",
    );
    const piece = pieceById(project, "wheel") as LegoPiece;
    expect(piece.position).toEqual([3, 4, 5]);
    expect(piece.rotation[0]).toBeCloseTo(0.3);
    expect(ALONG(axleOf(project, "wheel"), 0)).toBe(true);
  });

  it("is aligned inside a parent that is itself turned", () => {
    const project = setPieceRole(
      withPieces(
        {
          ...cylinder("hub", undefined),
          shape: undefined,
          rotation: [0, Math.PI / 2, 0],
        },
        cylinder("wheel", 1, "hub"),
      ),
      "wheel",
      "wheel",
    );
    expect(ALONG(axleOf(project, "wheel"), 0)).toBe(true);
    expect(turnsOntoItself(project, "wheel", 0, Math.PI / 6)).toBe(true);
  });

  it("moves an origin that is off the axle onto it, leaving the shape in place", () => {
    const before = withPieces(
      cylinder("wheel", 0, "root", {
        pivot: [1, 2, 3],
        position: [1, 2, 3],
      }),
    );
    const after = setPieceRole(before, "wheel", "wheel");
    const piece = pieceById(after, "wheel") as LegoPiece;
    // The pivot keeps its slide along the axle (x) and loses the rest.
    expect(piece.pivot).toEqual([1, 0, 0]);
    // The shape did not move: the origin did.
    const centre = new THREE.Vector3(0, 0, 0)
      .sub(new THREE.Vector3(...(piece.pivot ?? [0, 0, 0])))
      .applyMatrix4(worldMatrix(after, "wheel"));
    const was = new THREE.Vector3(0, 0, 0)
      .sub(new THREE.Vector3(1, 2, 3))
      .applyMatrix4(worldMatrix(before, "wheel"));
    expect(centre.distanceTo(was)).toBeLessThan(1e-6);
    expect(turnsOntoItself(after, "wheel", 0, Math.PI / 6)).toBe(true);
  });

  it("leaves a piece that is not a cylinder alone", () => {
    const part: LegoPiece = {
      ...cylinder("disc", 1),
      shape: undefined,
      partId: "abc",
    };
    const project = withPieces(part);
    const after = setPieceRole(project, "disc", "wheel");
    expect(pieceById(after, "disc")?.rotation).toEqual([0, 0, 0]);
    expect(pieceById(after, "disc")?.role).toBe("wheel");
  });

  it("drops the role when asked for none", () => {
    const project = setPieceRole(
      withPieces(cylinder("wheel", 1)),
      "wheel",
      "wheel",
    );
    const cleared = setPieceRole(project, "wheel", undefined);
    expect(pieceById(cleared, "wheel")?.role).toBeUndefined();
  });

  it("turns a mirrored pair the same way about x", () => {
    const left = cylinder("left", 1);
    const right = cylinder("right", 1, "root", {
      position: [-20, 0, 0],
      scale: [-1, 1, 1],
    });
    let project = withPieces({ ...left, position: [20, 0, 0] }, right);
    project = setPieceRole(project, "left", "wheel");
    project = setPieceRole(project, "right", "wheel");
    expect(spunOnStartMoving(buildLuaScript(project))).toEqual({
      left: 0,
      right: 0,
    });
    expect(turnsOntoItself(project, "right", 0, Math.PI / 6)).toBe(true);
  });
});

describe("a cylinder placed on a wheel bone", () => {
  it("turns about its axle when the bone spins about x", () => {
    const bone: LegoPiece = {
      id: "bone",
      name: "wheel_l1",
      parentId: "root",
      partId: null,
      position: [12, 5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      role: "wheel",
      bone: "wheel.l1",
    };
    const project = turnWheelAxleToSpin(
      withPieces(bone, cylinder("tyre", 2, "bone")),
      "tyre",
    );
    expect(spunOnStartMoving(buildLuaScript(project))).toEqual({
      wheel_l1: 0,
    });
    expect(ALONG(axleOf(project, "tyre"), 0)).toBe(true);
    expect(turnsOntoItself(project, "tyre", 0, Math.PI / 6)).toBe(true);
  });

  it("changes nothing when no piece above it is a wheel", () => {
    const project = withPieces(cylinder("tyre", 2));
    expect(turnWheelAxleToSpin(project, "tyre")).toBe(project);
  });
});

describe("changing the axis of a wheel", () => {
  it("turns it back onto the spin axis", () => {
    const wheel = setPieceRole(
      withPieces(cylinder("wheel", 0)),
      "wheel",
      "wheel",
    );
    const shape = {
      kind: "cylinder",
      size: [10, 4, 10] as [number, number, number],
      options: { axis: 1 },
    };
    const project = setPieceShape(wheel, "wheel", shape);
    expect(ALONG(axleOf(project, "wheel"), 0)).toBe(true);
    const spun = spunOnStartMoving(buildLuaScript(project));
    expect(spun).toEqual({ wheel: 0 });
    expect(turnsOntoItself(project, "wheel", 0, Math.PI / 6)).toBe(true);
  });

  it("re-aligns a tire under a wheel bone", () => {
    const bone: LegoPiece = {
      ...cylinder("bone", undefined),
      shape: undefined,
      name: "bone",
      role: "wheel",
    };
    const placed = turnWheelAxleToSpin(
      withPieces(bone, cylinder("tyre", 0, "bone")),
      "tyre",
    );
    const project = setPieceShape(placed, "tyre", {
      kind: "cylinder",
      size: [10, 10, 4],
      options: { axis: 2 },
    });
    expect(ALONG(axleOf(project, "tyre"), 0)).toBe(true);
  });

  it("leaves a cylinder that is not on a wheel as it is", () => {
    const project = withPieces(cylinder("pipe", 0));
    const next = setPieceShape(project, "pipe", {
      kind: "cylinder",
      size: [10, 4, 10],
      options: { axis: 1 },
    });
    expect(pieceById(next, "pipe")?.rotation).toEqual([0, 0, 0]);
  });
});

describe("a tube", () => {
  it("is turned onto the spin axis like a cylinder", () => {
    const tube = {
      ...cylinder("rim", 1),
      shape: {
        kind: "tube",
        size: [10, 4, 10] as [number, number, number],
        options: { axis: 1, inner: 3 },
      },
    };
    const project = setPieceRole(withPieces(tube), "rim", "wheel");
    expect(ALONG(axleOf(project, "rim"), 0)).toBe(true);
  });
});

describe("a newly added cylinder", () => {
  it("under a wheel bone turns about its axle in the generated script", () => {
    const bone: LegoPiece = {
      ...cylinder("bone", undefined),
      shape: undefined,
      name: "bone",
      role: "wheel",
    };
    const added = addShapePiece(
      withPieces(bone),
      cylinder("cylinder", undefined, "bone"),
    );
    expect(spunOnStartMoving(buildLuaScript(added))).toEqual({ bone: 0 });
    expect(turnsOntoItself(added, "cylinder", 0, Math.PI / 6)).toBe(true);
  });
});

describe("the wheel axle warning", () => {
  it("is empty for a wheel turned onto x", () => {
    const project = setPieceRole(
      withPieces(cylinder("wheel", 1)),
      "wheel",
      "wheel",
    );
    expect(wheelAxleProblems(project)).toEqual([]);
  });

  it("says which axis the axle is along when a wheel is turned by hand", () => {
    const project = withPieces(cylinder("wheel", 1, "root", { role: "wheel" }));
    const found = wheelAxleProblems(project);
    expect(found).toHaveLength(1);
    expect(found[0].message).toBe(
      '"wheel" turns about x but its axle is along y.',
    );
    expect(found[0].severity).toBe("warning");
    expect(found[0].pieceIds).toEqual(["wheel"]);
  });

  it("says slanted for an axle between axes", () => {
    const project = withPieces(
      cylinder("wheel", 1, "root", { role: "wheel", rotation: [0, 0, 0.5] }),
    );
    expect(wheelAxleProblems(project)[0].message).toContain("slanted");
  });

  it("ignores cylinders that are not on a wheel", () => {
    expect(wheelAxleProblems(withPieces(cylinder("pipe", 1)))).toEqual([]);
  });
});

describe("addShapePiece", () => {
  it("adds a cylinder that is not on a wheel as it comes", () => {
    const added = addShapePiece(withPieces(), cylinder("pipe", 1));
    expect(pieceById(added, "pipe")?.rotation).toEqual([0, 0, 0]);
  });

  it("aligns a tube added under a wheel", () => {
    const bone: LegoPiece = {
      ...cylinder("bone", undefined),
      shape: undefined,
      role: "wheel",
    };
    const tube = {
      ...cylinder("rim", 1, "bone"),
      shape: {
        kind: "tube",
        size: [10, 4, 10] as [number, number, number],
        options: { axis: 1, inner: 3 },
      },
    };
    expect(ALONG(axleOf(addShapePiece(withPieces(bone), tube), "rim"), 0)).toBe(
      true,
    );
  });
});
