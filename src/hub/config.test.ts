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

import { getProfile } from "../profile/profile";
import {
  DEFAULT_HUB_URL,
  hubItemIdFromUrl,
  hubItemRoute,
  isHubItemPageReachable,
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

describe("hubItemIdFromUrl", () => {
  const hub = DEFAULT_HUB_URL;
  const id = "c6be936e-58ed-4daa-941e-800317876663";

  it("reads the id out of a share address on the configured hub", () => {
    expect(hubItemIdFromUrl(`${hub}/i/${id}`, hub)).toBe(id);
  });

  it("reads the id out of the page address a person would be sent", () => {
    // What Copy link hands out and what the website's cards link to, so it is
    // the address that actually gets pasted back into coilbox.
    expect(hubItemIdFromUrl(`${hub}/item/${id}`, hub)).toBe(id);
    expect(hubItemIdFromUrl(`${hub}/item/${id}?from=discord`, hub)).toBe(id);
  });

  it("keeps the query string and fragment out of the id", () => {
    expect(hubItemIdFromUrl(`${hub}/i/${id}?from=discord#top`, hub)).toBe(id);
  });

  it("reads a hub served under a path prefix", () => {
    const prefixed = "https://games.example.com/coilbox-hub";
    expect(hubItemIdFromUrl(`${prefixed}/i/${id}`, prefixed)).toBe(id);
    expect(hubItemIdFromUrl(`${prefixed}/i/${id}`, `${prefixed}/`)).toBe(id);
    // The same path on the origin's root is not that hub's item address.
    expect(
      hubItemIdFromUrl(`https://games.example.com/i/${id}`, prefixed),
    ).toBe(null);
  });

  it("refuses an address on the hub that is not an item", () => {
    expect(hubItemIdFromUrl(hub, hub)).toBe(null);
    expect(hubItemIdFromUrl(`${hub}/i/`, hub)).toBe(null);
    expect(hubItemIdFromUrl(`${hub}/i/${id}/raw`, hub)).toBe(null);
    expect(hubItemIdFromUrl(`${hub}/items/${id}`, hub)).toBe(null);
    expect(hubItemIdFromUrl(`${hub}/api/v1/items/${id}`, hub)).toBe(null);
  });

  it("refuses the same path on any other origin", () => {
    expect(hubItemIdFromUrl(`https://evil.test/i/${id}`, hub)).toBe(null);
    expect(
      hubItemIdFromUrl(`https://coilbox-hub.vercel.app.evil.test/i/${id}`, hub),
    ).toBe(null);
  });

  it("reads nothing when there is no configured hub", () => {
    expect(hubItemIdFromUrl(`${hub}/i/${id}`, null)).toBe(null);
    expect(hubItemIdFromUrl(`${hub}/i/${id}`, "")).toBe(null);
  });
});

/**
 * Whether a screen outside the hub may offer to open a hub item page (issue
 * #1487). The route redirects home when either gate is closed, so a link that
 * ignored them would read as a broken button rather than as a link to nowhere.
 */
describe("isHubItemPageReachable", () => {
  it("is reachable on a vanilla build", () => {
    expect(isHubItemPageReachable()).toBe(true);
  });

  it("is unreachable when a profile switches the hub off", () => {
    const loaded = getProfile();
    loaded.hub = false;
    expect(isHubItemPageReachable()).toBe(false);
    loaded.hub = undefined;
  });

  it("is unreachable when a profile hides the browse screen", () => {
    const loaded = getProfile();
    loaded.hide = ["hub.browse"];
    expect(isHubItemPageReachable()).toBe(false);
    loaded.hide = undefined;
  });
});

describe("hubItemRoute", () => {
  it("addresses the item page, escaping an id that is not a bare word", () => {
    expect(hubItemRoute("item-7")).toBe("/hub/item-7");
    expect(hubItemRoute("a/b")).toBe("/hub/a%2Fb");
  });
});
