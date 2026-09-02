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
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { unitModelTextureUrl } from "@/lib/assetUrl";
import {
  cutOutHiddenPixels,
  paintTeamColour,
  springTexture,
  springTextureFailed,
  TEAM_COLOUR,
} from "@/lib/springTexture";
import { onTextureArrived } from "@/lib/textureArrival";
import type { AtlasPlace, AtlasSource } from "@/lib/textureAtlas";
import { atlasPlace, drawAtlas, packTiles, placeUvs } from "@/lib/textureAtlas";
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

/** How the model is put together, for a caller that draws many copies of it. */
export interface BuildModelOptions {
  /**
   * Bake the piece tree down to one mesh per material (issue #2293).
   *
   * A model arrives as a tree of pieces and every texture group in every piece
   * is its own mesh, which is its own draw call. Measured in the app, that is
   * 6.8 meshes for a SplinterFaction unit and 77 for a Balanced Annihilation
   * one, and a map that draws two hundred units pays it two hundred times.
   * Merging the pieces that share a material into one mesh drops that to the
   * number of textures the model uses, which on both games is one or two.
   *
   * Only safe where the model is drawn in one pose, because the pieces stop
   * being separate objects and cannot be moved apart again. The scenario map is
   * that case: nothing there animates a piece. The lone-model viewer is not
   * asked to merge, so anything wanting the tree back can still have it.
   */
  merge?: boolean;

  /**
   * One sheet holding the textures the model names, from
   * {@link prepareTextureAtlas} (issue #2311).
   *
   * With it, every face the sheet covers draws from a single material, so the
   * merge above lands on one mesh rather than one per texture. That is what
   * takes a Balanced Annihilation unit down to what a SplinterFaction one
   * already costs: its `.3do` paints every face from its own small tile and so
   * names about thirty textures, and thirty materials is thirty draw calls per
   * unit however the meshes are grouped.
   *
   * Only worth passing alongside `merge`, and only ever built for a `.3do`. The
   * lone-model viewer is not given one, so it goes on showing the model's own
   * textures rather than a sheet of them.
   */
  atlas?: UnitTextureAtlas | null;
}

/** A model's textures packed into one sheet, and where each of them landed. */
export interface UnitTextureAtlas {
  texture: THREE.Texture;
  /** Keyed by cache file name, which is what a `UnitModelTexture` carries. */
  place: Map<string, AtlasPlace>;
}

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

/** Whether the loader has finished with this texture, either way. */
function settled(texture: THREE.Texture): boolean {
  if (springTextureFailed(texture)) return true;
  return Boolean((texture.image as { width?: number } | undefined)?.width);
}

/** Resolves once every one of `textures` has its pixels or has given up. */
function whenSettled(textures: THREE.Texture[]): Promise<void> {
  if (textures.every(settled)) return Promise.resolve();
  return new Promise((done) => {
    const stop = onTextureArrived(() => {
      if (!textures.every(settled)) return;
      stop();
      done();
    });
  });
}

/**
 * Sheets already built, keyed by the set of files in them.
 *
 * Held for the session, the same way `springTexture` holds the textures that
 * went into it, and for the same reason: a map draws hundreds of units and every
 * one of a game's `.3do` units draws out of the same `unittextures/tatex`
 * folder, so two units of a kind, or two kinds sharing their art, want the sheet
 * that is already on the GPU.
 *
 * A sheet costs what it covers a second time, uncompressed: Balanced
 * Annihilation's tiles are 8 to 128 pixels square and a unit's thirty-odd of
 * them pack into 512 by 512, which is 1 MiB on the GPU. The whole of that game's
 * `tatex` folder is 126 tiles and fits one 1024 square.
 */
const atlases = new Map<string, Promise<UnitTextureAtlas | null>>();

/**
 * Pack the textures this model names into one sheet, or nothing when there is no
 * gain in it (issue #2311).
 *
 * Asynchronous because the sheet is drawn out of the loaded images rather than
 * read from the archive: the textures arrive one file at a time through
 * `springTexture`, and there is nothing to pack until they have. The caller
 * waits before it builds, so that the model is drawn from the sheet the first
 * time rather than rebuilt underneath a map that has already cloned it.
 *
 * Nothing for an `.s3o`, which names one texture for the whole model and is
 * already down to one material. Nothing either for a model naming fewer than two
 * usable textures, where a sheet would be a copy of the one texture.
 */
export function prepareTextureAtlas(
  model: UnitModelResult,
): Promise<UnitTextureAtlas | null> {
  if (model.format !== "3do") return Promise.resolve(null);
  const files = [
    ...new Set(model.textures.map((t) => t.file).filter((f) => f)),
  ].sort();
  if (files.length < 2) return Promise.resolve(null);
  const key = files.join("\n");
  const known = atlases.get(key);
  if (known) return known;
  const building = buildTextureAtlas(files);
  atlases.set(key, building);
  return building;
}

