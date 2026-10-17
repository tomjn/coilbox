import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { JoinedGroup, joinedWorld } from "./joinedWorld";

function matrix(
  position: [number, number, number],
  turnY: number,
  scale: [number, number, number],
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, turnY, 0)),
    new THREE.Vector3(...scale),
  );
}

function parts(m: THREE.Matrix4) {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(position, rotation, scale);
  return { position, rotation, scale };
}

describe("joinedWorld", () => {
  it("puts the child where the scaled parent's connector is, at the child's own size", () => {
    const parent = matrix([1, 0, 0], 0, [2, 3, 4]);
    const local = matrix([1, 1, 1], 0, [1, 1, 1]);
    const { position, scale } = parts(joinedWorld(parent, local));
    expect(position.toArray()).toEqual([3, 3, 4]);
    expect(scale.toArray()).toEqual([1, 1, 1]);
  });

  it("keeps a child's own scale, whatever the parent's", () => {
    const parent = matrix([0, 0, 0], 0, [2, 3, 4]);
    const local = matrix([0, 0, 0], 0, [1, 5, 1]);
    expect(parts(joinedWorld(parent, local)).scale.toArray()).toEqual([
      1, 5, 1,
    ]);
  });

  it("still turns with the parent, and does not shear in a turned, unevenly scaled parent", () => {
    const parent = matrix([0, 0, 0], Math.PI / 2, [2, 3, 4]);
    const local = matrix([0, 0, 0], Math.PI / 4, [1, 1, 1]);
    const world = joinedWorld(parent, local);
    const { rotation, scale } = parts(world);
    const expected = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.PI / 2 + Math.PI / 4, 0),
    );
    expect(Math.abs(rotation.dot(expected))).toBeCloseTo(1);
    expect(scale.x).toBeCloseTo(1);
    expect(scale.y).toBeCloseTo(1);
    expect(scale.z).toBeCloseTo(1);
  });

  it("does not mirror a child when its parent is mirrored", () => {
    const parent = matrix([0, 0, 0], 0, [-1, 1, 1]);
    const local = matrix([1, 0, 0], 0, [1, 1, 1]);
    const world = joinedWorld(parent, local);
    expect(world.determinant()).toBeGreaterThan(0);
    expect(new THREE.Vector3().setFromMatrixPosition(world).x).toBe(-1);
  });
});

describe("JoinedGroup", () => {
  function tree(joined: boolean) {
    const parent = new THREE.Group();
    parent.scale.set(2, 3, 4);
    const child = new JoinedGroup();
    child.joined = joined;
    child.position.set(1, 0, 0);
    parent.add(child);
    parent.updateMatrixWorld(true);
    return child;
  }

  it("draws a joined child at its own size under a scaled parent", () => {
    const child = tree(true);
    expect(parts(child.matrixWorld).scale.toArray()).toEqual([1, 1, 1]);
    expect(new THREE.Vector3().setFromMatrixPosition(child.matrixWorld).x).toBe(
      2,
    );
  });

  it("lets a child that is not joined inherit the scale, as before", () => {
    const child = tree(false);
    expect(parts(child.matrixWorld).scale.toArray()).toEqual([2, 3, 4]);
  });

  it("follows the parent when it is scaled again", () => {
    const child = tree(true);
    const parent = child.parent as THREE.Object3D;
    parent.scale.set(5, 1, 1);
    parent.updateMatrixWorld();
    expect(new THREE.Vector3().setFromMatrixPosition(child.matrixWorld).x).toBe(
      5,
    );
  });

  it("agrees with joinedWorld", () => {
    const child = tree(true);
    const expected = joinedWorld(
      (child.parent as THREE.Object3D).matrixWorld,
      child.matrix,
    );
    expect(child.matrixWorld.equals(expected)).toBe(true);
  });

  it("updates when it becomes joined", () => {
    const child = tree(false);
    child.joined = true;
    child.parent?.updateMatrixWorld();
    expect(parts(child.matrixWorld).scale.toArray()).toEqual([1, 1, 1]);
  });
});
