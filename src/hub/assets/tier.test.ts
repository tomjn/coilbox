import { describe, expect, it } from "vitest";
import {
  assetTierUrl,
  BLOB_TIER_BASE,
  DEFAULT_ASSET_CDN_BASE,
  resolveAssetCdnBase,
} from "./tier";

describe("resolveAssetCdnBase", () => {
  it("falls back to the durable tier the hub publishes to", () => {
    expect(resolveAssetCdnBase(undefined)).toBe(DEFAULT_ASSET_CDN_BASE);
  });

  it("treats a blank profile value as unset", () => {
    expect(resolveAssetCdnBase("   ")).toBe(DEFAULT_ASSET_CDN_BASE);
  });

  it("takes a distributor's own base", () => {
    expect(resolveAssetCdnBase("https://assets.example.test/pics")).toBe(
      "https://assets.example.test/pics/",
    );
  });

  it("ends in exactly one slash however many it was given", () => {
    expect(resolveAssetCdnBase("https://assets.example.test///")).toBe(
      "https://assets.example.test/",
    );
  });
});

describe("assetTierUrl", () => {
  const base = DEFAULT_ASSET_CDN_BASE;

  it("serves the durable tier from the configured base", () => {
    expect(assetTierUrl("static", "maps/minimap/abc.webp", base)).toBe(
      "https://tomjn.github.io/coilbox-assets/maps/minimap/abc.webp",
    );
  });

  it("serves staging from the store, which is not configurable", () => {
    expect(assetTierUrl("blob", "maps/minimap/abc-x1.webp", base)).toBe(
      `${BLOB_TIER_BASE}maps/minimap/abc-x1.webp`,
    );
  });

  it("keeps the repository subpath when the stored path has a leading slash", () => {
    // `new URL(path, base)` would resolve this against the origin and eat the
    // /coilbox-assets segment, which is why the join is a concatenation.
    expect(assetTierUrl("static", "/maps/minimap/abc.webp", base)).toBe(
      "https://tomjn.github.io/coilbox-assets/maps/minimap/abc.webp",
    );
  });

  it("follows a distributor's base rather than the default", () => {
    expect(
      assetTierUrl("static", "maps/minimap/abc.webp", "https://mine.test/"),
    ).toBe("https://mine.test/maps/minimap/abc.webp");
  });
});
