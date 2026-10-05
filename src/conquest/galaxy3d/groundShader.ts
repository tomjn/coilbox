import * as THREE from "three";

/**
 * Roads painted into the terrain sheet, added to its shader by
 * `terrainShader.ts`. The road mask (`roadMask.ts`) says how far each point
 * lies from the nearest road and which road it is. From that the shader draws
 * a narrow track with a soft, worn edge and a slight cut into the ground, in
 * the road's surface, and over it the road's state: an owner's edge lines, a
 * glow along a road the player can attack along, a road already travelled
 * filled in. A road hidden by fog is not drawn at all.
 *
 * The track keeps a width in world units close in, and never draws thinner
 * than a pixel or two far out, so it neither vanishes nor turns into a
 * motorway with the zoom.
 *
 * Display only.
 */

/** What the terrain shader is given to draw roads. */
export interface GroundShading {
  /** The road mask's distances alone, blended between texels. */
  roadDistance: THREE.Texture;
  /** The whole road mask, `roadMask.ts`, read texel by texel. */
  roadMask: THREE.Texture;
  roadMaskSize: [number, number];
  /** One column per road: see {@link ROAD_STATE_ROWS}. */
  roadState: THREE.Texture;
  /** {@link ROAD_REACH} in world units. */
  roadReach: number;
  /** The sheet's half width and half depth, then its width and depth. */
  frame: THREE.Vector4;
  /** Towns painted into the ground. Left out, none are drawn. */
  towns?: TownShading;
}

/** What the terrain shader is given to draw towns. See `towns.ts`. */
export interface TownShading {
  /** `buildTownIndex`: which town each part of the sheet belongs to. */
  index: THREE.Texture;
  indexSize: [number, number];
  /** `townDataTexels`: where each town is and its shape. */
  data: THREE.Texture;
  /** One column per town: see {@link TOWN_STATE_ROWS}. */
  state: THREE.Texture;
}

/**
 * The town state texture's rows. Row 0 holds the colour of the ring drawn
 * round the town in sRGB and its strength, 0 for no ring. Row 1 holds
 * whether the town is hidden by fog and how wide its ring is drawn, from 0
 * for a thin one to 1 for a thick one.
 */
export const TOWN_STATE_ROWS = 2;

/**
 * The road state texture's rows. Row 0 holds the state's colour in sRGB and
 * its strength. Row 1 holds whether the road is drawn, its {@link RoadMode}
 * and whether it is emphasised.
 */
export const ROAD_STATE_ROWS = 2;

/** How a road's state is drawn over its track. */
export const ROAD_MODE = {
  /** The track alone. */
  plain: 0,
  /** Thin lines along both edges: the road's two ends share an owner. */
  edges: 1,
  /** A glow over and round the track, with edge lines: it can be attacked
   * along, or it is a step open on a run. */
  glow: 2,
  /** The track itself filled in, with edge lines: already travelled. */
  filled: 3,
} as const;

export type RoadMode = (typeof ROAD_MODE)[keyof typeof ROAD_MODE];

export const GROUND_HEAD = /* glsl */ `
uniform sampler2D uRoadDistance;
uniform sampler2D uRoadMask;
uniform sampler2D uRoadState;
uniform vec2 uRoadMaskSize;
uniform float uRoadReach;
uniform vec4 uGroundFrame;

// Track colours, linear, from the least used surface to the most: sRGB
// (222, 206, 170), (196, 190, 178) and (104, 104, 106).
const vec3 G_TRACK = vec3(0.730, 0.617, 0.402);
const vec3 G_GRAVEL = vec3(0.552, 0.514, 0.445);
const vec3 G_PAVED = vec3(0.138, 0.138, 0.144);
`;

/**
 * Runs before lighting, where `albedo` and `n` are the ground's colour and
 * normal. Leaves `gGlow` for {@link GROUND_LIT}, which lays the state over
 * the lit colour so it reads as a marking and not as ground.
 */
