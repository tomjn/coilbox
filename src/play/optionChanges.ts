import type { ConfigOption } from "@/content/bindings";
import type { DecodedSlot } from "@/workshop/decodeTweakSet";
import { isTweakSlotKey } from "@/workshop/deliveryRoutes";
import {
  defaultLabel,
  effectiveValue,
  isChanged,
  sameOptionValue,
  valueLabel,
} from "./modOptions";

/**
 * What a preset changes, worked out by comparing rather than by trusting what
 * the preset stores. A preset can hold a value equal to the game's default
 * (`sparseOptions` only runs when one is made from a replay), so a stored key is
 * not a change until it differs from the declared default, and "1" for a bool
 * whose default is "true" does not differ.
 *
 * Pure, so the comparison is tested without rendering.
 */

/** One declared option that the preset sets to something other than its default. */
export interface OptionChange {
  key: string;
  name: string;
  /** The preset's value, as a reader would say it. */
  value: string;
  /** The declared default, as a reader would say it. */
  defaultValue: string;
  /** How the setup it would replace compares. Absent when the two cannot be
   *  compared, which is when the preset is for another game or map. */
  current?: { value: string; same: boolean };
}

/** A stored option the game or map does not declare, with its raw value. */
export interface UndeclaredOption {
  key: string;
  value: string;
}

export type OptionChanges =
  /** The schema is unread, failed or not installed, so nothing can be said. */
  | { status: "unavailable" }
  | {
      status: "read";
      changes: OptionChange[];
      undeclared: UndeclaredOption[];
    };

/** The case-folded view of a values map: SPADS lowercases what it sets. */
function lowered(values: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
}

/**
 * The options among `presetValues` that differ from their declared default,
 * and the keys the schema does not declare.
 *
 * `schema` is undefined for a game or map not read, which is "unavailable"
 * rather than "every value is a change". `currentValues` is the setup the
 * preset would replace, or undefined when it belongs to a different game or map
 * and its keys mean something else.
 */
export function optionChanges(
  schema: ConfigOption[] | undefined,
  presetValues: Record<string, string>,
  currentValues?: Record<string, string>,
): OptionChanges {
  if (!schema) return { status: "unavailable" };
  const stored = lowered(presetValues);
  const now = currentValues ? lowered(currentValues) : undefined;

  const changes: OptionChange[] = [];
  const declared = new Set<string>();
  for (const o of schema) {
    if (o.type === "section") continue;
    const key = o.key.toLowerCase();
    declared.add(key);
    const value = stored.get(key);
    if (value === undefined || !isChanged(o, value)) continue;
    const change: OptionChange = {
      key: o.key,
      name: o.name || o.key,
      value: valueLabel(o, value),
      defaultValue: defaultLabel(o),
    };
    if (now) {
      const currentValue = effectiveValue(o, now.get(key)) ?? "";
      change.current = {
        value: valueLabel(o, currentValue),
        same: sameOptionValue(o, value, currentValue),
      };
    }
    changes.push(change);
  }

  const undeclared = Object.entries(presetValues)
    .filter(([key]) => !declared.has(key.toLowerCase()))
    .map(([key, value]) => ({ key, value }));
  return { status: "read", changes, undeclared };
}

/** A preset's mod options without its tweak slots, which have their own part. */
export function plainOptionValues(
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !isTweakSlotKey(key)),
  );
}

/** A preset's tweak slots, empty ones left out because they carry nothing. */
export function tweakSlotValues(
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => isTweakSlotKey(key) && value.trim() !== "",
    ),
  );
}

/** One field a tweak sets on a unit, as a path through nested tables. */
export interface TweakField {
  path: string;
  value: string;
}

export interface TweakUnit {
  unit: string;
  fields: TweakField[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fieldValue(v: unknown): string {
  return typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
}

function flatten(def: unknown, prefix: string): TweakField[] {
  if (!isPlainObject(def)) return [{ path: prefix, value: fieldValue(def) }];
  const entries = Object.entries(def);
  if (entries.length === 0) return [{ path: prefix, value: "{}" }];
  return entries.flatMap(([key, value]) =>
    isPlainObject(value) && Object.keys(value).length > 0
      ? flatten(value, `${prefix}${key}.`)
      : [{ path: `${prefix}${key}`, value: fieldValue(value) }],
  );
}

/**
 * The units a decoded data table changes and the fields it sets on each, with
 * nested tables (weapons, say) written as dotted paths. Null for a slot that
 * did not decode to a table: a program, an unrecognised shape or an error.
 */
export function tweakSlotUnits(slot: DecodedSlot): TweakUnit[] | null {
  if (slot.error || slot.form !== "table" || !slot.table) return null;
  return Object.entries(slot.table).map(([unit, def]) => ({
    unit,
    fields: isPlainObject(def)
      ? flatten(def, "").filter((f) => f.path !== "")
      : [{ path: "", value: fieldValue(def) }],
  }));
}
