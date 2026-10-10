/**
 * Every positioned order of a replay, unpacked for the map's order density
 * layer (#1152).
 *
 * The command sends columns as base64 (see `DemoOrderPoints`), because ninety
 * thousand orders as JSON objects is too much to cross the bridge. This turns
 * them back into typed arrays.
 *
 * The arrays are not enumerable. A large typed array that reaches React as a
 * prop is walked key by key by the development build, which once cost this app
 * two seconds, so an {@link OrderPoints} can be passed around freely.
 */

import type { HeatPoints } from "@/lib/heatField";
import {
  contentDemoOrderPoints,
  type DemoOrderPoints,
  type OrderSource,
} from "./bindings";
import { createReplayRead } from "./replayRead";

/** The values of `DemoOrderPoints.source`. */
export const SOURCE_CODE: Record<OrderSource, number> = {
  selection: 0,
  lua: 1,
  ai: 2,
};

export interface OrderPoints {
  /** How many positioned orders there are. */
  count: number;
  /** Elmos from the map's north west corner. */
  x: Float32Array;
  z: Float32Array;
  /** Simulation frames, 30 to a second. */
  frame: Int32Array;
  /** The engine team, or -1. */
  team: Int16Array;
  player: Uint8Array;
  /** 0 move, 1 attack or fight, 2 build, 3 support, 4 other. */
  kind: Uint8Array;
  /** See {@link SOURCE_CODE}. */
  source: Uint8Array;
  unitAimed: number;
  noTarget: number;
  custom: number;
  malformed: number;
  lastFrame: number;
  incomplete: boolean;
}

function bytesOf(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * A column as a typed array of `count` entries. The bytes are little endian and
 * so is every machine this runs on. A column of the wrong length is an error,
 * because a column that does not line up with the others would put an order
 * somewhere it was not.
 */
function column<T extends ArrayLike<number>>(
  text: string,
  make: new (buffer: ArrayBuffer) => T,
  width: number,
  count: number,
  name: string,
): T {
  const bytes = bytesOf(text);
  if (bytes.length !== count * width)
    throw new Error(
      `order column ${name} holds ${bytes.length} bytes, expected ${count * width}`,
    );
  return new make(bytes.buffer as ArrayBuffer);
}

export function decodeOrderPoints(raw: DemoOrderPoints): OrderPoints {
  const n = raw.count;
  const out = {
    count: n,
    unitAimed: raw.unitAimed,
    noTarget: raw.noTarget,
    custom: raw.custom,
    malformed: raw.malformed,
    lastFrame: raw.lastFrame,
    incomplete: raw.incomplete,
  } as OrderPoints;
  const columns: [keyof OrderPoints, object][] = [
    ["x", column(raw.x, Float32Array, 4, n, "x")],
    ["z", column(raw.z, Float32Array, 4, n, "z")],
    ["frame", column(raw.frame, Int32Array, 4, n, "frame")],
    ["team", column(raw.team, Int16Array, 2, n, "team")],
    ["player", column(raw.player, Uint8Array, 1, n, "player")],
    ["kind", column(raw.kind, Uint8Array, 1, n, "kind")],
    ["source", column(raw.source, Uint8Array, 1, n, "source")],
  ];
  for (const [key, value] of columns)
    Object.defineProperty(out, key, { value, enumerable: false });
  return out;
}

/** Where the orders were aimed, as points for a density field. */
export function orderHeatPoints(points: OrderPoints): HeatPoints {
  const positions = new Float32Array(points.count * 2);
  for (let i = 0; i < points.count; i++) {
    positions[i * 2] = points.x[i];
    positions[i * 2 + 1] = points.z[i];
  }
  return { positions };
}

/** How many of the orders each sender gave. */
export function sourceCounts(points: OrderPoints): Record<OrderSource, number> {
  const counts = { selection: 0, lua: 0, ai: 0 };
  for (let i = 0; i < points.count; i++) {
    const s = points.source[i];
    if (s === SOURCE_CODE.selection) counts.selection++;
    else if (s === SOURCE_CODE.lua) counts.lua++;
    else counts.ai++;
  }
  return counts;
}

const read = createReplayRead(async (replayPath: string) =>
  decodeOrderPoints(await contentDemoOrderPoints({ replayPath })),
);

/**
 * One replay's order positions, read once for the page. Nothing reads until
 * `load` is called, which the map does when the order density layer is on.
 */
export const useReplayOrderPoints = read.useRead;

/** Forget what was read. For tests. */
export const resetReplayOrderPoints = read.reset;