export const GROUND_BODY = /* glsl */ `
vec4 gGlow = vec4(0.0);
vec4 gTownGlow = vec4(0.0);
{
  vec2 gUv = (vTerrainPos.xz + uGroundFrame.xy) / uGroundFrame.zw;
  bool onSheet = gUv.x >= 0.0 && gUv.y >= 0.0 && gUv.x <= 1.0 && gUv.y <= 1.0;
  // A generated map has no road on the sea, which is height 0. A hand-made
  // map's lowest ground may be land, so there every point is looked at.
  bool gSea = uTerrainDetail > 0.5 && nh.a * 255.0 < 0.35;
  // Most of the map is far from any road, and this one cheap read says so.
  float gDist = onSheet && !gSea ? texture2D(uRoadDistance, gUv).r : 1.0;
  vec2 gp = vTerrainPos.xz;
  float gFoot = max(length(dFdx(gp)), length(dFdy(gp))) + 1e-5;
  // The furthest from a road anything is drawn: the widest track, then its
  // glow or its worn verge.
  float gNeed = max(0.13, 0.75 * gFoot) + max(0.2, gFoot * 3.5);
  // Towards the horizon a pixel spans so much ground that a road held to a
  // pixel's width would cover it all, so roads fade out there instead.
  float gFade = 1.0 - smoothstep(0.2, 0.4, gFoot);
  // Towns (TOWN_BODY), under the roads so a road runs on through as a street.
  TOWN_BODY_HERE
  if (gDist < 0.999 && gDist * uRoadReach < gNeed && gFade > 0.0) {
    // Which road this is, read without blending.
    ivec2 tc = clamp(ivec2(gUv * uRoadMaskSize), ivec2(0), ivec2(uRoadMaskSize) - 1);
    vec4 idx = texelFetch(uRoadMask, tc, 0);
    int tag = int(idx.b * 255.0 + 0.5) * 256 + int(idx.a * 255.0 + 0.5);
    float shown = 1.0;
    float mode = 0.0;
    float emph = 0.0;
    vec4 tone = vec4(0.0);
    if (tag > 0) {
      vec4 s1 = texelFetch(uRoadState, ivec2(tag - 1, 1), 0);
      shown = s1.r;
      mode = floor(s1.g * 255.0 + 0.5);
      emph = s1.b;
      tone = texelFetch(uRoadState, ivec2(tag - 1, 0), 0);
    }
    if (shown > 0.5) {
      float d = gDist * uRoadReach;
      float surf = idx.g;
      // Half the track's width in world units: a dirt track is the narrowest.
      float hw = mix(0.055, 0.085, surf);
      // Close in, worn edges where the width wanders a little along the
      // road, and ruts and dust so the track is never one flat colour.
      float keepNear = tKeep(0.15, gFoot);
      float wob = 0.0;
      float grain = 0.0;
      if (keepNear > 0.0) {
        wob = (tNoise(gp * 7.0).x - 0.5) * keepNear;
        grain = (tNoise(gp * 23.0 + 5.0).x - 0.5) * keepNear;
      }
      hw *= 1.0 + 0.45 * wob;
      // Never thinner than a pixel and a half, and fainter when held there,
      // so a far road reads as a fine line and not a band.
      float hwMin = 0.75 * gFoot;
      float hwE = max(hw, hwMin);
      float soft = max(hw * 0.3, gFoot * 0.7);
      float cover = 1.0 - smoothstep(hwE - soft, hwE + soft, d);
      cover *= mix(1.0, 0.7, smoothstep(hw, hw * 2.5, hwMin)) * gFade;

      vec3 track = surf < 0.5 ? mix(G_TRACK, G_GRAVEL, surf * 2.0) : mix(G_GRAVEL, G_PAVED, surf * 2.0 - 1.0);
      track *= 1.0 + grain * 0.35;
      // Worn ground beside the track, paler and drier than what grows there.
      float verge = (1.0 - smoothstep(hwE, hwE * 2.8 + gFoot, d)) * (1.0 - cover);
      vec3 worn = mix(albedo, track * 0.85 + albedo * 0.15, 0.35);
      albedo = mix(albedo, worn, verge * 0.55 * tKeep(0.2, gFoot) * gFade);
      albedo = mix(albedo, track, cover * 0.95);

      // A slight cut: the ground falls into the track at its edges, so one
      // side catches the sun and the other is in shade.
      float keepCut = tKeep(0.12, gFoot);
      if (keepCut > 0.0) {
        vec2 texelW = uGroundFrame.zw / uRoadMaskSize;
        vec2 du = vec2(1.0 / uRoadMaskSize.x, 0.0);
        vec2 dv = vec2(0.0, 1.0 / uRoadMaskSize.y);
        vec2 grad = vec2(
          texture2D(uRoadDistance, gUv + du).r - texture2D(uRoadDistance, gUv - du).r,
          texture2D(uRoadDistance, gUv + dv).r - texture2D(uRoadDistance, gUv - dv).r
        ) * uRoadReach / (2.0 * texelW);
        float edge = smoothstep(hwE * 0.5, hwE, d) * (1.0 - smoothstep(hwE, hwE * 1.8, d));
        n = normalize(n - vec3(grad.x, 0.0, grad.y) * edge * 0.6 * keepCut);
      }

      // The road's state, over the lit ground.
      if (mode > 0.5 && tone.a > 0.0) {
        float ew = max(0.022, gFoot * 1.1) * (1.0 + emph * 0.8);
        float e0 = hwE + max(0.03, gFoot * 1.2) + ew * 0.5;
        float edgeLine = 1.0 - smoothstep(ew * 0.5 - gFoot * 0.5, ew * 0.5 + gFoot * 0.5, abs(d - e0));
        float a = edgeLine;
        if (mode > 1.5 && mode < 2.5) {
          // Round the track and not over it, so the track still shows.
          float halo = (1.0 - smoothstep(hwE, hwE + max(0.16, gFoot * 3.0), d)) * smoothstep(hwE * 0.7, hwE * 1.1, d);
          a = max(a, halo * 0.5);
        } else if (mode > 2.5) {
          a = max(a, cover * 0.8);
        }
        gGlow = vec4(pow(tone.rgb, vec3(2.2)), clamp(a * tone.a * gFade, 0.0, 1.0));
      }
    }
  }
}
`;

