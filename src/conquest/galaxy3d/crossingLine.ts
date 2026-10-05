import * as THREE from "three";
import type { WorldPos } from "./layout";

/**
 * The line a sea crossing draws as: a dotted shipping lane laid on the water,
 * drawn in screen space so it keeps a minimum width at any zoom. Its state is
 * drawn over the lane the way a painted road's is over its track (see
 * `groundShader.ts`), so a route reads the same on land and sea, and no state
 * is told by colour alone.
 *
 * - `dots`: a plain crossing, the lane alone
 * - `edges`: owned by one side, thin edge lines in its colour
 * - `glow`: can be attacked along, a glow round the lane
 * - `chevrons`: an open Warpath step, the glow with the lane drawn as
 *   arrowheads pointing the way the step goes
 * - `filled`: a Warpath step already taken, the lane filled in, with edges
 *
 * Where no road is painted from a location to its landing point, that stretch
 * draws here as a fine solid line.
 */
export const CROSSING_PATTERN = {
  dots: 0,
  edges: 1,
  glow: 2,
  chevrons: 3,
  filled: 4,
} as const;

export type CrossingPattern = keyof typeof CROSSING_PATTERN;

/** The vertices of one strip of crossing line. */
export interface CrossingStrip {
  /** Centre line points, each twice, once for either side. */
  positions: number[];
  /** Unit direction of travel at each vertex, in world units. */
  tangents: number[];
  /** -1 on the left edge and 1 on the right. */
  sides: number[];
  /** World distance from the start of the crossing, across the ground. */
  alongs: number[];
  /** 1 over the water, 0 for the track over land. */
  seas: number[];
}

/**
 * Add a line of world points to `strip` as a strip of quads, two vertices
 * per point. `along` is the distance already covered before the first point,
 * and the distance at the last point is returned, so the next stretch of the
 * same crossing carries the pattern on. Each point's direction is the average
 * of the two stretches it joins, so the strip bends without gaps.
 */
export function addCrossingStrip(
  strip: CrossingStrip,
  points: readonly WorldPos[],
  along: number,
  sea: boolean,
): number {
  const n = points.length;
  if (n < 2) return along;
  let distance = along;
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    let tz = next[2] - prev[2];
    const len = Math.hypot(tx, ty, tz) || 1;
    tx /= len;
    ty /= len;
    tz /= len;
    if (i > 0) {
      const p = points[i - 1];
      distance += Math.hypot(points[i][0] - p[0], points[i][2] - p[2]);
    }
    for (const side of [-1, 1]) {
      strip.positions.push(points[i][0], points[i][1], points[i][2]);
      strip.tangents.push(tx, ty, tz);
      strip.sides.push(side);
      strip.alongs.push(distance);
      strip.seas.push(sea ? 1 : 0);
    }
  }
  return distance;
}

/** Triangle indices for a strip of `pointCount` points starting at `first`. */
export function stripIndices(first: number, pointCount: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pointCount - 1; i++) {
    const v = first + i * 2;
    out.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
  }
  return out;
}

