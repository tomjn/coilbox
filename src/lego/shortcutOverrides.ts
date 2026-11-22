/**
 * Player rebinding for the unit builder's shortcuts. Pure: it takes the
 * default list and a map of overrides and returns the list the handlers and
 * the sheet should read. Storage lives in `shortcutOverridesStore.ts`.
 */

import type { KeyCombo, Shortcut } from "./shortcuts";

/** One replacement combo per shortcut id. It replaces every default combo. */
export type ShortcutOverrides = Record<string, KeyCombo>;

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph"]);

/**
 * Whether the player may rebind a shortcut. A shortcut with its own `matches`
 * (Alt held) cannot be described as a key combo, and a click combo is not a
 * key at all.
 */
export function isRebindable(shortcut: Shortcut): boolean {
  if (shortcut.matches) return false;
  return !shortcut.combos.some((combo) => combo.key === "Click");
}

/**
 * The shortcuts with each override applied. An override for an id that is
 * not in the list, or for a shortcut that cannot be rebound, is ignored. A
 * shortcut is layered over its default rather than copied, so its translated
 * description still reads the current language.
 */
export function applyOverrides(
  shortcuts: Shortcut[],
  overrides: ShortcutOverrides,
): Shortcut[] {
  return shortcuts.map((shortcut) => {
    const override = Object.hasOwn(overrides, shortcut.id)
      ? overrides[shortcut.id]
      : undefined;
    if (!override || !isRebindable(shortcut)) return shortcut;
    return Object.create(shortcut, {
      combos: { value: [override], enumerable: true },
    }) as Shortcut;
  });
}

/** Whether one keypress could satisfy both combos. */
export function combosOverlap(a: KeyCombo, b: KeyCombo): boolean {
  if (a.key.toLowerCase() !== b.key.toLowerCase()) return false;
  if (a.mod !== undefined && b.mod !== undefined && a.mod !== b.mod) {
    return false;
  }
  if (a.shift !== undefined && b.shift !== undefined && a.shift !== b.shift) {
    return false;
  }
  return true;
}

/**
 * The other shortcut already using `combo`, if any. `shortcuts` should be the
 * list with overrides applied, so a combo a player has moved is free again.
 */
export function findConflict(
  shortcuts: Shortcut[],
  id: string,
  combo: KeyCombo,
): Shortcut | undefined {
  return shortcuts.find(
    (other) =>
      other.id !== id &&
      !other.matches &&
      other.combos.some((existing) => combosOverlap(existing, combo)),
  );
}

/** What a keypress turns into while the sheet is waiting for a new combo. */
export type CapturedKey =
  | { kind: "combo"; combo: KeyCombo }
  | { kind: "modifier" };

/**
 * A keypress as a combo. A press of Shift, Ctrl, Alt or Cmd alone is not a
 * combo. A symbol key such as "?" already carries Shift in its character, so
 * Shift is only recorded for letters, digits and named keys.
 */
export function captureKey(event: KeyboardEvent): CapturedKey {
  if (MODIFIER_KEYS.has(event.key)) return { kind: "modifier" };
  const mod = event.metaKey || event.ctrlKey;
  const plainSymbol = event.key.length === 1 && !/[a-z0-9]/i.test(event.key);
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const combo: KeyCombo = plainSymbol
    ? { key, mod }
    : { key, mod, shift: event.shiftKey };
  return { kind: "combo", combo };
}

function isCombo(value: unknown): value is KeyCombo {
  if (typeof value !== "object" || value === null) return false;
  const { key, mod, shift } = value as Record<string, unknown>;
  return (
    typeof key === "string" &&
    key.length > 0 &&
    !MODIFIER_KEYS.has(key) &&
    (mod === undefined || typeof mod === "boolean") &&
    (shift === undefined || typeof shift === "boolean")
  );
}

/** Overrides from saved text. Anything that does not parse gives none. */
export function parseOverrides(raw: string | null): ShortcutOverrides {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {};
  }
  const overrides: ShortcutOverrides = {};
  for (const [id, value] of Object.entries(data)) {
    if (isCombo(value)) overrides[id] = value;
  }
  return overrides;
}
