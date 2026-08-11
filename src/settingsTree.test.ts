import { FRAME_APPEARANCE_SETTINGS_ID } from "@picoframe/frame";
import type { SettingsSection } from "@picoframe/plugin-sdk";
import { describe, expect, it } from "vitest";

// Reaching the plugin list means importing every plugin, and a few of them
// register listeners on `window` as they load (chat's mention cue, for one).
// Tests run in node, so hand them somewhere harmless to register.
Object.assign(globalThis, {
  window: { addEventListener() {}, removeEventListener() {} },
});

const { plugins } = await import("./app.plugins");

/**
 * The shape of the settings list, asserted from the declarations rather than
 * from what the frame renders.
 *
 * picoframe composes these into a tree: `parent` nests, and siblings sort by
 * `order` (default 100) then title. That composition is the frame's own, and is
 * not re-implemented here. What is worth holding still is the intent, which
 * lives entirely in these three fields: a section that quietly loses its parent,
 * or arrives with no order and lands alphabetically among the player-facing
 * pages, is the exact regression this file exists to catch.
 */

const sections: SettingsSection[] = plugins.flatMap((p) => p.settings ?? []);

/** Sections by id, merged the way `composeSettings` merges them: the first
 * declarer wins and later ones fill only what it left unset. The appearance
 * section is declared twice on purpose (the frame owns it, the profile plugin
 * adds a visibility gate). */
const merged = new Map<string, SettingsSection>();
for (const section of sections) {
  const existing = merged.get(section.id);
  merged.set(section.id, existing ? { ...section, ...existing } : section);
}

describe("settings declarations", () => {
  it("gives every section a home that exists", () => {
    for (const section of merged.values()) {
      if (section.parent) expect(merged.has(section.parent)).toBe(true);
    }
  });

  it("nests only one level deep", () => {
    for (const section of merged.values()) {
      const parent = section.parent && merged.get(section.parent);
      if (parent) expect(parent.parent).toBeUndefined();
    }
  });

  it("orders the top level player-first and tooling last", () => {
    // Appearance is missing from this list on purpose. The frame declares it
    // from a plugin of its own with `order: 10`, and what the profile plugin
    // declares here under the same id is only a visibility gate. At runtime it
    // lands between General and Game settings.
    const top = [...merged.values()]
      .filter((s) => !s.parent && s.id !== FRAME_APPEARANCE_SETTINGS_ID)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
      .map((s) => s.id);
    expect(top).toEqual([
      "general",
      "engine-settings",
      "notifications",
      "hub",
      "updates",
      "game-updates",
      "multiplayer",
      "content",
      "advanced",
    ]);
  });

  it("puts each grouped section under the group it belongs to", () => {
    const childrenOf = (parent: string) =>
      [...merged.values()]
        .filter((s) => s.parent === parent)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        .map((s) => s.id);
    expect(childrenOf("engine-settings")).toEqual([
      "engine-display",
      "engine-graphics",
      "engine-sound",
      "engine-input",
      "engine-game",
      "engine-profiles",
    ]);
    expect(childrenOf("multiplayer")).toEqual([
      "lobby-servers",
      "chat-highlights",
      "ignored-users",
    ]);
    expect(childrenOf("content")).toEqual([
      "content-folders",
      "engines",
      "downloads",
      "storage",
      "import",
    ]);
    expect(childrenOf("advanced")).toEqual([
      "mapconv",
      "uberstress",
      "profile",
    ]);
  });

  it("leaves no two sections sharing an order at the same level", () => {
    const seen = new Set<string>();
    for (const section of merged.values()) {
      const slot = `${section.parent ?? ""}:${section.order ?? 100}`;
      expect(seen.has(slot)).toBe(false);
      seen.add(slot);
    }
  });
});
