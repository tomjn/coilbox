import { describe, expect, it } from "vitest";

import type { LegoPiece } from "./model";
import {
  parseRawGeometry,
  pieceMesh,
  type RawMesh,
  rawGeometryProblems,
} from "./rawGeometry";

/**
 * Build a blob the way `crates/tauri-plugin-coilbox-lego/src/import.rs` writes
 * one, so the two ends of the format are checked against a written-down layout
 * rather than against each other.
 */
function blob(
  meshes: RawMesh[],
  vertices: number[],
  indices: number[],
  options: { version?: number; magic?: string } = {},
): Uint8Array {
  const directory = new TextEncoder().encode(JSON.stringify(meshes));
  const header = 40;
  const vertexBytes = vertices.length * 4;
  const indexBytes = indices.length * 4;
  const out = new Uint8Array(
    header + vertexBytes + indexBytes + directory.length,
  );
  const view = new DataView(out.buffer);

  const magic = options.magic ?? "CBLEGO\0\0";
  for (let i = 0; i < 8; i++) out[i] = magic.charCodeAt(i);
  view.setUint32(8, options.version ?? 2, true);
  view.setUint32(12, meshes.length, true);
  view.setUint32(16, header, true);
  view.setUint32(20, vertexBytes, true);
  view.setUint32(24, header + vertexBytes, true);
  view.setUint32(28, indexBytes, true);
  view.setUint32(32, header + vertexBytes + indexBytes, true);
  view.setUint32(36, directory.length, true);

  vertices.forEach((v, i) => {
    view.setFloat32(header + i * 4, v, true);
  });
  indices.forEach((v, i) => {
    view.setUint32(header + vertexBytes + i * 4, v, true);
  });
  out.set(directory, header + vertexBytes + indexBytes);
  return out;
}

const MESH: RawMesh = {
  id: "m1",
  vFirst: 0,
  vCount: 2,
  iFirst: 0,
  iCount: 3,
  bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
};

/** Two vertices of the 8-float record, so the stride is exercised. */
const VERTICES = [1, 2, 3, 0, 1, 0, 0.25, 0.5, 4, 5, 6, 0, 1, 0, 0.75, 0.5];

function piece(overrides: Partial<LegoPiece>): LegoPiece {
  return {
    id: "p1",
    name: "hull",
    parentId: null,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  };
}

describe("parseRawGeometry", () => {
  it("reads the blocks and the directory the importer wrote", () => {
    const raw = parseRawGeometry(blob([MESH], VERTICES, [0, 1, 0]));

    expect([...raw.byId.keys()]).toEqual(["m1"]);
    expect(raw.byId.get("m1")?.bbox.max).toEqual([1, 1, 1]);
    expect(raw.vertices.length).toBe(16);
    expect(raw.vertices[0]).toBe(1);
    expect(raw.vertices[8]).toBe(4);
    expect([...raw.indices]).toEqual([0, 1, 0]);
  });

  it("indexes on 32 bits, because a piece can hold more than a uint16 addresses", () => {
    const raw = parseRawGeometry(blob([MESH], VERTICES, [70000, 1, 2]));

    expect(raw.indices[0]).toBe(70000);
  });

  it("refuses anything that is not this format, saying why", () => {
    expect(() => parseRawGeometry(new Uint8Array(4))).toThrow(/too short/);
    expect(() =>
      parseRawGeometry(
        blob([MESH], VERTICES, [0, 1, 0], { magic: "NOTALEGO" }),
      ),
    ).toThrow(/magic/);
    // Version 1 is the parts pack, which is a different shape entirely.
    expect(() =>
      parseRawGeometry(blob([MESH], VERTICES, [0, 1, 0], { version: 1 })),
    ).toThrow(/version 1/);
  });

  it("refuses a file whose directory runs off the end", () => {
    const truncated = blob([MESH], VERTICES, [0, 1, 0]).slice(0, 60);
    expect(() => parseRawGeometry(truncated)).toThrow(/truncated/);
  });
});

describe("pieceMesh", () => {
  const raw = parseRawGeometry(blob([MESH], VERTICES, [0, 1, 0]));

  it("finds the mesh a piece names", () => {
    expect(pieceMesh(raw, piece({ meshId: "m1" }))?.vCount).toBe(2);
  });

  it("is nothing for a piece with no mesh, a unit with no geometry, or a key that is not there", () => {
    expect(pieceMesh(raw, piece({}))).toBeNull();
    expect(pieceMesh(null, piece({ meshId: "m1" }))).toBeNull();
    expect(pieceMesh(raw, piece({ meshId: "m9" }))).toBeNull();
  });
});

describe("rawGeometryProblems", () => {
  const raw = parseRawGeometry(blob([MESH], VERTICES, [0, 1, 0]));

  it("says nothing when every mesh a piece names is there", () => {
    expect(
      rawGeometryProblems([piece({ meshId: "m1" }), piece({})], raw),
    ).toEqual([]);
  });

  it("counts pieces naming geometry this unit does not have", () => {
    const problems = rawGeometryProblems(
      [piece({ meshId: "m9" }), piece({ id: "p2", meshId: "m8" })],
      raw,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("2 pieces");
  });
});
