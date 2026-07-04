import type { FramePlugin } from "@picoframe/plugin-sdk";
import { ExternalLink, MessagesSquare } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

// profile.ts transitively pulls in @picoframe/plugin-sdk, whose published dist
// uses extensionless relative imports that Vitest's node resolver won't load from
// node_modules (see multiplayer/store.test.ts). The applyProfileLinks tests read
// the profile singleton but never invoke a command, so stubbing the leaf is enough
// to let the module load.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { applyProfileLinks, buildProfileNav, resolveLinkIcon } from "./links";
import { getProfile, type Profile } from "./profile";

const base: Profile = { version: 1 };

describe("resolveLinkIcon", () => {
  it("maps a known name", () => {
    expect(resolveLinkIcon("discord")).toBe(MessagesSquare);
  });
  it("is case-insensitive", () => {
    expect(resolveLinkIcon("Discord")).toBe(MessagesSquare);
  });
  it("falls back to ExternalLink for an unknown name", () => {
    expect(resolveLinkIcon("nope")).toBe(ExternalLink);
  });
  it("falls back to ExternalLink when omitted", () => {
    expect(resolveLinkIcon(undefined)).toBe(ExternalLink);
  });
});

describe("buildProfileNav", () => {
  it("returns [] with no links", () => {
    expect(buildProfileNav(base)).toEqual([]);
    expect(buildProfileNav({ ...base, links: [] })).toEqual([]);
  });
  it("returns [] when links is not an array", () => {
    // @ts-expect-error testing malformed profile.json
    expect(buildProfileNav({ ...base, links: "x" })).toEqual([]);
  });
  it("puts an ungrouped link in the default 'Links' group", () => {
    const nav = buildProfileNav({
      ...base,
      links: [{ label: "Discord", href: "https://discord.gg/x" }],
    });
    expect(nav).toHaveLength(1);
    expect(nav[0].label).toBe("Links");
    expect(nav[0].items).toHaveLength(1);
    expect(nav[0].items[0].label).toBe("Discord");
    expect(nav[0].items[0].href).toBe("https://discord.gg/x");
  });
  it("merges links that share a group label", () => {
    const nav = buildProfileNav({
      ...base,
      links: [
        { label: "Discord", href: "https://discord.gg/x", group: "Community" },
        { label: "Forum", href: "https://forum.example", group: "Community" },
      ],
    });
    expect(nav).toHaveLength(1);
    expect(nav[0].label).toBe("Community");
    expect(nav[0].items).toHaveLength(2);
  });
  it("resolves icons with a fallback", () => {
    const nav = buildProfileNav({
      ...base,
      links: [
        { label: "Discord", href: "https://discord.gg/x", icon: "discord" },
        { label: "Site", href: "https://example.com" },
      ],
    });
    expect(nav[0].items[0].icon).toBe(MessagesSquare);
    expect(nav[0].items[1].icon).toBe(ExternalLink);
  });
  it("skips entries missing label or href", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nav = buildProfileNav({
      ...base,
      links: [
        { label: "Good", href: "https://ok.example" },
        // @ts-expect-error missing href
        { label: "NoHref" },
        // @ts-expect-error missing label
        { href: "https://x.example" },
      ],
    });
    expect(nav[0].items).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("drops unsupported href schemes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nav = buildProfileNav({
      ...base,
      links: [
        { label: "Bad", href: "javascript:alert(1)" },
        { label: "Good", href: "https://ok.example" },
      ],
    });
    expect(nav[0].items).toHaveLength(1);
    expect(nav[0].items[0].label).toBe("Good");
    warn.mockRestore();
  });
});

describe("applyProfileLinks", () => {
  const profilePlugin: FramePlugin = {
    id: "profile",
    version: "0.0.0",
    routes: [],
  };
  const otherPlugin: FramePlugin = {
    id: "other",
    version: "0.0.0",
    routes: [],
  };

  it("returns the list unchanged when the profile has no links", () => {
    const plugins = [otherPlugin, profilePlugin];
    expect(applyProfileLinks(plugins)).toBe(plugins);
  });

  it("attaches built nav groups to the profile plugin", () => {
    const loaded = getProfile();
    loaded.links = [{ label: "Discord", href: "https://discord.gg/x" }];
    const result = applyProfileLinks([otherPlugin, profilePlugin]);
    const profile = result.find((p) => p.id === "profile");
    expect(profile?.nav).toHaveLength(1);
    expect(profile?.nav?.[0].items[0].label).toBe("Discord");
    // untouched plugin passes through by identity
    expect(result.find((p) => p.id === "other")).toBe(otherPlugin);
    loaded.links = undefined;
  });
});
