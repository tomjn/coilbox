/**
 * The one material every part in the app is drawn with.
 *
 * Every part samples the same atlas, so a single shared material means the
 * picker and the editor can put hundreds of meshes on screen without a material
 * switch between any of them.
 */

import * as THREE from "three";

import { legoPackUrl } from "../lib/assetUrl";
import type { LegoPackManifest } from "./pack";

let material: THREE.MeshStandardMaterial | null = null;
let atlas: THREE.Texture | null = null;

export function partMaterial(
  manifest: LegoPackManifest,
): THREE.MeshStandardMaterial {
  if (material) return material;

  atlas = new THREE.TextureLoader().load(legoPackUrl(manifest.textures.tex1));
  atlas.colorSpace = THREE.SRGBColorSpace;
  // Some parts reach a neighbouring atlas column through negative u, so the
  // texture has to repeat. Clamping would smear those parts' edge pixels.
  atlas.wrapS = THREE.RepeatWrapping;
  atlas.wrapT = THREE.RepeatWrapping;
  // The atlas is a dense sheet of small pieces. Without mipmaps a part shown
  // small shimmers, and anisotropy keeps it readable at a glancing angle.
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.anisotropy = 4;

  material = new THREE.MeshStandardMaterial({
    map: atlas,
    roughness: 0.75,
    metalness: 0.05,
  });
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

export function disposeSharedMaterial(): void {
  material?.dispose();
  atlas?.dispose();
  material = null;
  atlas = null;
}
