// @vitest-environment happy-dom

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SkeletonJoint } from "../../skeletonJoints";
import {
  buildSkeleton,
  disposeSkeleton,
  layoutSkeletonLabels,
  SKELETON_COLOUR,
} from "./skeletonLayer";

const joints: SkeletonJoint[] = [
  {
    pieceId: "a",
    label: "Body",
    at: [0, 10, 0],
    parentAt: null,
    parentId: null,
  },
  {
    pieceId: "b",
    label: "Front left thigh",
    at: [3, 8, 1],
    parentAt: [0, 10, 0],
    parentId: "a",
  },
  {
    pieceId: "c",
    label: "tag",
    at: [3, 3, 1],
    parentAt: [3, 8, 1],
    parentId: "b",
  },
];

function build(): THREE.Group {
  return buildSkeleton(
    joints,
    new THREE.PointsMaterial({ depthTest: false }),
  ) as THREE.Group;
}

describe("buildSkeleton", () => {
  it("draws a line to each parent, a marker on each joint and a label on each", () => {
    const group = build();
    const lines = group.children.find(
      (c) => c instanceof THREE.LineSegments,
    ) as THREE.LineSegments;
    const points = group.children.find(
      (c) => c instanceof THREE.Points,
    ) as THREE.Points;

    // Two bones have a parent, and a segment is two points.
    expect(lines.geometry.getAttribute("position").count).toBe(4);
    expect(Array.from(lines.geometry.getAttribute("position").array)).toEqual([
      0, 10, 0, 3, 8, 1, 3, 8, 1, 3, 3, 1,
    ]);
    expect(points.geometry.getAttribute("position").count).toBe(3);
    expect(
      group.children.filter((c) => c instanceof THREE.Sprite),
    ).toHaveLength(3);
    disposeSkeleton(group);
  });

  it("draws over the model and can never be picked", () => {
    const group = build();
    const drawn = group.children as THREE.Object3D[];

    for (const object of drawn) {
      const material = (object as THREE.Mesh).material as THREE.Material;
      expect(material.depthTest).toBe(false);
      const hits: THREE.Intersection[] = [];
      object.raycast(new THREE.Raycaster(), hits);
      expect(hits).toEqual([]);
    }
    disposeSkeleton(group);
  });

  it("draws nothing for a unit with no joints", () => {
    expect(buildSkeleton([], new THREE.PointsMaterial())).toBeNull();
  });

  it("frees its geometry, materials and label textures", () => {
    const group = build();
    const disposed: string[] = [];
    const watch = (
      name: string,
      target: THREE.EventDispatcher<{ dispose: object }>,
    ) => target.addEventListener("dispose", () => disposed.push(name));
    group.traverse((object) => {
      if (object instanceof THREE.Sprite) {
        const material = object.material as THREE.SpriteMaterial;
        watch("sprite", material);
        if (material.map) watch("texture", material.map);
      } else if (object instanceof THREE.Points) {
        watch("marker", object.material as THREE.Material);
        watch("points", object.geometry);
      } else if (object instanceof THREE.LineSegments) {
        watch("lines", object.geometry);
        watch("line material", object.material as THREE.Material);
      }
    });

    disposeSkeleton(group);

    expect(disposed).toEqual(
      expect.arrayContaining([
        "sprite",
        "marker",
        "points",
        "lines",
        "line material",
      ]),
    );
    expect(group.parent).toBeNull();
  });

  it("hides a label that would cover a nearer one, but never the selected or hovered", () => {
    const stacked: SkeletonJoint[] = [
      {
        pieceId: "near",
        label: "Near",
        at: [0, 0, 5],
        parentAt: null,
        parentId: null,
      },
      {
        pieceId: "far",
        label: "Far",
        at: [0, 0, 0],
        parentAt: null,
        parentId: null,
      },
      {
        pieceId: "apart",
        label: "Apart",
        at: [0, 8, 0],
        parentAt: null,
        parentId: null,
      },
    ];
    const group = buildSkeleton(
      stacked,
      new THREE.PointsMaterial(),
    ) as THREE.Group;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
    camera.position.set(0, 0, 40);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    const visible = () =>
      group.children
        .filter((c) => c instanceof THREE.Sprite && c.visible)
        .map((c) => c.userData.pieceId)
        .sort();
    const size = { width: 800, height: 600 };

    layoutSkeletonLabels(group, camera, size, new Set());
    expect(visible()).toEqual(["apart", "near"]);

    layoutSkeletonLabels(group, camera, size, new Set(["far"]));
    expect(visible()).toEqual(["apart", "far"]);
    disposeSkeleton(group);
  });

  it("uses the colour the legend names", () => {
    const group = build();
    const lines = group.children.find(
      (c) => c instanceof THREE.LineSegments,
    ) as THREE.LineSegments;

    expect((lines.material as THREE.LineBasicMaterial).color.getHex()).toBe(
      SKELETON_COLOUR,
    );
    disposeSkeleton(group);
  });
});
