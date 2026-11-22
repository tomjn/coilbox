import { describe, expect, it } from "vitest";
import {
  applyOverrides,
  captureKey,
  findConflict,
  isRebindable,
  parseOverrides,
} from "./shortcutOverrides";
import { SHORTCUTS } from "./shortcuts";

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

function byId(list: typeof SHORTCUTS, id: string) {
  const found = list.find((s) => s.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

describe("applyOverrides", () => {
  it("replaces every default combo of the shortcut it names", () => {
    const applied = applyOverrides(SHORTCUTS, {
      redo: { key: "q", mod: true },
    });
    expect(byId(applied, "redo").combos).toEqual([{ key: "q", mod: true }]);
  });

  it("leaves other shortcuts and the defaults alone", () => {
    const applied = applyOverrides(SHORTCUTS, {
      translate: { key: "q", mod: false, shift: false },
    });
    expect(byId(applied, "rotate")).toBe(byId(SHORTCUTS, "rotate"));
    expect(byId(SHORTCUTS, "translate").combos).toEqual([
      { key: "g", shift: false },
    ]);
  });

  it("keeps the translated description of an overridden shortcut", () => {
    const applied = applyOverrides(SHORTCUTS, {
      translate: { key: "q", mod: false, shift: false },
    });
    expect(byId(applied, "translate").description).toBe(
      byId(SHORTCUTS, "translate").description,
    );
  });

  it("ignores an id that no longer exists", () => {
    const applied = applyOverrides(SHORTCUTS, {
      "removed-in-a-later-version": { key: "q" },
    });
    expect(applied).toEqual(SHORTCUTS);
  });

  it("ignores an override for a shortcut that cannot be rebound", () => {
    const applied = applyOverrides(SHORTCUTS, {
      "snap-hold": { key: "q" },
      "add-to-selection": { key: "q" },
    });
    expect(byId(applied, "snap-hold").combos).toEqual([{ key: "Alt" }]);
    expect(byId(applied, "add-to-selection")).toBe(
      byId(SHORTCUTS, "add-to-selection"),
    );
  });
});

describe("isRebindable", () => {
  it("excludes Alt hold and the modified click", () => {
    expect(isRebindable(byId(SHORTCUTS, "snap-hold"))).toBe(false);
    expect(isRebindable(byId(SHORTCUTS, "add-to-selection"))).toBe(false);
    expect(isRebindable(byId(SHORTCUTS, "translate"))).toBe(true);
  });
});

describe("findConflict", () => {
  it("names the shortcut that already uses the combo", () => {
    const clash = findConflict(SHORTCUTS, "rotate", {
      key: "g",
      mod: false,
      shift: false,
    });
    expect(clash?.id).toBe("translate");
  });

  it("finds a clash with a combo that leaves a modifier unspecified", () => {
    expect(
      findConflict(SHORTCUTS, "rotate", { key: "c", mod: true, shift: false })
        ?.id,
    ).toBe("copy");
  });

  it("allows a free combo and the same letter with a different modifier", () => {
    expect(findConflict(SHORTCUTS, "rotate", { key: "q", mod: false })).toBe(
      undefined,
    );
    expect(findConflict(SHORTCUTS, "rotate", { key: "g", shift: true })).toBe(
      undefined,
    );
  });

  it("does not count the shortcut's own combo", () => {
    expect(
      findConflict(SHORTCUTS, "translate", {
        key: "g",
        mod: false,
        shift: false,
      }),
    ).toBe(undefined);
  });

  it("frees a combo a player has moved away", () => {
    const applied = applyOverrides(SHORTCUTS, {
      translate: { key: "q", mod: false, shift: false },
    });
    expect(
      findConflict(applied, "rotate", { key: "g", mod: false, shift: false }),
    ).toBe(undefined);
  });
});

describe("captureKey", () => {
  it("refuses a bare modifier", () => {
    for (const name of ["Shift", "Control", "Alt", "Meta"]) {
      expect(captureKey(key(name))).toEqual({ kind: "modifier" });
    }
  });

  it("records the modifiers held with a key", () => {
    expect(captureKey(key("Z", { metaKey: true, shiftKey: true }))).toEqual({
      kind: "combo",
      combo: { key: "z", mod: true, shift: true },
    });
    expect(captureKey(key("g"))).toEqual({
      kind: "combo",
      combo: { key: "g", mod: false, shift: false },
    });
  });

  it("does not record Shift for a symbol that already carries it", () => {
    expect(captureKey(key("?", { shiftKey: true }))).toEqual({
      kind: "combo",
      combo: { key: "?", mod: false },
    });
  });
});

describe("parseOverrides", () => {
  it("reads saved overrides and drops bad entries", () => {
    expect(
      parseOverrides(
        JSON.stringify({
          good: { key: "q", mod: true },
          bareModifier: { key: "Shift" },
          wrongType: { key: 4 },
          notACombo: "q",
        }),
      ),
    ).toEqual({ good: { key: "q", mod: true } });
  });

  it("gives none for empty, broken or non-object text", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("{nope")).toEqual({});
    expect(parseOverrides("[1]")).toEqual({});
  });
});
