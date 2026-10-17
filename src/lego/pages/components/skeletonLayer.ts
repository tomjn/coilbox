/**
 * A unit's skeleton drawn in the viewport (issue #3247): a line from each bone
 * to the piece it hangs from, a marker on each bone's origin and its role as a
 * label.
 *
 * Drawn over everything, like the aim point, since empty pieces have no
 * geometry to be seen against and a bone inside a hull is still one to read.
 * Nothing in it can be picked, and it is never exported.
 *
 * It is built at the rest pose. While a script poses the pieces, `poseSkeleton`
 * moves it onto them, so a skeleton with no parts on it still shows the motion.
 */

import * as THREE from "three";
import type { SkeletonJoint } from "../../skeletonJoints";
import type { SceneState } from "./sceneState";
import { label } from "./weaponReachLayer";

/** Fuchsia, apart from the orange collision box, the red aim point, the violet
 *  selection and the weapon ring colours. */
export const SKELETON_COLOUR = 0xe879f9;

/** A label that keeps its size on screen in either kind of camera. */
function skeletonLabel(text: string): THREE.Sprite {
  const sprite = label(text, "#f5d0fe");
  // To the right of the marker, not on it.
  sprite.center.set(-0.15, 0.5);
  return sprite;
}

/**
 * The drawing for `joints`, or null when there are none. `marker` is the
 * material for the joint dots, which the group owns from here and frees.
 */
export function buildSkeleton(
  joints: SkeletonJoint[],
  marker: THREE.PointsMaterial,
): THREE.Group | null {
  if (joints.length === 0) return null;
  const group = new THREE.Group();
  group.userData.joints = joints.map(({ pieceId, parentId }) => ({
    pieceId,
    parentId,
  }));

  const segments: number[] = [];
  for (const joint of joints) {
    if (joint.parentAt) segments.push(...joint.parentAt, ...joint.at);
  }
  const bones = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(segments, 3),
    ),
    new THREE.LineBasicMaterial({
      color: SKELETON_COLOUR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    }),
  );
  bones.userData.role = "bones";
  bones.renderOrder = 4;
  bones.raycast = () => {};
  group.add(bones);

  const dots = new THREE.Points(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        joints.flatMap((joint) => joint.at),
        3,
      ),
    ),
    marker,
  );
  dots.userData.role = "dots";
  dots.renderOrder = 5;
  dots.raycast = () => {};
  group.add(dots);

  for (const joint of joints) {
    const tag = skeletonLabel(joint.label);
    tag.position.set(...joint.at);
    tag.userData.pieceId = joint.pieceId;
    group.add(tag);
  }
  return group;
}

/** Free what `buildSkeleton` made. A sprite's geometry is shared by three.js
 *  between every sprite, so it is left alone. */
export function disposeSkeleton(group: THREE.Group): void {
  group.traverse((object) => {
    if (
      object instanceof THREE.LineSegments ||
      object instanceof THREE.Points ||
      object instanceof THREE.Sprite
    ) {
      if (!(object instanceof THREE.Sprite)) object.geometry.dispose();
      const material = object.material as THREE.Material & {
        map?: THREE.Texture | null;
      };
      material.map?.dispose();
      material.dispose();
    }
  });
  group.removeFromParent();
}

const ROOT_INVERSE = new THREE.Matrix4();
const WORLD = new THREE.Vector3();

/**
 * Put the skeleton on the pieces where a script has them now. Each joint is its
 * piece's origin and each bone runs from there to the origin of the piece it
 * hangs from, measured in the root's space because the overlay follows the root.
 * Pieces are read from their groups whether or not they carry a part.
 */
export function poseSkeleton(
  state: Pick<SceneState, "root" | "groups" | "skeleton">,
): void {
  const skeleton = state.skeleton;
  if (!skeleton) return;
  const joints = skeleton.userData.joints as {
    pieceId: string;
    parentId: string | null;
  }[];
  state.root.updateMatrixWorld(true);
  ROOT_INVERSE.copy(state.root.matrixWorld).invert();

  const origins = new Map<string, [number, number, number]>();
  const originOf = (pieceId: string) => {
    const known = origins.get(pieceId);
    if (known) return known;
    const group = state.groups.get(pieceId);
    if (!group) return undefined;
    WORLD.setFromMatrixPosition(group.matrixWorld).applyMatrix4(ROOT_INVERSE);
    const at: [number, number, number] = [WORLD.x, WORLD.y, WORLD.z];
    origins.set(pieceId, at);
    return at;
  };

  const bones = skeleton.children.find((c) => c.userData.role === "bones") as
    | THREE.LineSegments
    | undefined;
  const dots = skeleton.children.find((c) => c.userData.role === "dots") as
    | THREE.Points
    | undefined;
  const lines = bones?.geometry.getAttribute("position");
  const points = dots?.geometry.getAttribute("position");
  const labels = new Map<string, THREE.Object3D>();
  for (const child of skeleton.children) {
    if (child instanceof THREE.Sprite)
      labels.set(child.userData.pieceId, child);
  }

  let segment = 0;
  joints.forEach((joint, index) => {
    const at = originOf(joint.pieceId);
    if (!at) return;
    points?.setXYZ(index, ...at);
    labels.get(joint.pieceId)?.position.set(...at);
    const parentAt = joint.parentId ? originOf(joint.parentId) : undefined;
    if (!joint.parentId) return;
    if (parentAt) {
      lines?.setXYZ(segment * 2, ...parentAt);
      lines?.setXYZ(segment * 2 + 1, ...at);
    }
    segment++;
  });
  if (lines) lines.needsUpdate = true;
  if (points) points.needsUpdate = true;
  bones?.geometry.computeBoundingSphere();
  dots?.geometry.computeBoundingSphere();
}
