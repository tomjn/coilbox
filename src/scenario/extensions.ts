/**
 * The condition and action types a game declares for itself, read out of its
 * `missions/extensions.lua`.
 *
 * A game with systems coilbox has never heard of, such as Splinter Faction's
 * research points, a weather model or a faction chooser, declares trigger types
 * for them and implements them in Lua of its own. The runtime dispatches a
 * trigger naming one to that code
 * (`luarules/mission_runtime/coilbox_extensions.lua`), and this is the other
 * half: the same file read by the editor, so the types are in the palette with a
 * form for their parameters.
 *
 * The declaration is written by a game developer by hand, so everything here
 * takes it as untrusted and says what it dropped rather than throwing. A
 * declaration that is half wrong should cost the game the half that is wrong.
 *
 * Two rules decide what is kept, and they are the same two the runtime enforces
 * at load, so the palette offers what the game will actually run:
 *
 * - An extension adds a game concept, never an engine one. A type coilbox's own
 *   tables declare, or the game's installed runtime declares, is refused.
 * - A parameter has to say enough to draw a field. A `kind` this build has no
 *   control for takes the whole type down with it, because a form with a hole in
 *   it writes documents that will not load.
 *
 * Arithmetic on plain values, so it is tested without a browser.
 */

import {
  ACTION_TYPES,
  CONDITION_TYPES,
  PARAM_KINDS,
  type ParamKind,
  type ParamSpec,
  type TypeSpec,
} from "./triggerTypes";

/** One type a game declares: what it is called, and what it takes. */
export interface ExtensionType {
  /** The type name, which is what a trigger step stores and the runtime
   *  dispatches on. */
  type: string;
  /** What the palette calls it. The declaration's `label`, or the type name
   *  read the way a built-in one is when it names none. */
  label: string;
  /** One line under the label in the palette, when the game wrote one. */
  description?: string;
  /** The parameters, in the order the game declared them, which is the order
   *  the form draws them. */
  spec: TypeSpec;
}

/** Everything a game's declaration adds, and everything it got wrong. */
export interface ExtensionTypes {
  conditions: Record<string, ExtensionType>;
  actions: Record<string, ExtensionType>;
  /** What was dropped and why, in declaration order. Shown to the author,
   *  because the game developer is not the person editing the scenario. */
  problems: string[];
}

/** A game that declares nothing, which is nearly every game. */
export const NO_EXTENSIONS: ExtensionTypes = {
  conditions: {},
  actions: {},
  problems: [],
};

/** Whether a game declares anything at all. */
export function hasExtensions(types: ExtensionTypes): boolean {
  return (
    Object.keys(types.conditions).length > 0 ||
    Object.keys(types.actions).length > 0
  );
}

const KINDS = new Set<string>(PARAM_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** One declared parameter, or why it cannot be drawn. */
function readParam(
  raw: unknown,
): { name: string; spec: ParamSpec } | { error: string } {
  if (!isRecord(raw)) return { error: "a parameter that is not a table" };
  const name = raw.name;
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "a parameter with no name" };
  }
  const kind = raw.kind;
  if (typeof kind !== "string" || !KINDS.has(kind)) {
    return { error: `parameter ${name} has no kind coilbox knows: ${kind}` };
  }
  const spec: ParamSpec = { kind: kind as ParamKind };
  if (raw.optional === true) spec.optional = true;
  if (kind === "enum") {
    const values = asList(raw.values).filter(
      (v): v is string => typeof v === "string",
    );
    if (values.length === 0) {
      return { error: `parameter ${name} is an enum with no values` };
    }
    spec.values = values;
  }
  return { name, spec };
}

/** One declared type, or why it was dropped. */
function readType(
  raw: unknown,
  reserved: Set<string>,
  taken: Set<string>,
): ExtensionType | { error: string } {
  if (!isRecord(raw)) return { error: "an entry that is not a table" };
  const type = raw.type;
  if (typeof type !== "string" || type.trim() === "") {
    return { error: "an entry with no type name" };
  }
  if (reserved.has(type)) {
    return {
      error: `${type} is the runtime's own type, which an extension may not redefine`,
    };
  }
  if (taken.has(type)) return { error: `${type} is declared twice` };

  const spec: TypeSpec = {};
  for (const entry of asList(raw.params)) {
    const param = readParam(entry);
    if ("error" in param) return { error: `${type}: ${param.error}` };
    spec[param.name] = param.spec;
  }

  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";
  return {
    type,
    label: label || type,
    ...(description ? { description } : {}),
    spec,
  };
}

/**
 * A game's declaration, as the editor uses it.
 *
 * `raw` is whatever `missions/extensions.lua` evaluated to, straight off the
 * plugin, or null for a game that declares nothing.
 *
 * `owned` is the type names the target runtime already owns beyond coilbox's own
 * tables, which is what the installed `missions/runtime.lua` declares. A game
 * running a runtime ahead of this build owns types coilbox has no table for, and
 * those are still not an extension's to redefine.
 */
export function parseExtensions(
  raw: unknown,
  owned: readonly string[] = [],
): ExtensionTypes {
  if (!isRecord(raw)) return NO_EXTENSIONS;

  const reserved = new Set<string>([
    ...Object.keys(CONDITION_TYPES),
    ...Object.keys(ACTION_TYPES),
    ...owned,
  ]);
  const taken = new Set<string>();
  const problems: string[] = [];
  const out: ExtensionTypes = { conditions: {}, actions: {}, problems };

  for (const list of ["conditions", "actions"] as const) {
    for (const entry of asList(raw[list])) {
      const read = readType(entry, reserved, taken);
      if ("error" in read) {
        problems.push(read.error);
        continue;
      }
      taken.add(read.type);
      out[list][read.type] = read;
    }
  }
  return out;
}

/** The parameter tables of a declared list, keyed by type name, which is the
 *  shape the palette merges with coilbox's own. */
export function extensionSpecs(
  types: Record<string, ExtensionType>,
): Record<string, TypeSpec> {
  const out: Record<string, TypeSpec> = {};
  for (const [type, declared] of Object.entries(types)) {
    out[type] = declared.spec;
  }
  return out;
}
