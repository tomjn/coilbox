import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LuaReplResult } from "../../bindings";
import {
  evalChunk,
  readSession,
  resetSession,
  sessionKey,
} from "./luaReplSession";

// The store calls the real binding (which invokes Tauri); stub it so we can
// drive the success/error branches directly.
const exec = vi.fn<(args: unknown) => Promise<LuaReplResult>>();
vi.mock("../../bindings", () => ({
  unitsyncLuaReplExec: (args: unknown) => exec(args),
}));

const target = { enginePath: "/eng", dataDir: "/data", archive: "Map v1" };
const key = sessionKey(target.dataDir, target.enginePath, target.archive);

beforeEach(() => {
  exec.mockReset();
  resetSession(key);
});

describe("evalChunk", () => {
  it("replays accumulated chunks and appends a successful input", async () => {
    exec.mockResolvedValueOnce({ result: "1", errors: [] });
    await evalChunk(target, "x = 1");
    exec.mockResolvedValueOnce({ result: "2", errors: [] });
    await evalChunk(target, "return x + 1");

    // The second call replays chunk 1 plus the new input.
    expect(exec).toHaveBeenLastCalledWith({
      ...target,
      chunks: ["x = 1", "return x + 1"],
    });
    const s = readSession(key);
    expect(s.chunks).toEqual(["x = 1", "return x + 1"]);
    expect(s.cells).toHaveLength(2);
    expect(s.cells[1].result).toBe("2");
  });

  it("does not accumulate a chunk that errored", async () => {
    exec.mockResolvedValueOnce({ error: "boom", errors: [] });
    await evalChunk(target, "error('boom')");

    const s = readSession(key);
    expect(s.chunks).toEqual([]); // failed input never joins the replay
    expect(s.cells).toHaveLength(1); // but it is shown in the transcript
    expect(s.cells[0].error).toBe("boom");
  });

  it("surfaces a thrown invoke as a cell error without accumulating", async () => {
    exec.mockRejectedValueOnce(new Error("worker missing"));
    await evalChunk(target, "return 1");

    const s = readSession(key);
    expect(s.chunks).toEqual([]);
    expect(s.cells[0].error).toBe("worker missing");
  });

  it("carries prints and divergedAt into the cell", async () => {
    exec.mockResolvedValueOnce({
      error: "session replay diverged at chunk 1: stale",
      divergedAt: 1,
      prints: "hi",
      errors: [],
    });
    await evalChunk(target, "return 1");

    const cell = readSession(key).cells[0];
    expect(cell.divergedAt).toBe(1);
    expect(cell.prints).toBe("hi");
  });
});

describe("resetSession", () => {
  it("clears chunks and transcript", async () => {
    exec.mockResolvedValueOnce({ result: "1", errors: [] });
    await evalChunk(target, "x = 1");
    expect(readSession(key).chunks).toHaveLength(1);

    resetSession(key);
    const s = readSession(key);
    expect(s.chunks).toEqual([]);
    expect(s.cells).toEqual([]);
  });
});
