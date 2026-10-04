/**
 * Turns a painted province image into outlines, anchors and neighbours. Pure:
 * it takes decoded pixels and returns plain data, all in image pixels with the
 * origin at the top left. Scaling to map units is the reader's job.
 */

/** A decoded image: 4 bytes per pixel, red, green, blue, alpha, rows top down. */
export interface ProvincePixels {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface TraceInput {
  image: ProvincePixels;
  /** `#rrggbb` lower case, one per province. A result index is an index here. */
  colors: string[];
  /** `#rrggbb` of a colour that counts as unpainted, beside transparency. */
  background?: string;
}

export interface TracedProvince {
  /**
   * One closed ring per painted piece, largest first. Corners of pixels, so
   * whole numbers, clockwise on screen, starting at the ring's first point in
   * reading order, last point not repeated. A hole in a piece is not traced.
   */
  pieces: [number, number][][];
  /** The centre of the pixel deepest inside the largest piece. */
  anchor: [number, number];
  /** Pixels in the province after edges and specks are settled. */
  pixels: number;
}

/** A painted region whose colour no province lists. */
export interface UnlistedRegion {
  color: string;
  /** A pixel well inside the region. */
  x: number;
  y: number;
}

export interface TracedMap {
  width: number;
  height: number;
  /** One per input colour. Null when the colour is never painted. */
  provinces: (TracedProvince | null)[];
  /** Pairs of province indexes that share an edge, lower index first. */
  borders: [number, number][];
  unlisted: UnlistedRegion[];
}

/**
 * How far an unlisted colour may sit from a listed one and still be read as a
 * soft edge, in pixels.
 *
 * Anti-aliasing blends only the pixels an edge passes through, which is a seam
 * one pixel wide, and one round settles it. Resizing a painted image with
 * smoothing on widens the seam to about two pixels, so the second round covers
 * that. Each round works in from both sides, so a seam up to 4 pixels wide
 * disappears and a blob of unlisted colour 5 pixels across keeps its middle
 * pixel and is reported. This is reasoned from how the blending works and not
 * measured against particular image editors. `trace.test.ts` pins both sides
 * of the line.
 */
export const EDGE_SOFTNESS = 2;

/**
 * A separate piece of a province smaller than this many pixels is a speck: a
 * slip of the pencil or a leftover from a fill, not an island. It is given to
 * whatever surrounds it.
 *
 * The number comes from the outline, not from taste. Outlines are simplified
 * to within {@link SIMPLIFY_TOLERANCE} of the painted edge, so a piece has to
 * be 3 pixels across before its outline says anything about its shape, and 3
 * by 3 is 9. A province's largest piece is always kept, however small, so a
 * province that is one tiny island still reads.
 */
export const SPECK_PIXELS = 9;

/**
 * How far a simplified outline may stray from the painted edge, in pixels. A
 * straight edge painted at a slope is a staircase whose corners all lie within
 * one pixel of the line the author meant, so one pixel removes the stairs and
 * keeps every bend larger than a pixel.
 */
export const SIMPLIFY_TOLERANCE = 1;

/** Half coverage: an anti-aliased pixel belongs to the shape that fills most of it. */
const ALPHA_PAINTED = 128;

const UNPAINTED = -1;
const UNKNOWN = -2;

function rgbKey(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function hexOf(key: number): string {
  return `#${key.toString(16).padStart(6, "0")}`;
}

function colorDistance(a: number, b: number): number {
  const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
  const db = (a & 255) - (b & 255);
  return dr * dr + dg * dg + db * db;
}

/** Trace a province image. See the constants above for what it forgives. */
export function traceProvinces(input: TraceInput): TracedMap {
  const { data, width: w, height: h } = input.image;
  const n = w * h;
  const colorKeys = input.colors.map(rgbKey);
  const indexOf = new Map(colorKeys.map((key, i) => [key, i]));
  const bgKey = input.background ? rgbKey(input.background) : -1;

  const rgbAt = (i: number) =>
    (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];

  // 1. Give every pixel a province, unpainted, or unknown.
  const labels = new Int32Array(n);
  let unknown: number[] = [];
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < ALPHA_PAINTED) {
      labels[i] = UNPAINTED;
      continue;
    }
    const key = rgbAt(i);
    if (key === bgKey) {
      labels[i] = UNPAINTED;
      continue;
    }
    const index = indexOf.get(key);
    if (index === undefined) {
      labels[i] = UNKNOWN;
      unknown.push(i);
    } else {
      labels[i] = index;
    }
  }