/** Runs after lighting, on `lit`. */
export const GROUND_LIT = /* glsl */ `
lit = mix(lit, gTownGlow.rgb, gTownGlow.a);
lit = mix(lit, gGlow.rgb, gGlow.a);
`;

/** Uniforms, colours and helpers for {@link TOWN_BODY}. */
export const TOWN_HEAD = /* glsl */ `
uniform sampler2D uTownIndex;
uniform sampler2D uTownData;
uniform sampler2D uTownState;
uniform vec2 uTownIndexSize;

// Roof and street colours, linear, from sRGB terracotta (160, 98, 76), brick
// (128, 84, 70), slate (100, 104, 112), brown (126, 108, 92), pale stone
// (176, 170, 160), and paving (176, 168, 154). Muted, as seen from the air.
const vec3 W_TERRACOTTA = vec3(0.359, 0.122, 0.070);
const vec3 W_BRICK = vec3(0.220, 0.087, 0.058);
const vec3 W_SLATE = vec3(0.128, 0.139, 0.164);
const vec3 W_BROWN = vec3(0.212, 0.151, 0.106);
const vec3 W_PALE = vec3(0.442, 0.410, 0.359);
const vec3 W_STREET = vec3(0.442, 0.399, 0.330);
// A side street's darker surface, sRGB (130, 124, 116).
const vec3 W_LANE = vec3(0.227, 0.211, 0.177);
// What the roofs and streets of a town average to from far away, a grey tan,
// sRGB (150, 136, 122).
const vec3 W_TOWN = vec3(0.311, 0.251, 0.198);

// One roof's colour from a 0 to 1 hash: mostly tile, then slate and brown.
vec3 wRoofTone(float h) {
  return h < 0.3 ? W_TERRACOTTA : h < 0.5 ? W_BRICK : h < 0.75 ? W_SLATE : h < 0.9 ? W_BROWN : W_PALE;
}

// A block of a town is about this wide, and a house's plot this long along
// its street, in world units.
const float W_BLOCK = 0.5;
const float W_LOT = 0.09;

// The town's blocks: cells round a scatter of points, one per unit square.
// Returns the distance to the nearest edge of this block in .x, the edge's
// normal pointing out of the block in .yz, and a hash of that edge in .w.
// \`mid\` is the edge's midpoint relative to \`x\`, \`cell\` a hash of the block.
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
`;

/**
 * A town drawn into the ground: a pale built-up patch from far away, blocks
 * and streets nearer, and single roofs close in, each level fading in once it
 * is a few pixels across. Runs inside {@link GROUND_BODY}, where `gDist` is
 * the distance to the nearest road, so the roads run on into the town as its
 * main streets and houses line them.
 */
