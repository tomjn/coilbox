import { describe, expect, it, vi } from "vitest";

// branding.ts transitively pulls in @picoframe/plugin-sdk, whose published dist
// uses extensionless relative imports Vitest's node resolver won't load from
// node_modules (see profile/links.test.ts). imageCacheKey invokes no command, so
// stubbing the leaf is enough to let the module load.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

const { imageCacheKey } = await import("./branding");

/**
 * The session cache dedupes image requests by this key, so two calls share an
 * in-flight/resolved `data:` URL iff they'd resolve identically. It backs both the
 * branding art and the generalised download-browser thumbnails (`useCachedImage`).
 */
describe("imageCacheKey", () => {
  it("is empty for no URLs so the caller renders nothing", () => {
    expect(imageCacheKey(undefined)).toBe("");
    expect(imageCacheKey([])).toBe("");
    expect(imageCacheKey([], true)).toBe("");
  });

  it("separates the re-encode variant from the raw variant", () => {
    expect(imageCacheKey(["https://a/x.png"], true)).not.toBe(
      imageCacheKey(["https://a/x.png"], false),
    );
    expect(imageCacheKey(["https://a/x.png"], true)).toMatch(/^j\n/);
    expect(imageCacheKey(["https://a/x.png"], false)).toMatch(/^r\n/);
  });

  it("defaults to the raw variant", () => {
    expect(imageCacheKey(["https://a/x.png"])).toBe(
      imageCacheKey(["https://a/x.png"], false),
    );
  });

  it("is stable for the same ordered URL list and differs when it changes", () => {
    expect(imageCacheKey(["https://a/x.png"])).toBe(
      imageCacheKey(["https://a/x.png"]),
    );
    expect(imageCacheKey(["https://a/x.png", "https://a/y.png"])).not.toBe(
      imageCacheKey(["https://a/y.png", "https://a/x.png"]),
    );
  });
});