  // 2. Soft edges. An unknown pixel beside a settled one takes the neighbour
  // nearest it in colour, since a blend sits closer to the side it mostly
  // covers. Without a background colour there is nothing to compare unpainted
  // against, so it only wins when no province is adjacent.
  for (let round = 0; round < EDGE_SOFTNESS && unknown.length > 0; round++) {
    const settled: [number, number][] = [];
    const left: number[] = [];
    for (const i of unknown) {
      const x = i % w;
      const key = rgbAt(i);
      let best = UNKNOWN;
      let bestDistance = Number.POSITIVE_INFINITY;
      const consider = (j: number) => {
        const l = labels[j];
        if (l === UNKNOWN) return;
        let distance: number;
        if (l >= 0) distance = colorDistance(key, colorKeys[l]);
        else if (bgKey >= 0) distance = colorDistance(key, bgKey);
        else distance = Number.MAX_VALUE;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = l;
        }
      };
      if (i >= w) consider(i - w);
      if (x > 0) consider(i - 1);
      if (x < w - 1) consider(i + 1);
      if (i < n - w) consider(i + w);
      if (best === UNKNOWN) left.push(i);
      else settled.push([i, best]);
    }
    for (const [i, l] of settled) labels[i] = l;
    unknown = left;
  }

  // 3. Whatever is still unknown is a real region of an unlisted colour.
  // Report each connected patch once, then treat it as unpainted so the rest
  // of the image still traces.
  const unlisted: UnlistedRegion[] = [];
  const stack: number[] = [];
  for (const start of unknown) {
    if (labels[start] !== UNKNOWN) continue;
    unlisted.push({
      color: hexOf(rgbAt(start)),
      x: start % w,
      y: Math.floor(start / w),
    });
    labels[start] = UNPAINTED;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % w;
      const visit = (j: number) => {
        if (labels[j] !== UNKNOWN) return;
        labels[j] = UNPAINTED;
        stack.push(j);
      };
      if (i >= w) visit(i - w);
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i < n - w) visit(i + w);
    }
  }

  // 4. Split each province into connected pieces and absorb the specks. An
  // absorbed speck can leave a new one behind, so repeat until none is left.
  // Every pass removes at least one piece, so it ends.
  const piece = new Int32Array(n);
  let pieces: { label: number; pixels: number; first: number }[] = [];
  for (;;) {
    pieces = labelPieces(labels, piece, w, h);
    const largest = new Map<number, number>();
    pieces.forEach((p, id) => {
      const best = largest.get(p.label);
      if (best === undefined || p.pixels > pieces[best].pixels) {
        largest.set(p.label, id);
      }
    });
    const specks = new Set<number>();
    pieces.forEach((p, id) => {
      if (p.pixels < SPECK_PIXELS && largest.get(p.label) !== id) {
        specks.add(id);
      }
    });
    if (specks.size === 0) break;
    absorbSpecks(labels, piece, w, h, specks);
  }

  // 5. Neighbours: two provinces that share a pixel edge.
  const count = input.colors.length;
  const borderKeys = new Set<number>();
  const touch = (a: number, b: number) => {
    if (a < 0 || b < 0 || a === b) return;
    borderKeys.add(a < b ? a * count + b : b * count + a);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < w - 1) touch(labels[i], labels[i + 1]);
      if (y < h - 1) touch(labels[i], labels[i + w]);
    }
  }
  const borders = [...borderKeys]
    .sort((a, b) => a - b)
    .map((key): [number, number] => [Math.floor(key / count), key % count]);

  // 6. Outlines and anchors.
  const depth = depthInside(labels, w, h);
  const byProvince: number[][] = input.colors.map(() => []);
  pieces.forEach((p, id) => {
    if (p.label >= 0) byProvince[p.label].push(id);
  });
  const anchors = pickAnchors(piece, depth, pieces.length, w, h);
  const provinces = byProvince.map((ids): TracedProvince | null => {
    if (ids.length === 0) return null;
    ids.sort((a, b) => pieces[b].pixels - pieces[a].pixels || a - b);
    return {
      pieces: ids.map((id) =>
        tracePiece(labels, piece, id, pieces[id].first, w, h),
      ),
      anchor: anchors[ids[0]],
      pixels: ids.reduce((sum, id) => sum + pieces[id].pixels, 0),
    };
  });

  return { width: w, height: h, provinces, borders, unlisted };
}

