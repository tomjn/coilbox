/**
 * The ground of a town, drawn on its street sheet: asphalt where the grid's
 * streets run, a planted strip down the middle of an avenue and of each main
 * street, and paving with a joint at every lot's edge everywhere else. An
 * unbuilt lot is then a paved square beside a road, not a hole in one grey
 * sheet.
 *
 * The pattern is worked out for each pixel from where it lies in the town's
 * grid, the same sum `streetGap` in `layout.ts` does, so the roads drawn are
 * the gaps the buildings leave.
 */
import * as THREE from "three";
import type { Rgb } from "../landmarks/kit";
import type { TownPalette } from "../landmarks/palettes";
import { MAX_STREETS, type Town } from "../towns";
import type { TownGrid } from "./layout";

/** Half the width of the planted strip down an avenue or a main street. */
export const MEDIAN_HALF = 0.024;
/** Half the width of the line down the middle of a street: a twentieth of an open town's street across. */
const LINE_HALF = 0.0025;
/** The paint down the middle of a street, in sRGB. */
const PAINT: Rgb = [206, 200, 176];

const HEAD = /* glsl */ `
uniform vec2 uTownAt;
uniform vec2 uTownAxis;
// A lot's side, a street's width, an avenue's and a main street's.
uniform vec4 uTownGrid;
// A block's length each way, then how many blocks lie between avenues.
uniform vec3 uTownBlocks;
uniform float uTownStreets[${MAX_STREETS}];
uniform int uTownStreetCount;
uniform vec3 uTownAsphalt;
uniform vec3 uTownPaving;
uniform vec3 uTownMedian;
uniform vec3 uTownPaint;
varying vec3 vTownWorld;

// The street at t along one axis: its width, or 0 in a block, then how far
// t is from its middle, then how far t is into the block.
vec3 townGap(float t, float block) {
  float a = abs(t) - uTownGrid.z * 0.5;
  if (a < 0.0) return vec3(uTownGrid.z, abs(t), 0.0);
  float pitch = block + uTownGrid.y;
  float period = uTownBlocks.z * pitch + uTownGrid.z - uTownGrid.y;
  float r = mod(a, period);
  float j = min(floor(r / pitch), uTownBlocks.z - 1.0);
  float q = r - j * pitch;
  if (q < block) return vec3(0.0, 0.0, q);
  float w = j > uTownBlocks.z - 1.5 ? uTownGrid.z : uTownGrid.y;
  return vec3(w, abs(q - block - w * 0.5), 0.0);
}

// A road w wide, off from its middle and along it, px world units a pixel.
vec3 townRoad(float w, float off, float along, float px) {
  vec3 c = uTownAsphalt;
  if (w > uTownGrid.y * 1.5) {
    // Wide enough for two carriageways and a planted strip between them.
    c = mix(c, uTownMedian, 1.0 - smoothstep(${MEDIAN_HALF}, ${MEDIAN_HALF} + px, off));
  } else {
    float dash = step(0.5, fract(along / 0.09));
    // A line thinner than a pixel is drawn a pixel wide and that much
    // fainter, so it never looks wider than it is.
    float line = 1.0 - smoothstep(max(${LINE_HALF} - px * 0.5, 0.0), ${LINE_HALF} + px * 0.5, off);
    c = mix(c, uTownPaint, line * dash * 0.7 * min(1.0, ${LINE_HALF} * 2.0 / px));
  }
  return c;
}

vec3 townGround() {
  vec2 d = vTownWorld.xz - uTownAt;
  vec2 uv = vec2(d.x * uTownAxis.x + d.y * uTownAxis.y, -d.x * uTownAxis.y + d.y * uTownAxis.x);
  float px = max(length(dFdx(d)), length(dFdy(d)));
  vec3 gu = townGap(uv.x, uTownBlocks.x);
  vec3 gv = townGap(uv.y, uTownBlocks.y);
  // Paving, with a joint where one lot meets the next.
  vec2 edge = abs(fract(vec2(gu.z, gv.z) / uTownGrid.x + 0.5) - 0.5) * uTownGrid.x;
  float joint = 1.0 - smoothstep(0.005, 0.005 + px, min(edge.x, edge.y));
  vec3 col = uTownPaving * (1.0 - 0.2 * joint * (1.0 - smoothstep(0.01, 0.03, px)));
  if (gu.x > 0.0 && gv.x > 0.0) col = uTownAsphalt;
  else if (gu.x > 0.0) col = townRoad(gu.x, gu.y, uv.y, px);
  else if (gv.x > 0.0) col = townRoad(gv.x, gv.y, uv.x, px);
  // The main streets run from the centre to the edge, over the grid.
  for (int k = 0; k < ${MAX_STREETS}; k++) {
    if (k >= uTownStreetCount) break;
    vec2 dir = vec2(cos(uTownStreets[k]), sin(uTownStreets[k]));
    float along = dot(d, dir);
    float across = abs(d.x * dir.y - d.y * dir.x);
    float core = (1.0 - smoothstep(uTownGrid.w * 0.5 - px, uTownGrid.w * 0.5, across)) * step(0.0, along);
    col = mix(col, townRoad(uTownGrid.w, across, along, px), core);
  }
  return col;
}
`;

const linear = (c: Rgb) =>
  new THREE.Color().setRGB(
    c[0] / 255,
    c[1] / 255,
    c[2] / 255,
    THREE.SRGBColorSpace,
  );

/**
 * Draw `town`'s ground on `material`, the unlit material of its street sheet.
 * The sheet's vertex colours still give its fade at the town's edge, and the
 * material's own colour still dims it. `planted` puts grass down the middle
 * of the wide streets. A sealed outpost has paving there.
 */
export function applyStreetGround(
  material: THREE.MeshBasicMaterial,
  town: Town,
  grid: TownGrid,
  palette: TownPalette,
  planted: boolean,
): void {
  const streets = Array.from(
    { length: MAX_STREETS },
    (_, k) => town.streets[k] ?? 0,
  );
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTownAt: { value: new THREE.Vector2(town.x, town.z) },
      uTownAxis: {
        value: new THREE.Vector2(Math.cos(town.axis), Math.sin(town.axis)),
      },
      uTownGrid: {
        value: new THREE.Vector4(
          grid.lot,
          grid.street,
          grid.avenue,
          grid.boulevard,
        ),
      },
      uTownBlocks: {
        value: new THREE.Vector3(
          grid.blockLots[0] * grid.lot,
          grid.blockLots[1] * grid.lot,
          grid.avenueEvery,
        ),
      },
      uTownStreets: { value: streets },
      uTownStreetCount: {
        value: Math.min(MAX_STREETS, town.streets.length),
      },
      uTownAsphalt: { value: linear(palette.street) },
      uTownPaving: { value: linear(palette.pavement) },
      uTownMedian: {
        value: linear(planted ? palette.grass : palette.pavement),
      },
      uTownPaint: { value: linear(PAINT) },
    });
    shader.vertexShader = `varying vec3 vTownWorld;\n${shader.vertexShader.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\nvTownWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    )}`;
    // The vertex colour keeps its alpha, the fade, and gives up its colour.
    shader.fragmentShader = `${HEAD}${shader.fragmentShader.replace(
      "#include <color_fragment>",
      "#include <color_fragment>\ndiffuseColor.rgb = townGround() * diffuse;",
    )}`;
  };
  // One program for every town.
  material.customProgramCacheKey = () => "town-street-ground";
}
