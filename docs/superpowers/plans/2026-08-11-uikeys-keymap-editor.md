# Keybinds editor implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A keymap editor in Settings > Engine Settings > Keybinds that reads, edits and writes the selected engine's `uikeys.txt`, on a keyboard and in a list, with saved keymaps that share through the container format.

**Architecture:** A pure TypeScript interpreter of the engine's `uikeys.txt` command language is the core, with no I/O in it. Above it, a layering module resolves engine defaults, the selected game's bundled file and the user's file into an effective keymap with provenance. Below it, a Rust module in the content plugin reads and writes the file and stores saved keymaps. The React section is the only part that knows about either.

**Tech Stack:** TypeScript, React 19, vitest, Rust, Tauri 2, picoframe components, biome.

Spec: `docs/superpowers/specs/2026-08-11-uikeys-keymap-editor-design.md`. Issue: #1317.

## Global Constraints

- Lint before every push, the same commands CI runs: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `bunx biome ci .`, `bun run typecheck`, `bun run test`.
- Let rustfmt own Rust formatting. Run `cargo fmt --all` rather than hand-formatting.
- UI comes from picoframe. `Button` and `Input` import from `@picoframe/frame`, everything else is already vendored under `src/components/ui/`. No native `select`, `checkbox` or `textarea`.
- No emoji anywhere. No semicolons in written text or comments, a hook rejects them.
- One commit per task, and never `git add -A`.
- Every new Tauri command needs three registrations: `build.rs` COMMANDS, `permissions/default.toml`, and the `generate_handler!` list in `lib.rs`. Missing any one gives a runtime "command not allowed" error, not a build error.
- The engine facts this plan relies on were read from RecoilEngine at tag `2026.07.04`: `rts/Game/Game.cpp`, `rts/Game/UI/KeyBindings.cpp`, `rts/Game/UI/KeyBindings.h`, `rts/Game/UI/KeySet.cpp`, `rts/Game/UI/KeyCodes.cpp`. When something here disagrees with the source, the source wins, and say so in the commit.

---

### Task 1: The uikeys interpreter

The engine reads `uikeys.txt` by executing it line by line, so this module executes it too. Pure functions, no React and no Tauri, because this is the part that has to be right.

**Files:**
- Create: `src/content/uikeys.ts`
- Test: `src/content/uikeys.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface KeySet { any: boolean; alt: boolean; ctrl: boolean; meta: boolean; shift: boolean; key: string }`
  - `type KeyChain = KeySet[]`
  - `interface Binding { keys: string; action: string }`
  - `interface UikeysLine { raw: string; command: string; args: string[] }`
  - `interface UikeysState { bindings: Binding[]; fakeMeta: string | null; keysyms: { name: string; code: string }[]; preserved: string[]; includes: string[] }`
  - `parseKeySet(token: string): KeySet | null`
  - `formatKeySet(ks: KeySet): string`
  - `parseKeyChain(raw: string): KeyChain | null`
  - `normaliseKeys(raw: string): string | null`
  - `actionCommand(action: string): string`
  - `emptyState(): UikeysState`
  - `parseUikeys(text: string): UikeysLine[]`
  - `applyUikeys(state: UikeysState, lines: UikeysLine[]): UikeysState`
  - `serialiseUikeys(state: UikeysState): string`
  - `const COILBOX_HEADER: string`

- [ ] **Step 1: Write the failing tests**

Create `src/content/uikeys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  actionCommand,
  applyUikeys,
  emptyState,
  formatKeySet,
  normaliseKeys,
  parseKeySet,
  parseUikeys,
  serialiseUikeys,
  type UikeysState,
} from "./uikeys";

/** Run a uikeys source against a fresh state. */
function run(text: string, from: UikeysState = emptyState()): UikeysState {
  return applyUikeys(from, parseUikeys(text));
}

describe("keysets", () => {
  it("expands the engine's modifier abbreviations", () => {
    expect(normaliseKeys("c+a")).toBe("Ctrl+a");
    expect(normaliseKeys("Ctrl+a")).toBe("Ctrl+a");
    expect(normaliseKeys("*+tab")).toBe("Any+tab");
  });

  it("orders modifiers the way the engine prints them", () => {
    expect(normaliseKeys("shift+ctrl+alt+any+x")).toBe("Any+Alt+Ctrl+Shift+x");
  });

  it("keeps plus signs that are the key rather than a separator", () => {
    expect(normaliseKeys("Alt++")).toBe("Alt++");
    expect(normaliseKeys("Alt+numpad+")).toBe("Alt+numpad+");
  });

  it("keeps keycode and scancode forms verbatim", () => {
    expect(normaliseKeys("0x1b")).toBe("0x1b");
    expect(normaliseKeys("Ctrl+sc_a")).toBe("Ctrl+sc_a");
  });

  it("drops the deprecated Up modifier the way the engine does", () => {
    expect(normaliseKeys("Up+a")).toBe("a");
  });

  it("round trips a keychain", () => {
    expect(normaliseKeys("Alt+ctrl+a,Alt+ctrl+a")).toBe(
      "Alt+Ctrl+a,Alt+Ctrl+a",
    );
  });

  it("rejects a token with no key", () => {
    expect(parseKeySet("Ctrl+")).toBeNull();
    expect(normaliseKeys("")).toBeNull();
  });

  it("formats what it parsed", () => {
    const ks = parseKeySet("s+f5");
    expect(ks).not.toBeNull();
    expect(formatKeySet(ks as NonNullable<typeof ks>)).toBe("Shift+f5");
  });
});

describe("bind", () => {
  it("appends bindings in file order", () => {
    const s = run("bind a firstaction\nbind b secondaction\n");
    expect(s.bindings).toEqual([
      { keys: "a", action: "firstaction" },
      { keys: "b", action: "secondaction" },
    ]);
  });

  it("keeps several actions on one keyset, as the engine does", () => {
    const s = run("bind Any+tab toggleoverview\nbind Any+tab edit_complete\n");
    expect(s.bindings.map((b) => b.action)).toEqual([
      "toggleoverview",
      "edit_complete",
    ]);
  });

  it("ignores an identical re-bind", () => {
    const s = run("bind a chat\nbind a chat\n");
    expect(s.bindings).toHaveLength(1);
  });

  it("forces Any onto a stateful command", () => {
    const s = run("bind w moveforward\n");
    expect(s.bindings[0]?.keys).toBe("Any+w");
  });

  it("keeps an action's arguments verbatim", () => {
    const s = run(
      "bind Ctrl+b select AllMap+_Builder_Idle+_ClearSelection_SelectOne+\n",
    );
    expect(s.bindings[0]?.action).toBe(
      "select AllMap+_Builder_Idle+_ClearSelection_SelectOne+",
    );
  });

  it("skips a bind whose key does not parse", () => {
    const s = run("bind Ctrl+ chat\n");
    expect(s.bindings).toHaveLength(0);
  });
});

describe("unbind", () => {
  it("matches on the action's first word only", () => {
    const before = run("bind [ buildfacing inc\n");
    expect(run("unbind [ buildfacing inc\n", before).bindings).toHaveLength(1);
    expect(run("unbind [ buildfacing\n", before).bindings).toHaveLength(0);
  });

  it("is a no-op for a binding that is not there", () => {
    const before = run("bind a chat\n");
    expect(run("unbind b chat\n", before).bindings).toHaveLength(1);
  });

  it("unbindaction removes the action from every keyset", () => {
    const before = run("bind a chat\nbind Shift+b chat\nbind c gameinfo\n");
    const after = run("unbindaction chat\n", before);
    expect(after.bindings).toEqual([{ keys: "c", action: "gameinfo" }]);
  });

  it("unbindkeyset removes every action on that keyset", () => {
    const before = run(
      "bind Any+tab toggleoverview\nbind Any+tab edit_complete\nbind c gameinfo\n",
    );
    const after = run("unbindkeyset Any+tab\n", before);
    expect(after.bindings).toEqual([{ keys: "c", action: "gameinfo" }]);
  });

  it("unbindall clears everything and leaves enter chat behind", () => {
    const before = run("bind a chat\nkeysym mykey 0x41\n");
    const after = run("unbindall\n", before);
    expect(after.bindings).toEqual([{ keys: "enter", action: "chat" }]);
    expect(after.keysyms).toEqual([]);
  });
});

describe("other commands", () => {
  it("records fakemeta and none", () => {
    expect(run("fakemeta space\n").fakeMeta).toBe("space");
    expect(run("fakemeta none\n").fakeMeta).toBeNull();
  });

  it("records keysyms", () => {
    expect(run("keysym mykey 0x41\n").keysyms).toEqual([
      { name: "mykey", code: "0x41" },
    ]);
  });

  it("records an include without following it", () => {
    const s = run("keyload other.txt\nbind a chat\n");
    expect(s.includes).toEqual(["other.txt"]);
    expect(s.bindings).toHaveLength(1);
  });

  it("preserves a line it does not execute", () => {
    expect(run("keydebug 1\n").preserved).toEqual(["keydebug 1"]);
  });

  it("ignores comments and blank lines", () => {
    const s = run("// a comment\n\nbind a chat // trailing\n");
    expect(s.bindings).toEqual([{ keys: "a", action: "chat" }]);
    expect(s.preserved).toEqual([]);
  });
});

describe("actionCommand", () => {
  it("takes the lowercased first word", () => {
    expect(actionCommand("BuildFacing inc")).toBe("buildfacing");
    expect(actionCommand("  chat  ")).toBe("chat");
  });
});

describe("serialise", () => {
  it("writes a file that reads back to the same state", () => {
    const before = run(
      "fakemeta space\nkeysym mykey 0x41\nbind Any+tab toggleoverview\nbind Ctrl+b select AllMap+_Builder_Idle+_ClearSelection_SelectOne+\nkeydebug 1\n",
    );
    const after = run(serialiseUikeys(before));
    expect(after.bindings).toEqual(before.bindings);
    expect(after.fakeMeta).toBe(before.fakeMeta);
    expect(after.keysyms).toEqual(before.keysyms);
    expect(after.preserved).toEqual(before.preserved);
  });

  it("clears the engine defaults before its own bindings", () => {
    const text = serialiseUikeys(run("bind a chat\n"));
    const lines = text.split("\n").map((l) => l.trim());
    expect(lines).toContain("unbindall          // clear the defaults");
    expect(lines).toContain("unbind enter chat  // clear the defaults");
  });

  it("marks the file as coilbox's", () => {
    expect(serialiseUikeys(emptyState()).startsWith("// Written by coilbox")).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test src/content/uikeys.test.ts`
