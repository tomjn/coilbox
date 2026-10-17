import { describe, expect, it } from "vitest";
import {
  addBuildArm,
  buildArmModule,
  builderKind,
  buildsLine,
  pickArmParts,
} from "./buildArm";
import { type LegoProject, newProject } from "./model";
import type { LegoPartInfo } from "./pack";

function part(
  id: string,
  shape: string,
  size: [number, number, number],
): LegoPartInfo {
  return {
    id,
    shape,
    name: id,
    packId: "lego",
    shapeId: id,
    category: "grey",
    colourway: "grey",
    material: "",
    tags: [],
    vFirst: 0,
    vCount: 0,
    iFirst: 0,
    iCount: 0,
    bbox: {
      min: [-size[0] / 2, -size[1] / 2, -size[2] / 2],
      max: [size[0] / 2, size[1] / 2, size[2] / 2],
    },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 1,
  };
}

const PARTS = [
  part("big-block", "block", [2, 2, 2]),
  part("small-block", "block", [0.5, 0.5, 0.5]),
  part("long-beam", "beam", [0.5, 6, 0.5]),
  part("mid-beam", "beam", [0.5, 2, 0.5]),
  part("short-beam", "beam", [0.5, 1, 0.5]),
  part("a-plate", "plate", [2, 0.2, 2]),
];

function unit(roles: string[], over: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Rover",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      base.pieces[0],
      ...roles.map((role, i) => ({
        ...base.pieces[0],
        id: `p${i}`,
        name: `piece${i}`,
        parentId: "root",
        role,
      })),
    ],
    ...over,
  };
}

describe("builderKind", () => {
  it("says nothing for a unit with no build role", () => {
    expect(builderKind(unit(["turret"]))).toBeNull();
  });

  it("calls a builder with no movement class a static builder and says why", () => {
    expect(builderKind(unit(["buildarm.arm"]))).toEqual({
      kind: "static",
      reason: "it has no movement class",
    });
  });

  it("blames a missing speed when the class is picked but the speed is not", () => {
    const kind = builderKind(
      unit(["buildarm.arm"], { movement: { moveClass: "KBOT2" } }),
    );
    expect(kind).toEqual({ kind: "static", reason: "it has no speed" });
  });

  it("calls a builder with a class and a speed a mobile builder", () => {
    const kind = builderKind(
      unit(["buildarm.arm"], { movement: { moveClass: "KBOT2", speed: 40 } }),
    );
    expect(kind).toEqual({
      kind: "mobile",
      reason: "it moves on KBOT2 at 40",
    });
  });

  it("calls a static builder with a yardmap in the game a factory", () => {
    const kind = builderKind(unit(["buildarm.arm"]), { yardMap: "oooo" });
    expect(kind).toEqual({
      kind: "factory",
      reason: "it cannot move and has a yardmap",
    });
  });

  it("matches the yardmap key whatever its case", () => {
    expect(builderKind(unit(["buildarm.arm"]), { yardmap: "yy" })?.kind).toBe(
      "factory",
    );
  });

  it("does not count an empty yardmap, as the engine does not", () => {
    expect(builderKind(unit(["buildarm.arm"]), { yardmap: "" })?.kind).toBe(
      "static",
    );
  });

  it("keeps a mobile builder mobile whatever its yardmap says", () => {
    const kind = builderKind(
      unit(["buildarm.arm"], { movement: { moveClass: "KBOT2", speed: 40 } }),
      { yardmap: "oooo" },
    );
    expect(kind?.kind).toBe("mobile");
  });
});

describe("buildsLine", () => {
  it("says it builds nothing when the list is empty", () => {
    expect(buildsLine([])).toBe("Builds nothing yet.");
  });

  it("counts a short list and names its units", () => {
    expect(buildsLine(["a", "b"])).toBe("Builds 2 units: a, b.");
    expect(buildsLine(["a"])).toBe("Builds 1 unit: a.");
  });

  it("cuts a long list after four and counts the rest", () => {
    expect(buildsLine(["a", "b", "c", "d", "e", "f"])).toBe(
      "Builds 6 units: a, b, c, d and 2 more.",
    );
  });
});

