import * as THREE from "three";
import type { Settlement, SettlementStyle } from "../planets";
import { SHADE_AMBIENT, TERRAIN_SUN } from "./terrain";
import { TERRAIN_NOISE } from "./terrainShader";
import { TOWN_REACH } from "./towns";

/**
 * The shader that draws settlements on their patches of ground
 * (`townLayer.ts`): one even patch from far away, and nearer the buildings of
 * the planet's layout (`Settlement` in `planets.ts`), fading in once they are
 * a few pixels across. It
 * draws over the terrain with its own alpha, leaving the ground showing
 * between houses at a town's edge and on the roads, which run on into the
 * town as its main streets. Kept out of the terrain shader, so the rest of
 * the map pays nothing for it.
 *
 * Display only.
 */

/** What the town shader is given. See `towns.ts` for the textures. */
export interface TownShading {
  /** `buildTownIndex`, read exactly for the town and blended for the ground. */
  index: THREE.Texture;
  indexSize: [number, number];
  /** `townDataTexels`. */
  data: THREE.Texture;
  /** One column per town: see {@link TOWN_STATE_ROWS}. */
  state: THREE.Texture;
  /** The road mask's distances (`groundLayer.ts`). */
  roadDistance: THREE.Texture;
  /** `ROAD_REACH` in world units. */
  roadReach: number;
  /** The sheet's half width and half depth, then its width and depth. */
  frame: THREE.Vector4;
  /** `dryFarmShare`: where the farm ground is dry, over the sheet. */
  dry: THREE.Texture;
  /** The dry farm ground's colour, linear. */
  dryGround: THREE.Color;
  /** The planet's settlement look. */
  settlement: Settlement;
  /** What grows between an open town's buildings, linear. */
  garden: THREE.Color;
}

/**
 * The town state texture's rows. Row 0 holds the colour of the ring drawn
 * round the town in sRGB and its strength, 0 for no ring. Row 1 holds
 * whether the town is hidden by fog and whether its ring is the thick one.
 */
export const TOWN_STATE_ROWS = 2;