Expected: FAIL, cannot resolve `./uikeys`.

- [ ] **Step 3: Write the module**

Create `src/content/uikeys.ts`:

```ts
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
  const dup = state.bindings.some((b) => b.keys === keys && b.action === action);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test src/content/uikeys.test.ts`
Expected: PASS, all tests.

The round-trip test is the one to watch. `serialiseUikeys` emits `unbindall` and `unbind enter chat`, so reading it back starts from `enter chat` and then unbinds it, which is why the bindings come out equal rather than one longer.

- [ ] **Step 5: Lint and commit**

```bash
bunx biome ci . && bun run typecheck
git add src/content/uikeys.ts src/content/uikeys.test.ts
git commit -m "Read uikeys.txt the way the engine does (#1317)"
```

---

### Task 2: Engine defaults and key names, generated

The engine binds about two hundred keys before it opens the file, from a table in its source. Without them the editor would show a keyboard that is mostly empty and would be lying. The table and the engine's key names are generated from the source and committed, so CI runs nothing and the build works offline.

**Files:**
- Create: `scripts/recoil-keybinds-version.txt`
- Create: `scripts/build-engine-keybinds.mjs`
- Create: `src/content/engineKeybinds.generated.ts` (by running the script)
- Create: `src/content/engineKeybinds.test.ts`
- Modify: `package.json` (scripts block, after `stars:catalogue`)

**Interfaces:**
- Consumes: `Binding`, `normaliseKeys` from `./uikeys`.
- Produces:
  - `const ENGINE_KEYBIND_REF: string` (the pinned tag)
  - `const ENGINE_DEFAULT_BINDINGS: Binding[]`
  - `const ENGINE_KEY_NAMES: string[]`

- [ ] **Step 1: Pin the engine version**

Create `scripts/recoil-keybinds-version.txt` containing exactly:

```
2026.07.04
```

- [ ] **Step 2: Write the generator**

Create `scripts/build-engine-keybinds.mjs`:

```js
#!/usr/bin/env bun
/**
 * Generate the engine's default key bindings and key names from RecoilEngine.
 *
 * The defaults live in a C array in KeyBindings.cpp and the key names in
 * AddPair calls in KeyCodes.cpp, neither of which any API exposes. Writing them
 * out by hand would rot silently, so this reads them from the source at the tag
 * in scripts/recoil-keybinds-version.txt and commits the result.
 *
 * Run: bun run keybinds:defaults
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ref = readFileSync(join(here, "recoil-keybinds-version.txt"), "utf8").trim();
const base = `https://raw.githubusercontent.com/beyond-all-reason/RecoilEngine/${ref}/rts/Game/UI`;

async function fetchText(name) {
  const res = await fetch(`${base}/${name}`);
  if (!res.ok) throw new Error(`fetch ${name} at ${ref}: ${res.status}`);
  return res.text();
}

/** The `{ "key", "action" }` rows of defaultBindings[], commented rows skipped. */
function parseDefaults(src) {
  const start = src.indexOf("defaultBindings[] = {");
  if (start < 0) throw new Error("defaultBindings[] not found");
  const end = src.indexOf("\n};", start);
  const body = src.slice(start, end);
  const out = [];
  for (const line of body.split("\n")) {
    const clean = line.trim();
    if (clean.startsWith("//")) continue;
    const m = /^\{\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\}/.exec(clean);
    if (m) out.push({ keys: m[1], action: m[2] });
  }
  if (out.length < 100) {
    throw new Error(`only ${out.length} default bindings, the parse is wrong`);
  }
  return out;
}

/**
 * The names AddPair registers. The engine also adds every printable ASCII
 * character and f1 to f12 in loops, which no regex can see, so those are added
 * here to match.
 */
function parseKeyNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/AddPair\("((?:[^"\\]|\\.)*)"/g)) {
    if (m[1] && m[1] !== "f") names.add(m[1]);
  }
  for (let i = 1; i <= 12; i++) names.add(`f${i}`);
  for (let c = 0x20; c <= 0x7e; c++) names.add(String.fromCharCode(c));
  return [...names].sort();
}

