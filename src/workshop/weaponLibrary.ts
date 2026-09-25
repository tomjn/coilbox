/**
 * Weapons that belong to the project rather than to a unit (issue #2640).
 *
 * A library weapon is a whole weapon definition copied out of the game's
 * weapon table under a name of its own, plus the sparse changes made to it
 * since. It reaches the game only through a slot that fires it: equipping one
 * into a unit's slot writes the weapon into that unit's own `weapondefs` under
 * its library name and points the slot at it (`compile.rs`). So one weapon,
 * built once, can be fired by any number of units, and changing it changes
 * every one of them and nothing else.
 *
 * It is also how a unit gets its own copy of a weapon it mounts from the
 * game's shared table (issue #3052). Changing the shared definition would
 * change every unit that mounts it, so the copy goes into the library and is
 * equipped into that one slot.
 *
 * Two stores rather than one. `weapons` is what the library holds and
 * `equipped` is which slot fires what, by unit and then by the slot's step as
 * `weaponSlots.ts` writes it. A slot can only fire one weapon, which keying
 * by slot makes impossible to break.
 *
 * Each weapon records the game weapon it was copied from and the game's
 * checksum at the time, so the drift check (issue #1281) can say when the
 * source has moved.
 */
import { clearOverride, resolvedDef, setOverride } from "./overrides";

/** One weapon in the project's library. */
export interface LibraryWeapon {
  /** Its short name, which is its key in each unit's own `weapondefs`. */
  key: string;
  /** The game weapon it was copied from, lowercased as the game keys it. */
  source: string;
  /** The game's checksum when it was copied, when the game had one. */
  sourceChecksum?: string;
  /** The definition as it was copied. Never written to after. */
  def: Record<string, unknown>;
  /** Dotted paths into `def` and the values set since. Absent when none. */
  changes?: Record<string, unknown>;
}

/** The library, by key. */
export type WeaponLibrary = Record<string, LibraryWeapon>;

/** Unit key, then the slot's step, then the library weapon that slot fires. */
export type EquippedWeapons = Record<string, Record<string, string>>;

/** One slot that fires a library weapon. */
export interface WeaponMount {
  unit: string;
  step: string;
}

const KEY_PATTERN = /^[a-z0-9_]+$/;

/** Why a name can or cannot be a library weapon's. */
export type WeaponNameVerdict = "empty" | "invalid" | "taken" | "ok";

export interface WeaponNameCheck {
  key: string;
  verdict: WeaponNameVerdict;
  ok: boolean;
}

/**
 * Whether a name can be a new library weapon's.
 *
 * The same characters a unit's internal name allows, because the name becomes
 * a key in a unit's `weapondefs` and half of the full name the game gives the
 * weapon, `<unit>_<name>`. The compiler checks it again.
 */
export function checkWeaponName(
  raw: string,
  library: WeaponLibrary | undefined,
): WeaponNameCheck {
  const key = raw.trim().toLowerCase();
  const verdict: WeaponNameVerdict = !key
    ? "empty"
    : !KEY_PATTERN.test(key)
      ? "invalid"
      : library && Object.hasOwn(library, key)
        ? "taken"
        : "ok";
  return { key, verdict, ok: verdict === "ok" };
}

/**
 * A name to offer for a copy of `source`: its own name with `_copy` on the
 * end, numbered from the second. Anything outside the allowed characters is
 * turned into an underscore, so a name out of an old game still fits.
 */
export function suggestWeaponKey(
  source: string,
  library: WeaponLibrary | undefined,
): string {
  const base =
    source
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "weapon";
  const taken = (key: string) => !!library && Object.hasOwn(library, key);
  let key = `${base}_copy`;
  let n = 2;
  while (taken(key)) {
    key = `${base}_copy${n}`;
    n += 1;
  }
  return key;
}

/** Add a weapon. A weapon already under that key is left as it is. */
export function addLibraryWeapon(
  library: WeaponLibrary | undefined,
  weapon: LibraryWeapon,
): WeaponLibrary | undefined {
  if (library && Object.hasOwn(library, weapon.key)) return library;
  return { ...library, [weapon.key]: weapon };
}

/** A copy of one of the game's weapons, ready for the library. */
export function copyGameWeapon(
  key: string,
  source: string,
  def: Record<string, unknown>,
  checksum: string | undefined,
): LibraryWeapon {
  return {
    key,
    source: source.toLowerCase(),
    ...(checksum ? { sourceChecksum: checksum } : {}),
    def: structuredClone(def),
  };
}

/** Take a weapon out of the library. `unequipEverywhere` goes with it. */
export function removeLibraryWeapon(
  library: WeaponLibrary | undefined,
  key: string,
): WeaponLibrary | undefined {
  if (!library || !Object.hasOwn(library, key)) return library;
  const { [key]: _gone, ...rest } = library;
  return rest;
}

/** Replace one weapon's changes, dropping the field when none are left. */
function withChanges(
  library: WeaponLibrary,
  key: string,
  changes: Record<string, unknown> | undefined,
): WeaponLibrary {
  const { changes: _old, ...weapon } = library[key];
  return {
    ...library,
    [key]:
      changes && Object.keys(changes).length > 0
        ? { ...weapon, changes }
        : weapon,
  };
}

/**
 * Change one field of a library weapon, the way `setOverride` changes a
 * unit's: a value equal to what the copy already held removes the change.
 */
export function setLibraryField(
  library: WeaponLibrary | undefined,
  key: string,
  path: string,
  value: unknown,
  inherited: unknown,
): WeaponLibrary | undefined {
  const weapon = library?.[key];
  if (!library || !weapon) return library;
  const before = weapon.changes ?? {};
  const next = setOverride({ [key]: before }, key, path, value, inherited)[key];
  if (next === before) return library;
  return withChanges(library, key, next);
}

