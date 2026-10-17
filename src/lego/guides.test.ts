/**
 * Guide planes (issue #3318): flat planes the game maker places, that a moved
 * piece's anchors snap to, saved with the unit and never exported.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseClipboardPiece, serializeClipboardPiece } from "./clipboard";
import { selectionAsCompound, subtreeAsCompound } from "./compounds";
import { buildGlbScene } from "./exportGlb";
import { buildObj } from "./exportObj";
import {
  addGuide,
  guideFrame,
  guideLines,
  guideOffsetAt,
  guidePlanes,
  guidePointAt,
  removeGuide,
  SYMMETRY_GUIDE_ID,
  snapToGuides,
  updateGuide,
} from "./guides";
import {
  type LegoGuide,
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectData,
  parseLegoProjectJson,
} from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { buildS3o } from "./s3oBuild";
import { legoUnitDef } from "./unitDef";

type Vec3 = [number, number, number];

/** Same one-triangle pack the exporters' own tests use. */
function pack(): LoadedPack {
  const part: LegoPartInfo = {
    id: "tri",
    packId: "lego",
    shapeId: "tri",
    name: "tri",
    category: "grey",
    colourway: "grey",
    shape: "tri",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 0, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  const vertices = new Float32Array([
    0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
  ]);
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [part],
    byId: new Map([["tri", part]]),
    vertices,
    indices: new Uint16Array([0, 1, 2]),
  };
}

function project(pieces: Partial<LegoPiece>[] = []): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: "tri",
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
        ...piece,
      })),
    ],
  };
}

const GUIDES: LegoGuide[] = [
  { id: "g1", name: "wheel line", axis: "x", offset: 12 },
  { id: "g2", name: "deck", axis: "y", offset: 4, hidden: true },
  { id: "g3", name: "axle", kind: "line", axis: "z", point: [3, 2, 0] },
];

function withGuides(doc: LegoProject, guides = GUIDES): LegoProject {
  return { ...doc, guides };
}

function rootAt(doc: LegoProject, change: Partial<LegoPiece>): LegoProject {
  return {
    ...doc,
    pieces: doc.pieces.map((piece) =>
      piece.id === doc.rootPieceId ? { ...piece, ...change } : piece,
    ),
  };
}

describe("saving guides", () => {
  it("round trips through the saved document", () => {
    const read = parseLegoProjectJson(JSON.stringify(withGuides(project())));

    expect(read?.guides).toEqual(GUIDES);
  });

  it("has no key at all on a unit without guides", () => {
    expect("guides" in project()).toBe(false);
    const read = parseLegoProjectJson(JSON.stringify(project()));
    expect(read && "guides" in read).toBe(false);
  });

  it("reads a document saved before guides existed", () => {
    const saved = JSON.parse(JSON.stringify(project()));
    expect(parseLegoProjectData(saved)?.guides).toBeUndefined();
  });

  it("drops entries it cannot read and keeps the rest", () => {
    const saved = JSON.parse(JSON.stringify(project()));
    saved.guides = [
      { id: "ok", name: "ok", axis: "z", offset: -3 },
      { id: "badaxis", name: "x", axis: "w", offset: 1 },
      { id: "nooffset", name: "x", axis: "x" },
      { id: "nan", name: "x", axis: "x", offset: null },
      { name: "noid", axis: "x", offset: 1 },
      "junk",
      null,
      { id: "ok", name: "twin id", axis: "x", offset: 2 },
      { id: "bare", axis: "y", offset: 1.5 },
    ];

    const read = parseLegoProjectData(saved);

    expect(read?.guides?.map((g) => g.id)).toEqual(["ok", "bare"]);
    expect(read?.guides?.[0]).toEqual({
      id: "ok",
      name: "ok",
      axis: "z",
      offset: -3,
    });
    // A guide with no name is given one rather than lost.
    expect(read?.guides?.[1].name).not.toBe("");
  });

  it("writes no key when nothing readable is left, and ignores a non-list", () => {
    const saved = JSON.parse(JSON.stringify(project()));
    saved.guides = [{ id: "x", axis: "q", offset: 1 }];
    const none = parseLegoProjectData(saved);
    expect(none && "guides" in none).toBe(false);

    saved.guides = { id: "g", axis: "x", offset: 1 };
    const notList = parseLegoProjectData(saved);
    expect(notList && "guides" in notList).toBe(false);
  });
});

