/**
 * A unit's weapons, one slot at a time, with each field written where the
 * engine reads it (issue #2639).
 *
 * A unit names its weapons in `weapons`, one entry per slot, and each entry
 * names a weapon definition. Some fields belong to the slot and the rest to the
 * definition, and the two live in different tables:
 *
 * - The slot is the unit's own `weapons[n]` entry. RecoilEngine reads eleven
 *   keys from it, all in `UnitDefWeapon`'s constructor and
 *   `UnitDef::ParseWeaponsTable` in `rts/Sim/Units/UnitDef.cpp`: `name`,
 *   `slaveTo`, `maxAngleDif`, `badTargetCategory`, `onlyTargetCategory`,
 *   `mainDir`, `weaponAimAdjustPriority`, `fastAutoRetargeting`,
 *   `fastQueryPointUpdate`, `burstControlWhenOutOfArc` and `accurateLeading`.
 *   The field registry already carries exactly those as `weapons.*`, generated
 *   from that file, so this module takes the list from there rather than
 *   writing it out a second time.
 * - The definition is everything else a weapon is: damage, range, reload.
 *
 * A definition a unit carries itself sits in its own `weapondefs` table under
 * a short name. The base content's `gamedata/weapondefs_post.lua` copies each
 * one into the game's shared table as `<unit>_<name>` and points the slot at
 * that. So `armcom_armcomlaser` in a slot is `weapondefs.armcomlaser` on
 * `armcom`, and a second unit that also calls its weapon `armcomlaser` has a
 * definition of its own. An edit to one is an edit to that unit alone, which
 * is why a definition field here is an override on the unit, written into its
 * own `weapondefs`, the same as any other field.
 *
 * A slot can also name a definition the unit does not carry, out of the
 * game's `weapons/` folder or out of another unit. That definition is shared,
 * and changing it for one unit takes copying it into that unit first: into the
 * project's weapon library, equipped into the slot (issues #2640 and #3052,
 * `weaponLibrary.ts`). Until then those fields are shown and not offered.
 */

import { WEAPON_FIELD_NOTES } from "@/content/unitFieldNotes";
import {
  describeField,
  engineFields,
  normaliseFieldPath,
  type ResolvedField,
} from "@/content/unitFields";
import { fieldState, readPath, type UnitOverrides } from "./overrides";
import type {
  FieldRow,
  FieldView,
  RenderedGroup,
  RenderedSection,
} from "./unitSections";
import type { LibraryWeapon } from "./weaponLibrary";
import type { SupportingDef } from "./weaponRefs";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The key a def spells `name` under, however it spells it. */
const findKey = (
  table: Record<string, unknown>,
  lower: string,
): string | undefined =>
  Object.keys(table).find((key) => key.toLowerCase() === lower);

/** Which definition a slot's weapon is, and where its fields are written. */
export type SlotDefinition =
  /** One the unit carries in its own `weapondefs`. `path` is where its
   *  fields are written, in the def's own spelling: `weapondefs.armcomlaser`. */
  | {
      kind: "own";
      key: string;
      path: string;
      def: Record<string, unknown>;
    }
  /** One out of the game's shared table, which the unit does not carry. */
  | { kind: "shared"; key: string; def: Record<string, unknown> }
  /** One nothing in the game defines, which the engine skips. */
  | { kind: "missing" };

/** One of a unit's weapon slots. */
export interface WeaponSlot {
  /** The step under `weapons` in a field path: the list position counted
   *  from zero, or the Lua key itself for a list with a gap (issue #3041). */
  step: string;
  /** The number the game's own file gives the weapon, counting from one. */
  number: number;
  /** Where the slot's own fields are written, `weapons.0` in the def's spelling. */
  path: string;
  /** The weapon name the slot holds, as the def holds it. */
  name: string;
  /** The slot's own table. Absent for a slot written as a bare name, which
   *  has nowhere to put a field without losing the name. */
  table: Record<string, unknown> | undefined;
  definition: SlotDefinition;
}

