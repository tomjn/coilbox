import { describe, expect, it } from "vitest";
import { PORTABLE_PLATFORM, portableAsset } from "./portableUpdate";

/**
 * The portable zip is found by reading `latest.json` back out of the update, so
 * a manifest that does not carry one has to come back null rather than half an
 * asset. Guessing a URL here would mean downloading something unsigned.
 */
describe("finding the portable zip in a release manifest", () => {
  it("reads the url and signature the release workflow wrote", () => {
    const manifest = {
      version: "1.14.0",
      platforms: {
        "windows-x86_64": {
          url: "https://example.test/setup.exe",
          signature: "aaa",
        },
        [PORTABLE_PLATFORM]: {
          url: "https://example.test/portable.zip",
          signature: "bbb",
        },
      },
    };

    expect(portableAsset(manifest)).toEqual({
      url: "https://example.test/portable.zip",
      signature: "bbb",
    });
  });

  it("comes back empty for a release that predates the zip", () => {
    const manifest = {
      platforms: { "windows-x86_64": { url: "u", signature: "s" } },
    };

    expect(portableAsset(manifest)).toBeNull();
  });

  it.each([
    ["no platforms at all", { version: "1.14.0" }],
    ["platforms of the wrong shape", { platforms: "nope" }],
    [
      "an entry with no url",
      { platforms: { [PORTABLE_PLATFORM]: { signature: "b" } } },
    ],
    [
      "an entry with no signature",
      { platforms: { [PORTABLE_PLATFORM]: { url: "u" } } },
    ],
    [
      "an unsigned entry",
      { platforms: { [PORTABLE_PLATFORM]: { url: "u", signature: "" } } },
    ],
  ])("comes back empty for %s", (_name, manifest) => {
    expect(portableAsset(manifest as Record<string, unknown>)).toBeNull();
  });
});
