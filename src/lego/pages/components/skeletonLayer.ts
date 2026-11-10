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
import { type LabelBox, shownLabels } from "./labelLayout";
import { labelPixelSize } from "./labelSize";
import type { SceneState } from "./sceneState";
import { label } from "./weaponReachLayer";

/** Fuchsia, apart from the orange collision box, the red aim point, the violet
 *  selection and the weapon ring colours. */
export const SKELETON_COLOUR = 0xe879f9;

/** How opaque each mark of the geometry skeleton is, against the 0.95 of a real
 *  skeleton's lines. The bone is brighter than the line to the parent, as in
 *  the widget. */
const DIMMED = { parent: 0.3, bone: 0.6, dot: 0.7 };

/** How far right of its marker a label starts, as a share of its width. */
const LABEL_OFFSET = 0.15;

/** A label that keeps its size on screen in either kind of camera. */
function skeletonLabel(text: string): THREE.Sprite {
  const sprite = label(text, "#f5d0fe");
  // To the right of the marker, not on it.
  sprite.center.set(-LABEL_OFFSET, 0.5);
  return sprite;
}

const AT = new THREE.Vector3();

/**
 * Hide each label that would cover a nearer one on screen, for the view
 * `camera` draws into a `width` by `height` CSS pixel canvas. The labels of
 * the pieces in `always`, the selection and the hovered piece, are shown
 * whatever they cover. A skeleton marked `labels: "hover"` shows only those.
 * Run before each render, since any camera move changes which labels collide.
 */
export function layoutSkeletonLabels(
  skeleton: THREE.Group,
  camera: THREE.Camera,
  { width, height }: { width: number; height: number },
  always: ReadonlySet<string>,
): void {
  skeleton.updateWorldMatrix(true, true);
  camera.updateMatrixWorld();
  const boxes: LabelBox[] = [];
  const sprites: THREE.Sprite[] = [];
  for (const child of skeleton.children) {
    if (!(child instanceof THREE.Sprite)) continue;
    sprites.push(child);
    AT.setFromMatrixPosition(child.matrixWorld).applyMatrix4(
      camera.matrixWorldInverse,
    );
    const depth = -AT.z;
    AT.applyMatrix4(camera.projectionMatrix);
    const size = labelPixelSize(child);
    boxes.push({
      id: child.userData.pieceId,
      left: ((AT.x + 1) / 2) * width + LABEL_OFFSET * size.width,
      top: ((1 - AT.y) / 2) * height - size.height / 2,
      width: size.width,
      height: size.height,
      depth,
      always: always.has(child.userData.pieceId),
    });
  }
  const shown =
    skeleton.userData.labels === "hover"
      ? new Set(boxes.filter((box) => box.always).map((box) => box.id))
      : shownLabels(boxes);
  for (const sprite of sprites) {
    sprite.visible = shown.has(sprite.userData.pieceId);
  }
}

/**
 * The drawing for `joints`, or null when there are none. `marker` is the
 * material for the joint dots, which the group owns from here and frees.
 *
 * With `dimmed`, as for the geometry skeleton of a unit with no skeleton, the
 * marks are fainter than a real skeleton's, a joint with a `reach` also gets a
 * bone, and a piece's name shows only while it is hovered or selected.
 */
export function buildSkeleton(
  joints: SkeletonJoint[],
  marker: THREE.PointsMaterial,
  { dimmed = false }: { dimmed?: boolean } = {},
): THREE.Group | null {
  if (joints.length === 0) return null;
  const group = new THREE.Group();
  group.userData.joints = joints.map(({ pieceId, parentId, reach }) => ({
    pieceId,
    parentId,
    reach: reach?.local ?? null,
  }));
  if (dimmed) group.userData.labels = "hover";

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
      opacity: dimmed ? DIMMED.parent : 0.95,
      depthTest: false,
    }),
  );
  bones.userData.role = "bones";
  bones.renderOrder = 4;
  bones.raycast = () => {};
  group.add(bones);

  if (dimmed) {
    const reaches = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          joints.flatMap(({ at, reach }) =>
            reach ? [...at, ...reach.at] : [],
          ),
          3,
        ),
      ),
      new THREE.LineBasicMaterial({
        color: SKELETON_COLOUR,
        transparent: true,
        opacity: DIMMED.bone,
        depthTest: false,
      }),
    );
    reaches.userData.role = "reach";
    reaches.renderOrder = 4;
    reaches.raycast = () => {};
    group.add(reaches);
    marker.opacity = DIMMED.dot;
  }

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
    reach: [number, number, number] | null;
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
  const reaches = skeleton.children.find((c) => c.userData.role === "reach") as
    | THREE.LineSegments
    | undefined;
  const lines = bones?.geometry.getAttribute("position");
  const reachLines = reaches?.geometry.getAttribute("position");
  const points = dots?.geometry.getAttribute("position");
  const labels = new Map<string, THREE.Object3D>();
  for (const child of skeleton.children) {
    if (child instanceof THREE.Sprite)
      labels.set(child.userData.pieceId, child);
  }

  let segment = 0;
  let reach = 0;
  joints.forEach((joint, index) => {
    // A reach has its slot whether or not its piece is found.
    const slot = joint.reach ? reach++ : -1;
    const at = originOf(joint.pieceId);
    if (!at) return;
    points?.setXYZ(index, ...at);
    labels.get(joint.pieceId)?.position.set(...at);
    const group = state.groups.get(joint.pieceId);
    if (joint.reach && group) {
      // The piece's own space is the group's while a script plays, since the
      // pieces are baked, so the bone's end turns with the piece.
      WORLD.set(...joint.reach)
        .applyMatrix4(group.matrixWorld)
        .applyMatrix4(ROOT_INVERSE);
      reachLines?.setXYZ(slot * 2, ...at);
      reachLines?.setXYZ(slot * 2 + 1, WORLD.x, WORLD.y, WORLD.z);
    }
    const parentAt = joint.parentId ? originOf(joint.parentId) : undefined;
    if (!joint.parentId) return;
    if (parentAt) {
      lines?.setXYZ(segment * 2, ...parentAt);
      lines?.setXYZ(segment * 2 + 1, ...at);
    }
    segment++;
  });
  if (lines) lines.needsUpdate = true;
  if (reachLines) reachLines.needsUpdate = true;
  if (points) points.needsUpdate = true;
  bones?.geometry.computeBoundingSphere();
  reaches?.geometry.computeBoundingSphere();
  dots?.geometry.computeBoundingSphere();
}
