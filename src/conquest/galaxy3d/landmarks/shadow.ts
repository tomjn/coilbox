/**
 * A landmark's shadow. The terrain shader takes no shadows, so each landmark
 * draws its own once from the sun into a depth picture. Its material reads
 * that to shade itself, and a sheet draped on the terrain round it reads it to
 * darken the ground. Neither the sun nor the landmark moves, so it is never
 * drawn again.
 */
import * as THREE from "three";
import type { TerrainSurface } from "../terrain";
import type { TownStyle } from "../townLayer";
import type { LandmarkSite } from "./site";

/** Rings and segments of the sheet draped on the terrain. */
const RINGS = 28;
const SEGMENTS = 96;
/*
 * Distances below are shares of the landmark's reach, set on the stronghold,
 * whose reach is 3.79: the sheet ends at 4.5, the foot's darkening starts to
 * fall away at 2.9 and is gone 1.5 further on, and the shadow fades out from
 * 3.0 to 4.2.
 */
/** How far out the sheet reaches. */
const DECAL_REACH = 1.19;
/** How far above the terrain it lies, in world units. */
const LIFT = 0.01;
/** Where the darkening at the foot starts to fall away, and over how far. */
const CONTACT_FROM = 0.765;
const CONTACT_OVER = 0.396;
/** The darkening at the crag's foot, at its strongest. */
const CONTACT = 0.42;
/**
 * How dark the landmark's shadow falls on the ground. Past the crag it fades
 * out, so the tower's head never throws a lone dark shape onto open ground.
 */
const SHADOW = 0.35;
const SHADOW_FADE_FROM = 0.792;
const SHADOW_FADE_TO = 1.108;
/** Where the selection ring is drawn, as a share of the landmark's reach. */
export const RING_AT = 0.92;
/**
 * How far the sheet must reach for the ring, in ring radii. A triangle's
 * corners, the furthest of any shape's, lie at 4/3, and the line has a width.
 */
const RING_ROOM = 1.5;
/**
 * Drawn after the town patches (-2.5) and before the borders (-2), as a town
 * would be.
 */
const DECAL_ORDER = -2.4;

/** An orthographic camera looking down the sun at a box, fitted round it. */
export function shadowCamera(
  bounds: THREE.Box3,
  sun: THREE.Vector3,
): THREE.OrthographicCamera {
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  const cam = new THREE.OrthographicCamera();
  cam.position.copy(centre).addScaledVector(sun, radius * 2 + 1);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  const view = cam.matrixWorldInverse;
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner
      .set(
        i & 1 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y,
        i & 4 ? bounds.max.z : bounds.min.z,
      )
      .applyMatrix4(view);
    lo.min(corner);
    hi.max(corner);
  }
  const pad = radius * 0.02;
  cam.left = lo.x - pad;
  cam.right = hi.x + pad;
  cam.bottom = lo.y - pad;
  cam.top = hi.y + pad;
  // The camera looks down -z, so the nearest point has the largest z.
  cam.near = -hi.z - pad;
  cam.far = -lo.z + pad;
  cam.updateProjectionMatrix();
  return cam;
}

export interface LandmarkShadow {
  target: THREE.WebGLRenderTarget;
  /** World position to the depth picture's clip space. */
  matrix: THREE.Matrix4;
  baked: boolean;
  /** Draw the parts, each at its world matrix, into the depth picture once. */
  bake(
    renderer: THREE.WebGLRenderer,
    parts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[],
  ): void;
}

/** A depth picture of `size` texels a side, looking down the sun at `bounds`. */
export function createLandmarkShadow(
  bounds: THREE.Box3,
  sun: THREE.Vector3,
  size = 1024,
): LandmarkShadow {
  const camera = shadowCamera(bounds, sun);
  const target = new THREE.WebGLRenderTarget(size, size, {
    depthTexture: new THREE.DepthTexture(size, size),
    generateMipmaps: false,
  });
  const matrix = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const shadow: LandmarkShadow = {
    target,
    matrix,
    baked: false,
    bake(renderer, parts) {
      const scene = new THREE.Scene();
      const material = new THREE.MeshBasicMaterial({ colorWrite: false });
      for (const { geometry, matrix: at } of parts) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(at);
        scene.add(mesh);
      }
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      material.dispose();
      shadow.baked = true;
    },
  };
  return shadow;
}

export interface GroundDecal {
  mesh: THREE.Mesh;
  /** Draw a town's selection ring round the landmark, or none. */
  setRing(ring: TownStyle["ring"] | undefined): void;
  setHidden(hidden: boolean): void;
  /** Start reading the landmark's shadow, once it is drawn. */
  takeShadow(shadow: LandmarkShadow): void;
}

const DECAL_VERTEX = /* glsl */ `
uniform mat4 uShadowMatrix;
varying vec3 vWorld;
varying vec4 vShadow;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vShadow = uShadowMatrix * w;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const DECAL_FRAGMENT = /* glsl */ `
uniform sampler2D uShadow;
uniform float uShadowOn;
uniform vec2 uCentre;
uniform float uScale;
uniform float uReach;
uniform float uShadowReach;
uniform float uHidden;
uniform float uContact;
uniform vec3 uRingColour;
uniform float uRingStrength;
uniform float uRingThick;
uniform float uRingRadius;
uniform float uRingSides;
uniform float uRingWeight;
varying vec3 vWorld;
varying vec4 vShadow;