const VERTEX = /* glsl */ `
attribute float town;
varying vec3 vPos;
flat varying int vTown;
void main() {
  vPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vTown = int(town + 0.5);
  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uTownIndex;
uniform sampler2D uTownData;
uniform sampler2D uTownState;
uniform sampler2D uRoadDistance;
uniform vec2 uTownIndexSize;
uniform float uRoadReach;
uniform float uFieldReach;
uniform sampler2D uDryFarm;
uniform vec3 uDryGround;
// 0 draws the fields, 1 the town over them. A constant, so each pass is
// compiled without the other's code, which holds fewer registers.
const float uLayer = LAYER_HERE;
uniform vec4 uFrame;
uniform vec3 uSun;
uniform float uAmbient;
varying vec3 vPos;
flat varying int vTown;
TERRAIN_NOISE_HERE

// The settlement's two colours (Settlement in planets.ts), linear, and
// the share of a sealed one's structures that are domes.
uniform vec3 uHull;
uniform vec3 uTrim;
uniform float uDomes;
// What grows between the buildings of an open town, linear.
uniform vec3 uGarden;
// The layout, a constant so only one is compiled: 0 a town in the open air,
// 3 sealed domes and modules.
#define W_STYLE STYLE_HERE
// What lies round a settlement: 0 fields, 1 solar arrays and greenhouses.
#define W_OUTSKIRTS OUTSKIRTS_HERE

// Ground colours inside a sealed outpost, linear, from sRGB asphalt
// (78, 80, 84), concrete (150, 148, 142) and painted markings
// (226, 222, 204). First guesses.
const vec3 W_ASPHALT = vec3(0.076, 0.080, 0.089);
const vec3 W_CONCRETE = vec3(0.305, 0.296, 0.270);
const vec3 W_MARK = vec3(0.760, 0.730, 0.600);
// Solar panels (28, 40, 68) and a greenhouse's skin (196, 216, 196).
const vec3 W_SOLAR = vec3(0.012, 0.021, 0.058);
const vec3 W_GLASSHOUSE = vec3(0.552, 0.686, 0.552);

// The ground one dome or module of a sealed outpost stands on is this wide,
// in world units.
#if W_STYLE == 3
const float W_CELL = 0.5;
#define W_FAR (uHull * 0.8)
const float W_FAR_COVER = 0.45;
#else
const float W_CELL = 0.48;
#define W_FAR mix(uHull * 0.85, uGarden * 0.7, 0.4)
const float W_FAR_COVER = 0.85;
#endif

// Fields, linear, from sRGB wheat (196, 178, 110), green (140, 165, 90), dark
// green (92, 120, 62), ploughed earth (138, 110, 78), pale grass (165, 172,
// 112) and ochre (178, 150, 92), their mean, and hedges (44, 64, 34).
const vec3 W_WHEAT = vec3(0.560, 0.453, 0.157);
const vec3 W_GREEN = vec3(0.267, 0.384, 0.101);
const vec3 W_DARK = vec3(0.106, 0.190, 0.045);
const vec3 W_PLOUGH = vec3(0.259, 0.157, 0.074);
const vec3 W_PALEGRASS = vec3(0.384, 0.421, 0.164);
const vec3 W_OCHRE = vec3(0.453, 0.311, 0.106);
const vec3 W_CROP_MEAN = vec3(0.338, 0.319, 0.108);
const vec3 W_HEDGE = vec3(0.021, 0.048, 0.012);
// Fields on dry ground, linear, from sRGB irrigated crops (40, 70, 45) and
// (58, 92, 50), bare pale soil (190, 170, 140), fallow (170, 160, 140),
// ploughed earth (150, 112, 80), olive trees (70, 80, 56), vines (80, 104,
// 56) and the tracks between plots (205, 185, 150). First guesses, from
// photographs of desert farms from the air.
const vec3 W_WET = vec3(0.021, 0.061, 0.027);
const vec3 W_WET2 = vec3(0.042, 0.107, 0.032);
const vec3 W_SOIL = vec3(0.515, 0.402, 0.267);
const vec3 W_FALLOW = vec3(0.402, 0.352, 0.267);
const vec3 W_DRYPLOUGH = vec3(0.311, 0.164, 0.078);
const vec3 W_OLIVE = vec3(0.060, 0.078, 0.036);
const vec3 W_VINE = vec3(0.078, 0.137, 0.036);
const vec3 W_TRACK = vec3(0.612, 0.485, 0.311);
const vec3 W_DRY_MEAN = vec3(0.2, 0.2, 0.12);
// Trees in a grove and rows of vines are this far apart, in world units.
const float W_TREES = 0.045;
const float W_VINES = 0.03;
// A field's plot is about this wide, in world units.
const float W_PLOT = 0.42;

// One field's colour from a 0 to 1 hash, mostly greens.
vec3 wCropTone(float h) {
  return h < 0.25 ? W_GREEN : h < 0.42 ? W_PALEGRASS : h < 0.57 ? W_DARK : h < 0.72 ? W_WHEAT : h < 0.86 ? W_OCHRE : W_PLOUGH;
}

// Lay a colour with coverage over a premultiplied one.
vec4 wOver(vec4 under, vec3 col, float a) {
  return vec4(col * a, a) + under * (1.0 - a);
}

// The town being drawn, set once in main for the functions below: its radius,
// seed, axis, aspect and the phases of its edge's waves.
float wTR;
float wTSeed;
vec2 wTAlong;
float wTAspect;
vec3 wTWaves;

// The town's edge in the direction of rel, as townEdge in towns.ts works it
// out, so the roads the CPU cut at the edge stop where the buildings begin.
float wEdgeAt(vec2 rel) {
  vec2 q = vec2(dot(rel, wTAlong), dot(rel, vec2(-wTAlong.y, wTAlong.x)));
  float ang = atan(rel.y, rel.x);
  float ell = length(q) / max(length(vec2(q.x, q.y * wTAspect)), 1e-5);
  return wTR * ell * (1.0 + 0.14 * sin(2.0 * ang + wTWaves.x) + 0.08 * sin(3.0 * ang + wTWaves.y) + 0.05 * sin(5.0 * ang + wTWaves.z));
}

// Coverage of a box of half size hs, and of a disc of radius r, both centred
// on the origin, smoothed over a pixel.
float wBox(vec2 p, vec2 hs, float foot) {
  vec2 d = abs(p) - hs;
  return 1.0 - smoothstep(-foot * 0.5, foot * 0.5, max(d.x, d.y));
}
float wDisc(vec2 p, float r, float foot) {
  return 1.0 - smoothstep(r - foot * 0.5, r + foot * 0.5, length(p));
}

// The cell of the layout a point of the town's own frame lies in: whole
// numbers name the cell and the fraction is the place within it.
#if W_STYLE != 0
vec2 wCellAt(vec2 q) {
  return q / W_CELL + wTSeed * 101.0;
}
float wCellDens(vec2 id) {
  vec2 c = (id + 0.5 - wTSeed * 101.0) * W_CELL;
  vec2 rel = wTAlong * c.x + vec2(-wTAlong.y, wTAlong.x) * c.y;
  float rr = length(rel) / wEdgeAt(rel);
  return 1.0 - smoothstep(0.72, 1.02, rr + (tHash(id + 9.1) - 0.5) * 0.25);
}

// What stands at g (wCellAt): the coverage of a structure, with its colour,
// its height in world units and the lean of its roof in the town's frame, and
// the ground it stands on as a colour and coverage.
// Where the structure of a sealed cell stands, in cell units, and in .z
// whether one stands there at all.
vec3 wPod(vec2 id) {
  float there = step(tHash(id + 1.3), wCellDens(id) * 1.15);
  return vec3(id + 0.5 + (tHash2(id + wTSeed * 7.0) - 0.5) * 0.3, there);
}
// The distance from p to the line from a to b.
float wSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// A sealed outpost: domes and modules, each joined to its neighbours by a
// tube, with a landing pad here and there on the graded ground between.
float wStructure(vec2 g, float foot, out vec3 tone, out float high, out vec4 ground, out vec2 lean) {
  vec2 id = floor(g);
  float dens = wCellDens(id);
  tone = uHull * 0.8;
  high = 0.006;
  lean = vec2(0.0);
  ground = vec4(0.0, 0.0, 0.0, 0.2 * smoothstep(0.05, 0.4, dens));
  vec3 me = wPod(id);
  float b = 0.0;
  if (me.z > 0.5) {
    float td = 8.0;
    vec3 o = wPod(id - vec2(1.0, 0.0));
    if (o.z > 0.5) td = min(td, wSeg(g, me.xy, o.xy));
    o = wPod(id + vec2(1.0, 0.0));
    if (o.z > 0.5) td = min(td, wSeg(g, me.xy, o.xy));
    o = wPod(id - vec2(0.0, 1.0));
    if (o.z > 0.5) td = min(td, wSeg(g, me.xy, o.xy));
    o = wPod(id + vec2(0.0, 1.0));
    if (o.z > 0.5) td = min(td, wSeg(g, me.xy, o.xy));
    const float tw = 0.016;
    b = 1.0 - smoothstep(tw - foot * 0.5, tw + foot * 0.5, td * W_CELL);
    vec2 p = (g - me.xy) * W_CELL;
    float k = tHash(id + 7.7);
    float sz = tHash(id + 2.9);
    if (k < uDomes) {
      float rad = W_CELL * mix(0.17, 0.3, sz) * (0.75 + 0.4 * dens);
      float dome = wDisc(p, rad, foot);
      float rn = length(p) / rad;
      // A skin between a rim and a cap, held by ribs.
      float frame = max(smoothstep(0.8, 0.9, rn), 1.0 - smoothstep(0.16, 0.22, rn));
      frame = max(frame, 1.0 - smoothstep(0.03, 0.07, abs(fract(atan(p.y, p.x) / 6.2832 * 8.0) - 0.5)));
      tone = mix(tone, mix(uTrim, uHull, frame), dome);
      lean = p / rad * dome;
      high = mix(high, rad * 0.7, step(0.5, dome));
      b = max(b, dome);
    } else {
      bool turn = fract(k * 17.0) > 0.5;
      if (turn) p = p.yx;
      vec2 hs = W_CELL * vec2(0.3, 0.12) * (0.8 + 0.4 * sz);
      float cr = hs.y * 0.6;
      vec2 dd = abs(p) - hs + cr;
      float sd = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0) - cr;
      float module_ = 1.0 - smoothstep(-foot * 0.5, foot * 0.5, sd);
      vec3 skin = uHull * (0.85 + 0.15 * step(0.5, fract(p.x / 0.05)));
      skin = mix(skin, uTrim, step(abs(p.x - hs.x * 0.5), 0.012));
      tone = mix(tone, skin, module_);
      vec2 over = vec2(0.0, p.y / hs.y * 0.75) * module_;
      lean = turn ? over.yx : over;
      high = mix(high, 0.02, step(0.5, module_));
      b = max(b, module_);
    }
  } else if (tHash(id + 11.1) > 0.75 && dens > 0.2) {
    // A landing pad: a ring and a cross.
    vec2 p = (fract(g) - 0.5) * W_CELL;
    float rn = length(p) / (W_CELL * 0.3);
    float pad = wDisc(p, W_CELL * 0.3, foot);
    float ring = 1.0 - smoothstep(0.04, 0.08, abs(rn - 0.8));
    float cross_ = step(min(abs(p.x), abs(p.y)), 0.008) * step(rn, 0.5);
    ground = mix(ground, vec4(mix(W_ASPHALT, W_MARK, max(ring, cross_)), 0.95), pad);
  }
  return b;
}

#else
// A block of a town is about this wide, and a building's plot this long
// along its street, in world units.
const float W_BLOCK = 0.3;
const float W_LOT = 0.05;
// Gardens, trees and yards between the buildings: the planet's own green
// or scrub, darker, over most of the ground.
#define W_GARDEN vec4(uGarden * 0.7, 0.7)
// A main street (132, 130, 126) and a side street (100, 99, 96): grey, thin
// and close to the roofs' tone, as a town's are from the air.
const vec3 W_STREET = vec3(0.231, 0.223, 0.209);
const vec3 W_LANE = vec3(0.127, 0.124, 0.117);
// A blue shed roof (74, 112, 168), as industrial estates have.
const vec3 W_BLUE = vec3(0.068, 0.162, 0.392);
// The big roofs of a town's middle and its trading estates (218, 216, 208).
const vec3 W_SHED = vec3(0.701, 0.687, 0.631);

// One roof's colour from a 0 to 1 hash: the planet's two colours, each also
// weathered darker, and a few of tile (150, 96, 78). First guesses.
vec3 wRoofTone(float h) {
  return h < 0.4 ? uHull : h < 0.6 ? uTrim : h < 0.78 ? uHull * 0.7 : h < 0.94 ? uTrim * 1.25 : vec3(0.305, 0.117, 0.076);
}

// The town's blocks: cells round a scatter of points, one per unit square.
// Returns the distance to the nearest edge of this block in .x, the edge's
// normal pointing out of the block in .yz, and a hash of that edge in .w.
// mid is the edge's midpoint relative to x, cell a hash of the block.
vec4 wBlocks(vec2 x, out vec2 mid, out float cell) {
  vec2 ip = floor(x);
  vec2 fp = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + 0.2 + tHash2(ip + g) * 0.6 - fp;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
      }
    }
  }
  md = 8.0;
  vec2 bn = vec2(1.0, 0.0);
  vec2 other = vec2(0.0);
  mid = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + 0.2 + tHash2(ip + g) * 0.6 - fp;
      vec2 dr = r - mr;
      if (dot(dr, dr) > 1e-5) {
        vec2 nn = normalize(dr);
        float d = dot(0.5 * (mr + r), nn);
        if (d < md) {
          md = d;
          bn = nn;
          mid = 0.5 * (mr + r);
          other = ip + g;
        }
      }
    }
  }
  cell = tHash(ip + mg + 0.37);
  return vec4(md, bn, tHash(other + ip + mg + 1.7));
}

// How high a building stands, in world units. More than a house is to its
// plot, so that it reads from as far off as the map is seen. A first guess.
const float W_HIGH = 0.035;

// The plot at a point of the town's own frame, where the town is dens
// built up: the building on it and what main needs to draw it.
struct WLot {
  // The building's coverage, its roof's colour, and whether it is one of a
  // large town's tall blocks or one of an estate's sheds.
  float house;
  vec3 tone;
  float tall;
  float shed;
  // The way out of its block, in the town's frame, and how far back from
  // the street the point is, 0 at the front of the roof and 1 at the back.
  vec2 outQ;
  float across;
  // The distance to the block's edge, a hash of the block, and how many
  // plots deep into the block the point is.
  float e;
  float cell;
  float v;
};

WLot wLotAt(vec2 q, float dens, float capital, float foot) {
  WLot lot;
  // Streets curve, so the blocks are bent a little.
  vec2 warp = vec2(tNoise(q * 0.9 + wTSeed * 13.0).x, tNoise(q * 0.9 + wTSeed * 29.0 + 5.0).x) - 0.5;
  vec2 bMid;
  vec4 blk = wBlocks((q + warp * 0.35) / W_BLOCK + wTSeed * 101.0, bMid, lot.cell);
  lot.e = blk.x * W_BLOCK;
  float sw = mix(0.007, 0.011, dens);
  // Buildings side by side along each street, in a front row and, nearer
  // the middle of town, rows behind it.
  vec2 tang = vec2(-blk.z, blk.y);
  // The middle of a large town is built in tall blocks, not houses, and a
  // town of any size has an estate of sheds or two out towards its edge.
  float out_ = length(q) / wTR;
  lot.shed = smoothstep(0.75, 0.79, tNoise(q / wTR * 1.7 + wTSeed * 91.0).x) * smoothstep(0.4, 0.6, out_) * step(1.2, wTR);
  lot.tall = smoothstep(0.8, 0.95, dens) * step(2.2, wTR) * (1.0 - lot.shed);
  float big = lot.tall * 0.8 + lot.shed * 1.8;
  float lotW = W_LOT * mix(0.85, 1.25, fract(blk.w * 13.7)) * (1.0 + 0.15 * capital) * (1.0 + big);
  float depth = W_LOT * mix(0.85, 1.2, fract(blk.w * 7.3)) * (1.0 + 0.6 * big);
  lot.v = (lot.e - sw) / depth;
  float u = dot(-bMid, tang) * W_BLOCK / lotW;
  float lotI = floor(u);
  float fu = fract(u);
  float row = floor(lot.v);
  float fv = fract(lot.v);
  float lh = tHash(vec2(lotI + row * 31.0, blk.w * 517.0 + lot.cell * 91.0));
  float lh2 = tHash(vec2(lotI * 1.7 + row * 5.0, lot.cell * 313.0 + 3.1));
  float want = row < 0.5 ? dens * 1.3 : row < 1.5 ? (dens - 0.35) * 1.8 : row < 2.5 ? (dens - 0.6) * 2.0 : -1.0;
  // Houses stand apart in their gardens. Big roofs fill their plots.
  float gap = mix(mix(0.5, 0.22, dens), 0.14, max(lot.tall, lot.shed));
  float setback = row < 0.5 ? (1.0 - dens) * 0.35 * lh2 : 0.06;
  float back = 1.0 - (1.0 - dens) * 0.3 * fract(lh2 * 7.0);
  float au = foot / lotW * 0.7;
  float av = foot / depth * 0.7;
  lot.house = step(0.0, lot.v) * step(lh, want);
  lot.house *= smoothstep(-au, au, min(fu - gap * 0.5, 1.0 - gap * 0.5 - fu));
  lot.house *= smoothstep(-av, av, min(fv - setback, back - fv));
  // Roofs differ a good deal in brightness, which is what gives a town its
  // grain from the air.
  lot.tone = wRoofTone(lh2) * (1.0 + 0.25 * lot.tall);
  lot.tone = mix(lot.tone, lh2 < 0.3 ? W_BLUE : W_SHED, lot.shed * 0.9) * (0.65 + 0.7 * fract(lh * 11.0));
  lot.across = (fv - setback) / max(back - setback, 1e-3);
  lot.outQ = blk.yz;
  return lot;
}
#endif

void main() {
  vec2 gp = vPos.xz;
  // Taken before any pixel is thrown away, while its neighbours still run.
  float gFoot = max(length(dFdx(gp)), length(dFdy(gp))) + 1e-5;
  vec2 uv = (gp + uFrame.xy) / uFrame.zw;
  ivec2 ti = clamp(ivec2(uv * uTownIndexSize), ivec2(0), ivec2(uTownIndexSize) - 1);
  vec4 tix = texelFetch(uTownIndex, ti, 0);
  int tag = int(tix.r * 255.0 + 0.5) * 256 + int(tix.g * 255.0 + 0.5);
  // This patch draws only its own town's ground.
  if (tag != vTown + 1) discard;

  vec4 w0 = texelFetch(uTownData, ivec2(vTown, 0), 0);
  vec4 w1 = texelFetch(uTownData, ivec2(vTown, 1), 0);
  vec4 ws0 = texelFetch(uTownState, ivec2(vTown, 0), 0);
  vec2 rel = gp - w0.xy;
  float wR = w0.z;
  float wSeed = w0.w;
  // Throw away what neither pass can draw before any of the work below: for
  // the fields, ground no field can lie on, and for the town, ground past
  // its furthest house (an edge reaches 1.27 radii, houses along a road 1.55
  // edges) and its ring.
  if (uLayer < 0.5 ? (texture(uTownIndex, uv).a < 0.004 || length(rel) > wR * uFieldReach) : (length(rel) > wR * 2.0 && ws0.a < 0.004)) discard;
  vec2 wAlong = w1.xy;
  vec2 wAcross = vec2(-w1.y, w1.x);
  // The town's own frame: along its axis, then across it.
  vec2 q = vec2(dot(rel, wAlong), dot(rel, wAcross));
  vec4 w2 = texelFetch(uTownData, ivec2(vTown, 2), 0);
  wTR = wR;
  wTSeed = wSeed;
  wTAlong = wAlong;
  wTAspect = w1.w;
  wTWaves = w2.xyz;
  float dist = length(rel);
  float edge = wEdgeAt(rel);
  float rr = dist / edge;
  float roadD = texture(uRoadDistance, uv).r * uRoadReach;
  // Houses reach a little past the edge, and along a road half as far
  // again, so past those nothing is built and only a ring could draw. Past
  // that there are only fields, and past the fields nothing. Nothing is sown
  // inside 0.85 of the edge or on a road (see sown below).
  bool noTown = uLayer < 0.5 || ((rr > 1.08 && (roadD > 0.3 || rr > 1.55)) && ws0.a < 0.004);
  float fd = dist / (wR * uFieldReach);
  float farm = texture(uTownIndex, uv).a;
  if (noTown && (uLayer > 0.5 || fd > 1.0 || farm < 0.004 || rr <= 0.85 || roadD <= 0.1)) discard;
  vec4 ws1 = texelFetch(uTownState, ivec2(vTown, 1), 0);
  // Built up colour and coverage, premultiplied.
  vec4 town = vec4(0.0);
  float roof = 0.0;
  vec3 roofN = vec3(0.0, 1.0, 0.0);
  float ring = 0.0;
  // A ragged quarter scale noise, for the town's mottle and the fields' edge.
  float rag = tNoise(q / wR * 2.0 + wSeed * 61.0).x - 0.5;
  if (!noTown) {
  // The far patch's edge is ragged and mottled quarter by quarter.
  float fray = tNoise(rel / 0.35 + wSeed * 23.0).x - 0.5;
  float dens = 1.0 - smoothstep(0.72, 1.02, rr + fray * 0.12);
  dens = clamp(dens * (0.7 + 0.6 * tNoise(q / wR * 1.3 + wSeed * 5.0).x), 0.0, 1.0);
  // The main streets: one on from each road that stops at the edge, from the
  // square out to the edge.
  float mainD = 8.0;
  int streets = int(w2.w + 0.5);
  vec4 sa = texelFetch(uTownData, ivec2(vTown, 3), 0);
  vec4 sb = texelFetch(uTownData, ivec2(vTown, 4), 0);
  for (int k = 0; k < 8; k++) {
    if (k >= streets) break;
    float a = k < 4 ? sa[k] : sb[k - 4];
    vec2 dir = vec2(cos(a), sin(a));
    float out_ = dot(rel, dir);
    float side = abs(dot(rel, vec2(-dir.y, dir.x)));
    mainD = min(mainD, out_ > 0.0 ? side : 8.0);
  }
  mainD = mix(mainD, 8.0, smoothstep(0.98, 1.04, rr));
  // Flat dry land only: nothing climbs a steep slope or stands in the sea,
  // though a place on a hillside keeps a little at its middle.
#if W_STYLE == 0
  // Houses strung out along the roads past the edge of the town.
  float ribbon = (1.0 - smoothstep(0.08, 0.3, roadD)) * (1.0 - smoothstep(1.0, 1.5, rr + fray * 0.2));
  ribbon *= 1.0 - smoothstep(1.6, 1.8, dist / wR);
  dens = max(dens, ribbon * 0.7);
#endif
  float fit = texture(uTownIndex, uv).b;
  float fitMask = max(smoothstep(0.3, 0.9, fit), (1.0 - smoothstep(0.3, 0.6, rr)) * smoothstep(0.1, 0.2, fit));
  dens *= fitMask;

  // The ring round a selected or hovered town.
  float ringW = max(0.035, gFoot * 1.3) * (1.0 + 1.2 * ws1.g);
  float ringD = abs(dist - edge * 1.12);
  ring = (1.0 - smoothstep(ringW * 0.5 - gFoot * 0.5, ringW * 0.5 + gFoot * 0.5, ringD)) * ws0.a;

  // Where the roads meet, an open square.
  float square = 1.0 - smoothstep(0.1, 0.16, length(rel) / (1.0 + w1.z * 0.6));
  // Nothing stands on a road or close beside one, so the road shows
  // through, and nothing on a main street.
  const float W_MAIN = 0.035;
  float offRoad = smoothstep(0.1, 0.14, roadD) * (1.0 - square) * smoothstep(W_MAIN, W_MAIN + 0.02, mainD);
  // Far away: one patch, the colour the settlement averages to.
  float farCover = smoothstep(0.0, 0.55, dens) * W_FAR_COVER * smoothstep(0.07, 0.12, roadD);
  vec4 far = vec4(W_FAR * (0.92 + 0.3 * rag) * farCover, farCover);
  town = far;

#if W_STYLE == 0
  float keepBlock = clamp((W_BLOCK / gFoot - 4.0) / 4.0, 0.0, 1.0);
  if (keepBlock > 0.0 && dens > 0.004) {
    WLot base = wLotAt(q, dens, w1.z, gFoot);
    float e = base.e;
    float swE = max(mix(0.007, 0.011, dens), gFoot * 0.4);
    float street = (1.0 - smoothstep(swE - gFoot * 0.5, swE + gFoot * 0.5, e)) * smoothstep(0.2, 0.45, dens) * 0.7;
    float mainW = max(W_MAIN, gFoot * 0.6);
    float main_ = 1.0 - smoothstep(mainW - gFoot * 0.5, mainW + gFoot * 0.5, mainD);
    vec3 streetCol = mix(W_LANE, W_STREET, max(square, main_));
    street = max(street, square * smoothstep(0.2, 0.5, dens));
    street = max(street, main_);
    street *= smoothstep(0.07, 0.1, roadD);
    // Middle distance: blocks in the roofs' colour, lighter or darker block
    // by block, with gardens where houses thin out. Before single roofs can
    // be drawn, a grain of roof colours stands for them.
    float built = clamp(dens * 1.4 - 0.1, 0.0, 1.0) * offRoad;
    vec3 roofs = W_FAR * (0.8 + 0.4 * base.cell);
    // Once single roofs are fully drawn the grain is never seen.
    float keepLot = clamp((W_LOT / gFoot - 1.5) / 2.0, 0.0, 1.0);
    float keepGrain = tShow(0.08, gFoot);
    if (keepGrain > 0.0 && keepLot < 1.0) {
      vec4 speck = tCell(q / 0.08 + wSeed * 7.0);
      roofs = mix(roofs, wRoofTone(speck.w) * (0.55 + 0.9 * fract(speck.w * 7.0)) * smoothstep(0.7, 0.2, speck.x), keepGrain * 0.8);
    }
    vec4 mid = vec4(W_GARDEN.rgb, W_GARDEN.a) * smoothstep(0.0, 0.4, dens);
    mid = wOver(mid, roofs, built);
    mid = wOver(mid, streetCol, street);

    if (keepLot > 0.0) {
      // Close in, buildings stand up from the ground. A roof is seen where
      // the line of sight passes over its plot at roof height, which from a
      // tilted camera is a little beyond the plot, and the wall facing the
      // camera shows on the rest of the plot. Each casts a shadow away
      // from the sun.
      vec3 toEye = normalize(cameraPosition - vPos);
      vec2 lift = vec2(dot(toEye.xz, wAlong), dot(toEye.xz, wAcross)) / max(toEye.y, 0.3);
      vec2 sunQ = normalize(vec2(dot(uSun.xz, wAlong), dot(uSun.xz, wAcross)));
      // Tall blocks stand three times a house's height.
      float high = W_HIGH * (1.0 + 2.0 * base.tall);
      WLot top = wLotAt(q + lift * high, dens, w1.z, gFoot);
      WLot shadow = wLotAt(q + sunQ * high * 1.3, dens, w1.z, gFoot);
      float roofA = top.house * offRoad;
      float wallA = base.house * offRoad * (1.0 - roofA);
      float shadeA = shadow.house * offRoad;
      // A ridge along the street: the front half of the roof faces the
      // street and the back half faces away. A big block's roof is flat.
      vec2 outW = wAlong * top.outQ.x + wAcross * top.outQ.y;
      float side = top.across < 0.5 ? 1.0 : -1.0;
      float pitch = 0.9 * (1.0 - max(top.tall, top.shed));
      roofN = normalize(vec3(outW.x * side * pitch, 1.0, outW.y * side * pitch));
      float wallLit = max(dot(normalize(lift + 1e-4), sunQ), 0.0);
      vec4 lot = vec4(W_GARDEN.rgb, W_GARDEN.a) * step(0.0, base.v) * smoothstep(0.0, 0.3, dens);
      lot = wOver(lot, W_STREET * 0.85, step(0.0, base.v) * max(base.tall, base.shed) * 0.9);
      lot = wOver(lot, streetCol, street);
      lot = wOver(lot, vec3(0.0), shadeA * 0.6);
      lot = wOver(lot, base.tone * (0.35 + 0.45 * wallLit), wallA);
      lot = wOver(lot, top.tone, roofA);
      mid = mix(mid, lot, keepLot);
      roof = roofA * keepLot * keepBlock;
    }
    town = mix(far, mid, keepBlock);
  }
#else
  float keepNear = clamp((W_CELL * 0.3 / gFoot - 2.0) / 3.0, 0.0, 1.0);
  if (keepNear > 0.0) {
    // Towards the sun, in the town's frame.
    vec2 sunQ = normalize(vec2(dot(uSun.xz, wAlong), dot(uSun.xz, wAcross)));
    vec3 tone;
    float high;
    vec4 gnd;
    vec2 lean;
    float b = wStructure(wCellAt(q), gFoot, tone, high, gnd, lean);
    // A point is in shade when something tall enough stands between it and
    // the sun: anything a step away, and only a tower three steps away.
    vec3 t2;
    float h2;
    vec4 g2;
    vec2 l2;
    float shade = wStructure(wCellAt(q + sunQ * 0.02), gFoot, t2, h2, g2, l2) * step(0.005, h2);
    shade = max(shade, wStructure(wCellAt(q + sunQ * 0.06), gFoot, t2, h2, g2, l2) * step(0.045, h2));
    float mainW = max(W_MAIN, gFoot * 0.6);
    float main_ = 1.0 - smoothstep(mainW - gFoot * 0.5, mainW + gFoot * 0.5, mainD);
    float paved = max(main_, square * smoothstep(0.2, 0.5, dens));
    vec4 near = vec4(0.0, 0.0, 0.0, shade * 0.35);
    near = wOver(near, gnd.rgb * (1.0 - 0.45 * shade), gnd.a);
    near = wOver(near, W_CONCRETE * 0.6, paved * 0.8);
    b *= offRoad;
    near = wOver(near, tone, b);
    near *= fitMask;
    vec2 leanW = wAlong * lean.x + wAcross * lean.y;
    roofN = normalize(vec3(leanW.x, sqrt(max(1.0 - dot(lean, lean), 0.04)), leanW.y));
    roof = b * fitMask * keepNear;
    town = mix(far, near, keepNear);
  }
#endif
  }

#if W_OUTSKIRTS == 0
  // Fields round the town: a patchwork of plots in rows turned to the
  // town's axis and bent a little, each sown or left wild, thinning out with
  // distance, on flat grassland and dry ground only, with hedges between.
  float sown = (1.0 - smoothstep(0.45, 1.0, fd + rag * 0.3)) * smoothstep(0.85, 1.1, rr) * farm;
  sown *= smoothstep(0.1, 0.16, roadD);
  if (uLayer < 0.5 && sown > 0.004) {
    vec2 bend = vec2(tNoise(q * 0.35 + wSeed * 3.0).x, tNoise(q * 0.35 + wSeed * 9.0 + 4.0).x) - 0.5;
    vec2 fq = q + bend * 0.9;
    float rowH = W_PLOT * 0.8;
    float row = floor(fq.y / rowH);
    float rowHash = tHash(vec2(row, wSeed * 71.0));
    float plotW = W_PLOT * mix(0.8, 2.0, rowHash);
    float along = fq.x / plotW + rowHash * 13.0;
    vec2 plot = vec2(floor(along), row);
    float ph = tHash(plot + wSeed * 17.0);
    float ph2 = tHash(plot * 1.7 + wSeed * 5.0 + 0.3);
    // Distance to the plot's edge, in world units.
    float fa = fract(along);
    float fr = fract(fq.y / rowH);
    float border = min(min(fa, 1.0 - fa) * plotW, min(fr, 1.0 - fr) * rowH);
    // Plots fade to their average once they are a few pixels across, so a
    // distant patchwork never shimmers.
    float keepPlot = clamp((W_PLOT / gFoot - 2.0) / 4.0, 0.0, 1.0);
    // Dry ground is farmed where water is brought to it, in plots packed
    // tight up to a hard edge, where wetter country's fields thin out.
    float arid = texture(uDryFarm, uv).r;
    float packed = mix(sown, smoothstep(0.08, 0.2, sown), arid);
    float sowThis = mix(min(1.0, packed * 1.2), step(ph, packed * 1.7), keepPlot);
    vec3 crop = wCropTone(ph2);
    vec3 cropMean = W_CROP_MEAN;
    if (arid > 0.01) {
      // Irrigated crops, bare and fallow plots, groves and vines.
      vec2 inPlot = vec2(fa * plotW, fr * rowH);
      vec3 dry = W_DRYPLOUGH;
      if (ph2 < 0.22) {
        dry = W_WET;
      } else if (ph2 < 0.4) {
        dry = W_WET2;
      } else if (ph2 < 0.55) {
        // A grove: trees in a grid on bare soil, an even tone from far off.
        float keepTree = clamp((W_TREES / gFoot - 2.0) / 2.0, 0.0, 1.0);
        float tree = 1.0 - smoothstep(0.2, 0.34, length(fract(inPlot / W_TREES) - 0.5));
        dry = mix(W_SOIL, W_OLIVE, mix(0.32, tree, keepTree));
      } else if (ph2 < 0.67) {
        // Vines: green rows with soil between.
        float keepVine = clamp((W_VINES / gFoot - 2.0) / 2.0, 0.0, 1.0);
        float vine = smoothstep(-0.2, 0.3, sin((ph > 0.5 ? inPlot.x : inPlot.y) / W_VINES * 6.2832));
        dry = mix(W_SOIL, W_VINE, mix(0.5, vine, keepVine) * 0.9);
      } else if (ph2 < 0.82) {
        dry = W_SOIL;
      } else if (ph2 < 0.92) {
        dry = W_FALLOW;
      }
      crop = mix(crop, dry, arid);
      cropMean = mix(cropMean, W_DRY_MEAN, arid);
    }
    // Furrows close in, along or across the plot.
    float furrow = sin((ph > 0.5 ? fq.x : fq.y) / 0.025) * tKeep(0.16, gFoot);
    crop *= 1.0 + 0.07 * furrow;
    // Uneven growth across a plot.
    crop *= 0.9 + 0.2 * tNoise(fq / 0.12 + ph * 31.0).x * tKeep(0.12, gFoot);
    crop = mix(cropMean, crop, keepPlot);
    // Dry ground is levelled before it is farmed, so the fields lie on bare
    // earth and none of the dunes show between them.
    vec4 fields = vec4(uDryGround * (0.9 + 0.2 * rag), 1.0) * smoothstep(0.0, 0.2, sown) * arid;
    fields = wOver(fields, crop, sowThis * mix(0.8, 0.96, arid));
    // Hedges along most plot edges where fields are thick.
    float hedgeW = max(0.014, gFoot * 0.7);
    float hedge = 1.0 - smoothstep(hedgeW * 0.5, hedgeW * 0.5 + gFoot, border);
    hedge *= mix(step(0.2, tHash(plot * 2.3 + wSeed)), 1.0, arid) * smoothstep(0.15, 0.4, sown) * keepPlot;
    // On dry ground most plots are edged by a pale track, and a few by a row
    // of trees against the wind.
    float windbreak = step(0.82, tHash(plot * 3.1 + wSeed));
    fields = wOver(fields, mix(W_HEDGE, W_TRACK, arid * (1.0 - windbreak)), hedge * 0.85);
    town = town + fields * (1.0 - town.a);
  }
#else
  // Round a sealed outpost, in a few clumps close by: solar arrays and
  // greenhouse tunnels, on any flat ground.
  const float W_YARD = 0.32;
  vec2 yg = q / W_YARD + wSeed * 53.0;
  vec2 yid = floor(yg);
  vec2 yc = (yid + 0.5 - wSeed * 53.0) * W_YARD;
  float clump = step(0.66, tNoise(yc / wR * 1.2 + wSeed * 37.0).x);
  float yard = (1.0 - smoothstep(0.3, 0.45, fd)) * smoothstep(0.95, 1.15, rr) * farm * clump * smoothstep(0.1, 0.16, roadD);
  if (uLayer < 0.5 && yard > 0.004) {
    vec2 yp = (fract(yg) - 0.5) * W_YARD;
    float yh = tHash(yid + 2.2);
    vec4 works = vec4(0.0);
    if (yh < 0.45) {
      // Panels in rows, an even dark tone from far off.
      float rows = smoothstep(0.1, 0.2, abs(fract(yp.y / 0.05) - 0.5));
      float cover = wBox(yp, W_YARD * vec2(0.42, 0.36), gFoot) * mix(0.8, rows, tKeep(0.05, gFoot));
      works = vec4(W_SOLAR, 1.0) * cover;
    } else if (yh < 0.6) {
      // Three tunnels side by side, lit along their tops.
      float fv = fract(yp.y / W_YARD * 3.0 + 0.5) - 0.5;
      float cover = wBox(vec2(yp.x, fv * W_YARD / 3.0), W_YARD * vec2(0.4, 0.12), gFoot) * step(abs(yp.y), W_YARD * 0.45);
      works = vec4(W_GLASSHOUSE * (0.7 + 0.6 * (0.5 - abs(fv))), 1.0) * cover;
    }
    town = town + works * smoothstep(0.0, 0.15, yard) * (1.0 - town.a);
  }
#endif
  if (town.a < 0.002 && ring < 0.002) discard;

  // The roads run on through, drawn by the terrain underneath.
  town *= smoothstep(0.07, 0.1, roadD);
  // Light the roofs, pitched toward and away from the sun. Level ground is
  // lit at exactly its own colour, as the terrain's is.
  vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), roofN, roof));
  float facing = max(dot(n, uSun), 0.0);
  town.rgb *= uAmbient + (1.0 - uAmbient) * (facing / uSun.y);
#if W_STYLE == 3
  // A glint where a dome or a module's curve faces the sun.
  town.rgb += pow(max(dot(n, normalize(uSun + vec3(0.0, 1.0, 0.0))), 0.0), 40.0) * 0.35 * roof * town.a;
#endif
  // A town hidden by fog is drawn dim and grey: something is there.
  if (ws1.r > 0.5) {
    town.rgb = mix(town.rgb, vec3(dot(town.rgb, vec3(0.2126, 0.7152, 0.0722))), 0.7) * 0.7;
  }
  town = wOver(town, pow(ws0.rgb, vec3(2.2)), ring);
  gl_FragColor = vec4(town.rgb / max(town.a, 1e-4), town.a);
  #include <colorspace_fragment>
}
`;

