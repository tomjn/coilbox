import type { DemoOrderPoints } from "./bindings";

/** One positioned order, for building a packed fixture in a test. */
export interface FixtureOrder {
  x: number;
  z: number;
  frame?: number;
  team?: number;
  player?: number;
  kind?: number;
  source?: number;
}

const b64 = (view: ArrayBufferView) =>
  Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("base64");

/** Pack orders the way `content_demo_order_points` does, for tests. */
export function packOrders(
  list: FixtureOrder[],
  over: Partial<DemoOrderPoints> = {},
): DemoOrderPoints {
  return {
    count: list.length,
    x: b64(Float32Array.from(list.map((o) => o.x))),
    z: b64(Float32Array.from(list.map((o) => o.z))),
    frame: b64(Int32Array.from(list.map((o) => o.frame ?? 0))),
    team: b64(Int16Array.from(list.map((o) => o.team ?? 0))),
    player: b64(Uint8Array.from(list.map((o) => o.player ?? 0))),
    kind: b64(Uint8Array.from(list.map((o) => o.kind ?? 0))),
    source: b64(Uint8Array.from(list.map((o) => o.source ?? 0))),
    unitAimed: 0,
    noTarget: 0,
    custom: 0,
    malformed: 0,
    lastFrame: 9000,
    incomplete: false,
    ...over,
  };
}
