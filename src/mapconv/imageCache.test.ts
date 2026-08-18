import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const heights = vi.hoisted(() => vi.fn());
vi.mock("./bindings", () => ({
  mcImageInfo: invoke,
  mcHeightField: heights,
}));

const { getHeightWords, getImageInfo, invalidateImage } = await import(
  "./imageCache"
);

afterEach(() => {
  invalidateImage("/maps/height.png");
  invoke.mockReset();
  heights.mockReset();
  vi.unstubAllGlobals();
});

/** The worker's file as the asset protocol would serve it: little endian words. */
function served(words: number[]) {
  const bytes = Uint16Array.from(words).buffer;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ arrayBuffer: async () => bytes })),
  );
}

describe("getImageInfo", () => {
  it("points a cached thumbnail at the asset protocol", async () => {
    invoke.mockResolvedValue({
      width: 4096,
      height: 4096,
      thumbFile: "abc.png",
    });
    expect(await getImageInfo("/maps/height.png", 1024)).toEqual({
      width: 4096,
      height: 4096,
      thumb: "coilbox://localhost/mapconvthumb/abc.png",
    });
  });

  /// The command inlines the picture where it had nowhere to cache it, and a
  /// preview should draw it just the same.
  it("passes an inlined thumbnail through", async () => {
    invoke.mockResolvedValue({
      width: 16,
      height: 16,
      thumb: "data:image/png;base64,aGk=",
    });
    expect((await getImageInfo("/maps/height.png")).thumb).toBe(
      "data:image/png;base64,aGk=",
    );
  });

  it("asks once per path and size, and again after the file is rewritten", async () => {
    invoke.mockResolvedValue({ width: 1, height: 1, thumbFile: "abc.png" });
    await getImageInfo("/maps/height.png", 320);
    await getImageInfo("/maps/height.png", 320);
    expect(invoke).toHaveBeenCalledTimes(1);

    invalidateImage("/maps/height.png");
    await getImageInfo("/maps/height.png", 320);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("getHeightWords", () => {
  it("reads the worker's words in the order it wrote them", async () => {
    heights.mockResolvedValue({ width: 2, height: 2, file: "abc-hf.bin" });
    served([0, 1, 2, 65535]);
    const grid = await getHeightWords("/maps/height.png", 513);
    expect([grid.width, grid.height]).toEqual([2, 2]);
    expect(Array.from(grid.words)).toEqual([0, 1, 2, 65535]);
  });

  /// A file of the wrong length is some other heightmap, or a read that went
  /// wrong. Displacing terrain from it would draw a map that is not the one on
  /// the page.
  it("refuses a file that is not the grid it says it is", async () => {
    heights.mockResolvedValue({ width: 3, height: 3, file: "abc-hf.bin" });
    served([0, 1, 2, 3]);
    await expect(getHeightWords("/maps/height.png", 513)).rejects.toThrow();
  });

  it("asks once per path and size, and again after the file is rewritten", async () => {
    heights.mockResolvedValue({ width: 1, height: 1, file: "abc-hf.bin" });
    served([7]);
    await getHeightWords("/maps/height.png", 513);
    await getHeightWords("/maps/height.png", 513);
    expect(heights).toHaveBeenCalledTimes(1);

    invalidateImage("/maps/height.png");
    await getHeightWords("/maps/height.png", 513);
    expect(heights).toHaveBeenCalledTimes(2);
  });
});