describe("saving guide lines", () => {
  it("reads a line back with its point, and a plane without a kind", () => {
    const read = parseLegoProjectJson(JSON.stringify(withGuides(project())));

    expect(read?.guides?.[2]).toEqual(GUIDES[2]);
    expect(read?.guides?.[0]).not.toHaveProperty("kind");
  });

  it("zeroes the coordinate along the line, which a line does not have", () => {
    const saved = JSON.parse(JSON.stringify(project()));
    saved.guides = [
      { id: "l", name: "l", kind: "line", axis: "x", point: [9, 1, 2] },
    ];

    expect(parseLegoProjectData(saved)?.guides?.[0].point).toEqual([0, 1, 2]);
  });

  it("drops a line with no point and a guide of a kind it does not know", () => {
    const saved = JSON.parse(JSON.stringify(project()));
    saved.guides = [
      { id: "a", name: "a", kind: "line", axis: "x" },
      { id: "b", name: "b", kind: "line", axis: "x", point: [1, 2] },
      { id: "c", name: "c", kind: "sphere", axis: "x", offset: 1 },
      { id: "d", name: "d", kind: "plane", axis: "x", offset: 1 },
    ];

    const read = parseLegoProjectData(saved);

    expect(read?.guides).toEqual([
      { id: "d", name: "d", axis: "x", offset: 1 },
    ]);
  });
});

describe("editing guides", () => {
  it("adds, renames, moves, hides and removes", () => {
    let doc = addGuide(project(), {
      id: "a",
      name: "a",
      axis: "x",
      offset: 1,
    });
    doc = updateGuide(doc, "a", { name: "row", offset: 5 });
    doc = updateGuide(doc, "a", { hidden: true });
    expect(doc.guides).toEqual([
      { id: "a", name: "row", axis: "x", offset: 5, hidden: true },
    ]);

    doc = updateGuide(doc, "a", { hidden: false });
    expect(doc.guides?.[0]).not.toHaveProperty("hidden");

    doc = removeGuide(doc, "a");
    expect("guides" in doc).toBe(false);
  });

  it("moves a line by its point", () => {
    const doc = updateGuide(withGuides(project()), "g3", { point: [5, 6, 0] });

    expect(doc.guides?.[2].point).toEqual([5, 6, 0]);
  });

  it("leaves the unit alone when the guide is not there", () => {
    const doc = withGuides(project());
    expect(updateGuide(doc, "nope", { offset: 1 })).toBe(doc);
    expect(removeGuide(doc, "nope")).toBe(doc);
  });
});

describe("where a guide is", () => {
  it("is the unit's own space, the root's frame", () => {
    const doc = withGuides(project(), [
      { id: "g", name: "g", axis: "x", offset: 12 },
    ]);

    const [plane] = guidePlanes(doc);
    expect(plane.normal).toEqual([1, 0, 0]);
    expect(plane.point).toEqual([12, 0, 0]);

    const moved = guidePlanes(rootAt(doc, { position: [0, 3, 5] }))[0];
    expect(moved.point).toEqual([12, 3, 5]);
  });

  it("turns with the root", () => {
    const doc = rootAt(
      withGuides(project(), [{ id: "g", name: "g", axis: "x", offset: 12 }]),
      { rotation: [0, Math.PI / 2, 0] },
    );

    const [plane] = guidePlanes(doc);
    expect(plane.normal.map((n) => Math.round(n * 1e6) / 1e6)).toEqual([
      0, 0, -1,
    ]);
    expect(plane.point.map((n) => Math.round(n * 1e6) / 1e6)).toEqual([
      0, 0, -12,
    ]);
  });

  it("does not stretch with the root's scale", () => {
    const doc = rootAt(
      withGuides(project(), [{ id: "g", name: "g", axis: "y", offset: 4 }]),
      { scale: [2, 3, 2] },
    );

    expect(guidePlanes(doc)[0].point).toEqual([0, 4, 0]);
    const scale = new THREE.Vector3();
    guideFrame(doc).decompose(
      new THREE.Vector3(),
      new THREE.Quaternion(),
      scale,
    );
    expect(scale.toArray()).toEqual([1, 1, 1]);
  });

  it("leaves a hidden guide out", () => {
    expect(guidePlanes(withGuides(project())).map((p) => p.id)).toEqual(["g1"]);
    expect(guideLines(withGuides(project())).map((l) => l.id)).toEqual(["g3"]);
  });

  it("reads a clicked point back as an offset on the guide's axis", () => {
    const doc = rootAt(project(), { position: [10, 0, 0] });
    expect(guideOffsetAt(doc, "x", [13, 2, 2])).toBeCloseTo(3);
    expect(guideOffsetAt(doc, "y", [13, 2, 2])).toBeCloseTo(2);
    expect(guideOffsetAt(doc, "z", [13, 2, 2])).toBeCloseTo(2);
  });
});