/**
 * Number the connected pieces of each province into `piece` (-1 where
 * unpainted). Pixels connect through their 4 edges, not their corners, so two
 * areas that only meet corner to corner are separate pieces and do not count
 * as touching.
 */
function labelPieces(
  labels: Int32Array,
  piece: Int32Array,
  w: number,
  h: number,
): { label: number; pixels: number; first: number }[] {
  const n = w * h;
  piece.fill(-1);
  const pieces: { label: number; pixels: number; first: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    const label = labels[start];
    if (label < 0 || piece[start] !== -1) continue;
    const id = pieces.length;
    let pixels = 0;
    piece[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      pixels++;
      const x = i % w;
      const visit = (j: number) => {
        if (labels[j] !== label || piece[j] !== -1) return;
        piece[j] = id;
        stack.push(j);
      };
      if (i >= w) visit(i - w);
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i < n - w) visit(i + w);
    }
    pieces.push({ label, pixels, first: start });
  }
  return pieces;
}

/** Give each speck to the label it shares the most edges with. */
function absorbSpecks(
  labels: Int32Array,
  piece: Int32Array,
  w: number,
  h: number,
  specks: Set<number>,
): void {
  const n = w * h;
  const votes = new Map<number, Map<number, number>>();
  for (let i = 0; i < n; i++) {
    const id = piece[i];
    if (!specks.has(id)) continue;
    const tally = votes.get(id) ?? new Map<number, number>();
    votes.set(id, tally);
    const x = i % w;
    const vote = (j: number) => {
      if (piece[j] === id) return;
      tally.set(labels[j], (tally.get(labels[j]) ?? 0) + 1);
    };
    if (i >= w) vote(i - w);
    if (x > 0) vote(i - 1);
    if (x < w - 1) vote(i + 1);
    if (i < n - w) vote(i + w);
  }
  const winner = new Map<number, number>();
  for (const [id, tally] of votes) {
    let best = UNPAINTED;
    let bestVotes = 0;
    for (const [label, v] of tally) {
      if (v > bestVotes || (v === bestVotes && label < best)) {
        best = label;
        bestVotes = v;
      }
    }
    winner.set(id, best);
  }
  for (let i = 0; i < n; i++) {
    const to = winner.get(piece[i]);
    if (to !== undefined) labels[i] = to;
  }
}

/**
 * For every province pixel, how many steps it is from the nearest pixel that
 * is not the same province, the image edge counting as outside. 1 on the rim.
 */
