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
 *   shading used, so level ground is still exactly the picture's colour.
 * - On a generated map, procedural texture by biome, from the weights the
 *   generator wrote beside the picture: forest canopy, grass, dry ground, rock
 *   and scree, snow, sand, and a sea with ripples, a sun glint and foam along the shore. Each layer of texture
 *   fades out once it is smaller than a few screen pixels, so it appears as
 *   the camera comes in and never shimmers from far away.
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
uniform float uSeaLiquid;
uniform float uSeaLava;
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

// Several octaves of noise from wavelength w0 down, each a third of the last,
// centred on 0. Returns the value and its gradient in world units.
vec3 tField(vec2 p, float w0, int octaves, float footprint) {
  vec3 sum = vec3(0.0);
  float w = w0;
  float amp = 1.0;
  // Each octave turns a little, so the noise's square lattice never lines up
  // and shows as blocks.
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  mat2 r = turn;
  for (int k = 0; k < 5; k++) {
    if (k >= octaves) break;
    float keep = tKeep(w, footprint);
    if (keep <= 0.0) break;
    vec3 n = tNoise(r * p / w + float(k) * 17.0);
    sum += vec3(n.x - 0.5, (transpose(r) * n.yz) / w) * amp * keep;
    w /= 3.0;
    amp *= 0.5;
    r = turn * r;
  }
  return sum;
}
`;

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
  vec3 n = uTerrainRelief > 0.5 ? normalize(nh.xyz * 2.0 - 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 albedo = diffuseColor.rgb;
  float spec = 0.0;

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

    // Each slot adds to the pattern it draws with: 0 forest, 1 grass, 2 dry,
    // 3 tundra, 4 rock, 5 snow, and -1 for a slot the planet does not use.
    float wForest = 0.0;
    float wGrass = 0.0;
    float wDry = 0.0;
    float wTundra = 0.0;
    float wRock = 0.0;
    float wSnow = 0.0;
    for (int k = 0; k < 8; k++) {
      float pk = uBiomePattern[k];
      wForest += abs(pk) < 0.5 ? w[k] : 0.0;
      wGrass += abs(pk - 1.0) < 0.5 ? w[k] : 0.0;
      wDry += abs(pk - 2.0) < 0.5 ? w[k] : 0.0;
      wTundra += abs(pk - 3.0) < 0.5 ? w[k] : 0.0;
      wRock += abs(pk - 4.0) < 0.5 ? w[k] : 0.0;
      wSnow += abs(pk - 5.0) < 0.5 ? w[k] : 0.0;
    }
    // Shares of the land, which the sea has none of.
    float total = wForest + wGrass + wDry + wTundra + wRock + wSnow + 1e-3;
    float land = (1.0 - sea) / total;
    wForest *= land;
    wGrass *= land;
    wDry *= land;
    wTundra *= land;
    wRock *= land;
    wSnow *= land;

    // Steep ground shows bare rock, whatever grows on the level.
    float steep = smoothstep(0.08, 0.22, 1.0 - n.y) * (1.0 - sea);

    // Broad patches, then fine grain. Open sea needs neither. Each block
    // below runs only where its share is worth drawing: biomes lie in large
    // patches, so the GPU skips them together and the cost stays low.
    vec3 broad = vec3(0.0);
    vec3 fine = vec3(0.0);
    if (sea < 0.99 || coast > 0.01 || uSeaLiquid < 0.5) {
      broad = tField(p, 3.0, 2, footprint);
      fine = tField(p + 31.0, 0.45, 4, footprint);
    }

    float shadeMul = 1.0;
    vec2 bump = vec2(0.0);

    // Forest: a canopy of crowns with dark gaps between them.
    if (wForest > 0.02) {
      // Clumps of trees, and the crowns within them, each domed with dark
      // gaps between. The dome's slope is steepest at its rim and faces out
      // from its centre.
      shadeMul += wForest * (broad.x * 0.3 + fine.x * 0.15);
      // Where the broad noise is low the trees thin out into clearings.
      float thin = smoothstep(0.05, -0.25, broad.x);
      for (int k = 0; k < 2; k++) {
        float size = k == 0 ? 0.5 : 0.17;
        float keep = tKeep(size, footprint);
        if (keep <= 0.0) break;
        vec4 cell = tCell(p / size + float(k) * 7.3 + fine.x * 0.5);
        // Each crown a little bigger or smaller, lighter or darker.
        float reach = 0.45 + 0.25 * cell.w - thin * 0.25;
        float dome = 1.0 - smoothstep(0.05, reach, cell.x);
        float tone = (cell.w - 0.5) * 0.35;
        // Clumps light and shade both ways. Single crowns mostly darken their
        // gaps, since bright tops on that scale read as a scatter of dots.
        float lift = k == 0 ? (dome - 0.6) * 0.45 : (dome - 0.85) * 0.4;
        shadeMul += wForest * keep * (lift + tone * dome);
        bump += wForest * keep * cell.yz * (dome * (1.0 - dome)) / size * (k == 0 ? 0.12 : 0.05);
      }
      // Clearings show grass between the trees.
      albedo = mix(albedo, uBiomeClearing, wForest * thin * 0.5);
    }
    // Grass: lighter and darker patches with a fine grain.
    {
      shadeMul += wGrass * (broad.x * 0.45 + fine.x * 0.3);
      bump += wGrass * fine.yz * 0.25;
      albedo = mix(albedo, albedo * vec3(1.12, 1.05, 0.8), wGrass * smoothstep(0.0, 0.3, broad.x));
    }
    // Dry ground and sand: wind ripples bent by the broad noise, and grain.
    {
      vec2 dir = normalize(vec2(0.8, 0.6));
      float phase = dot(p, dir) / 0.22 + broad.x * 9.0;
      float ripple = sin(phase) * tKeep(0.22 * 6.2832, footprint);
      shadeMul += wDry * (ripple * 0.08 + fine.x * 0.25 + broad.x * 0.2);
      bump += wDry * (dir * cos(phase) / 0.22 * 0.04 * tKeep(1.38, footprint) + fine.yz * 0.2);
    }
    // Tundra: lichen mottling.
    {
      shadeMul += wTundra * (fine.x * 0.4 + broad.x * 0.25);
      bump += wTundra * fine.yz * 0.3;
    }
    // Rock and scree, and any steep slope: broken, strongly lit stone.
    float r = max(wRock, steep);
    if (r > 0.02) {
      vec3 stone = tField(p + 3.0, 0.5, 4, footprint);
      shadeMul += r * (stone.x * 0.6 + broad.x * 0.2);
      bump += r * stone.yz * 1.1;
      albedo = mix(albedo, mix(uBiomeSteep[0], uBiomeSteep[1], 0.5 + broad.x), steep * (1.0 - wSnow) * 0.85);
    }
    // Snow: smooth, with soft drifts, and none on the steepest faces.
    {
      shadeMul += wSnow * broad.x * 0.12;
      bump += wSnow * broad.yz * 0.3;
      albedo = mix(albedo, uBiomeSteep[0], wSnow * smoothstep(0.2, 0.32, 1.0 - n.y));
    }

    // Sea: ripples, a glint of the sun, and foam where it meets the land.
    vec3 wave = sea > 0.01 ? tField(p + 11.0, 0.6, 3, footprint) : vec3(0.0);
    float foam = smoothstep(0.03, 0.2, coast) * (1.0 - smoothstep(0.3, 0.5, coast));
    foam *= smoothstep(-0.15, 0.2, fine.x);
    // Only a liquid sea ripples, foams and glints.
    foam *= uSeaLiquid;
    // Coasts past the edge are drawn at half the map's resolution, and foam
    // traces their steps, so it thins out there.
    foam *= 1.0 - smoothstep(0.0, 0.03, terrainPast);
    vec2 landBump = bump;
    // A sea that is not liquid is ground of a kind, with the grain dry
    // ground has.
    float grain = 1.0 - uSeaLava;
    vec2 seaBump = mix(fine.yz * 0.2 * grain, wave.yz * 0.05, uSeaLiquid);
    float seaShade = mix((fine.x * 0.25 + broad.x * 0.2) * grain, wave.x * 0.1, uSeaLiquid);
    bump = mix(landBump, seaBump, sea);
    shadeMul = mix(shadeMul, 1.0 + seaShade, sea);
    // Lava: plates of dark crust drifting on the glow, with bright cracks
    // between them.
    if (uSeaLava > 0.5 && sea > 0.01) {
      vec4 plate = tCell(p / 0.9 + broad.x * 0.6);
      float crust = (1.0 - smoothstep(0.28, 0.5, plate.x)) * tKeep(0.9, footprint);
      crust *= 0.55 + 0.45 * plate.w;
      albedo = mix(albedo, albedo * vec3(0.16, 0.1, 0.09), crust * sea);
    }

    albedo *= max(shadeMul, 0.2);
    albedo = mix(albedo, vec3(0.85, 0.9, 0.92), foam * 0.75);
    n = normalize(n + vec3(-bump.x, 0.0, -bump.y));

    vec3 view = normalize(cameraPosition - vTerrainPos);
    vec3 h = normalize(view + uTerrainSun);
    spec = pow(max(dot(n, h), 0.0), 40.0) * 0.08 * sea * (1.0 - foam) * uSeaLiquid;
  }

  // Roads (groundShader.ts), when the sheet has them.
  GROUND_BODY_HERE

  float facing = max(dot(n, uTerrainSun), 0.0);
  float shade = uTerrainAmbient + (1.0 - uTerrainAmbient) * (facing / uTerrainSun.y);
  vec3 lit = albedo * shade + spec;
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

/** The index the shader gives each pattern, in the order of its weights. */
const PATTERN_INDEX: Record<BiomePattern, number> = {
  forest: 0,
  grass: 1,
  dry: 2,
  tundra: 3,
  rock: 4,
  snow: 5,
};

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
    shader.uniforms.uSeaLava = {
      value: planet?.sea.look === "lava" ? 1 : 0,
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
