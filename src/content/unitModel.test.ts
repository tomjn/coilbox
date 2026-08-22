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

vi.mock("@/lib/springTexture", () => ({
  TEAM_COLOUR: 0x1028cc,
  springTexture: (url: string) => {
    loaded.push(url);
    return new THREE.Texture();
  },
  paintTeamColour: (material: THREE.Material) => {
    painted.push(material);
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
    teamMask: texture("skin_glow.dds", "abc_skin_glow_dds.dds"),
    paletteFaces: 0,
    errors: [],
    ...over,
  };
}

beforeEach(() => {
  loaded.length = 0;
  painted.length = 0;
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
    const built = buildModel(model({ teamMask: undefined }));
    expect(painted).toHaveLength(1);
    built.dispose();
  });

  /**
   * The bug this replaced: the second texture is a glow and reflectivity map, so
   * loading it painted every glowing part in the player's colour and cost a
   * second upload of what can be a 64 MiB atlas.
   */
  it("loads only the texture the unit is painted with", () => {
    const built = buildModel(model());
    expect(loaded).toEqual(["coilbox://localhost/unitmodel/abc_skin_dds.dds"]);
    built.dispose();
  });

  /**
   * A `.3do` keeps reflectivity in its texture's alpha, not a mask. Mixing on it
   * would paint a unit's shiniest parts in the player's colour.
   */
  it("leaves a 3do's materials alone", () => {
    const built = buildModel(
      model({ format: "3do", path: "objects3d/test.3do", teamMask: undefined }),
    );
    expect(painted).toHaveLength(0);
    built.dispose();
  });

  /** A face with no texture behind it is drawn plain, not painted. */
  it("leaves an untextured material alone", () => {
    const built = buildModel(model({ textures: [texture("skin.dds")] }));
    expect(painted).toHaveLength(0);
    built.dispose();
  });
});
