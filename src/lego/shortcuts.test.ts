import { describe, expect, it } from "vitest";
import { comboLabel, isShortcut, SHORTCUTS } from "./shortcuts";

/** A `KeyboardEvent` needs a live document to construct in a node
 *  environment, so build the plain object shape the matchers read instead. */
function key(
  key: string,
  modifiers: Partial<
    Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
  > = {},
): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

describe("SHORTCUTS", () => {
  it("has a unique id per entry, since handlers look shortcuts up by id", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("isShortcut", () => {
  it("matches G/R/S to the transform modes, unshifted only", () => {
    expect(isShortcut("translate", key("g"))).toBe(true);
    expect(isShortcut("rotate", key("r"))).toBe(true);
    expect(isShortcut("scale", key("s"))).toBe(true);
    expect(isShortcut("translate", key("G", { shiftKey: true }))).toBe(false);
  });

  it("holds Alt for snap-hold regardless of which key that keydown was for", () => {
    expect(isShortcut("snap-hold", key("g", { altKey: true }))).toBe(true);
    expect(isShortcut("snap-hold", key("Alt", { altKey: true }))).toBe(true);
    expect(isShortcut("snap-hold", key("g"))).toBe(false);
  });

  it("frames on F, but not with Cmd or Ctrl held", () => {
    expect(isShortcut("frame", key("f"))).toBe(true);
    expect(isShortcut("frame", key("f", { metaKey: true }))).toBe(false);
    expect(isShortcut("frame", key("f", { ctrlKey: true }))).toBe(false);
  });

  it("opens the sheet on the resulting '?' character", () => {
    expect(isShortcut("shortcuts", key("?"))).toBe(true);
    expect(isShortcut("shortcuts", key("/"))).toBe(false);
  });

  it("tells undo from redo by Shift, and takes Cmd or Ctrl for either", () => {
    expect(isShortcut("undo", key("z", { metaKey: true }))).toBe(true);
    expect(isShortcut("undo", key("z", { ctrlKey: true }))).toBe(true);
    expect(
      isShortcut("undo", key("z", { metaKey: true, shiftKey: true })),
    ).toBe(false);
    expect(
      isShortcut("redo", key("z", { metaKey: true, shiftKey: true })),
    ).toBe(true);
    expect(isShortcut("redo", key("y", { metaKey: true }))).toBe(true);
    expect(isShortcut("undo", key("z"))).toBe(false);
  });

  it("copies, pastes and duplicates on Cmd/Ctrl C/V/D", () => {
    expect(isShortcut("copy", key("c", { metaKey: true }))).toBe(true);
    expect(isShortcut("paste", key("v", { ctrlKey: true }))).toBe(true);
    expect(isShortcut("duplicate", key("d", { metaKey: true }))).toBe(true);
    expect(isShortcut("copy", key("c"))).toBe(false);
  });

  it("deletes on Backspace or Delete, with no modifier required", () => {
    expect(isShortcut("delete", key("Backspace"))).toBe(true);
    expect(isShortcut("delete", key("Delete"))).toBe(true);
    expect(isShortcut("delete", key("d"))).toBe(false);
  });

  it("throws for an id no shortcut carries, to catch a typo in a handler", () => {
    expect(() => isShortcut("not-a-real-shortcut", key("g"))).toThrow();
  });
});

describe("comboLabel", () => {
  it("names the mod key per platform", () => {
    const undo = SHORTCUTS.find((s) => s.id === "undo");
    if (!undo) throw new Error("undo shortcut missing");
    expect(comboLabel(undo.combos[0], true)).toBe("Cmd Z");
    expect(comboLabel(undo.combos[0], false)).toBe("Ctrl Z");
  });

  it("leaves a bare key as its upper-cased self", () => {
    const translate = SHORTCUTS.find((s) => s.id === "translate");
    if (!translate) throw new Error("translate shortcut missing");
    expect(comboLabel(translate.combos[0], true)).toBe("G");
  });

  it("prints the modified click that adds to the selection", () => {
    const add = SHORTCUTS.find((s) => s.id === "add-to-selection");
    if (!add) throw new Error("add-to-selection shortcut missing");
    expect(add.combos.map((combo) => comboLabel(combo, true))).toEqual([
      "Shift Click",
      "Cmd Click",
    ]);
  });

  it("leaves a named key as it is", () => {
    const del = SHORTCUTS.find((s) => s.id === "delete");
    if (!del) throw new Error("delete shortcut missing");
    expect(comboLabel(del.combos[0], true)).toBe("Backspace");
  });
});