const [bindingsSrc, codesSrc] = await Promise.all([
  fetchText("KeyBindings.cpp"),
  fetchText("KeyCodes.cpp"),
]);

const bindings = parseDefaults(bindingsSrc);
const keyNames = parseKeyNames(codesSrc);

const file = `// Generated by scripts/build-engine-keybinds.mjs. Do not edit.
// Source: RecoilEngine ${ref}, rts/Game/UI/KeyBindings.cpp and KeyCodes.cpp.
// Regenerate with: bun run keybinds:defaults

import type { Binding } from "./uikeys";

/** The RecoilEngine tag these tables were read from. */
export const ENGINE_KEYBIND_REF = ${JSON.stringify(ref)};

/** What the engine binds before it opens uikeys.txt, in its own order. */
export const ENGINE_DEFAULT_BINDINGS: Binding[] = ${JSON.stringify(bindings, null, 2)};

/** Every key name the engine will parse, so the keyboard can be labelled with them. */
export const ENGINE_KEY_NAMES: string[] = ${JSON.stringify(keyNames, null, 2)};
`;

writeFileSync(join(here, "..", "src", "content", "engineKeybinds.generated.ts"), file);
console.log(`wrote ${bindings.length} bindings and ${keyNames.length} key names from ${ref}`);
```

The generated `Binding` uses field `keys`, matching Task 1, and the rows stay the engine's raw key strings such as `Any+tab`. Normalising happens when they run through `applyUikeys` in Task 5, so the generated file remains a faithful copy of the source.

- [ ] **Step 3: Add the package script**

In `package.json`, after the `stars:catalogue` line:

```json
    "keybinds:defaults": "bun scripts/build-engine-keybinds.mjs && biome check --write src/content/engineKeybinds.generated.ts",
```

- [ ] **Step 4: Generate and eyeball the output**

Run: `bun run keybinds:defaults`
Expected: prints something like `wrote 210 bindings and 190 key names from 2026.07.04`, and `src/content/engineKeybinds.generated.ts` exists.

Open the file and check the first rows read `{ "keys": "esc", "action": "quitmessage" }` and that `ENGINE_KEY_NAMES` contains `esc`, `numpad+`, `pageup` and `capslock`. If the binding count is under 100 the script throws rather than writing a half table.

- [ ] **Step 5: Write the guard tests**

Create `src/content/engineKeybinds.test.ts`:

```ts
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
```

- [ ] **Step 6: Run the tests**

Run: `bun run test src/content/engineKeybinds.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
bunx biome ci . && bun run typecheck
git add scripts/recoil-keybinds-version.txt scripts/build-engine-keybinds.mjs src/content/engineKeybinds.generated.ts src/content/engineKeybinds.test.ts package.json
git commit -m "Generate the engine's default keybinds from its source (#1317)"
```

---

### Task 3: Read and write the file

**Files:**
- Create: `crates/tauri-plugin-coilbox-content/src/keybinds.rs`
- Modify: `crates/tauri-plugin-coilbox-content/src/lib.rs` (add `mod keybinds;` beside `mod settings_backup;` at line 25, two commands beside the config-profile ones, two names in `generate_handler!`)
- Modify: `crates/tauri-plugin-coilbox-content/build.rs` (COMMANDS)
- Modify: `crates/tauri-plugin-coilbox-content/permissions/default.toml`
- Modify: `src/content/bindings.ts` (after the engine-config-profile block)

**Interfaces:**
- Consumes: nothing from earlier tasks except the header string, which is duplicated deliberately because Rust cannot import it.
- Produces:
  - Rust: `pub fn read(config_dir: &str) -> ReadResult`, `pub fn write(config_dir: &str, text: &str) -> Result<WriteResult, String>`
  - TS: `contentKeybindsRead({ configDir })` returning `{ path, exists, text, ours }`, `contentKeybindsWrite({ configDir, text })` returning `{ path, backedUp }`

- [ ] **Step 1: Write the failing Rust tests**

Create `crates/tauri-plugin-coilbox-content/src/keybinds.rs` with the header and the tests only, so it fails to compile against functions that do not exist yet:

```rust
//! Reading and writing an engine's `uikeys.txt`, and storing saved keymaps.
//!
//! The engine reads this file from its write dir, next to `springsettings.cfg`,
//! and reads it raw-first: once this file exists, the copy a game ships in its
//! archive never loads. So a write here replaces the player's whole keymap, and
//! the first write over a file coilbox did not author keeps a `.bak` beside it.

use std::path::{Path, PathBuf};

/// First line of a file coilbox wrote. Mirrors `COILBOX_HEADER` in `uikeys.ts`.
const COILBOX_HEADER: &str = "// Written by coilbox";

const FILENAME: &str = "uikeys.txt";
const BACKUP: &str = "uikeys.txt.bak";

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cbx-keys-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_reports_a_missing_file() {
        let dir = tmp("missing");
        let res = read(dir.to_string_lossy().as_ref());
        assert!(!res.exists);
        assert_eq!(res.text, "");
        assert!(res.path.ends_with("uikeys.txt"));
    }

    #[test]
    fn read_returns_the_text() {
        let dir = tmp("text");
        std::fs::write(dir.join("uikeys.txt"), b"bind a chat\n").unwrap();
        let res = read(dir.to_string_lossy().as_ref());
        assert!(res.exists);
        assert_eq!(res.text, "bind a chat\n");
    }

    #[test]
    fn first_write_over_a_hand_written_file_keeps_a_backup() {
        let dir = tmp("backup");
        let d = dir.to_string_lossy().to_string();
        std::fs::write(dir.join("uikeys.txt"), b"bind a chat\n").unwrap();

        let first = write(&d, "// Written by coilbox\nbind b chat\n").unwrap();
        assert!(first.backed_up);
        assert_eq!(
            std::fs::read_to_string(dir.join("uikeys.txt.bak")).unwrap(),
            "bind a chat\n"
        );

        // A second write has nothing of the player's left to protect, and must
        // not overwrite the one copy of it that exists.
        let second = write(&d, "// Written by coilbox\nbind c chat\n").unwrap();
        assert!(!second.backed_up);
        assert_eq!(
            std::fs::read_to_string(dir.join("uikeys.txt.bak")).unwrap(),
            "bind a chat\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("uikeys.txt")).unwrap(),
            "// Written by coilbox\nbind c chat\n"
        );
    }

    #[test]
    fn write_creates_the_file_when_there_is_none() {
        let dir = tmp("create");
        let res = write(dir.to_string_lossy().as_ref(), "// Written by coilbox\n").unwrap();
        assert!(!res.backed_up);
        assert!(dir.join("uikeys.txt").is_file());
        assert!(!dir.join("uikeys.txt.bak").exists());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p tauri-plugin-coilbox-content keybinds`
Expected: FAIL, `cannot find function read in this scope`.

- [ ] **Step 3: Write the implementation**

Add above the test module in `keybinds.rs`:

```rust
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    /// Full path of the file, whether or not it is there.
    pub path: String,
    pub exists: bool,
    /// The file's text, or empty when there is none.
    pub text: String,
    /// True when the text on disk was last written by coilbox.
    pub ours: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    /// True when this write took the one-time copy of a hand-written file.
    pub backed_up: bool,
}

