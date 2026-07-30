/**
 * A unit as a binary glTF (`.glb`), for taking a build into Blender either to
 * check it against the `.s3o` or to finish it by hand.
 *
 * The scene mirrors the piece hierarchy one to one, a `THREE.Group` per piece
 * carrying the piece's baked offset and, when it has geometry, a mesh: the
 * same tree `buildS3o` writes, so `GLTFExporter`'s own node walk preserves it
 * rather than flattening it. Three.js and glTF share the s3o writer's
 * convention (right-handed, Y up, front faces winding counter-clockwise), so
 * nothing here negates an axis or reorders a face: the baked vertices that go
 * into the `.s3o` go into the `.glb` unchanged.
 *
 * `GLTFExporter` needs a DOM to rasterise the atlas into the binary
 * container, which is why this stays two functions: `buildGlbScene` is a
 * plain function over `Object3D` a test can inspect without one, and
 * `exportGlb` is the thin, untested async wrapper around the exporter
 * itself.
 */

import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { atlasUrl, type LegoAtlas } from "./atlas";
import { childrenOf, type LegoProject, pieceById } from "./model";
import type { LoadedPack } from "./pack";
import { type BakedPiece, bakedPieces } from "./s3oBuild";

/**
 * The baked piece tree as a `THREE.Object3D` graph, with no material
 * assigned. Pure and DOM-free, so it can be tested on its own.
 */
export function buildGlbScene(
  project: LegoProject,
  pack: LoadedPack,
): THREE.Group | null {
  if (!pieceById(project, project.rootPieceId)) return null;
  const { pieces } = bakedPieces(project, pack);

  const build = (pieceId: string): THREE.Group | null => {
    const baked = pieces.get(pieceId);
    if (!baked) return null;

    const node = new THREE.Group();
    node.name = baked.name;
    node.position.set(...baked.offset);

    if (baked.vertices.length > 0) {
      const mesh = new THREE.Mesh(bakedGeometry(baked));
      mesh.name = baked.name;
      node.add(mesh);
    }

    for (const child of childrenOf(project, pieceId)) {
      const childNode = build(child.id);
      if (childNode) node.add(childNode);
    }
    return node;
  };

  return build(project.rootPieceId);
}

function bakedGeometry(baked: BakedPiece): THREE.BufferGeometry {
  const positions = new Float32Array(baked.vertices.length * 3);
  const normals = new Float32Array(baked.vertices.length * 3);
  const uvs = new Float32Array(baked.vertices.length * 2);
  baked.vertices.forEach((vertex, i) => {
    positions.set(vertex.pos, i * 3);
    normals.set(vertex.normal, i * 3);
    uvs.set(vertex.uv, i * 2);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(
    new THREE.BufferAttribute(new Uint32Array(baked.indices), 1),
  );
  return geometry;
}

/**
 * The unit as a `.glb`'s bytes, with the unit's own atlas embedded.
 *
 * The atlas is passed in rather than read off the pack, because which one a
 * unit samples is the unit's own choice and this has to embed that one.
 *
 * Not unit tested: `GLTFExporter` needs a DOM to rasterise the texture, which
 * this reaches for the moment it runs and vitest cannot provide.
 */
export async function exportGlb(
  project: LegoProject,
  pack: LoadedPack,
  atlas: LegoAtlas,
): Promise<ArrayBuffer | null> {
  const scene = buildGlbScene(project, pack);
  if (!scene) return null;

  const texture = await new THREE.TextureLoader().loadAsync(atlasUrl(atlas));
  texture.colorSpace = THREE.SRGBColorSpace;
  // Some parts reach a neighbouring atlas column through negative u, same
  // reason partMaterial in geometry.ts repeats rather than clamps.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const material = new THREE.MeshStandardMaterial({ map: texture });

  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) object.material = material;
  });

  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  texture.dispose();
  material.dispose();

  if (!(result instanceof ArrayBuffer)) {
    throw new Error("GLTFExporter did not return binary glb data");
  }
  return result;
}
