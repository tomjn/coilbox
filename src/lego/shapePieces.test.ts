/**
 * A generated shape (#3325) is a piece like any other: the bake, the checks
 * that read geometry, the connectors and every way a piece is copied see it.
 */

import type * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseClipboardPiece, serializeClipboardPiece } from "./clipboard";
import { duplicatePiece, insertCompound } from "./compounds";
import { boxConnectors, pieceConnectors, pieceOwnBox } from "./connectors";
import { buildGlbScene } from "./exportGlb";
import { buildObj } from "./exportObj";
import {
  bundledRoundPanels,
  bundledSwatches,
} from "./fixtures/bundledSwatches";
import { mirrorCopy } from "./mirror";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { moduleShareCode, readSharedModule } from "./moduleShare";
import { checkOverlap } from "./overlap";
import type { LoadedPack } from "./pack";
import { pivotChoices } from "./pivot";
import { bakedPieces, buildS3o, pieceBoxes, type S3oPiece } from "./s3oBuild";
import {
  type LegoShape,
  setShapeRoundPanels,
  setShapeSwatches,
  shapeBox,
  shapeMesh,
} from "./shapes";

beforeAll(() => {
  setShapeSwatches(bundledSwatches());
});

/** The grey swatch in the bundled pack's UVs, v up from the bottom. */
const GREY = bundledSwatches()[2].uv;
const SLACK = 1e-6;

function insideGrey([u, v]: [number, number]): boolean {
  return (
    u >= GREY.min[0] - SLACK &&
    u <= GREY.max[0] + SLACK &&
    v >= GREY.min[1] - SLACK &&
    v <= GREY.max[1] + SLACK
  );
}

type Vec3 = [number, number, number];

/** A pack with no parts: every piece below is a shape. */
function pack(): LoadedPack {
  return {
    manifest: {} as LoadedPack["manifest"],
    library: {
      packs: [],
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
      dir: "",
      problems: [],
    },
    parts: [],
    byId: new Map(),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  };
}

function cylinder(size: Vec3): LegoShape {
  return { kind: "cylinder", size, swatch: "grey" };
}

function project(pieces: (Partial<LegoPiece> & { id: string })[]) {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "roller",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece) => ({
        name: piece.id,
        parentId: "root",
        partId: null,
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
        ...piece,
      })),
    ],
  } satisfies LegoProject;
}

function counter() {
  let n = 0;
  return () => `new${n++}`;
}

describe("a shape in the bake", () => {
  it("bakes the shape's mesh, where the piece is", () => {
    const unit = project([
      { id: "wheel", shape: cylinder([2, 1, 2]), position: [5, 0, 0] },
    ]);
    const baked = bakedPieces(unit, pack(), null).pieces.get("wheel");
    expect(baked?.vertices).toHaveLength(
      shapeMesh(cylinder([2, 1, 2]))?.vCount ?? -1,
    );
    const box = pieceBoxes(unit, pack(), null, ["wheel"]).get("wheel");
    expect(box?.min[0]).toBeCloseTo(4, 6);
    expect(box?.max[0]).toBeCloseTo(6, 6);
    expect(box?.min[1]).toBeCloseTo(-0.5, 6);
    expect(box?.max[1]).toBeCloseTo(0.5, 6);
  });

  it("reverses the winding of a mirrored shape", () => {
    const plain = project([{ id: "wheel", shape: cylinder([2, 1, 2]) }]);
    const mirrored = project([
      { id: "wheel", shape: cylinder([2, 1, 2]), scale: [-1, 1, 1] },
    ]);
    const a = bakedPieces(plain, pack(), null).pieces.get("wheel")?.indices;
    const b = bakedPieces(mirrored, pack(), null).pieces.get("wheel")?.indices;
    expect(b?.slice(0, 3)).toEqual([a?.[0], a?.[2], a?.[1]]);
  });

  it("bakes nothing for a kind this build does not know", () => {
    const unit = project([
      {
        id: "odd",
        shape: { kind: "torus", size: [1, 1, 1], swatch: "grey" },
      },
    ]);
    expect(bakedPieces(unit, pack(), null).pieces.get("odd")?.vertices).toEqual(
      [],
    );
  });

  it("is a closed solid the overlap check can bury a piece in", () => {
    const unit = project([
      { id: "drum", shape: cylinder([4, 4, 4]) },
      { id: "core", shape: cylinder([1, 1, 1]) },
    ]);
    const result = checkOverlap(unit, pack(), null);
    expect(result.checked).toBe(2);
    expect(result.buried.map((b) => [b.id, b.holderId])).toEqual([
      ["core", "drum"],
    ]);
  });
});

