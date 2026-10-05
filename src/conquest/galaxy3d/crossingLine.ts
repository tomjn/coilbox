import * as THREE from "three";
import type { WorldPos } from "./layout";

/**
 * The line a sea crossing draws as: a fine chart line laid on the water,
 * drawn in screen space so it keeps a minimum width at any zoom. Its pattern
 * says what state the crossing is in, so no state is told by colour alone.
 *
 * - `dots`: a plain crossing, a dotted shipping lane
 * - `beads`: owned by one side, dots strung on a fine line
 * - `dashes`: contested, the galaxy's dashed lane
 * - `chevrons`: a Warpath choice, arrowheads pointing the way the step goes
 * - `ticks`: a Warpath step already taken, a line crossed by tick marks
 *
 * Over land, from a location to its landing point, every state draws as a
 * fine solid line, a short track down to the shore.
 */
export const CROSSING_PATTERN = {
  dots: 0,
  beads: 1,
  dashes: 2,
  chevrons: 3,
  ticks: 4,
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
varying vec4 vColor;
varying vec2 vLine;
varying float vSea;
varying float vPattern;

float dots(float x, float y, float period, float radius) {
  return length(vec2(mod(x, period) - period * 0.5, y)) - radius;
}

void main() {
  float x = vLine.x;
  float y = vLine.y;
  float d;
  if (vSea < 0.5) {
    d = abs(y) - 0.16;
  } else if (vPattern < 0.5) {
    d = dots(x, y, 2.6, 0.4);
  } else if (vPattern < 1.5) {
    d = min(abs(y) - 0.12, dots(x, y, 3.0, 0.42));
  } else if (vPattern < 2.5) {
    vec2 q = vec2(abs(mod(x, 3.4) - 1.7) - 1.0, abs(y) - 0.32);
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.1;
  } else if (vPattern < 3.5) {
    float lx = mod(x, 2.2) - 1.1;
    d = max(abs(lx + abs(y) * 1.3 - 0.35) * 0.61 - 0.17, abs(y) - 0.46);
  } else {
    float tick = max(abs(mod(x, 1.8) - 0.9) - 0.13, abs(y) - 0.46);
    d = min(abs(y) - 0.15, tick);
  }
  float aa = max(length(vec2(fwidth(x), fwidth(y))) * 0.7, 1e-4);
  float alpha = vColor.a * (1.0 - smoothstep(-aa, aa, d));
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, alpha);
}
`;

/**
 * The material every crossing shares. `width` is the line's width in world
 * units and `minPixels` the least it draws at, in CSS pixels. The mesh that
 * uses it must call {@link updateCrossingMaterial} before each draw, which
 * `onBeforeRender` does.
 */
export function crossingMaterial(width: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uWidth: { value: width },
      uMinPx: { value: 1 },
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

/** Tell the material the drawing buffer's size and pixel ratio. */
export function updateCrossingMaterial(
  material: THREE.ShaderMaterial,
  renderer: THREE.WebGLRenderer,
  minPixels: number,
): void {
  renderer.getDrawingBufferSize(bufferSize);
  material.uniforms.uResolution.value.copy(bufferSize);
  material.uniforms.uMinPx.value = minPixels * renderer.getPixelRatio();
}
