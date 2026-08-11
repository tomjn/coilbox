/**
 * An ANSI keyboard as data, in the engine's key names.
 *
 * The names are not ours to choose: the engine parses `esc`, not `escape`, and
 * `numpad+`, not `kp_plus`. `keyboardLayout.test.ts` asserts every name here is
 * one `KeyCodes.cpp` registers, so a wrong label fails a test rather than
 * writing a binding the engine ignores.
 *
 * Width is in units of one key. The number pad is left out: it is bindable from
 * the list, and including it would halve the size of the keys that matter.
 */
export interface KeyCap {
  /** The engine key name, and what a keyset is built from. */
  key: string;
  /** What the player sees, when that differs from the name. */
  label: string;
  /** Width in key units, default 1. */
  width?: number;
}

export const KEYBOARD_ROWS: KeyCap[][] = [
  [
    { key: "esc", label: "Esc" },
    { key: "f1", label: "F1" },
    { key: "f2", label: "F2" },
    { key: "f3", label: "F3" },
    { key: "f4", label: "F4" },
    { key: "f5", label: "F5" },
    { key: "f6", label: "F6" },
    { key: "f7", label: "F7" },
    { key: "f8", label: "F8" },
    { key: "f9", label: "F9" },
    { key: "f10", label: "F10" },
    { key: "f11", label: "F11" },
    { key: "f12", label: "F12" },
  ],
  [
    { key: "~", label: "~" },
    { key: "1", label: "1" },
    { key: "2", label: "2" },
    { key: "3", label: "3" },
    { key: "4", label: "4" },
    { key: "5", label: "5" },
    { key: "6", label: "6" },
    { key: "7", label: "7" },
    { key: "8", label: "8" },
    { key: "9", label: "9" },
    { key: "0", label: "0" },
    { key: "-", label: "-" },
    { key: "=", label: "=" },
    { key: "backspace", label: "Backspace", width: 2 },
  ],
  [
    { key: "tab", label: "Tab", width: 1.5 },
    { key: "q", label: "Q" },
    { key: "w", label: "W" },
    { key: "e", label: "E" },
    { key: "r", label: "R" },
    { key: "t", label: "T" },
    { key: "y", label: "Y" },
    { key: "u", label: "U" },
    { key: "i", label: "I" },
    { key: "o", label: "O" },
    { key: "p", label: "P" },
    { key: "[", label: "[" },
    { key: "]", label: "]" },
    { key: "\\", label: "\\", width: 1.5 },
  ],
  [
    { key: "capslock", label: "Caps", width: 1.75 },
    { key: "a", label: "A" },
    { key: "s", label: "S" },
    { key: "d", label: "D" },
    { key: "f", label: "F" },
    { key: "g", label: "G" },
    { key: "h", label: "H" },
    { key: "j", label: "J" },
    { key: "k", label: "K" },
    { key: "l", label: "L" },
    { key: ";", label: ";" },
    { key: "'", label: "'" },
    { key: "enter", label: "Enter", width: 2.25 },
  ],
  [
    { key: "shift", label: "Shift", width: 2.25 },
    { key: "z", label: "Z" },
    { key: "x", label: "X" },
    { key: "c", label: "C" },
    { key: "v", label: "V" },
    { key: "b", label: "B" },
    { key: "n", label: "N" },
    { key: "m", label: "M" },
    { key: ",", label: "," },
    { key: ".", label: "." },
    { key: "/", label: "/" },
    { key: "up", label: "Up", width: 1.75 },
  ],
  [
    { key: "ctrl", label: "Ctrl", width: 1.5 },
    { key: "meta", label: "Meta", width: 1.25 },
    { key: "alt", label: "Alt", width: 1.25 },
    { key: "space", label: "Space", width: 6 },
    { key: "insert", label: "Ins" },
    { key: "delete", label: "Del" },
    { key: "home", label: "Home" },
    { key: "end", label: "End" },
    { key: "pageup", label: "PgUp" },
    { key: "pagedown", label: "PgDn" },
    { key: "left", label: "Left" },
    { key: "down", label: "Down" },
    { key: "right", label: "Right" },
  ],
];

/** The modifier a layer tab applies, as a keyset prefix. */
export type ModifierLayer = "" | "Shift+" | "Ctrl+" | "Alt+" | "Any+";

export const MODIFIER_LAYERS: { id: ModifierLayer; label: string }[] = [
  { id: "", label: "Plain" },
  { id: "Shift+", label: "Shift" },
  { id: "Ctrl+", label: "Ctrl" },
  { id: "Alt+", label: "Alt" },
  { id: "Any+", label: "Any" },
];
