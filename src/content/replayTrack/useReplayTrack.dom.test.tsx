// @vitest-environment happy-dom

/**
 * The hook that opens a track for the replay page (#3806), and the handle it
 * returns.
 *
 * The handle is the only thing a component holds. It is stable for as long as
 * the track is open, and it has accessor functions in place of the arrays, so a
 * window arriving never re-renders a consumer and a typed array never becomes a
 * prop. A profile of the finished view belongs to #3807. These tests hold what
 * a profile would look for to the shape of the API.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { memo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayTrackHeader } from "../bindings";
import fixture from "../fixtures/replay-track-window.json";
import { ReplayTrackError } from "./fault";
import type { ReplayTrackHandle } from "./handle";
import { decodeWindowPayload, type TrackWindow } from "./trackWindow";

const ID = "00112233445566778899aabbccddeeff";

function bytes(base64: string): ArrayBuffer {
  const b = Buffer.from(base64, "base64");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const header: ReplayTrackHeader = {
  gameId: ID,
  formatVersion: 1,
  recorderVersion: 2,
  framesPerSecond: 30,
  firstFrame: fixture.geometry.firstFrame,
  lastFrame: 150,
  lengthFrames: 150,
  windowLength: fixture.geometry.windowLength,
  windowCount: fixture.geometry.windowCount,
  tolerance: 0.5,
  positionShift: 3,
  velocityShift: 11,
  rotationBits: fixture.rotationBits,
  unitCount: 3,
  projectileCount: 3,
  featureCount: 1,
  engineVersion: "test",
  game: "Test Game 1",
  map: "Test Map",
  writer: "test",
  mapSize: [8192, 6144],
  unitDefs: ["armcom", "armpw"],
  weaponDefs: ["laser"],
  featureDefs: ["armmex_dead"],
  teams: [],
  features: { def: [0], team: [1], x: [10], z: [20], first: [0], last: [150] },
};

/** What the commands layer does, held in the test's hands. */
const reads = vi.fn<(gameId: string) => Promise<ReplayTrackHeader>>();
const loads: { index: number; resolve: (w: TrackWindow) => void }[] = [];
const loadWindow = vi.fn(
  (index: number) =>
    new Promise<TrackWindow>((resolve) => {
      loads.push({ index, resolve });
    }),
);
vi.mock("./commands", () => ({
  readTrackHeader: (gameId: string) => reads(gameId),
  windowLoader: () => (index: number) => loadWindow(index),
}));

const { useReplayTrack } = await import("./useReplayTrack");

function window_(k: number): TrackWindow {
  return decodeWindowPayload(
    bytes(fixture.windows[k].payload),
    fixture.rotationBits,
  );
}

async function arrive(...indexes: number[]) {
  await act(async () => {
    for (const i of indexes) {
      for (const l of loads.filter((l) => l.index === i)) {
        l.resolve(window_(i));
      }
    }
  });
}

/** Every value reachable from `value` that is a typed array or a buffer. */
function typedArraysIn(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return ["<value>"];
  }
  return Object.entries(value).flatMap(([key, inner]) =>
    typedArraysIn(inner, seen).map((path) => `${key}.${path}`),
  );
}

const props: unknown[] = [];
const Child = memo(function Child(p: { handle: ReplayTrackHandle }) {
  props.push(p);
  return null;
});

let renders = 0;
let latest: ReturnType<typeof useReplayTrack> | undefined;
function Consumer({ gameId }: { gameId: string | null }) {
  const track = useReplayTrack(gameId);
  renders++;
  latest = track;
  return track.handle ? <Child handle={track.handle} /> : null;
}

beforeEach(() => {
  reads.mockReset();
  loadWindow.mockClear();
  loads.length = 0;
  props.length = 0;
  renders = 0;
  latest = undefined;
});

afterEach(cleanup);

