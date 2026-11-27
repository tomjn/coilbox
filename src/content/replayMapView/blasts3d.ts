/**
 * A yellow circle where each unit died or shot landed, on the replay's 3D
 * terrain, growing and fading as the flat map's does (#5317). Its size and fade
 * come from the flat map's constants, so the two views read the same.
 *
 * A circle's full size is in elmos, so it shrinks with distance like the
 * terrain, but is never smaller on screen than the flat map's least size. Each
 * circle carries its own progress, which the shader turns into its size and
 * opacity, so one `THREE.Points` draws every circle of one kind.
 */

import * as THREE from "three";

import {
  BLAST_FILL,
  BLAST_OPACITY,
  BLAST_START,
  DEATH_BLAST_ELMOS,
  DEATH_BLAST_LEAST,
  SHOT_BLAST_ELMOS,
  SHOT_BLAST_LEAST,
} from "./paint";

/** One kind of circle: what it hangs off in the scene, its full radius in
 *  elmos and the least that radius is on screen, in CSS pixels. */
export interface BlastKind {
  name: string;
  fullElmos: number;
  leastPixels: number;
}

export const DEATH_BLASTS: BlastKind = {
  name: "replay-unit-deaths",
  fullElmos: DEATH_BLAST_ELMOS,
  leastPixels: DEATH_BLAST_LEAST,
};

export const SHOT_BLASTS: BlastKind = {
  name: "replay-shot-landings",
  fullElmos: SHOT_BLAST_ELMOS,
  leastPixels: SHOT_BLAST_LEAST,
};

const VERTEX = /* glsl */ `
attribute float progress;
uniform float fullRadius;
uniform float leastRadius;
uniform float viewHeight;
uniform float start;
varying float vProgress;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // The full radius in device pixels at this distance, as the camera
  // projects it, and never less than the least.
  float full = max(
    fullRadius * projectionMatrix[1][1] * viewHeight * 0.5 / -mv.z,
    leastRadius
  );
  // Quick at first and slower after, as a burst spreads.
  gl_PointSize = 2.0 * full * (start + (1.0 - start) * sqrt(progress));
  vProgress = progress;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float opacity;
varying float vProgress;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  if (dot(c, c) > 1.0) discard;
  gl_FragColor = vec4(color, opacity * (1.0 - vProgress));
}
`;

export interface Blasts {
  points: THREE.Points;
  /** Room for `count` circles, and the arrays to write them into. */
  reserve(count: number): { positions: Float32Array; progress: Float32Array };
  /** Shows the first `count` circles written. */
  show(count: number): void;
  dispose(): void;
}

/** Circles of one `kind`. `sceneScale` is the scene units one elmo is. */
export function createBlasts(kind: BlastKind, sceneScale: number): Blasts {
  // The shader writes its colour as is, with no conversion to the screen's
  // colour space, so it is given the sRGB values the flat map paints.
  const color = new THREE.Color(BLAST_FILL).convertLinearToSRGB();
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      color: { value: color },
      opacity: { value: BLAST_OPACITY },
      start: { value: BLAST_START },
      fullRadius: { value: kind.fullElmos * sceneScale },
      leastRadius: { value: kind.leastPixels },
      viewHeight: { value: 1 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  let geometry = new THREE.BufferGeometry();
  const points = new THREE.Points(geometry, material);
  points.name = kind.name;
  // Under the units, which are at 2.
  points.renderOrder = 1;
  points.frustumCulled = false;
  const size = new THREE.Vector2();
  points.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(size);
    material.uniforms.viewHeight.value = size.y;
    material.uniforms.leastRadius.value =
      kind.leastPixels * renderer.getPixelRatio();
  };

  let capacity = -1;
  let positions = new Float32Array(0);
  let progress = new Float32Array(0);

  return {
    points,
    reserve(count) {
      if (count > capacity) {
        capacity = Math.max(count, capacity * 2, 64);
        positions = new Float32Array(capacity * 3);
        progress = new Float32Array(capacity);
        geometry.dispose();
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(positions, 3).setUsage(
            THREE.DynamicDrawUsage,
          ),
        );
        geometry.setAttribute(
          "progress",
          new THREE.BufferAttribute(progress, 1).setUsage(
            THREE.DynamicDrawUsage,
          ),
        );
        points.geometry = geometry;
      }
      return { positions, progress };
    },
    show(count) {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.progress.needsUpdate = true;
      geometry.setDrawRange(0, count);
    },
    dispose() {
      points.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
