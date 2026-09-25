/**
 * Weapon definitions that name other weapon definitions, and the ones a unit
 * carries without mounting (issue #2641).
 *
 * The engine never looks one weapon definition up from another. The only
 * lookups by name in RecoilEngine are a slot's weapon and a unit's
 * `explodeAs` and `selfDestructAs` (`UnitDef.cpp`). So every weapon that
 * names another does it through a custom parameter a game's own Lua reads,
 * and a unit can carry a definition that no slot mounts purely so that
 * another weapon can name it. Beyond All Reason test-30922-8064a43 reads two:
 *
 * - `customparams.cluster_def`, the child a cluster munition scatters.
 *   Written as a short name in the unit's own `weapondefs`, and turned into
 *   `<unit>_<name>` by `processWeapons` in `gamedata/alldefs_post.lua`, which
 *   runs over the unit's own definitions only. The cluster gadget
 *   (`luarules/gadgets/unit_custom_weapons_cluster.lua`) then looks that full
 *   name up. So the child has to be a definition the same unit carries.
 * - `customparams.speceffect_def`, the projectile a `split` or
 *   `cannonwaterpen` special effect spawns
 *   (`luarules/gadgets/unit_custom_weapons_behaviours.lua`). Nothing renames
 *   it: the unit file spells the full name, `armmship_rocket_split`, and the
 *   gadget looks it up as it stands. So it can name any weapon in the game.
 *
 * Balanced Annihilation V15.9.8 reads neither, and none of its units carries a
 * definition no slot mounts. Beyond All Reason's carriers and spawners name
 * units (`carried_unit`, `spawns_name`), not weapons, and its shields are
 * mounted in slots, so neither is a reference between weapons.
 */
import { type PostChange, withoutEdited } from "./beforePost";
import { resolvedDef } from "./overrides";
import type { LibraryWeapon, WeaponLibrary } from "./weaponLibrary";
import type { WeaponSlot } from "./weaponSlots";

/** How a game turns a reference's value into a weapon definition. */
export type RefResolution =
  /** A short name among the same unit's own `weapondefs`. */
  | "own"
  /** A full name in the game's weapon table, `<unit>_<name>` for a
   *  definition a unit carries. */
  | "full";

/** A custom parameter that names another weapon definition. */
export interface RefField {
  /** The key inside `customparams`, lowercased. */
  key: string;
  resolution: RefResolution;
}

/** Every reference field coilbox knows, in the order a page lists them. */
export const WEAPON_REF_FIELDS: readonly RefField[] = [
  { key: "cluster_def", resolution: "own" },
  { key: "speceffect_def", resolution: "full" },
];