describe("a shape in the exports (#3327)", () => {
  const unit = project([
    { id: "drum", shape: cylinder([4, 6, 4]) },
    {
      id: "pipe",
      shape: { kind: "tube", size: [2, 9, 2], swatch: "grey" },
      position: [5, 0, 0],
    },
  ]);

  it("writes the s3o's UVs inside the swatch, turned for the engine", () => {
    const built = buildS3o(unit, pack(), null, { texture1: "atlas.png" });
    if (!built) throw new Error("no build");
    const all: S3oPiece[] = [];
    const walk = (piece: S3oPiece) => {
      all.push(piece);
      piece.children.forEach(walk);
    };
    walk(built.root);
    const shaped = all.filter((piece) => piece.vertices.length > 0);
    expect(shaped).toHaveLength(2);
    for (const piece of shaped) {
      for (const { uv } of piece.vertices) {
        expect(insideGrey([uv[0], 1 - uv[1]])).toBe(true);
      }
      expect(Math.max(...piece.indices)).toBeLessThan(piece.vertices.length);
    }
  });

  it("writes the .obj's UVs inside the swatch, v up from the bottom", () => {
    const built = buildObj(unit, pack(), null, {
      unitName: "roller",
      textureName: "atlas.png",
    });
    const uvs = (built?.obj.split("\n") ?? [])
      .filter((line) => line.startsWith("vt "))
      .map((line) => line.split(" ").slice(1).map(Number) as [number, number]);
    expect(uvs.length).toBeGreaterThan(0);
    expect(uvs.every(insideGrey)).toBe(true);
  });

  it("writes the .glb's UVs inside the swatch", () => {
    const scene = buildGlbScene(unit, pack(), null);
    const meshes: THREE.Mesh[] = [];
    scene?.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh);
    });
    expect(meshes).toHaveLength(2);
    for (const mesh of meshes) {
      const uv = mesh.geometry.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) {
        expect(insideGrey([uv.getX(i), uv.getY(i)])).toBe(true);
      }
    }
  });
});

