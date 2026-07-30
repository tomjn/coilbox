import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { hideChrome, THUMBNAIL_VIEW, thumbnailCamera } from "./thumbnail";

/** A unit, a light and a view aid, which is the shape of the builder's scene. */
function scene() {
  const built = new THREE.Scene();
  const unit = new THREE.Group();
  unit.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
  const light = new THREE.AmbientLight();
  const grid = new THREE.GridHelper();
  built.add(unit, light, grid);
  return { built, unit, light, grid };
}

describe("hideChrome", () => {
  it("leaves the unit and the lights, and takes everything else away", () => {
    const { built, unit, light, grid } = scene();

    hideChrome(built, unit, []);

    expect(unit.visible).toBe(true);
    expect(light.visible).toBe(true);
    expect(grid.visible).toBe(false);
  });

  it("reaches the highlights drawn on the pieces themselves", () => {
    const { built, unit } = scene();
    const wash = new THREE.Mesh(new THREE.BoxGeometry());
    unit.add(wash);

    hideChrome(built, unit, [wash, null]);

    expect(wash.visible).toBe(false);
  });

  it("takes the sky away and puts it back", () => {
    const { built, unit } = scene();
    const sky = new THREE.Color(0x112233);
    built.background = sky;

    const restore = hideChrome(built, unit, []);
    expect(built.background).toBeNull();

    restore();
    expect(built.background).toBe(sky);
  });

  it("puts the view back as it was, aid by aid", () => {
    const { built, unit, grid } = scene();
    const reference = new THREE.Group();
    reference.visible = false;
    built.add(reference);

    hideChrome(built, unit, [])();

    expect(grid.visible).toBe(true);
    // Off before the capture, so still off after it.
    expect(reference.visible).toBe(false);
  });
});

describe("thumbnailCamera", () => {
  it("looks at the middle of the unit from the fixed direction", () => {
    const { unit } = scene();
    unit.position.set(10, 0, -4);
    unit.updateMatrixWorld(true);

    const camera = thumbnailCamera(unit);
    const offset = camera.position
      .clone()
      .sub(new THREE.Vector3(10, 0, -4))
      .normalize();
    const direction = new THREE.Vector3(...THUMBNAIL_VIEW).normalize();

    expect(offset.x).toBeCloseTo(direction.x);
    expect(offset.y).toBeCloseTo(direction.y);
    expect(offset.z).toBeCloseTo(direction.z);
  });

  it("frames a unit the same wherever it stands", () => {
    const near = scene();
    const far = scene();
    far.unit.position.set(30, 0, 30);
    far.unit.updateMatrixWorld(true);

    expect(
      thumbnailCamera(far.unit).position.distanceTo(far.unit.position),
    ).toBeCloseTo(
      thumbnailCamera(near.unit).position.distanceTo(near.unit.position),
    );
  });

  it("pulls back further for a bigger unit", () => {
    const small = scene();
    const large = scene();
    large.unit.scale.setScalar(6);
    large.unit.updateMatrixWorld(true);

    expect(thumbnailCamera(large.unit).position.length()).toBeGreaterThan(
      thumbnailCamera(small.unit).position.length(),
    );
  });

  it("still points somewhere for a unit with nothing in it", () => {
    const camera = thumbnailCamera(new THREE.Group());

    expect(camera.position.toArray()).toEqual(THUMBNAIL_VIEW);
    expect(camera.position.length()).toBeGreaterThan(0);
  });
});
