import { describe, expect, it } from "vitest";
import {
  ENGINE_DEFAULT_BINDINGS,
  ENGINE_KEY_NAMES,
} from "./engineKeybinds.generated";
import { normaliseKeys } from "./uikeys";

describe("generated engine defaults", () => {
  it("has the whole table, not a truncated parse", () => {
    expect(ENGINE_DEFAULT_BINDINGS.length).toBeGreaterThan(100);
  });

  it("has a parseable keychain and a non-empty action on every row", () => {
    for (const b of ENGINE_DEFAULT_BINDINGS) {
      expect(normaliseKeys(b.keys), b.keys).not.toBeNull();
      expect(b.action.trim()).not.toBe("");
    }
  });

  it("carries the key names the keyboard is labelled with", () => {
    for (const name of ["esc", "backspace", "numpad+", "pageup", "capslock"]) {
      expect(ENGINE_KEY_NAMES).toContain(name);
    }
  });
});