/** One reference a weapon definition holds. */
export interface WeaponRef {
  field: RefField;
  /** Where it is, relative to the definition, in the definition's spelling:
   *  `customparams.cluster_def`. */
  path: string;
  /** The name it holds, as it holds it. */
  value: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const keyOf = (table: Record<string, unknown>, lower: string) =>
  Object.keys(table).find((key) => key.toLowerCase() === lower);

/** Every reference a definition holds, in {@link WEAPON_REF_FIELDS} order. */
export function weaponRefs(
  def: Record<string, unknown> | undefined,
): WeaponRef[] {
  if (!def) return [];
  const paramsKey = keyOf(def, "customparams");
  const params = paramsKey === undefined ? undefined : def[paramsKey];
  if (paramsKey === undefined || !isPlainObject(params)) return [];
  const out: WeaponRef[] = [];
  for (const field of WEAPON_REF_FIELDS) {
    const key = keyOf(params, field.key);
    const value = key === undefined ? undefined : params[key];
    if (key === undefined || typeof value !== "string" || !value.trim())
      continue;
    out.push({ field, path: `${paramsKey}.${key}`, value: value.trim() });
  }
  return out;
}

/** Where a reference is answered from. */
export interface RefScope {
  /** The unit's own `weapondefs`, in its own spelling. */
  own: Record<string, unknown>;
  /** Every name the unit's own definitions are prefixed with in the game's
   *  table: the unit, and for a copy the unit it was copied from. */
  owners: string[];
  /** The game's weapon table, keyed by lowercased full name. */
  shared: Record<string, Record<string, unknown>>;
  /** The project's weapon library, when the weapon holding the reference is
   *  one of its weapons. A library weapon names another library weapon by its
   *  key, and the compiler writes that one into the unit beside it. */
  library?: WeaponLibrary;
}

/** What a reference names. */
export type RefTarget =
  | { kind: "own"; key: string }
  | { kind: "library"; key: string }
  | { kind: "shared"; key: string };

/**
 * The own definition a name means, in the table's spelling.
 *
 * A bare name only counts where the game looks the name up among the unit's
 * own definitions. The owner prefix counts either way: it is what the game's
 * post files turn a short name into, so the page reads it back that way.
 */
function ownKeyOf(
  lower: string,
  own: Record<string, unknown>,
  owners: string[],
  bare: boolean,
): string | undefined {
  const byLower = new Map(Object.keys(own).map((k) => [k.toLowerCase(), k]));
  if (bare && byLower.has(lower)) return byLower.get(lower);
  for (const owner of owners) {
    const prefix = `${owner.toLowerCase()}_`;
    if (!lower.startsWith(prefix)) continue;
    const found = byLower.get(lower.slice(prefix.length));
    if (found !== undefined) return found;
  }
  return undefined;
}

/** What a reference names, or `undefined` when it names nothing. */
export function resolveRef(
  ref: WeaponRef,
  scope: RefScope,
): RefTarget | undefined {
  const lower = ref.value.toLowerCase();
  if (scope.library && Object.hasOwn(scope.library, lower))
    return { kind: "library", key: lower };
  const own = ownKeyOf(
    lower,
    scope.own,
    scope.owners,
    ref.field.resolution === "own",
  );
  if (own !== undefined && isPlainObject(scope.own[own]))
    return { kind: "own", key: own };
  if (ref.field.resolution === "full" && isPlainObject(scope.shared[lower]))
    return { kind: "shared", key: lower };
  return undefined;
}

/** A unit's own `weapondefs`, or an empty table, and the key it is under. */
export function ownWeaponDefs(def: Record<string, unknown> | undefined): {
  key: string;
  defs: Record<string, unknown>;
} {
  const key = def ? keyOf(def, "weapondefs") : undefined;
  const raw = key === undefined ? undefined : def?.[key];
  return {
    key: key ?? "weapondefs",
    defs: isPlainObject(raw) ? raw : {},
  };
}

/** A definition a unit carries that none of its slots mounts. */
export interface SupportingDef {
  /** Its key in the unit's own `weapondefs`, in the table's spelling. */
  key: string;
  /** Where its fields are written: `weapondefs.rocket_split`. */
  path: string;
  def: Record<string, unknown>;
  /** The unit's own definitions that name it, and through which field. */
  usedBy: { from: string; field: string }[];
}

/**
 * Every definition a unit carries and no slot mounts, in the file's order.
 *
 * `def` is the unit as the game has it, which decides what it carries.
 * `resolved` is the same unit with the project's edits in, which decides what
 * names what, so a reference the project changed is read as changed.
 */
export function supportingDefs(
  def: Record<string, unknown> | undefined,
  resolved: Record<string, unknown> | undefined,
  slots: WeaponSlot[],
  owners: string[],
  shared: Record<string, Record<string, unknown>>,
): SupportingDef[] {
  const { key: defsKey, defs } = ownWeaponDefs(def);
  const mounted = new Set(
    slots.flatMap((slot) =>
      slot.definition.kind === "own" ? [slot.definition.key.toLowerCase()] : [],
    ),
  );
  const edited = ownWeaponDefs(resolved).defs;
  const scope: RefScope = { own: edited, owners, shared };
  const usedBy = new Map<string, { from: string; field: string }[]>();
  for (const [from, weapon] of Object.entries(edited)) {
    if (!isPlainObject(weapon)) continue;
    for (const ref of weaponRefs(weapon)) {
      const target = resolveRef(ref, scope);
      if (target?.kind !== "own") continue;
      const lower = target.key.toLowerCase();
      usedBy.set(lower, [
        ...(usedBy.get(lower) ?? []),
        { from, field: ref.field.key },
      ]);
    }
  }
  return Object.entries(defs)
    .filter(
      ([key, value]) => isPlainObject(value) && !mounted.has(key.toLowerCase()),
    )
    .map(([key, value]) => ({
      key,
      path: `${defsKey}.${key}`,
      def: value as Record<string, unknown>,
      usedBy: usedBy.get(key.toLowerCase()) ?? [],
    }));
}

/** A reference that names nothing the game would find. */
export interface RefProblem {
  /** Stable, for React and for a test to name one. */
  id: string;
  /** The definition holding the reference: one the unit carries, or a library
   *  weapon one of its slots fires. */
  holder: { kind: "own"; key: string } | { kind: "library"; key: string };
  field: string;
  value: string;
  message: string;
}

/**
 * Every reference on one unit that names nothing, counting the unit's own
 * definitions and the library weapons its slots fire.
 *
 * `resolved` is the unit with the project's edits in. `fired` is the library
 * weapons its slots fire, each checked against the library first, since the
 * compiler writes a library weapon's children into the unit beside it, and
 * then against the unit.
 */
export function refProblems(
  resolved: Record<string, unknown> | undefined,
  unitName: string,
  owners: string[],
  shared: Record<string, Record<string, unknown>>,
  library: WeaponLibrary | undefined,
  fired: LibraryWeapon[],
): RefProblem[] {
  const own = ownWeaponDefs(resolved).defs;
  const out: RefProblem[] = [];
  const say = (ref: WeaponRef, holder: string, inLibrary: boolean) => {
    const where = inLibrary
      ? `neither the project's weapon library nor ${unitName}`
      : unitName;
    return ref.field.resolution === "own"
      ? `${holder}'s ${ref.field.key} names ${ref.value}, which ${where} carries. The game looks for it among ${unitName}'s own weapon definitions, so the effect that needs it does not happen.`
      : `${holder}'s ${ref.field.key} names ${ref.value}, which is not a weapon ${inLibrary ? `in the project's weapon library or ` : ""}in the game. It takes the full name the game gives a weapon, <unit>_<name> for one a unit carries, so the effect that needs it does not happen.`;
  };
  for (const [key, weapon] of Object.entries(own)) {
    if (!isPlainObject(weapon)) continue;
    for (const ref of weaponRefs(weapon)) {
      if (resolveRef(ref, { own, owners, shared })) continue;
      out.push({
        id: `own:${key}:${ref.field.key}`,
        holder: { kind: "own", key },
        field: ref.field.key,
        value: ref.value,
        message: say(ref, key, false),
      });
    }
  }
  const seen = new Set<string>();
  for (const weapon of fired) {
    if (seen.has(weapon.key)) continue;
    seen.add(weapon.key);
    const def = resolvedLibraryDef(weapon);
    for (const ref of weaponRefs(def)) {
      if (resolveRef(ref, { own, owners, shared, library })) continue;
      out.push({
        id: `library:${weapon.key}:${ref.field.key}`,
        holder: { kind: "library", key: weapon.key },
        field: ref.field.key,
        value: ref.value,
        message: say(ref, weapon.key, true),
      });
    }
  }
  return out;
}

/** A library weapon with its changes in, the way the compiler writes it. */
const resolvedLibraryDef = (weapon: LibraryWeapon) =>
  resolvedDef(weapon.def, weapon.changes);

/**
 * Every library weapon one library weapon names, and the ones those name, in
 * the order they are reached. The compiler writes each into a unit beside the
 * weapon that names it (`compile.rs`, `library_support`).
 */
export function librarySupport(
  library: WeaponLibrary | undefined,
  key: string,
): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    const weapon = library?.[at];
    if (!weapon) return;
    for (const ref of weaponRefs(resolvedLibraryDef(weapon))) {
      const next = ref.value.toLowerCase();
      if (next === key || out.includes(next) || !library?.[next]) continue;
      out.push(next);
      walk(next);
    }
  };
  walk(key);
  return out;
}

