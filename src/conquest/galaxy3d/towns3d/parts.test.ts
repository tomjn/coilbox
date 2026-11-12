import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { chamfered, column, rect, shouldered } from "./parts";

/** How many of a part's faces look away from `centre`, and how many it has. */
function facing(g: THREE.BufferGeometry, centre: THREE.Vector3) {
  const flat = g.toNonIndexed();
  const pos = flat.getAttribute("position");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let out = 0;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const middle = a.clone().add(b).add(c).divideScalar(3).sub(centre);
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.dot(middle) > 0) out++;
  }
  return { out, faces: pos.count / 3 };
}

describe("town building parts", () => {
  it("turns every face of a column outwards and leaves its foot open", () => {
    const g = column(chamfered(1, 0.6, 0.1), 0, 2);
    const { out, faces } = facing(g, new THREE.Vector3(0, 1, 0));
    // Eight sides of two triangles and a top of six.
    expect(faces).toBe(22);
    expect(out).toBe(faces);
    g.computeBoundingBox();
    expect(g.boundingBox?.min.y).toBe(0);
    expect(g.boundingBox?.max.y).toBe(2);
  });

  it("leans a column's sides in to a smaller head", () => {
    const g = column(rect(1, 1), 0, 1, rect(0.5, 0.5));
    const { out, faces } = facing(g, new THREE.Vector3(0, 0.5, 0));
    expect(out).toBe(faces);
  });

  it("closes a shouldered slab at both ends, along either axis", () => {
    for (const alongX of [false, true]) {
      const g = shouldered(1, 0, 2, 0.2, -0.3, 0.3, 0, alongX);
      const { out, faces } = facing(g, new THREE.Vector3(0, 1, 0));
      expect(faces).toBe(28);
      expect(out).toBe(faces);
      g.computeBoundingBox();
      const size = g.boundingBox?.getSize(new THREE.Vector3());
      expect(size?.x).toBeCloseTo(alongX ? 0.6 : 1, 6);
      expect(size?.z).toBeCloseTo(alongX ? 1 : 0.6, 6);
    }
  });
});
