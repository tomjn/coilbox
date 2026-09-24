/**
 * The dots a unit script's effects are drawn with.
 *
 * One instanced quad per particle, turned to face the camera and sized in
 * screen pixels in the vertex shader, so orbiting or zooming the camera, which
 * re-renders without a new frame, needs no rebuild. Opaque and hard edged, which is how Total Annihilation drew nano.
 */

import * as THREE from "three";
import type { Particles } from "../../effects";

export interface EffectsAtlas {
  texture: THREE.Texture;
  /** UV rectangle per bitmap slot, [u0, v0, u1, v1], or null for a bitmap the
   *  game does not have, which draws as a soft round sprite. */
  rects: (readonly [number, number, number, number] | null)[];
  /** How many smoke bitmaps it holds. At least 1. */
  smokeCount: number;
}

export interface EffectsLayer {
  object: THREE.Mesh;
  /** The sprites: muzzle flames, tracers and smoke. A child of `object`, so
   *  its visibility follows the dots'. */
  sprites: THREE.Mesh;
  update(particles: Particles): void;
  setAtlas(atlas: EffectsAtlas | null): void;
  /** The atlas's smoke count, 1 with no atlas. */
  readonly smokeCount: number;
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

/** The sprite quad is sized in world space, in elmos, and offset in view
 *  space so it always faces the camera, matching `MuzzleFlame.cpp`'s corners:
 *  the centre plus and minus the camera's right and up times the draw size.
 *
 *  A sprite with a `halfLength` is a bolt instead, drawn as
 *  `CLaserProjectile::Draw` draws a laser: stretched along its world-space
 *  `axis` from tail to head, its width across the direction facing the
 *  camera. If the axis points straight at the camera the cross product used
 *  for that width degenerates to zero, so that case falls back to the plain
 *  billboard rather than a zero-width sliver.
 *
 *  A sprite with a `side` as well lies in the plane of its axis and side
 *  instead, as `CWakeProjectile::Draw` lays a wake on the water
 *  (`WakeProjectile.cpp:98-108`). */
const SPRITE_VERTEX = /* glsl */ `
attribute vec3 center;
attribute float halfSize;
attribute vec4 tint;
attribute vec4 uvRect;
attribute vec2 uvRange;
attribute vec3 axis;
attribute vec3 side;
attribute float halfLength;
varying vec4 vTint;
varying vec2 vUv;
varying vec2 vLocal;
varying float vRound;
void main() {
  vec4 view = modelViewMatrix * vec4(center, 1.0);
  if (halfLength > 0.0) {
    vec3 a = (modelViewMatrix * vec4(axis, 0.0)).xyz;
    if (dot(side, side) > 0.0) {
      vec3 s = (modelViewMatrix * vec4(side, 0.0)).xyz;
      view.xyz += a * halfLength * position.x + s * halfSize * position.y;
    } else {
      vec3 crossed = cross(a, normalize(view.xyz));
      float crossedLen = length(crossed);
      if (crossedLen > 1e-6) {
        vec3 s = crossed / crossedLen;
        view.xyz += a * halfLength * position.x + s * halfSize * position.y;
      } else {
        view.xy += position.xy * halfSize;
      }
    }
  } else {
    view.xy += position.xy * halfSize;
  }
  gl_Position = projectionMatrix * view;
  vTint = tint;
  vLocal = position.xy;
  vRound = uvRect.x < 0.0 ? 1.0 : 0.0;
  vec2 fraction = position.xy * 0.5 + 0.5;
  fraction.x = mix(uvRange.x, uvRange.y, fraction.x);
  vUv = mix(uvRect.xy, uvRect.zw, fraction);
}
`;

/** A missing bitmap draws as a soft round sprite, premultiplied because the
 *  blend treats colour as premultiplied. The colour goes out unconverted, as
 *  the dots' does. */
const SPRITE_FRAGMENT = /* glsl */ `
uniform sampler2D atlas;
varying vec4 vTint;
varying vec2 vUv;
varying vec2 vLocal;
varying float vRound;
void main() {
  vec4 texel;
  if (vRound > 0.5) {
    float a = clamp(1.0 - length(vLocal), 0.0, 1.0);
    texel = vec4(a * a);
  } else {
    texel = texture2D(atlas, vUv);
  }
  gl_FragColor = texel * vTint;
}
`;

/** A geometry with room for `capacity` sprites. Same instanced quad as
 *  `dotGeometry`, plus a `uvRect` attribute the atlas fills in. */
function spriteGeometry(capacity: number): THREE.InstancedBufferGeometry {
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
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
  );
  geometry.setAttribute(
    "uvRect",
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
  );
  geometry.setAttribute(
    "uvRange",
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2),
  );
  geometry.setAttribute(
    "axis",
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  geometry.setAttribute(
    "side",
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  geometry.setAttribute(
    "halfLength",
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  );
  geometry.instanceCount = 0;
  return geometry;
}

/** A 1x1 white texture, the atlas stand-in until `setAtlas` gives a real one. */
function whiteTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
  );
  texture.needsUpdate = true;
  return texture;
}

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
    // Drawn over everything, as TA drew nano over the units. The engine's
    // buildee is a see-through nanoframe, and the opaque stand-in would
    // otherwise hide a factory's whole spray, which never leaves it.
    depthTest: false,
    uniforms: {
      viewport: { value: new THREE.Vector2(1, 1) },
      pixelRatio: { value: 1 },
    },
  });
  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = 1;
  object.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(material.uniforms.viewport.value);
    material.uniforms.pixelRatio.value = renderer.getPixelRatio();
  };

  let spriteCapacity = 64;
  let spriteGeom = spriteGeometry(spriteCapacity);
  const growSprites = (count: number) => {
    spriteCapacity = Math.max(count, spriteCapacity * 2);
    spriteGeom.dispose();
    spriteGeom = spriteGeometry(spriteCapacity);
    sprites.geometry = spriteGeom;
  };

  const atlasTexture = whiteTexture();
  const spriteMaterial = new THREE.ShaderMaterial({
    vertexShader: SPRITE_VERTEX,
    fragmentShader: SPRITE_FRAGMENT,
    // Matches the engine's particle blend: additive colour, source alpha
    // eating what is behind it, depth tested against the scene but not
    // written, so overlapping sprites blend with each other and with units.
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      atlas: { value: atlasTexture },
    },
  });
  const sprites = new THREE.Mesh(spriteGeom, spriteMaterial);
  sprites.frustumCulled = false;
  sprites.renderOrder = 1;
  object.add(sprites);

  let atlas: EffectsAtlas | null = null;
  let lastBitmaps: Float32Array<ArrayBufferLike> = new Float32Array();

  const uvRectFor = (bitmap: number): [number, number, number, number] => {
    const rect = atlas?.rects[bitmap];
    return rect ? [rect[0], rect[1], rect[2], rect[3]] : [-1, -1, -1, -1];
  };

  const refillUvRect = () => {
    const attribute = spriteGeom.getAttribute(
      "uvRect",
    ) as THREE.InstancedBufferAttribute;
    const array = attribute.array as Float32Array;
    for (let i = 0; i < lastBitmaps.length; i++) {
      const [u0, v0, u1, v1] = uvRectFor(lastBitmaps[i]);
      array[i * 4] = u0;
      array[i * 4 + 1] = v0;
      array[i * 4 + 2] = u1;
      array[i * 4 + 3] = v1;
    }
    attribute.needsUpdate = true;
  };

  return {
    object,
    sprites,
    get smokeCount() {
      return atlas?.smokeCount ?? 1;
    },
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

      const { sprites: sprite } = particles;
      if (sprite.count > spriteCapacity) growSprites(sprite.count);
      const writeSprite = (name: string, values: Float32Array) => {
        const attribute = spriteGeom.getAttribute(
          name,
        ) as THREE.InstancedBufferAttribute;
        (attribute.array as Float32Array).set(values);
        attribute.needsUpdate = true;
      };
      writeSprite("center", sprite.centers);
      writeSprite("halfSize", sprite.halfSizes);
      writeSprite("tint", sprite.colors);
      writeSprite("axis", sprite.axes);
      writeSprite("side", sprite.sides);
      writeSprite("halfLength", sprite.halfLengths);
      writeSprite("uvRange", sprite.uvRanges);
      lastBitmaps = sprite.bitmaps;
      refillUvRect();
      spriteGeom.instanceCount = sprite.count;
    },
    setAtlas(newAtlas) {
      atlas = newAtlas;
      spriteMaterial.uniforms.atlas.value = newAtlas?.texture ?? atlasTexture;
      refillUvRect();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      spriteGeom.dispose();
      spriteMaterial.dispose();
      atlasTexture.dispose();
    },
  };
}
