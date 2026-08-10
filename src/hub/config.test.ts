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

import {
  DEFAULT_HUB_URL,
  isHubOrigin,
  isValidHubUrl,
  resolveHubUrl,
} from "./config";

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

describe("isValidHubUrl", () => {
  it("accepts blank and whitespace-only, meaning unset", () => {
    expect(isValidHubUrl("")).toBe(true);
    expect(isValidHubUrl("   ")).toBe(true);
  });

  it("accepts http and https addresses", () => {
    expect(isValidHubUrl("https://coilbox-hub.vercel.app")).toBe(true);
    expect(isValidHubUrl("http://localhost:3000")).toBe(true);
  });

  it("rejects a scheme that isn't http or https", () => {
    expect(isValidHubUrl("ftp://example.com")).toBe(false);
    expect(isValidHubUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects text that doesn't parse as a URL at all", () => {
    expect(isValidHubUrl("not a url")).toBe(false);
    expect(isValidHubUrl("example.com")).toBe(false);
  });
});

describe("isHubOrigin", () => {
  const hub = DEFAULT_HUB_URL;

  it("matches a URL on the configured hub, whatever its path", () => {
    expect(isHubOrigin(`${hub}/api/v1/containers/abc.json`, hub)).toBe(true);
    expect(isHubOrigin(hub, hub)).toBe(true);
  });

  it("matches whatever hub is configured, not a hardcoded one", () => {
    const distro = "https://distro-hub.example.com";
    expect(isHubOrigin(`${distro}/api/v1/containers/abc.json`, distro)).toBe(
      true,
    );
    expect(isHubOrigin(`${hub}/api/v1/containers/abc.json`, distro)).toBe(
      false,
    );
  });

  it("rejects a host that only starts with the hub's name", () => {
    expect(isHubOrigin("https://coilbox-hub.vercel.app.evil.test/x", hub)).toBe(
      false,
    );
  });

  it("rejects the hub's name used as a userinfo prefix", () => {
    expect(isHubOrigin("https://coilbox-hub.vercel.app@evil.test/x", hub)).toBe(
      false,
    );
  });

  it("rejects http where the hub is https", () => {
    expect(isHubOrigin("http://coilbox-hub.vercel.app/x", hub)).toBe(false);
  });

  it("rejects a different port on the right host", () => {
    expect(isHubOrigin("https://coilbox-hub.vercel.app:8443/x", hub)).toBe(
      false,
    );
  });

  it("trusts nothing when there is no configured hub", () => {
    expect(isHubOrigin(`${hub}/x`, null)).toBe(false);
    expect(isHubOrigin(`${hub}/x`, "")).toBe(false);
    expect(isHubOrigin(`${hub}/x`, undefined)).toBe(false);
  });

  it("rejects an unparseable URL on either side", () => {
    expect(isHubOrigin("not a url", hub)).toBe(false);
    expect(isHubOrigin(`${hub}/x`, "not a url")).toBe(false);
  });

  it("never pairs up two opaque origins", () => {
    expect(isHubOrigin("file:///etc/passwd", "file:///etc/passwd")).toBe(false);
    expect(isHubOrigin("data:text/plain,hi", "data:text/plain,hi")).toBe(false);
  });
});
