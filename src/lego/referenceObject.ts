/**
 * A reference figure for judging scale against, toggled from the viewport.
 *
 * Built from primitives rather than loaded from a game archive. Reading a
 * real unit's model out of an installed game turns out to be much bigger work
 * than it looks: `coilbox_s3o::read` exists but is called by nothing in the
 * app (issue #581's design doc), and most installed games ship `.3do`, a
 * format nothing in coilbox reads. A wrong-scale reference would be worse
 * than none, so this sticks to what can be sized with confidence.
 *
 * The builder's world units are elmos with nothing rescaled in between: the
 * exporter's `header()` in `s3oBuild.ts` bakes each vertex's world position
 * straight into the s3o header, and that has been checked against a shipped
 * model (`ammobox2.s3o`'s header radius matches its furthest vertex from its
 * own `mid` exactly). So a shape sized in Three.js world units here is sized
 * in elmos there too, with no conversion to get wrong.
 *
 * There is no fixed elmo-to-metre conversion in the engine. It is
 * deliberately scale-free, and different Spring-derived games use different
 * real-world scales for the same elmo count, so a "human height in elmos"
 * would be a guess dressed up as a measurement. What this codebase already
 * treats as ground truth is `ELMOS_PER_FOOTPRINT` (`unitDef.ts`), sourced to
 * the engine's own `SQUARE_SIZE` and `SPRING_FOOTPRINT_SCALE`: the smallest
 * area a unit is allowed to occupy. This figure is pegged to that instead: it
 * stands exactly one footprint step tall, on a tile of the same footprint.
 */

import * as THREE from "three";

import { ELMOS_PER_FOOTPRINT } from "./unitDef";

/** Amber, distinct from every colourway in the bundled parts pack. */
const FIGURE_COLOUR = 0x0ea5e9;
const TILE_COLOUR = 0x334155;
const TILE_THICKNESS = 0.15;

/** The figure's total height, and its tile's width and depth, in elmos: one
 *  footprint step, the same number `unitDef.ts` uses to size an exported
 *  unit's footprint. Exported so the test checks the built shape against the
 *  same source of truth rather than a copy of it. */
export const REFERENCE_HEIGHT_ELMOS = ELMOS_PER_FOOTPRINT;

/**
 * A blocky standing figure on a footprint-sized tile, sized in elmos.
 *
 * Purely a visual aid, in its own local space with its base at y = 0. It
 * never carries a piece, and is never selected, hovered, baked or exported.
 * The viewport positions and toggles it. This only builds the shape.
 */
export function buildReferenceFigure(): THREE.Group {
  const group = new THREE.Group();

  const tile = new THREE.Mesh(
    new THREE.BoxGeometry(
      REFERENCE_HEIGHT_ELMOS,
      TILE_THICKNESS,
      REFERENCE_HEIGHT_ELMOS,
    ),
    new THREE.MeshStandardMaterial({ color: TILE_COLOUR, roughness: 0.9 }),
  );
  tile.position.y = TILE_THICKNESS / 2;
  tile.raycast = () => {};

  // Legs and head sum to the full height: the tile is a thin footprint
  // marker embedded at the base rather than added on top of it.
  const bodyHeight = REFERENCE_HEIGHT_ELMOS * 0.82;
  const headRadius = REFERENCE_HEIGHT_ELMOS * 0.09;
  const bodyRadius = REFERENCE_HEIGHT_ELMOS * 0.09;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(bodyRadius, bodyRadius * 1.2, bodyHeight, 12),
    new THREE.MeshStandardMaterial({ color: FIGURE_COLOUR, roughness: 0.6 }),
  );
  body.position.y = bodyHeight / 2;
  body.raycast = () => {};

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 16, 12),
    new THREE.MeshStandardMaterial({ color: FIGURE_COLOUR, roughness: 0.6 }),
  );
  head.position.y = bodyHeight + headRadius;
  head.raycast = () => {};

  group.add(tile, body, head);
  return group;
}

/** Frees the geometry and materials `buildReferenceFigure` allocated. */
export function disposeReferenceFigure(group: THREE.Group): void {
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    child.geometry.dispose();
    (child.material as THREE.Material).dispose();
  }
}
