/**
 * The two commands as the frontend calls them (#3806): the header as data, and
 * a window as an answer plus bytes on a channel of the call's own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReplayTrackFault,
  ReplayTrackHeaderAnswer,
  ReplayTrackWindowAnswer,
} from "../bindings";
import fixture from "../fixtures/replay-track-window.json";

/** What a Tauri channel is to the code under test: a place to hang `onmessage`. */
class FakeChannel {
  onmessage: (message: ArrayBuffer) => void = () => {};
}

vi.mock("@tauri-apps/api/core", () => ({ Channel: FakeChannel }));

const headerCommand = vi.fn<(args: { gameId: string }) => Promise<unknown>>();
const windowCommand =
  vi.fn<
    (args: {
      gameId: string;
      window: number;
      onWindow: FakeChannel;
    }) => Promise<unknown>
  >();
vi.mock("../bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bindings")>()),
  contentReplayTrackHeader: (a: { gameId: string }) => headerCommand(a),
  contentReplayTrackWindow: (a: {
    gameId: string;
    window: number;
    onWindow: FakeChannel;
  }) => windowCommand(a),
}));

const { readTrackHeader, readTrackWindow, windowLoader } = await import(
  "./commands"
);
const { ReplayTrackError } = await import("./fault");

const ID = "00112233445566778899aabbccddeeff";

function payload(k: number): ArrayBuffer {
  const b = Buffer.from(fixture.windows[k].payload, "base64");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function ok(k: number, bytes = payload(k)): ReplayTrackWindowAnswer {
  return {
    ok: true,
    window: k,
    startFrame: 0,
    endFrame: 60,
    byteLength: bytes.byteLength,
  };
}

beforeEach(() => {
  headerCommand.mockReset();
  windowCommand.mockReset();
});

describe("readTrackHeader", () => {
  it("returns the header", async () => {
    const header = { gameId: ID, windowCount: 3 };
    headerCommand.mockResolvedValue({
      ok: true,
      header,
    } as unknown as ReplayTrackHeaderAnswer);
    await expect(readTrackHeader(ID)).resolves.toEqual(header);
    expect(headerCommand).toHaveBeenCalledWith({ gameId: ID });
  });

  const faults: ReplayTrackFault[] = [
    { kind: "missing" },
    { kind: "stale", recorderVersion: 1, current: 2 },
    { kind: "otherGame" },
    { kind: "unknownFormat", field: "version", found: "9", expected: "1" },
    { kind: "unreadable", message: "cut short" },
    { kind: "io", message: "denied" },
  ];
  for (const fault of faults) {
    it(`throws a ${fault.kind} error the page can tell apart`, async () => {
      headerCommand.mockResolvedValue({ ok: false, fault });
      const error = await readTrackHeader(ID).catch((e) => e);
      expect(error).toBeInstanceOf(ReplayTrackError);
      expect(error.kind).toBe(fault.kind);
      expect(error.fault).toEqual(fault);
    });
  }
});

describe("readTrackWindow", () => {
  it("gives the bytes when they arrive before the answer", async () => {
    windowCommand.mockImplementation(async ({ onWindow }) => {
      onWindow.onmessage(payload(1));
      return ok(1);
    });
    const bytes = await readTrackWindow(ID, 1);
    expect(bytes.byteLength).toBe(payload(1).byteLength);
  });

  it("gives the bytes when they arrive after the answer", async () => {
    let send: (() => void) | undefined;
    windowCommand.mockImplementation(async ({ onWindow }) => {
      send = () => onWindow.onmessage(payload(2));
      return ok(2);
    });
    const pending = readTrackWindow(ID, 2);
    await Promise.resolve();
    await Promise.resolve();
    send?.();
    expect((await pending).byteLength).toBe(payload(2).byteLength);
  });

  it("uses a channel of its own for every call", async () => {
    const seen: FakeChannel[] = [];
    windowCommand.mockImplementation(async ({ onWindow, window }) => {
      seen.push(onWindow);
      onWindow.onmessage(payload(window));
      return ok(window);
    });
    await readTrackWindow(ID, 0);
    await readTrackWindow(ID, 0);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("throws the fault, without waiting for bytes that will not come", async () => {
    const fault: ReplayTrackFault = {
      kind: "corruptWindow",
      window: 1,
      message: "checksum",
    };
    windowCommand.mockResolvedValue({ ok: false, fault });
    const error = await readTrackWindow(ID, 1).catch((e) => e);
    expect(error).toBeInstanceOf(ReplayTrackError);
    expect(error.kind).toBe("corruptWindow");
  });

  it("refuses bytes that are not the length the answer says", async () => {
    windowCommand.mockImplementation(async ({ onWindow }) => {
      onWindow.onmessage(payload(0));
      return { ...ok(0), byteLength: payload(0).byteLength + 4 };
    });
    const error = await readTrackWindow(ID, 0).catch((e) => e);
    expect(error).toBeInstanceOf(ReplayTrackError);
    expect(error.kind).toBe("unreadable");
  });
});

describe("windowLoader", () => {
  it("reads a window and cuts it into the arrays", async () => {
    windowCommand.mockImplementation(async ({ onWindow, window }) => {
      onWindow.onmessage(payload(window));
      return ok(window);
    });
    const load = windowLoader(ID, fixture.rotationBits);
    const w = await load(1);
    expect(w.index).toBe(1);
    expect(w.unitCount).toBeGreaterThan(0);
    expect(windowCommand.mock.calls[0][0]).toMatchObject({
      gameId: ID,
      window: 1,
    });
  });

  it("throws the fault of a window that cannot be read", async () => {
    windowCommand.mockResolvedValue({
      ok: false,
      fault: { kind: "corruptWindow", window: 2, message: "bad" },
    });
    const error = await windowLoader(ID, 12)(2).catch((e) => e);
    expect(error.kind).toBe("corruptWindow");
  });
});