/** Put one field of a library weapon back to what the copy held. */
export function clearLibraryField(
  library: WeaponLibrary | undefined,
  key: string,
  path: string,
): WeaponLibrary | undefined {
  const weapon = library?.[key];
  if (!library || !weapon?.changes || !Object.hasOwn(weapon.changes, path))
    return library;
  return withChanges(
    library,
    key,
    clearOverride({ [key]: weapon.changes }, key, path)[key],
  );
}

/** A library weapon as the game will read it, changes and all. */
export function libraryWeaponDef(
  weapon: LibraryWeapon,
): Record<string, unknown> {
  return resolvedDef(weapon.def, weapon.changes);
}

/** How many changes a library weapon holds. */
export function libraryChangeCount(weapon: LibraryWeapon): number {
  return Object.keys(weapon.changes ?? {}).length;
}

/** Which library weapon a slot fires, if the project equipped one. */
export function equippedKey(
  equipped: EquippedWeapons | undefined,
  unit: string,
  step: string,
): string | undefined {
  return equipped?.[unit]?.[step];
}

/** Make a slot fire a library weapon. */
export function equipWeapon(
  equipped: EquippedWeapons | undefined,
  unit: string,
  step: string,
  key: string,
): EquippedWeapons | undefined {
  if (equipped?.[unit]?.[step] === key) return equipped;
  return { ...equipped, [unit]: { ...equipped?.[unit], [step]: key } };
}

/** Put a slot back to the weapon the game gives it. */
export function unequipWeapon(
  equipped: EquippedWeapons | undefined,
  unit: string,
  step: string,
): EquippedWeapons | undefined {
  const slots = equipped?.[unit];
  if (!equipped || !slots || !Object.hasOwn(slots, step)) return equipped;
  const { [step]: _gone, ...rest } = slots;
  const { [unit]: _unit, ...others } = equipped;
  return Object.keys(rest).length === 0 ? others : { ...others, [unit]: rest };
}

/** Every slot on one unit back to the game's weapon. */
export function unequipUnit(
  equipped: EquippedWeapons | undefined,
  unit: string,
): EquippedWeapons | undefined {
  if (!equipped || !Object.hasOwn(equipped, unit)) return equipped;
  const { [unit]: _gone, ...rest } = equipped;
  return rest;
}

/** Every slot that fires one weapon back to the game's weapon. */
export function unequipEverywhere(
  equipped: EquippedWeapons | undefined,
  key: string,
): EquippedWeapons | undefined {
  let next = equipped;
  for (const { unit, step } of mountsOf(equipped, key))
    next = unequipWeapon(next, unit, step);
  return next;
}

/** Every slot that fires one weapon, by unit and then by step. */
export function mountsOf(
  equipped: EquippedWeapons | undefined,
  key: string,
): WeaponMount[] {
  const out: WeaponMount[] = [];
  for (const [unit, slots] of Object.entries(equipped ?? {}))
    for (const [step, fired] of Object.entries(slots))
      if (fired === key) out.push({ unit, step });
  return out.sort(
    (a, b) => a.unit.localeCompare(b.unit) || Number(a.step) - Number(b.step),
  );
}

/** How many slots fire a library weapon, across every unit. */
export function equippedCount(equipped: EquippedWeapons | undefined): number {
  return Object.values(equipped ?? {}).reduce(
    (n, slots) => n + Object.keys(slots).length,
    0,
  );
}

/**
 * Why a unit cannot fire a library weapon, or `undefined` when it can.
 *
 * The weapon goes into the unit's own `weapondefs` under its library name, so
 * a unit that already carries a definition of that name would lose it, and
 * with it every slot that fires it.
 */
export function equipRefusal(
  unitDef: Record<string, unknown> | undefined,
  unitName: string,
  key: string,
): string | undefined {
  const defsKey = Object.keys(unitDef ?? {}).find(
    (k) => k.toLowerCase() === "weapondefs",
  );
  const own = defsKey === undefined ? undefined : unitDef?.[defsKey];
  if (own === null || typeof own !== "object") return undefined;
  const clash = Object.keys(own).some((k) => k.toLowerCase() === key);
  return clash
    ? `${unitName} already carries a weapon definition called ${key}, and equipping this would replace it. Copy the weapon into the library under another name.`
    : undefined;
}

/** Read the library out of untrusted JSON, dropping any entry it cannot use. */
export function parseWeaponLibrary(value: unknown): WeaponLibrary {
  const out: WeaponLibrary = {};
  if (!isRecord(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || !isRecord(raw.def)) continue;
    if (!KEY_PATTERN.test(key) || raw.key !== key) continue;
    out[key] = {
      key,
      source: typeof raw.source === "string" ? raw.source : "",
      ...(typeof raw.sourceChecksum === "string"
        ? { sourceChecksum: raw.sourceChecksum }
        : {}),
      def: raw.def,
      ...(isRecord(raw.changes) && Object.keys(raw.changes).length > 0
        ? { changes: raw.changes }
        : {}),
    };
  }
  return out;
}

/** Read the equipped slots out of untrusted JSON, dropping empty units. */
export function parseEquippedWeapons(value: unknown): EquippedWeapons {
  const out: EquippedWeapons = {};
  if (!isRecord(value)) return out;
  for (const [unit, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const slots: Record<string, string> = {};
    for (const [step, key] of Object.entries(raw))
      if (/^\d+$/.test(step) && typeof key === "string") slots[step] = key;
    if (Object.keys(slots).length > 0) out[unit] = slots;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