/**
 * Which of the unit's own definitions a slot name means.
 *
 * The name a slot holds after `weapondefs_post.lua` is `<unit>_<short name>`,
 * so the prefix is taken off before the unit's own table is asked. `owners` is
 * every unit name the prefix can be: the unit itself, and for a copy the unit
 * it was copied from, since the copy's slots still say the source's name.
 */
function ownDefinitionKey(
  name: string,
  own: Record<string, unknown>,
  owners: string[],
): string | undefined {
  const lower = name.toLowerCase();
  const byLower = new Map(Object.keys(own).map((k) => [k.toLowerCase(), k]));
  const direct = byLower.get(lower);
  if (direct !== undefined) return direct;
  for (const owner of owners) {
    const prefix = `${owner.toLowerCase()}_`;
    if (!lower.startsWith(prefix)) continue;
    const found = byLower.get(lower.slice(prefix.length));
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Every weapon slot a unit's definition declares, in the file's own order.
 *
 * `shared` is the game's own table of every weapon definition, keyed by
 * lowercased name, which is how the engine looks one up. `owners` is every name
 * a slot's prefix can use to mean this unit's own table, for the reason
 * {@link ownDefinitionKey} gives.
 *
 * An entry that names no weapon is left out, because the engine skips it too.
 */
export function weaponSlots(
  def: Record<string, unknown> | undefined,
  shared: Record<string, Record<string, unknown>>,
  owners: string[],
): WeaponSlot[] {
  if (!def) return [];
  const weaponsKey = findKey(def, "weapons");
  const list = weaponsKey === undefined ? undefined : def[weaponsKey];
  if (weaponsKey === undefined || list === null || typeof list !== "object")
    return [];

  const defsKey = findKey(def, "weapondefs");
  const ownRaw = defsKey === undefined ? undefined : def[defsKey];
  const own = isPlainObject(ownRaw) ? ownRaw : {};

  // A list the worker read as an array is numbered 1 to n in the file, and a
  // list with a gap in it came across as an object keyed by those numbers.
  const entries: { step: string; number: number; value: unknown }[] =
    Array.isArray(list)
      ? list.map((value, i) => ({ step: String(i), number: i + 1, value }))
      : Object.keys(list)
          .filter((key) => /^\d+$/.test(key))
          .map((key) => ({
            step: key,
            number: Number(key),
            value: (list as Record<string, unknown>)[key],
          }))
          .sort((a, b) => a.number - b.number);

  const slots: WeaponSlot[] = [];
  for (const { step, number, value } of entries) {
    const table = isPlainObject(value) ? value : undefined;
    const nameKey = table ? findKey(table, "name") : undefined;
    const raw =
      typeof value === "string"
        ? value
        : table && nameKey !== undefined
          ? table[nameKey]
          : undefined;
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name) continue;

    const ownKey = ownDefinitionKey(name, own, owners);
    const ownDef = ownKey === undefined ? undefined : own[ownKey];
    const sharedDef = shared[name.toLowerCase()];
    const definition: SlotDefinition =
      ownKey !== undefined && isPlainObject(ownDef) && defsKey !== undefined
        ? {
            kind: "own",
            key: ownKey,
            path: `${defsKey}.${ownKey}`,
            def: ownDef,
          }
        : isPlainObject(sharedDef)
          ? { kind: "shared", key: name.toLowerCase(), def: sharedDef }
          : { kind: "missing" };

    slots.push({
      step,
      number,
      path: `${weaponsKey}.${step}`,
      name,
      table,
      definition,
    });
  }
  return slots;
}

/**
 * How many units in the game mount a shared definition, so the page can say
 * what a change to it would reach. Counted off the game's own table, so a unit
 * that carries a definition of the same short name is not counted.
 */
export function unitsMounting(
  units: Record<string, Record<string, unknown>>,
  shared: Record<string, Record<string, unknown>>,
  name: string,
): number {
  const lower = name.toLowerCase();
  let count = 0;
  for (const [key, def] of Object.entries(units)) {
    if (
      weaponSlots(def, shared, [key]).some(
        (slot) =>
          slot.definition.kind === "shared" && slot.definition.key === lower,
      )
    )
      count += 1;
  }
  return count;
}

/** The paths a slot or its definition owns, for counting what was changed. */
export function slotPaths(slot: WeaponSlot): string[] {
  return slot.definition.kind === "own"
    ? [slot.path, slot.definition.path]
    : [slot.path];
}

/** How many of the project's edits to a unit belong to one slot. */
export function slotEditCount(
  slot: WeaponSlot,
  overrides: UnitOverrides,
  unitKey: string,
): number {
  const prefixes = slotPaths(slot).map((p) => `${p.toLowerCase()}.`);
  return Object.keys(overrides[unitKey] ?? {}).filter((path) =>
    prefixes.some((prefix) => path.toLowerCase().startsWith(prefix)),
  ).length;
}

// The slot fields, straight out of the unit registry, in the order a reader
// wants them: what it is, where it points, what it shoots at, then the tuning
// flags. `name` is only drawn when the project already changed it: changing
// which weapon a slot holds is equipping a different weapon out of the
// project's library (issue #2640).
const SLOT_ORDER = [
  "name",
  "slaveTo",
  "mainDir",
  "maxAngleDif",
  "onlyTargetCategory",
  "badTargetCategory",
  "weaponAimAdjustPriority",
  "accurateLeading",
  "fastAutoRetargeting",
  "fastQueryPointUpdate",
  "burstControlWhenOutOfArc",
];

/** The slot keys the engine reads, lowercased to the registry's spelling. */
const SLOT_KEYS = new Map(
  engineFields("unit")
    .filter((f) => f.section === "weapons.*")
    .map((f) => [f.key.toLowerCase(), f.key] as const),
);

const WEAPON_PATHS = engineFields("weapon").map((f) =>
  f.section === "" ? f.key : `${f.section}.${f.key}`,
);
/** Lowercased weapon registry path to the registry's own spelling. */
const WEAPON_CANONICAL = new Map(
  WEAPON_PATHS.map((path) => [path.toLowerCase(), path] as const),
);
const WEAPON_PATHS_LOWER = [...WEAPON_CANONICAL.keys()];
/** A weapon registry path with others nested below it, such as `damage`. */
const WEAPON_CONTAINERS = new Set(
  WEAPON_PATHS_LOWER.filter((path) =>
    WEAPON_PATHS_LOWER.some((other) => other.startsWith(`${path}.`)),
  ),
);
/** The order the weapon notes are written in, which puts the numbers a
 *  person comes for first: name, type, range, reload, burst, speed. */
const NOTE_ORDER = new Map(
  Object.keys(WEAPON_FIELD_NOTES).map((key, i) => [key.toLowerCase(), i]),
);

/**
 * Which definition keys are walked into rather than drawn as one row.
 *
 * A registry container, such as `shield`, whose keys the engine reads one at
 * a time. `customParams`, for the reason `unitSections.ts` gives. And
 * `damage`, which the engine reads whole because its keys are armour class
 * names the game makes up, but which is the one table on a weapon somebody
 * came to edit: a number per class, each a field in its own right.
 */
function walksInto(leaf: string): boolean {
  const lower = leaf.toLowerCase();
  const prefix = `${normaliseFieldPath(lower)}.`;
  return (
    lower === "customparams" ||
    lower === "damage" ||
    WEAPON_PATHS_LOWER.some((path) => path.startsWith(prefix))
  );
}

/** Every leaf a weapon definition declares, relative to the definition. */
function definitionLeaves(def: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (leaf: string, value: unknown) => {
    if (typeof value === "object" && value !== null && walksInto(leaf)) {
      for (const key of Object.keys(value))
        walk(`${leaf}.${key}`, (value as Record<string, unknown>)[key]);
      return;
    }
    out.push(leaf);
  };
  for (const key of Object.keys(def)) walk(key, def[key]);
  return out;
}

/**
 * What a definition field is.
 *
 * A step of digits under an array is the array position counted from zero,
 * while the registry names the Lua key: weapon textures are keys 1 to 4, and
 * the worker hands a table numbered 1 to n over as an array. So the position
 * is tried as the Lua key it stands for first.
 *
 * A key inside `damage` other than `default` is an armour class the game
 * named, which the engine does read, so it is described here rather than
 * marked as a key only the game's Lua reads.
 */
export function describeLeaf(
  leaf: string,
  def: Record<string, unknown>,
): ResolvedField {
  const parts = leaf.split(".");
  const oneBased = parts
    .map((part, i) => {
      if (!/^\d+$/.test(part)) return part;
      const parent = readPath(def, parts.slice(0, i).join("."));
      return Array.isArray(parent) ? String(Number(part) + 1) : part;
    })
    .join(".");
  const canonical = (path: string) =>
    WEAPON_CANONICAL.get(path.toLowerCase()) ?? path;
  const literal = describeField("weapon", canonical(oneBased));
  if (literal.known) return literal;
  const field = describeField("weapon", canonical(leaf));
  if (field.known || parts.length !== 2 || parts[0].toLowerCase() !== "damage")
    return field;
  return {
    ...field,
    known: true,
    described: true,
    label: `Damage against ${parts[1]}`,
    type: "number",
    help: `Damage dealt to a unit whose armour class is ${parts[1]}. The default entry covers every class the weapon does not name.`,
  };
}

/** Where a definition field is drawn on the page. */
const DEFINITION_SECTIONS: { id: string; label: string }[] = [
  { id: "damage", label: "Damage" },
  { id: "weapon", label: "Weapon" },
  { id: "shield", label: "Shield" },
  { id: "textures", label: "Textures" },
  { id: "customParams", label: "Custom parameters" },
  { id: "game", label: "Fields only this game declares" },
];

function definitionSection(leaf: string, field: ResolvedField): string {
  const head = leaf.split(".")[0].toLowerCase();
  if (head === "customparams") return "customParams";
  if (head === "damage") return "damage";
  if (!field.known) return "game";
  if (head === "shield") return "shield";
  if (head === "textures") return "textures";
  return "weapon";
}

/** One slot and its definition, grouped for drawing. */
export interface WeaponSlotView {
  groups: RenderedGroup[];
  /** The library weapon the slot fires instead of the game's, when the
   *  project equipped one (issue #2640). */
  library?: RenderedGroup;
  /** How many fields are drawn. */
  shown: number;
  /** How many the "all" view would add. */
  hidden: number;
}

/** Row order inside a section: a known order first, then by label. */
function sortRows(rows: FieldRow[], rank: (row: FieldRow) => number) {
  rows.sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return a.label.localeCompare(b.label);
  });
}

