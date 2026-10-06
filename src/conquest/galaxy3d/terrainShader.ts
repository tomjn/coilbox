import * as THREE from "three";
import {
  BIOME_SLOTS,
  type BiomePattern,
  type PlanetId,
  planetOf,
  type SeaLook,
} from "../planets";
import {
  GROUND_BODY,
  GROUND_HEAD,
  GROUND_LIT,
  type GroundShading,
  groundUniforms,
} from "./groundShader";
import { SHADE_AMBIENT, TERRAIN_SUN } from "./terrain";

/**
 * Surface detail for the terrain sheet, added to its unlit material in the
 * shader. The map picture stays the broad colour. On top of it:
 *
 * - Light per pixel from the heightmap's normals, so ridges finer than the
 *   mesh catch the sun. The sun and the ambient share are the ones the vertex
 *   shading used, so level ground is still exactly the picture's colour. The
 *   normals are read through a smooth filter, since the plain blend between
 *   texels shows as creases once a texel covers many pixels.
 * - On a generated map, procedural texture by biome, from the weights the
 *   generator wrote beside the picture. Each biome slot names a pattern
 *   (`BiomePattern` in `planets.ts`): canopy, grass, dunes, regolith with its
 *   craters, basalt blocks, cracked salt and so on. A sea is water with
 *   ripples, a glint and foam, or lava, sea ice, or ground with the pattern
 *   of the land beside it. Each layer of a pattern fades out once it is
 *   about a screen pixel across, so it appears as the camera comes in and
 *   never shimmers from far away.
 * - Patterns are drawn from above, which would smear down a cliff, so rock
 *   and any steep slope draw from the point in space instead.
 *
 * Display only. Nothing here feeds play or the generator.
 */

/** What the shader is given beyond the picture. */
export interface TerrainShading {
  /** {@link terrainNormalPixels} as a texture, or null for a flat sheet. */
  normals: THREE.Texture | null;
  /** The generator's weights and its planet. Null for a hand-made map, which gets no detail. */
  biomes: { a: THREE.Texture; b: THREE.Texture; planet: PlanetId } | null;
  /** Draw the detail. Off in performance mode. */
  detail: boolean;
  /**
   * For a map drawn with land past its edge: the sheet the map fills. Past it
   * the ground is greyed and darkened a little, so the map reads as the map
   * and the rest as beyond it, and then hazes into `far` until it is gone.
   * Left out, nothing past the sheet is drawn and nothing is changed.
   */
  frame?: TerrainFrame;
  /** Roads painted into the ground. See `groundShader.ts`. */
  ground?: GroundShading;
}

/** The sheet's place in world units, and the haze past it. */
export interface TerrainFrame {
  halfX: number;
  halfZ: number;
  width: number;
  depth: number;
  /** How far past the edge the haze is complete, in sheets. */
  haze: number;
  /** The colour the haze reaches, which is also the scene's background. */
  far: THREE.Color;
  /**
   * Whether land past the edge is greyed and darkened. Off for a hand-made
   * map's apron, whose heights ease down across its picture's colours, so the
   * line where it sinks below the coast would show as a ruled band.
   */
  greyBeyond: boolean;
}

const VERTEX_HEAD = /* glsl */ `
varying vec2 vTerrainUv;
varying vec3 vTerrainPos;
`;

const VERTEX_BODY = /* glsl */ `
vTerrainUv = uv;
vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uTerrainNormals;
uniform float uTerrainRelief;
uniform float uTerrainDetail;
uniform sampler2D uBiomeA;
uniform sampler2D uBiomeB;
uniform float uBiomePattern[8];
uniform vec3 uBiomeSteep[2];
uniform vec3 uBiomeClearing;
uniform vec3 uBiomeColour[8];
uniform float uSeaLiquid;
uniform float uSeaPattern;
uniform vec3 uTerrainSun;
uniform float uTerrainAmbient;
uniform vec4 uTerrainFrame;
uniform float uTerrainHaze;
uniform vec3 uTerrainFar;
uniform float uTerrainGreyBeyond;
varying vec2 vTerrainUv;
varying vec3 vTerrainPos;
TERRAIN_NOISE_HERE`;

/**
 * Hashes, noise and the helpers that fade a pattern out with distance, for
 * any shader that draws on the ground: the terrain's own, and the towns'
 * (`townShader.ts`).
 */