pub fn read(config_dir: &str) -> ReadResult {
    let path = Path::new(config_dir).join(FILENAME);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    ReadResult {
        path: path.to_string_lossy().to_string(),
        exists: path.is_file(),
        ours: text.starts_with(COILBOX_HEADER),
        text,
    }
}

pub fn write(config_dir: &str, text: &str) -> Result<WriteResult, String> {
    let dir = Path::new(config_dir);
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let path = dir.join(FILENAME);
    let backup = dir.join(BACKUP);

    // Only the player's own file is worth keeping, and only the first time: a
    // later backup would be a copy of something coilbox wrote.
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let backed_up = path.is_file() && !existing.starts_with(COILBOX_HEADER) && !backup.exists();
    if backed_up {
        std::fs::copy(&path, &backup).map_err(|e| format!("back up {}: {e}", path.display()))?;
    }

    std::fs::write(&path, text).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(WriteResult {
        path: path.to_string_lossy().to_string(),
        backed_up,
    })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-content keybinds`
Expected: PASS, four tests.

- [ ] **Step 5: Wire up the commands**

In `crates/tauri-plugin-coilbox-content/src/lib.rs`, add `mod keybinds;` next to `mod settings_backup;`, then add after `content_config_delete_profile`:

```rust
/// `content_keybinds_read` — the `uikeys.txt` beside an engine's
/// `springsettings.cfg`. `configDir` is that file's directory, which unitsync
/// reports, so a portable engine's own config dir is handled without guessing.
#[tauri::command]
async fn content_keybinds_read(config_dir: String) -> Result<CliResult, ()> {
    let res = tauri::async_runtime::spawn_blocking(move || keybinds::read(&config_dir)).await;
    match res {
        Ok(r) => Ok(CliResult::ok(json!(r))),
        Err(e) => Ok(CliResult::err(format!("read keybinds task failed: {e}"))),
    }
}

/// `content_keybinds_write` — replace that `uikeys.txt`, keeping a one-time
/// `.bak` of a file coilbox did not write.
#[tauri::command]
async fn content_keybinds_write(config_dir: String, text: String) -> Result<CliResult, ()> {
    let res =
        tauri::async_runtime::spawn_blocking(move || keybinds::write(&config_dir, &text)).await;
    match res {
        Ok(Ok(r)) => Ok(CliResult::ok(json!(r))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("write keybinds task failed: {e}"))),
    }
}
```

Add `content_keybinds_read,` and `content_keybinds_write,` to `generate_handler!`, add `"content_keybinds_read",` and `"content_keybinds_write",` to COMMANDS in `build.rs`, and `"allow-content-keybinds-read",` and `"allow-content-keybinds-write",` to `permissions/default.toml`.

- [ ] **Step 6: Add the frontend bindings**

In `src/content/bindings.ts`, after the engine-config-profile block:

```ts
/* -------------------------------------------------------------------------- *
 * Keybinds — the engine's `uikeys.txt`, beside its `springsettings.cfg`.
 * -------------------------------------------------------------------------- */

/** Read the `uikeys.txt` in an engine's config directory. */
export const contentKeybindsRead = defineCommand<
  { configDir: string },
  { path: string; exists: boolean; text: string; ours: boolean }
>("coilbox-content", "content_keybinds_read");

/**
 * Replace that `uikeys.txt`. The first write over a file coilbox did not author
 * copies it to `uikeys.txt.bak`, reported as `backedUp`.
 */
export const contentKeybindsWrite = defineCommand<
  { configDir: string; text: string },
  { path: string; backedUp: boolean }
