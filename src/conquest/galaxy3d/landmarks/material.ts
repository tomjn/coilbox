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

const VERTEX = /* glsl */ `
attribute float kind;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vWorld;
varying vec4 vShadow;
varying float vKind;
varying vec3 vSunLocal;
#if defined(USE_COLOR_ALPHA)
varying vec4 vColor;
#elif defined(USE_COLOR)
varying vec3 vColor;
#endif
uniform mat4 uShadowMatrix;
uniform vec3 uSun;
void main() {
  vLocal = position;
  // The sun in the landmark's own frame, for the relief drawn on a worn skin.
  vSunLocal = normalize(uSun * mat3(modelMatrix));
  vNormal = normal;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vKind = kind;
  vColor = color;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
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
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vWorld;
varying vec4 vShadow;
varying float vKind;
varying vec3 vSunLocal;
#if defined(USE_COLOR_ALPHA)
varying vec4 vColor;
#elif defined(USE_COLOR)
varying vec3 vColor;
#endif

float lmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lmHash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float lmNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(lmHash3(i), lmHash3(i + vec3(1, 0, 0)), f.x),
        mix(lmHash3(i + vec3(0, 1, 0)), lmHash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(lmHash3(i + vec3(0, 0, 1)), lmHash3(i + vec3(1, 0, 1)), f.x),
        mix(lmHash3(i + vec3(0, 1, 1)), lmHash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

/**
 * How far a worn skin stands proud at a point, 0 to 1: broad swells, cracks
 * that wander, beds the stone was laid down in and pits. \`fine\` fades the
 * smallest of it out as the landmark gets small on screen. \`rough\` is 1 on
 * a broken skin and less on one worn smooth, which keeps few cracks and no pits.
 */
float relic(vec3 p, float fine, float rough) {
  float h = 0.55 * lmNoise3(p * 5.0) + 0.25 * lmNoise3(p * 11.0);
  float crack = abs(lmNoise3(p * vec3(3.1, 1.3, 3.1) + 7.0) - 0.5);
  h -= 0.55 * (1.0 - smoothstep(0.004, 0.03, crack))
    * mix(smoothstep(0.45, 0.6, lmNoise3(p * 0.9 + 5.0)), 1.0, rough);
  // A bed shows only here and there, where the face has opened along it.
  float bed = abs(fract(p.y * 2.3 + 1.6 * lmNoise3(p * 1.3)) - 0.5);
  h -= 0.3 * rough * smoothstep(0.45, 0.49, bed) * smoothstep(0.45, 0.65, lmNoise3(p * 2.1 + 11.0));
  h += fine * 0.2 * lmNoise3(p * 23.0);
  h -= fine * 0.3 * rough * smoothstep(0.76, 0.88, lmNoise3(p * 27.0 + 3.0));
  return h;
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
    vec2 size = vec2(0.13, 0.065);
    vec2 b = vec2(u, vLocal.y) / size;
    b.x += 0.5 * mod(floor(b.y), 2.0);
    vec2 f = fract(b);
    float edge = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y);
    float mortar = 1.0 - smoothstep(0.004, 0.012, edge);
    float fade = clamp(1.0 - fwidth(b.y) * 0.9, 0.0, 1.0);
    float stone = 0.76 + 0.48 * lmHash(floor(b));
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
  } else if (vKind > 10.5 && vKind < 11.5) {
    // Painted plate: small sheets with a dark joint between them.
    vec2 size = vec2(0.09, 0.075);
    vec2 b = abs(n.y) < 0.75
      ? vec2(abs(n.x) > abs(n.z) ? vLocal.z : vLocal.x, vLocal.y) / size
      : vLocal.xz / size;
    vec2 f = fract(b);
    float edge = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y);
    float seam = 1.0 - smoothstep(0.001, 0.004, edge);
    float fade = clamp(1.0 - max(fwidth(b.x), fwidth(b.y)) * 1.6, 0.0, 1.0);
    base *= mix(1.0, (0.96 + 0.07 * lmHash(floor(b))) * (1.0 - 0.3 * seam), fade);
  }
  if (vKind > 10.5 && vKind < 12.5) {
    // Paint worn through to the primer and the steel, in scuffs and at chips.
    float foot = max(fwidth(vLocal.x), max(fwidth(vLocal.y), fwidth(vLocal.z)));
    float near = clamp(1.0 - foot * 30.0, 0.0, 1.0);
    float scuff = lmNoise3(vLocal * 9.0) * 0.6 + lmNoise3(vLocal * 31.0) * 0.4;
    float worn = smoothstep(0.66, 0.74, scuff) * near;
    base = mix(base, vec3(0.16, 0.11, 0.08), 0.75 * worn);
  }

  vec3 w = normalize(vWorldNormal);
  vec3 hemi = mix(uGroundBounce, uSky, w.y * 0.5 + 0.5);
  float facing = max(dot(w, uSun), 0.0);
  if (vKind > 8.5) {
    // A worn skin: relief the light catches, dark in its cracks and hollows.
    float foot = max(fwidth(vLocal.x), max(fwidth(vLocal.y), fwidth(vLocal.z)));
    float fine = clamp(1.0 - foot * 45.0, 0.0, 1.0);
    float coarse = clamp(1.0 - foot * 9.0, 0.0, 1.0);
    float e = max(0.008, foot);
    float rough = vKind > 9.5 ? 0.0 : 1.0;
    float h = relic(vLocal, fine, rough);
    vec3 grad = vec3(
      relic(vLocal + vec3(e, 0, 0), fine, rough) - h,
      relic(vLocal + vec3(0, e, 0), fine, rough) - h,
      relic(vLocal + vec3(0, 0, e), fine, rough) - h) / e;
    grad -= n * dot(grad, n);
    vec3 nl = normalize(n - grad * 0.055 * coarse);
    // Streaks run down the walls.
    float streak = lmNoise3(vec3(vLocal.x * 13.0, vLocal.y * 0.9, vLocal.z * 13.0));
    float wall = 1.0 - smoothstep(0.5, 0.8, abs(n.y));
    base *= mix(1.0, (0.62 + 0.62 * smoothstep(-0.5, 0.8, h))
      * (1.0 - 0.3 * wall * smoothstep(0.5, 0.78, streak)), coarse);
    hemi = mix(uGroundBounce, uSky, nl.y * 0.5 + 0.5);
    facing = max(dot(nl, normalize(vSunLocal)), 0.0);
  }
  float lit = sunlit();
  vec3 colour = base * (hemi + uSunLight * facing * lit);
  if (vKind > 10.5) {
    // Metal: the sun glints off it and the sky shows at a glancing angle.
    // Bare metal is the shinier, paint the duller.
    float bare = step(12.5, vKind);
    vec3 view = normalize(cameraPosition - vWorld);
    float glint = pow(max(dot(w, normalize(uSun + view)), 0.0), mix(24.0, 48.0, bare));
    float glance = pow(1.0 - max(dot(w, view), 0.0), 4.0);
    colour += uSunLight * glint * lit * mix(0.22, 0.5, bare)
      + uSky * glance * max(w.y, 0.0) * mix(0.12, 0.3, bare);
  }

  // Hidden by fog, drawn dim and grey as a hidden town is.
  if (uHidden > 0.5)
    colour = mix(colour, vec3(dot(colour, vec3(0.2126, 0.7152, 0.0722))), 0.7) * 0.7;
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
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
}

/** The few points that shine. They dim under fog with the rest. */
export function glowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: { uHidden: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec3 vColor;
void main() {
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uHidden;
varying vec3 vColor;
void main() {
  vec3 c = vColor * (uHidden > 0.5 ? 0.25 : 1.0);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
    toneMapped: false,
  });
}

/**
 * Show a landmark hidden by fog, or plain. An anomaly's haze is not drawn
 * over a model: tinting its faces hid its shape.
 */
export function setLandmarkState(
  m: THREE.ShaderMaterial,
  s: { hidden: boolean },
): void {
  m.uniforms.uHidden.value = s.hidden ? 1 : 0;
}
