import { describe, expect, it } from "vitest";
import {
  assetUrl,
  campaignMediaUrl,
  isLocalRef,
  mediaKind,
  portableAssetPath,
  scenarioMediaUrl,
} from "./assetUrl";

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

  it("routes a scenario's dialogue clips under the scenario root", () => {
    expect(scenarioMediaUrl("sc-1", "abc.ogg")).toBe(
      "coilbox://localhost/scenario/sc-1/abc.ogg",
    );
  });
});

/**
 * The inverse of `assetUrl`, which is what lets a click on a link in distribution
 * markup name the file again: the markup is rewritten before it reaches the DOM,
 * so the handler only ever sees the URL (issue #1802).
 */
describe("portableAssetPath", () => {
  it("gives back the path assetUrl was built from", () => {
    for (const rel of ["images/art.jpg", "images/my art.jpg", "guide.pdf"]) {
      expect(portableAssetPath(assetUrl(rel)), rel).toBe(rel);
    }
  });

  it("reads the Windows spelling of the same URL", () => {
    // Windows serves custom schemes from `http://coilbox.localhost/`, so a URL
    // built there has to resolve back to the same file.
    expect(
      portableAssetPath("http://coilbox.localhost/portable/docs/guide.pdf"),
    ).toBe("docs/guide.pdf");
  });

  it("is not a path for a URL that is not a portable asset", () => {
    for (const url of [
      "https://example.org/guide.pdf",
      "coilbox://localhost/campaign/camp-1/a.mp4",
      "coilbox://localhost/portable/",
      "#news",
      "docs/guide.pdf",
    ]) {
      expect(portableAssetPath(url), url).toBeUndefined();
    }
  });

  it("is not a path when the escaping is malformed", () => {
    expect(
      portableAssetPath("coilbox://localhost/portable/%zz.pdf"),
    ).toBeUndefined();
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
