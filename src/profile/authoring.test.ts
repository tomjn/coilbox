import { describe, expect, it, vi } from "vitest";

// Same shim as updater.test.ts: the module graph reaches @picoframe/plugin-sdk, whose
// published dist uses extensionless relative imports Vitest's node resolver won't load.
// Nothing here invokes a command.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import {
  buildScaffoldProfile,
  type ScaffoldInputs,
  serializeProfile,
} from "./authoring";
import { getProfile, isProfileAuthoringEnabled } from "./profile";

const inputs = (over: Partial<ScaffoldInputs> = {}): ScaffoldInputs => ({
  title: "Coilbox",
  mode: "dark",
  accent: "orange",
  advanced: false,
  fullscreen: false,
  installedGames: [],
  ...over,
});

describe("buildScaffoldProfile", () => {
  it("captures the app's current title, theme and toggles", () => {
    const p = buildScaffoldProfile(
      inputs({ title: "Splinter Faction", advanced: true, fullscreen: true }),
    );
    expect(p).toMatchObject({
      version: 1,
      title: "Splinter Faction",
      mode: "dark",
      accent: "orange",
      advanced: true,
      fullscreen: true,
    });
  });

  it("seeds a game filter when exactly one game is installed", () => {
    const p = buildScaffoldProfile(
      inputs({ installedGames: ["Splinter Faction 0.1.72"] }),
    );
    expect(p.gameFilter).toEqual({ names: ["Splinter Faction 0.1.72"] });
  });

  it("leaves the game filter out when the intent is ambiguous", () => {
    expect(buildScaffoldProfile(inputs()).gameFilter).toBeUndefined();
    expect(
      buildScaffoldProfile(inputs({ installedGames: ["A", "B"] })).gameFilter,
    ).toBeUndefined();
  });

  it("prompts for the hide lists and surfaces the authoring switch", () => {
    const p = buildScaffoldProfile(inputs());
    expect(p.hide).toEqual([]);
    expect(p.hideSettings).toEqual([]);
    expect(p.authoring).toBe(true);
  });
});

describe("serializeProfile", () => {
  it("writes indented JSON with a trailing newline", () => {
    const text = serializeProfile({ version: 1, title: "X" });
    expect(text).toBe('{\n  "version": 1,\n  "title": "X"\n}\n');
  });
});

// Mutates the loaded-profile singleton the way updater.test.ts does, then restores it.
describe("isProfileAuthoringEnabled", () => {
  it("is on for a vanilla build and for a profile that stays silent", () => {
    expect(isProfileAuthoringEnabled()).toBe(true);
  });

  it("is off only for an explicit authoring: false", () => {
    const loaded = getProfile();
    loaded.authoring = false;
    expect(isProfileAuthoringEnabled()).toBe(false);
    loaded.authoring = true;
    expect(isProfileAuthoringEnabled()).toBe(true);
    loaded.authoring = undefined;
  });
});
