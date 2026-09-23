/**
 * The dots a unit script's effects are drawn with.
 *
 * One instanced quad per particle, turned to face the camera in the vertex
 * shader, so orbiting the camera, which re-renders without a new frame, needs
 * no rebuild. Opaque and hard edged, which is how Total Annihilation drew nano.
 */

import * as THREE from "three";
import type { Particles } from "../../effects";

export interface EffectsLayer {
  object: THREE.Mesh;
  update(particles: Particles): void;
  dispose(): void;
}

const VERTEX = /* glsl */ `
attribute vec3 center;
attribute float halfSize;
attribute vec3 tint;
varying vec3 vTint;
void main() {
  vec4 view = modelViewMatrix * vec4(center, 1.0);
  view.xy += position.xy * halfSize;
  gl_Position = projectionMatrix * view;
  vTint = tint;
}
`;

/** The colour goes out as it came in. It is sRGB already, so no colour space
 *  conversion is included. The quad is drawn whole, with no discard: TA's own
 *  nano dot is a hard-edged square, not a circle. */
const FRAGMENT = /* glsl */ `
varying vec3 vTint;
void main() {
  gl_FragColor = vec4(vTint, 1.0);
}
`;

export function buildEffectsLayer(): EffectsLayer {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  let capacity = 0;
  const grow = (count: number) => {
    capacity = Math.max(count, capacity * 2, 64);
    for (const name of ["center", "halfSize", "tint"]) {
      (
        geometry.getAttribute(name) as THREE.InstancedBufferAttribute | null
      )?.dispose();
    }
    geometry.setAttribute(
      "center",
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
    );
    geometry.setAttribute(
      "halfSize",
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    );
    geometry.setAttribute(
      "tint",
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
    );
  };
  grow(0);
  geometry.instanceCount = 0;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;

  return {
    object,
    update(particles) {
      if (particles.count > capacity) grow(particles.count);
      const write = (name: string, values: Float32Array) => {
        const attribute = geometry.getAttribute(
          name,
        ) as THREE.InstancedBufferAttribute;
        (attribute.array as Float32Array).set(values);
        attribute.needsUpdate = true;
      };
      write("center", particles.centers);
      write("halfSize", particles.halfSizes);
      write("tint", particles.colors);
      geometry.instanceCount = particles.count;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
