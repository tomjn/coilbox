/**
 * A saved compound as a three.js object, for the tray to draw.
 *
 * Kept out of the picker component so a test can inspect the graph without a
 * canvas, the way `buildGlbScene` is kept out of the exporter. The pieces are
 * placed exactly as the viewport places them, mesh seating included, because a
 * preview that puts a part somewhere the builder would not is worse than no
 * preview at all.
 */

import * as THREE from "three";

import { type LegoProject, orderedPieces } from "./model";
import { seatPieceMesh } from "./pivot";

/**
 * One compound, ready to be dropped into a cell.
 *
 * The holder carries the cell's placement, and its child carries the compound
 * itself, shifted so the assembly's middle sits on the holder's origin. Two
 * objects rather than one, because the shift has to happen before the holder
 * scales and turns it. `fit` is how big the compound should end up, in the
 * units the cell is laid out in.
 *
 * The geometry arrives as a lookup rather than a pack, so this stays clear of
 * the loader and a test can hand it a shape of its own.
 */
export function buildCompoundHolder(
  compound: LegoProject,
  geometryFor: (partId: string) => THREE.BufferGeometry | null,
  material: THREE.Material,
  fit: number,
): THREE.Group {
  const holder = new THREE.Group();
  const centred = new THREE.Group();
  holder.add(centred);

  const groups = new Map<string, THREE.Group>();
  const assembly = new THREE.Group();
  centred.add(assembly);

  // Depth first from the root, then any piece the walk did not reach, which is
  // how a compound saved from a set carries its other roots. A piece's parent is
  // always in place first either way.
  for (const piece of orderedPieces(compound)) {
    const group = new THREE.Group();
    group.userData.pieceId = piece.id;
    group.position.set(...piece.position);
    group.rotation.set(...piece.rotation);
    group.scale.set(...piece.scale);
    const parent =
      piece.id === compound.rootPieceId
        ? assembly
        : (groups.get(piece.parentId as string) ?? assembly);
    parent.add(group);
    groups.set(piece.id, group);

    const geometry = piece.partId ? geometryFor(piece.partId) : null;
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    seatPieceMesh(mesh, piece.pivot);
    group.add(mesh);
  }

  // A compound of nothing but empty pieces has no size to fit, and dividing by
  // it would send the holder to infinity.
  const box = new THREE.Box3().setFromObject(assembly);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    holder.scale.setScalar(fit / Math.max(size.x, size.y, size.z, 0.001));
    centred.position.copy(centre).negate();
  }
  return holder;
}
