/**
 * The dots a unit script's effects are drawn with.
 *
 * One instanced quad per particle, turned to face the camera and sized in
 * screen pixels in the vertex shader, so orbiting or zooming the camera, which
 * re-renders without a new frame, needs no rebuild. Opaque and hard edged, which is how Total Annihilation drew nano.
 */

import * as THREE from "three";
import type { Particles } from "../../effects";

export interface EffectsLayer {
  object: THREE.Mesh;
  update(particles: Particles): void;
  dispose(): void;
}

/** A dot's size is in screen pixels, not elmos, so it stays the same size at
 *  any zoom, as TA's did. One pixel is 2 / viewport in clip space, scaled by w
 *  to undo the perspective divide. */
const VERTEX = /* glsl */ `
uniform vec2 viewport;
uniform float pixelRatio;
attribute vec3 center;
attribute float halfSize;
attribute vec3 tint;
varying vec3 vTint;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(center, 1.0);
  gl_Position.xy += position.xy * halfSize * pixelRatio * 2.0 / viewport * gl_Position.w;
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

/** A geometry with room for `capacity` dots. three.js caches how many
 *  instances a geometry can draw on its first render, so growing means a new
 *  geometry, not new attributes on the old one. */
function dotGeometry(capacity: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
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
  geometry.instanceCount = 0;
  return geometry;
}

export function buildEffectsLayer(): EffectsLayer {
  let capacity = 64;
  let geometry = dotGeometry(capacity);
  const grow = (count: number) => {
    capacity = Math.max(count, capacity * 2);
    geometry.dispose();
    geometry = dotGeometry(capacity);
    object.geometry = geometry;
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      viewport: { value: new THREE.Vector2(1, 1) },
      pixelRatio: { value: 1 },
    },
  });
  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;
  object.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(material.uniforms.viewport.value);
    material.uniforms.pixelRatio.value = renderer.getPixelRatio();
  };

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
