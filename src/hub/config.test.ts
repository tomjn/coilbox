import { describe, expect, it, vi } from "vitest";

// config.ts imports useSetting from @picoframe/frame and, transitively via
// profile.ts, defineCommand from @picoframe/plugin-sdk. Both published dists use
// extensionless relative imports Vitest's node resolver won't load from
// node_modules, so the leaves are stubbed the same way lobby-servers/config.test.ts
// does. These tests only exercise resolveHubUrl, which is pure.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => ["", () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { DEFAULT_HUB_URL, resolveHubUrl } from "./config";

describe("resolveHubUrl", () => {
  it("falls back to the built-in default when neither layer is set", () => {
    expect(resolveHubUrl("")).toBe(DEFAULT_HUB_URL);
    expect(resolveHubUrl("", undefined)).toBe(DEFAULT_HUB_URL);
  });

  it("prefers the profile override over the built-in default", () => {
    expect(resolveHubUrl("", "https://distro-hub.example.com")).toBe(
      "https://distro-hub.example.com",
    );
  });

  it("prefers the user setting over the profile override", () => {
    expect(
      resolveHubUrl(
        "https://mine.example.com",
        "https://distro-hub.example.com",
      ),
    ).toBe("https://mine.example.com");
  });

  it("treats a blank or whitespace-only override as unset", () => {
    expect(resolveHubUrl("   ", "   ")).toBe(DEFAULT_HUB_URL);
  });
});
