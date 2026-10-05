import * as THREE from "three";
import { SHADE_AMBIENT, TERRAIN_SUN } from "./terrain";

/**
 * Surface detail for the terrain sheet, added to its unlit material in the
 * shader. The map picture stays the broad colour. On top of it:
 *
 * - Light per pixel from the heightmap's normals, so ridges finer than the
 *   mesh catch the sun. The sun and the ambient share are the ones the vertex
 *   shading used, so level ground is still exactly the picture's colour.
 * - On a generated map, procedural texture read off the picture's colour:
 *   forest canopy, grass, dry ground, rock and scree, snow, sand, and a sea
 *   with ripples, a sun glint and foam along the shore. Each layer of texture
 *   fades out once it is smaller than a few screen pixels, so it appears as
 *   the camera comes in and never shimmers from far away.
 *
 * Display only. Nothing here feeds play or the generator.
 */

/** What the shader is given beyond the picture. */
export interface TerrainShading {
  /** {@link terrainNormalPixels} as a texture, or null for a flat sheet. */
  normals: THREE.Texture | null;
  /** Procedural texture by biome. On for a generated map only. */
  detail: boolean;
  /**
   * For a map drawn with land past its edge: the sheet the map fills. Past it
   * the ground is greyed and darkened a little, so the map reads as the map
   * and the rest as beyond it, and then hazes into `far` until it is gone.
   * Left out, nothing past the sheet is drawn and nothing is changed.
   */
  frame?: TerrainFrame;
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
uniform vec3 uTerrainSun;
uniform float uTerrainAmbient;
uniform vec4 uTerrainFrame;
uniform float uTerrainHaze;
uniform vec3 uTerrainFar;
uniform float uTerrainGreyBeyond;
varying vec2 vTerrainUv;
varying vec3 vTerrainPos;

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

// How close a colour is to a reference, 1 when equal.
float tNear(vec3 c, vec3 ref, float width) {
  vec3 d = c - ref;
  return exp(-dot(d, d) / (width * width));
}
`;

// Biome colours from terrainGen.ts, in 0 to 1 sRGB.
const BIOMES = /* glsl */ `
const vec3 T_BEACH = vec3(214.0, 200.0, 150.0) / 255.0;
const vec3 T_DRY = vec3(182.0, 168.0, 116.0) / 255.0;
const vec3 T_GRASS = vec3(122.0, 154.0, 84.0) / 255.0;
const vec3 T_FOREST = vec3(58.0, 98.0, 56.0) / 255.0;
const vec3 T_TUNDRA = vec3(146.0, 146.0, 122.0) / 255.0;
const vec3 T_ROCK = vec3(122.0, 106.0, 90.0) / 255.0;
const vec3 T_SCREE = vec3(152.0, 146.0, 140.0) / 255.0;
const vec3 T_SNOW = vec3(240.0, 240.0, 240.0) / 255.0;
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
    // The picture in sRGB, to compare with the generator's colours.
    vec3 s = pow(max(albedo, vec3(0.0)), vec3(1.0 / 2.2));
    // Sea is height 0 and land at least 1 in 255, so this is the coastline.
    float coast = nh.a * 255.0;
    float sea = 1.0 - smoothstep(0.35, 0.65, coast);

    float wForest = tNear(s, T_FOREST, 0.12);
    float wGrass = tNear(s, T_GRASS, 0.14);
    float wDry = max(tNear(s, T_DRY, 0.12), tNear(s, T_BEACH, 0.1));
    float wTundra = tNear(s, T_TUNDRA, 0.1);
    float wRock = max(tNear(s, T_ROCK, 0.12), tNear(s, T_SCREE, 0.1));
    float wSnow = smoothstep(0.78, 0.9, min(s.r, min(s.g, s.b)));
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
    if (sea < 0.99 || coast > 0.01) {
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
      albedo = mix(albedo, pow(T_GRASS, vec3(2.2)), wForest * thin * 0.5);
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
      albedo = mix(albedo, pow(mix(T_ROCK, T_SCREE, 0.5 + broad.x), vec3(2.2)), steep * (1.0 - wSnow) * 0.85);
    }
    // Snow: smooth, with soft drifts, and none on the steepest faces.
    {
      shadeMul += wSnow * broad.x * 0.12;
      bump += wSnow * broad.yz * 0.3;
      albedo = mix(albedo, pow(T_ROCK, vec3(2.2)), wSnow * smoothstep(0.2, 0.32, 1.0 - n.y));
    }

    // Sea: ripples, a glint of the sun, and foam where it meets the land.
    vec3 wave = sea > 0.01 ? tField(p + 11.0, 0.6, 3, footprint) : vec3(0.0);
    float foam = smoothstep(0.03, 0.2, coast) * (1.0 - smoothstep(0.3, 0.5, coast));
    foam *= smoothstep(-0.15, 0.2, fine.x);
    // Coasts past the edge are drawn at half the map's resolution, and foam
    // traces their steps, so it thins out there.
    foam *= 1.0 - smoothstep(0.0, 0.03, terrainPast);
    vec2 landBump = bump;
    bump = mix(landBump, wave.yz * 0.05, sea);
    shadeMul = mix(shadeMul, 1.0 + wave.x * 0.1, sea);

    albedo *= max(shadeMul, 0.2);
    albedo = mix(albedo, vec3(0.85, 0.9, 0.92), foam * 0.75);
    n = normalize(n + vec3(-bump.x, 0.0, -bump.y));

    vec3 view = normalize(cameraPosition - vTerrainPos);
    vec3 h = normalize(view + uTerrainSun);
    spec = pow(max(dot(n, h), 0.0), 40.0) * 0.08 * sea * (1.0 - foam);
  }

  float facing = max(dot(n, uTerrainSun), 0.0);
  float shade = uTerrainAmbient + (1.0 - uTerrainAmbient) * (facing / uTerrainSun.y);
  vec3 lit = albedo * shade + spec;
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
  // them it would read every pixel as sea.
  const detail = shading.detail && shading.normals !== null;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrainNormals = {
      value: shading.normals ?? placeholder,
    };
    shader.uniforms.uTerrainRelief = { value: shading.normals ? 1 : 0 };
    shader.uniforms.uTerrainDetail = { value: detail ? 1 : 0 };
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
    shader.vertexShader = `${VERTEX_HEAD}${shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n${VERTEX_BODY}`,
    )}`;
    shader.fragmentShader = `${FRAGMENT_HEAD}${BIOMES}${shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>\n${FRAGMENT_BODY}`,
    )}`;
  };
  // One program for every terrain with the same switches.
  material.customProgramCacheKey = () =>
    `terrain:${shading.normals ? 1 : 0}:${detail ? 1 : 0}`;
}