export const TERRAIN_NOISE = /* glsl */ `
float tHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Two independent values in 0 to 1 from one point.
vec2 tHash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

// Value noise and its gradient, 0 to 1.
vec3 tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = tHash(i);
  float b = tHash(i + vec2(1.0, 0.0));
  float c = tHash(i + vec2(0.0, 1.0));
  float d = tHash(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(
    a + k1 * u.x + k2 * u.y + k4 * u.x * u.y,
    du * vec2(k1 + k4 * u.y, k2 + k4 * u.x)
  );
}

// Distance to the nearest of a scatter of points, one per cell, its gradient,
// and a random 0 to 1 for the nearest point. Round blobs, for tree crowns.
vec4 tCell(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float best = 8.0;
  vec2 toward = vec2(0.0);
  vec2 bestCell = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 d = g + 0.15 + tHash2(i + g) * 0.7 - f;
      float dd = dot(d, d);
      if (dd < best) {
        best = dd;
        toward = d;
        bestCell = g;
      }
    }
  }
  float dist = sqrt(best);
  return vec4(dist, -toward / max(dist, 1e-4), tHash(i + bestCell + 41.3));
}

// How much of a pattern of wavelength w (world units) to keep, given the
// world units one screen pixel covers. Gone below about 3 pixels.
float tKeep(float w, float footprint) {
  return clamp((w / footprint - 3.0) / 5.0, 0.0, 1.0);
}

// Three independent values in 0 to 1 from one point.
vec3 tHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// As tKeep, for the simplex noise below, whose lattice has no straight rows
// to show, so it can stay until it is nearly a pixel across.
float tShow(float w, float footprint) {
  return clamp((w / footprint - 1.2) / 1.3, 0.0, 1.0);
}

// Simplex noise and its gradient, about -1 to 1. Its lattice is triangles, so
// it has none of the rows and columns value noise shows.
vec3 tSimplex(vec2 p) {
  const float K1 = 0.366025404;
  const float K2 = 0.211324865;
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  float m = step(a.y, a.x);
  vec2 o = vec2(m, 1.0 - m);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 h2 = h * h;
  vec3 h3 = h2 * h;
  vec3 h4 = h2 * h2;
  vec2 ga = tHash2(i) * 2.0 - 1.0;
  vec2 gb = tHash2(i + o) * 2.0 - 1.0;
  vec2 gc = tHash2(i + 1.0) * 2.0 - 1.0;
  vec3 d = vec3(dot(a, ga), dot(b, gb), dot(c, gc));
  vec2 g = h4.x * ga + h4.y * gb + h4.z * gc
    - 8.0 * (h3.x * d.x * a + h3.y * d.y * b + h3.z * d.z * c);
  return 70.0 * vec3(dot(h4, d), g);
}

// The same in three dimensions, for ground too steep to draw from above.
vec4 tSimplex3(vec3 p) {
  const float F = 1.0 / 3.0;
  const float G = 1.0 / 6.0;
  vec3 i = floor(p + (p.x + p.y + p.z) * F);
  vec3 x0 = p - i + (i.x + i.y + i.z) * G;
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + G;
  vec3 x2 = x0 - i2 + 2.0 * G;
  vec3 x3 = x0 - 1.0 + 3.0 * G;
  vec4 h = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 h2 = h * h;
  vec4 h3 = h2 * h;
  vec4 h4 = h2 * h2;
  vec3 g0 = tHash3(i) * 2.0 - 1.0;
  vec3 g1 = tHash3(i + i1) * 2.0 - 1.0;
  vec3 g2 = tHash3(i + i2) * 2.0 - 1.0;
  vec3 g3 = tHash3(i + 1.0) * 2.0 - 1.0;
  vec4 d = vec4(dot(x0, g0), dot(x1, g1), dot(x2, g2), dot(x3, g3));
  vec3 grad = h4.x * g0 + h4.y * g1 + h4.z * g2 + h4.w * g3
    - 8.0 * (h3.x * d.x * x0 + h3.y * d.y * x1 + h3.z * d.z * x2 + h3.w * d.w * x3);
  return 52.0 * vec4(dot(h4, d), grad);
}

// Several octaves of simplex noise from wavelength w0 down, each half the
// last, centred on 0. Returns the value and its gradient in world units.
vec3 tField(vec2 p, float w0, int octaves, float footprint) {
  vec3 sum = vec3(0.0);
  float w = w0;
  float amp = 1.0;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  mat2 r = turn;
  for (int k = 0; k < 8; k++) {
    if (k >= octaves) break;
    float keep = tShow(w, footprint);
    if (keep <= 0.0) break;
    vec3 n = tSimplex(r * p / w + float(k) * 17.3);
    sum += vec3(n.x, (transpose(r) * n.yz) / w) * amp * keep;
    w *= 0.5;
    amp *= 0.5;
    r = turn * r;
  }
  return sum;
}

// A scatter of points, one per cell, cut into plates with straight edges.
// Returns the distance to the nearest edge, a random 0 to 1 for the plate, and
// the direction to that edge. For cracks, plates and ridges, where tCell
// gives round blobs.
vec4 tPlates(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 r = g + tHash2(n + g) - f;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
      }
    }
  }
  float edge = 8.0;
  vec2 toward = vec2(1.0, 0.0);
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 g = mg + vec2(float(x), float(y));
      vec2 r = g + tHash2(n + g) - f;
      vec2 dr = r - mr;
      if (dot(dr, dr) > 1e-5) {
        vec2 dir = normalize(dr);
        float d = dot(0.5 * (mr + r), dir);
        if (d < edge) {
          edge = d;
          toward = dir;
        }
      }
    }
  }
  return vec4(edge, tHash(n + mg + 7.7), toward);
}

// A texture read through a smooth filter of four taps in place of the plain
// blend between texels, whose creases show once a texel covers many pixels.
vec4 tSmooth(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 st = uv * size - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / size;
  vec2 h1 = (i + 1.5 + w3 / g1) / size;
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  return g0.y * (g0.x * textureGrad(tex, h0, dx, dy) + g1.x * textureGrad(tex, vec2(h1.x, h0.y), dx, dy))
    + g1.y * (g0.x * textureGrad(tex, vec2(h0.x, h1.y), dx, dy) + g1.x * textureGrad(tex, h1, dx, dy));
}
`;

/** The index the shader gives each pattern. */
const PATTERN_INDEX: Record<BiomePattern, number> = {
  forest: 0,
  grass: 1,
  scrub: 2,
  sand: 3,
  dunes: 4,
  dust: 5,
  regolith: 6,
  rock: 7,
  scree: 8,
  mesa: 9,
  salt: 10,
  basalt: 11,
  flows: 12,
  ash: 13,
  ice: 14,
  snow: 15,
  tundra: 16,
  cracked: 17,
  earth: 18,
};
const P = PATTERN_INDEX;
/** Two patterns only a sea draws with, after the land's. */
const P_LAVA = 19;
const P_SEA_ICE = 20;
const PATTERN_COUNT = 21;

