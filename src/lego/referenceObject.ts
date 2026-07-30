/**
 * A real unit to judge scale against, toggled from the viewport.
 *
 * The unit is Beyond All Reason's Armada solar collector, by Cremuss, under
 * CC BY-SA 4.0. Anyone who plays a Spring or Recoil game has built hundreds of
 * these, so "my unit is half the height of a solar" means something, where a
 * figure invented for the purpose means nothing.
 *
 * Its geometry is committed as `reference/armsolar.json`, converted from the
 * game's `armsolar.s3o` once by `scripts/reference-model.mjs`. Nothing is read
 * out of an installed game at runtime: coilbox cannot rely on any particular
 * game being installed, and a reference that appears only for some users would
 * be worse than none. See `reference/LICENCE.txt` for the attribution, the
 * licence and what the conversion changed.
 *
 * Sizes are in elmos with nothing rescaled in between: the exporter's
 * `header()` in `s3oBuild.ts` bakes each vertex's world position straight into
 * the s3o header, so a shape sized in Three.js world units here is sized in
 * elmos there too. That is what lets a model lifted out of a game sit in this
 * scene at the size the engine draws it.
 *
 * Two measurements, because a building has two:
 *
 * - The model, 42.98 elmos across and 29.12 tall, measured from the vertices in
 *   `armsolar.s3o` itself. Its header claims a height of 43 and a radius of 40,
 *   which are authored numbers rather than measured ones, so they are ignored.
 * - The footprint, 5 by 5 steps, read from `footprintx` and `footprintz` in the
 *   unit's own `armsolar.lua`. That is the ground the engine reserves, and it is
 *   nearly twice the model's width: real buildings do not fill their footprint.
 *   `buildPlate.ts` draws it as the largest plate under the unit being built,
 *   rather than drawing it twice.
 */

import * as THREE from "three";

import model from "./reference/armsolar.json";

/** Sky blue, distinct from every colourway in the bundled parts pack. */
const REFERENCE_COLOUR = 0x0ea5e9;
/** Ghostly on purpose: it is a backdrop for judging size against, and nothing
 *  in the scene that can be clicked looks like this. */
const REFERENCE_OPACITY = 0.35;

/** The reference unit's footprint, in steps, as its unitdef states it.
 *  `buildPlate.ts` draws a plate this size under the unit being built. */
export const REFERENCE_FOOTPRINT_STEPS = model.footprintSteps;

/** How wide the model itself is, in elmos, measured off the geometry rather
 *  than declared, so nothing can drift out of step with the asset. */
export const REFERENCE_WIDTH_ELMOS = widthElmos();

function widthElmos(): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < model.positions.length; i += 3) {
    min = Math.min(min, model.positions[i]);
    max = Math.max(max, model.positions[i]);
  }
  return max - min;
}

/**
 * The reference unit, in its own local space with the unit standing on y = 0,
 * as it does in game.
 *
 * Purely a visual aid. It never carries a piece, and is never selected,
 * hovered, baked or exported. The viewport positions and toggles it. This only
 * builds the shape.
 */
export function buildReferenceUnit(): THREE.Group {
  const group = new THREE.Group();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(model.positions, 3),
  );
  // The model's own vertex normals, not recomputed ones: they are what the
  // engine shades it with.
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(model.normals, 3),
  );
  geometry.setIndex(model.indices);

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: REFERENCE_COLOUR,
      roughness: 0.6,
      transparent: true,
      opacity: REFERENCE_OPACITY,
      // Without this the object sorts against itself and reads as a solid with
      // holes in it rather than as a ghost. Thirteen of the model's 370
      // triangles wind against their own normals, so both sides are drawn.
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.raycast = () => {};

  group.add(mesh);
  return group;
}

/** Frees the geometry and materials `buildReferenceUnit` allocated. */
export function disposeReferenceUnit(group: THREE.Group): void {
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    child.geometry.dispose();
    (child.material as THREE.Material).dispose();
  }
}
