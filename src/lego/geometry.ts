/**
 * Materials for drawing parts, one per texture in use.
 *
 * Every part shares one UV layout, so views drawing the same atlas can share
 * one material and put hundreds of meshes on screen without a material switch
 * between any of them. The cache is keyed by the atlas's resolved URL rather
 * than by the pack's id or version: the material's only real dependency is the
 * texture it samples. An id/version bump that ships the same atlas file should
 * reuse the material rather than reload the texture, and the id/version alone
 * cannot tell two different atlases apart. The URL is the narrowest thing that
 * is genuinely unique to what actually gets uploaded to the GPU, which is also
 * what lets two units on screen in different atlases each get their own.
 */

import * as THREE from "three";

import { atlasUrl, type LegoAtlas } from "./atlas";

interface CachedMaterial {
  material: THREE.MeshStandardMaterial;
  texture: THREE.Texture;
}

const materials = new Map<string, CachedMaterial>();

/** The cache key for an atlas's material: the texture it samples. */
export function materialCacheKey(atlas: LegoAtlas): string {
  return atlasUrl(atlas);
}

export function partMaterial(atlas: LegoAtlas): THREE.MeshStandardMaterial {
  const textureUrl = materialCacheKey(atlas);
  const cached = materials.get(textureUrl);
  if (cached) return cached.material;

  const texture = new THREE.TextureLoader().load(textureUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Some parts reach a neighbouring atlas column through negative u, so the
  // texture has to repeat. Clamping would smear those parts' edge pixels.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // The atlas is a dense sheet of small pieces. Without mipmaps a part shown
  // small shimmers, and anisotropy keeps it readable at a glancing angle.
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.75,
    metalness: 0.05,
  });
  materials.set(textureUrl, { material, texture });
  return material;
}

/** Lighting shared by the picker and the editor, so a part looks the same in both. */
export function addStandardLights(scene: THREE.Scene): void {
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 6);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
  fill.position.set(-5, 2, -4);
  scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.55));
}

/**
 * Free every cached material and its texture.
 *
 * No view calls this on its own teardown: the builder viewport, the parts
 * picker, the compound picker and a part's detail view can all be drawing at
 * once, sharing a material by this cache key, and disposing it under one
 * would blank the GPU resource the others are still using. The cache is
 * session-scoped, the same lifetime the loaded pack already has, so this is
 * for a full teardown of the session rather than per-view cleanup.
 */
export function disposeSharedMaterial(): void {
  for (const { material, texture } of materials.values()) {
    material.dispose();
    texture.dispose();
  }
  materials.clear();
}