/** The overrides under one path prefix, as paths relative to it. */
function overriddenBelow(
  overrides: UnitOverrides,
  unitKey: string,
  prefix: string,
): string[] {
  const lower = `${prefix.toLowerCase()}.`;
  return Object.keys(overrides[unitKey] ?? {})
    .filter((path) => path.toLowerCase().startsWith(lower))
    .map((path) => path.slice(lower.length));
}

/** Leaves as the def spells them, keyed by lowercase so one field is one row. */
function mergeLeaves(...lists: string[][]): string[] {
  const out = new Map<string, string>();
  for (const list of lists)
    for (const leaf of list)
      if (!out.has(leaf.toLowerCase())) out.set(leaf.toLowerCase(), leaf);
  return [...out.values()];
}

function slotGroup(
  slot: WeaponSlot,
  overrides: UnitOverrides,
  unitKey: string,
  view: FieldView,
): { group: RenderedGroup; relevant: number; all: number } {
  const table = slot.table ?? {};
  const present = slot.table
    ? Object.keys(table).filter((key) => key.toLowerCase() !== "name")
    : [];
  const edited = overriddenBelow(overrides, unitKey, slot.path);
  // A slot written as a bare name has nowhere to hold a field, so it offers
  // none: writing one would turn the name into a table and lose it.
  const extra = slot.table
    ? [...SLOT_KEYS.values()].filter((key) => key !== "name")
    : [];
  const relevantLeaves = mergeLeaves(present, edited);
  const allLeaves = mergeLeaves(present, edited, extra);
  const leaves = view === "all" ? allLeaves : relevantLeaves;

  const rows = leaves.map((leaf): FieldRow => {
    const path = `${slot.path}.${leaf}`;
    const key = SLOT_KEYS.get(leaf.toLowerCase()) ?? leaf;
    const field = describeField("unit", `weapons.*.${key}`);
    const isPresent = slot.table !== undefined && Object.hasOwn(table, leaf);
    const inherited = isPresent ? table[leaf] : field.default;
    const state = fieldState(overrides, unitKey, path);
    return {
      path,
      field,
      label: field.label,
      present: isPresent,
      inherited,
      value: state === "overridden" ? overrides[unitKey]?.[path] : inherited,
      state,
    };
  });
  const order = (row: FieldRow) => {
    const at = SLOT_ORDER.indexOf(row.field.key);
    return at < 0 ? SLOT_ORDER.length : at;
  };
  sortRows(rows, order);

  return {
    group: {
      id: "slot",
      label: `Weapon ${slot.number} mount`,
      note: slot.table
        ? `Where weapon ${slot.number} sits on this unit and what it aims at. These fields belong to the unit's own weapon list, not to the weapon.${rows.length === 0 ? " This slot sets none of them, and All lists every one." : ""}`
        : `This slot names its weapon and nothing else, so it has no mount fields to change.`,
      sections: rows.length > 0 ? [{ id: "slot", label: "Mount", rows }] : [],
    },
    relevant: relevantLeaves.length,
    all: allLeaves.length,
  };
}