export const TOWN_BODY = /* glsl */ `
{
  ivec2 wti = clamp(ivec2(gUv * uTownIndexSize), ivec2(0), ivec2(uTownIndexSize) - 1);
  vec4 wix = onSheet ? texelFetch(uTownIndex, wti, 0) : vec4(0.0);
  int wTown = int(wix.r * 255.0 + 0.5) * 256 + int(wix.g * 255.0 + 0.5);
  if (wTown > 0 && !gSea) {
    vec4 w0 = texelFetch(uTownData, ivec2(wTown - 1, 0), 0);
    vec4 w1 = texelFetch(uTownData, ivec2(wTown - 1, 1), 0);
    vec4 ws0 = texelFetch(uTownState, ivec2(wTown - 1, 0), 0);
    vec4 ws1 = texelFetch(uTownState, ivec2(wTown - 1, 1), 0);
    vec2 rel = gp - w0.xy;
    float wR = w0.z;
    float wSeed = w0.w;
    vec2 wAlong = w1.xy;
    vec2 wAcross = vec2(-w1.y, w1.x);
    // The town's own frame: along its axis, then across it.
    vec2 q = vec2(dot(rel, wAlong), dot(rel, wAcross));
    float rr = length(vec2(q.x, q.y * w1.w)) / wR;
    // A ragged edge, so no town is a disc.
    float rag = tNoise(q / wR * 2.0 + wSeed * 61.0).x - 0.5;
    rag += (tNoise(q / wR * 5.5 + wSeed * 23.0).x - 0.5) * 0.5;
    float dens = 1.0 - smoothstep(0.4, 1.1, rr + rag * 0.5);
    float roadD = gDist * uRoadReach;
    // Houses strung out along the roads past the edge of the town.
    float ribbon = (1.0 - smoothstep(0.08, 0.32, roadD)) * (1.0 - smoothstep(0.8, 1.65, rr + rag * 0.4));
    dens = max(dens, ribbon * 0.5);
    // Flat dry land only: no town climbs a steep slope or stands in the sea.
    vec3 wN = normalize(nh.xyz * 2.0 - 1.0);
    dens *= 1.0 - smoothstep(0.025, 0.07, 1.0 - wN.y);
    dens *= smoothstep(0.65, 1.2, nh.a * 255.0);

    // The ring round a selected or hovered town.
    float ringW = max(0.035, gFoot * 1.3) * (1.0 + 1.2 * ws1.g);
    float ringD = abs(length(vec2(q.x, q.y * w1.w)) - wR * 1.12);
    float ring = 1.0 - smoothstep(ringW * 0.5 - gFoot * 0.5, ringW * 0.5 + gFoot * 0.5, ringD);
    gTownGlow = vec4(pow(ws0.rgb, vec3(2.2)), ring * ws0.a);

    if (dens > 0.004) {
      // Far away: one pale patch, the colour roofs and streets average to.
      vec3 wCol = W_TOWN;
      float wCover = smoothstep(0.0, 0.55, dens) * 0.85;
      // Where the roads meet, a square with no houses on it.
      float square = 1.0 - smoothstep(0.1, 0.16, length(rel) / (1.0 + w1.z * 0.6));
      // No houses on a road or close beside one.
      float offRoad = smoothstep(0.1, 0.14, roadD) * (1.0 - square);
      vec3 roofN = n;
      float roof = 0.0;

      float keepBlock = clamp((W_BLOCK / gFoot - 4.0) / 6.0, 0.0, 1.0);
      if (keepBlock > 0.0) {
        // Streets curve, so the blocks are bent a little.
        vec2 warp = vec2(tNoise(q * 0.9 + wSeed * 13.0).x, tNoise(q * 0.9 + wSeed * 29.0 + 5.0).x) - 0.5;
        vec2 bMid;
        float bCell;
        vec4 blk = wBlocks((q + warp * 0.35) / W_BLOCK + wSeed * 101.0, bMid, bCell);
        float e = blk.x * W_BLOCK;
        float sw = mix(0.014, 0.024, dens);
        float swE = max(sw, gFoot * 0.55);
        float street = (1.0 - smoothstep(swE - gFoot * 0.5, swE + gFoot * 0.5, e)) * smoothstep(0.2, 0.45, dens);
        // The square is paved pale, and the side streets darker.
        vec3 streetCol = mix(W_LANE, W_STREET, square);
        street = max(street, square * smoothstep(0.2, 0.5, dens));
        // Middle distance: blocks in the roofs' colour, lighter or darker
        // block by block, with gardens showing where houses thin out. Before
        // single roofs can be drawn, a grain of roof colours stands for them.
        float built = clamp(dens * 1.4 - 0.1, 0.0, 1.0) * offRoad;
        vec3 roofs = W_TOWN * (0.8 + 0.4 * bCell);
        float keepGrain = tKeep(0.2, gFoot);
        if (keepGrain > 0.0) {
          vec4 speck = tCell(q / 0.2 + wSeed * 7.0);
          roofs = mix(roofs, wRoofTone(speck.w) * (0.75 + 0.5 * smoothstep(0.6, 0.1, speck.x)), keepGrain * 0.7);
        }
        vec3 blockCol = mix(albedo * 0.85, roofs, built);
        vec3 midCol = mix(blockCol, streetCol, street);
        float midCover = max(street, smoothstep(0.0, 0.4, dens));

        float keepLot = clamp((W_LOT / gFoot - 2.5) / 3.0, 0.0, 1.0);
        if (keepLot > 0.0) {
          // Close in: houses side by side along each street, in a front
          // row and, near the middle of town, a row behind it.
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
          vec3 tone = wRoofTone(lh2);
          tone *= 0.85 + 0.3 * fract(lh * 11.0);
          // A gable along the street: the front half of the roof faces the
          // street and the back half faces away.
          float across = (fv - setback) / max(back - setback, 1e-3);
          vec2 outW = wAlong * blk.y + wAcross * blk.z;
          float side = across < 0.5 ? 1.0 : -1.0;
          roofN = normalize(vec3(outW.x * side * 0.75, 1.0, outW.y * side * 0.75));
          // Gardens behind the houses, and yards in the crowded middle.
          vec3 yard = mix(albedo * 0.75, W_LANE * 0.8, smoothstep(0.6, 0.95, dens));
          vec3 lotCol = mix(yard, tone, house);
          // Houses shade the street on the side away from the sun.
          float shadeSide = clamp(dot(-outW, normalize(uTerrainSun.xz)) * 2.0, 0.0, 1.0);
          float frontBuilt = step(lh, dens * 1.3) * (1.0 - smoothstep(0.0, swE, swE - e));
          lotCol = mix(lotCol, streetCol * (1.0 - 0.35 * shadeSide * frontBuilt), street);
          float lotCover = max(street, max(house, smoothstep(0.0, 0.3, dens)));
          midCol = mix(midCol, lotCol, keepLot);
          midCover = mix(midCover, lotCover, keepLot);
          roof = house * keepLot * keepBlock;
        }
        wCol = mix(wCol, midCol, keepBlock);
        wCover = mix(wCover, midCover, keepBlock);
      }
      // A town hidden by fog is drawn dim and grey: something is there.
      if (ws1.r > 0.5) {
        wCol = mix(wCol, vec3(dot(wCol, vec3(0.2126, 0.7152, 0.0722))), 0.7) * 0.7;
      }
      albedo = mix(albedo, wCol, wCover);
      // Streets and yards are level, and roofs pitched.
      n = normalize(mix(n, wN, wCover * 0.8));
      n = normalize(mix(n, roofN, roof));
    }
  }
}
`;

/** Set the shader's uniforms for {@link GROUND_HEAD}. */
export function groundUniforms(
  ground: GroundShading,
): Record<string, { value: unknown }> {
  const towns = ground.towns;
  return {
    ...(towns && {
      uTownIndex: { value: towns.index },
      uTownData: { value: towns.data },
      uTownState: { value: towns.state },
      uTownIndexSize: { value: new THREE.Vector2(...towns.indexSize) },
    }),
    uRoadDistance: { value: ground.roadDistance },
    uRoadMask: { value: ground.roadMask },
    uRoadState: { value: ground.roadState },
    uRoadMaskSize: { value: new THREE.Vector2(...ground.roadMaskSize) },
    uRoadReach: { value: ground.roadReach },
    uGroundFrame: { value: ground.frame },
  };
}
