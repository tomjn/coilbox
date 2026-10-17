import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { GuideLine, GuidePlane } from "../../guides";
import { buildGuides, disposeGuides, guideCentre } from "./guideLayer";

const plane: GuidePlane = {
  id: "g",
  name: "g",
  axis: "x",
  normal: [1, 0, 0],
  point: [12, 0, 0],
};

const line: GuideLine = {
  id: "l",
  name: "l",
  axis: "z",
  direction: [0, 0, 1],
  point: [3, 1, 0],
};

describe("buildGuides", () => {
  const around = new THREE.Box3(
    new THREE.Vector3(-2, 0, -2),
    new THREE.Vector3(2, 4, 2),
  );

  it("puts each square on its plane, level with the unit", () => {
    const group = buildGuides([plane], around, 1);

    expect(guideCentre(group, "g")).toEqual([12, 2, 0]);
  });

  it("faces the plane's normal", () => {
    const group = buildGuides([plane], around, 1);
    const plate = group.getObjectByName("guide-g") as THREE.Object3D;

    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(plate.quaternion);
    expect(facing.x).toBeCloseTo(1);
  });

  it("never takes a click meant for a piece", () => {
    const group = buildGuides([plane], around, 1);
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(20, 2, 0),
      new THREE.Vector3(-1, 0, 0),
    );
    group.updateMatrixWorld(true);

    expect(raycaster.intersectObject(group, true)).toEqual([]);
  });

  it("is a group of its own, so removing it removes every guide", () => {
    const scene = new THREE.Group();
    const group = buildGuides([plane], around, 1);
    scene.add(group);

    disposeGuides(group);

    expect(scene.children).toEqual([]);
  });

  it("draws a line along its direction through its point, level with the unit", () => {
    const group = buildGuides([], around, 1, [line]);
    const drawn = group.getObjectByName("guide-l") as THREE.LineSegments;
    drawn.updateMatrixWorld(true);
    const ends = drawn.geometry.getAttribute("position");
    const [a, b] = [0, 1].map((i) =>
      new THREE.Vector3()
        .fromBufferAttribute(ends, i)
        .applyMatrix4(drawn.matrixWorld),
    );

    expect(a.x).toBeCloseTo(3);
    expect(a.y).toBeCloseTo(1);
    expect(b.x).toBeCloseTo(3);
    expect(b.y).toBeCloseTo(1);
    expect(a.z).not.toBeCloseTo(b.z);
    expect((a.z + b.z) / 2).toBeCloseTo(0);
  });

  it("never takes a click meant for a piece, for a line either", () => {
    const group = buildGuides([], around, 1, [line]);
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(3, 1, 20),
      new THREE.Vector3(0, 0, -1),
    );
    raycaster.params.Line = { threshold: 5 };
    group.updateMatrixWorld(true);

    expect(raycaster.intersectObject(group, true)).toEqual([]);
  });
});
