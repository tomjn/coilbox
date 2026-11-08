import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyAxisAngle,
  applyEuler,
  eulerFromMatrix,
  eulerFromQuaternion,
  quaternionFromEuler,
} from "./portableRotation";

const TURNS: [number, number, number][] = [
  [0, 0, 0],
  [0.3, -1.1, 2.2],
  [Math.PI / 2, 0, -0.72],
  [0, Math.PI / 2, 0],
  [-2.5, 0.4, 0.1],
  [Math.PI, -Math.PI / 2, Math.PI / 4],
  [-0.8274080365596058, 1.3, 0.05],
];

describe("quaternionFromEuler", () => {
  it("turns as three.js's Quaternion.setFromEuler does, to within rounding", () => {
    for (const turn of TURNS) {
      const theirs = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...turn),
      );
      const ours = quaternionFromEuler(turn);
      expect(ours.x).toBeCloseTo(theirs.x, 12);
      expect(ours.y).toBeCloseTo(theirs.y, 12);
      expect(ours.z).toBeCloseTo(theirs.z, 12);
      expect(ours.w).toBeCloseTo(theirs.w, 12);
    }
  });
});

describe("eulerFromMatrix and eulerFromQuaternion", () => {
  it("give the angles three.js's Euler gives, to within rounding", () => {
    for (const turn of TURNS) {
      const quaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...turn),
      );
      const matrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
      const theirs = new THREE.Euler().setFromRotationMatrix(matrix);
      for (const ours of [
        eulerFromMatrix(matrix),
        eulerFromQuaternion(quaternion),
      ]) {
        expect(ours[0]).toBeCloseTo(theirs.x, 9);
        expect(ours[1]).toBeCloseTo(theirs.y, 9);
        expect(ours[2]).toBeCloseTo(theirs.z, 9);
      }
    }
  });
});

describe("applyEuler and applyAxisAngle", () => {
  it("move a vector as three.js does, to within rounding", () => {
    const axis = new THREE.Vector3(0.2, -0.7, 0.4).normalize();
    for (const turn of TURNS) {
      const start = new THREE.Vector3(1.5, -2, 0.25);
      const euler = start.clone().applyEuler(new THREE.Euler(...turn));
      const ours = applyEuler(start.clone(), turn);
      expect(ours.distanceTo(euler)).toBeLessThan(1e-12);
      const about = start.clone().applyAxisAngle(axis, turn[0]);
      expect(
        applyAxisAngle(start.clone(), axis, turn[0]).distanceTo(about),
      ).toBeLessThan(1e-12);
    }
  });
});
