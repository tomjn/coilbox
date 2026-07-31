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
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";

import { unitModelTextureUrl } from "@/lib/assetUrl";
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

/**
 * What a team-colour region is drawn in.
 *
 * A `.3do` face can name one of the textures the game lists in
 * `unittextures/tatex/teamtex.txt`, which is a region the engine paints in the
 * player's colour. On disk those files are a flat magenta placeholder, so
 * drawing them literally gives a magenta commander nobody has ever seen. A
 * viewer has no player to take a colour from, so it picks one.
 */
const TEAM_COLOUR = 0x1028cc;

/** Textures shared for the session, keyed by URL, as the parts pack's are.
 *  Hundreds of a game's units sample one atlas, and it can be 64 MiB. */
const textures = new Map<string, THREE.Texture>();

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
 * Load a texture out of the model-texture cache.
 *
 * Only two cases, because the worker has already re-encoded the `.bmp` and
 * `.tga` a webview cannot read. `.dds` goes to the GPU still compressed rather
 * than being decoded anywhere: a game's shared unit atlas can be a DXT5 8192
 * square, which is 64 MiB packed and 256 MiB as RGBA.
 */
function modelTexture(file: string, data = false): THREE.Texture {
  const url = unitModelTextureUrl(file);
  const cached = textures.get(url);
  if (cached) return cached;

  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  const texture =
    ext === "dds"
      ? new DDSLoader().load(url)
      : new THREE.TextureLoader().load(url);
  // A mask is measurements rather than colour, so it must not be gamma-decoded
  // on the way to the shader that reads it.
  texture.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // The engine flips every texture to OpenGL's bottom-up order on load,
  // including a DDS. three does that for anything it decodes itself, but a
  // compressed texture is uploaded block by block and cannot be flipped, so the
  // sampling is turned upside down instead.
  if (ext === "dds") {
    texture.flipY = false;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, -1);
    texture.offset.set(0, 1);
  }
  textures.set(url, texture);
  return texture;
}

/**
 * Paint the team-colour regions an `.s3o` marks in its second texture.
 *
 * The two formats hide this in different places. A `.3do` names a team-colour
 * texture per face, which the worker flags. An `.s3o` leaves those regions
 * black in the texture it draws and marks them in the red channel of a second
 * one, so a viewer that loads only the first draws a commander with a black
 * head. Mixing them needs a second sampler, which is a patch on the standard
 * material rather than a material of our own: everything else about it, the
 * lighting and the colour space, is what the rest of the app already uses.
 */
function paintTeamColour(
  material: THREE.MeshStandardMaterial,
  mask: THREE.Texture,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.teamMask = { value: mask };
    shader.uniforms.teamColour = { value: new THREE.Color(TEAM_COLOUR) };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform sampler2D teamMask;\nuniform vec3 teamColour;",
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, teamColour, texture2D(teamMask, vMapUv).r);",
      );
  };
  // Without this three reuses the unpatched program it compiled for another
  // material with the same parameters.
  material.customProgramCacheKey = () => "coilbox-team-colour";
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
 */
export function buildModel(model: UnitModelResult): BuiltModel {
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
      color: file ? 0xffffff : texture?.teamColour ? TEAM_COLOUR : UNTEXTURED,
      roughness: 0.75,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    if (file && model.teamMask?.file) {
      paintTeamColour(material, modelTexture(model.teamMask.file, true));
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
