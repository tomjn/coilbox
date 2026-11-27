/**
 * The flat map's projectiles and wrecks, on the replay's 3D terrain.
 *
 * Each is drawn as the flat map draws it, at the same size on screen: a wreck
 * is a small grey square, and a projectile a pale line back along the way it
 * is moving. The track has no height for either, so both stand on the ground,
 * as the units do.
 */

import * as THREE from "three";

import { HALF_WRECK, SHOT, SHOT_LONGEST, SHOT_SHORTEST, WRECK } from "./paint";

export const WRECKS_NAME = "replay-wrecks";
export const SHOTS_NAME = "replay-projectiles";

/** The red, green and blue of a CSS `rgba(...)` as 0 to 1 sRGB, held as is
 *  with no conversion, and its alpha. */
export function rgbaOf(css: string): { rgb: THREE.Color; alpha: number } {
  const parts = css.match(/[\d.]+/g)?.map(Number) ?? [];
  const [r = 0, g = 0, b = 0, a = 1] = parts;
  return { rgb: new THREE.Color(r / 255, g / 255, b / 255), alpha: a };
}

/** Points that grow their buffers as a frame needs more. */
interface Buffers {
  geometry: THREE.BufferGeometry;
  capacity: number;
  arrays: Record<string, Float32Array>;
}

function grow(
  buffers: Buffers,
  owner: THREE.Points | THREE.LineSegments,
  count: number,
  sizes: Record<string, number>,
): void {
  if (count <= buffers.capacity) return;
  buffers.capacity = Math.max(count, buffers.capacity * 2, 64);
  buffers.geometry.dispose();
  buffers.geometry = new THREE.BufferGeometry();
  for (const [name, size] of Object.entries(sizes)) {
    const array = new Float32Array(buffers.capacity * size);
    buffers.arrays[name] = array;
    buffers.geometry.setAttribute(
      name,
      new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
    );
  }
  owner.geometry = buffers.geometry;
}

function show(buffers: Buffers, count: number): void {
  for (const attribute of Object.values(buffers.geometry.attributes)) {
    attribute.needsUpdate = true;
  }
  buffers.geometry.setDrawRange(0, count);
}

export interface WreckLayer {
  points: THREE.Points;
  /** Room for `count` wrecks, and the array to write their `x, y, z` into. */
  reserve(count: number): Float32Array;
  show(count: number): void;
  dispose(): void;
}

export function createWrecks(): WreckLayer {
  const { rgb, alpha } = rgbaOf(WRECK);
  const material = new THREE.PointsMaterial({
    // PointsMaterial takes its colour as linear and converts it for the screen.
    color: new THREE.Color().setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace),
    opacity: alpha,
    size: HALF_WRECK * 2,
    sizeAttenuation: false,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const buffers: Buffers = {
    geometry: new THREE.BufferGeometry(),
    capacity: -1,
    arrays: {},
  };
  const points = new THREE.Points(buffers.geometry, material);
  points.name = WRECKS_NAME;
  // Under the circles and the units, as on the flat map.
  points.renderOrder = 0;
  points.frustumCulled = false;
  return {
    points,
    reserve(count) {
      grow(buffers, points, count, { position: 3 });
      return buffers.arrays.position;
    },
    show: (count) => show(buffers, count),
    dispose() {
      points.removeFromParent();
      buffers.geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * A line from the head, back along the projectile's travel over
 * `SHOT_FRAMES` frames as the camera sees it, kept between the flat map's
 * shortest and longest in screen pixels. Both ends of a line carry the head
 * and the point it was at `SHOT_FRAMES` frames ago. `end` is 0 at the head and
 * 1 at the tail, which the shader moves to the line's length.
 */
const SHOT_VERTEX = /* glsl */ `
attribute vec3 back;
attribute float end;
uniform vec2 viewSize;
uniform float shortest;
uniform float longest;
void main() {
  vec4 head = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  if (end < 0.5) {
    gl_Position = head;
    return;
  }
  vec4 from = projectionMatrix * modelViewMatrix * vec4(back, 1.0);
  vec2 h = head.xy / head.w * 0.5 * viewSize;
  vec2 b = from.xy / from.w * 0.5 * viewSize;
  vec2 d = b - h;
  float travel = length(d);
  // One falling straight down has no direction on the screen, and is drawn
  // as the shortest line across, as on the flat map.
  vec2 dir = travel < 1e-3 ? vec2(-1.0, 0.0) : d / travel;
  vec2 tail = h + dir * clamp(travel, shortest, longest);
  gl_Position = vec4(tail / (0.5 * viewSize) * head.w, head.z, head.w);
}
`;

const SHOT_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float opacity;
void main() {
  gl_FragColor = vec4(color, opacity);
}
`;

export interface ShotLayer {
  lines: THREE.LineSegments;
  /** Room for `count` projectiles, and the arrays to write them into: two
   *  vertices a projectile, each holding the head in `position` and where it
   *  was `SHOT_FRAMES` frames ago in `back`. */
  reserve(count: number): { position: Float32Array; back: Float32Array };
  show(count: number): void;
  dispose(): void;
}

export function createShots(): ShotLayer {
  const { rgb, alpha } = rgbaOf(SHOT);
  const material = new THREE.ShaderMaterial({
    vertexShader: SHOT_VERTEX,
    fragmentShader: SHOT_FRAGMENT,
    uniforms: {
      // Written as is, so given in sRGB.
      color: { value: rgb },
      opacity: { value: alpha },
      viewSize: { value: new THREE.Vector2(1, 1) },
      shortest: { value: SHOT_SHORTEST },
      longest: { value: SHOT_LONGEST },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const buffers: Buffers = {
    geometry: new THREE.BufferGeometry(),
    capacity: -1,
    arrays: {},
  };
  const lines = new THREE.LineSegments(buffers.geometry, material);
  lines.name = SHOTS_NAME;
  lines.renderOrder = 3;
  lines.frustumCulled = false;
  const size = new THREE.Vector2();
  lines.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(size);
    material.uniforms.viewSize.value.copy(size);
    const ratio = renderer.getPixelRatio();
    material.uniforms.shortest.value = SHOT_SHORTEST * ratio;
    material.uniforms.longest.value = SHOT_LONGEST * ratio;
  };
  return {
    lines,
    reserve(count) {
      const before = buffers.capacity;
      grow(buffers, lines, count * 2, { position: 3, back: 3, end: 1 });
      if (buffers.capacity !== before) {
        const end = buffers.arrays.end;
        for (let i = 0; i < end.length; i++) end[i] = i % 2;
      }
      return { position: buffers.arrays.position, back: buffers.arrays.back };
    },
    show: (count) => show(buffers, count * 2),
    dispose() {
      lines.removeFromParent();
      buffers.geometry.dispose();
      material.dispose();
    },
  };
}
