import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("./bindings", () => ({ mcImageInfo: invoke }));

const { getImageInfo, invalidateImage } = await import("./imageCache");

afterEach(() => {
  invalidateImage("/maps/height.png");
  invoke.mockReset();
});

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
