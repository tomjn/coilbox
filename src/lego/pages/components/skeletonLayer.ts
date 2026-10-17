/**
 * A unit's skeleton drawn in the viewport (issue #3247): a line from each bone
 * to the piece it hangs from, a marker on each bone's origin and its role as a
 * label.
 *
 * Drawn over everything, like the aim point, since empty pieces have no
 * geometry to be seen against and a bone inside a hull is still one to read.
 * Nothing in it can be picked, and it is never exported.
 */

import * as THREE from "three";
import type { SkeletonJoint } from "../../skeletonJoints";
import { label } from "./weaponReachLayer";

/** Fuchsia, apart from the orange collision box, the red aim point, the violet
 *  selection and the weapon ring colours. */
export const SKELETON_COLOUR = 0xe879f9;

/** A label's height as a share of the view's height, as in the weapon rings. */
const LABEL_SHARE = 0.035;
/**
 * The same share in an orthographic view. Sprites that hold a screen size only
 * do it in perspective: an orthographic camera has no depth to scale by, so
 * they would be 0.035 elmos tall at any zoom. This is `LABEL_SHARE` over the
 * height a perspective view of 40 degrees shows at distance 1, which is what
 * the weapon rings' labels measure against.
 */
const ORTHO_LABEL_SHARE = LABEL_SHARE / (2 * Math.tan((40 * Math.PI) / 360));

/** The height a label is drawn at for `camera`, in world units. */
export function labelHeight(camera: THREE.Camera): number {
  if (camera instanceof THREE.OrthographicCamera) {
    return (ORTHO_LABEL_SHARE * (camera.top - camera.bottom)) / camera.zoom;
  }
  return LABEL_SHARE;
}

/** A label that keeps its size on screen in either kind of camera. */
function skeletonLabel(text: string): THREE.Sprite {
  const sprite = label(text, "#f5d0fe");
  const aspect = sprite.scale.x / sprite.scale.y;
  // To the right of the marker, not on it.
  sprite.center.set(-0.15, 0.5);
  sprite.onBeforeRender = (_renderer, _scene, camera) => {
    const height = labelHeight(camera);
    sprite.scale.set(height * aspect, height, 1);
    // three reads the world matrix straight after this returns.
    sprite.updateMatrixWorld(true);
  };
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
  dots.renderOrder = 5;
  dots.raycast = () => {};
  group.add(dots);

  for (const joint of joints) {
    const tag = skeletonLabel(joint.label);
    tag.position.set(...joint.at);
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
