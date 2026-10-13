import type { ReplayTrackHeader } from "../bindings";
import fixture from "../fixtures/replay-track-window.json";
import { ReplayTrackError } from "../replayTrack/fault";
import {
  createReplayTrackHandle,
  type ReplayTrackHandle,
} from "../replayTrack/handle";
import {
  decodeWindowPayload,
  type TrackWindow,
} from "../replayTrack/trackWindow";
import type { PaintContext } from "./paint";

/**
 * For tests: a handle on the fixture track the Rust test
 * `the_typescript_fixture_is_what_the_reader_gives` writes. Its header is the
 * header command's own answer, and `alive` is how many units and projectiles
 * the Rust reader has at each frame.
 */
export const fixtureHeader = fixture.header as ReplayTrackHeader;
export const fixtureAlive: readonly {
  frame: number;
  units: number;
  projectiles: number;
}[] = fixture.alive;

function fixtureWindow(k: number): TrackWindow {
  const b = Buffer.from(fixture.windows[k].payload, "base64");
  return decodeWindowPayload(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    fixture.rotationBits,
  );
}

export interface TestTrack {
  handle: ReplayTrackHandle;
  /** The windows asked for and not yet answered. */
  waiting(): number[];
  /** Answer the load of window `k` with the fixture's. */
  arrive(k: number): Promise<void>;
  /** Fail the load of window `k`. */
  fail(k: number): Promise<void>;
  /** Hold every window a frame's follow asks for, then answer them. */
  seek(frame: number): Promise<void>;
}

export function testTrack(
  header: ReplayTrackHeader = fixtureHeader,
): TestTrack {
  const loads: {
    k: number;
    resolve: (w: TrackWindow) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const { handle } = createReplayTrackHandle(
    header,
    (k) =>
      new Promise<TrackWindow>((resolve, reject) => {
        loads.push({ k, resolve, reject });
      }),
  );
  const settle = async (
    k: number,
    how: (l: (typeof loads)[number]) => void,
  ) => {
    for (let i = loads.length - 1; i >= 0; i--) {
      if (loads[i].k !== k) continue;
      how(loads[i]);
      loads.splice(i, 1);
    }
    // The store hears of it a microtask later.
    await Promise.resolve();
    await Promise.resolve();
  };
  const track: TestTrack = {
    handle,
    waiting: () => loads.map((l) => l.k),
    arrive: (k) => settle(k, (l) => l.resolve(fixtureWindow(k))),
    fail: (k) =>
      settle(k, (l) =>
        l.reject(
          new ReplayTrackError({
            kind: "corruptWindow",
            window: k,
            message: "its checksum is wrong",
          }),
        ),
      ),
    async seek(frame) {
      handle.follow(frame, 1);
      for (const k of track.waiting()) await track.arrive(k);
    },
  };
  return track;
}

/** One call a painter made, with the state it was made in. */
export interface Call {
  op: string;
  args: number[];
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
}

/** A canvas context that records what is drawn on it and draws nothing. */
export function recordingContext(): PaintContext & {
  calls: Call[];
  count(op: string): number;
} {
  const calls: Call[] = [];
  const state = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    calls,
    count: (op: string) => calls.filter((c) => c.op === op).length,
  };
  const ctx = state as typeof state & Record<string, unknown>;
  for (const op of [
    "setTransform",
    "clearRect",
    "beginPath",
    "moveTo",
    "lineTo",
    "closePath",
    "rect",
    "arc",
    "fill",
    "stroke",
  ]) {
    ctx[op] = (...args: number[]) => {
      calls.push({
        op,
        args,
        fillStyle: state.fillStyle,
        strokeStyle: state.strokeStyle,
        globalAlpha: state.globalAlpha,
      });
    };
  }
  return ctx as unknown as PaintContext & {
    calls: Call[];
    count(op: string): number;
  };
}
