/**
 * The `uikeys.txt` command language, as the engine executes it.
 *
 * Spring and Recoil do not parse this file into a table, they run it: each line
 * is a command (`bind`, `unbind`, `unbindall`, ...) applied in order to a
 * binding list. Reading a file therefore means running it, and this module is
 * that interpreter, kept pure so it can be tested without an engine.
 *
 * Semantics follow `rts/Game/UI/KeyBindings.cpp` and `KeySet.cpp` at RecoilEngine
 * tag 2026.07.04. The quirks are the engine's, not ours: `unbind` matches an
 * action's first word only, `unbindall` re-binds `enter chat` as a floor, and a
 * stateful command is forced to `Any+` because it needs both press and release.
 */

/** A parsed keyset: modifiers plus one key. */
export interface KeySet {
  any: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** Engine key name, `0x`-prefixed keycode or `sc_`-prefixed scancode. */
  key: string;
}

/** Keysets pressed in sequence, written comma-separated in the file. */
export type KeyChain = KeySet[];

/** One binding: a canonical keychain, and the action line verbatim. */
export interface Binding {
  keys: string;
  action: string;
}

/** One line of a file: its text, the command it runs, and up to two arguments. */
export interface UikeysLine {
  raw: string;
  /** Lowercased first word, or "" for a blank or comment-only line. */
  command: string;
  /** The engine tokenises to at most three: two words then the rest verbatim. */
  args: string[];
}

/** The state a file's commands build up. */
export interface UikeysState {
  bindings: Binding[];
  /** The key that stands in for meta. `null` after `fakemeta none`. */
  fakeMeta: string | null;
  keysyms: { name: string; code: string }[];
  /** Lines executed by nothing above, kept in order for round-tripping. */
  preserved: string[];
  /** Files pulled in with `keyload` or `keyreload`, which are not followed. */
  includes: string[];
}

/** First line of a file coilbox wrote. Mirrored in `keybinds.rs`. */
export const COILBOX_HEADER = "// Written by coilbox";

type ModFlag = "any" | "alt" | "ctrl" | "meta" | "shift";

/** Modifier flag, long form and abbreviation, in the engine's parse order. */
const MODIFIERS: [ModFlag, string, string][] = [
  ["any", "any+", "*+"],
  ["alt", "alt+", "a+"],
  ["ctrl", "ctrl+", "c+"],
  ["meta", "meta+", "m+"],
  ["shift", "shift+", "s+"],
];

/**
 * Commands that fire on release as well as press, so the engine forces `Any+`
 * onto them: a binding that fired on Ctrl+w press but not on plain w release
 * would leave the camera moving forever.
 */
const STATEFUL = new Set([
  "drawinmap",
  "moveforward",
  "moveback",
  "moveright",
  "moveleft",
  "moveup",
  "movedown",
  "moveslow",
  "movefast",
  "movetilt",
  "movereset",
  "moverotate",
]);

export function parseKeySet(token: string): KeySet | null {
  let s = token.trim().toLowerCase();
  const ks: KeySet = {
    any: false,
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
    key: "",
  };
  for (;;) {
    // The engine still parses Up+ and then ignores it, so we drop it too.
    if (s.startsWith("up+")) {
      s = s.slice(3);
      continue;
    }
    if (s.startsWith("u+")) {
      s = s.slice(2);
      continue;
    }
    const hit = MODIFIERS.find(
      ([, long, abbr]) => s.startsWith(long) || s.startsWith(abbr),
    );
    if (!hit) break;
    const [flag, long, abbr] = hit;
    ks[flag] = true;
    s = s.slice(s.startsWith(long) ? long.length : abbr.length);
  }
  if (!s) return null;
  ks.key = s;
  return ks;
}

export function formatKeySet(ks: KeySet): string {
  return (
    (ks.any ? "Any+" : "") +
    (ks.alt ? "Alt+" : "") +
    (ks.ctrl ? "Ctrl+" : "") +
    (ks.meta ? "Meta+" : "") +
    (ks.shift ? "Shift+" : "") +
    ks.key
  );
}

export function parseKeyChain(raw: string): KeyChain | null {
  const chain: KeyChain = [];
  for (const part of raw.split(",")) {
    const ks = parseKeySet(part);
    if (!ks) return null;
    chain.push(ks);
  }
  return chain.length > 0 ? chain : null;
}

/** A keychain in its canonical printed form, or `null` when it does not parse. */
export function normaliseKeys(raw: string): string | null {
  const chain = parseKeyChain(raw);
  return chain ? chain.map(formatKeySet).join(",") : null;
}

