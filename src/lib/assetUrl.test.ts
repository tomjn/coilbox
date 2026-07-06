import { describe, expect, it } from "vitest";
import { assetUrl, campaignMediaUrl, isLocalRef, mediaKind } from "./assetUrl";

// The suite runs under Node (vitest `environment: "node"`), where `navigator`
// reports a Node UA, so `isWindows()` is false — URLs take the `coilbox://` form.

describe("assetUrl", () => {
  it("builds a portable-root scheme URL, encoding segments but keeping slashes", () => {
    expect(assetUrl("images/art.jpg")).toBe(
      "coilbox://localhost/portable/images/art.jpg",
    );
    expect(assetUrl("images/my art.jpg")).toBe(
      "coilbox://localhost/portable/images/my%20art.jpg",
    );
  });

  it("strips a leading ./ or /", () => {
    expect(assetUrl("./images/x.png")).toBe(
      "coilbox://localhost/portable/images/x.png",
    );
  });

  it("routes campaign media under the campaign root", () => {
    expect(campaignMediaUrl("camp-1", "a.mp4")).toBe(
      "coilbox://localhost/campaign/camp-1/a.mp4",
    );
  });
});

describe("isLocalRef", () => {
  it("treats bare relative paths as local", () => {
    expect(isLocalRef("images/x.jpg")).toBe(true);
    expect(isLocalRef("fonts/x.woff2")).toBe(true);
  });

  it("leaves absolute/data/scheme/anchor refs alone", () => {
    for (const u of [
      "https://x/y.jpg",
      "http://x",
      "data:image/png;base64,AAAA",
      "blob:abc",
      "coilbox://localhost/portable/x",
      "/app/absolute.jpg",
      "#section",
      "mailto:a@b.c",
    ]) {
      expect(isLocalRef(u)).toBe(false);
    }
  });
});

describe("mediaKind", () => {
  it("classifies by extension, ignoring query/hash", () => {
    expect(mediaKind("a.mp4")).toBe("video");
    expect(mediaKind("coilbox://localhost/campaign/c/b.webm?t=1")).toBe(
      "video",
    );
    expect(mediaKind("vo.ogg")).toBe("audio");
    expect(mediaKind("song.mp3#x")).toBe("audio");
    expect(mediaKind("art.png")).toBe("image");
    expect(mediaKind("no-extension")).toBe("image");
  });
});
