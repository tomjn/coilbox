/**
 * Pictures of units that are not open in the builder, for the generate
 * screen's candidates (#3234).
 *
 * `thumbnail.ts` borrows the builder's live scene, so it can only draw the unit
 * that is open. This draws any number of units through one renderer of its
 * own, from the same camera, so a candidate looks the way its thumbnail will
 * once it is opened. The renderer is let go as soon as the batch is drawn,
 * because a page can only hold a few WebGL contexts at once.
 */

import * as THREE from "three";

import { teamColourPending } from "../lib/springTexture";
import { addStandardLights } from "./geometry";
import type { LegoProject } from "./model";
import { getPartGeometry, type LoadedPack } from "./pack";
import { seatPieceMesh } from "./pivot";
import { worldMatrix } from "./reparent";
import { getShapeGeometry } from "./shapes";
import { THUMBNAIL_PIXELS, thumbnailCamera } from "./thumbnail";

/** Whether the material's texture and team colour have arrived. Drawn before
 *  then, every part is black. */
export function materialReady(material: THREE.MeshStandardMaterial): boolean {
  const image = material.map?.image as { width?: number } | undefined;
  return (
    (!material.map || Boolean(image?.width)) && !teamColourPending(material)
  );
}

/**
 * The unit's parts, each placed where the builder puts it. Placed from
 * `worldMatrix` rather than nested, because a joined piece takes its parent's
 * turn and place but not its scale, which a three.js tree cannot say.
 */
export function unitObject(
  unit: LegoProject,
  pack: LoadedPack,
  material: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  for (const piece of unit.pieces) {
    const geometry = piece.shape
      ? getShapeGeometry(piece.shape)
      : piece.partId
        ? getPartGeometry(pack, piece.partId)
        : null;
    if (!geometry) continue;
    const placed = new THREE.Group();
    placed.matrixAutoUpdate = false;
    placed.matrix.copy(worldMatrix(unit, piece.id));
    const mesh = new THREE.Mesh(geometry, material);
    seatPieceMesh(mesh, piece.pivot);
    placed.add(mesh);
    group.add(placed);
  }
  group.updateMatrixWorld(true);
  return group;
}

/**
 * One PNG data URL per unit, in order, each `pixels` square with a clear
 * background. Parts come from the pack and draw with `material`. A unit's own
 * meshes are not drawn: the generator only places pack parts and shapes.
 */
export function drawUnitPictures(
  units: readonly LegoProject[],
  pack: LoadedPack,
  material: THREE.Material,
  pixels: number = THUMBNAIL_PIXELS,
): string[] {
  if (units.length === 0) return [];
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(pixels, pixels, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    addStandardLights(scene);
    return units.map((unit) => {
      const holder = unitObject(unit, pack, material);
      scene.add(holder);
      renderer.render(scene, thumbnailCamera(holder));
      scene.remove(holder);
      // Read in the same task as the draw, before the buffer is discarded.
      return renderer.domElement.toDataURL("image/png");
    });
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