/**
 * A weapon definition's fields, in the sections the page draws them in.
 *
 * `patch` is the sparse set of changes the fields are read against, keyed by
 * `prefix` and the field's own path, and `prefix` is empty for a definition
 * whose changes are keyed by the field alone, which is a library weapon's
 * (issue #2640). A definition nobody can edit reads nothing from it.
 *
 * `focus` narrows the relevant view to the fields a use of the definition is
 * about, drawn whether the definition sets them or not, which is how a death
 * explosion is shown (issue #2642). Registry paths, and `damage` for every row
 * of the damage table. A field it leaves unset shows the value the engine
 * falls back on, read off the definition, where the registry names one.
 */
export function definitionSections(
  def: Record<string, unknown>,
  patch: Record<string, unknown>,
  prefix: string,
  view: FieldView,
  editable: boolean,
  focus?: readonly string[],
): { sections: RenderedSection[]; relevant: number; all: number } {
  const pathOf = (leaf: string) => (prefix ? `${prefix}.${leaf}` : leaf);
  const all = definitionLeaves(def);
  const focused = focus?.map((path) => path.toLowerCase());
  const inFocus = (leaf: string) => {
    const lower = leaf.toLowerCase();
    return (
      focused === undefined ||
      focused.some((path) => lower === path || lower.startsWith(`${path}.`))
    );
  };
  // The focused fields the definition leaves unset, so they are drawn anyway.
  // A damage table with no row at all gets its `default` row.
  const unset = (focus ?? []).flatMap((path) =>
    path.toLowerCase() === "damage"
      ? all.some((leaf) => leaf.toLowerCase().startsWith("damage."))
        ? []
        : ["damage.default"]
      : all.some((leaf) => leaf.toLowerCase() === path.toLowerCase())
        ? []
        : [path],
  );
  const present = all.filter(inFocus);
  const lowerPrefix = prefix ? `${prefix.toLowerCase()}.` : "";
  const edited = editable
    ? Object.keys(patch)
        .filter((path) => path.toLowerCase().startsWith(lowerPrefix))
        .map((path) => path.slice(lowerPrefix.length))
    : [];
  const walked = new Set(all.map((leaf) => leaf.toLowerCase()));
  const extra = WEAPON_PATHS.filter((path) => {
    const lower = path.toLowerCase();
    if (path.includes("*") || WEAPON_CONTAINERS.has(lower)) return false;
    // A table the page has already walked into, such as `customParams`, is
    // drawn as its keys and not again as one row.
    return ![...walked].some((leaf) => leaf.startsWith(`${lower}.`));
  });
  const relevantLeaves = mergeLeaves(present, unset, edited);
  const allLeaves = mergeLeaves(all, unset, edited, extra);
  const leaves = view === "all" ? allLeaves : relevantLeaves;

  const bySection = new Map<string, FieldRow[]>();
  for (const leaf of leaves) {
    const path = pathOf(leaf);
    const field = describeLeaf(leaf, def);
    const value = readPath(def, leaf);
    const isPresent = value !== undefined;
    const fallback = focus && !isPresent ? fallbackOf(def, field) : undefined;
    const inherited = isPresent ? value : (fallback ?? field.default);
    const state =
      editable && Object.hasOwn(patch, path) ? "overridden" : "inherited";
    const row: FieldRow = {
      path,
      field,
      label: field.label,
      present: isPresent,
      inherited,
      value: state === "overridden" ? patch[path] : inherited,
      state,
    };
    const section = definitionSection(leaf, field);
    const rows = bySection.get(section);
    if (rows) rows.push(row);
    else bySection.set(section, [row]);
  }
  const rank = (row: FieldRow) =>
    row.field.key.toLowerCase() === "default"
      ? -1
      : (NOTE_ORDER.get(row.field.path.toLowerCase()) ?? NOTE_ORDER.size);
  const sections: RenderedSection[] = [];
  for (const spec of DEFINITION_SECTIONS) {
    const rows = bySection.get(spec.id);
    if (!rows?.length) continue;
    sortRows(rows, rank);
    sections.push({ ...spec, rows });
  }
  return {
    sections,
    relevant: relevantLeaves.length,
    all: allLeaves.length,
  };
}

