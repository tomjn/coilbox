import { describe, expect, it, vi } from "vitest";

// The registry holds layout components, so loading it pulls in @picoframe/frame,
// whose published dist uses extensionless relative imports Vitest's node resolver
// won't load from node_modules. These tests compare component identity and never
// render, so stubbing the leaf is enough (same pattern as mapEligibility.test.ts).
vi.mock("@picoframe/frame", () => ({
  Slot: () => null,
  useFrame: () => ({ title: "", nav: [] }),
}));

// Same reason for the zones the stacked layout composes: the onboarding cards
// reach the Tauri API and picoframe's plugin SDK, and the greeting, the continue
// hero and the resume rail reach the lobby connection through the shared resume
// collector. Nothing here renders any of them.
vi.mock("./zones/Onboarding", () => ({ default: () => null }));
vi.mock("./zones/Greeting", () => ({ default: () => null }));
vi.mock("./zones/Continue", () => ({ default: () => null }));
vi.mock("./zones/ResumeRail", () => ({ default: () => null }));

// The stacked layout also resolves the page backdrop, which reaches the
// profile's `@`-reference parser and through it @picoframe/plugin-sdk. Same
// reason, same shim as the frame above.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import type { Profile } from "../profile/profile";
import { DEFAULT_LAYOUT, homeMode, layoutNames, resolveLayout } from "./layout";
import StackedLayout from "./StackedLayout";

const profile = (welcome?: Profile["welcome"]): Pick<Profile, "welcome"> => ({
  welcome,
});

describe("homeMode", () => {
  it("routes a profile with a welcome to the branded arm", () => {
    expect(homeMode(profile({ html: "<h1>Hi</h1>" }))).toBe("welcome");
  });

  it("routes a welcome with no html to the branded arm too", () => {
    // Matches the gate main.tsx used before Coilbox owned `/`: a distribution
    // that ships an empty welcome keeps the empty branded page it had, rather
    // than silently gaining the tool grid.
    expect(homeMode(profile({}))).toBe("welcome");
  });

  it("routes a profile with no welcome to the zone layout", () => {
    expect(homeMode(profile(undefined))).toBe("layout");
  });
});

describe("resolveLayout", () => {
  it("resolves the stacked layout by name", () => {
    expect(resolveLayout("stacked")).toBe(StackedLayout);
  });

  it("falls back to the default when no name is configured", () => {
    expect(resolveLayout()).toBe(resolveLayout(DEFAULT_LAYOUT));
  });

  it("falls back to the default for an unknown name", () => {
    // A profile pinned to a layout from a newer Coilbox must still get a page.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveLayout("mosaic")).toBe(resolveLayout(DEFAULT_LAYOUT));
    // And it says so, because the page still renders: without the warning a
    // typo in the pin is indistinguishable from the pin working.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not resolve inherited Object properties as layouts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveLayout("toString")).toBe(resolveLayout(DEFAULT_LAYOUT));
    expect(resolveLayout("constructor")).toBe(resolveLayout(DEFAULT_LAYOUT));
    warn.mockRestore();
  });

  it("says nothing when no layout is pinned", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveLayout();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("layoutNames", () => {
  it("ships stacked and nothing else", () => {
    // The registry is a compatibility contract, so a second layout is a
    // deliberate decision rather than something that creeps in.
    expect(layoutNames()).toEqual(["stacked"]);
  });

  it("includes the default", () => {
    expect(layoutNames()).toContain(DEFAULT_LAYOUT);
  });
});
