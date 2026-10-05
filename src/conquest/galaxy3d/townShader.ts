import * as THREE from "three";
import { SHADE_AMBIENT, TERRAIN_SUN } from "./terrain";
import { TERRAIN_NOISE } from "./terrainShader";
import { TOWN_REACH } from "./towns";

/**
 * The shader that draws towns on their patches of ground (`townLayer.ts`): a
 * pale built-up patch from far away, blocks and streets nearer, and single
 * roofs close in, each level fading in once it is a few pixels across. It
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
// 0 draws the fields, 1 the town over them.
uniform float uLayer;
uniform vec4 uFrame;
uniform vec3 uSun;
uniform float uAmbient;
varying vec3 vPos;
flat varying int vTown;
TERRAIN_NOISE_HERE

// Roof and street colours, linear, from sRGB terracotta (160, 98, 76), brick
// (128, 84, 70), slate (100, 104, 112), brown (126, 108, 92), pale stone
// (176, 170, 160), paving (176, 168, 154) and a side street's darker
// surface (130, 124, 116). Muted, as seen from the air.
const vec3 W_TERRACOTTA = vec3(0.359, 0.122, 0.070);
const vec3 W_BRICK = vec3(0.220, 0.087, 0.058);
const vec3 W_SLATE = vec3(0.128, 0.139, 0.164);
const vec3 W_BROWN = vec3(0.212, 0.151, 0.106);
const vec3 W_PALE = vec3(0.442, 0.410, 0.359);
const vec3 W_STREET = vec3(0.442, 0.399, 0.330);
const vec3 W_LANE = vec3(0.227, 0.211, 0.177);
// What the roofs and streets of a town average to from far away, a warm
// grey pink, sRGB (166, 134, 120).
const vec3 W_TOWN = vec3(0.389, 0.243, 0.190);
// Gardens and yards: the ground shows through, darker and greener.
const vec4 W_GARDEN = vec4(0.012, 0.025, 0.008, 0.22);

// A block of a town is about this wide, and a house's plot this long along
// its street, in world units.
const float W_BLOCK = 0.5;
const float W_LOT = 0.09;

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
// A field's plot is about this wide, in world units.
const float W_PLOT = 0.42;

// One field's colour from a 0 to 1 hash, mostly greens.
vec3 wCropTone(float h) {
  return h < 0.25 ? W_GREEN : h < 0.42 ? W_PALEGRASS : h < 0.57 ? W_DARK : h < 0.72 ? W_WHEAT : h < 0.86 ? W_OCHRE : W_PLOUGH;
}

// One roof's colour from a 0 to 1 hash: mostly tile, then slate and brown.
vec3 wRoofTone(float h) {
  return h < 0.3 ? W_TERRACOTTA : h < 0.5 ? W_BRICK : h < 0.75 ? W_SLATE : h < 0.9 ? W_BROWN : W_PALE;
}

// Lay a colour with coverage over a premultiplied one.
vec4 wOver(vec4 under, vec3 col, float a) {
  return vec4(col * a, a) + under * (1.0 - a);
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
  vec2 wAlong = w1.xy;
  vec2 wAcross = vec2(-w1.y, w1.x);
  // The town's own frame: along its axis, then across it.
  vec2 q = vec2(dot(rel, wAlong), dot(rel, wAcross));
  vec4 w2 = texelFetch(uTownData, ivec2(vTown, 2), 0);
  // The town's edge in this direction, as townEdge in towns.ts works it out,
  // so the roads the CPU cut at the edge stop where the houses begin.
  float dist = length(rel);
  float ang = atan(rel.y, rel.x);
  float ell = length(q) / max(length(vec2(q.x, q.y * w1.w)), 1e-5);
  float edge = wR * ell * (1.0 + 0.14 * sin(2.0 * ang + w2.x) + 0.08 * sin(3.0 * ang + w2.y) + 0.05 * sin(5.0 * ang + w2.z));
  float rr = dist / edge;
  float roadD = texture(uRoadDistance, uv).r * uRoadReach;
  // Houses reach a little past the edge, and along a road half as far
  // again, so past those nothing is built and only a ring could draw. Past
  // that there are only fields, and past the fields nothing.
  bool noTown = uLayer < 0.5 || ((rr > 1.08 && (roadD > 0.3 || rr > 1.55)) && ws0.a < 0.004);
  float fd = dist / (wR * uFieldReach);
  float farm = texture(uTownIndex, uv).a;
  if (noTown && (uLayer > 0.5 || fd > 1.0 || farm < 0.004)) discard;
  vec4 ws1 = texelFetch(uTownState, ivec2(vTown, 1), 0);
  // Built up colour and coverage, premultiplied.
  vec4 town = vec4(0.0);
  float roof = 0.0;
  vec3 roofN = vec3(0.0, 1.0, 0.0);
  float ring = 0.0;
  // A ragged quarter scale noise, for the town's mottle and the fields' edge.
  float rag = tNoise(q / wR * 2.0 + wSeed * 61.0).x - 0.5;
  if (!noTown) {
  // The edge is ragged house by house, and mottled quarter by quarter.
  float fray = tNoise(rel / 0.35 + wSeed * 23.0).x - 0.5;
  float dens = 1.0 - smoothstep(0.72, 1.02, rr + fray * 0.12);
  // Denser quarters and looser ones, so the town has a centre and is not
  // the same all the way out.
  dens = clamp(dens * (0.7 + 0.6 * tNoise(q / wR * 1.3 + wSeed * 5.0).x), 0.0, 1.0);
  // Houses strung out along the roads past the edge of the town.
  float ribbon = (1.0 - smoothstep(0.08, 0.3, roadD)) * (1.0 - smoothstep(1.0, 1.5, rr + fray * 0.2));
  ribbon *= 1.0 - smoothstep(1.6, 1.8, dist / wR);
  dens = max(dens, ribbon * 0.7);
  // The main streets: one on from each road that stops at the edge, from the
  // square out to the edge, a little wider than the side streets.
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
  // Flat dry land only: no town climbs a steep slope or stands in the sea,
  // though a place on a hillside keeps a village at its middle.
  float fit = texture(uTownIndex, uv).b;
  dens *= max(smoothstep(0.3, 0.9, fit), (1.0 - smoothstep(0.3, 0.6, rr)) * smoothstep(0.1, 0.2, fit));

  // The ring round a selected or hovered town.
  float ringW = max(0.035, gFoot * 1.3) * (1.0 + 1.2 * ws1.g);
  float ringD = abs(dist - edge * 1.12);
  ring = (1.0 - smoothstep(ringW * 0.5 - gFoot * 0.5, ringW * 0.5 + gFoot * 0.5, ringD)) * ws0.a;

  // Where the roads meet, a square with no houses on it.
  float square = 1.0 - smoothstep(0.1, 0.16, length(rel) / (1.0 + w1.z * 0.6));
  // No houses on a road or close beside one, so the road shows through, and
  // none on a main street.
  const float W_MAIN = 0.028;
  float offRoad = smoothstep(0.1, 0.14, roadD) * (1.0 - square) * smoothstep(W_MAIN, W_MAIN + 0.02, mainD);
  // Far away: one pale patch, the colour roofs and streets average to.
  float farCover = smoothstep(0.0, 0.55, dens) * 0.85 * smoothstep(0.07, 0.12, roadD);
  // Mottled a little, as a town's quarters are from the air.
  vec4 far = vec4(W_TOWN * (0.92 + 0.3 * rag) * farCover, farCover);
  town = far;

  float keepBlock = clamp((W_BLOCK / gFoot - 8.0) / 6.0, 0.0, 1.0);
  if (keepBlock > 0.0 && dens > 0.004) {
    // Streets curve, so the blocks are bent a little.
    vec2 warp = vec2(tNoise(q * 0.9 + wSeed * 13.0).x, tNoise(q * 0.9 + wSeed * 29.0 + 5.0).x) - 0.5;
    vec2 bMid;
    float bCell;
    vec4 blk = wBlocks((q + warp * 0.35) / W_BLOCK + wSeed * 101.0, bMid, bCell);
    float e = blk.x * W_BLOCK;
    float sw = mix(0.014, 0.024, dens);
    float swE = max(sw, gFoot * 0.55);
    float street = (1.0 - smoothstep(swE - gFoot * 0.5, swE + gFoot * 0.5, e)) * smoothstep(0.2, 0.45, dens);
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
    vec3 roofs = W_TOWN * (0.8 + 0.4 * bCell);
    // Once single roofs are fully drawn the grain is never seen.
    float keepLot = clamp((W_LOT / gFoot - 2.5) / 3.0, 0.0, 1.0);
    float keepGrain = tKeep(0.2, gFoot);
    if (keepGrain > 0.0 && keepLot < 1.0) {
      vec4 speck = tCell(q / 0.2 + wSeed * 7.0);
      roofs = mix(roofs, wRoofTone(speck.w) * (0.75 + 0.5 * smoothstep(0.6, 0.1, speck.x)), keepGrain * 0.7);
    }
    vec4 mid = vec4(W_GARDEN.rgb, W_GARDEN.a) * smoothstep(0.0, 0.4, dens);
    mid = wOver(mid, roofs, built);
    mid = wOver(mid, streetCol, street);

    if (keepLot > 0.0) {
      // Close in: houses side by side along each street, in a front row
      // and, nearer the middle of town, rows behind it.
      vec2 tang = vec2(-blk.z, blk.y);
      float lotW = W_LOT * mix(0.85, 1.25, fract(blk.w * 13.7)) * (1.0 + 0.15 * w1.z);
      float depth = mix(0.075, 0.11, fract(blk.w * 7.3));
      float v = (e - sw) / depth;
      float u = dot(-bMid, tang) * W_BLOCK / lotW;
      float lotI = floor(u);
      float fu = fract(u);
      float row = floor(v);
      float fv = fract(v);
      float lh = tHash(vec2(lotI + row * 31.0, blk.w * 517.0 + bCell * 91.0));
      float lh2 = tHash(vec2(lotI * 1.7 + row * 5.0, bCell * 313.0 + 3.1));
      float want = row < 0.5 ? dens * 1.3 : row < 1.5 ? (dens - 0.35) * 1.8 : row < 2.5 ? (dens - 0.6) * 2.0 : -1.0;
      float gap = mix(0.32, 0.05, dens);
      float setback = row < 0.5 ? (1.0 - dens) * 0.35 * lh2 : 0.06;
      float back = 1.0 - (1.0 - dens) * 0.3 * fract(lh2 * 7.0);
      float au = gFoot / lotW * 0.7;
      float av = gFoot / depth * 0.7;
      float house = step(0.0, v) * step(lh, want);
      house *= smoothstep(-au, au, min(fu - gap * 0.5, 1.0 - gap * 0.5 - fu));
      house *= smoothstep(-av, av, min(fv - setback, back - fv));
      house *= offRoad;
      vec3 tone = wRoofTone(lh2) * (0.85 + 0.3 * fract(lh * 11.0));
      // A gable along the street: the front half of the roof faces the
      // street and the back half faces away.
      float across = (fv - setback) / max(back - setback, 1e-3);
      vec2 outW = wAlong * blk.y + wAcross * blk.z;
      float side = across < 0.5 ? 1.0 : -1.0;
      roofN = normalize(vec3(outW.x * side * 0.75, 1.0, outW.y * side * 0.75));
      // Houses shade the street on the side away from the sun.
      float shadeSide = clamp(dot(-outW, normalize(uSun.xz)) * 2.0, 0.0, 1.0);
      float frontBuilt = step(lh, dens * 1.3) * (1.0 - smoothstep(0.0, swE, swE - e));
      vec4 lot = vec4(W_GARDEN.rgb, W_GARDEN.a) * step(0.0, v) * smoothstep(0.0, 0.3, dens);
      lot = wOver(lot, mix(W_LANE * 0.8, W_LANE, 0.5), step(0.0, v) * smoothstep(0.6, 0.95, dens) * 0.8);
      lot = wOver(lot, tone, house);
      lot = wOver(lot, streetCol * (1.0 - 0.35 * shadeSide * frontBuilt), street);
      mid = mix(mid, lot, keepLot);
      roof = house * keepLot * keepBlock;
    }
    town = mix(far, mid, keepBlock);
  }
  }

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
    float sowThis = mix(min(1.0, sown * 1.2), step(ph, sown * 1.7), keepPlot);
    vec3 crop = wCropTone(ph2);
    // Furrows close in, along or across the plot.
    float furrow = sin((ph > 0.5 ? fq.x : fq.y) / 0.025) * tKeep(0.16, gFoot);
    crop *= 1.0 + 0.07 * furrow;
    // Uneven growth across a plot.
    crop *= 0.9 + 0.2 * tNoise(fq / 0.12 + ph * 31.0).x * tKeep(0.12, gFoot);
    crop = mix(W_CROP_MEAN, crop, keepPlot);
    vec4 fields = vec4(crop, 1.0) * sowThis * 0.8;
    // Hedges along most plot edges where fields are thick.
    float hedgeW = max(0.014, gFoot * 0.7);
    float hedge = 1.0 - smoothstep(hedgeW * 0.5, hedgeW * 0.5 + gFoot, border);
    hedge *= step(0.2, tHash(plot * 2.3 + wSeed)) * smoothstep(0.15, 0.4, sown) * keepPlot;
    fields = wOver(fields, W_HEDGE, hedge * 0.85);
    town = town + fields * (1.0 - town.a);
  }
  if (town.a < 0.002 && ring < 0.002) discard;

  // The roads run on through, drawn by the terrain underneath.
  town *= smoothstep(0.07, 0.1, roadD);
  // Light the roofs, pitched toward and away from the sun. Level ground is
  // lit at exactly its own colour, as the terrain's is.
  vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), roofN, roof));
  float facing = max(dot(n, uSun), 0.0);
  town.rgb *= uAmbient + (1.0 - uAmbient) * (facing / uSun.y);
  // A town hidden by fog is drawn dim and grey: something is there.
  if (ws1.r > 0.5) {
    town.rgb = mix(town.rgb, vec3(dot(town.rgb, vec3(0.2126, 0.7152, 0.0722))), 0.7) * 0.7;
  }
  town = wOver(town, pow(ws0.rgb, vec3(2.2)), ring);
  gl_FragColor = vec4(town.rgb / max(town.a, 1e-4), town.a);
  #include <colorspace_fragment>
}
`;

/** The material that draws towns, one for every patch. */
export function townMaterial(
  shading: TownShading,
  layer: "fields" | "town",
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT.replace("TERRAIN_NOISE_HERE", TERRAIN_NOISE),
    uniforms: {
      uTownIndex: { value: shading.index },
      uTownData: { value: shading.data },
      uTownState: { value: shading.state },
      uRoadDistance: { value: shading.roadDistance },
      uTownIndexSize: { value: new THREE.Vector2(...shading.indexSize) },
      uRoadReach: { value: shading.roadReach },
      uFieldReach: { value: TOWN_REACH },
      uLayer: { value: layer === "town" ? 1 : 0 },
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
