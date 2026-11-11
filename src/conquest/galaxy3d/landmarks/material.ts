/**
 * The surface of a landmark: its vertex colours, the cast panels and stone
 * courses drawn on them, lit by the terrain's own sun.
 *
 * It lights itself rather than taking the scene's lights, because a run's map
 * adds a low raking light for its stations that the ground never sees. The
 * sun comes from the terrain's direction. Its strength and the sky's are the
 * lights the approved look was drawn under: a sun of 2.7 and a sky of 1.5, as
 * three.js lights a rough surface with them.
 */
import * as THREE from "three";
import { TERRAIN_SUN } from "../terrain";

/** The light a surface facing the sun takes, as three.js lights a rough one. */
const SUN_LIGHT = new THREE.Color(0xfff4e2).multiplyScalar(2.7 / Math.PI);
/** The light from the sky above and the ground below, likewise. */
const SKY = new THREE.Color(0xcfe0ff).multiplyScalar(1.5 / Math.PI);
const GROUND_BOUNCE = new THREE.Color(0x6a5a48).multiplyScalar(1.5 / Math.PI);
/** The town shader's anomaly haze, `townShader.ts`. */
const MIST = new THREE.Vector3(0.16, 0.12, 0.24);

const VERTEX = /* glsl */ `
attribute float kind;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec4 vShadow;
varying float vKind;
#if defined(USE_COLOR_ALPHA)
varying vec4 vColor;
#elif defined(USE_COLOR)
varying vec3 vColor;
#endif
uniform mat4 uShadowMatrix;
void main() {
  vLocal = position;
  vNormal = normal;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vKind = kind;
  vColor = color;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vShadow = uShadowMatrix * world;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uSunLight;
uniform vec3 uSky;
uniform vec3 uGroundBounce;
uniform sampler2D uShadow;
uniform float uShadowOn;
uniform float uHidden;
uniform float uMist;
uniform vec3 uMistColour;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec4 vShadow;
varying float vKind;
#if defined(USE_COLOR_ALPHA)
varying vec4 vColor;
#elif defined(USE_COLOR)
varying vec3 vColor;
#endif

float lmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lmNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lmHash(i), lmHash(i + vec2(1.0, 0.0)), f.x),
             mix(lmHash(i + vec2(0.0, 1.0)), lmHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

/** 1 in sunlight, 0 in the landmark's own shadow, softened over 3 by 3 texels. */
float sunlit() {
  if (uShadowOn < 0.5) return 1.0;
  vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
  vec2 texel = 1.0 / vec2(textureSize(uShadow, 0));
  float lit = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      lit += step(p.z - 0.002, texture2D(uShadow, p.xy + vec2(i, j) * texel).r);
  return lit / 9.0;
}

void main() {
#if defined(USE_COLOR_ALPHA)
  vec3 base = vColor.rgb;
  float alpha = vColor.a;
#else
  vec3 base = vColor;
  float alpha = 1.0;
#endif
  vec3 n = normalize(vNormal);
  if (vKind < 0.5 && abs(n.y) < 0.6) {
    // Courses of stone on a wall.
    float u = abs(n.x) > abs(n.z) ? vLocal.z : vLocal.x;
    vec2 size = vec2(0.17, 0.075);
    vec2 b = vec2(u, vLocal.y) / size;
    b.x += 0.5 * mod(floor(b.y), 2.0);
    vec2 f = fract(b);
    float edge = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y);
    float mortar = 1.0 - smoothstep(0.003, 0.011, edge);
    float fade = clamp(1.0 - fwidth(b.y) * 1.6, 0.0, 1.0);
    float stone = 0.88 + 0.24 * lmHash(floor(b));
    base *= mix(1.0, stone * (1.0 - 0.4 * mortar), fade);
  } else if (vKind > 7.5 && vKind < 8.5) {
    // Cast panels seen from far off: tall, close set, a few recessed.
    vec2 size;
    vec2 b;
    if (abs(n.y) < 0.75) {
      float u = abs(n.x) > abs(n.z) ? vLocal.z : vLocal.x;
      size = vec2(0.17, 0.36);
      b = vec2(u, vLocal.y) / size;
    } else {
      size = vec2(0.31, 0.31);
      b = vLocal.xz / size;
    }
    vec2 f = fract(b);
    float edge = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y);
    float seam = 1.0 - smoothstep(0.0015, 0.006, edge);
    float hh = lmHash(floor(b));
    float shade = hh > 0.9 ? 0.85 : 0.95 + 0.09 * hh;
    float fade = clamp(1.0 - max(fwidth(b.x), fwidth(b.y)) * 1.6, 0.0, 1.0);
    base *= mix(1.0, shade * (1.0 - 0.16 * seam), fade);
  }

  vec3 w = normalize(vWorldNormal);
  vec3 hemi = mix(uGroundBounce, uSky, w.y * 0.5 + 0.5);
  float facing = max(dot(w, uSun), 0.0);
  vec3 colour = base * (hemi + uSunLight * facing * sunlit());

  // Hidden by fog, drawn dim and grey as a hidden town is.
  if (uHidden > 0.5)
    colour = mix(colour, vec3(dot(colour, vec3(0.2126, 0.7152, 0.0722))), 0.7) * 0.7;
  // An anomaly's haze, as the town shader draws it.
  if (uMist > 0.5) {
    float drift = lmNoise(vLocal.xz / 0.5);
    // Darkened and tinted violet, so the model keeps its shape inside the haze.
    colour = mix(colour, colour * 0.45 + uMistColour * 0.35, 0.55 + 0.35 * drift);
  }
  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
}
`;

/** The lit surface of a landmark. `transparent` for its see-through edges. */
export function landmarkMaterial(
  opts: { transparent?: boolean } = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: opts.transparent ?? false,
    depthWrite: !opts.transparent,
    uniforms: {
      uSun: { value: new THREE.Vector3(...TERRAIN_SUN) },
      uSunLight: { value: SUN_LIGHT.clone() },
      uSky: { value: SKY.clone() },
      uGroundBounce: { value: GROUND_BOUNCE.clone() },
      uShadow: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowOn: { value: 0 },
      uHidden: { value: 0 },
      uMist: { value: 0 },
      uMistColour: { value: MIST.clone() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
}

/** The few points that shine. They dim under fog with the rest. */
export function glowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: { uHidden: { value: 0 }, uMist: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec3 vColor;
void main() {
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uHidden;
uniform float uMist;
varying vec3 vColor;
void main() {
  vec3 c = vColor * (uHidden > 0.5 ? 0.25 : 1.0) * (uMist > 0.5 ? 0.5 : 1.0);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
    toneMapped: false,
  });
}

/** Show a landmark hidden by fog, standing in an anomaly's haze, or plain. */
export function setLandmarkState(
  m: THREE.ShaderMaterial,
  s: { hidden: boolean; mist: boolean },
): void {
  m.uniforms.uHidden.value = s.hidden ? 1 : 0;
  m.uniforms.uMist.value = s.mist ? 1 : 0;
}
