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
  const baselineSource = new Map(
    keymap.baseline.map((b) => [key(b), b.source]),
  );
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
