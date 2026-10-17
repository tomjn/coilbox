/**
 * Align and distribute on a selection that holds joined pieces (issue #3320).
 * The parts here have no vertices, so every piece lines up by its origin.
 */

import { describe, expect, it } from "vitest";

import { arrange } from "./align";
import { connectPiece } from "./connectors";
import { applyGroupTransform } from "./groupTransform";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { worldMatrix } from "./reparent";

type Vec3 = [number, number, number];

function part(id: string, min: Vec3, max: Vec3): LegoPartInfo {
  return {
    id,
    packId: "lego",
    shapeId: id,
    name: id,
    category: "grey",
    colourway: "grey",
    shape: "block",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 0,
    iFirst: 0,
    iCount: 0,
    bbox: { min, max },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
}

function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("leg", [-0.25, -1, -0.5], [0.5, 1, 0.25]),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  };
}

function piece(id: string, extra: Partial<LegoPiece>): LegoPiece {
  return {
    id,
    name: id,
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

/** A hull with a leg joined to its +x face, and a free post off to one side. */
function walker(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const loose: LegoProject = {
    ...base,
    pieces: [
      ...base.pieces,
      piece("hull", { partId: "hull" }),
      piece("leg", { partId: "leg", parentId: "hull" }),
      piece("post", { position: [0, 0, 6] }),
    ],
  };
  return connectPiece(loose, pack(), "leg", { connector: "-x", to: "+x" });
}

function at(project: LegoProject, id: string): number[] {
  const m = worldMatrix(project, id).elements;
  return [m[12], m[13], m[14]];
}

describe("align on a joined piece", () => {
  it("frees it, names it, and leaves it where it was put", () => {
    const doc = walker();
    const result = arrange(doc, pack(), null, ["leg", "post"], {
      kind: "align",
      axis: "z",
      edge: "high",
    });
    expect(result.detached).toEqual(["leg"]);
    const after = applyGroupTransform(doc, result.changes);
    expect(at(after, "leg")[2]).toBeCloseTo(6);
    expect(at(after, "post")[2]).toBeCloseTo(6);
  });

  it("names nothing when the joined piece does not move", () => {
    const doc = walker();
    const result = arrange(doc, pack(), null, ["leg", "post"], {
      kind: "align",
      axis: "z",
      edge: "low",
    });
    const z = at(doc, "leg")[2];
    const settled = applyGroupTransform(doc, result.changes);
    const again = arrange(settled, pack(), null, ["leg", "post"], {
      kind: "align",
      axis: "z",
      edge: "low",
    });
    expect(again.changes.size).toBe(0);
    expect(again.detached).toEqual([]);
    expect(at(settled, "post")[2]).toBeCloseTo(z);
  });

  it("does not move a piece that a selected parent already carries", () => {
    const doc = walker();
    const result = arrange(doc, pack(), null, ["hull", "leg", "post"], {
      kind: "align",
      axis: "z",
      edge: "high",
    });
    expect(result.changes.has("leg")).toBe(false);
    expect(result.detached).toEqual([]);
  });
});