/**
 * What the engine reads for a field the definition leaves unset, when the
 * registry says it falls back on another field the definition does set:
 * `cameraShake` on `damage.default`, for one. Matched case-insensitively,
 * since games spell keys either way.
 */
function fallbackOf(
  def: Record<string, unknown>,
  field: ResolvedField,
): unknown {
  for (const path of field.engine?.fallsBackTo ?? []) {
    let at: unknown = def;
    for (const step of path.split(".")) {
      if (!isPlainObject(at)) {
        at = undefined;
        break;
      }
      const key = findKey(at, step.toLowerCase());
      at = key === undefined ? undefined : at[key];
    }
    if (at !== undefined) return at;
  }
  return undefined;
}

function definitionGroup(
  slot: WeaponSlot,
  overrides: UnitOverrides,
  unitKey: string,
  view: FieldView,
  unitName: string,
  mountedBy: number,
): { group: RenderedGroup; relevant: number; all: number } | null {
  const definition = slot.definition;
  if (definition.kind === "missing") return null;
  const own = definition.kind === "own";
  // A shared definition is shown under the name the engine gives it, since the
  // unit has no table of its own to write into.
  const prefix = own ? definition.path : `WeaponDefs.${definition.key}`;
  const { sections, relevant, all } = definitionSections(
    definition.def,
    overrides[unitKey] ?? {},
    prefix,
    view,
    own,
  );

  return {
    group: {
      id: "definition",
      label: own
        ? `Weapon definition ${definition.key}`
        : `Weapon definition ${definition.key}, shared`,
      note: own
        ? `What the weapon does. ${unitName} carries its own copy of this definition, so a change here reaches no other unit, even one whose weapon has the same name.`
        : `${unitName} does not carry this definition itself. ${slot.name} is in the game's shared weapon table${mountedBy > 1 ? `, and ${mountedBy} units mount it` : ""}, so a change to it would reach every one of them. Give ${unitName} its own copy to change it here.`,
      readOnly: !own,
      sections,
    },
    relevant,
    all,
  };
}

