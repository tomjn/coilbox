/**
 * The material every tree is drawn with. It is matte: leaves take the sun on
 * a soft wrap round the crown, with no shine at all, and a fine noise breaks
 * each crown into clumps of leaf in light and shade. A crown is darker low
 * down and inside, and below the height its neighbours' shadow reaches.
 */
import * as THREE from "three";
import type { Planet } from "../../planets";
import { TERRAIN_SUN } from "../terrain";

const VERTEX = /* glsl */ `
attribute float foliage;
attribute float up;
// Where the tree stands, then its width, height and turn.
attribute vec3 aAt;
attribute vec3 aSize;
// Its own shade, whether it is turning, how far up it is shaded, and a seed.
attribute vec4 aTree;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoliage;
varying float vUp;
varying float vY;
varying vec4 vTree;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

void main() {
  // No two crowns swell alike, so one shape makes a forest of different trees.
  vec3 p = position;
  float swell = vnoise(position * 2.6 + aTree.w * 37.0) - 0.5;
  p += normal * swell * 0.4 * foliage;
  // A crown leans a little off its trunk.
  p.xz += (vec2(hash(vec3(aTree.w, 1.0, 2.0)), hash(vec3(aTree.w, 3.0, 4.0))) - 0.5) * 0.22 * p.y * foliage;
  float c = cos(aSize.z);
  float s = sin(aSize.z);
  vec3 q = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  vec3 n = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
  vec3 world = aAt + q * vec3(aSize.x, aSize.y, aSize.x);
  vNormal = normalize(n / vec3(aSize.x, aSize.y, aSize.x));
  vWorld = world;
  vFoliage = foliage;
  vUp = up;
  vY = p.y;
  vTree = aTree;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uForest[6];
uniform vec3 uTrunk;
uniform vec3 uTwig;
uniform float uConifer;
uniform float uBare;
uniform float uFrost;
uniform vec3 uSun;
uniform vec4 uFrame;
uniform float uHaze;
uniform vec3 uFar;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoliage;
varying float vUp;
varying float vY;
varying vec4 vTree;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

void main() {
  // Clumps of leaf, a few to a crown, and a finer grain within them. Both
  // fade out as a crown shrinks toward a pixel, where they would only flicker.
  float grain = max(length(dFdx(vWorld)), length(dFdy(vWorld)));
  float coarse = vnoise(vWorld * 34.0);
  float fineN = vnoise(vWorld * 95.0);
  float showCoarse = 1.0 - smoothstep(0.012, 0.04, grain);
  float showFine = 1.0 - smoothstep(0.004, 0.014, grain);
  float clump = mix(0.5, coarse, showCoarse) * 0.65 + mix(0.5, fineN, showFine) * 0.35;

  vec3 n = normalize(vNormal);
  // The clumps face a little every way, so no crown is a smooth ball.
  n = normalize(n + (vec3(coarse, fineN, coarse * fineN * 2.0) - 0.5) * 0.9 * showCoarse * vFoliage);
  // Light wraps round a crown: leaves pass some of it through.
  float wrap = clamp((dot(n, uSun) + 0.45) / 1.45, 0.0, 1.0);
  // Below the height the neighbours' shadow reaches, the sun is gone.
  float sunlit = smoothstep(vTree.z - 0.2, vTree.z + 0.15, vY);
  // Low in a crown and between its clumps the light is cut.
  float inside = mix(0.36, 1.0, vUp) * mix(0.66, 1.08, clump);
  float light = wrap * wrap * mix(0.22, 1.0, sunlit) * inside;

  vec3 leaf = mix(mix(uForest[1], uForest[0], vTree.x), mix(uForest[3], uForest[2], vTree.x), uConifer);
  leaf = mix(leaf, mix(uForest[4], uForest[5], fract(vTree.w * 7.3)), vTree.y);
  // A bare tree is grey twigs with the last of its leaves.
  leaf = mix(leaf, mix(uTwig, leaf, 0.25), uBare);
  vec3 base = mix(uTrunk, leaf, vFoliage);
  // The sky lights what the sun does not, bluer than the sun.
  vec3 colour = base * (vec3(0.3, 0.34, 0.4) + vec3(1.18, 1.1, 0.96) * light);

  // Snow lies on what faces up, on a cold world, and little of it on twigs.
  float snow = uFrost * vFoliage * mix(1.0, 0.3, uBare) * smoothstep(0.25, 0.75, n.y * 0.7 + vUp * 0.35 + (clump - 0.5) * 0.5);
  vec3 snowCol = mix(vec3(0.55, 0.62, 0.78), vec3(1.0, 0.96, 0.88), light);
  colour = mix(colour, snowCol, snow * 0.8);

  // Past the map's edge the land greys and hazes out, and its trees with it.
  vec2 past2 = max(abs(vWorld.xz) - uFrame.xy, 0.0) / uFrame.zw;
  float past = max(past2.x, past2.y);
  if (uHaze > 0.0 && past > 0.0) {
    float beyond = smoothstep(0.0, uHaze / 3.0, past);
    float grey = dot(colour, vec3(0.2126, 0.7152, 0.0722));
    colour = mix(colour, vec3(grey), 0.35 * beyond);
    colour *= 1.0 - 0.12 * beyond;
    colour = mix(colour, uFar, smoothstep(0.0, uHaze, past));
  }
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
`;

/** What the land past the map's edge fades into. See `TerrainFrame`. */
export interface ForestFrame {
  halfX: number;
  halfZ: number;
  width: number;
  depth: number;
  haze: number;
  far: THREE.Color;
}

const linear = (c: [number, number, number]) =>
  new THREE.Color().setRGB(
    c[0] / 255,
    c[1] / 255,
    c[2] / 255,
    THREE.SRGBColorSpace,
  );

/** Bark, in sRGB: grey brown, and pale for a birch. */
const BARK: [number, number, number] = [74, 62, 52];
const PALE_BARK: [number, number, number] = [176, 172, 160];
/** A bare crown's twigs. */
const TWIG: [number, number, number] = [112, 98, 90];

/** The material for one kind of tree on `planet`. */
export function treeMaterial(
  planet: Planet,
  kind: { conifer: boolean; pale: boolean },
  frame: ForestFrame | undefined,
): THREE.ShaderMaterial {
  const forest = planet.forest;
  const colours = forest
    ? [...forest.broadleaf, ...forest.conifer, ...forest.autumn].map(linear)
    : Array.from({ length: 6 }, () => new THREE.Color());
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uForest: { value: colours },
      uTrunk: { value: linear(kind.pale ? PALE_BARK : BARK) },
      uTwig: { value: linear(TWIG) },
      uConifer: { value: kind.conifer ? 1 : 0 },
      // A birch stands bare on a cold world and in leaf on a mild one.
      uBare: { value: kind.pale && planet.frost ? 1 : 0 },
      uFrost: { value: planet.frost ?? 0 },
      uSun: { value: new THREE.Vector3(...TERRAIN_SUN) },
      uFrame: {
        value: frame
          ? new THREE.Vector4(
              frame.halfX,
              frame.halfZ,
              frame.width,
              frame.depth,
            )
          : new THREE.Vector4(1e6, 1e6, 1, 1),
      },
      uHaze: { value: frame ? frame.haze : 0 },
      uFar: { value: frame ? frame.far : new THREE.Color() },
    },
  });
}
