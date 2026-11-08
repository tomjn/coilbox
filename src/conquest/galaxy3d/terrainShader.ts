import * as THREE from "three";
import {
  BIOME_SLOTS,
  type BiomePattern,
  type PlanetId,
  planetOf,
  type Rgb,
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
 * - Cavity fields read from the heightmap (`terrainCavityPixels`) shade the
 *   land by its shape: pale rims and dark crevices on rock, scree below steep
 *   faces, strata on them, bare rock through snow on ridges, blue hollows in
 *   snow and ice, and a wet band at the water line. Only the bake reads them.
 *
 * Display only. Nothing here feeds play or the generator.
 */

/** What the shader is given beyond the picture. */
export interface TerrainShading {
  /** {@link terrainNormalPixels} as a texture, or null for a flat sheet. */
  normals: THREE.Texture | null;
  /**
   * {@link terrainCavityPixels} as a texture. Read only by the bake, which
   * draws the detail, so it costs a frame nothing once the bake is done.
   */
  cavity?: THREE.Texture | null;
  /**
   * The land's `Drainage` as a texture: how much water runs through each
   * pixel in red and how steep its course is in green. Read only by the bake,
   * which draws gullies along it. Left out, no gullies are drawn.
   */
  drainage?: THREE.Texture | null;
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
  /**
   * The detail drawn once into a picture and read from it (`terrainBake.ts`).
   * Left out, the detail is worked out for every pixel of every frame.
   */
  bake?: TerrainBakeShading;
}

/**
 * `draw`: the material that draws the detail into the picture, with no
 * roads, haze or glint. `rect` is the part of the map picture's coordinates
 * the picture covers, as x, y, width and height, and the bake moves it from
 * one picture to the next.
 *
 * `read`: the material the sheet is drawn with, which reads the picture.
 * Until `ready` is 1 it draws the map picture lit by its relief, as
 * performance mode does.
 */
export type TerrainBakeShading =
  | { kind: "draw"; rect: { value: THREE.Vector4 } }
  | {
      kind: "read";
      look: THREE.Texture;
      rect: THREE.Vector4;
      ready: { value: number };
    };

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
uniform sampler2D uTerrainCavity;
uniform sampler2D uTerrainDrainage;
uniform float uTerrainRelief;
uniform float uTerrainDetail;
uniform sampler2D uBiomeA;
uniform sampler2D uBiomeB;
uniform float uBiomePattern[8];
uniform vec3 uBiomeSteep[2];
uniform vec3 uBiomeClearing;
uniform vec3 uBiomeColour[8];
uniform float uSeaLiquid;
uniform float uTerrainFrost;
uniform float uSeaPattern;
uniform vec3 uTerrainSun;
uniform float uTerrainAmbient;
uniform vec4 uTerrainFrame;
uniform float uTerrainHaze;
uniform vec3 uTerrainFar;
uniform float uTerrainGreyBeyond;
// Rivers (rivers.ts): how far the nearest river's edge is, over the same
// picture as vTerrainUv, as a share of uRiverSpan's two reaches.
uniform sampler2D uRiverField;
uniform float uRiverOn;
uniform float uRiverFrozen;
uniform vec2 uRiverSpan;
uniform vec3 uForest[6];
uniform float uForestAutumn;
varying vec2 vTerrainUv;
varying vec3 vTerrainPos;
TERRAIN_NOISE_HERE
FOREST_HERE
`;

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
  taiga: 19,
};
const P = PATTERN_INDEX;
/** Two patterns only a sea draws with, after the land's. */
const P_LAVA = 20;
const P_SEA_ICE = 21;
const PATTERN_COUNT = 22;

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
// How much of the sun's glint on water this pixel shows, for the bake.
float sheen = 0.0;
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

  SURFACE_HERE

  // Roads (groundShader.ts), when the sheet has them.
  GROUND_BODY_HERE

  float facing = max(dot(n, uTerrainSun), 0.0);
  float shade = uTerrainAmbient + (1.0 - uTerrainAmbient) * (facing / uTerrainSun.y);
  vec3 lit = albedo * mix(shade, 1.0, unlit) + spec + glow;
  GROUND_LIT_HERE
  HAZE_HERE
  diffuseColor.rgb = lit;
}
BAKE_ALPHA_HERE
`;

/** Tree crowns for the forest in {@link DETAIL}. */
const FOREST = /* glsl */ `
// One tree of the canopy at q, in cells of the crown grid: its height 0 to 1,
// its slope, and a random 0 to 1 for the tree. A cell holds a tree when its
// random number is below density. cone 0 is a rounded broadleaf crown, 1 a
// pointed conifer. reach is the crown's radius in cells. star 0 to 1 gives
// the crown the ragged outline of a spruce's branches seen from above.
vec4 tCrown(vec2 q, float density, float cone, float reach, float star) {
  vec4 cell = tCell(q);
  float r0 = reach * (0.75 + 0.5 * fract(cell.w * 13.7));
  float angle = atan(cell.z, cell.y) * 7.0 + cell.w * 40.0;
  float r = r0 * (1.0 + star * 0.22 * sin(angle));
  float u = cell.x / r;
  if (cell.w >= density || u >= 1.0) return vec4(0.0, 0.0, 0.0, cell.w);
  float dome = sqrt(1.0 - u * u);
  float h = mix(dome, 1.0 - u, cone);
  float dh = mix(-u / max(dome, 0.3), -1.0, cone) / r;
  // A ragged cone also slopes round the crown, so each branch is lit apart.
  float dr = r0 * star * 0.22 * 7.0 * cos(angle);
  return vec4(h, cell.yz * dh + vec2(-cell.z, cell.y) * cone * dr / (r * r), cell.w);
}

// The canopy's colour at q, in cells of one crown grid, lit by the sun: each
// crown its own colour, bright on its sunward side, with the shadows of the
// crowns toward the sun cast over it or over the ground between. kind is 0
// for broadleaf and 1 for conifer. between is the ground under the trees.
vec3 tCanopy(vec2 q, float density, float kind, vec3 between, float turning, float frost) {
  float reach = mix(0.62, 0.5 + 0.28 * frost, kind);
  // How tall a crown stands against its width, for its shadow and slope.
  float tall = mix(0.7, 1.5, kind);
  vec2 sunAt = normalize(uTerrainSun.xz);
  float sunRise = uTerrainSun.y / length(uTerrainSun.xz);
  vec4 crown = tCrown(q, density, kind, reach, frost * kind);
  float pick = fract(crown.w * 31.7);
  vec3 own = mix(mix(uForest[1], uForest[0], pick), mix(uForest[3], uForest[2], pick), kind);
  // In a turning stand most crowns turn, each its own shade of it.
  own = mix(own, mix(uForest[4], uForest[5], fract(crown.w * 7.3)), turning * step(fract(crown.w * 3.9), 0.85));
  vec3 cn = normalize(vec3(-crown.y * tall, 1.0, -crown.z * tall));
  float lightC = clamp(dot(cn, uTerrainSun) / uTerrainSun.y, 0.25, 1.4);
  float shadow = 0.0;
  for (int j = 1; j <= 2; j++) {
    float t = float(j) * 0.32;
    vec4 other = tCrown(q + sunAt * t, density, kind, reach, frost * kind);
    shadow = max(shadow, smoothstep(0.0, 0.15, other.x - crown.x - t * sunRise / tall));
  }
  float isCrown = smoothstep(0.0, 0.08, crown.x);
  // On a cold world snow lies thickest at the top and sunward side of a
  // conifer's crown, so each crown is white over its dark needles, warm where
  // the sun lights it and blue on its shaded side. A bare broadleaf tree is
  // twigs over the snow.
  float snowy = smoothstep(0.5, 0.9, crown.x * 0.6 + lightC * 0.35 + (fract(crown.w * 5.1) - 0.5) * 0.35 + tSimplex(q * 2.3).x * 0.12);
  vec3 snowCol = mix(vec3(0.78, 0.87, 1.05), vec3(1.14, 1.0, 0.78), smoothstep(0.75, 1.25, lightC));
  own = mix(own, snowCol, frost * kind * snowy * 0.75);
  isCrown *= 1.0 - frost * (1.0 - kind) * 0.35;
  // Low on a crown and in the gaps the light is cut by the crowns round.
  float occlude = mix(mix(0.55, 0.8, frost * kind), 1.0, sqrt(crown.x));
  // Under a closed cold canopy the snow lies in the trees' shade.
  vec3 floorLit = between * mix(0.7, 1.0, 1.0 - density * 0.6) * mix(1.0, 0.5, frost * kind * density);
  vec3 near = mix(floorLit, own * lightC * occlude, isCrown);
  near *= 1.0 - shadow * mix(0.55, 0.4, isCrown);
  // Shade on snow is blue, lit by the sky.
  return near * mix(vec3(1.0), vec3(0.82, 0.92, 1.12), frost * max(shadow, 1.0 - isCrown));
}
`;

/** Procedural detail by biome. Drawn once into the baked picture. */
const DETAIL = /* glsl */ `
  if (uTerrainDetail > 0.5) {
    vec2 p = vTerrainPos.xz;
    float footprint = (max(length(dFdx(p)), length(dFdy(p))) + 1e-5) * FOOTPRINT_SCALE;
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
    // How far the nearest river's water is (rivers.ts), in world units,
    // below 0 on it. A river's own valley is grassed and not bare rock, so
    // its sides are steep only where the hills around it are.
    float rEdge = 1.0;
    if (uRiverOn > 0.5) {
      rEdge = texture2D(uRiverField, vTerrainUv).r * (uRiverSpan.x + uRiverSpan.y) - uRiverSpan.x;
      steep *= smoothstep(0.2, uRiverSpan.y, rEdge);
    }

    // The ground's shape from the heightmap: -1 to 1 for how far it stands
    // proud of its surroundings close in (edges and ridges up, gullies down)
    // and wide out (domes up, basins down), then how much steep face and how
    // much sea lie within reach, 0 to 1.
    vec4 cav = tSmooth(uTerrainCavity, vTerrainUv);
    float cavFine = cav.r * 2.0 - 1.0;
    float cavCoarse = cav.g * 2.0 - 1.0;
    float faceNear = cav.b;
    float seaNear = cav.a;

    // Scree gathers on ground level enough to hold it, low against its
    // surroundings, with a steep face close above. It covers whatever grows
    // there, so the other patterns give way to it.
    float level = 1.0 - smoothstep(0.1, 0.24, 1.0 - n.y);
    float talus = level * smoothstep(0.04, 0.3, faceNear) * smoothstep(0.15, -0.15, cavCoarse) * land * (1.0 - steep);
    // The drop to the sea counts as a face, but the shore is left to the wet
    // band.
    talus = smoothstep(0.0, 0.5, talus) * (1.0 - pw[${P.snow}]) * (1.0 - smoothstep(0.02, 0.2, seaNear));
    // Nor along a river's valley floor, which is grassed.
    talus *= smoothstep(0.2, uRiverSpan.y, rEdge);
    for (int k = 0; k < ${PATTERN_COUNT}; k++) pw[k] *= 1.0 - talus;
    pw[${P.scree}] += talus;

    // Gullies, along the courses water runs down a hillside. They start thin
    // where enough ground drains into them and widen downstream as more joins.
    // Flat ground is left alone. Trees and bushes thin out along them, and
    // whatever grows is drawn darker there, so each reads as one line.
    vec2 drain = tSmooth(uTerrainDrainage, vTerrainUv).rg;
    float gully = smoothstep(0.06, 0.15, drain.r) * smoothstep(0.1, 0.5, drain.g) * land * (1.0 - 0.6 * steep);
    // The trees part along a gully and show the ground beneath.
    albedo = mix(albedo, uBiomeClearing, pw[${P.forest}] * gully * 0.6);
    pw[${P.forest}] *= 1.0 - gully * 0.8;
    pw[${P.taiga}] *= 1.0 - gully * 0.8;
    pw[${P.scrub}] *= 1.0 - gully * 0.8;

    // Rivers. The field gives the distance to the water's edge in world
    // units, below 0 on the water. Water draws over whatever grows, with a
    // band of wet ground along each bank as at the shore. Where the ground
    // is as dry as dunes or salt, the bed has run dry and shows as a pale
    // wash. Desert ground beside running water is greener.
    float river = 0.0;
    float riverBank = 0.0;
    float riverDry = 0.0;
    float riverGreen = 0.0;
    if (rEdge < uRiverSpan.y - 0.005) {
      float rSoft = max(footprint * 0.6, 0.003);
      river = (1.0 - smoothstep(-rSoft, rSoft, rEdge)) * land;
      float dry = (pw[${P.dunes}] + pw[${P.sand}] + pw[${P.salt}] + pw[${P.dust}] + pw[${P.cracked}] + 0.5 * pw[${P.scrub}]) / max(land, 1e-3);
      riverDry = smoothstep(0.75, 0.95, dry);
      // Wet ground at the water's edge, then damp ground fading out up the
      // bank, ragged along the river.
      float wetW = 0.02 + 0.012 * fine.x;
      float dampW = 0.16 + 0.08 * fine.x + 0.06 * broad.x;
      riverBank = max(1.0 - smoothstep(0.0, wetW + rSoft, rEdge), 0.45 * (1.0 - smoothstep(0.0, dampW, rEdge))) * (1.0 - river) * land;
      riverGreen = (1.0 - smoothstep(0.02, 0.14 + 0.06 * broad.x, rEdge)) * (1.0 - river) * land * smoothstep(0.25, 0.5, dry) * (1.0 - riverDry);
      pw[${P.forest}] *= 1.0 - river;
      pw[${P.taiga}] *= 1.0 - river;
      pw[${P.scrub}] *= 1.0 - max(river, riverGreen);
    }

    float shadeMul = 1.0;
    // Light and dark from the ground's shape: strata, rims, crevices and
    // scree. Set as it should look on screen, and turned into linear light
    // below, since a step in linear light shows as about half as much.
    float form = 1.0;
    // The slope each pattern adds, seen from above, and for rock in space.
    vec2 bump = vec2(0.0);
    vec3 bump3 = vec3(0.0);
    vec2 wind = normalize(vec2(0.85, 0.5));
    vec2 across = vec2(-wind.y, wind.x);
    vec3 view = normalize(cameraPosition - vTerrainPos);
    float glint = max(dot(n, normalize(view + uTerrainSun)), 0.0);

    // Forest: a canopy drawn as a height field of tree crowns, not as a
    // colour. Each crown is lit on its sunward side and casts a shadow on the
    // crowns or the ground beyond it, so the canopy's texture is light and
    // shade. A slow density field thins the trees into open stands, clearings
    // and lone trees, and the crowns thin out at the forest's edge too.
    float woods = pw[${P.forest}] + pw[${P.taiga}];
    if (woods > 0.02) {
      float s = min(woods, 1.0);
      float taiga = pw[${P.taiga}] / max(woods, 1e-3);
      // Conifers take the higher ground and some stands of their own. A
      // cold forest is all conifers.
      float stands = tSimplex(p / 7.0 + 23.0).x;
      float conifer = max(taiga, smoothstep(0.2, 0.32, nh.a + broad.x * 0.06) * 0.85 + smoothstep(0.35, 0.6, stands) * 0.7);
      // A cold forest has patches of bare birch among its conifers.
      conifer = min(conifer, 1.0 - taiga * smoothstep(0.35, 0.55, tSimplex(p / 2.2 + 31.0).x + fine.x * 0.2));
      conifer = clamp(conifer, 0.0, 1.0);
      // Patches of broadleaf trees turning colour, as in autumn.
      float turning = uForestAutumn * (1.0 - conifer) * smoothstep(0.2, 0.45, tSimplex(p / 3.2 + 5.0).x + fine.x * 0.15);

      // How many cells hold a tree: thick in the gullies, thinner on ridges,
      // with clearings, thinning to single trees at the edge of the forest.
      vec3 dens = tField(p + 53.0, 2.6, 3, footprint);
      float density = 0.95 + dens.x * 0.9 - smoothstep(0.15, 0.55, cavFine) * 0.45 + smoothstep(0.0, -0.3, cavFine) * 0.2;
      // Firebreaks through some conifer stands, as in a plantation.
      vec2 cut = vec2(dot(p, vec2(0.8, 0.6)), dot(p, vec2(-0.6, 0.8))) / 3.1;
      vec2 off = abs(fract(cut + fine.x * 0.04) - 0.5);
      float lane = smoothstep(0.03 + footprint / 3.1, 0.015, min(off.x, off.y) - 0.0);
      density -= lane * conifer * (1.0 - taiga) * smoothstep(0.45, 0.7, stands);
      // Cold forest is a mostly closed canopy, thinner on ridges, with small
      // snowy clearings.
      float glade = 1.0 - smoothstep(-0.65, -0.45, tField(p + 71.0, 0.9, 2, footprint).x + fine.x * 0.15);
      density = mix(density, 0.95 + dens.x * 0.3 - smoothstep(0.15, 0.55, cavFine) * 0.25 - glade * 0.75, taiga);
      density = clamp(density, 0.0, 0.97) * smoothstep(0.05, mix(0.75, 0.4, taiga), s);

      // Broadleaf and conifer crowns lie on grids of their own sizes, since
      // a grid whose size changed from place to place would stretch its
      // crowns into swirls.
      float cone = smoothstep(0.3, 0.7, conifer);
            float keepLeaf = tKeep(0.14, footprint);
      float keepNeedle = tKeep(0.1, footprint);
      float keep = mix(keepLeaf, keepNeedle, cone);

      // The palette: lit and deep colours for broadleaf and conifer crowns,
      // and the colours broadleaf trees turn.
      vec3 leaf = mix(uForest[1], uForest[0], 0.5);
      vec3 needle = mix(uForest[3], uForest[2], 0.4);
      vec3 turn = mix(uForest[4], uForest[5], 0.5);
      vec3 meanCrown = mix(mix(leaf, turn, turning * 0.6), needle, conifer);
      // The forest floor between crowns is dark, and clearings show the
      // clearing ground. At the edge it is the ground beside the forest.
      vec3 floorCol = mix(meanCrown * 0.4, uBiomeClearing, smoothstep(0.5, 0.15, density));
      // Under a cold forest the floor is snow.
      floorCol = mix(floorCol, uBiomeClearing * 0.85, taiga);
      vec3 between = mix(albedo, floorCol, smoothstep(0.3, 0.85, s));

      // Far off, a crown is smaller than a pixel: the canopy averages to its
      // cover, its tone and the share of it in shade. A cold forest averages
      // to dark needles with some snow on them.
      float meanCover = density * mix(0.8, mix(0.6, 0.85, taiga), cone);
      vec3 farCrown = mix(meanCrown, mix(needle, uBiomeClearing * 0.8, 0.3), taiga * cone);
      vec3 farCol = mix(between, farCrown * (1.0 - 0.3 * density), meanCover);
      vec3 col = farCol;
      if (keep > 0.0) {
        vec3 near = vec3(0.0);
        if (cone < 0.99) near += (1.0 - cone) * mix(farCol, tCanopy(p / 0.14, density, 0.0, between, turning, uTerrainFrost * taiga), keepLeaf);
        if (cone > 0.01) near += cone * mix(farCol, tCanopy(p / 0.1 + 17.0, density, 1.0, between, turning, uTerrainFrost * taiga), keepNeedle);
        col = near;
      }
      // Groves: the canopy is lighter and darker in patches larger than a
      // crown, so it keeps a grain when the crowns are too small to draw.
      float grove = tField(p + 19.0, 0.7, 2, footprint).x;
      col *= 1.0 + grove * 0.18 * density;
      // On a slope turned from the sun the crowns shade each other more, and
      // on one facing it more of each crown is lit, so a thick canopy shows
      // the shape of the ground under it more than bare ground does.
      float faceSun = clamp(dot(n, uTerrainSun) / uTerrainSun.y, 0.5, 1.25);
      col *= mix(1.0, faceSun, 0.6 * density);
      albedo = col;
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
      // Strata: beds of sediment that follow height, each its own tone, with
      // a dark seam where one meets the next. They show on a slope and not on
      // the level. The noise bends the beds and varies their thickness, so
      // they read as layers and not as contour lines.
      float tilt = smoothstep(0.012, 0.07, 1.0 - n.y);
      float strata = max(steep, (pw[${P.rock}] + pw[${P.mesa}]) * tilt) * (1.0 - pw[${P.snow}]);
      float warp = broad.x * 1.4 + stone.x * 0.45 + fine.x * 0.25;
      // The beds thicken and thin from place to place, and dip a little
      // across the map, so they never follow one height all the way round.
      vec3 vary = tSimplex(p / 9.0 + 41.0);
      float dip = dot(p, vec2(0.6, -0.8)) * 0.05;
      for (int k = 0; k < 2; k++) {
        float rate = (k == 0 ? 3.0 : 10.0) * (1.0 + 0.3 * vary.x);
        float depth = (vTerrainPos.y + dip) * rate + warp * (k == 0 ? 1.0 : 0.6) + float(k) * 5.3;
        float keepBed = 1.0 - smoothstep(0.5, 1.4, fwidth(depth));
        if (keepBed <= 0.0) break;
        float bed = floor(depth);
        vec3 pick = tHash3(vec3(bed, float(k) * 9.7, 3.3));
        // Hard beds stand out as ledges: a bright lip on top of each.
        float within = fract(depth);
        float seam = 1.0 - smoothstep(0.0, 0.09 + fwidth(depth), within);
        float lip = smoothstep(0.82, 1.0, within) * (1.0 - seam);
        // Each bed pinches out in places along the slope.
        float lens = smoothstep(-0.45, 0.1, tSimplex(p / 2.5 + bed * 3.1 + float(k) * 11.0).x);
        float weight = strata * keepBed * lens * (k == 0 ? 1.0 : 0.45);
        // Hard and soft beds alternate, so neighbours differ in tone.
        float hard = mod(bed, 2.0) * 2.0 - 1.0;
        form += weight * (hard * (0.1 + 0.12 * pick.x) - seam * 0.12 + lip * 0.05);
        vec3 tint = mix(vec3(1.08, 1.0, 0.9), vec3(0.94, 0.95, 0.97), pick.y);
        albedo = mix(albedo, albedo * tint, weight * 0.6);
      }
      shadeMul += pw[${P.mesa}] * fine.x * 0.12;
      // Edges and ridges weather pale, and the crevices between fill dark.
      float rock = min(crag, 1.0);
      float rim = smoothstep(0.03, 0.4, cavFine);
      float crevice = smoothstep(-0.03, -0.35, cavFine);
      form += rock * rim * 0.3;
      form -= rock * (1.0 - min(talus, 1.0)) * (crevice * 0.35 + smoothstep(0.0, -0.5, cavCoarse) * 0.1);
      // Frost on a cold world: rime on the ledges and in the cracks, and a
      // fine pale grain over the rest, so the stone reads matte.
      if (uTerrainFrost > 0.0) {
        float rime = smoothstep(0.4, 0.85, (1.0 - tilt) * 0.6 + crevice * 0.45 + broad.x * 0.25 + fine.x * 0.15);
        vec3 grey = vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722)));
        albedo = mix(albedo, grey, rock * uTerrainFrost * 0.5);
        albedo = mix(albedo, vec3(0.8, 0.84, 0.88), rock * uTerrainFrost * rime * 0.4);
        form += rock * uTerrainFrost * (fine.x * 0.05 - rim * 0.08);
      }
      // Talus is loose stone, greyer than the face it broke from.
      albedo = mix(albedo, mix(uBiomeSteep[0], uBiomeSteep[1], 0.45 + broad.x * 0.4), talus * 0.85);
      form += talus * 0.1;
      // Scree is the same stone broken small: blocks, then the chips between.
      for (int k = 0; k < 2; k++) {
        float size = k == 0 ? 0.32 : 0.11;
        float keep = tShow(size * 0.36, footprint);
        if (pw[${P.scree}] <= 0.02 || keep <= 0.0) break;
        vec4 cell = tCell(p / size + 6.1 + float(k) * 3.7);
        form += pw[${P.scree}] * keep * (cell.w - 0.5) * (k == 0 ? 0.4 : 0.3) * (1.0 - smoothstep(0.15, 0.45, cell.x));
      }
    }
    // Snow and ice lie in the hollows, bluer there, and give way to bare rock
    // on the edges and ridges.
    float cold = min(pw[${P.snow}] + pw[${P.ice}], 1.0);
    if (cold > 0.02) {
      float hollow = smoothstep(0.05, -0.45, cavFine * 0.5 + cavCoarse);
      albedo = mix(albedo, albedo * vec3(0.55, 0.74, 1.0), cold * hollow * 0.8);
      float bare = smoothstep(0.12, 0.45, cavFine);
      albedo = mix(albedo, mix(uBiomeSteep[0], uBiomeSteep[1], 0.5 + broad.x * 0.5), cold * bare * 0.85);
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
    // Foam breaks where the shore has a slope to break on.
    foam *= smoothstep(0.02, 0.3, faceNear);
    // Coasts past the edge are drawn at half the map's resolution, and foam
    // traces their steps, so it thins out there.
    foam *= 1.0 - smoothstep(0.0, 0.03, terrainPast);
    bump = mix(bump, wave.yz * 0.03, liquid);
    bump3 *= 1.0 - liquid;
    shadeMul = mix(shadeMul, 1.0 + wave.x * 0.08, liquid);
    form = mix(form, 1.0, liquid);
    // The pattern evens out along a gully, which reads darker and a little
    // cooler, as damp ground in shade.
    shadeMul = mix(shadeMul, 1.0, gully * 0.5);
    form -= gully * 0.3;
    albedo = mix(albedo, albedo * vec3(0.82, 0.86, 0.92), gully * 0.6);

    albedo *= max(shadeMul, 0.2) * pow(clamp(form, 0.3, 1.6), 2.2);
    // Wet ground at the water line: darker and a little bluer, with a ragged
    // upper edge.
    float wet = smoothstep(0.06, 0.3 + 0.12 * fine.x, seaNear) * land * uSeaLiquid * (1.0 - 0.5 * steep);
    albedo = mix(albedo, albedo * vec3(0.34, 0.38, 0.44), wet * 0.85);
    albedo = mix(albedo, vec3(0.85, 0.9, 0.92), foam * 0.75);
    if (river + riverBank + riverGreen > 0.001) {
      // Dry country by running water is green.
      albedo = mix(albedo, albedo * vec3(0.62, 0.86, 0.5), riverGreen * 0.8);
      if (uRiverFrozen > 0.5) {
        // Frozen over: clear ice, dark with the water under it, so it reads
        // apart from the sea's pale floes and the roads, with frost along its
        // edges and snow drifted against the banks.
        vec3 ice = vec3(0.045, 0.085, 0.13) * (1.0 + 0.25 * broad.x + 0.12 * fine.x);
        float frost = 1.0 - smoothstep(-0.009, -0.002, rEdge);
        ice = mix(vec3(0.55, 0.62, 0.68), ice, frost);
        albedo = mix(albedo, vec3(0.8, 0.86, 0.9), riverBank * 0.5);
        albedo = mix(albedo, ice, river);
      } else {
        albedo = mix(albedo, albedo * vec3(0.34, 0.38, 0.44), riverBank * 0.85 * (1.0 - 0.6 * riverDry));
        // Water seen from above is dark: brown green where it runs shallow,
        // bluer where the sky shows in it, changing slowly along a river.
        vec3 water = mix(vec3(0.02, 0.032, 0.022), vec3(0.014, 0.034, 0.05), 0.5 + 0.5 * broad.x);
        water *= 1.0 + 0.12 * fine.x;
        // A dry bed: the ground's own sand, browner and damper, with no
        // crisp edge, so it never reads as a road.
        vec3 wash = albedo * vec3(0.64, 0.57, 0.47) * (1.0 + 0.12 * fine.x);
        float washCover = (1.0 - smoothstep(-0.03, 0.02, rEdge)) * land;
        albedo = mix(albedo, water, river * (1.0 - riverDry));
        albedo = mix(albedo, wash, washCover * riverDry);
      }
      // The water lies flat, whatever slope the valley has.
      bump *= 1.0 - river;
      bump3 *= 1.0 - river;
      n = normalize(mix(n, vec3(0.0, 1.0, 0.0), river));
    }
    n = normalize(n + vec3(-bump.x, 0.0, -bump.y) - (bump3 - n * dot(bump3, n)));

    vec3 h = normalize(view + uTerrainSun);
    float riverWet = river * (1.0 - riverDry) * (1.0 - uRiverFrozen);
    spec += pow(max(dot(n, h), 0.0), 40.0) * 0.08 * max(liquid * (1.0 - foam), riverWet);
    sheen = max(liquid * (1.0 - foam), riverWet);
  }
`;

/** The land past the map's edge, greyed and hazed, on the lit colour. */
const HAZE = /* glsl */ `
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
`;

/**
 * In place of {@link DETAIL}, once the detail is baked: its lit colour read
 * back from the picture. Dividing by the light from the relief alone gives a
 * colour that the lighting below turns back into exactly the baked one, and
 * that a road can still paint over and light.
 */
const BAKED = /* glsl */ `
  if (uBakeReady > 0.5) {
    vec4 baked = texture2D(uBakedLook, (vTerrainUv - uBakeRect.xy) / uBakeRect.zw);
    float facing0 = max(dot(n, uTerrainSun), 0.0);
    albedo = baked.rgb / (uTerrainAmbient + (1.0 - uTerrainAmbient) * (facing0 / uTerrainSun.y));
    GLINT_HERE
  }
`;

/**
 * The sun's glint on a liquid sea, which moves with the camera and so cannot
 * be baked. Its ripples are the bake's. Run only where the bake says there is
 * open water.
 */
const GLINT = /* glsl */ `
    vec2 sp = vTerrainPos.xz;
    float sFoot = max(length(dFdx(sp)), length(dFdy(sp))) + 1e-5;
    if (baked.a > 0.004) {
      vec3 wave = tField(sp + 11.0, 0.6, 3, sFoot);
      vec3 nw = normalize(n + vec3(-wave.y, 0.0, -wave.z) * 0.03);
      vec3 sh = normalize(normalize(cameraPosition - vTerrainPos) + uTerrainSun);
      spec += pow(max(dot(nw, sh), 0.0), 40.0) * 0.08 * baked.a;
    }
`;

/**
 * The bake draws each pattern as though a texel were half its size. Patterns
 * fade out at a few pixels across so they never shimmer as the camera moves,
 * and a picture never shimmers. At a whole texel the cracks in cracked ground
 * were gone at the closest zoom on a screen at twice the pixels. At half they
 * show, a little softer.
 */
const BAKE_FOOTPRINT_SCALE = "0.5";

const BAKE_HEAD = /* glsl */ `
uniform vec4 uBakeRect;
uniform sampler2D uBakedLook;
uniform float uBakeReady;
`;

/**
 * For the bake: put each vertex where its picture coordinate falls in the
 * baked picture, so the sheet is drawn flat into it from above.
 */
const BAKE_VERTEX = /* glsl */ `
gl_Position = vec4((uv - uBakeRect.xy) / uBakeRect.zw * 2.0 - 1.0, 0.0, 1.0);
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
  // No cavity: level ground with no steep face and no sea within reach.
  const flatCavity = new THREE.DataTexture(
    new Uint8Array([128, 128, 0, 0]),
    1,
    1,
  );
  flatCavity.needsUpdate = true;
  disposables.push(flatCavity);
  // No drainage: no water runs anywhere.
  const dry = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  dry.needsUpdate = true;
  disposables.push(dry);
  // Detail tells sea from land by the height the normals carry, so without
  // them it would read every pixel as sea. It reads the biome weights too.
  const detail =
    shading.detail && shading.biomes !== null && shading.normals !== null;
  const planet = shading.biomes ? planetOf(shading.biomes.planet) : null;
  const bake = detail ? shading.bake : undefined;
  // Only the material that draws the detail reads the weights.
  const weighs = detail && bake?.kind !== "read";
  const glint =
    bake?.kind === "read" && (!planet || LIQUID_SEAS.includes(planet.sea.look));
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
    shader.uniforms.uTerrainCavity = {
      value: weighs ? (shading.cavity ?? flatCavity) : flatCavity,
    };
    shader.uniforms.uTerrainDrainage = {
      value: weighs ? (shading.drainage ?? dry) : dry,
    };
    shader.uniforms.uBiomeA = {
      value: weighs && shading.biomes ? shading.biomes.a : placeholder,
    };
    shader.uniforms.uBiomeB = {
      value: weighs && shading.biomes ? shading.biomes.b : placeholder,
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
    const forest = planet?.forest;
    shader.uniforms.uForest = {
      value: (forest
        ? [...forest.broadleaf, ...forest.conifer, ...forest.autumn]
        : Array.from({ length: 6 }, (): Rgb => [0, 0, 0])
      ).map(colour),
    };
    shader.uniforms.uForestAutumn = { value: forest?.turning ?? 0 };
    shader.uniforms.uSeaLiquid = {
      value: planet && !LIQUID_SEAS.includes(planet.sea.look) ? 0 : 1,
    };
    shader.uniforms.uTerrainFrost = { value: planet?.frost ?? 0 };
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
    // Rivers, which the detail draws and the roads bridge.
    const rivers = detail ? shading.ground?.river : undefined;
    shader.uniforms.uRiverField = { value: rivers?.field ?? dry };
    shader.uniforms.uRiverOn = { value: rivers ? 1 : 0 };
    shader.uniforms.uRiverFrozen = { value: rivers?.frozen ? 1 : 0 };
    shader.uniforms.uRiverSpan = {
      value: new THREE.Vector2(...(rivers?.span ?? [0, 1])),
    };
    shader.uniforms.uTerrainSun = {
      value: new THREE.Vector3(...TERRAIN_SUN),
    };
    shader.uniforms.uTerrainAmbient = { value: SHADE_AMBIENT };
    // Roads (groundShader.ts).
    if (shading.ground) {
      Object.assign(shader.uniforms, groundUniforms(shading.ground));
    }
    if (bake?.kind === "draw") {
      shader.uniforms.uBakeRect = bake.rect;
    } else if (bake?.kind === "read") {
      shader.uniforms.uBakeRect = { value: bake.rect };
      shader.uniforms.uBakedLook = { value: bake.look };
      shader.uniforms.uBakeReady = bake.ready;
    }
    const bakeHead = bake ? BAKE_HEAD : "";
    shader.vertexShader = `${VERTEX_HEAD}${bakeHead}${shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n${VERTEX_BODY}${bake?.kind === "draw" ? BAKE_VERTEX : ""}`,
    )}`;
    // The picture holds the lit colour, with no roads, haze or glint, and
    // how much glint each pixel shows in its alpha.
    const drawing = bake?.kind === "draw";
    const surface =
      bake?.kind === "read"
        ? BAKED.replace("GLINT_HERE", glint ? GLINT : "")
        : `${DETAIL.replace("FOOTPRINT_SCALE", drawing ? BAKE_FOOTPRINT_SCALE : "1.0")}${drawing ? "spec = 0.0;" : ""}`;
    const ground = shading.ground && !drawing ? shading.ground : undefined;
    const body = FRAGMENT_BODY.replace("SURFACE_HERE", surface)
      .replace("GROUND_BODY_HERE", ground ? GROUND_BODY : "")
      .replace("GROUND_LIT_HERE", ground ? GROUND_LIT : "")
      .replace("HAZE_HERE", drawing ? "" : HAZE)
      .replace("BAKE_ALPHA_HERE", drawing ? "diffuseColor.a = sheen;" : "");
    shader.fragmentShader = `${FRAGMENT_HEAD.replace("TERRAIN_NOISE_HERE", TERRAIN_NOISE).replace("FOREST_HERE", bake?.kind === "read" ? "" : FOREST)}${bakeHead}${ground ? GROUND_HEAD : ""}${shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>\n${body}`,
    )}`;
  };
  // One program for every terrain with the same switches.
  material.customProgramCacheKey = () =>
    `terrain:${shading.normals ? 1 : 0}:${detail ? 1 : 0}${shading.ground && bake?.kind !== "draw" ? ":ground" : ""}${bake ? `:${bake.kind}` : ""}${glint ? ":glint" : ""}`;
}