/**
 * The pattern a sea that is not liquid draws with. A dry basin and the maria
 * are ground, and take the pattern of the ground beside them.
 */
const SEA_PATTERN: Partial<Record<SeaLook, number>> = {
  basin: P.dust,
  maria: P.regolith,
  lava: P_LAVA,
  ice: P_SEA_ICE,
};

const FRAGMENT_BODY = /* glsl */ `
// How far past the map's edge this pixel lies, in sheets. 0 on the map.
float terrainPast = 0.0;
if (uTerrainHaze > 0.0) {
  vec2 past = max(abs(vTerrainPos.xz) - uTerrainFrame.xy, 0.0) / uTerrainFrame.zw;
  terrainPast = length(past);
}
// Fully hazed ground is the background colour, so skip the work there.
if (terrainPast >= uTerrainHaze && uTerrainHaze > 0.0) {
  diffuseColor.rgb = uTerrainFar;
} else {
  vec4 nh = texture2D(uTerrainNormals, vTerrainUv);
  vec3 n = uTerrainRelief > 0.5
    ? normalize(tSmooth(uTerrainNormals, vTerrainUv).xyz * 2.0 - 1.0)
    : vec3(0.0, 1.0, 0.0);
  vec3 albedo = diffuseColor.rgb;
  float spec = 0.0;
  // Light the ground gives out itself, and the share of it the sun does not
  // shade. Lava only.
  vec3 glow = vec3(0.0);
  float unlit = 0.0;

  if (uTerrainDetail > 0.5) {
    vec2 p = vTerrainPos.xz;
    float footprint = max(length(dFdx(p)), length(dFdy(p))) + 1e-5;
    // The generator's weights for this pixel, eight slots in two samples.
    vec4 wa = texture2D(uBiomeA, vTerrainUv);
    vec4 wb = texture2D(uBiomeB, vTerrainUv);
    float w[8];
    w[0] = wa.x; w[1] = wa.y; w[2] = wa.z; w[3] = wa.w;
    w[4] = wb.x; w[5] = wb.y; w[6] = wb.z; w[7] = wb.w;
    // Sea is height 0 and land at least 1 in 255, so this is the coastline.
    float coast = nh.a * 255.0;
    float sea = 1.0 - smoothstep(0.35, 0.65, coast);
    float land = 1.0 - sea;
    float liquid = sea * uSeaLiquid;

    // Broad patches, then fine grain. Open water needs neither. Each block
    // below runs only where its share is worth drawing: biomes lie in large
    // patches, so the GPU skips them together and the cost stays low.
    vec3 broad = vec3(0.0);
    vec3 fine = vec3(0.0);
    if (liquid < 0.99 || coast > 0.01) {
      broad = tField(p, 4.0, 3, footprint);
      fine = tField(p + 31.0, 0.5, 5, footprint);
    }
    // A slow push to bend the plates and cracks below, whose edges are
    // otherwise ruled straight.
    vec2 bend = vec2(broad.x, tSimplex(p / 2.7 + 77.0).x) * 0.35 + vec2(fine.x, -fine.x) * 0.05;

    // The weights blend from one biome to the next over many pixels of the
    // picture. Sharpen them, each pushed a little by the noise, so one ground
    // gives way to the next along a ragged line, and recolour to match.
    float sum = 0.0;
    vec3 soft = vec3(0.0);
    for (int k = 0; k < 8; k++) {
      sum += w[k];
      soft += w[k] * uBiomeColour[k];
    }
    if (sum > 0.5) {
      float sharp = 1e-6;
      for (int k = 0; k < 8; k++) {
        float push = broad.x * cos(float(k) * 2.4) + fine.x * sin(float(k) * 2.4);
        float v = max(w[k] / sum * (1.0 + 0.5 * push), 0.0);
        w[k] = v * v * v;
        sharp += w[k];
      }
      vec3 crisp = vec3(0.0);
      for (int k = 0; k < 8; k++) {
        w[k] /= sharp;
        crisp += w[k] * uBiomeColour[k];
      }
      vec3 change = clamp(crisp / max(soft / sum, vec3(1e-3)), 0.5, 2.0);
      albedo *= mix(vec3(1.0), change, smoothstep(0.5, 0.95, sum));
    }

    // Each slot adds its share to the pattern it draws with. A sea that is
    // ground, lava or ice adds itself to a pattern too.
    float pw[${PATTERN_COUNT}];
    for (int k = 0; k < ${PATTERN_COUNT}; k++) pw[k] = 0.0;
    float total = 1e-3;
    for (int k = 0; k < 8; k++) {
      if (uBiomePattern[k] > -0.5) {
        pw[int(uBiomePattern[k] + 0.5)] += w[k];
        total += w[k];
      }
    }
    for (int k = 0; k < ${PATTERN_COUNT}; k++) pw[k] *= land / total;
    if (uSeaPattern > -0.5) pw[int(uSeaPattern + 0.5)] += sea;

    // Steep ground shows bare rock, whatever grows on the level.
    float steep = smoothstep(0.08, 0.22, 1.0 - n.y) * land;

    float shadeMul = 1.0;
    // The slope each pattern adds, seen from above, and for rock in space.
    vec2 bump = vec2(0.0);
    vec3 bump3 = vec3(0.0);
    vec2 wind = normalize(vec2(0.85, 0.5));
    vec2 across = vec2(-wind.y, wind.x);
    vec3 view = normalize(cameraPosition - vTerrainPos);
    float glint = max(dot(n, normalize(view + uTerrainSun)), 0.0);

    // Forest: a canopy of crowns with dark gaps between them.
    if (pw[${P.forest}] > 0.02) {
      float s = pw[${P.forest}];
      shadeMul += s * (broad.x * 0.2 + fine.x * 0.12);
      // Where the broad noise is low the trees thin out into clearings.
      float thin = smoothstep(0.05, -0.35, broad.x);
      for (int k = 0; k < 2; k++) {
        float size = k == 0 ? 0.5 : 0.17;
        float keep = tKeep(size, footprint);
        if (keep <= 0.0) break;
        vec4 cell = tCell(p / size + float(k) * 7.3 + fine.x * 0.3);
        // Each crown a little bigger or smaller, lighter or darker.
        float reach = 0.45 + 0.25 * cell.w - thin * 0.25;
        float dome = 1.0 - smoothstep(0.05, reach, cell.x);
        float tone = (cell.w - 0.5) * 0.35;
        // Clumps light and shade both ways. Single crowns mostly darken their
        // gaps, since bright tops on that scale read as a scatter of dots.
        float lift = k == 0 ? (dome - 0.6) * 0.45 : (dome - 0.85) * 0.4;
        shadeMul += s * keep * (lift + tone * dome);
        bump += s * keep * cell.yz * (dome * (1.0 - dome)) / size * (k == 0 ? 0.12 : 0.05);
      }
      // Clearings show the ground between the trees.
      albedo = mix(albedo, uBiomeClearing, s * thin * 0.5);
    }
    // Grass: lighter and darker patches with a fine grain.
    if (pw[${P.grass}] > 0.02) {
      float s = pw[${P.grass}];
      shadeMul += s * (broad.x * 0.2 + fine.x * 0.16);
      bump += s * fine.yz * 0.05;
      albedo = mix(albedo, albedo * vec3(1.12, 1.05, 0.8), s * smoothstep(0.0, 0.5, broad.x));
    }
    // Scrub: bare ground with dark bushes dotted over it.
    if (pw[${P.scrub}] > 0.02) {
      float s = pw[${P.scrub}];
      shadeMul += s * (broad.x * 0.15 + fine.x * 0.14);
      bump += s * fine.yz * 0.04;
      float keep = tShow(0.1, footprint);
      if (keep > 0.0) {
        vec4 cell = tCell(p / 0.3 + 3.7);
        float bush = (1.0 - smoothstep(0.1, 0.28, cell.x)) * step(0.4, cell.w) * keep;
        albedo = mix(albedo, albedo * vec3(0.42, 0.55, 0.38), s * bush);
        bump += s * bush * (1.0 - bush) * cell.yz * 1.2;
      }
    }
    // Sand: smooth, with wind ripples.
    if (pw[${P.sand}] > 0.02) {
      float s = pw[${P.sand}];
      float phase = dot(p, wind) / 0.05 + broad.x * 6.0 + fine.x * 2.0;
      float ripple = sin(phase) * tShow(0.15, footprint);
      shadeMul += s * (ripple * 0.05 + fine.x * 0.08 + broad.x * 0.08);
      bump += s * fine.yz * 0.02;
    }
    // Dunes: ridges with a long windward side and a short slip face, thinning
    // into flat pans, with bare rock showing through in places.
    if (pw[${P.dunes}] > 0.02) {
      float s = pw[${P.dunes}];
      vec3 pans = tField(p + 71.0, 7.0, 2, footprint);
      float field = smoothstep(-0.45, 0.1, pans.x);
      float outcrop = smoothstep(0.5, 0.75, pans.x + fine.x * 0.25);
      for (int k = 0; k < 2; k++) {
        float size = k == 0 ? 2.4 : 0.5;
        float keep = tShow(size * 0.3, footprint);
        if (keep <= 0.0) break;
        float sway = k == 0 ? 0.45 : 0.7;
        float ph = dot(p, wind) / size + (broad.x + pans.x) * sway + float(k) * 0.37;
        vec2 gph = wind / size + (broad.yz + pans.yz) * sway;
        float f = fract(ph);
        float t = f < 0.65 ? f / 0.65 : (1.0 - f) / 0.35;
        float rise = f < 0.65 ? 1.0 / 0.65 : -1.0 / 0.35;
        float hgt = t * t * (3.0 - 2.0 * t);
        float amp = (k == 0 ? 0.2 : 0.1) * size * field * (1.0 - outcrop) * keep;
        bump += s * amp * 6.0 * t * (1.0 - t) * rise * gph;
        shadeMul += s * (hgt - 0.5) * 0.14 * field * keep;
      }
      shadeMul += s * (fine.x * 0.08 + pans.x * 0.06);
      bump += s * fine.yz * 0.02;
      albedo = mix(albedo, mix(uBiomeSteep[0], uBiomeSteep[1], 0.5 + fine.x * 0.5), s * outcrop * 0.8);
      pw[${P.rock}] += s * outcrop;
    }
    // Dust: fine grain, wind streaks and loose stones.
    if (pw[${P.dust}] > 0.02) {
      float s = pw[${P.dust}];
      shadeMul += s * (broad.x * 0.14 + fine.x * 0.14);
      bump += s * fine.yz * 0.04;
      vec3 streak = tSimplex(vec2(dot(p, wind) / 3.0, dot(p, across) / 0.3));
      shadeMul += s * streak.x * 0.07 * tShow(0.3, footprint);
      float keep = tShow(0.05, footprint);
      if (keep > 0.0) {
        vec4 cell = tCell(p / 0.14 + 9.1);
        float stone = (1.0 - smoothstep(0.08, 0.2 + 0.1 * cell.w, cell.x)) * step(0.62, cell.w) * keep;
        albedo = mix(albedo, albedo * 0.55, s * stone);
        bump -= s * stone * (1.0 - stone) * cell.yz * 2.0;
      }
    }
    // Regolith: grey grain pitted with small flat-floored craters.
    if (pw[${P.regolith}] > 0.02) {
      float s = pw[${P.regolith}];
      shadeMul += s * (broad.x * 0.1 + fine.x * 0.12);
      bump += s * fine.yz * 0.04;
      for (int k = 0; k < 3; k++) {
        float size = k == 0 ? 1.3 : k == 1 ? 0.45 : 0.16;
        float keep = tShow(size * 0.25, footprint);
        if (keep <= 0.0) break;
        vec4 cell = tCell(p / size + float(k) * 5.3);
        float radius = 0.1 + 0.2 * fract(cell.w * 7.0);
        float u = cell.x / radius;
        float has = step(0.5, cell.w) * keep;
        // A flat floor, a wall up to the rim, and the rim's outer slope.
        float wall = clamp((u - 0.55) / 0.45, 0.0, 1.0);
        float outer = clamp((u - 1.0) / 0.5, 0.0, 1.0);
        float slope = u < 1.0
          ? 6.0 * wall * (1.0 - wall) / 0.45 * 1.3
          : -6.0 * outer * (1.0 - outer) / 0.5 * 0.3;
        bump += s * has * 0.22 * slope * cell.yz;
        shadeMul -= s * has * 0.07 * (1.0 - wall);
      }
    }
    // Salt pan: a flat white crust cracked into polygons.
    if (pw[${P.salt}] > 0.02) {
      float s = pw[${P.salt}];
      float keep = tShow(0.12, footprint);
      shadeMul += s * broad.x * 0.06;
      if (keep > 0.0) {
        vec4 plate = tPlates((p + bend) / 0.6 + 21.0);
        float crack = 1.0 - smoothstep(0.01, 0.035 + footprint / 0.6, plate.x);
        shadeMul += s * keep * ((plate.y - 0.5) * 0.06 - crack * 0.14);
        // The crust curls up a little at each crack.
        float lip = smoothstep(0.2, 0.04, plate.x) * (1.0 - crack);
        shadeMul += s * keep * lip * 0.06;
      }
    }
    // Basalt: dark blocks, each its own tone, with deep joints between them.
    if (pw[${P.basalt}] > 0.02) {
      float s = pw[${P.basalt}];
      shadeMul += s * (fine.x * 0.22 + broad.x * 0.15);
      bump += s * fine.yz * 0.07;
      float keep = tShow(0.1, footprint);
      if (keep > 0.0) {
        vec4 plate = tPlates((p + bend) / 0.55 + 4.0);
        float crack = 1.0 - smoothstep(0.02, 0.07 + footprint / 0.55, plate.x);
        shadeMul += s * keep * ((plate.y - 0.5) * 0.4 - crack * 0.45);
        bump -= s * keep * crack * (1.0 - crack) * plate.zw * 2.0;
      }
    }
    // Cooled flows: ropes of black lava lying along the way it ran.
    if (pw[${P.flows}] > 0.02) {
      float s = pw[${P.flows}];
      vec3 run = tSimplex(p / 2.2 + broad.x * 0.25 + 61.0);
      float ph = run.x * 22.0 + fine.x * 1.2;
      vec2 gph = run.yz * 22.0 / 2.2;
      float keep = 1.0 - smoothstep(0.6, 1.6, length(gph) * footprint);
      shadeMul += s * (sin(ph) * 0.2 * keep + fine.x * 0.15 + broad.x * 0.12);
      bump += s * keep * cos(ph) * gph * 0.02 + s * fine.yz * 0.04;
    }
    // Ash: soft drifts with next to no grain.
    if (pw[${P.ash}] > 0.02) {
      float s = pw[${P.ash}];
      shadeMul += s * (broad.x * 0.12 + fine.x * 0.05);
      bump += s * broad.yz * 0.12;
    }
    // Bare ice: blue and glassy, with white hairline cracks.
    if (pw[${P.ice}] > 0.02) {
      float s = pw[${P.ice}];
      shadeMul += s * broad.x * 0.08;
      albedo = mix(albedo, albedo * vec3(0.72, 0.86, 1.0), s * smoothstep(0.2, -0.5, broad.x));
      for (int k = 0; k < 2; k++) {
        float size = k == 0 ? 1.4 : 0.4;
        float keep = tShow(size * 0.06, footprint);
        if (keep <= 0.0) break;
        vec4 plate = tPlates((p + bend * 1.5) / size + float(k) * 13.0);
        float crack = 1.0 - smoothstep(0.0, 0.012 + footprint / size, plate.x);
        // Only some plates are cracked through, so the lines stop and start.
        crack *= step(0.45, plate.y);
        albedo = mix(albedo, vec3(0.9, 0.95, 1.0), s * keep * crack * (k == 0 ? 0.55 : 0.3));
      }
      spec += s * pow(glint, 60.0) * 0.3;
    }
    // Snow: smooth, with soft drifts and ridges cut by the wind, and none on
    // the steepest faces.
    if (pw[${P.snow}] > 0.02) {
      float s = pw[${P.snow}];
      shadeMul += s * broad.x * 0.06;
      bump += s * broad.yz * 0.2;
      vec3 cut = tSimplex(vec2(dot(p, wind) / 1.1, dot(p, across) / 0.16) + 17.0);
      bump += s * tShow(0.16, footprint) * across * cut.z / 0.16 * 0.012;
      albedo = mix(albedo, uBiomeSteep[0], s * smoothstep(0.2, 0.32, 1.0 - n.y));
    }
    // Tundra: dark heath and pale lichen in patches.
    if (pw[${P.tundra}] > 0.02) {
      float s = pw[${P.tundra}];
      shadeMul += s * (fine.x * 0.2 + broad.x * 0.12);
      bump += s * fine.yz * 0.05;
      vec3 patches = tField(p + 47.0, 0.9, 2, footprint);
      albedo = mix(albedo, albedo * vec3(0.7, 0.76, 0.62), s * smoothstep(0.1, 0.45, patches.x));
      albedo = mix(albedo, albedo * vec3(1.22, 1.22, 1.16), s * smoothstep(0.15, 0.5, -patches.x));
    }
    // Cracked ground: dried mud in small curled plates.
    if (pw[${P.cracked}] > 0.02) {
      float s = pw[${P.cracked}];
      shadeMul += s * (fine.x * 0.12 + broad.x * 0.14);
      bump += s * fine.yz * 0.03;
      float keep = tShow(0.05, footprint);
      if (keep > 0.0) {
        vec4 plate = tPlates((p + bend * 0.6) / 0.24 + 33.0);
        float crack = 1.0 - smoothstep(0.015, 0.06 + footprint / 0.24, plate.x);
        // The cracks open wide in places and close up in others.
        crack *= smoothstep(-0.5, 0.3, broad.x + fine.x * 0.5);
        shadeMul += s * keep * ((plate.y - 0.5) * 0.12 - crack * 0.28);
        bump -= s * keep * crack * (1.0 - crack) * plate.zw * 1.2;
      }
    }
    // Earth: clods, damp dark patches and stones.
    if (pw[${P.earth}] > 0.02) {
      float s = pw[${P.earth}];
      shadeMul += s * (fine.x * 0.22 + broad.x * 0.1);
      bump += s * fine.yz * 0.07;
      vec3 damp = tField(p + 83.0, 1.6, 2, footprint);
      albedo = mix(albedo, albedo * vec3(0.62, 0.6, 0.58), s * smoothstep(0.15, 0.5, damp.x));
      float keep = tShow(0.05, footprint);
      if (keep > 0.0) {
        vec4 cell = tCell(p / 0.16 + 2.9);
        float stone = (1.0 - smoothstep(0.08, 0.22, cell.x)) * step(0.7, cell.w) * keep;
        albedo = mix(albedo, albedo * 1.35, s * stone);
        bump -= s * stone * (1.0 - stone) * cell.yz * 2.0;
      }
    }
    // Rock, scree and mesa, and any steep slope: creased stone in layers. It
    // is drawn from the point in space, not from above, so it does not smear
    // down a cliff.
    float crag = max(pw[${P.rock}] + pw[${P.scree}] + pw[${P.mesa}] * 0.5, steep);
    if (crag > 0.02) {
      vec3 squash = vec3(1.0, 1.3, 1.0);
      vec4 stone = vec4(0.0);
      float size = 1.3;
      float amp = 1.0;
      for (int k = 0; k < 6; k++) {
        float keep = tShow(size, footprint);
        if (keep <= 0.0) break;
        vec4 sn = tSimplex3(vTerrainPos * squash / size + float(k) * 13.1);
        // Creases where the noise crosses zero.
        stone += vec4(0.5 - abs(sn.x), -sign(sn.x) * sn.yzw * squash / size) * amp * keep;
        size *= 0.5;
        // The finer creases are shallower, or the stone reads as fur.
        amp *= 0.4;
      }
      shadeMul += crag * (stone.x * 0.45 + broad.x * 0.12);
      bump3 += crag * stone.yzw * 0.16;
      albedo = mix(albedo, mix(uBiomeSteep[0], uBiomeSteep[1], 0.5 + broad.x * 0.5), steep * (1.0 - pw[${P.snow}]) * 0.85);
      // Layers by height, which show on a slope and not on the level.
      float layer = vTerrainPos.y * 16.0;
      float keepLayer = 1.0 - smoothstep(0.8, 2.0, fwidth(layer));
      float band = sin(layer + stone.x * 1.5 + broad.x * 2.0) * keepLayer;
      float tilt = smoothstep(0.03, 0.15, 1.0 - n.y);
      shadeMul += (steep * 0.1 + pw[${P.mesa}] * tilt * 0.25) * band;
      shadeMul += pw[${P.mesa}] * fine.x * 0.12;
      // Scree is the same stone broken small.
      float keep = tShow(0.04, footprint);
      if (pw[${P.scree}] > 0.02 && keep > 0.0) {
        vec4 cell = tCell(p / 0.11 + 6.1);
        shadeMul += pw[${P.scree}] * keep * (cell.w - 0.5) * 0.45 * (1.0 - smoothstep(0.15, 0.45, cell.x));
      }
    }
    // Lava: plates of dark crust adrift on the melt, which glows in the gaps
    // between them. Rafts of crust in places, open melt in others.
    if (pw[${P_LAVA}] > 0.01) {
      float s = pw[${P_LAVA}];
      vec3 rafts = tField(p + 113.0, 9.0, 2, footprint);
      float cover = smoothstep(-1.0, -0.15, rafts.x + broad.x * 0.3);
      float keepA = tShow(0.2, footprint);
      float keepB = tShow(0.06, footprint);
      float crust = cover * 0.8;
      float heat = 0.0;
      float tone = 1.0;
      if (keepA > 0.0) {
        vec4 big = tPlates((p + bend * 2.5) / 1.9);
        // Open melt where the crust is thin, hairline cracks where it is not.
        float gap = mix(0.3, 0.012, cover);
        float plates = smoothstep(gap, gap + 0.02 + footprint / 1.9, big.x);
        heat = exp(-max(big.x - gap, 0.0) * 14.0);
        tone = 0.7 + 0.6 * big.y;
        if (keepB > 0.0) {
          // Finer cracks, in some of the plates only.
          vec4 small = tPlates((p + bend) / 0.45 + 9.0);
          float gapB = 0.01 + 0.03 * (1.0 - cover);
          float open = step(0.4, small.y) * keepB;
          plates *= 1.0 - open * (1.0 - smoothstep(gapB, gapB + 0.03 + footprint / 0.45, small.x));
          heat = max(heat, exp(-max(small.x - gapB, 0.0) * 16.0) * open * 0.5);
        }
        // Far off the plates are too small to draw, and the sea is their mix.
        crust = mix(crust, plates, keepA);
        heat *= keepA;
      }
      vec3 rock = vec3(0.06, 0.05, 0.05) * tone * (1.0 + fine.x * 0.4);
      rock += vec3(0.6, 0.1, 0.01) * heat * 0.4;
      vec3 melt = vec3(1.0, 0.3, 0.03) * (1.0 + 0.3 * broad.x + 0.15 * fine.x);
      melt = mix(melt, vec3(1.0, 0.62, 0.16), 0.35 * smoothstep(0.0, 0.6, broad.x));
      albedo = mix(albedo, mix(melt, rock, crust), s);
      unlit = max(unlit, s * (1.0 - crust));
      bump += s * crust * fine.yz * 0.08;
    }
    // Sea ice: a pale sheet with darker thin patches, dark cracks between its
    // floes, and white ridges where floes have been pushed together.
    if (pw[${P_SEA_ICE}] > 0.01) {
      float s = pw[${P_SEA_ICE}];
      vec3 thick = tField(p + 131.0, 8.0, 3, footprint);
      float thin = smoothstep(0.0, -0.9, thick.x);
      albedo = mix(albedo, albedo * vec3(0.66, 0.78, 0.86), s * thin * 0.8);
      shadeMul += s * broad.x * 0.05;
      float keepA = tShow(0.12, footprint);
      if (keepA > 0.0) {
        vec4 floe = tPlates((p + bend * 2.0) / 3.0);
        float crack = 1.0 - smoothstep(0.0, 0.012 + footprint / 3.0, floe.x);
        albedo = mix(albedo, vec3(0.1, 0.2, 0.3), s * keepA * crack * 0.85);
        shadeMul += s * keepA * (floe.y - 0.5) * 0.07;
      }
      float keepB = tShow(0.1, footprint);
      if (keepB > 0.0) {
        vec4 press = tPlates((p + bend) / 1.2 + 31.0);
        float ridge = (1.0 - smoothstep(0.0, 0.07 + footprint / 1.2, press.x)) * step(0.5, press.y) * (1.0 - thin) * keepB;
        albedo = mix(albedo, vec3(0.95, 0.97, 1.0), s * ridge * 0.6);
        bump += s * ridge * (1.0 - ridge) * press.zw * 1.6;
      }
      spec += s * pow(glint, 50.0) * 0.1;
    }

    // Water: ripples, a glint of the sun, and foam where it meets the land.
    vec3 wave = liquid > 0.01 ? tField(p + 11.0, 0.6, 3, footprint) : vec3(0.0);
    float foam = smoothstep(0.03, 0.2, coast) * (1.0 - smoothstep(0.3, 0.5, coast));
    foam *= smoothstep(-0.3, 0.4, fine.x);
    // Only a liquid sea ripples, foams and glints.
    foam *= uSeaLiquid;
    // Coasts past the edge are drawn at half the map's resolution, and foam
    // traces their steps, so it thins out there.
    foam *= 1.0 - smoothstep(0.0, 0.03, terrainPast);
    bump = mix(bump, wave.yz * 0.03, liquid);
    bump3 *= 1.0 - liquid;
    shadeMul = mix(shadeMul, 1.0 + wave.x * 0.08, liquid);

    albedo *= max(shadeMul, 0.2);
    albedo = mix(albedo, vec3(0.85, 0.9, 0.92), foam * 0.75);
    n = normalize(n + vec3(-bump.x, 0.0, -bump.y) - (bump3 - n * dot(bump3, n)));

    vec3 h = normalize(view + uTerrainSun);
    spec += pow(max(dot(n, h), 0.0), 40.0) * 0.08 * liquid * (1.0 - foam);
  }

  // Roads (groundShader.ts), when the sheet has them.
  GROUND_BODY_HERE

  float facing = max(dot(n, uTerrainSun), 0.0);
  float shade = uTerrainAmbient + (1.0 - uTerrainAmbient) * (facing / uTerrainSun.y);
  vec3 lit = albedo * mix(shade, 1.0, unlit) + spec + glow;
  GROUND_LIT_HERE
  if (terrainPast > 0.0) {
    // Past the edge the land turns a little greyer and darker, so the map
    // reads as the map, then everything hazes into the background until it
    // is gone. The change is spread over a third of the haze, since a quick
    // one draws the very line at the edge it is meant to soften. The sea is
    // left its colour, as a greyer sea is only a frame drawn on the water.
    float beyond = smoothstep(0.0, uTerrainHaze / 3.0, terrainPast);
    float landHere = smoothstep(0.35, 0.65, nh.a * 255.0) * uTerrainGreyBeyond;
    float grey = dot(lit, vec3(0.2126, 0.7152, 0.0722));
    lit = mix(lit, vec3(grey), 0.35 * beyond * landHere);
    lit *= 1.0 - 0.12 * beyond * landHere;
    lit = mix(lit, uTerrainFar, smoothstep(0.0, uTerrainHaze, terrainPast));
  }
  diffuseColor.rgb = lit;
}
`;