float shaded() {
  if (uShadowOn < 0.5) return 0.0;
  vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  // Past the far side of the picture there is nothing to read, and the edge
  // would otherwise show as a grey slab beside a wide town.
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 0.0;
  vec2 texel = 1.0 / vec2(textureSize(uShadow, 0));
  float dark = 0.0;
  // Five by five samples two texels apart, for a soft edge.
  for (int i = -2; i <= 2; i++)
    for (int j = -2; j <= 2; j++)
      dark += 1.0 - step(p.z - 0.002, texture2D(uShadow, p.xy + vec2(i, j) * texel * 2.0).r);
  return dark / 25.0;
}

void main() {
  float dist = distance(vWorld.xz, uCentre);
  float r = dist / (uScale * uReach);
  float t = clamp((r - ${CONTACT_FROM.toFixed(3)}) / ${CONTACT_OVER.toFixed(3)}, 0.0, 1.0);
  float contact = ${CONTACT.toFixed(3)} * (1.0 - t) * (1.0 - t) * uContact;
  float thrown = ${SHADOW.toFixed(3)} * shaded() * (1.0 - smoothstep(${SHADOW_FADE_FROM.toFixed(3)}, ${SHADOW_FADE_TO.toFixed(3)}, dist / (uScale * uShadowReach)));
  float dark = max(contact, thrown) * (uHidden > 0.5 ? 0.7 : 1.0);
  // The town shader's ring, the same width in the same units.
  // How far outside the ring's line this point is. A shape has a corner to
  // the north, and its corners are as far outside the round ring as the
  // middles of its sides are inside it.
  float off = dist - uRingRadius;
  if (uRingSides > 2.5) {
    vec2 p = vWorld.xz - uCentre;
    float sector = 6.2831853 / uRingSides;
    float a = mod(atan(p.x, -p.y) + sector * 0.5, sector) - sector * 0.5;
    float c = cos(sector * 0.5);
    off = dist * cos(a) - uRingRadius * 2.0 * c / (1.0 + c);
  }
  float foot = fwidth(off);
  float ringW = max(0.035, foot * 1.3) * (1.0 + 1.2 * uRingThick) * uRingWeight;
  float ringD = abs(off);
  float ring = (1.0 - smoothstep(ringW * 0.5 - foot * 0.5, ringW * 0.5 + foot * 0.5, ringD)) * uRingStrength;
  float alpha = ring + dark * (1.0 - ring);
  if (alpha < 0.002) discard;
  vec3 colour = (uRingColour * ring + vec3(0.02, 0.02, 0.03) * dark * (1.0 - ring)) / alpha;
  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
}
`;

/**
 * A sheet draped on the terrain round a landmark, in world space: the shadow
 * it throws, the darkening at its foot and a town's selection ring.
 * `shadowReach` is how far the shadow may fall, for a landmark much taller
 * than it is wide. `contact` is false for a town, which has no single foot to
 * darken.
 */
export function groundDecal(
  surface: TerrainSurface,
  site: LandmarkSite,
  reach: number,
  shadow: LandmarkShadow | null,
  shadowReach = reach,
  opts: { contact?: boolean } = {},
): GroundDecal {
  const pos: number[] = [];
  const idx: number[] = [];
  const far =
    Math.max(DECAL_REACH * shadowReach, RING_AT * RING_ROOM * reach) *
    site.scale;
  for (let i = 0; i <= RINGS; i++) {
    const r = (i / RINGS) * far;
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      const x = site.x + r * Math.cos(a);
      const z = site.z + r * Math.sin(a);
      pos.push(x, surface.groundHeightAtWorld(x, z) + LIFT, z);
    }
  }
  for (let i = 0; i < RINGS; i++)
    for (let s = 0; s < SEGMENTS; s++) {
      const a0 = i * SEGMENTS + s;
      const a1 = i * SEGMENTS + ((s + 1) % SEGMENTS);
      idx.push(a0, a1, a0 + SEGMENTS, a1, a1 + SEGMENTS, a0 + SEGMENTS);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uShadow: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowOn: { value: 0 },
      uCentre: { value: new THREE.Vector2(site.x, site.z) },
      uScale: { value: site.scale },
      uReach: { value: reach },
      uShadowReach: { value: shadowReach },
      uHidden: { value: 0 },
      uContact: { value: opts.contact === false ? 0 : 1 },
      uRingColour: { value: new THREE.Color() },
      uRingStrength: { value: 0 },
      uRingThick: { value: 0 },
      uRingRadius: { value: reach * RING_AT * site.scale },
      uRingSides: { value: 0 },
      uRingWeight: { value: 1 },
    },
    vertexShader: DECAL_VERTEX,
    fragmentShader: DECAL_FRAGMENT,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = DECAL_ORDER;
  mesh.raycast = () => {};
  const u = material.uniforms;
  const decal: GroundDecal = {
    mesh,
    setRing(ring) {
      u.uRingStrength.value = ring ? ring.strength : 0;
      u.uRingThick.value = ring?.thick ? 1 : 0;
      u.uRingSides.value = ring?.sides ?? 0;
      u.uRingWeight.value = ring?.weight ?? 1;
      if (ring) u.uRingColour.value.copy(ring.color);
    },
    setHidden(hidden) {
      u.uHidden.value = hidden ? 1 : 0;
    },
    takeShadow(s) {
      u.uShadow.value = s.target.depthTexture;
      u.uShadowMatrix.value.copy(s.matrix);
      u.uShadowOn.value = 1;
    },
  };
  if (shadow?.baked) decal.takeShadow(shadow);
  return decal;
}