function depthInside(labels: Int32Array, w: number, h: number): Int32Array {
  const n = w * h;
  const depth = new Int32Array(n);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    const l = labels[i];
    if (l < 0) continue;
    const x = i % w;
    if (
      i < w ||
      i >= n - w ||
      x === 0 ||
      x === w - 1 ||
      labels[i - w] !== l ||
      labels[i + w] !== l ||
      labels[i - 1] !== l ||
      labels[i + 1] !== l
    ) {
      depth[i] = 1;
      frontier.push(i);
    }
  }
  for (let d = 2; frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      // A step that wraps round a row end lands on an image-edge pixel, which
      // is rim already, and a neighbour in another province is rim too. So the
      // only pixels still at 0 are deeper ones of the same province.
      for (const j of [i - w, i - 1, i + 1, i + w]) {
        if (j < 0 || j >= n || labels[j] < 0 || depth[j] !== 0) continue;
        depth[j] = d;
        next.push(j);
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * The anchor of each piece: the centre of its deepest pixel, which is inside
 * the painted area whatever its shape. A centroid is not, for a province bent
 * round a bay. Among equally deep pixels the one nearest the centroid wins, so
 * the marker sits in the middle of a long even strip and not at its end.
 */
function pickAnchors(
  piece: Int32Array,
  depth: Int32Array,
  pieceCount: number,
  w: number,
  h: number,
): [number, number][] {
  const sumX = new Float64Array(pieceCount);
  const sumY = new Float64Array(pieceCount);
  const pixels = new Int32Array(pieceCount);
  const deepest = new Int32Array(pieceCount);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const id = piece[i];
      if (id < 0) continue;
      sumX[id] += x;
      sumY[id] += y;
      pixels[id]++;
      if (depth[i] > deepest[id]) deepest[id] = depth[i];
    }
  }
  const best = new Float64Array(pieceCount).fill(Number.POSITIVE_INFINITY);
  const anchors: [number, number][] = Array.from({ length: pieceCount }, () => [
    0, 0,
  ]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const id = piece[i];
      if (id < 0 || depth[i] !== deepest[id]) continue;
      const dx = x - sumX[id] / pixels[id];
      const dy = y - sumY[id] / pixels[id];
      const distance = dx * dx + dy * dy;
      if (distance < best[id]) {
        best[id] = distance;
        anchors[id] = [x + 0.5, y + 0.5];
      }
    }
  }
  return anchors;
}

// Headings, clockwise on screen: east, south, west, north.
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const NORTH = 3;

/**
 * Walk the outer edge of one piece along pixel corners, keeping the piece on
 * the right, and return the simplified ring.
 *
 * `first` is the piece's first pixel in reading order, so its top left corner
 * is on the outer edge and the walk passes it heading north exactly once.
 */
function tracePiece(
  labels: Int32Array,
  piece: Int32Array,
  id: number,
  first: number,
  w: number,
  h: number,
): [number, number][] {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && piece[y * w + x] === id;
  const labelAt = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? labels[y * w + x] : UNPAINTED;
  // A corner where three or more areas meet. Both provinces along a shared
  // border see the same junctions, which is what lets them simplify that
  // border to the same line.
  const isJunction = (x: number, y: number) => {
    const a = labelAt(x - 1, y - 1);
    const b = labelAt(x, y - 1);
    const c = labelAt(x - 1, y);
    const d = labelAt(x, y);
    return new Set([a, b, c, d]).size >= 3;
  };

  const startX = first % w;
  const startY = Math.floor(first / w);
  const points: [number, number][] = [];
  const junction: boolean[] = [];
  let x = startX;
  let y = startY;
  let heading = NORTH;
  do {
    // The two pixels ahead of this corner, to the right and left of travel.
    const right = (heading + 1) % 4;
    const frontRightX = x + (DX[heading] + DX[right] - 1) / 2;
    const frontRightY = y + (DY[heading] + DY[right] - 1) / 2;
    const frontLeftX = x + (DX[heading] - DX[right] - 1) / 2;
    const frontLeftY = y + (DY[heading] - DY[right] - 1) / 2;
    let next = heading;
    // Checking the right first is what keeps two pixels that meet only at a
    // corner apart, matching how pieces are numbered.
    if (!inside(frontRightX, frontRightY)) next = right;
    else if (inside(frontLeftX, frontLeftY)) next = (heading + 3) % 4;
    const meets = isJunction(x, y);
    if (next !== heading || meets) {
      points.push([x, y]);
      junction.push(meets);
    }
    heading = next;
    x += DX[heading];
    y += DY[heading];
  } while (x !== startX || y !== startY || heading !== NORTH);

  const simplified = simplifyRing(points, junction);
  // A sliver can simplify to a line. Keep its painted corners in that case.
  const ring =
    simplified.length >= 3 && ringArea(simplified) !== 0 ? simplified : points;
  // Start every ring at its first point in reading order, so the same shape
  // always gives the same list.
  let top = 0;
  for (let i = 1; i < ring.length; i++) {
    const [px, py] = ring[i];
    const [fx, fy] = ring[top];
    if (py < fy || (py === fy && px < fx)) top = i;
  }
  return [...ring.slice(top), ...ring.slice(0, top)];
}