/** The word `unbind` and `unbindaction` match on: lowercased, arguments dropped. */
export function actionCommand(action: string): string {
  return action.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

export function emptyState(): UikeysState {
  return {
    bindings: [],
    fakeMeta: null,
    keysyms: [],
    preserved: [],
    includes: [],
  };
}

export function parseUikeys(text: string): UikeysLine[] {
  return text.split(/\r?\n/).map((raw) => {
    const clean = (raw.split("//")[0] ?? "").trim();
    if (!clean) return { raw, command: "", args: [] };
    // The engine tokenises to at most three parts, the last being the remainder
    // of the line with its spacing, so `bind a say hello world` keeps its words.
    const m = /^(\S+)(?:\s+(\S+)(?:\s+(.*))?)?$/.exec(clean);
    if (!m) return { raw, command: "", args: [] };
    const args = [m[2], m[3]].filter((a): a is string => a !== undefined);
    return { raw: clean, command: (m[1] ?? "").toLowerCase(), args };
  });
}

/** Add a binding unless that exact keyset and action pair is already there. */
function bindOne(state: UikeysState, keysRaw: string, action: string): void {
  if (!action.trim()) return;
  const chain = parseKeyChain(keysRaw);
  if (!chain) return;
  const last = chain[chain.length - 1];
  if (last && STATEFUL.has(actionCommand(action))) last.any = true;
  const keys = chain.map(formatKeySet).join(",");
  const dup = state.bindings.some(
    (b) => b.keys === keys && b.action === action,
  );
  if (!dup) state.bindings.push({ keys, action });
}

export function applyUikeys(
  state: UikeysState,
  lines: UikeysLine[],
): UikeysState {
  const next: UikeysState = {
    bindings: state.bindings.map((b) => ({ ...b })),
    fakeMeta: state.fakeMeta,
    keysyms: state.keysyms.map((k) => ({ ...k })),
    preserved: [...state.preserved],
    includes: [...state.includes],
  };

  for (const line of lines) {
    const [a0, a1] = line.args;
    switch (line.command) {
      case "":
        break;
      case "bind":
        if (a0 !== undefined && a1 !== undefined) bindOne(next, a0, a1);
        break;
      case "unbind": {
        if (a0 === undefined || a1 === undefined) break;
        const keys = normaliseKeys(a0);
        if (!keys) break;
        next.bindings = next.bindings.filter(
          (b) => !(b.keys === keys && actionCommand(b.action) === a1),
        );
        break;
      }
      case "unbindaction":
        if (a0 === undefined) break;
        next.bindings = next.bindings.filter(
          (b) => actionCommand(b.action) !== a0,
        );
        break;
      case "unbindkeyset": {
        if (a0 === undefined) break;
        const keys = normaliseKeys(a0);
        if (!keys) break;
        next.bindings = next.bindings.filter((b) => b.keys !== keys);
        break;
      }
      case "unbindall":
        // The engine clears both binding maps and the user key symbols, then
        // binds enter to chat so a player is never locked out of the console.
        next.bindings = [{ keys: "enter", action: "chat" }];
        next.keysyms = [];
        break;
      case "fakemeta":
        if (a0 !== undefined) next.fakeMeta = a0 === "none" ? null : a0;
        break;
      case "keysym":
        if (a0 !== undefined && a1 !== undefined)
          next.keysyms.push({ name: a0, code: a1 });
        break;
      case "keyload":
      case "keyreload":
        next.includes.push(a0 ?? "uikeys.txt");
        next.preserved.push(line.raw);
        break;
      default:
        next.preserved.push(line.raw);
        break;
    }
  }

  return next;
}

export function serialiseUikeys(state: UikeysState): string {
  const out: string[] = [
    COILBOX_HEADER,
    "// Editing it by hand is fine, coilbox reads this file back.",
    "",
    // The same two lines the engine writes from its own keysave, and for the
    // same reason: without them the hardcoded defaults stay bound underneath.
    "unbindall          // clear the defaults",
    "unbind enter chat  // clear the defaults",
    "",
  ];
  for (const k of state.keysyms) out.push(`keysym  ${k.name}  ${k.code}`);
  if (state.fakeMeta) out.push(`fakemeta  ${state.fakeMeta}`);
  if (state.keysyms.length > 0 || state.fakeMeta) out.push("");
  for (const b of state.bindings) {
    out.push(`bind ${b.keys.padStart(18)}  ${b.action}`);
  }
  if (state.preserved.length > 0) {
    out.push("", "// Lines coilbox does not understand, kept as they were.");
    out.push(...state.preserved);
  }
  return `${out.join("\n")}\n`;
}