/** Seas that ripple, foam and glint. The rest are drawn as the picture has them. */
const LIQUID_SEAS: readonly SeaLook[] = ["water", "acid"];

/**
 * Add the terrain's lighting and detail to `material`, an unlit material
 * carrying the map picture. The material must not also use vertex shading.
 */
export function applyTerrainShader(
  material: THREE.MeshBasicMaterial,
  shading: TerrainShading,
  disposables: { dispose(): void }[],
): void {
  const placeholder = new THREE.DataTexture(
    new Uint8Array([128, 255, 128, 0]),
    1,
    1,
  );
  placeholder.needsUpdate = true;
  disposables.push(placeholder);
  // Detail tells sea from land by the height the normals carry, so without
  // them it would read every pixel as sea. It reads the biome weights too.
  const detail =
    shading.detail && shading.biomes !== null && shading.normals !== null;
  const planet = shading.biomes ? planetOf(shading.biomes.planet) : null;
  const colour = (rgb: [number, number, number]) =>
    new THREE.Color().setRGB(
      rgb[0] / 255,
      rgb[1] / 255,
      rgb[2] / 255,
      THREE.SRGBColorSpace,
    );
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrainNormals = {
      value: shading.normals ?? placeholder,
    };
    shader.uniforms.uTerrainRelief = { value: shading.normals ? 1 : 0 };
    shader.uniforms.uTerrainDetail = { value: detail ? 1 : 0 };
    // Weights are bound only when the detail will read them.
    shader.uniforms.uBiomeA = {
      value: detail && shading.biomes ? shading.biomes.a : placeholder,
    };
    shader.uniforms.uBiomeB = {
      value: detail && shading.biomes ? shading.biomes.b : placeholder,
    };
    shader.uniforms.uBiomePattern = {
      value: Array.from({ length: BIOME_SLOTS }, (_, k) =>
        planet && k < planet.biomes.length
          ? PATTERN_INDEX[planet.biomes[k].pattern]
          : -1,
      ),
    };
    shader.uniforms.uBiomeSteep = {
      value: (
        planet?.steep ?? [
          [0, 0, 0],
          [0, 0, 0],
        ]
      ).map(colour),
    };
    shader.uniforms.uBiomeClearing = {
      value: colour(planet?.clearing ?? [0, 0, 0]),
    };
    shader.uniforms.uSeaLiquid = {
      value: planet && !LIQUID_SEAS.includes(planet.sea.look) ? 0 : 1,
    };
    shader.uniforms.uSeaPattern = {
      value: (planet && SEA_PATTERN[planet.sea.look]) ?? -1,
    };
    shader.uniforms.uBiomeColour = {
      value: Array.from({ length: BIOME_SLOTS }, (_, k) =>
        colour(planet?.biomes[k]?.colour ?? [0, 0, 0]),
      ),
    };
    const frame = shading.frame;
    shader.uniforms.uTerrainFrame = {
      value: frame
        ? new THREE.Vector4(frame.halfX, frame.halfZ, frame.width, frame.depth)
        : new THREE.Vector4(),
    };
    shader.uniforms.uTerrainHaze = { value: frame ? frame.haze : 0 };
    shader.uniforms.uTerrainFar = {
      value: frame ? frame.far : new THREE.Color(),
    };
    shader.uniforms.uTerrainGreyBeyond = {
      value: frame?.greyBeyond ? 1 : 0,
    };
    shader.uniforms.uTerrainSun = {
      value: new THREE.Vector3(...TERRAIN_SUN),
    };
    shader.uniforms.uTerrainAmbient = { value: SHADE_AMBIENT };
    // Roads (groundShader.ts).
    if (shading.ground) {
      Object.assign(shader.uniforms, groundUniforms(shading.ground));
    }
    shader.vertexShader = `${VERTEX_HEAD}${shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n${VERTEX_BODY}`,
    )}`;
    const body = FRAGMENT_BODY.replace(
      "GROUND_BODY_HERE",
      shading.ground ? GROUND_BODY : "",
    ).replace("GROUND_LIT_HERE", shading.ground ? GROUND_LIT : "");
    shader.fragmentShader = `${FRAGMENT_HEAD.replace("TERRAIN_NOISE_HERE", TERRAIN_NOISE)}${shading.ground ? GROUND_HEAD : ""}${shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>\n${body}`,
    )}`;
  };
  // One program for every terrain with the same switches.
  material.customProgramCacheKey = () =>
    `terrain:${shading.normals ? 1 : 0}:${detail ? 1 : 0}${shading.ground ? ":ground" : ""}`;
}
