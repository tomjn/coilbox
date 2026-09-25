/**
 * What a unit explodes as when it dies and when it self-destructs (issue
 * #2642).
 *
 * `explodeAs` and `selfDestructAs` are names, not effects. RecoilEngine looks
 * each one up in the game's weapon table, lowercased (`UnitDef.cpp`,
 * `CWeaponDefHandler::GetWeaponDef`), and a unit that sets no `selfDestructAs`
 * self-destructs as its `explodeAs`. So a death explosion is a weapon
 * definition, and the page shows that definition's damage, area of effect,
 * impulse and camera shake rather than its name.
 *
 * Where the definition comes from, in the games coilbox has been checked
 * against:
 *
 * - Balanced Annihilation and Beyond All Reason keep their explosions in Lua
 *   files under `weapons/`: one file each in BA (`weapons/big_unitex.lua`),
 *   one table of many in BAR (`weapons/unit_explosions.lua`). XTA keeps them
 *   in `weapons/weapons.tdf`. All three load into the shared table under the
 *   name they are written with.
 * - A unit can carry one itself, in its own `weapondefs`. Each game's
 *   `weapondefs_post.lua`, and the base content's, then turns a field naming
 *   exactly that short name, as written, into `<unit>_<name>`. No installed
 *   game uses this: Balanced Annihilation's `armshock` and `armsilo` carry a
 *   definition of the right name but write the field in capitals, which that
 *   rule does not match, so they explode as the shared one.
 *
 * A change to a shared explosion would reach every unit that dies with it, so
 * editing one on a unit copies it into the project's weapon library and makes
 * the copy that unit's (`weaponLibrary.ts`, where the `equipped` store keys it
 * by the field's name instead of a slot number).
 */

import type { UnitOverrides } from "./overrides";
import type { FieldView, RenderedGroup } from "./unitSections";
import {
  DEATH_MOUNTS,
  type DeathMount,
  type LibraryWeapon,
} from "./weaponLibrary";
import {
  definitionSections,
  type SlotDefinition,
  type WeaponSlotView,
} from "./weaponSlots";

/** The fields a death explosion is about, as the weapon registry spells
 *  them. `damage` is every row of the damage table. */
export const EXPLOSION_FOCUS = [
  "damage",
  "areaOfEffect",
  "impulseFactor",
  "impulseBoost",
  "cameraShake",
] as const;

/** How each field is written in the engine's own spelling, and named. */
const MOUNT_INFO: Record<DeathMount, { field: string; label: string }> = {
  explodeas: { field: "explodeAs", label: "Death explosion" },
  selfdestructas: { field: "selfDestructAs", label: "Self-destruct explosion" },
};