describe("useReplayTrack", () => {
  it("is idle with no game id and reads nothing", () => {
    render(<Consumer gameId={null} />);
    expect(latest?.status).toBe("idle");
    expect(reads).not.toHaveBeenCalled();
  });

  it("goes from loading to ready with the header", async () => {
    reads.mockResolvedValue(header);
    render(<Consumer gameId={ID} />);
    expect(latest?.status).toBe("loading");
    await waitFor(() => expect(latest?.status).toBe("ready"));
    expect(latest?.handle?.header).toEqual(header);
  });

  it("reports the kind of error when the track cannot be opened", async () => {
    reads.mockRejectedValue(new ReplayTrackError({ kind: "missing" }));
    render(<Consumer gameId={ID} />);
    await waitFor(() => expect(latest?.status).toBe("error"));
    expect(latest?.error?.kind).toBe("missing");
    expect(latest?.handle).toBeNull();
  });

  it("reads a track that fails for another reason as an io error", async () => {
    reads.mockRejectedValue(new Error("the bridge went away"));
    render(<Consumer gameId={ID} />);
    await waitFor(() => expect(latest?.status).toBe("error"));
    expect(latest?.error?.kind).toBe("io");
  });

  it("keeps one handle, and renders nothing more, as windows load and drop", async () => {
    reads.mockResolvedValue(header);
    render(<Consumer gameId={ID} />);
    await waitFor(() => expect(latest?.status).toBe("ready"));
    const handle = latest?.handle as ReplayTrackHandle;
    const rendersWhenReady = renders;
    const childRenders = props.length;

    act(() => handle.follow(10, 1));
    await arrive(0, 1);
    expect(handle.heldWindows()).toEqual([0, 1]);
    act(() => handle.follow(70, 1));
    await arrive(2);
    expect(handle.heldWindows()).toEqual([1, 2]);

    expect(latest?.handle).toBe(handle);
    expect(renders).toBe(rendersWhenReady);
    expect(props.length).toBe(childRenders);
  });

  it("holds no typed array in what it returns, and passes none as a prop", async () => {
    reads.mockResolvedValue(header);
    render(<Consumer gameId={ID} />);
    await waitFor(() => expect(latest?.status).toBe("ready"));
    const handle = latest?.handle as ReplayTrackHandle;
    act(() => handle.follow(10, 1));
    await arrive(0, 1);

    expect(typedArraysIn(latest)).toEqual([]);
    expect(typedArraysIn(handle)).toEqual([]);
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) expect(typedArraysIn(p)).toEqual([]);
  });

  it("gives the units alive at a frame through a callback, once their window is in", async () => {
    reads.mockResolvedValue(header);
    render(<Consumer gameId={ID} />);
    await waitFor(() => expect(latest?.status).toBe("ready"));
    const handle = latest?.handle as ReplayTrackHandle;

    act(() => handle.follow(75, 1));
    expect(handle.isReady(75)).toBe(false);
    expect(handle.forEachUnit(75, () => {})).toBe(false);
    await arrive(1, 2);
    expect(handle.isReady(75)).toBe(true);

    const seen: { serial: number; def: number; team: number }[] = [];
    expect(
      handle.forEachUnit(75, (u) =>
        seen.push({ serial: u.serial, def: u.def, team: u.team }),
      ),
    ).toBe(true);
    expect(seen.map((u) => u.serial).sort()).toEqual([0, 1]);
    expect(handle.unitCountAt(75)).toBe(2);
  });

  it("gives the same mark object to every visit, so a frame allocates none", async () => {
    reads.mockResolvedValue(header);
    render(<Consumer gameId={ID} />);
    await waitFor(() => expect(latest?.status).toBe("ready"));
    const handle = latest?.handle as ReplayTrackHandle;
    act(() => handle.follow(75, 1));
    await arrive(1, 2);
    const marks = new Set<object>();
    handle.forEachUnit(75, (u) => marks.add(u));
    expect(marks.size).toBe(1);
  });

  it("tells a subscriber when a window arrives, without rendering", async () => {
    reads.mockResolvedValue(header);
    render(<Consumer gameId={ID} />);
    await waitFor(() => expect(latest?.status).toBe("ready"));
    const handle = latest?.handle as ReplayTrackHandle;
    const heard = vi.fn();
    handle.subscribe(heard);
    const before = renders;
    act(() => handle.follow(10, 1));
    await arrive(0, 1);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(renders).toBe(before);
  });

  it("reports the fault of one window and goes on serving the others", async () => {
    reads.mockResolvedValue(header);
    render(<Consumer gameId={ID} />);
    await waitFor(() => expect(latest?.status).toBe("ready"));
    const handle = latest?.handle as ReplayTrackHandle;
    loadWindow.mockImplementation((index) =>
      index === 1
        ? Promise.reject(
            new ReplayTrackError({
              kind: "corruptWindow",
              window: 1,
              message: "checksum",
            }),
          )
        : new Promise<TrackWindow>((resolve) => {
            loads.push({ index, resolve });
          }),
    );
    act(() => handle.follow(10, 1));
    await arrive(0);
    expect(handle.windowFault(70)?.kind).toBe("corruptWindow");
    expect(handle.windowFault(10)).toBeUndefined();
    expect(handle.isReady(10)).toBe(true);
    expect(handle.forEachUnit(10, () => {})).toBe(true);
    expect(handle.forEachUnit(70, () => {})).toBe(false);
  });

  it("drops every window when the component unmounts", async () => {
    reads.mockResolvedValue(header);
    const { unmount } = render(<Consumer gameId={ID} />);
    await waitFor(() => expect(latest?.status).toBe("ready"));
    const handle = latest?.handle as ReplayTrackHandle;
    act(() => handle.follow(10, 1));
    await arrive(0, 1);
    unmount();
    expect(handle.heldWindows()).toEqual([]);
    expect(handle.isReady(10)).toBe(false);
  });

  it("opens the new track and drops the old one's windows when the game changes", async () => {
    reads.mockResolvedValue(header);
    const { rerender } = render(<Consumer gameId={ID} />);
    await waitFor(() => expect(latest?.status).toBe("ready"));
    const first = latest?.handle as ReplayTrackHandle;
    act(() => first.follow(10, 1));
    await arrive(0, 1);

    const other = "ffeeddccbbaa99887766554433221100";
    reads.mockResolvedValue({ ...header, gameId: other });
    rerender(<Consumer gameId={other} />);
    await waitFor(() => expect(latest?.handle?.header.gameId).toBe(other));
    expect(latest?.handle).not.toBe(first);
    expect(first.heldWindows()).toEqual([]);
  });

  it("ignores a header that arrives after the component has gone", async () => {
    let finish: (h: ReplayTrackHeader) => void = () => {};
    reads.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = render(<Consumer gameId={ID} />);
    unmount();
    const before = renders;
    await act(async () => finish(header));
    expect(renders).toBe(before);
  });
});
