import { ExternalLink, Gamepad2, Info } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

// profile.ts transitively pulls in @picoframe/plugin-sdk, whose published dist
// uses extensionless relative imports Vitest's node resolver won't load. The pure
// builders never invoke a command, so stubbing the leaf lets the module load
// (same shim as links.test.ts).
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  applyProfileSlots,
  buildLayoutConfig,
  buildLogoSlot,
  isLinkable,
  resolveLogoContent,
} from "./layout";
import { getProfile, type Profile, shouldSeedCollapsed } from "./profile";

const base: Profile = { version: 1 };

describe("buildLayoutConfig", () => {
  it("defaults to a locked persistent sidebar (popover off, no user toggle)", () => {
    const cfg = buildLayoutConfig(base, null);
    // bare boolean = locked; never the { userConfigurable } object form
    expect(cfg.sidebar?.popover).toBe(false);
  });

  it("locks popover on when the profile sets it", () => {
    const cfg = buildLayoutConfig({ ...base, layout: { popover: true } }, null);
    expect(cfg.sidebar?.popover).toBe(true);
  });

  it("hides the breadcrumb when hideBreadcrumb is set", () => {
    const cfg = buildLayoutConfig(
      { ...base, layout: { hideBreadcrumb: true } },
      null,
    );
    expect(cfg.breadcrumb?.hidden).toBe(true);
  });

  it("locks history buttons on or off", () => {
    expect(
      buildLayoutConfig({ ...base, layout: { historyButtons: false } }, null)
        .history?.buttons,
    ).toBe(false);
    expect(
      buildLayoutConfig({ ...base, layout: { historyButtons: true } }, null)
        .history?.buttons,
    ).toBe(true);
  });

  it("resolves menu icon names, falling back to ExternalLink", () => {
    const cfg = buildLayoutConfig(
      { ...base, layout: { menu: { icon: "game", iconOpen: "info" } } },
      null,
    );
    expect(cfg.sidebar?.menuIcon).toBe(Gamepad2);
    expect(cfg.sidebar?.menuIconOpen).toBe(Info);
    const bad = buildLayoutConfig(
      { ...base, layout: { menu: { icon: "nope" } } },
      null,
    );
    expect(bad.sidebar?.menuIcon).toBe(ExternalLink);
  });

  it("defaults menu labelVisible to true when a label is set", () => {
    const cfg = buildLayoutConfig(
      { ...base, layout: { menu: { label: "Brand" } } },
      null,
    );
    expect(cfg.sidebar?.menuLabel).toBe("Brand");
    expect(cfg.sidebar?.menuLabelVisible).toBe(true);
  });

  it("respects an explicit menu labelVisible false", () => {
    const cfg = buildLayoutConfig(
      { ...base, layout: { menu: { label: "Brand", labelVisible: false } } },
      null,
    );
    expect(cfg.sidebar?.menuLabelVisible).toBe(false);
  });

  it("sets menuLabelContent from a resolved image", () => {
    const cfg = buildLayoutConfig(
      { ...base, layout: { menu: { label: "Brand", image: "logo.png" } } },
      "data:image/png;base64,AAAA",
    );
    expect(cfg.sidebar?.menuLabelContent).toBeDefined();
    expect(cfg.sidebar?.menuLabelVisible).toBe(true);
    expect(cfg.sidebar?.menuLabel).toBe("Brand");
  });

  it("omits menuLabelContent when the image did not resolve", () => {
    const cfg = buildLayoutConfig(
      { ...base, layout: { menu: { image: "logo.png" } } },
      null,
    );
    expect(cfg.sidebar?.menuLabelContent).toBeUndefined();
  });
});

describe("resolveLogoContent", () => {
  it("returns null with no logo config", () => {
    expect(resolveLogoContent(undefined, null)).toBeNull();
    expect(resolveLogoContent({}, null)).toBeNull();
  });
  it("returns text when only text is set", () => {
    expect(resolveLogoContent({ text: "Hi" }, null)).toEqual({ text: "Hi" });
  });
  it("prefers image over text when both resolve", () => {
    expect(
      resolveLogoContent({ text: "Hi", image: "logo.png" }, "data:img"),
    ).toEqual({ image: "data:img" });
  });
  it("falls back to text when the image failed to resolve", () => {
    expect(resolveLogoContent({ text: "Hi", image: "logo.png" }, null)).toEqual(
      {
        text: "Hi",
      },
    );
  });
  it("returns null when an image-only logo failed to resolve", () => {
    expect(resolveLogoContent({ image: "logo.png" }, null)).toBeNull();
  });
});

describe("isLinkable", () => {
  it("accepts http(s)/mailto/tel", () => {
    expect(isLinkable("https://x.example")).toBe(true);
    expect(isLinkable("http://x.example")).toBe(true);
    expect(isLinkable("mailto:a@b.c")).toBe(true);
    expect(isLinkable("tel:+123")).toBe(true);
  });
  it("rejects other schemes and empties", () => {
    expect(isLinkable("javascript:alert(1)")).toBe(false);
    expect(isLinkable("")).toBe(false);
    expect(isLinkable(undefined)).toBe(false);
  });
});

describe("buildLogoSlot", () => {
  it("returns null when there is no content", () => {
    expect(buildLogoSlot("topbar.center", undefined, null)).toBeNull();
    expect(buildLogoSlot("topbar.left", { image: "x" }, null)).toBeNull();
  });
  it("contributes to the given slot when content is present", () => {
    const slot = buildLogoSlot("topbar.right", { text: "Hi" }, null);
    expect(slot?.slot).toBe("topbar.right");
    expect(slot?.Component).toBeTypeOf("function");
  });
});

describe("applyProfileSlots", () => {
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
  const noImages = { left: null, center: null, right: null };

  it("returns the list unchanged when there are no logos", () => {
    const plugins = [otherPlugin, profilePlugin];
    expect(applyProfileSlots(plugins, noImages)).toBe(plugins);
  });

  it("injects a contribution per configured slot", () => {
    const loaded = getProfile();
    loaded.layout = {
      left: { text: "L" },
      center: { text: "C" },
      right: { text: "R" },
    };
    const result = applyProfileSlots([otherPlugin, profilePlugin], noImages);
    const profile = result.find((p) => p.id === "profile");
    const slots = (profile?.slots ?? []).map((s) => s.slot).sort();
    expect(slots).toEqual(["topbar.center", "topbar.left", "topbar.right"]);
    expect(result.find((p) => p.id === "other")).toBe(otherPlugin);
    loaded.layout = undefined;
  });
});

describe("shouldSeedCollapsed", () => {
  it("seeds only when sidebarCollapsed is set and no value exists", () => {
    expect(shouldSeedCollapsed(null, { sidebarCollapsed: true })).toBe(true);
    expect(shouldSeedCollapsed("false", { sidebarCollapsed: true })).toBe(
      false,
    );
    expect(shouldSeedCollapsed(null, { sidebarCollapsed: false })).toBe(false);
    expect(shouldSeedCollapsed(null, undefined)).toBe(false);
  });
});