/** One of a unit's two death explosions. */
export interface DeathExplosion {
  mount: DeathMount;
  /** "Death explosion" or "Self-destruct explosion". */
  label: string;
  /** The key the unit spells the field under, or the engine's spelling when
   *  the unit does not set it. */
  field: string;
  /** The name the field holds. For a self-destruct explosion the unit does
   *  not set, the death explosion's, since that is what the engine uses. */
  name: string;
  /** A self-destruct explosion the unit does not set, which the engine takes
   *  from `explodeAs`. */
  follows: boolean;
  /** Which definition the name finds. */
  definition: SlotDefinition;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const findKey = (
  table: Record<string, unknown>,
  lower: string,
): string | undefined =>
  Object.keys(table).find((key) => key.toLowerCase() === lower);

/**
 * Which definition a death explosion's name finds.
 *
 * A name the post files have already turned into `<owner>_<short>`, where the
 * unit carries `<short>`, is the unit's own. So is a short name written
 * exactly as the unit's own key, which the post files have yet to turn. `owners`
 * is the unit and, for a copy, the unit it was copied from, for the reason
 * `weaponSlots.ts` gives. Anything else is looked up in the shared table,
 * lowercased, the way the engine does.
 */
function resolve(
  name: string,
  def: Record<string, unknown>,
  shared: Record<string, Record<string, unknown>>,
  owners: string[],
): SlotDefinition {
  if (!name) return { kind: "missing" };
  const defsKey = findKey(def, "weapondefs");
  const ownRaw = defsKey === undefined ? undefined : def[defsKey];
  const own = isPlainObject(ownRaw) ? ownRaw : {};
  const lower = name.toLowerCase();
  const ownAt = (key: string | undefined): SlotDefinition | undefined =>
    key !== undefined && defsKey !== undefined && isPlainObject(own[key])
      ? { kind: "own", key, path: `${defsKey}.${key}`, def: own[key] }
      : undefined;
  for (const owner of owners) {
    const prefix = `${owner.toLowerCase()}_`;
    if (!lower.startsWith(prefix)) continue;
    const rest = lower.slice(prefix.length);
    const found = ownAt(Object.keys(own).find((k) => k.toLowerCase() === rest));
    if (found) return found;
  }
  const exact = ownAt(Object.hasOwn(own, name) ? name : undefined);
  if (exact) return exact;
  const sharedDef = shared[lower];
  return isPlainObject(sharedDef)
    ? { kind: "shared", key: lower, def: sharedDef }
    : { kind: "missing" };
}

/**
 * A unit's two death explosions, as the page has the unit.
 *
 * `def` is the unit as the game has it, which is where the definitions it
 * carries are read, and `edited` is the unit with the project's changes, which
 * is where the two names are read, so a name typed on the fields tab is
 * followed.
 */
export function deathExplosions(
  def: Record<string, unknown> | undefined,
  edited: Record<string, unknown> | undefined,
  shared: Record<string, Record<string, unknown>>,
  owners: string[],
): DeathExplosion[] {
  if (!def || !edited) return [];
  const nameOf = (mount: DeathMount) => {
    const key = findKey(edited, mount);
    const raw = key === undefined ? undefined : edited[key];
    return {
      key,
      name: typeof raw === "string" ? raw.trim() : "",
    };
  };
  const dies = nameOf("explodeas");
  const selfd = nameOf("selfdestructas");
  // A unit that names neither explodes as nothing either way, and the page
  // has nothing to offer on it but a text field, which the fields tab has.
  if (!dies.name && !selfd.name) return [];
  const follows = !selfd.name;
  return DEATH_MOUNTS.map((mount): DeathExplosion => {
    const own = mount === "explodeas" ? dies : selfd;
    const name = mount === "selfdestructas" && follows ? dies.name : own.name;
    return {
      mount,
      label: MOUNT_INFO[mount].label,
      field: own.key ?? MOUNT_INFO[mount].field,
      name,
      follows: mount === "selfdestructas" && follows,
      definition: resolve(name, def, shared, owners),
    };
  });
}

/** The library weapon a death explosion is, when the project made it one. */
export interface EquippedExplosion {
  weapon: LibraryWeapon;
  /** How many slots and explosions use it, across every unit. */
  mounts: number;
}

/**
 * One death explosion, grouped for drawing.
 *
 * Nothing to draw for a self-destruct explosion that follows the death one,
 * whose fields are the death explosion's, or for a name nothing defines.
 * `fires` is the library weapon the project made it, which is drawn in place
 * of the game's and edited as that weapon. A shared explosion is drawn
 * editable, and `copyKey` is the name the copy an edit makes will have.
 */
export function deathExplosionView(
  explosion: DeathExplosion,
  overrides: UnitOverrides,
  unitKey: string,
  view: FieldView,
  unitName: string,
  options: {
    fires?: EquippedExplosion;
    /** How many units in the game explode as a shared definition. */
    usedBy: number;
    copyKey: string;
  },
): WeaponSlotView {
  const what =
    explosion.mount === "explodeas"
      ? `What ${unitName} explodes as when it dies.`
      : `What ${unitName} explodes as when it self-destructs.`;
  const draw = (
    group: Omit<RenderedGroup, "sections">,
    def: Record<string, unknown>,
    patch: Record<string, unknown>,
    prefix: string,
  ): WeaponSlotView => {
    const { sections, relevant, all } = definitionSections(
      def,
      patch,
      prefix,
      view,
      true,
      EXPLOSION_FOCUS,
    );
    return {
      groups: [{ ...group, sections }],
      shown: view === "all" ? all : relevant,
      hidden: all - relevant,
    };
  };
  const { fires } = options;
  if (fires) {
    const others = fires.mounts - 1;
    return draw(
      {
        id: "explosion",
        label: `${explosion.label}: library weapon ${fires.weapon.key}`,
        note: `${what} It is ${fires.weapon.key}, copied from ${fires.weapon.source} into the project's weapon library. A change here is a change to the library weapon${others > 0 ? `, so it reaches the ${others} other place${others === 1 ? "" : "s"} it is equipped too` : ", and no unit uses it but this one"}.`,
      },
      fires.weapon.def,
      fires.weapon.changes ?? {},
      "",
    );
  }
  if (explosion.follows) return { groups: [], shown: 0, hidden: 0 };
  const definition = explosion.definition;
  if (definition.kind === "missing") return { groups: [], shown: 0, hidden: 0 };
  if (definition.kind === "own")
    return draw(
      {
        id: "explosion",
        label: `${explosion.label}: ${definition.key}`,
        note: `${what} ${unitName} carries this definition itself, so a change here reaches no other unit.`,
      },
      definition.def,
      overrides[unitKey] ?? {},
      definition.path,
    );
  const others = options.usedBy - 1;
  return draw(
    {
      id: "explosion",
      label: `${explosion.label}: ${explosion.name}`,
      note: `${what} ${explosion.name} is in the game's shared weapon table${others > 0 ? `, and ${others} other unit${others === 1 ? "" : "s"} use${others === 1 ? "s" : ""} it` : ""}. Changing a field here copies it into the project's weapon library as ${options.copyKey} and makes that ${unitName}'s, so ${others > 0 ? "every other unit keeps" : "the game keeps"} its own.`,
    },
    definition.def,
    {},
    "",
  );
}

/**
 * How many units in the game explode as a shared definition, when they die
 * or self-destruct, counted off the game's own table.
 */
export function unitsExplodingAs(
  units: Record<string, Record<string, unknown>>,
  shared: Record<string, Record<string, unknown>>,
  name: string,
): number {
  const lower = name.toLowerCase();
  let count = 0;
  for (const [key, def] of Object.entries(units)) {
    if (
      deathExplosions(def, def, shared, [key]).some(
        (e) => e.definition.kind === "shared" && e.definition.key === lower,
      )
    )
      count += 1;
  }
  return count;
}

/** How many of the project's edits belong to one death explosion: its
 *  library weapon, or its own definition's overrides. */
export function explosionEditCount(
  explosion: DeathExplosion,
  overrides: UnitOverrides,
  unitKey: string,
  fires: string | undefined,
): number {
  if (fires) return 1;
  if (explosion.follows || explosion.definition.kind !== "own") return 0;
  const prefix = `${explosion.definition.path.toLowerCase()}.`;
  return Object.keys(overrides[unitKey] ?? {}).filter((path) =>
    path.toLowerCase().startsWith(prefix),
  ).length;
}
