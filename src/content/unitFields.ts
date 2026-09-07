/**
 * What a unit or weapon definition field is, and what we can say about it.
 *
 * The list of fields is not written here. It is generated from RecoilEngine's
 * own parsers into `engineUnitFields.generated.ts`, because a hand-kept list is
 * only ever as complete as somebody's memory. This module is the two things a
 * generator cannot supply: the human overlay of labels, units of measure and
 * help text, and a lookup that answers for a key the engine has never heard of
 * so a game is never limited to the fields we described.
 *
 * Sections are dotted paths. `collisionVolume.type` is the `type` key inside a
 * def's `collisionVolume` table, and `*` stands for an array index, so a unit's
 * third weapon mount is `weapons.*.mainDir`.
 */
import {
  ENGINE_OPEN_TABLES,
  ENGINE_UNIT_FIELDS,
  ENGINE_WEAPON_FIELDS,
} from "./engineUnitFields.generated";
import { UNIT_FIELD_NOTES, WEAPON_FIELD_NOTES } from "./unitFieldNotes";

/** The engine getter a field is read with, which is what constrains its type. */
export type EngineFieldType =
  | "any"
  | "boolean"
  | "float3"
  | "float4"
  | "integer"
  | "number"
  | "string"
  | "table";

/** One key the engine reads, as its parser declares it. */
export interface EngineField {
  /** The key as written in the definition, not the engine's C++ member name. */
  key: string;
  type: EngineFieldType;
  /** Dotted path of the table this key sits in, empty for the def root. */
  section: string;
  /** Defaults verbatim from the C++. More than one means it depends on context. */
  defaults: string[];
  /** Keys the engine reads instead when this one is absent, oldest last. */
  fallsBackTo: string[];
  /** Every `file:line` the engine reads this key at. */
  sources: string[];
  /** The engine's own help text. Only weapon tags carry one. */
  description?: string;
  minimum?: string;
  maximum?: string;
  scale?: string;
}

/** A read whose key the engine builds at runtime, so no key could be taken. */
export interface UnparsedRead {
  where: string;
  call: string;
}

/**
 * The hand-written half. A note may add to a generated field but never replace
 * its key, type or default, so it cannot quietly contradict the engine.
 */
export interface FieldNote {
  /** What to call the field in the interface. */
  label: string;
  /** Unit of measure, as the engine means it. */
  unit?: string;
  /** What the field does, in the reader's terms. */
  help?: string;
}

export type DefKind = "unit" | "weapon";

/** A field ready to render, whether or not the engine has heard of it. */
export interface ResolvedField {
  /** The full dotted path asked for. */
  path: string;
  /** The key on its own. */
  key: string;
  /** False when only the game declares this key, so render it as a raw row. */
  known: boolean;
  label: string;
  type: EngineFieldType;
  unit?: string;
  help?: string;
  /** The default, when it is a single literal the engine writes down. */
  default?: string | number | boolean;
  engine?: EngineField;
}

const joinPath = (section: string, key: string) =>
  section === "" ? key : `${section}.${key}`;

const REGISTRIES: Record<DefKind, EngineField[]> = {
  unit: ENGINE_UNIT_FIELDS,
  weapon: ENGINE_WEAPON_FIELDS,
};

const NOTES: Record<DefKind, Record<string, FieldNote>> = {
  unit: UNIT_FIELD_NOTES,
  weapon: WEAPON_FIELD_NOTES,
};

const INDEX: Record<DefKind, Map<string, EngineField>> = {
  unit: new Map(ENGINE_UNIT_FIELDS.map((f) => [joinPath(f.section, f.key), f])),
  weapon: new Map(
    ENGINE_WEAPON_FIELDS.map((f) => [joinPath(f.section, f.key), f]),
  ),
};

/** Every field the engine declares for this kind of definition. */
export function engineFields(kind: DefKind): EngineField[] {
  return REGISTRIES[kind];
}

/** Tables the engine reads whole, so a game may put any key inside them. */
export function openTables(kind: DefKind): string[] {
  return ENGINE_OPEN_TABLES[kind];
}

/** Replace array indices with `*`, so `weapons.3.mainDir` finds its field. */
export function normaliseFieldPath(path: string): string {
  return path
    .split(".")
    .map((part) => (/^\d+$/.test(part) ? "*" : part))
    .join(".");
}

const CPP_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?f?$/;

/**
 * The single default the engine falls back to, as a JS value. Undefined when
 * the engine writes a named constant or an expression, or when the default
 * depends on which branch of the parser runs.
 */
export function defaultValue(
  field: EngineField,
): string | number | boolean | undefined {
  if (field.defaults.length !== 1) return undefined;
  const raw = field.defaults[0];
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(raw);
  if (quoted) return quoted[1];
  const char = /^'(.)'$/.exec(raw);
  if (char) return char[1];
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (CPP_NUMBER.test(raw)) return Number.parseFloat(raw);
  return undefined;
}

/**
 * Describe a field for rendering. A key the engine does not declare still comes
 * back, marked unknown, so the page shows it as a raw key and value rather than
 * dropping it.
 */
export function describeField(kind: DefKind, path: string): ResolvedField {
  const normalised = normaliseFieldPath(path);
  const engine = INDEX[kind].get(normalised);
  const note = NOTES[kind][normalised];
  const key = normalised.split(".").at(-1) ?? normalised;
  if (!engine) {
    return {
      path: normalised,
      key,
      known: false,
      label: note?.label ?? key,
      type: "any",
      unit: note?.unit,
      help: note?.help,
    };
  }
  return {
    path: normalised,
    key: engine.key,
    known: true,
    label: note?.label ?? engine.key,
    type: engine.type,
    unit: note?.unit,
    help: note?.help ?? engine.description,
    default: defaultValue(engine),
    engine,
  };
}