describe("where a guide line is", () => {
  const line = (axis: "x" | "y" | "z", point: Vec3): LegoGuide => ({
    id: "l",
    name: "axle",
    kind: "line",
    axis,
    point,
  });

  it("runs along its axis through its point in the unit's space", () => {
    const [found] = guideLines(withGuides(project(), [line("z", [3, 2, 0])]));

    expect(found.direction).toEqual([0, 0, 1]);
    expect(found.point).toEqual([3, 2, 0]);
  });

  it("goes with the root", () => {
    const doc = rootAt(withGuides(project(), [line("z", [3, 2, 0])]), {
      position: [10, 0, 0],
    });

    expect(guideLines(doc)[0].point).toEqual([13, 2, 0]);
  });

  it("reads a clicked point back as a point in the unit's space", () => {
    const doc = rootAt(project(), { position: [10, 0, 0] });

    expect(guidePointAt(doc, "y", [13, 2, 5])).toEqual([3, 0, 5]);
  });
});

describe("snapping to guide lines", () => {
  const xLine = {
    id: "l",
    name: "rail",
    axis: "x" as const,
    direction: [1, 0, 0] as Vec3,
    point: [0, 1, 2] as Vec3,
  };

  it("fixes the two coordinates across it and leaves the one along it", () => {
    const snap = snapToGuides([[7, 1.2, 1.9]], [], 0.45, [xLine]);

    expect(snap.delta[0]).toBe(0);
    expect(snap.delta[1]).toBeCloseTo(-0.2);
    expect(snap.delta[2]).toBeCloseTo(0.1);
    expect(snap.guides.map((g) => g.id)).toEqual(["l"]);
  });

  it("does nothing when no anchor is within reach of the line", () => {
    const snap = snapToGuides([[7, 3, 2]], [], 0.45, [xLine]);

    expect(snap.delta).toEqual([0, 0, 0]);
    expect(snap.guides).toEqual([]);
  });

  it("measures reach across the line, not as far as its point", () => {
    expect(
      snapToGuides([[900, 1.1, 2]], [], 0.45, [xLine]).guides,
    ).toHaveLength(1);
  });

  it("takes the nearest of two lines", () => {
    const far = { ...xLine, id: "far", point: [0, 1.3, 2] as Vec3 };
    const snap = snapToGuides([[0, 1.2, 2]], [], 0.45, [xLine, far]);

    expect(snap.guides.map((g) => g.id)).toEqual(["far"]);
  });

  it("lets a plane across the line settle the coordinate along it", () => {
    const along = {
      id: "p",
      name: "end",
      axis: "x" as const,
      normal: [1, 0, 0] as Vec3,
      point: [6, 0, 0] as Vec3,
    };
    const snap = snapToGuides([[5.9, 1.2, 2]], [along], 0.45, [xLine]);

    expect(snap.delta[0]).toBeCloseTo(0.1);
    expect(snap.delta[1]).toBeCloseTo(-0.2);
    expect(snap.guides.map((g) => g.id)).toEqual(["l", "p"]);
  });

  it("keeps a plane from undoing a coordinate the line has fixed", () => {
    const across = {
      id: "p",
      name: "deck",
      axis: "y" as const,
      normal: [0, 1, 0] as Vec3,
      point: [0, 1.4, 0] as Vec3,
    };
    const snap = snapToGuides([[7, 1.2, 2]], [across], 0.45, [xLine]);

    expect(snap.delta[1]).toBeCloseTo(-0.2);
    expect(snap.guides.map((g) => g.id)).toEqual(["l"]);
  });
});

