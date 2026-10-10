import { beforeEach, describe, expect, it, vi } from "vitest";

const { contentListReplays } = vi.hoisted(() => ({
  contentListReplays: vi.fn(),
}));
vi.mock("./bindings", () => ({ contentListReplays }));

const { forgetReplay, heldReplays, loadReplays, resetReplays } = await import(
  "./replayList"
);

const replay = (path: string) => ({ filename: path, path });
const two = { replays: [replay("a"), replay("b")] };

beforeEach(() => {
  resetReplays();
  vi.clearAllMocks();
  contentListReplays.mockResolvedValue(two);
});

describe("the replay list cache", () => {
  it("makes one backend call for callers asking together", async () => {
    const [a, b] = await Promise.all([loadReplays("r"), loadReplays("r")]);
    expect(a).toBe(two.replays);
    expect(b).toBe(two.replays);
    expect(contentListReplays).toHaveBeenCalledTimes(1);
  });

  it("serves a later ask from the cache and exposes it as held", async () => {
    expect(heldReplays("r")).toBeUndefined();
    await loadReplays("r");
    await loadReplays("r");
    expect(contentListReplays).toHaveBeenCalledTimes(1);
    expect(heldReplays("r")).toBe(two.replays);
  });

  it("keeps roots apart", async () => {
    await loadReplays("r");
    await loadReplays("s");
    expect(contentListReplays).toHaveBeenCalledTimes(2);
    expect(contentListReplays).toHaveBeenCalledWith({ root: "s" });
  });

  it("reads again on refresh and holds the new answer", async () => {
    await loadReplays("r");
    const three = { replays: [replay("a"), replay("b"), replay("c")] };
    contentListReplays.mockResolvedValue(three);
    expect(await loadReplays("r", true)).toBe(three.replays);
    expect(heldReplays("r")).toBe(three.replays);
  });

  it("does not remember a rejection", async () => {
    contentListReplays.mockRejectedValueOnce(new Error("boom"));
    await expect(loadReplays("r")).rejects.toThrow("boom");
    expect(heldReplays("r")).toBeUndefined();
    expect(await loadReplays("r")).toBe(two.replays);
  });

  it("keeps the held list when a refresh fails", async () => {
    await loadReplays("r");
    contentListReplays.mockRejectedValueOnce(new Error("boom"));
    await expect(loadReplays("r", true)).rejects.toThrow("boom");
    expect(heldReplays("r")).toBe(two.replays);
  });

  it("drops a deleted replay at once and reads the root again", async () => {
    await loadReplays("r");
    contentListReplays.mockResolvedValue({ replays: [replay("b")] });
    forgetReplay("a");
    expect(heldReplays("r")?.map((r) => r.path)).toEqual(["b"]);
    expect(contentListReplays).toHaveBeenCalledTimes(2);
  });

  it("does not store a read that started before a delete", async () => {
    let finish: (v: typeof two) => void = () => {};
    contentListReplays.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const open = loadReplays("r");
    forgetReplay("a");
    finish(two);
    await open;
    expect(heldReplays("r")).toBeUndefined();
  });
});