describe("pickArmParts", () => {
  it("takes the smallest block, the beam nearest two long and the shortest beam", () => {
    expect(pickArmParts(PARTS)).toEqual({
      base: PARTS[1],
      arm: PARTS[3],
      nozzle: PARTS[4],
    });
  });

  it("gives up when the pack has no block or no beam", () => {
    expect(pickArmParts(PARTS.filter((p) => p.shape !== "beam"))).toBeNull();
    expect(pickArmParts(PARTS.filter((p) => p.shape !== "block"))).toBeNull();
  });
});

describe("buildArmModule", () => {
  const parts = pickArmParts(PARTS);
  if (!parts) throw new Error("fixture has no arm parts");
  let n = 0;
  const newId = () => `id${++n}`;

  it("is a base, an arm, a nozzle and a nano point, one under the next, each in its role", () => {
    const module = buildArmModule(parts, newId, "2026-10-17T00:00:00Z");
    const byRole = Object.fromEntries(
      module.pieces.map((piece) => [piece.role, piece]),
    );
    expect(Object.keys(byRole).sort()).toEqual([
      "buildarm.arm",
      "buildarm.base",
      "buildarm.nano",
      "buildarm.nozzle",
    ]);
    expect(module.rootPieceId).toBe(byRole["buildarm.base"].id);
    expect(byRole["buildarm.base"].parentId).toBeNull();
    expect(byRole["buildarm.arm"].parentId).toBe(byRole["buildarm.base"].id);
    expect(byRole["buildarm.nozzle"].parentId).toBe(byRole["buildarm.arm"].id);
    expect(byRole["buildarm.nano"].parentId).toBe(byRole["buildarm.nozzle"].id);
  });

  it("gives the nano point no geometry and stacks the geometry end to end", () => {
    const module = buildArmModule(parts, newId, "2026-10-17T00:00:00Z");
    const at = (role: string) =>
      module.pieces.find((piece) => piece.role === role);
    expect(at("buildarm.nano")?.partId).toBeNull();
    expect(at("buildarm.base")?.partId).toBe("small-block");
    // Half the base (0.5) plus half the arm (2) is 1.25.
    expect(at("buildarm.arm")?.position[1]).toBeCloseTo(1.25);
    // Half the arm (2) plus half the nozzle (1) is 1.5.
    expect(at("buildarm.nozzle")?.position[1]).toBeCloseTo(1.5);
    // The spray leaves the nozzle's far end: half of 1.
    expect(at("buildarm.nano")?.position[1]).toBeCloseTo(0.5);
  });
});

describe("addBuildArm", () => {
  const parts = pickArmParts(PARTS);
  if (!parts) throw new Error("fixture has no arm parts");
  let n = 0;
  const newId = () => `id${++n}`;
  const now = "2026-10-17T00:00:00Z";

  it("hangs the arm off the parent, which makes the unit a builder", () => {
    const before = unit([]);
    const { project, rootPieceIds } = addBuildArm(before, parts, {
      parentId: "root",
      factory: false,
      newId,
      now,
    });
    expect(project.pieces).toHaveLength(before.pieces.length + 4);
    expect(rootPieceIds).toHaveLength(1);
    expect(
      project.pieces.find((piece) => piece.id === rootPieceIds[0])?.parentId,
    ).toBe("root");
    expect(builderKind(project)?.kind).toBe("static");
  });

  it("applies the aim and nano presets to an arm builder", () => {
    const { project } = addBuildArm(unit([]), parts, {
      parentId: "root",
      factory: false,
      newId,
      now,
    });
    expect(project.animations?.map((a) => a.presetId)).toEqual([
      "build.aim",
      "build.nano",
    ]);
  });

  it("applies only the nano preset to a factory, which is handed nothing to aim at", () => {
    const { project } = addBuildArm(unit([]), parts, {
      parentId: "root",
      factory: true,
      newId,
      now,
    });
    expect(project.animations?.map((a) => a.presetId)).toEqual(["build.nano"]);
  });

  it("keeps a preset the unit already has, with its settings", () => {
    const before = unit([], {
      animations: [{ presetId: "build.aim", params: { turnSpeed: 90 } }],
    });
    const { project } = addBuildArm(before, parts, {
      parentId: "root",
      factory: false,
      newId,
      now,
    });
    expect(project.animations).toEqual([
      { presetId: "build.aim", params: { turnSpeed: 90 } },
      { presetId: "build.nano", params: {} },
    ]);
  });
});