/** The shader's number for each layout. */
const STYLE_INDEX: Record<SettlementStyle, number> = {
  organic: 0,
  sealed: 3,
};

const linear = (rgb: [number, number, number]) =>
  new THREE.Color().setRGB(
    rgb[0] / 255,
    rgb[1] / 255,
    rgb[2] / 255,
    THREE.SRGBColorSpace,
  );

/** The material that draws towns, one for every patch. */
export function townMaterial(
  shading: TownShading,
  layer: "fields" | "town",
): THREE.ShaderMaterial {
  const settlement = shading.settlement;
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT.replace("TERRAIN_NOISE_HERE", TERRAIN_NOISE)
      .replace("LAYER_HERE", layer === "town" ? "1.0" : "0.0")
      .replace("STYLE_HERE", String(STYLE_INDEX[settlement.style]))
      .replace("OUTSKIRTS_HERE", settlement.outskirts === "works" ? "1" : "0"),
    uniforms: {
      uTownIndex: { value: shading.index },
      uTownData: { value: shading.data },
      uTownState: { value: shading.state },
      uRoadDistance: { value: shading.roadDistance },
      uTownIndexSize: { value: new THREE.Vector2(...shading.indexSize) },
      uRoadReach: { value: shading.roadReach },
      uFieldReach: { value: TOWN_REACH },
      uDryFarm: { value: shading.dry },
      uDryGround: { value: shading.dryGround },
      uHull: { value: linear(settlement.hull) },
      uTrim: { value: linear(settlement.trim) },
      uDomes: { value: settlement.domes },
      uGarden: { value: shading.garden },
      uFrame: { value: shading.frame },
      uSun: { value: new THREE.Vector3(...TERRAIN_SUN) },
      uAmbient: { value: SHADE_AMBIENT },
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
}
