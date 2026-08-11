import { describe, expect, it } from "vitest";
import { ENGINE_KEY_NAMES } from "./engineKeybinds.generated";
import { KEYBOARD_ROWS, MODIFIER_LAYERS } from "./keyboardLayout";
import { normaliseKeys } from "./uikeys";

describe("keyboard layout", () => {
  const caps = KEYBOARD_ROWS.flat();

  it("labels every key with a name the engine registers", () => {
    for (const cap of caps) {
      expect(ENGINE_KEY_NAMES, cap.key).toContain(cap.key);
    }
  });

  it("names no key twice", () => {
    const keys = caps.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("makes a keyset the parser accepts on every layer", () => {
    for (const layer of MODIFIER_LAYERS) {
      for (const cap of caps) {
        expect(normaliseKeys(`${layer.id}${cap.key}`), cap.key).not.toBeNull();
      }
    }
  });
});