>("coilbox-content", "content_keybinds_write");
```

- [ ] **Step 7: Lint and commit**

```bash
cargo fmt --all
cargo clippy -p tauri-plugin-coilbox-content --all-targets --all-features -- -D warnings
bunx biome ci . && bun run typecheck
git add crates/tauri-plugin-coilbox-content/src/keybinds.rs crates/tauri-plugin-coilbox-content/src/lib.rs crates/tauri-plugin-coilbox-content/build.rs crates/tauri-plugin-coilbox-content/permissions/default.toml src/content/bindings.ts
git commit -m "Read and write the engine's uikeys.txt (#1317)"
```

---

### Task 4: Saved keymaps on disk

Saved keymaps live under the app data dir keyed by content root, exactly as config snapshots do, so they travel with a portable install. Rust owns the name, slug and timestamp. The keymap itself is an opaque JSON string, so its shape has one definition, in TypeScript.

**Files:**
- Modify: `crates/tauri-plugin-coilbox-content/src/keybinds.rs`
- Modify: `crates/tauri-plugin-coilbox-content/src/lib.rs`, `build.rs`, `permissions/default.toml`
- Modify: `src/content/bindings.ts`

**Interfaces:**
- Consumes: `settings_backup::slug` and `crate::hash_id`, both already in the crate.
- Produces:
  - Rust: `pub fn keymaps_list(store: &Path, root_path: &str) -> Vec<StoredKeymap>`, `pub fn keymaps_save(store: &Path, root_path: &str, name: &str, json: &str) -> Result<StoredKeymap, String>`, `pub fn keymaps_delete(store: &Path, root_path: &str, slug: &str) -> Result<(), String>`. The struct is `StoredKeymap` rather than `SavedKeymap` because `SavedKeymap` in `keymap.ts` is the payload, and these two must not be confused.
  - TS: `contentKeymaps({ rootPath })`, `contentKeymapSave({ rootPath, name, json })`, `contentKeymapDelete({ rootPath, slug })`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `keybinds.rs`:

```rust
    #[test]
    fn keymaps_save_list_delete() {
        let dir = tmp("keymaps");
        let store = dir.join("store");
        let root = "/some/content/root";

        assert!(keymaps_list(&store, root).is_empty());

        let saved = keymaps_save(&store, root, "My BAR Keys", r#"{"bindings":[]}"#).unwrap();
        assert_eq!(saved.slug, "my-bar-keys");
        assert_eq!(saved.name, "My BAR Keys");

        let listed = keymaps_list(&store, root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].json, r#"{"bindings":[]}"#);

        // A different root does not see it.
        assert!(keymaps_list(&store, "/other/root").is_empty());

        // Re-saving the same name replaces rather than duplicates.
        keymaps_save(&store, root, "My BAR Keys", r#"{"bindings":[1]}"#).unwrap();
        let listed = keymaps_list(&store, root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].json, r#"{"bindings":[1]}"#);

        keymaps_delete(&store, root, "my-bar-keys").unwrap();
        assert!(keymaps_list(&store, root).is_empty());
    }

    #[test]
    fn keymaps_reject_an_unusable_name() {
        let dir = tmp("badname");
        assert!(keymaps_save(&dir, "/root", "***", "{}").is_err());
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p tauri-plugin-coilbox-content keybinds`
Expected: FAIL, `cannot find function keymaps_list`.

- [ ] **Step 3: Implement**

Add to `keybinds.rs`:

```rust
/// One saved keymap: metadata this module owns, and the payload it does not read.
/// Named `StoredKeymap` because `SavedKeymap` in `keymap.ts` is the payload.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredKeymap {
    pub name: String,
    pub slug: String,
    pub created_at_ms: u64,
    /// The keymap document, as the frontend serialised it.
    pub json: String,
}

/// Where one content root's keymaps live, under the keymaps store.
fn root_dir(store: &Path, root_path: &str) -> PathBuf {
    store.join(crate::hash_id(&[root_path]))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Saved keymaps for a content root, newest first.
pub fn keymaps_list(store: &Path, root_path: &str) -> Vec<StoredKeymap> {
    let dir = root_dir(store, root_path);
    let mut out: Vec<StoredKeymap> = match std::fs::read_dir(&dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| {
                let text = std::fs::read_to_string(e.path()).ok()?;
                let v: serde_json::Value = serde_json::from_str(&text).ok()?;
                Some(StoredKeymap {
                    name: v.get("name")?.as_str()?.to_string(),
                    slug: v.get("slug")?.as_str()?.to_string(),
                    created_at_ms: v.get("createdAtMs").and_then(|x| x.as_u64()).unwrap_or(0),
                    json: v.get("keymap")?.to_string(),
                })
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    out.sort_by_key(|k| std::cmp::Reverse(k.created_at_ms));
    out
}

/// Save (or replace by name) one keymap for a content root.
pub fn keymaps_save(
    store: &Path,
    root_path: &str,
    name: &str,
    json: &str,
) -> Result<StoredKeymap, String> {
    let slug =
        crate::settings_backup::slug(name).ok_or("Keymap name must contain a letter or number")?;
    let keymap: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("keymap is not valid JSON: {e}"))?;
    let dir = root_dir(store, root_path);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create keymaps dir: {e}"))?;
    let created_at_ms = now_ms();
    let doc = serde_json::json!({
        "name": name,
        "slug": slug,
        "createdAtMs": created_at_ms,
        "keymap": keymap,
    });
    std::fs::write(
        dir.join(format!("{slug}.json")),
        serde_json::to_string_pretty(&doc).map_err(|e| format!("serialise keymap: {e}"))?,
    )
    .map_err(|e| format!("write keymap: {e}"))?;
    Ok(StoredKeymap {
        name: name.to_string(),
        slug,
        created_at_ms,
        json: keymap.to_string(),
    })
}

/// Delete one saved keymap. Deleting one that is not there is not an error.
pub fn keymaps_delete(store: &Path, root_path: &str, slug: &str) -> Result<(), String> {
    let path = root_dir(store, root_path).join(format!("{slug}.json"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("delete keymap: {e}"))?;
    }
    Ok(())
}
```

`settings_backup::slug` is already `pub`. If `crate::hash_id` turns out to be private, make it `pub(crate)` rather than copying it.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-content keybinds`
Expected: PASS, six tests.

- [ ] **Step 5: Wire up three commands**

In `lib.rs`, beside `profiles_dir`:

```rust
/// Directory holding saved keymaps, under the app data dir.
fn keymaps_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?.join("keymaps"))
}
```

Then three commands following the exact shape of `content_config_profiles`, `content_config_backup` and `content_config_delete_profile`: `content_keymaps(app, root_path)` returning `json!({ "keymaps": keymaps })`, `content_keymap_save(app, root_path, name, json)` returning `json!({ "keymap": saved })`, and `content_keymap_delete(app, root_path, slug)` returning `json!({ "ok": true })`. Each resolves `keymaps_dir` first and returns `CliResult::err` when that fails, and each runs its `keybinds::` call inside `tauri::async_runtime::spawn_blocking`.

Register all three in `generate_handler!`, `build.rs` COMMANDS and `permissions/default.toml`.

- [ ] **Step 6: Add the frontend bindings**

In `src/content/bindings.ts`, under the keybinds block:

```ts
/** One saved keymap for a content root. `json` is a serialised `SavedKeymap`. */
export interface StoredKeymap {
  name: string;
  slug: string;
  createdAtMs: number;
  json: string;
}

/** Saved keymaps for a content root, newest first. */
export const contentKeymaps = defineCommand<
  { rootPath: string },
  { keymaps: StoredKeymap[] }
>("coilbox-content", "content_keymaps");

/** Save a keymap under a name, replacing any keymap already saved under it. */
export const contentKeymapSave = defineCommand<
  { rootPath: string; name: string; json: string },
  { keymap: StoredKeymap }
>("coilbox-content", "content_keymap_save");

/** Delete a saved keymap by slug. */
export const contentKeymapDelete = defineCommand<
  { rootPath: string; slug: string },
  { ok: boolean }
>("coilbox-content", "content_keymap_delete");
```

- [ ] **Step 7: Lint and commit**

```bash
cargo fmt --all
cargo clippy -p tauri-plugin-coilbox-content --all-targets --all-features -- -D warnings
bunx biome ci . && bun run typecheck
git add crates/tauri-plugin-coilbox-content/src/keybinds.rs crates/tauri-plugin-coilbox-content/src/lib.rs crates/tauri-plugin-coilbox-content/build.rs crates/tauri-plugin-coilbox-content/permissions/default.toml src/content/bindings.ts
git commit -m "Store saved keymaps per content root (#1317)"
```

---

### Task 5: Layering, provenance and edits

Three layers become one keymap. Provenance is worked out by comparing the effective keymap against a baseline of the first two layers, not by which layer ran the `bind`, because a user file almost always opens with `unbindall` and would otherwise claim every binding as the player's.

**Files:**
- Create: `src/content/keymap.ts`
- Test: `src/content/keymap.test.ts`

**Interfaces:**
- Consumes: `Binding`, `UikeysState`, `applyUikeys`, `parseUikeys`, `emptyState`, `normaliseKeys`, `serialiseUikeys` from `./uikeys`, plus `ENGINE_DEFAULT_BINDINGS` from `./engineKeybinds.generated`.
- Produces:
  - `type BindingSource = "engine" | "game" | "user"`
  - `interface ResolvedBinding extends Binding { source: BindingSource }`
  - `interface Keymap { bindings: ResolvedBinding[]; baseline: ResolvedBinding[]; state: UikeysState; includes: string[] }`
  - `resolveKeymap(input: { gameText?: string; userText?: string }): Keymap`
  - `conflictKeys(bindings: ResolvedBinding[]): string[]`
  - `bindingsFor(keymap: Keymap, keys: string): ResolvedBinding[]`
  - `addBinding(keymap: Keymap, keys: string, action: string): Keymap`
  - `removeBinding(keymap: Keymap, keys: string, action: string): Keymap`
  - `resetKeys(keymap: Keymap, keys: string): Keymap`
  - `keymapText(keymap: Keymap): string`
  - `interface SavedKeymap { bindings: Binding[]; fakeMeta: string | null; keysyms: { name: string; code: string }[]; gameName?: string }`
  - `toSaved(keymap: Keymap, gameName?: string): SavedKeymap`
  - `fromSaved(saved: SavedKeymap, keymap: Keymap): Keymap`

- [ ] **Step 1: Write the failing tests**

Create `src/content/keymap.test.ts`:

```ts
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
  return km.bindings.find((b) => b.keys === keys && b.action === action)?.source;
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test src/content/keymap.test.ts`
Expected: FAIL, cannot resolve `./keymap`.

- [ ] **Step 3: Write the module**

Create `src/content/keymap.ts`:

```ts
/**
 * The three layers of a keymap, resolved into one list with provenance.
 *
 * The engine binds its hardcoded defaults, then runs the first `uikeys.txt` it
 * finds. That is the player's file when there is one, and the game's archive
 * copy otherwise, never both, because the VFS reads raw before archives. So the
 * file coilbox writes has to carry the game's bindings as well as the player's,
 * and this module is where the two are told apart.
 *
 * Provenance is a comparison, not an order. A user file almost always starts
 * with `unbindall`, so crediting whichever layer ran the `bind` would mark the
 * whole keymap as the player's work.
 */
import { ENGINE_DEFAULT_BINDINGS } from "./engineKeybinds.generated";
import {
  applyUikeys,
  type Binding,
  emptyState,
  normaliseKeys,
  parseUikeys,
  serialiseUikeys,
  type UikeysState,
} from "./uikeys";

export type BindingSource = "engine" | "game" | "user";

export interface ResolvedBinding extends Binding {
  source: BindingSource;
}

export interface Keymap {
  /** The effective bindings, in the order the engine holds them. */
  bindings: ResolvedBinding[];
  /** Engine plus game, for resetting a key and for working out provenance. */
  baseline: ResolvedBinding[];
  /** Everything else the file carries: fakemeta, keysyms, preserved lines. */
  state: UikeysState;
  /** Files the user's file pulled in, which are not followed. */
  includes: string[];
}

function key(b: Binding): string {
  return `${b.keys} ${b.action}`;
}

/** Engine defaults as the engine applies them, `fakemeta space` included. */
function engineState(): UikeysState {
  const start = { ...emptyState(), fakeMeta: "space" };
  return applyUikeys(
    start,
    ENGINE_DEFAULT_BINDINGS.map((b) => ({
      raw: `bind ${b.keys} ${b.action}`,
      command: "bind",
      args: [b.keys, b.action],
    })),
  );
}

export function resolveKeymap(input: {
  gameText?: string;
  userText?: string;
}): Keymap {
  const engine = engineState();
  const engineKeys = new Set(engine.bindings.map(key));

  const base = input.gameText
    ? applyUikeys(engine, parseUikeys(input.gameText))
    : engine;
  const baseline: ResolvedBinding[] = base.bindings.map((b) => ({
    ...b,
    source: engineKeys.has(key(b)) ? "engine" : "game",
  }));
  const baselineSource = new Map(baseline.map((b) => [key(b), b.source]));

  const state = input.userText
    ? applyUikeys(base, parseUikeys(input.userText))
    : base;
  const bindings: ResolvedBinding[] = state.bindings.map((b) => ({
    ...b,
    source: baselineSource.get(key(b)) ?? "user",
  }));

  return { bindings, baseline, state, includes: state.includes };
}

/** Keysets carrying more than one action, in the order they first appear. */
export function conflictKeys(bindings: ResolvedBinding[]): string[] {
  const counts = new Map<string, number>();
  for (const b of bindings) counts.set(b.keys, (counts.get(b.keys) ?? 0) + 1);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of bindings) {
    if ((counts.get(b.keys) ?? 0) > 1 && !seen.has(b.keys)) {
      seen.add(b.keys);
      out.push(b.keys);
    }
  }
  return out;
}

/** Every action on one keyset, in the order the engine tries them. */
export function bindingsFor(keymap: Keymap, keys: string): ResolvedBinding[] {
  return keymap.bindings.filter((b) => b.keys === keys);
}

/** Rebuild a keymap around a new effective binding list. */
function withBindings(keymap: Keymap, bindings: ResolvedBinding[]): Keymap {
  return {
    ...keymap,
    bindings,
    state: {
      ...keymap.state,
      bindings: bindings.map(({ keys, action }) => ({ keys, action })),
    },
  };
}

export function addBinding(
  keymap: Keymap,
  keys: string,
  action: string,
): Keymap {
  const norm = normaliseKeys(keys);
  if (!norm || !action.trim()) return keymap;
  if (keymap.bindings.some((b) => b.keys === norm && b.action === action)) {
    return keymap;
  }
  const baseline = keymap.baseline.find(
    (b) => b.keys === norm && b.action === action,
  );
  return withBindings(keymap, [
    ...keymap.bindings,
    { keys: norm, action, source: baseline?.source ?? "user" },
  ]);
}

export function removeBinding(
  keymap: Keymap,
  keys: string,
  action: string,
): Keymap {
  const norm = normaliseKeys(keys) ?? keys;
  return withBindings(
    keymap,
    keymap.bindings.filter((b) => !(b.keys === norm && b.action === action)),
  );
}

/** Put one keyset back to what the engine and game said, dropping the edits. */
export function resetKeys(keymap: Keymap, keys: string): Keymap {
  const norm = normaliseKeys(keys) ?? keys;
  const kept = keymap.bindings.filter((b) => b.keys !== norm);
  const restored = keymap.baseline.filter((b) => b.keys === norm);
  return withBindings(keymap, [...kept, ...restored]);
}

/** The file text this keymap would be written as. */
export function keymapText(keymap: Keymap): string {
  return serialiseUikeys(keymap.state);
}

/** A keymap as it is stored and shared: no provenance, since that is derived. */
export interface SavedKeymap {
  bindings: Binding[];
  fakeMeta: string | null;
  keysyms: { name: string; code: string }[];
  /** The game it was built against, for a warning when it is applied elsewhere. */
  gameName?: string;
}

export function toSaved(keymap: Keymap, gameName?: string): SavedKeymap {
  return {
    bindings: keymap.bindings.map(({ keys, action }) => ({ keys, action })),
    fakeMeta: keymap.state.fakeMeta,
    keysyms: keymap.state.keysyms,
    ...(gameName ? { gameName } : {}),
  };
}

/** Apply a saved keymap over the current target's baseline. */
export function fromSaved(saved: SavedKeymap, keymap: Keymap): Keymap {
  const baselineSource = new Map(keymap.baseline.map((b) => [key(b), b.source]));
  const bindings: ResolvedBinding[] = saved.bindings.map((b) => ({
    ...b,
    source: baselineSource.get(key(b)) ?? "user",
  }));
  return {
    ...keymap,
    bindings,
    state: {
      ...keymap.state,
      bindings: saved.bindings.map(({ keys, action }) => ({ keys, action })),
      fakeMeta: saved.fakeMeta,
      keysyms: saved.keysyms,
    },
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun run test src/content/keymap.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
bunx biome ci . && bun run typecheck
git add src/content/keymap.ts src/content/keymap.test.ts
git commit -m "Layer engine, game and player keybinds into one keymap (#1317)"
```

---

### Task 6: The keyboard

A keyboard drawn from data, labelled with the engine's own key names so a click produces a keyset the engine will parse. A test asserts every name in the layout is one the engine knows, which turns the labelling from a guess into a checked fact.

**Files:**
- Create: `src/content/keyboardLayout.ts`
- Create: `src/content/pages/components/KeyboardMap.tsx`
- Test: `src/content/keyboardLayout.test.ts`

**Interfaces:**
- Consumes: `ENGINE_KEY_NAMES` from `./engineKeybinds.generated`, plus `Keymap`, `ResolvedBinding`, `bindingsFor` and `conflictKeys` from `./keymap`.
- Produces:
  - `interface KeyCap { key: string; label: string; width?: number }`
  - `const KEYBOARD_ROWS: KeyCap[][]`
  - `type ModifierLayer = "" | "Shift+" | "Ctrl+" | "Alt+" | "Any+"`
  - `const MODIFIER_LAYERS: { id: ModifierLayer; label: string }[]`
  - `KeyboardMap({ keymap, layer, selected, onSelect })` where `onSelect` takes the full keyset string

- [ ] **Step 1: Write the layout**

Create `src/content/keyboardLayout.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test**

Create `src/content/keyboardLayout.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test**

Run: `bun run test src/content/keyboardLayout.test.ts`
Expected: PASS if every name above is right. If a name fails, look it up in `ENGINE_KEY_NAMES` in the generated file and correct the layout, not the test. The generated table is the engine's answer.

- [ ] **Step 4: Write the component**

Create `src/content/pages/components/KeyboardMap.tsx`. It renders `KEYBOARD_ROWS` as rows of buttons, each `flex-grow` weighted by `width ?? 1`, and takes props `{ keymap, layer, selected, onSelect }`.

For each cap the keyset is `` `${layer}${cap.key}` ``, and its bindings are `bindingsFor(keymap, keyset)`. State drives the tint through class names, with no new colours invented: unbound is `bg-muted/30 text-muted-foreground`, bound is `bg-card`, changed by the player (any binding with `source === "user"`) adds `border-primary/60`, and a keyset in `conflictKeys(keymap.bindings)` adds `ring-1 ring-amber-500/60`. The selected cap gets `ring-2 ring-primary`.

Each cap is a `<button type="button">` with the cap label as its visible text and `aria-pressed={keyset === selected}`. A cap with bindings shows the first action's command underneath in `text-[10px] text-muted-foreground truncate`, which is what makes the keyboard readable at a glance. Caps are at least `h-11`, comfortably over the 24 pixel minimum touch target.

The component is presentational: no data fetching, no writes, one `onSelect` callback.

- [ ] **Step 5: Lint and commit**

```bash
bunx biome ci . && bun run typecheck
git add src/content/keyboardLayout.ts src/content/keyboardLayout.test.ts src/content/pages/components/KeyboardMap.tsx
git commit -m "Draw the keymap on a keyboard (#1317)"
```

---

### Task 7: The Keybinds section

**Files:**
- Create: `src/content/pages/KeybindsSection.tsx`
- Create: `src/content/pages/components/KeyBindingEditor.tsx`
- Create: `src/content/pages/components/BindingList.tsx`
- Modify: `src/content/config.ts` (add `useKeybinds`)
- Modify: `src/content/index.ts` (import and register the section)

**Interfaces:**
- Consumes: everything from Tasks 3, 5 and 6, plus `useScanTargetSelection`, `useUnitsyncScan`, `useUnitsyncEngineConfig` and `useUnitsyncArchiveFile` from `../config`, and `BrowserToolbar`, `EmptyState`, `ErrorBanner` and `SkeletonList` from `./components/`.
- Produces:
  - `useKeybinds(configDir?: string)` in `config.ts`, returning `{ data, loading, error, reload, write }` where `data` is the `contentKeybindsRead` result and `write(text)` resolves to an error message or `null`
  - `default export KeybindsSection`

- [ ] **Step 1: Add the hook**

In `src/content/config.ts`, following the shape of `useUnitsyncEngineConfig`, add `useKeybinds`. It calls `contentKeybindsRead` when `configDir` is set, keeps `{ data, loading, error }` in state, exposes `reload`, and exposes `write(text)` which calls `contentKeybindsWrite`, refreshes `data` from the result, and returns an error string or `null`. No session cache: the file is small, and a stale keymap is worse than a re-read.

- [ ] **Step 2: Build the section**

Create `src/content/pages/KeybindsSection.tsx`. It composes, in order:

1. `BrowserToolbar` for the engine and root, from `useScanTargetSelection`.
2. A game picker, using `OptionSelect` from `src/uberstress/pages/components/OptionSelect.tsx`, over `useUnitsyncScan(selected?.enginePath, selected?.rootPath).data?.games`. It defaults to the `gameName` on the persisted draft from `src/play/drafts.ts` when that game is installed, and to the first game otherwise. The chosen game's archive is read with `useUnitsyncArchiveFile(enginePath, rootPath, archive, "uikeys.txt")` and its `text` is the game layer. A game that ships no such file simply has no game layer, which is the common case.
3. The file, through `useKeybinds(configDir)` where `configDir` is the directory of `useUnitsyncEngineConfig(...).data?.configPath`, falling back to `selected?.rootPath`.
4. `resolveKeymap({ gameText, userText })` into local state, held in a `useState` and reset by a `useEffect` when the inputs change, so edits survive re-renders but not a change of target.
5. `MODIFIER_LAYERS` as tabs, then `KeyboardMap`, then `KeyBindingEditor` for the selected keyset, then `BindingList`.
6. A footer with the file path, Save and Revert buttons, and the count of unsaved edits. Save calls `write(keymapText(keymap))`. Revert re-resolves from the layers. Save is disabled when there are no edits.
7. When `keymap.includes` is non-empty, a banner: this file loads another with `keyload`, which coilbox does not follow, so what is shown may be incomplete.
8. When `data?.exists && !data.ours`, a note that coilbox will keep a copy of the current file as `uikeys.txt.bak` the first time it saves.

Edits go through `addBinding`, `removeBinding` and `resetKeys` from `keymap.ts`. No component mutates a binding list itself.

Empty states: no engines found points at `/settings/content-folders` and `/settings/engines`, exactly as `EngineConfigPage` does.

- [ ] **Step 3: Build the key editor**

Create `src/content/pages/components/KeyBindingEditor.tsx`, the panel for one keyset. It lists `bindingsFor(keymap, keys)` with each action, its source as a badge (`from the game`, `engine default`, `you changed this`), and a remove button. Below that, an `Input` plus Add button to bind another action to this keyset, and a Reset button shown only when the keyset differs from the baseline.

The capture field is an `Input` that is `readOnly` with an `onKeyDown` that builds a keyset from the event and calls back with it: `event.ctrlKey` gives `Ctrl+`, `event.altKey` gives `Alt+`, `event.shiftKey` gives `Shift+`, `event.metaKey` gives `Meta+`, and the key itself comes from a small map of `event.key` to engine names (`Escape` to `esc`, `ArrowUp` to `up`, `ArrowDown` to `down`, `ArrowLeft` to `left`, `ArrowRight` to `right`, `PageUp` to `pageup`, `PageDown` to `pagedown`, a space to `space`, `Backspace` to `backspace`, `Enter` to `enter`, `Tab` to `tab`, `Delete` to `delete`, `Insert` to `insert`, `Home` to `home`, `End` to `end`, otherwise `event.key.toLowerCase()`). Call `event.preventDefault()` so Tab and Enter are captured rather than moving focus, and give the field a visible instruction that Escape binds Escape, with a separate Cancel button to leave.

- [ ] **Step 4: Build the list**

Create `src/content/pages/components/BindingList.tsx`. An `Input` filters by keys or action, case-insensitively. Rows show keys, action, source badge and a conflict badge when `conflictKeys` names that keyset, with remove and reset buttons. Sort by keys, then by the order within the keymap, so the resolution order of a multi-bound key is visible. Cap nothing: the list is a few hundred rows and filtering is enough.

Add a raw text view under a `Collapsible` (already vendored) showing `keymapText(keymap)` in a `<pre className="font-mono text-xs">`.

- [ ] **Step 5: Register the section**

In `src/content/index.ts`, import `KeybindsSection` and the `Keyboard` icon from `lucide-react`, and add between `engine-game` and `engine-profiles`:

```ts
    {
      id: "engine-keybinds",
      title: "Keybinds",
      description: "What every key does, on a keyboard you can click.",
      parent: "engine-settings",
      order: 55,
      icon: Keyboard,
      width: "lg",
      Component: KeybindsSection,
    },
```

- [ ] **Step 6: Check it in the running app**

Run: `bun run sidecar:unitsync && bun tauri dev`

The unitsync worker is a compiled binary, so a stale one shows stale data. Then open Settings > Engine Settings > Keybinds and confirm: the keyboard fills with engine defaults, clicking a key shows its actions, adding a binding marks it as yours, Save writes the file, and reopening the section shows the saved keymap. Check the file on disk starts with the coilbox header.

- [ ] **Step 7: Lint and commit**

```bash
bunx biome ci . && bun run typecheck && bun run test
git add src/content/pages/KeybindsSection.tsx src/content/pages/components/KeyBindingEditor.tsx src/content/pages/components/BindingList.tsx src/content/config.ts src/content/index.ts
git commit -m "Edit keybinds in settings (#1317)"
```

---

### Task 8: Saved keymaps and sharing

**Files:**
- Create: `src/content/pages/components/KeymapsPanel.tsx`
- Modify: `src/container/container.ts` (the kind union, the kinds list, the version map, `sniffPayloadKind`)
- Modify: `src/container/container.test.ts`
- Modify: `src/content/pages/KeybindsSection.tsx` (mount the panel)
- Modify: `crates/tauri-plugin-coilbox-content/src/lib.rs`, `build.rs`, `permissions/default.toml`, `src/content/bindings.ts` (the export command)

**Interfaces:**
- Consumes: `contentKeymaps`, `contentKeymapSave` and `contentKeymapDelete` from Task 4, `toSaved`, `fromSaved` and `SavedKeymap` from Task 5, then `encodeContainerJson`, `encodeContainerCode` and `parseContainer` from `src/container/container.ts`, and `contentImportContainer`.
- Produces: `KeymapsPanel({ rootPath, keymap, gameName, onApply })`, where `onApply` takes a `SavedKeymap`

- [ ] **Step 1: Add the container kind, with tests first**

In `src/container/container.test.ts`, add:

```ts
  it("round trips a keymap container", () => {
    const payload = {
      bindings: [{ keys: "Ctrl+q", action: "areaattack" }],
      fakeMeta: "space",
      keysyms: [],
      gameName: "Test Game",
    };
    const json = encodeContainerJson("keymap", 1, payload);
    const parsed = parseContainer(json);
    expect(parsed?.kind).toBe("keymap");
    expect(parsed?.kindVersion).toBe(1);
  });

  it("recognises a keymap by its shape", () => {
    expect(
      sniffPayloadKind({
        bindings: [{ keys: "a", action: "chat" }],
        fakeMeta: null,
        keysyms: [],
      }),
    ).toBe("keymap");
  });
```

Match the imports and helper names the existing test file uses. Run `bun run test src/container/container.test.ts` and watch it fail on the unknown kind.

- [ ] **Step 2: Add the kind**

In `src/container/container.ts`: add `| "keymap"` to `ContainerKind`, `"keymap"` to `CONTAINER_KINDS`, `keymap: 1` to `SUPPORTED_KIND_VERSIONS`, and to `sniffPayloadKind`, before the preset check:

```ts
  if (
    Array.isArray(p.bindings) &&
    Array.isArray(p.keysyms) &&
    (p.fakeMeta === null || typeof p.fakeMeta === "string")
  ) {
    return "keymap";
  }
```

Run the tests again and confirm they pass.

- [ ] **Step 3: Add the export command**

In `lib.rs`, beside `content_export_challenge`:

```rust
/// `content_export_keymap`, write a caller-serialized keymap container to a
/// caller-chosen path. Opaque, as the challenge export is: the frontend owns the
/// container format and picks the destination.
#[tauri::command]
async fn content_export_keymap(dest: String, text: String) -> Result<CliResult, ()> {
    Ok(match std::fs::write(&dest, text) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write keymap export: {e}")),
    })
}
```

Register it in `generate_handler!`, `build.rs` and `permissions/default.toml`, and add the binding to `src/content/bindings.ts`:

```ts
/** Write a serialised keymap container to a path the user picked. */
export const contentExportKeymap = defineCommand<
  { dest: string; text: string },
  Record<string, never>
>("coilbox-content", "content_export_keymap");
```

Import goes through the existing `content_import_container`, so there is no import command to add.

- [ ] **Step 4: Build the panel**

Create `src/content/pages/components/KeymapsPanel.tsx`, modelled on `ConfigProfilesPanel.tsx` and reusing its layout and copy conventions. It lists saved keymaps for the root, newest first, each with Apply, Export, Copy link and Delete. Above the list, an `Input` and a Save button save the current keymap under a name.

- Save: `contentKeymapSave({ rootPath, name, json: JSON.stringify(toSaved(keymap, gameName)) })`, then refresh the list.
- Apply: parse the stored `json` and call `onApply(saved)`, which the section turns into `fromSaved(saved, keymap)`. Applying does not write the file, it loads the keymap into the editor, so Save in the section footer stays the one thing that touches disk. When the saved keymap names a different game from the one selected, show a note under the row rather than blocking it.
- Export: `save()` dialog from `@tauri-apps/plugin-dialog` with a `.json` filter, then `contentExportKeymap({ dest, text: encodeContainerJson("keymap", 1, saved) })`.
- Copy link: `copyDeepLink(buildImportCodeLink(encodeContainerCode("keymap", 1, saved)))`, the same pair `SkirmishPage` uses for presets.
- Import: `open()` dialog, `contentImportContainer({ src })`, `parseContainer(json)`, reject anything whose kind is not `keymap` with a plain message, then `onApply`.

- [ ] **Step 5: Mount it**

In `KeybindsSection.tsx`, render `KeymapsPanel` below the binding list when a root is selected, passing the current keymap, the selected game's name, and an `onApply` that sets state to `fromSaved(saved, keymap)`.

- [ ] **Step 6: Check it in the running app**

Run: `bun tauri dev`

Save a keymap, change a binding, apply the saved one and confirm the change comes back. Export to a file, import it again, and confirm the same bindings arrive. Copy the link and confirm it reaches the clipboard. Note that macOS refuses clipboard reads outside a user gesture, so test the copy from a real click.

- [ ] **Step 7: Lint and commit**

```bash
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
bunx biome ci . && bun run typecheck && bun run test
git add src/content/pages/components/KeymapsPanel.tsx src/container/container.ts src/container/container.test.ts src/content/pages/KeybindsSection.tsx src/content/bindings.ts crates/tauri-plugin-coilbox-content/src/lib.rs crates/tauri-plugin-coilbox-content/build.rs crates/tauri-plugin-coilbox-content/permissions/default.toml
git commit -m "Save, apply and share keymaps (#1317)"
```

---

## After the tasks

Run the full lint suite once more before the PR, because CI compiles the Tauri app crate and a per-crate clippy misses it:

```bash
bun run sidecar:unitsync
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
bunx biome ci .
bun run typecheck
bun run test
```

Then offer a `bun tauri dev` run before opening the PR, and offer to clean build artefacts afterwards.
