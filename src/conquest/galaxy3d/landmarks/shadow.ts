/**
 * A landmark's shadow. The terrain shader takes no shadows, so each landmark
 * draws its own once from the sun into a depth picture. Its material reads
 * that to shade itself, and a sheet draped on the terrain round it reads it to
 * darken the ground. Neither the sun nor the landmark moves, so it is never
 * drawn again.
 */
import * as THREE from "three";
import type { TownStyle } from "../townLayer";
import type { TerrainSurface } from "../terrain";
import type { LandmarkSite } from "./site";

/** Rings and segments of the sheet draped on the terrain. */
const RINGS = 28;
const SEGMENTS = 96;
/** How far out the sheet reaches, in the landmark's units. */
const DECAL_REACH = 4.5;
/** How far above the terrain it lies, in world units. */
const LIFT = 0.01;
/** Where the darkening at the crag's foot starts to fall away, and over how far. */
const CONTACT_FROM = 2.9;
const CONTACT_OVER = 1.5;
/** The darkening at the crag's foot, at its strongest. */
const CONTACT = 0.42;
/** How dark the landmark's shadow falls on the ground. */
const SHADOW = 0.5;
/** Where the selection ring is drawn, as a share of the landmark's reach. */
const RING_AT = 0.92;
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
  useShadow(shadow: LandmarkShadow): void;
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
uniform float uHidden;
uniform vec3 uRingColour;
uniform float uRingStrength;
uniform float uRingThick;
uniform float uRingRadius;
varying vec3 vWorld;
varying vec4 vShadow;

float shaded() {
  if (uShadowOn < 0.5) return 0.0;
  vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0;
  vec2 texel = 1.0 / vec2(textureSize(uShadow, 0));
  float dark = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      dark += 1.0 - step(p.z - 0.002, texture2D(uShadow, p.xy + vec2(i, j) * texel).r);
  return dark / 9.0;
}

void main() {
  float dist = distance(vWorld.xz, uCentre);
  float r = dist / uScale;
  float t = clamp((r - ${CONTACT_FROM.toFixed(3)}) / ${CONTACT_OVER.toFixed(3)}, 0.0, 1.0);
  float contact = ${CONTACT.toFixed(3)} * (1.0 - t) * (1.0 - t);
  float dark = max(contact, ${SHADOW.toFixed(3)} * shaded()) * (uHidden > 0.5 ? 0.7 : 1.0);
  // The town shader's ring, the same width in the same units.
  float foot = fwidth(dist);
  float ringW = max(0.035, foot * 1.3) * (1.0 + 1.2 * uRingThick);
  float ringD = abs(dist - uRingRadius);
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
 */
export function groundDecal(
  surface: TerrainSurface,
  site: LandmarkSite,
  reach: number,
  shadow: LandmarkShadow | null,
): GroundDecal {
  const pos: number[] = [];
  const idx: number[] = [];
  const far = DECAL_REACH * site.scale;
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
      uHidden: { value: 0 },
      uRingColour: { value: new THREE.Color() },
      uRingStrength: { value: 0 },
      uRingThick: { value: 0 },
      uRingRadius: { value: reach * RING_AT * site.scale },
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
      if (ring) u.uRingColour.value.copy(ring.color);
    },
    setHidden(hidden) {
      u.uHidden.value = hidden ? 1 : 0;
    },
    useShadow(s) {
      u.uShadow.value = s.target.depthTexture;
      u.uShadowMatrix.value.copy(s.matrix);
      u.uShadowOn.value = 1;
    },
  };
  if (shadow?.baked) decal.useShadow(shadow);
  return decal;
}
