import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { meshVolume, SAME_POSITION } from "./balance";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { checkOverlap, overlapProblems, overlapSummary } from "./overlap";
import type { LegoPackManifest, LoadedPack } from "./pack";
import { mergePacks } from "./pack";
import { problemTexts } from "./problems";

/** A pack of a closed unit cube and the same cube without its top. */
function pack(): LoadedPack {
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
    [0, 1, 0],
    [1, 1, 0],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const solid = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2,
    3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ];
  const vertices: number[] = [];
  const indices: number[] = [];
  const parts: LoadedPack["parts"] = [];
  const add = (id: string, tri: number[]) => {
    const vFirst = vertices.length / 8;
    for (const p of corners) vertices.push(...p, 0, 1, 0, 0, 0);
    const iFirst = indices.length;
    indices.push(...tri);
    parts.push({
      id,
      packId: "lego",
      shapeId: id,
      name: id,
      category: "grey",
      colourway: "grey",
      shape: id,
      material: "metal",
      tags: [],
      vFirst,
      vCount: 8,
      iFirst,
      iCount: tri.length,
      bbox: { min: [0, 0, 0], max: [1, 1, 1] },
      uvBox: { min: [0, 0], max: [1, 1] },
      pivot: [0, 0, 0],
      sourceNames: [],
      aliasCount: 0,
    } as unknown as LoadedPack["parts"][number]);
  };
  add("cube", solid);
  add("open", [...solid.slice(0, 6), ...solid.slice(12)]);
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

