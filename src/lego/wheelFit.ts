/**
 * What the wheel presets need to know about the unit's wheels (#3352): how big
 * each one is, and which are in front.
 *
 * A wheel that rolls without slipping turns at the unit's speed over its
 * radius, so the radius has to come from the wheel. It is read off the shapes
 * at or under the wheel piece, with no pack needed: a cylinder, tube or cone
 * whose axle lies along x, which is the axis `wheels.roll` spins about
 * (`wheelAxle.ts` puts it there). The radius is half the shape's box across
 * the axle, times the scale the unit gives it. That is the corner of a
 * cylinder's polygon, so one with few sides rolls on a flat that sits a little
 * nearer the axle than this says. The biggest shape under the wheel is the one
 * on the ground, so it sets the radius.
 *
 * A wheel made from a part of the pack has no radius here. The preset spins it
 * at a fixed rate unless the game maker types a radius.
 */

import * as THREE from "three";

import { descendantIds, type LegoProject, pieceById } from "./model";
import { worldMatrix } from "./reparent";
import { cylinderAxle } from "./wheelAxle";

/** How close to along x an axle has to lie to count as the wheel's axle. */
const ON_X = 1 - 1e-4;

/**
 * A wheel's radius in elmos, or null when no shape at or under it is a round
 * shape with its axle along x. A mirror twin is measured by the lengths of its
 * axes, so its negative scale does not make it negative.
 */
export function wheelRadius(
  project: LegoProject,
  pieceName: string,
): number | null {
  const wheel = project.pieces.find((piece) => piece.name === pieceName);
  if (!wheel) return null;
  let radius = 0;
  for (const id of descendantIds(project, wheel.id)) {
    const piece = pieceById(project, id);
    const axle = piece ? cylinderAxle(piece) : null;
    if (!piece?.shape || axle === null) continue;
    const world = worldMatrix(project, id);
    const columns = [0, 1, 2].map((axis) =>
      new THREE.Vector3().setFromMatrixColumn(world, axis),
    );
    const along = columns[axle].clone().normalize();
    if (Math.abs(along.x) < ON_X) continue;
    for (const across of [0, 1, 2].filter((axis) => axis !== axle)) {
      radius = Math.max(
        radius,
        (piece.shape.size[across] * columns[across].length()) / 2,
      );
    }
  }
  return radius > 0 ? radius : null;
}

/**
 * The names of the wheels that steer: those ahead of the middle of the wheels
 * along z, the way a unit faces. Three axles steer the first and a single axle
 * steers none, since with every wheel on one line there is no front.
 *
 * Where a wheel is comes from its joint in the unit, so a wheel hung under a
 * moved or turned piece counts where it ends up.
 */
export function frontWheels(project: LegoProject): string[] {
  const wheels = project.pieces
    .filter((piece) => piece.role === "wheel")
    .map((piece) => ({
      name: piece.name,
      z: new THREE.Vector3().setFromMatrixPosition(
        worldMatrix(project, piece.id),
      ).z,
    }));
  if (wheels.length === 0) return [];
  const centre =
    (Math.min(...wheels.map((wheel) => wheel.z)) +
      Math.max(...wheels.map((wheel) => wheel.z))) /
    2;
  // A wheel counts as ahead only by more than the float noise of the sum.
  return wheels
    .filter((wheel) => wheel.z - centre > 1e-6)
    .map((wheel) => wheel.name);
}
