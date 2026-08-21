// @vitest-environment happy-dom

/**
 * The scene graph the viewport builds from a document (issue #586).
 *
 * `syncScene` is the seam between the piece hierarchy and three.js: a `Group`
 * per piece, carrying a `Mesh` when the piece has a part, hung off the group of
 * whatever piece carries it. None of that is drawing, so it is checked here
 * without a WebGL context. The rest of the viewport is: the camera, the gizmo,
 * the snapping and the highlights all need a real canvas and are not covered.
 *
 * The bug this is really about: the document does not promise a parent comes
 * before its children, so a piece whose parent came later in the array once got
 * hung off the scene root. On screen that is a piece sitting in the wrong place
 * with no error anywhere, until some later edit happened to sync again.
 */

import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { type SceneGraph, syncScene } from "./ModelViewport";

/** A pack holding one part: a triangle a metre out along x and z. */
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
  return {
    manifest: {} as LoadedPack["manifest"],
    library: {
      packs: [],
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
      dir: "",
      problems: [],
    },
    parts: [part],
    byId: new Map([["tri", part]]),
    // x, y, z, nx, ny, nz, u, v
    vertices: new Float32Array([
      0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  };
}

const loaded = pack();

function piece(id: string, parentId: string | null): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

/** A document whose root is `base`, carrying exactly the pieces given. */
function project(...pieces: LegoPiece[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "base",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-21T00:00:00Z",
  });
  return { ...base, pieces: [...base.pieces, ...pieces] };
}

/**
 * Everything `syncScene` reaches for. The gizmo is a stand-in: all that is
 * asked of it is whether it is holding a group that is about to leave.
 */
function graph(): SceneGraph & { detached: number } {
  const state = {
    root: new THREE.Group(),
    groups: new Map<string, THREE.Group>(),
    imported: null,
    detached: 0,
    gizmo: {
      object: undefined as THREE.Object3D | undefined,
      detach() {
        state.detached += 1;
        state.gizmo.object = undefined;
      },
    },
  };
  return state as unknown as SceneGraph & { detached: number };
}

let scene: ReturnType<typeof graph>;

beforeEach(() => {
  scene = graph();
});

/** The group standing for a piece, or a failure saying which piece is missing. */
function groupOf(pieceId: string): THREE.Group {
  const group = scene.groups.get(pieceId);
  if (!group) throw new Error(`no group for ${pieceId}`);
  return group;
}

/** What carries a piece's group in the scene, by piece id, or "root". */
function carrierOf(pieceId: string): string {
  const group = groupOf(pieceId);
  if (group.parent === scene.root) return "root";
  const id = group.parent?.userData.pieceId;
  return typeof id === "string" ? id : "nowhere";
}

describe("mirroring the piece hierarchy", () => {
  it("gives every piece a group of its own, tagged with the piece it is", () => {
    syncScene(
      scene,
      loaded,
      null,
      project(piece("hull", "base"), piece("turret", "hull")),
    );

    expect([...scene.groups.keys()].sort()).toEqual(["base", "hull", "turret"]);
    expect(scene.groups.get("turret")?.userData.pieceId).toBe("turret");
  });

  it("hangs each piece off the group of the piece that carries it", () => {
    syncScene(
      scene,
      loaded,
      null,
      project(piece("hull", "base"), piece("turret", "hull")),
    );

    expect(carrierOf("base")).toBe("root");
    expect(carrierOf("hull")).toBe("base");
    expect(carrierOf("turret")).toBe("hull");
  });

  /**
   * The one this file exists for. Nothing orders the array, and reparenting a
   * piece leaves it where it already was, so a child can and does come first.
   */
  it("hangs a piece off its parent even when the parent comes later in the array", () => {
    syncScene(
      scene,
      loaded,
      null,
      project(piece("turret", "hull"), piece("hull", "base")),
    );

    expect(carrierOf("turret")).toBe("hull");
    expect(carrierOf("hull")).toBe("base");
  });

  /** The same in reverse: the whole unit written child-first. */
  it("builds a chain written entirely backwards", () => {
    syncScene(
      scene,
      loaded,
      null,
      project(
        piece("barrel", "turret"),
        piece("turret", "hull"),
        piece("hull", "base"),
      ),
    );

    expect(carrierOf("barrel")).toBe("turret");
    expect(carrierOf("turret")).toBe("hull");
    expect(carrierOf("hull")).toBe("base");
  });

  /** A piece whose parent is gone would otherwise be nowhere at all. */
  it("puts a piece with no parent on the scene root", () => {
    syncScene(scene, loaded, null, project(piece("stray", null)));
    expect(carrierOf("stray")).toBe("root");
  });
});

