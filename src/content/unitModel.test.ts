import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UnitModelResult, UnitModelTexture } from "./bindings";

/**
 * The texture loader and the shader patch, stood in for.
 *
 * Loading a real texture wants a DOM and a webview to serve `coilbox://`, and
 * neither says anything about the question here: which of a model's textures the
 * viewer asks for, and which materials get the team-colour patch.
 */
const loaded: string[] = [];
const painted: THREE.Material[] = [];
const masked: THREE.Material[] = [];

vi.mock("@/lib/springTexture", () => ({
  TEAM_COLOUR: 0x1028cc,
  springTexture: (url: string) => {
    loaded.push(url);
    return new THREE.Texture();
  },
  paintTeamColour: (material: THREE.Material) => {
    painted.push(material);
  },
  cutOutHiddenPixels: (material: THREE.Material) => {
    masked.push(material);
  },
}));

const { buildModel } = await import("./unitModel");

function texture(name: string, file = ""): UnitModelTexture {
  return {
    name,
    source: file ? `unittextures/${name}` : "",
    file,
    teamColour: false,
  };
}

function model(over: Partial<UnitModelResult> = {}): UnitModelResult {
  return {
    format: "s3o",
    path: "objects3d/test.s3o",
    radius: 0,
    height: 0,
    mid: [0, 0, 0],
    root: {
      name: "base",
      offset: [0, 0, 0],
      groups: [
        {
          texture: "skin.dds",
          positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
          normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
          uvs: [0, 0, 1, 0, 1, 1],
          indices: [0, 1, 2],
        },
      ],
      children: [],
    },
    textures: [texture("skin.dds", "abc_skin_dds.dds")],
    texture2: texture("skin_glow.dds", "abc_skin_glow_dds.dds"),
    paletteFaces: 0,
    errors: [],
    ...over,
  };
}

beforeEach(() => {
  loaded.length = 0;
  painted.length = 0;
  masked.length = 0;
});

describe("buildModel", () => {
  /**
   * An `.s3o` keeps its team-colour mask in the alpha of the texture the unit is
   * painted with, which is the material's own map, so the patch goes on every
   * textured material whether or not the model names a second texture.
   */
  it("paints team colour on an s3o's textured material", () => {
    const built = buildModel(model());
    expect(painted).toHaveLength(1);
    built.dispose();
  });

  it("paints it with no second texture named at all", () => {
    const built = buildModel(model({ texture2: undefined }));
    expect(painted).toHaveLength(1);
    built.dispose();
  });

  /**
   * The second texture is loaded for its alpha alone, which is the mask the
   * engine discards on (issue #1911). It costs a second upload of what can be a
   * 64 MiB atlas, and the alternative is drawing faces the game hides.
   */
  it("loads both of an s3o's textures", () => {
    const built = buildModel(model());
    expect(loaded).toEqual([
      "coilbox://localhost/unitmodel/abc_skin_dds.dds",
      "coilbox://localhost/unitmodel/abc_skin_glow_dds.dds",
    ]);
    expect(masked).toHaveLength(1);
    built.dispose();
  });

  /** No second texture is no reason to stop drawing: the engine stands a
   *  missing one in as a single opaque pixel. */
  it("draws the model whole when there is no second texture", () => {
    const built = buildModel(model({ texture2: undefined }));
    expect(masked).toHaveLength(0);
    built.dispose();
  });

  /** Named but not in the archive is the same case. */
  it("draws the model whole when the second texture was not found", () => {
    const built = buildModel(model({ texture2: texture("skin_glow.dds") }));
    expect(masked).toHaveLength(0);
    expect(loaded).toEqual(["coilbox://localhost/unitmodel/abc_skin_dds.dds"]);
    built.dispose();
  });

  /**
   * A `.3do` keeps reflectivity in its texture's alpha, not a mask. Mixing on it
   * would paint a unit's shiniest parts in the player's colour, and the engine
   * moves that alpha into the second texture's green rather than reading either
   * as a cut-out.
   */
  it("leaves a 3do's materials alone", () => {
    const built = buildModel(
      model({ format: "3do", path: "objects3d/test.3do", texture2: undefined }),
    );
    expect(painted).toHaveLength(0);
    expect(masked).toHaveLength(0);
    built.dispose();
  });

  /** A `.3do` that somehow names a second texture is still a `.3do`. */
  it("leaves a 3do alone even with a second texture named", () => {
    const built = buildModel(
      model({ format: "3do", path: "objects3d/test.3do" }),
    );
    expect(masked).toHaveLength(0);
    built.dispose();
  });

  /** A face with no texture behind it is drawn plain, not painted. */
  it("leaves an untextured material alone", () => {
    const built = buildModel(model({ textures: [texture("skin.dds")] }));
    expect(painted).toHaveLength(0);
    built.dispose();
  });
});

/** A triangle, offset along x so two of them can be told apart. */
function face(texture: string | undefined, x: number) {
  return {
    texture,
    positions: [x, 0, 0, x + 1, 0, 0, x + 1, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 0, 1, 0, 1, 1],
    indices: [0, 1, 2],
  };
}

/**
 * Three faces over two pieces and two textures: enough for a merge to have
 * something to join, something it must keep apart, and a piece offset it has to
 * carry into the vertices.
 */
function twoPieces(): UnitModelResult {
  return model({
    root: {
      name: "base",
      offset: [0, 0, 0],
      groups: [face("skin.dds", 0)],
      children: [
        {
          name: "turret",
          offset: [0, 10, 0],
          groups: [face("skin.dds", 2), face("other.dds", 4)],
          children: [],
        },
      ],
    },
    textures: [
      texture("skin.dds", "abc_skin_dds.dds"),
      texture("other.dds", "abc_other_dds.dds"),
    ],
  });
}

function meshes(object: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) out.push(node);
  });
  return out;
}

function triangles(object: THREE.Object3D): number {
  let total = 0;
  for (const mesh of meshes(object)) {
    const index = mesh.geometry.getIndex();
    total += (index?.count ?? 0) / 3;
  }
  return total;
}

describe("buildModel merged", () => {
  it("draws one mesh per material rather than one per piece", () => {
    const tree = buildModel(twoPieces());
    const merged = buildModel(twoPieces(), undefined, { merge: true });
    expect(meshes(tree.object)).toHaveLength(3);
    expect(meshes(merged.object)).toHaveLength(2);
    tree.dispose();
    merged.dispose();
  });

  it("keeps every triangle", () => {
    const merged = buildModel(twoPieces(), undefined, { merge: true });
    expect(triangles(merged.object)).toBe(3);
    merged.dispose();
  });

  /** The pieces stop being separate objects, so where the tree stood each one
   *  has to end up in its vertices instead. */
  it("bakes the piece offsets into the vertices", () => {
    const merged = buildModel(twoPieces(), undefined, { merge: true });
    const box = new THREE.Box3().setFromObject(merged.object);
    expect(box.max.y).toBe(11);
    merged.dispose();
  });

  it("reports the same extent as the piece tree", () => {
    const tree = buildModel(twoPieces());
    const merged = buildModel(twoPieces(), undefined, { merge: true });
    expect(merged.box.min.toArray()).toEqual(tree.box.min.toArray());
    expect(merged.box.max.toArray()).toEqual(tree.box.max.toArray());
    tree.dispose();
    merged.dispose();
  });

  /** Asked for by the map alone, so the lone-model viewer still gets the tree
   *  the file describes. */
  it("leaves the piece tree alone when it is not asked for", () => {
    const built = buildModel(twoPieces());
    expect(built.object.getObjectByName("turret")).toBeDefined();
    built.dispose();
  });
});
