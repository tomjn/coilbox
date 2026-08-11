import { describe, expect, it } from "vitest";
import {
  addBinding,
  conflictKeys,
  fromSaved,
  type Keymap,
  keymapText,
  removeBinding,
  resetKeys,
  resolveKeymap,
  toSaved,
} from "./keymap";

/** A binding's source, or undefined when it is not in the keymap at all. */
function sourceOf(keys: string, action: string, km: Keymap) {
  return km.bindings.find((b) => b.keys === keys && b.action === action)
    ?.source;
}

describe("resolveKeymap", () => {
  it("starts from the engine's own defaults", () => {
    const km = resolveKeymap({});
    expect(km.bindings.length).toBeGreaterThan(100);
    expect(sourceOf("Any+tab", "toggleoverview", km)).toBe("engine");
  });

  it("lets a game replace the lot", () => {
    const km = resolveKeymap({ gameText: "unbindall\nbind q areaattack\n" });
    expect(km.bindings).toEqual([
      { keys: "enter", action: "chat", source: "game" },
      { keys: "q", action: "areaattack", source: "game" },
    ]);
  });

  it("credits the game, not the player, for what the player's file repeats", () => {
    const km = resolveKeymap({
      gameText: "unbindall\nbind q areaattack\n",
      userText: "unbindall\nbind q areaattack\nbind w mysetting\n",
    });
    expect(sourceOf("q", "areaattack", km)).toBe("game");
    expect(sourceOf("w", "mysetting", km)).toBe("user");
  });

  it("keeps the baseline so a key can be put back", () => {
    const km = resolveKeymap({
      gameText: "unbindall\nbind q areaattack\n",
      userText: "unbindall\nbind q somethingelse\n",
    });
    expect(km.baseline.map((b) => b.action)).toContain("areaattack");
    expect(km.bindings.map((b) => b.action)).not.toContain("areaattack");
  });

  it("reports a file that includes another it cannot follow", () => {
    const km = resolveKeymap({ userText: "keyload extra.txt\n" });
    expect(km.includes).toEqual(["extra.txt"]);
  });
});

describe("conflictKeys", () => {
  it("names a keyset carrying more than one action", () => {
    const km = resolveKeymap({
      gameText: "unbindall\nbind q areaattack\nbind q attack\nbind w move\n",
    });
    expect(conflictKeys(km.bindings)).toEqual(["q"]);
  });
});

describe("edits", () => {
  const base = resolveKeymap({ gameText: "unbindall\nbind q areaattack\n" });

  it("adds a binding as the player's", () => {
    const km = addBinding(base, "Ctrl+q", "areaattack");
    expect(sourceOf("Ctrl+q", "areaattack", km)).toBe("user");
  });

  it("normalises the keys it is given", () => {
    const km = addBinding(base, "c+q", "areaattack");
    expect(km.bindings.some((b) => b.keys === "Ctrl+q")).toBe(true);
  });

  it("removes a binding", () => {
    const km = removeBinding(base, "q", "areaattack");
    expect(km.bindings.some((b) => b.keys === "q")).toBe(false);
  });

  it("puts a key back to what the game said", () => {
    const edited = removeBinding(
      addBinding(base, "q", "attack"),
      "q",
      "areaattack",
    );
    expect(
      edited.bindings.some((b) => b.keys === "q" && b.action === "attack"),
    ).toBe(true);
    const reset = resetKeys(edited, "q");
    expect(reset.bindings.filter((b) => b.keys === "q")).toEqual([
      { keys: "q", action: "areaattack", source: "game" },
    ]);
  });

  it("writes a file that reads back to the same bindings", () => {
    const edited = addBinding(base, "Ctrl+q", "areaattack");
    const reread = resolveKeymap({
      gameText: "unbindall\nbind q areaattack\n",
      userText: keymapText(edited),
    });
    expect(reread.bindings.map((b) => `${b.keys} ${b.action}`)).toEqual(
      edited.bindings.map((b) => `${b.keys} ${b.action}`),
    );
  });
});

describe("saving", () => {
  it("round trips through a saved keymap", () => {
    const base = resolveKeymap({ gameText: "unbindall\nbind q areaattack\n" });
    const edited = addBinding(base, "Ctrl+q", "attack");
    const saved = toSaved(edited, "Test Game");
    expect(saved.gameName).toBe("Test Game");
    const restored = fromSaved(saved, base);
    expect(restored.bindings.map((b) => `${b.keys} ${b.action}`)).toEqual(
      edited.bindings.map((b) => `${b.keys} ${b.action}`),
    );
  });
});
