/**
 * Where a joined piece is drawn and baked (issue #3292).
 *
 * A piece joined to its parent follows the parent's connector, but keeps its
 * own size. Its position is written against the parent, so the parent's scale
 * still carries that position out to the scaled face. What the child does not
 * take from the parent is the scale: only the parent's turn goes into the
 * child's shape.
 *
 * Dropping the scale rather than compensating for it with its inverse is what
 * keeps the child's shape free of shear. An inverse scale is exact only when the
 * child is turned in quarter steps. A face of a part faces along an axis, so a
 * scale does not change which way a face points, and the child's face still
 * lies flat on the parent's.
 *
 * The scene and the bake both read this, so what is drawn is what is shipped.
 */

import * as THREE from "three";

/**
 * A joined piece's world matrix, from its parent's world matrix and its own
 * local one. A parent mirrored on one axis does not mirror the child: the
 * parent's scale, negative or not, is the part that is left out.
 */
export function joinedWorld(
  parentWorld: THREE.Matrix4,
  local: THREE.Matrix4,
): THREE.Matrix4 {
  const turn = new THREE.Quaternion();
  parentWorld.decompose(new THREE.Vector3(), turn, new THREE.Vector3());

  const at = new THREE.Vector3()
    .setFromMatrixPosition(local)
    .applyMatrix4(parentWorld);
  const world = new THREE.Matrix4()
    .makeRotationFromQuaternion(turn)
    .multiply(local);
  world.setPosition(at);
  return world;
}

/**
 * A piece's group in the scene. Joined, it is placed by `joinedWorld`. Not
 * joined, it behaves as any group does.
 */
export class JoinedGroup extends THREE.Group {
  private joinedToParent = false;

  get joined(): boolean {
    return this.joinedToParent;
  }

  set joined(value: boolean) {
    if (value === this.joinedToParent) return;
    this.joinedToParent = value;
    this.matrixWorldNeedsUpdate = true;
  }

  override updateMatrixWorld(force?: boolean): void {
    if (!this.joinedToParent || !this.parent) {
      super.updateMatrixWorld(force);
      return;
    }
    if (this.matrixAutoUpdate) this.updateMatrix();
    let propagate = force ?? false;
    if (this.matrixWorldNeedsUpdate || propagate) {
      if (this.matrixWorldAutoUpdate) {
        this.matrixWorld.copy(
          joinedWorld(this.parent.matrixWorld, this.matrix),
        );
      }
      this.matrixWorldNeedsUpdate = false;
      propagate = true;
    }
    for (const child of this.children) child.updateMatrixWorld(propagate);
  }
}