/** One definition to copy into the library, as the page has it. */
export interface CopySource {
  /** The full name the game gives it, lowercased. */
  source: string;
  def: Record<string, unknown>;
  beforePost?: PostChange;
}

/** One weapon to add to the library, and the name it gets there. */
export interface PlannedCopy {
  key: string;
  from: CopySource;
}

/**
 * Copying a weapon into the library, and every weapon it names that the game
 * can hand over, so the copy fires its own children rather than the game's.
 *
 * `childOf` answers what a reference names in the game, as a definition to
 * copy, or `undefined` for one it names nothing or cannot be copied. Each
 * child gets a library name out of `nameFor` and the reference is rewritten to
 * that name, which is how a library weapon names another (`resolveRef`). The
 * game's own value for a rewritten reference is dropped from what the copy
 * carries of the post files, since putting it back would undo the rename.
 *
 * A child the library already holds a copy of, by the game's name for it, is
 * named rather than copied again: two cluster weapons on one unit that share a
 * child in the game share the library's copy of it too.
 */
export function planLibraryCopy(
  key: string,
  from: CopySource,
  library: WeaponLibrary | undefined,
  childOf: (ref: WeaponRef) => CopySource | undefined,
  nameFor: (source: string, taken: (key: string) => boolean) => string,
): PlannedCopy[] {
  const planned: PlannedCopy[] = [];
  const bySource = new Map<string, string>();
  for (const weapon of Object.values(library ?? {}))
    if (!bySource.has(weapon.source)) bySource.set(weapon.source, weapon.key);
  const taken = (k: string) =>
    Object.hasOwn(library ?? {}, k) || planned.some((p) => p.key === k);

  const place = (at: string, copy: CopySource) => {
    const entry: PlannedCopy = {
      key: at,
      from: { ...copy, def: structuredClone(copy.def) },
    };
    planned.push(entry);
    bySource.set(copy.source, at);
    const renamed: string[] = [];
    for (const ref of weaponRefs(entry.from.def)) {
      const child = childOf(ref);
      if (!child) continue;
      let childKey = bySource.get(child.source);
      if (childKey === undefined) {
        childKey = nameFor(child.source, taken);
        place(childKey, child);
      }
      const [paramsKey, refKey] = ref.path.split(".");
      (entry.from.def[paramsKey] as Record<string, unknown>)[refKey] = childKey;
      renamed.push(ref.path);
    }
    if (entry.from.beforePost && renamed.length > 0)
      entry.from.beforePost = withoutEdited(entry.from.beforePost, renamed);
  };
  place(key, from);
  return planned;
}