function ringArea(ring: [number, number][]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    twice += ax * by - bx * ay;
  }
  return twice / 2;
}

/**
 * Simplify a closed ring. Junctions are kept and each stretch between two of
 * them is simplified on its own, so the two provinces along a border, which
 * walk it in opposite directions, end up with the same points and no gap or
 * overlap between them.
 */
function simplifyRing(
  points: [number, number][],
  junction: boolean[],
): [number, number][] {
  const count = points.length;
  if (count <= 3) return points;
  let start = junction.indexOf(true);
  if (start === -1) {
    // A ring with no junctions, such as an island. Start from its first
    // corner in reading order so the result does not depend on the walk.
    start = 0;
    for (let i = 1; i < count; i++) {
      const [px, py] = points[i];
      const [sx, sy] = points[start];
      if (py < sy || (py === sy && px < sx)) start = i;
    }
  }
  const out: [number, number][] = [];
  let chain: [number, number][] = [points[start]];
  for (let step = 1; step <= count; step++) {
    const i = (start + step) % count;
    chain.push(points[i]);
    if (junction[i] || step === count) {
      const simple = simplifyChain(chain);
      // The last point of a chain is the first of the next.
      for (let k = 0; k < simple.length - 1; k++) out.push(simple[k]);
      chain = [points[i]];
    }
  }
  return out;
}

/** Simplify an open run of points, keeping both ends. */
function simplifyChain(chain: [number, number][]): [number, number][] {
  if (chain.length <= 2) return chain;
  const a = chain[0];
  const b = chain[chain.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) {
    // A loop back to where it started. Split it at the point furthest from
    // the start, and simplify each half.
    let far = 1;
    let farDistance = -1;
    for (let i = 1; i < chain.length - 1; i++) {
      const distance = (chain[i][0] - a[0]) ** 2 + (chain[i][1] - a[1]) ** 2;
      if (distance > farDistance) {
        farDistance = distance;
        far = i;
      }
    }
    const head = simplifyChain(chain.slice(0, far + 1));
    const tail = simplifyChain(chain.slice(far));
    return [...head, ...tail.slice(1)];
  }
  // Always work in the same direction, whichever way the walk came.
  const flip = a[1] > b[1] || (a[1] === b[1] && a[0] > b[0]);
  const run = flip ? [...chain].reverse() : chain;
  const keep = new Array<boolean>(run.length).fill(false);
  keep[0] = true;
  keep[run.length - 1] = true;
  const spans: [number, number][] = [[0, run.length - 1]];
  while (spans.length > 0) {
    const [from, to] = spans.pop() as [number, number];
    let far = -1;
    let farDistance = SIMPLIFY_TOLERANCE;
    for (let i = from + 1; i < to; i++) {
      const distance = distanceToSegment(run[i], run[from], run[to]);
      if (distance > farDistance) {
        farDistance = distance;
        far = i;
      }
    }
    if (far === -1) continue;
    keep[far] = true;
    spans.push([from, far], [far, to]);
  }
  const kept = run.filter((_, i) => keep[i]);
  return flip ? kept.reverse() : kept;
}

function distanceToSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const lengthSquared = abx * abx + aby * aby;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / lengthSquared,
          ),
        );
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

/** Whether a point is inside a ring, by the even-odd rule. */
export function pointInRing(
  x: number,
  y: number,
  ring: [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