function project(pieces: (Partial<LegoPiece> & { id: string })[]): LegoProject {
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
    pieces: [
      ...base.pieces,
      ...pieces.map((piece) => ({
        name: piece.id,
        parentId: "root",
        partId: "cube",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

const big: Partial<LegoPiece> & { id: string } = {
  id: "big",
  position: [0, 0, 0],
  scale: [10, 10, 10],
};

function ids(doc: LegoProject, p = pack()): [string, string][] {
  return checkOverlap(doc, p, null).buried.map((b) => [b.id, b.holderId]);
}

describe("checkOverlap", () => {
  it("reports a block wholly inside another, naming the holder and its triangles", () => {
    const doc = project([
      big,
      { id: "small", position: [4, 4, 4], scale: [2, 2, 2] },
    ]);
    const result = checkOverlap(doc, pack(), null);

    expect(result.buried).toHaveLength(1);
    expect(result.buried[0]).toMatchObject({
      id: "small",
      holderId: "big",
      triangles: 12,
    });
    expect(result.wastedTriangles).toBe(12);
  });

  it("reports one of two identical stacked blocks, the later one", () => {
    const doc = project([big, { ...big, id: "twin" }]);

    expect(ids(doc)).toEqual([["twin", "big"]]);
  });

  it("does not report blocks that share a face", () => {
    const doc = project([big, { id: "next", position: [10, 0, 0] }]);

    expect(ids(doc)).toEqual([]);
  });

  it("reports a block with one face flush to its holder's face", () => {
    const doc = project([
      big,
      { id: "flush", position: [2, 9, 2], scale: [3, 1, 3] },
    ]);

    expect(ids(doc)).toEqual([["flush", "big"]]);
  });

  it("does not report a flat piece lying on a face", () => {
    const doc = project([
      big,
      { id: "flat", position: [2, 10, 2], scale: [3, 0, 3] },
    ]);

    expect(ids(doc)).toEqual([]);
  });

  it("does not report a sliver of overlap", () => {
    const doc = project([big, { id: "sliver", position: [9.99, 0, 0] }]);

    expect(ids(doc)).toEqual([]);
  });

  it("does not report a part half inside another", () => {
    const doc = project([
      big,
      { id: "leg", position: [4, 8, 4], scale: [2, 4, 2] },
    ]);

    expect(ids(doc)).toEqual([]);
  });

  it("takes a vertex within SAME_POSITION of the surface as on it, and no further", () => {
    const within = project([
      big,
      {
        id: "a",
        position: [2, 2, 2],
        scale: [8 + SAME_POSITION / 2, 3, 3],
      },
    ]);
    const past = project([
      big,
      { id: "b", position: [2, 2, 2], scale: [8 + SAME_POSITION * 4, 3, 3] },
    ]);

    expect(ids(within)).toEqual([["a", "big"]]);
    expect(ids(past)).toEqual([]);
  });

  it("tests against the mesh and not its bounding box", () => {
    // A cube turned 45 degrees about y: its corner room is empty.
    const turned: Partial<LegoPiece> & { id: string } = {
      id: "turned",
      position: [5, 0, 0],
      rotation: [0, Math.PI / 4, 0] as [number, number, number],
      scale: [10, 10, 10] as [number, number, number],
    };
    const inside: Partial<LegoPiece> & { id: string } = {
      id: "in",
      position: [11.5, 4, -0.5],
      scale: [0.5, 1, 1],
    };
    const corner: Partial<LegoPiece> & { id: string } = {
      id: "corner",
      position: [6, 4, 6],
      scale: [0.5, 1, 0.5],
    };
    // The corner block sits inside the turned cube's box and outside its mesh.
    const doc = project([turned, inside, corner]);

    expect(ids(doc)).toEqual([["in", "turned"]]);
  });

  it("does not let a mesh with an open edge hold anything", () => {
    const doc = project([
      { ...big, partId: "open" },
      { id: "small", position: [4, 4, 4], scale: [2, 2, 2] },
    ]);

    expect(ids(doc)).toEqual([]);
  });

  it("skips empty pieces", () => {
    const doc = project([
      { id: "empty", partId: undefined, position: [1, 1, 1] },
      big,
      { id: "small", position: [4, 4, 4], scale: [2, 2, 2] },
    ]);

    expect(ids(doc)).toEqual([["small", "big"]]);
  });

  it("follows a parent's move and turn", () => {
    const doc = project([
      { id: "arm", partId: undefined, position: [20, 0, 0] },
      { ...big, id: "hold", parentId: "arm" },
      { id: "in", parentId: "arm", position: [4, 4, 4], scale: [2, 2, 2] },
    ]);

    expect(ids(doc)).toEqual([["in", "hold"]]);
  });

  it("adds up the triangles of every buried piece", () => {
    const doc = project([
      big,
      { id: "a", position: [1, 1, 1], scale: [2, 2, 2] },
      { id: "b", position: [5, 5, 5], scale: [2, 2, 2] },
    ]);
    const result = checkOverlap(doc, pack(), null);

    expect(result.buried.map((b) => b.id)).toEqual(["a", "b"]);
    expect(result.wastedTriangles).toBe(24);
  });
});

describe("overlapProblems and overlapSummary", () => {
  it("names the piece, its holder and the triangles", () => {
    const doc = project([
      big,
      { id: "small", position: [4, 4, 4], scale: [2, 2, 2] },
    ]);
    const result = checkOverlap(doc, pack(), null);

    expect(problemTexts(overlapProblems(doc, result))).toEqual([
      "small is buried inside big and wastes 12 triangles.",
    ]);
    expect(overlapSummary(result)).toBe("1 buried piece wastes 12 triangles.");
  });

  it("is about the buried piece and the one holding it", () => {
    const doc = project([
      big,
      { id: "small", position: [4, 4, 4], scale: [2, 2, 2] },
    ]);
    const [line] = overlapProblems(doc, checkOverlap(doc, pack(), null));
    expect(line.source).toBe("overlap");
    expect(line.pieceIds).toEqual(["small", "big"]);
  });

  it("says nothing for a unit with nothing buried", () => {
    const doc = project([big]);
    const result = checkOverlap(doc, pack(), null);

    expect(overlapProblems(doc, result)).toEqual([]);
    expect(overlapSummary(result)).toBe("No buried pieces.");
  });

  it("shortens a long list and keeps the total", () => {
    const doc = project([
      big,
      ...[1, 2, 3, 4, 5].map((n) => ({
        id: `s${n}`,
        position: [n, 1, 1] as [number, number, number],
        scale: [0.5, 0.5, 0.5] as [number, number, number],
      })),
    ]);
    const lines = overlapProblems(doc, checkOverlap(doc, pack(), null));

    expect(lines).toHaveLength(4);
    expect(lines[3].message).toBe(
      "And 2 more. Buried pieces waste 60 triangles in all.",
    );
  });
});

describe("the bundled parts", () => {
  const dir = fileURLToPath(
    new URL("../../src-tauri/legoparts/", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${dir}pack.json`, "utf8"),
  ) as LegoPackManifest;
  const blob = new Uint8Array(gunzipSync(readFileSync(`${dir}parts.bin.gz`)));
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const vertexOffset = view.getUint32(16, true);
  const vertexBytes = view.getUint32(20, true);
  const indexOffset = view.getUint32(24, true);
  const indexBytes = view.getUint32(28, true);
  const vertices = new Float32Array(
    blob.slice(vertexOffset, vertexOffset + vertexBytes).buffer,
  );
  const indices = new Uint16Array(
    blob.slice(indexOffset, indexOffset + indexBytes).buffer,
  );
  const merged = mergePacks([{ manifest, vertices, indices }]);
  const real: LoadedPack = {
    ...merged,
    vertices,
    indices,
    library: { packs: [manifest], atlases: [], dir: "", problems: [] },
  };

  it("reports the second of two identical stacked parts, turned and scaled", () => {
    const missed: string[] = [];
    for (const part of real.parts) {
      const at = {
        partId: part.id,
        position: [3, 5, 7] as [number, number, number],
        rotation: [0.3, 0.6458, -0.2] as [number, number, number],
        scale: [1.37, 1.37, 1.37] as [number, number, number],
      };
      const doc = project([
        { id: "a", ...at },
        { id: "b", ...at },
      ]);
      const buried = checkOverlap(doc, real, null).buried;
      // An open part cannot hold, and a part with no volume cannot be inside.
      if (buried.length === 1) {
        expect(buried[0].id).toBe("b");
      } else {
        const points: [number, number, number][] = [];
        for (let i = 0; i < part.vCount; i++) {
          const at = (part.vFirst + i) * 8;
          points.push([vertices[at], vertices[at + 1], vertices[at + 2]]);
        }
        const m = meshVolume(points, [
          ...indices.slice(part.iFirst, part.iFirst + part.iCount),
        ]);
        missed.push(m.closed && m.volume > 0 ? `${part.id} (closed)` : part.id);
      }
    }
    // Most parts are closed solids, so most are found. Print the rest.
    console.info(
      `not reported as a stack: ${missed.length} of ${real.parts.length}, ${missed.filter((m) => m.endsWith("(closed)")).length} of them closed: ${missed.filter((m) => m.endsWith("(closed)")).join(", ")}`,
    );
    expect(missed.length).toBeLessThan(real.parts.length / 2);
  });

  it("measures the time on a large unit", () => {
    const closed = real.parts.filter((p) => p.iCount > 0);
    const pieces: (Partial<LegoPiece> & { id: string })[] = [];
    // 100 holders in a grid, each with 9 smaller parts in the middle of it.
    for (let h = 0; h < 100; h++) {
      const origin: [number, number, number] = [
        (h % 10) * 10,
        Math.floor(h / 100) * 10,
        Math.floor(h / 10) * 10,
      ];
      pieces.push({
        id: `h${h}`,
        partId: closed[h % closed.length].id,
        position: origin,
        scale: [8, 8, 8],
      });
      for (let s = 0; s < 9; s++) {
        pieces.push({
          id: `h${h}s${s}`,
          partId: closed[(h * 9 + s) % closed.length].id,
          position: [
            origin[0] + 2 + (s % 3) * 1.5,
            origin[1] + 2 + Math.floor(s / 3) * 1.5,
            origin[2] + 3,
          ],
          scale: [1, 1, 1],
        });
      }
    }
    const count = pieces.length;
    const doc = project(pieces);
    const start = performance.now();
    const result = checkOverlap(doc, real, null);
    const ms = performance.now() - start;
    console.info(
      `overlap check: ${count} pieces, ${result.buried.length} buried, ${ms.toFixed(0)} ms`,
    );
    expect(result.checked).toBe(count);
  });
});
