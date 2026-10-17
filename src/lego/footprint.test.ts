import { describe, expect, it } from "vitest";

import {
  checkFootprint,
  footprintLines,
  footprintProblems,
  OUTLYING_ROLES,
} from "./footprint";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LoadedPack } from "./pack";
import { footprintSteps } from "./unitDef";

/** A pack with one part: a unit cube from the origin to (1, 1, 1). */
function pack(): LoadedPack {
  const points = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
    [0, 1, 0],
    [1, 1, 0],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const vertices: number[] = [];
  for (const p of points) vertices.push(...p, 0, 1, 0, 0, 0);
  const part = {
    id: "cube",
    packId: "lego",
    shapeId: "cube",
    name: "cube",
    category: "grey",
    colourway: "grey",
    shape: "cube",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 8,
    iFirst: 0,
    iCount: 6,
    bbox: { min: [0, 0, 0], max: [1, 1, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  } as unknown as LoadedPack["parts"][number];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [part],
    byId: new Map([["cube", part]]),
    vertices: new Float32Array(vertices),
    indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
  };
}

type Box = {
  id: string;
  size: [number, number, number];
  at: [number, number, number];
  role?: string;
  parentId?: string;
};

/** Cubes of the given size whose near corner is at `at`, so x and z are the
 *  box's own extent. A child's position is from its parent's. */
function project(boxes: Box[], extra: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
  return {
    ...base,
    ...extra,
    pieces: [
      ...base.pieces,
      ...boxes.map(
        (box): LegoPiece => ({
          id: box.id,
          name: box.id,
          parentId: box.parentId ?? "root",
          partId: "cube",
          position: box.at,
          rotation: [0, 0, 0],
          scale: box.size,
          ...(box.role ? { role: box.role } : {}),
        }),
      ),
    ],
  };
}

/** 32 by 32 elmos on the ground, centred on the origin: a 2 by 2 footprint. */
const BODY: Box = { id: "body", size: [32, 10, 32], at: [-16, 0, -16] };
/** A barrel out of the front: z from 0 to 40, so the box runs -16 to 40. */
const BARREL: Box = {
  id: "barrel",
  size: [4, 4, 40],
  at: [-2, 3, 0],
  role: "barrel",
};

describe("checkFootprint", () => {
  it("gives a centred body the footprint the export writes", () => {
    const result = checkFootprint(project([BODY]), pack(), null, true);
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.now).toEqual({ x: 2, z: 2 });
    expect(result.base).toEqual({ x: 2, z: 2 });
    expect(result.outlying).toEqual([]);
    expect(result.overhang).toEqual({ x: 0, z: 0 });
    expect(result.written).toBeNull();
  });

  it("matches footprintSteps on the whole box", () => {
    const result = checkFootprint(project([BODY, BARREL]), pack(), null, true);
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.now).toEqual({
      x: footprintSteps(32),
      z: footprintSteps(56),
    });
  });

  it("leaves out a barrel for the base footprint and names it", () => {
    const result = checkFootprint(project([BODY, BARREL]), pack(), null, true);
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.now).toEqual({ x: 2, z: 4 });
    expect(result.base).toEqual({ x: 2, z: 2 });
    expect(result.outlying).toEqual(["barrel"]);
  });

  it("leaves nothing out when the switch is off", () => {
    const result = checkFootprint(project([BODY, BARREL]), pack(), null, false);
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.base).toEqual({ x: 2, z: 4 });
    expect(result.outlying).toEqual([]);
  });

  it("leaves out what hangs under an excluded piece too", () => {
    const flare: Box = {
      id: "flare",
      size: [2, 2, 2],
      at: [0, 0, 40],
      role: "flare",
      parentId: "barrel",
    };
    const tip: Box = {
      id: "tip",
      size: [2, 2, 30],
      at: [0, 0, 40],
      parentId: "flare",
    };
    const result = checkFootprint(
      project([BODY, BARREL, flare, tip]),
      pack(),
      null,
      true,
    );
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.base).toEqual({ x: 2, z: 2 });
    expect(result.outlying).toEqual(["barrel", "flare"]);
  });

  it("leaves out every role in OUTLYING_ROLES", () => {
    expect([...OUTLYING_ROLES]).toEqual([
      "barrel",
      "flare",
      "aim",
      "buildarm.nozzle",
      "buildarm.nano",
    ]);
  });

  it("measures how far the box passes a footprint centred on the origin", () => {
    // The box runs z -16 to 40 and the 4 step footprint covers -32 to 32.
    const result = checkFootprint(project([BODY, BARREL]), pack(), null, true);
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.overhang.x).toBe(0);
    expect(result.overhang.z).toBeCloseTo(8, 9);
    expect(footprintProblems(result)).toHaveLength(1);
    expect(footprintProblems(result)[0]).toContain("8 elmos");
    expect(footprintProblems(result)[0]).toContain("z");
  });

  it("reports no problem for a unit inside its footprint", () => {
    const result = checkFootprint(project([BODY]), pack(), null, true);
    expect(footprintProblems(result)).toEqual([]);
  });

  it("compares with the footprint the last export wrote", () => {
    const exported = {
      dir: "/g",
      at: "2026-07-28T00:00:00Z",
      unitName: "probe",
      def: { footprintx: 2, footprintz: 3 },
    } as unknown as LegoProject["exported"];
    const result = checkFootprint(
      project([BODY, BARREL], { exported }),
      pack(),
      null,
      true,
    );
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.written).toEqual({ x: 2, z: 3, source: "export" });
    expect(result.differs).toBe(true);
    // Judged against the written 3 step footprint, which covers -24 to 24.
    expect(result.overhang.z).toBeCloseTo(16, 9);
    const lines = footprintLines(result).join(" ");
    expect(lines).toContain("2x3");
    expect(lines).toContain("2x4");
    expect(lines).toContain("not updated");
  });

  it("does not say it differs when the export matches", () => {
    const exported = {
      dir: "/g",
      at: "x",
      unitName: "probe",
      def: { footprintx: 2, footprintz: 2 },
    } as unknown as LegoProject["exported"];
    const result = checkFootprint(
      project([BODY], { exported }),
      pack(),
      null,
      true,
    );
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.differs).toBe(false);
    expect(footprintLines(result).join(" ")).not.toContain("not updated");
  });

  it("reads a game unit's own footprint when it was never exported", () => {
    const result = checkFootprint(
      project([BODY], { gameUnitDef: { footprintX: 3, footprintZ: 3 } }),
      pack(),
      null,
      true,
    );
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.written).toEqual({ x: 3, z: 3, source: "game" });
  });

  it("notes a step wasted on an outlying piece, and only as a note", () => {
    const result = checkFootprint(project([BODY, BARREL]), pack(), null, true);
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.wasted).toEqual({ x: 0, z: 2 });
    expect(footprintLines(result).join(" ")).toContain("2 steps");
    expect(footprintProblems(result).join(" ")).not.toContain("steps bigger");
  });

  it("notes no waste when nothing is left out", () => {
    const result = checkFootprint(project([BODY, BARREL]), pack(), null, false);
    if (result.status !== "ok") throw new Error("expected a result");

    expect(result.wasted).toEqual({ x: 0, z: 0 });
  });

  it("does not apply to a unit with no geometry", () => {
    expect(checkFootprint(project([]), pack(), null, true).status).toBe(
      "notApplicable",
    );
  });
});