describe("snapping to guides", () => {
  const xPlane = {
    id: "g1",
    name: "wheel line",
    axis: "x" as const,
    normal: [1, 0, 0] as Vec3,
    point: [12, 0, 0] as Vec3,
  };

  it("lands the nearest anchor exactly on the plane", () => {
    const snap = snapToGuides(
      [
        [11.8, 0, 0],
        [14, 0, 0],
      ],
      [xPlane],
      0.45,
    );

    expect(snap.delta[0]).toBeCloseTo(0.2);
    expect(snap.delta[1]).toBe(0);
    expect(snap.delta[2]).toBe(0);
    expect(snap.guides).toEqual([xPlane]);
  });

  it("does nothing when no anchor is within reach", () => {
    const snap = snapToGuides([[10, 0, 0]], [xPlane], 0.45);

    expect(snap.delta).toEqual([0, 0, 0]);
    expect(snap.guides).toEqual([]);
  });

  it("moves one coordinate and never pulls the piece to a point", () => {
    const snap = snapToGuides([[12.3, 7, -9]], [xPlane], 0.45);

    expect(snap.delta[0]).toBeCloseTo(-0.3);
    expect(snap.delta[1]).toBe(0);
    expect(snap.delta[2]).toBe(0);
  });

  it("snaps each axis on its own when guides cross", () => {
    const yPlane = {
      id: "g2",
      name: "deck",
      axis: "y" as const,
      normal: [0, 1, 0] as Vec3,
      point: [0, 4, 0] as Vec3,
    };

    const snap = snapToGuides([[12.1, 3.9, 50]], [xPlane, yPlane], 0.45);

    expect(snap.delta[0]).toBeCloseTo(-0.1);
    expect(snap.delta[1]).toBeCloseTo(0.1);
    expect(snap.delta[2]).toBe(0);
    expect(snap.guides.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("takes the nearer of two parallel guides", () => {
    const near = { ...xPlane, id: "near", point: [12.2, 0, 0] as Vec3 };
    const snap = snapToGuides([[12.15, 0, 0]], [xPlane, near], 0.45);

    expect(snap.guides.map((g) => g.id)).toEqual(["near"]);
    expect(snap.delta[0]).toBeCloseTo(0.05);
  });

  it("follows a guide on a turned root", () => {
    const turned = {
      ...xPlane,
      normal: [0, 0, -1] as Vec3,
      point: [0, 0, -12] as Vec3,
    };
    const snap = snapToGuides([[3, 3, -11.9]], [turned], 0.45);

    expect(snap.delta[0]).toBeCloseTo(0);
    expect(snap.delta[2]).toBeCloseTo(-0.1);
  });
});

describe("guides and the export", () => {
  const doc = project([{ id: "hull", name: "hull", position: [1, 2, 3] }]);
  const guided = withGuides(doc);
  const textures = { texture1: "probe.png" };

  it("does not change the s3o", () => {
    expect(buildS3o(guided, pack(), null, textures)).toEqual(
      buildS3o(doc, pack(), null, textures),
    );
  });

  it("does not change the obj", () => {
    const options = { unitName: "probe", textureName: "probe.png" };
    expect(buildObj(guided, pack(), null, options)).toEqual(
      buildObj(doc, pack(), null, options),
    );
  });

  it("does not add a node to the glb", () => {
    const names = (project: LegoProject) => {
      const found: string[] = [];
      buildGlbScene(project, pack(), null)?.traverse((node) =>
        found.push(`${node.type}:${node.name}`),
      );
      return found;
    };

    expect(names(guided)).toEqual(names(doc));
  });

  it("does not change the unit definition", () => {
    const bounds = { mid: [0, 0, 0] as Vec3, sizeX: 32, sizeY: 10, sizeZ: 32 };

    expect(legoUnitDef(guided, bounds, "def", null)).toEqual(
      legoUnitDef(doc, bounds, "def", null),
    );
  });
});

function counter() {
  let n = 0;
  return () => `n${n++}`;
}

describe("guides belong to the unit, not to a piece", () => {
  const doc = withGuides(
    project([
      { id: "hull", name: "hull", position: [1, 0, 0] },
      { id: "gun", name: "gun", parentId: "hull" },
    ]),
  );
  const options = { id: "c", now: "2026-10-17T00:00:00Z", newId: counter() };

  it("are not copied into a compound", () => {
    expect(subtreeAsCompound(doc, "hull", options)).not.toHaveProperty(
      "guides",
    );
    expect(selectionAsCompound(doc, ["hull"], options)).not.toHaveProperty(
      "guides",
    );
  });

  it("are not on the clipboard", () => {
    const compound = subtreeAsCompound(doc, "hull", options) as LegoProject;
    const text = serializeClipboardPiece(compound);

    expect(text).not.toContain("wheel line");
    const read = parseClipboardPiece(text, new Set(["tri"]));
    expect(read.ok && read.piece.project.guides).toBeUndefined();
  });
});

describe("the symmetry plane guide (#4334)", () => {
  const round = (v: Vec3) => v.map((n) => Math.round(n * 1e6) / 1e6);

  it("is there only while symmetry asks for it", () => {
    expect(guidePlanes(project())).toEqual([]);
    expect(guidePlanes(project(), { symmetry: false })).toEqual([]);
    const [plane] = guidePlanes(project(), { symmetry: true });
    expect(plane.id).toBe(SYMMETRY_GUIDE_ID);
    expect(plane.normal).toEqual([1, 0, 0]);
    expect(plane.point).toEqual([0, 0, 0]);
  });

  it("sits beside the guides the game maker placed", () => {
    const ids = guidePlanes(withGuides(project()), { symmetry: true }).map(
      (p) => p.id,
    );
    expect(ids).toEqual(["g1", SYMMETRY_GUIDE_ID]);
  });

  it("pulls a point to x = 0 like any other guide plane", () => {
    const planes = guidePlanes(project(), { symmetry: true });
    const snapped = snapToGuides([[0.3, 5, 2]], planes, 0.5);
    expect(snapped.delta).toEqual([-0.3, 0, 0]);
    expect(snapped.guides.map((g) => g.id)).toEqual([SYMMETRY_GUIDE_ID]);
    expect(snapToGuides([[2, 5, 2]], planes, 0.5).guides).toEqual([]);
  });

  it("cannot be removed or edited through the guide list", () => {
    const doc = withGuides(project());
    expect(removeGuide(doc, SYMMETRY_GUIDE_ID)).toBe(doc);
    expect(updateGuide(doc, SYMMETRY_GUIDE_ID, { offset: 3 })).toBe(doc);
  });

  it("is not saved with the unit", () => {
    const doc = project();
    guidePlanes(doc, { symmetry: true });
    const read = parseLegoProjectJson(JSON.stringify(doc));
    expect(read && "guides" in read).toBe(false);
    const withOne = parseLegoProjectJson(JSON.stringify(withGuides(doc)));
    expect(withOne?.guides?.map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
  });

  it("follows a root that moves and turns", () => {
    const doc = rootAt(project(), {
      position: [4, 0, 2],
      rotation: [0, Math.PI / 2, 0],
    });
    const [plane] = guidePlanes(doc, { symmetry: true });
    expect(round(plane.normal)).toEqual([0, 0, -1]);
    expect(round(plane.point)).toEqual([4, 0, 2]);
    // The turned plane is z = 2, so a point at z = 2.2 is pulled back 0.2.
    expect(
      snapToGuides([[9, 1, 2.2]], [plane], 0.5).delta.map(
        (n) => Math.round(n * 1e6) / 1e6,
      ),
    ).toEqual([0, 0, -0.2]);
  });
});