/** Load every file, pack what arrived, and hand back the sheet. */
async function buildTextureAtlas(
  files: string[],
): Promise<UnitTextureAtlas | null> {
  const loaded = files.map(modelTexture);
  await whenSettled(loaded);

  // A texture the loader gave up on has no pixels to pack, so it keeps the
  // material it would have had and the rest of the model still gets a sheet.
  const packable: { file: string; source: AtlasSource }[] = [];
  loaded.forEach((texture, index) => {
    const image = texture.image as AtlasSource | undefined;
    if (springTextureFailed(texture) || !image?.width || !image.height) return;
    packable.push({ file: files[index], source: image });
  });
  if (packable.length < 2) return null;

  const layout = packTiles(
    packable.map((one) => ({ w: one.source.width, h: one.source.height })),
  );
  if (!layout) return null;

  const texture = new THREE.CanvasTexture(
    drawAtlas(
      packable.map((one) => one.source),
      layout,
    ),
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const place = new Map<string, AtlasPlace>();
  packable.forEach((one, index) => {
    place.set(
      one.file,
      atlasPlace(layout.rects[index], layout.width, layout.height),
    );
  });
  return { texture, place };
}

/**
 * The same meshes drawn as one per material instead of one per piece.
 *
 * Each piece's geometry is moved into the place the tree stands it in, then the
 * geometries sharing a material are joined. Two meshes drawn with different
 * textures cannot become one, so the materials are left exactly as they are and
 * the count of them is what is left.
 *
 * Nothing when the join fails, which leaves the caller with its piece tree. It
 * needs every geometry to carry the same attributes, and these all come from the
 * one builder above, so this is a guard rather than a case that happens.
 */
function mergedPieces(
  object: THREE.Group,
): { object: THREE.Group; geometries: THREE.BufferGeometry[] } | null {
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const parts: THREE.BufferGeometry[] = [];
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const moved = node.geometry.clone();
    moved.applyMatrix4(node.matrixWorld);
    parts.push(moved);
    const material = node.material as THREE.Material;
    const batch = batches.get(material);
    if (batch) batch.push(moved);
    else batches.set(material, [moved]);
  });

  const merged = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  for (const [material, batch] of batches) {
    const one = batch.length === 1 ? batch[0] : mergeGeometries(batch, false);
    if (!one) {
      for (const spent of geometries) spent.dispose();
      for (const spent of parts) spent.dispose();
      return null;
    }
    geometries.push(one);
    merged.add(new THREE.Mesh(one, material));
  }
  // The joined copies, not the ones the merge handed back.
  for (const spent of parts) {
    if (!geometries.includes(spent)) spent.dispose();
  }
  return { object: merged, geometries };
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
  options: BuildModelOptions = {},
): BuiltModel {
  const geometries: THREE.BufferGeometry[] = [];
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const atlas = options.atlas ?? null;

  /** Where the texture a group names sits in the sheet, if the sheet has it. */
  const placeFor = (name: string | undefined): AtlasPlace | undefined => {
    if (!atlas) return undefined;
    const file = model.textures.find((t) => t.name === name)?.file;
    return file ? atlas.place.get(file) : undefined;
  };

  // Under a key of its own rather than a texture's, because it stands for all of
  // them at once. It is disposed with the rest, while the sheet it draws from is
  // shared for the session and left alone, like every other texture here.
  const ATLAS_KEY = " atlas";

  const materialFor = (
    name: string | undefined,
  ): THREE.MeshStandardMaterial => {
    const key = placeFor(name) ? ATLAS_KEY : (name ?? "");
    const existing = materials.get(key);
    if (existing) return existing;
    if (key === ATLAS_KEY && atlas) {
      const sheet = new THREE.MeshStandardMaterial({
        map: atlas.texture,
        color: 0xffffff,
        roughness: 0.75,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      materials.set(key, sheet);
      return sheet;
    }
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
      const mask = model.texture2?.file;
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
      // Into the sheet when there is one, because the material draws from the
      // sheet and the group's own coordinates run across its own tile.
      const place = placeFor(group.texture);
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(
          place ? placeUvs(group.uvs, place) : group.uvs,
          2,
        ),
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
  // Taken from the tree, so a merged model is framed and plated on exactly the
  // extent the piece tree has.
  const box = new THREE.Box3().setFromObject(object);

  const drawn = options.merge ? mergedPieces(object) : null;
  if (drawn) {
    for (const g of geometries) g.dispose();
    return {
      object: drawn.object,
      box,
      dispose: () => {
        for (const g of drawn.geometries) g.dispose();
        for (const m of materials.values()) m.dispose();
      },
    };
  }

  return {
    object,
    box,
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
