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
// reach the Tauri API and picoframe's plugin SDK, the greeting reaches the lobby
// connection, and nothing here renders either of them.
vi.mock("./zones/Onboarding", () => ({ default: () => null }));
vi.mock("./zones/Greeting", () => ({ default: () => null }));

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
    expect(resolveLayout("mosaic")).toBe(resolveLayout(DEFAULT_LAYOUT));
  });

  it("does not resolve inherited Object properties as layouts", () => {
    expect(resolveLayout("toString")).toBe(resolveLayout(DEFAULT_LAYOUT));
    expect(resolveLayout("constructor")).toBe(resolveLayout(DEFAULT_LAYOUT));
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