describe("a round panel in the exports (#4398)", () => {
  beforeAll(() => {
    setShapeRoundPanels(bundledRoundPanels());
  });
  afterAll(() => {
    setShapeRoundPanels([]);
  });

  const PANEL = bundledRoundPanels()[2];
  const onPanel = ([u, v]: [number, number]) =>
    Math.hypot(u - PANEL.centre[0], v - PANEL.centre[1]) <=
    PANEL.radius + SLACK;
  const unit = project([
    {
      id: "wheel",
      shape: {
        kind: "cylinder",
        size: [4, 1, 4],
        swatch: "grey",
        options: { hub: 1 },
      },
    },
    {
      id: "ring",
      shape: {
        kind: "tube",
        size: [6, 2, 6],
        swatch: "grey",
        options: { hub: 1, inner: 2 },
      },
      position: [8, 0, 0],
    },
  ]);

  /** Every UV is on the swatch or the panel, and the panel is used. */
  function check(uvs: [number, number][]) {
    expect(uvs.filter((uv) => !insideGrey(uv) && !onPanel(uv))).toEqual([]);
    expect(uvs.some(onPanel)).toBe(true);
  }

  it("writes the s3o's end UVs inside the panel", () => {
    const built = buildS3o(unit, pack(), null, { texture1: "atlas.png" });
    if (!built) throw new Error("no build");
    const uvs: [number, number][] = [];
    const walk = (piece: S3oPiece) => {
      for (const { uv } of piece.vertices) uvs.push([uv[0], 1 - uv[1]]);
      piece.children.forEach(walk);
    };
    walk(built.root);
    check(uvs);
  });

  it("writes the .obj's end UVs inside the panel", () => {
    const built = buildObj(unit, pack(), null, {
      unitName: "roller",
      textureName: "atlas.png",
    });
    check(
      (built?.obj.split("\n") ?? [])
        .filter((line) => line.startsWith("vt "))
        .map(
          (line) => line.split(" ").slice(1).map(Number) as [number, number],
        ),
    );
  });

  it("writes the .glb's end UVs inside the panel", () => {
    const scene = buildGlbScene(unit, pack(), null);
    const uvs: [number, number][] = [];
    scene?.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const uv = mesh.geometry.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uvs.push([uv.getX(i), uv.getY(i)]);
    });
    check(uvs);
  });
});

describe("a shape's box", () => {
  it("gives the shape box connectors from its size", () => {
    const piece = project([{ id: "wheel", shape: cylinder([2, 1, 2]) }])
      .pieces[1];
    const box = shapeBox(cylinder([2, 1, 2]));
    expect(pieceOwnBox(pack(), piece)).toEqual(box);
    expect(pieceConnectors(pack(), piece)).toEqual(
      boxConnectors(box as NonNullable<typeof box>),
    );
  });

  it("offers pivots on the shape's faces", () => {
    const piece = project([{ id: "wheel", shape: cylinder([2, 1, 2]) }])
      .pieces[1];
    const bbox = pieceOwnBox(pack(), piece);
    const top = pivotChoices({ bbox: bbox as NonNullable<typeof bbox> }).find(
      (choice) => choice.id === "top",
    );
    expect(top?.position).toEqual([0, 0.5, 0]);
  });

  it("has no box or connectors for a kind this build does not know", () => {
    const piece = project([
      {
        id: "odd",
        shape: { kind: "torus", size: [1, 1, 1], swatch: "grey" },
      },
    ]).pieces[1];
    expect(pieceOwnBox(pack(), piece)).toBeUndefined();
    expect(pieceConnectors(pack(), piece)).toEqual([]);
  });
});

describe("copies of a shape keep it", () => {
  const shape = cylinder([2, 3, 2]);
  const unit = project([{ id: "barrel", shape }]);
  const shapesIn = (p: LegoProject) =>
    p.pieces.filter((piece) => piece.shape).map((piece) => piece.shape);

  it("survives copy and paste", () => {
    const parsed = parseClipboardPiece(
      serializeClipboardPiece(unit),
      new Set(),
    );
    expect(parsed.ok && shapesIn(parsed.piece.project)).toEqual([shape]);
  });

  it("survives duplicate", () => {
    const out = duplicatePiece(unit, "barrel", {
      now: "2026-10-17T00:00:00Z",
      newId: counter(),
    });
    expect(out && shapesIn(out.project)).toEqual([shape, shape]);
  });

  it("survives a mirrored copy", () => {
    const out = mirrorCopy(unit, "barrel", counter());
    expect(out && shapesIn(out.project)).toEqual([shape, shape]);
  });

  it("survives going in as a module", () => {
    const into = project([]);
    const out = insertCompound(into, unit, "root", counter(), true);
    expect(shapesIn(out.project)).toEqual([shape]);
  });

  it("survives a shared module code", () => {
    const made = moduleShareCode(unit);
    if (!made.ok) throw new Error(made.reason);
    const read = readSharedModule(made.code, new Set());
    expect(read.ok && shapesIn(read.project)).toEqual([shape]);
  });
});