/**
 * A library weapon's fields, grouped for drawing (issue #2640). Changes are
 * written to the library entry, keyed by the field's own path, so every slot
 * that fires the weapon gets them.
 */
export function libraryWeaponGroup(
  weapon: LibraryWeapon,
  view: FieldView,
  note: string,
): { group: RenderedGroup; relevant: number; all: number } {
  const { sections, relevant, all } = definitionSections(
    weapon.def,
    weapon.changes ?? {},
    "",
    view,
    true,
  );
  return {
    group: {
      id: "library",
      label: `Library weapon ${weapon.key}`,
      note,
      sections,
    },
    relevant,
    all,
  };
}

/**
 * One slot, grouped for drawing: its mount first, then its definition.
 *
 * "relevant" is what the slot and the definition declare, plus anything the
 * project has changed under either, so an edit never vanishes out from under
 * the person who made it. "all" adds every key the engine reads there.
 *
 * A slot the project has equipped with a library weapon (issue #2640) draws
 * that weapon in place of the game's definition, as `library` rather than in
 * `groups`: its fields are written to the library, not to the unit, so the
 * page hands them to a different writer.
 */
export function weaponSlotView(
  slot: WeaponSlot,
  overrides: UnitOverrides,
  unitKey: string,
  view: FieldView,
  unitName: string,
  mountedBy = 0,
  equipped?: { weapon: LibraryWeapon; mounts: number },
): WeaponSlotView {
  const mount = slotGroup(slot, overrides, unitKey, view);
  if (equipped) {
    const others = equipped.mounts - 1;
    const library = libraryWeaponGroup(
      equipped.weapon,
      view,
      `What the weapon does. ${unitName} carries it as its own, out of the project's weapon library. A change here is a change to the library weapon${others > 0 ? `, so it reaches the ${others} other slot${others === 1 ? "" : "s"} that fire${others === 1 ? "s" : ""} it too` : ""}.`,
    );
    const relevant = mount.relevant + library.relevant;
    const all = mount.all + library.all;
    return {
      groups: [mount.group],
      library: library.group,
      shown: view === "all" ? all : relevant,
      hidden: all - relevant,
    };
  }
  const definition = definitionGroup(
    slot,
    overrides,
    unitKey,
    view,
    unitName,
    mountedBy,
  );
  const groups = [mount.group, ...(definition ? [definition.group] : [])];
  const relevant = mount.relevant + (definition?.relevant ?? 0);
  const all = mount.all + (definition?.all ?? 0);
  return {
    groups,
    shown: view === "all" ? all : relevant,
    hidden: all - relevant,
  };
}

