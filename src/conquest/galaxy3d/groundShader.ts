import * as THREE from "three";
import type { Settlement } from "../planets";

/**
 * Roads painted into the terrain sheet, added to its shader by
 * `terrainShader.ts`. The road mask (`roadMask.ts`) says how far each point
 * lies from the nearest road and which road it is. From that the shader draws
 * a narrow track with a soft, worn edge and a slight cut into the ground, in
 * the road's surface as the planet has it (`Settlement.roads` in
 * `planets.ts`), and over it the road's state: an owner's edge lines, a
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
  /**
   * The road mask's distances alone, blended between texels. One byte a
   * texel, so the town layer reads the same distances on the CPU.
   */
  roadDistance: THREE.DataTexture;
  /** The whole road mask, `roadMask.ts`, read texel by texel. */
  roadMask: THREE.Texture;
  roadMaskSize: [number, number];
  /** One column per road: see {@link ROAD_STATE_ROWS}. */
  roadState: THREE.Texture;
  /** {@link ROAD_REACH} in world units. */
  roadReach: number;
  /** The sheet's half width and half depth, then its width and depth. */
  frame: THREE.Vector4;
  /** The planet's roads (`Settlement.roads` in `planets.ts`). */
  roads: Settlement["roads"];
}

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

// The planet's road surfaces, linear, from the least used to the most, and
// whether they are a sealed planet's: wheel ruts, a graded way and a transit
// tube, in place of a dirt track, a minor road and a surfaced main road.
uniform vec3 uRoadTone[3];
uniform float uRoadSealed;
`;

/**
 * Runs before lighting, where `albedo` and `n` are the ground's colour and
 * normal. Leaves `gGlow` for {@link GROUND_LIT}, which lays the state over
 * the lit colour so it reads as a marking and not as ground.
 */
export const GROUND_BODY = /* glsl */ `
vec4 gGlow = vec4(0.0);
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
      float hw = mix(0.055, 0.085, surf) * (1.0 + 0.3 * uRoadSealed);
      // Close in, worn edges where the width wanders a little along the
      // road, and ruts and dust so the track is never one flat colour.
      float keepNear = tKeep(0.15, gFoot);
      float wob = 0.0;
      float grain = 0.0;
      if (keepNear > 0.0) {
        wob = (tNoise(gp * 7.0).x - 0.5) * keepNear;
        grain = (tNoise(gp * 23.0 + 5.0).x - 0.5) * keepNear;
      }
      // Only a dirt track's edge wanders. A laid road's is straight.
      bool gTube = uRoadSealed > 0.5 && surf > 0.75;
      bool gRuts = uRoadSealed > 0.5 && surf < 0.25;
      hw *= 1.0 + 0.45 * wob * (1.0 - surf);
      // Never thinner than a pixel and a half, and fainter when held there,
      // so a far road reads as a fine line and not a band.
      float hwMin = 0.75 * gFoot;
      float hwE = max(hw, hwMin);
      float soft = max(hw * 0.3, gFoot * 0.7);
      float cover = 1.0 - smoothstep(hwE - soft, hwE + soft, d);
      cover *= mix(1.0, 0.7, smoothstep(hw, hw * 2.5, hwMin)) * gFade;

      vec3 track = surf < 0.5 ? mix(uRoadTone[0], uRoadTone[1], surf * 2.0) : mix(uRoadTone[1], uRoadTone[2], surf * 2.0 - 1.0);
      track *= 1.0 + grain * 0.35 * (gTube ? 0.0 : 1.0);
      if (gRuts) {
        // Two wheel ruts pressed into the ground, which shows between them.
        float rut = 1.0 - smoothstep(0.18 * hw, 0.4 * hw, abs(d - 0.6 * hw));
        cover *= mix(0.7, 0.4 + 0.6 * rut, tKeep(hw, gFoot));
        track = mix(albedo * 0.45, track, 0.5);
      }
      // Worn ground beside the track, paler and drier than what grows there.
      // Nothing grows beside a sealed planet's, so it has none.
      float verge = (1.0 - smoothstep(hwE, hwE * 2.8 + gFoot, d)) * (1.0 - cover) * (1.0 - uRoadSealed);
      vec3 worn = mix(albedo, track * 0.85 + albedo * 0.15, 0.35);
      albedo = mix(albedo, worn, verge * 0.55 * tKeep(0.2, gFoot) * gFade);
      albedo = mix(albedo, track, cover * 0.95);
      // A line down the middle of a surfaced road.
      if (uRoadSealed < 0.5) {
        float lineW = hw * 0.1;
        albedo = mix(albedo, vec3(0.75, 0.72, 0.6), (1.0 - smoothstep(lineW, lineW + gFoot, d)) * smoothstep(0.75, 1.0, surf) * tKeep(hw * 0.6, gFoot) * 0.8);
      }

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
        if (gTube) {
          // A tube lies on the ground: round on top, with shade beside it
          // on the side away from the sun.
          n = normalize(n + vec3(grad.x, 0.0, grad.y) * (d / hwE) * cover * 0.9 * keepCut);
          float away = clamp(-dot(normalize(grad + 1e-5), normalize(uTerrainSun.xz)), 0.0, 1.0);
          albedo *= 1.0 - 0.4 * away * (1.0 - cover) * (1.0 - smoothstep(hwE, hwE * 2.4, d)) * keepCut;
        } else {
          float edge = smoothstep(hwE * 0.5, hwE, d) * (1.0 - smoothstep(hwE, hwE * 1.8, d));
          n = normalize(n - vec3(grad.x, 0.0, grad.y) * edge * 0.6 * keepCut);
        }
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
lit = mix(lit, gGlow.rgb, gGlow.a);
`;

/** Set the shader's uniforms for {@link GROUND_HEAD}. */
export function groundUniforms(
  ground: GroundShading,
): Record<string, { value: unknown }> {
  return {
    uRoadDistance: { value: ground.roadDistance },
    uRoadMask: { value: ground.roadMask },
    uRoadState: { value: ground.roadState },
    uRoadMaskSize: { value: new THREE.Vector2(...ground.roadMaskSize) },
    uRoadReach: { value: ground.roadReach },
    uGroundFrame: { value: ground.frame },
    uRoadTone: {
      value: [ground.roads.track, ground.roads.minor, ground.roads.main].map(
        (rgb) =>
          new THREE.Color().setRGB(
            rgb[0] / 255,
            rgb[1] / 255,
            rgb[2] / 255,
            THREE.SRGBColorSpace,
          ),
      ),
    },
    uRoadSealed: { value: ground.roads.look === "sealed" ? 1 : 0 },
  };
}