describe("following an edit", () => {
  it("keeps a piece's own group across edits, so its buffers are not rebuilt", () => {
    const before = project(piece("hull", "base"));
    syncScene(scene, loaded, null, before);
    const hull = scene.groups.get("hull");

    syncScene(scene, loaded, null, {
      ...before,
      pieces: before.pieces.map((p) =>
        p.id === "hull" ? { ...p, position: [1, 2, 3] } : p,
      ),
    });

    expect(scene.groups.get("hull")).toBe(hull);
    expect(hull?.position.toArray()).toEqual([1, 2, 3]);
  });

  it("moves a piece to its new parent when it is reparented", () => {
    const before = project(
      piece("hull", "base"),
      piece("turret", "hull"),
      piece("skirt", "base"),
    );
    syncScene(scene, loaded, null, before);
    expect(carrierOf("turret")).toBe("hull");

    syncScene(scene, loaded, null, {
      ...before,
      pieces: before.pieces.map((p) =>
        p.id === "turret" ? { ...p, parentId: "skirt" } : p,
      ),
    });

    expect(carrierOf("turret")).toBe("skirt");
    expect(scene.groups.get("hull")?.children).toHaveLength(0);
  });

  it("takes a deleted piece's group out of the scene and off the register", () => {
    const before = project(piece("hull", "base"), piece("turret", "hull"));
    syncScene(scene, loaded, null, before);
    const turret = scene.groups.get("turret");

    syncScene(scene, loaded, null, {
      ...before,
      pieces: before.pieces.filter((p) => p.id !== "turret"),
    });

    expect(scene.groups.has("turret")).toBe(false);
    expect(turret?.parent).toBeNull();
  });

  /**
   * The gizmo warns on its next render if the object it is holding has left the
   * scene graph, so it has to let go first. This is the only place a group's
   * removal is decided, so it is the only place that can know.
   */
  it("takes the gizmo off a piece before deleting it", () => {
    const before = project(piece("hull", "base"));
    syncScene(scene, loaded, null, before);
    scene.gizmo.object = groupOf("hull");

    syncScene(scene, loaded, null, {
      ...before,
      pieces: before.pieces.filter((p) => p.id !== "hull"),
    });

    expect(scene.detached).toBe(1);
    expect(scene.gizmo.object).toBeUndefined();
  });

  it("leaves the gizmo alone when it is holding a piece that is staying", () => {
    const before = project(piece("hull", "base"), piece("turret", "hull"));
    syncScene(scene, loaded, null, before);
    scene.gizmo.object = groupOf("hull");

    syncScene(scene, loaded, null, {
      ...before,
      pieces: before.pieces.filter((p) => p.id !== "turret"),
    });

    expect(scene.detached).toBe(0);
  });
});

describe("what a group carries", () => {
  it("puts a mesh on a piece that has a part, and none on one that has not", () => {
    syncScene(
      scene,
      loaded,
      null,
      project(
        { ...piece("hull", "base"), partId: "tri" },
        piece("flare", "base"),
      ),
    );

    expect(
      scene.groups
        .get("hull")
        ?.children.some((child) => child instanceof THREE.Mesh),
    ).toBe(true);
    expect(scene.groups.get("flare")?.children).toHaveLength(0);
  });

  /** A part can be swapped for none, and the mesh has to go with it. */
  it("takes the mesh away when a piece loses its part", () => {
    const before = project({ ...piece("hull", "base"), partId: "tri" });
    syncScene(scene, loaded, null, before);

    syncScene(scene, loaded, null, {
      ...before,
      pieces: before.pieces.map((p) =>
        p.id === "hull" ? { ...p, partId: null } : p,
      ),
    });

    expect(scene.groups.get("hull")?.children).toHaveLength(0);
  });

  it("carries the piece's own placement on its group", () => {
    syncScene(scene, loaded, null, {
      ...project(),
      pieces: [
        {
          ...piece("hull", "base"),
          position: [1, 2, 3],
          rotation: [0.5, 0, 0],
          scale: [2, 2, 2],
        },
        ...project().pieces,
      ],
    });

    const hull = scene.groups.get("hull");
    expect(hull?.position.toArray()).toEqual([1, 2, 3]);
    expect(hull?.rotation.x).toBeCloseTo(0.5);
    expect(hull?.scale.toArray()).toEqual([2, 2, 2]);
  });

  /** Hiding is editor-only and never reaches the export, so it is the group's
   *  visibility rather than anything in the document's geometry. */
  it("hides a piece the builder has switched off", () => {
    syncScene(
      scene,
      loaded,
      null,
      project(
        { ...piece("hull", "base"), hidden: true },
        piece("skirt", "base"),
      ),
    );

    expect(scene.groups.get("hull")?.visible).toBe(false);
    expect(scene.groups.get("skirt")?.visible).toBe(true);
  });
});