const vertexShader = /* glsl */ `
uniform vec2 uResolution;
uniform float uWidth;
uniform float uMinPx;
attribute vec3 aTangent;
attribute float aSide;
attribute float aAlong;
attribute float aSea;
attribute vec4 aColor;
attribute vec2 aStyle;
varying vec4 vColor;
varying vec2 vLine;
varying float vSea;
varying float vPattern;

void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 ahead = projectionMatrix * modelViewMatrix * vec4(position + aTangent, 1.0);
  vec2 halfSize = uResolution * 0.5;
  vec2 dir = (ahead.xy / ahead.w - clip.xy / clip.w) * halfSize;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  // Drawing-buffer pixels per world unit at this depth.
  float pxPerWorld = projectionMatrix[1][1] * halfSize.y / clip.w;
  float widthPx = max(uWidth * pxPerWorld, uMinPx) * aStyle.y;
  clip.xy += normal * aSide * 0.5 * widthPx / halfSize * clip.w;
  gl_Position = clip;
  vColor = aColor;
  // Along and across the line in line widths, so the pattern keeps its shape
  // when the minimum width takes over at a distance.
  vLine = vec2(aAlong * pxPerWorld / widthPx, aSide * 0.5);
  vSea = aSea;
  vPattern = aStyle.x;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uLane;
varying vec4 vColor;
varying vec2 vLine;
varying float vSea;
varying float vPattern;

// Coverage of a shape from its signed distance, softened over one pixel.
float cover(float d, float aa) {
  return 1.0 - smoothstep(-aa, aa, d);
}

void main() {
  // Along and across in line widths. The strip is one width across, so
  // |y| runs from 0 on the centre line to 0.5 at the strip's edge.
  float x = vLine.x;
  float y = abs(vLine.y);
  float aa = max(length(vec2(fwidth(x), fwidth(vLine.y))) * 0.7, 1e-4);
  float lane;
  float over = 0.0;
  if (vSea < 0.5) {
    // A stretch over land with no painted road: a fine line in the state's
    // colour, or the lane's when it has none.
    lane = cover(y - 0.05, aa);
    over = vPattern > 0.5 ? lane : 0.0;
  } else {
    if (vPattern > 2.5 && vPattern < 3.5) {
      // Arrowheads pointing along the line.
      float lx = mod(x, 1.1) - 0.55;
      lane = cover(max(abs(lx + y * 1.3 - 0.18) * 0.61 - 0.06, y - 0.22), aa);
    } else {
      lane = cover(length(vec2(mod(x, 0.9) - 0.45, y)) - 0.13, aa);
    }
    if (vPattern > 0.5) {
      // Every state has the edge lines a painted road's state has.
      over = cover(abs(y - 0.41) - 0.035, aa);
      if (vPattern > 1.5 && vPattern < 3.5) {
        // Round the lane and not over it, so the lane still shows.
        float halo = (1.0 - smoothstep(0.18, 0.5, y)) * smoothstep(0.1, 0.18, y);
        over = max(over, halo * 0.5);
      } else if (vPattern > 3.5) {
        over = max(over, cover(y - 0.19, aa) * 0.9);
      }
    }
  }
  // The state laid over the lane.
  float alpha = over + lane * (1.0 - over);
  if (alpha * vColor.a < 0.004) discard;
  vec3 color = (vColor.rgb * over + uLane * lane * (1.0 - over)) / alpha;
  gl_FragColor = vec4(color, alpha * vColor.a);
  #include <colorspace_fragment>
}
`;

/**
 * The material every crossing shares. `width` is the strip's width in world
 * units, the lane and the state drawn round it, and `lane` the lane's colour.
 * The mesh that uses it must call {@link updateCrossingMaterial} before each
 * draw, which `onBeforeRender` does.
 */
export function crossingMaterial(
  width: number,
  lane: THREE.Color,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uWidth: { value: width },
      uMinPx: { value: 1 },
      uLane: { value: lane },
    },
    transparent: true,
    depthWrite: false,
    // A strip faces whichever way its direction of travel turns it on screen.
    side: THREE.DoubleSide,
    // Over the province borders, which sit at factor -2, and still hidden by
    // a hill that stands in front, as the other cue lines are.
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -6,
  });
}

const bufferSize = new THREE.Vector2();

/**
 * Tell the material the drawing buffer's size and pixel ratio. `minPixels` is
 * the least width the strip draws at, in CSS pixels.
 */
export function updateCrossingMaterial(
  material: THREE.ShaderMaterial,
  renderer: THREE.WebGLRenderer,
  minPixels: number,
): void {
  renderer.getDrawingBufferSize(bufferSize);
  material.uniforms.uResolution.value.copy(bufferSize);
  material.uniforms.uMinPx.value = minPixels * renderer.getPixelRatio();
}
