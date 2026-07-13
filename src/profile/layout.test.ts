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
  applyProfileCenterSlot,
  buildCenterSlot,
  buildLayoutConfig,
  resolveCenterContent,
} from "./layout";
import { getProfile, type Profile } from "./profile";

const base: Profile = { version: 1 };

describe("buildLayoutConfig", () => {
  it("returns just the default popover config when layout is absent", () => {
    const cfg = buildLayoutConfig(base, null);
    expect(cfg.sidebar?.popover).toEqual({
      default: true,
      userConfigurable: true,
    });
    expect(cfg.breadcrumb).toBeUndefined();
    expect(cfg.history).toBeUndefined();
    expect(cfg.sidebar?.menuIcon).toBeUndefined();
    expect(cfg.sidebar?.menuLabel).toBeUndefined();
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

  it("defaults labelVisible to true when a label is set", () => {
    const cfg = buildLayoutConfig(
      { ...base, layout: { menu: { label: "Brand" } } },
      null,
    );
    expect(cfg.sidebar?.menuLabel).toBe("Brand");
    expect(cfg.sidebar?.menuLabelVisible).toBe(true);
  });

  it("respects an explicit labelVisible false", () => {
    const cfg = buildLayoutConfig(
      { ...base, layout: { menu: { label: "Brand", labelVisible: false } } },
      null,
    );
    expect(cfg.sidebar?.menuLabelVisible).toBe(false);
  });

  it("sets menuLabelContent from a resolved image and defaults labelVisible true", () => {
    const cfg = buildLayoutConfig(
      { ...base, layout: { menu: { label: "Brand", image: "logo.png" } } },
      "data:image/png;base64,AAAA",
    );
    expect(cfg.sidebar?.menuLabelContent).toBeDefined();
    expect(cfg.sidebar?.menuLabelVisible).toBe(true);
    // label remains the accessible name
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

describe("resolveCenterContent", () => {
  it("returns null with no center config", () => {
    expect(resolveCenterContent(undefined, null)).toBeNull();
    expect(resolveCenterContent({}, null)).toBeNull();
  });
  it("returns text when only text is set", () => {
    expect(resolveCenterContent({ text: "Hi" }, null)).toEqual({ text: "Hi" });
  });
  it("prefers image over text when both resolve", () => {
    expect(
      resolveCenterContent({ text: "Hi", image: "logo.png" }, "data:img"),
    ).toEqual({
      image: "data:img",
    });
  });
  it("falls back to text when the image failed to resolve", () => {
    expect(
      resolveCenterContent({ text: "Hi", image: "logo.png" }, null),
    ).toEqual({
      text: "Hi",
    });
  });
  it("returns null when an image-only center failed to resolve", () => {
    expect(resolveCenterContent({ image: "logo.png" }, null)).toBeNull();
  });
});

describe("buildCenterSlot", () => {
  it("returns null when there is no center content", () => {
    expect(buildCenterSlot(base, null)).toBeNull();
    expect(
      buildCenterSlot({ ...base, layout: { center: { image: "x" } } }, null),
    ).toBeNull();
  });
  it("contributes to topbar.center when content is present", () => {
    const slot = buildCenterSlot(
      { ...base, layout: { center: { text: "Hi" } } },
      null,
    );
    expect(slot?.slot).toBe("topbar.center");
    expect(slot?.Component).toBeTypeOf("function");
  });
});

describe("applyProfileCenterSlot", () => {
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

  it("returns the list unchanged when there is no center content", () => {
    const plugins = [otherPlugin, profilePlugin];
    expect(applyProfileCenterSlot(plugins, null)).toBe(plugins);
  });

  it("attaches the center slot to the profile plugin", () => {
    const loaded = getProfile();
    loaded.layout = { center: { text: "Hi" } };
    const result = applyProfileCenterSlot([otherPlugin, profilePlugin], null);
    const profile = result.find((p) => p.id === "profile");
    expect(profile?.slots?.[0].slot).toBe("topbar.center");
    // untouched plugin passes through by identity
    expect(result.find((p) => p.id === "other")).toBe(otherPlugin);
    loaded.layout = undefined;
  });
});