/**
 * A definition the unit carries and no slot mounts, grouped for drawing
 * (issue #2641). Its fields are the unit's own, written as overrides under
 * its path the same as a mounted definition's.
 */
export function supportingView(
  support: SupportingDef,
  overrides: UnitOverrides,
  unitKey: string,
  view: FieldView,
  unitName: string,
): WeaponSlotView {
  const { sections, relevant, all } = definitionSections(
    support.def,
    overrides[unitKey] ?? {},
    support.path,
    view,
    true,
  );
  const users = support.usedBy.map((u) => `${u.from}'s ${u.field}`);
  const named =
    users.length > 0
      ? `${unitName} carries it for ${users.join(" and ")}, which name${users.length === 1 ? "s" : ""} it.`
      : `No field coilbox knows names it, so the game's own Lua may use it by name, or nothing does.`;
  return {
    groups: [
      {
        id: "definition",
        label: `Supporting definition ${support.key}`,
        note: `A weapon definition ${unitName} carries and no slot mounts. ${named} A change here reaches no other unit.`,
        sections,
      },
    ],
    shown: view === "all" ? all : relevant,
    hidden: all - relevant,
  };
}

/** How many of the project's edits to a unit belong to one supporting
 *  definition. */
export function supportingEditCount(
  support: SupportingDef,
  overrides: UnitOverrides,
  unitKey: string,
): number {
  const prefix = `${support.path.toLowerCase()}.`;
  return Object.keys(overrides[unitKey] ?? {}).filter((path) =>
    path.toLowerCase().startsWith(prefix),
  ).length;
}

/** Which supporting definition a field path belongs to, for a link that
 *  names one. */
export function supportOfPath(
  supporting: SupportingDef[],
  path: string,
): SupportingDef | undefined {
  const lower = path.toLowerCase();
  return supporting.find((s) => lower.startsWith(`${s.path.toLowerCase()}.`));
}

/**
 * Which slot a field path belongs to, for a link that names one (issue
 * #2653). A slot field matches on its own path, and a definition field on
 * the definition the slot carries.
 */
export function slotOfPath(
  slots: WeaponSlot[],
  path: string,
): WeaponSlot | undefined {
  const lower = path.toLowerCase();
  return slots.find((slot) =>
    slotPaths(slot).some((p) => lower.startsWith(`${p.toLowerCase()}.`)),
  );
}
