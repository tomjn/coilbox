/**
 * Turning a model read out of a game archive into something three.js can draw.
 *
 * Kept out of the component so the parts worth reasoning about, the piece tree,
 * the texture loader choice and the DDS orientation, sit in one place rather
 * than inside a render effect.
 *
 * Both model formats arrive already flattened by the worker into a tree of
 * pieces holding indexed triangle batches, so there is nothing format-specific
 * here beyond which loader reads a texture file.
 */

import * as THREE from "three";

import { unitModelTextureUrl } from "@/lib/assetUrl";
import {
  cutOutHiddenPixels,
  paintTeamColour,
  springTexture,
  TEAM_COLOUR,
} from "@/lib/springTexture";
import type { UnitModelPiece, UnitModelResult } from "./bindings";

/**
 * What a face with no texture is drawn in.
 *
 * A `.3do` face can name a Total Annihilation palette entry instead of a
 * texture. The palette is compiled into the engine rather than shipped in the
 * archive, so there is nothing to read: those faces are drawn plain, and the
 * viewer says how many there were rather than quietly miscolouring them.
 */
const UNTEXTURED = 0x9aa0a6;

/** What a built model hands back: the object to add, its extent, and cleanup. */
export interface BuiltModel {
  object: THREE.Group;
  /** The model's own bounding box, for framing the camera on it. */
  box: THREE.Box3;
  /** Frees the geometries and materials this build made. Textures are shared
   *  for the session and are deliberately not freed here. */
  dispose: () => void;
}

/**
 * A texture out of the model-texture cache.
 *
 * The cache holds raw archive bytes, so the file's own extension picks the
 * loader. `springTexture` is what the unit builder's imported units use too:
 * they find their bytes somewhere else entirely and agree on everything after
 * that. A `.3do` face can also name a Total Annihilation palette entry rather
 * than a texture, which is why `UNTEXTURED` exists above.
 */
function modelTexture(file: string): THREE.Texture {
  return springTexture(unitModelTextureUrl(file));
}

/**
 * Build the whole model as a group of meshes, parented and offset the way the
 * file's piece tree says.
 *
 * Both formats store a translation per piece and no rotation or scale, so the
 * tree maps straight onto nested `Object3D`s. Materials are double-sided: a
 * `.3do` derives its face normals with the opposite sign to the usual
 * convention, and shipped models of both formats are inconsistent about
 * winding, so a single-sided view of a real unit has holes in it.
 *
 * `teamColour` is what the regions the engine would paint in the owning
 * player's colour are painted in. It defaults to the lone-model viewer's stand-in
 * blue; a view that knows whose unit this is passes that team's colour.
 */
export function buildModel(
  model: UnitModelResult,
  teamColour: THREE.ColorRepresentation = TEAM_COLOUR,
): BuiltModel {
  const geometries: THREE.BufferGeometry[] = [];
  const materials = new Map<string, THREE.MeshStandardMaterial>();

  const materialFor = (
    name: string | undefined,
  ): THREE.MeshStandardMaterial => {
    const key = name ?? "";
    const existing = materials.get(key);
    if (existing) return existing;
    const texture = model.textures.find((t) => t.name === name);
    const file = texture?.file;
    const material = new THREE.MeshStandardMaterial({
      map: file ? modelTexture(file) : null,
      color: file ? 0xffffff : texture?.teamColour ? teamColour : UNTEXTURED,
      roughness: 0.75,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    // Only an `.s3o` keeps a team-colour mask in its texture's alpha. A `.3do`
    // keeps reflectivity there and names its team-colour regions face by face,
    // which is the `texture?.teamColour` branch above.
    if (file && model.format === "s3o") {
      paintTeamColour(material, teamColour);
      // The second texture masks out the pixels the engine never draws, and
      // every material of one model shares it: an `.s3o` names one pair for the
      // whole model. A model that names no second texture, or whose second
      // texture is not in the archive, draws whole.
      const mask = model.teamMask?.file;
      if (mask) cutOutHiddenPixels(material, modelTexture(mask));
    }
    materials.set(key, material);
    return material;
  };

  const addPiece = (piece: UnitModelPiece): THREE.Object3D => {
    const node = new THREE.Object3D();
    node.name = piece.name;
    node.position.set(piece.offset[0], piece.offset[1], piece.offset[2]);
    for (const group of piece.groups) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(group.positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(group.normals, 3),
      );
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(group.uvs, 2),
      );
      geometry.setIndex(group.indices);
      geometries.push(geometry);
      node.add(new THREE.Mesh(geometry, materialFor(group.texture)));
    }
    for (const child of piece.children) node.add(addPiece(child));
    return node;
  };

  const object = new THREE.Group();
  if (model.root) object.add(addPiece(model.root));
  object.updateMatrixWorld(true);

  return {
    object,
    box: new THREE.Box3().setFromObject(object),
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials.values()) m.dispose();
    },
  };
}

/** Triangles across the whole piece tree, for the viewer's summary line. */
export function countTriangles(piece: UnitModelPiece): number {
  let total = 0;
  for (const group of piece.groups) total += group.indices.length / 3;
  for (const child of piece.children) total += countTriangles(child);
  return total;
}

/** Pieces in the tree, counting those that are hierarchy only. */
export function countPieces(piece: UnitModelPiece): number {
  let total = 1;
  for (const child of piece.children) total += countPieces(child);
  return total;
}
