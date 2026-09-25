/**
 * A unit's armour class, and the damage a weapon deals against it (issue
 * #2645).
 *
 * RecoilEngine assigns a unit's class purely from `gamedata/armordefs.lua`:
 * each class is an array of unit def names, `CDamageArrayHandler::Init` reads
 * every one and hands `UnitDef::armorType` whichever class named the unit, and
 * a unit nothing names falls back to the class the engine always calls
 * `"default"` at index 0, whether or not the game's own file mentions it.
 * There is no field on the unit itself the engine reads for this: BA and XTA
 * name a unit's class purely by listing it, and Beyond All Reason additionally
 * lets its own `gamedata/armordefs.lua` move a unit out of its list when the
 * unit's `customparams.armordef` says so, which is that game's own Lua reading
 * its own convention, not something the engine does for every game. So
 * coilbox reads the file's membership rather than a unit field, and writes a
 * class change the same way: by editing the membership, not a unit's own def.
 *
 * A weapon's `damage` table already draws one row per class it names, default
 * first (`weaponSlots.ts`, issue #2641). What is missing is knowing which
 * names are real: `GetTypeFromName` (`DamageArrayHandler.cpp`) lowercases a
 * damage key and silently falls back to `"default"` for one that resolves to
 * nothing, so a typo in a weapon's damage table costs nothing where it should
 * cost damage, without so much as a warning in the game's own log.
 * {@link unknownDamageClasses} is that check.
 *
 * Writing a unit's class is a shared-file edit and not a per-unit one, so it
 * has no home in `overrides` (a unit's own def) and no in-place form (the
 * edit-in-place route patches one unit's own file, and this touches none).
 * `compile::compile` is handed the project alone and never the game, so the
 * moment a project moves its first unit, the frontend takes a snapshot of the
 * game's whole table into {@link ArmorClasses.base}, the same way a copied
 * weapon in the library holds the definition it was copied from rather than
 * asking the compiler to fetch it again. Every move after the first reads
 * against that snapshot.
 */

/** One class, and how many of the game's units are in it. */
export interface ArmorClassSummary {
  /** The name, exactly as the game's `armordefs.lua` spells it, or a move
   *  the project made spells it. */
  name: string;
  /** How many units are in it once the project's own moves are applied. */
  units: number;
}

/** What the project has moved (issue #2645), a mirror of `ArmorClasses` in
 *  `crates/tauri-plugin-coilbox-workshop/src/model.rs`. */
export interface ArmorClasses {
  /** The game's own class membership at the moment of the first move, kept so
   *  the compiler can write the whole file back without asking the game
   *  again. Never read for anything shown on screen: a page reads the live
   *  game data instead, the same way the rest of the workshop always prefers
   *  what is on this machine today over what a project once saw. */
  base: Record<string, string[]>;
  /** Unit key to the class name the project moves it to. A target of
   *  `"default"` (case insensitive) needs no membership of its own: it is
   *  the engine's built-in catch-all. */
  moves: Record<string, string>;
}

/** A project that has moved nothing. Shared, so a clean project settles on
 *  one object the way `NO_COMPAT_FINDINGS` does. */
export const EMPTY_ARMOR_CLASSES: ArmorClasses = { base: {}, moves: {} };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A class's members, keeping only the strings a game's own array could hold.
 *  Not every game's `armordefs.lua` is one this reads cleanly (issue #2645's
 *  own ground truth found BAR building its table with `pairs` over generated
 *  keys, still landing on arrays of strings), so a class whose value came back
 *  as something else is dropped rather than guessed at. */
function classMembers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** The worker's raw `armorDefs`, shaped into class name to member list. Keys
 *  arrive lowercased already (the worker lowercases every def-table key the
 *  same way it does for `units` and `weaponDefs`), so this only has to shape
 *  the values. */
export function normaliseArmorDefs(
  raw: Record<string, unknown> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw) return out;
  for (const [name, value] of Object.entries(raw)) {
    const members = classMembers(value);
    if (members.length > 0) out[name] = members;
  }
  return out;
}

/** Read `ArmorClasses` out of untrusted JSON, dropping anything it cannot
 *  use. A project saved before issue #2645 has no key for this at all, which
 *  reads back as {@link EMPTY_ARMOR_CLASSES}. */
export function parseArmorClasses(value: unknown): ArmorClasses {
  if (!isRecord(value)) return EMPTY_ARMOR_CLASSES;
  const base: Record<string, string[]> = {};
  if (isRecord(value.base)) {
    for (const [name, members] of Object.entries(value.base)) {
      const list = classMembers(members);
      if (list.length > 0) base[name] = list;
    }
  }
  const moves: Record<string, string> = {};
  if (isRecord(value.moves)) {
    for (const [unit, className] of Object.entries(value.moves)) {
      if (typeof className === "string" && className.trim())
        moves[unit] = className.trim();
    }
  }
  return { base, moves };
}

/** The game's classes with the project's own moves applied: a unit the
 *  project moved is out of its game-given class and into the one it was
 *  moved to. This is what a page shows, always against today's game rather
 *  than the frozen snapshot the compiler carries. */
export function resolvedArmorDefs(
  armorDefs: Record<string, string[]>,
  moves: Record<string, string> | undefined,
): Record<string, string[]> {
  if (!moves || Object.keys(moves).length === 0) return armorDefs;
  const moved = new Map(
    Object.entries(moves).map(([unit, cls]) => [unit.toLowerCase(), cls]),
  );
  const out: Record<string, string[]> = {};
  for (const [name, members] of Object.entries(armorDefs)) {
    const kept = members.filter((m) => !moved.has(m.toLowerCase()));
    if (kept.length > 0) out[name] = kept;
  }
  for (const [unit, className] of Object.entries(moves)) {
    if (className.toLowerCase() === "default") continue;
    out[className] = [...(out[className] ?? []), unit];
  }
  return out;
}

/** Which class a unit is in, resolved against the game's own membership and
 *  the project's moves. `"default"` for a unit nothing names, matching the
 *  engine's own fallback (`GetTypeFromName` returning index 0). */
export function armorClassOf(
  armorDefs: Record<string, string[]>,
  moves: Record<string, string> | undefined,
  unitKey: string,
): string {
  const moved = moves?.[unitKey];
  if (moved) return moved;
  const lower = unitKey.toLowerCase();
  for (const [name, members] of Object.entries(armorDefs)) {
    if (members.some((m) => m.toLowerCase() === lower)) return name;
  }
  return "default";
}

/** Every class the game and the project's moves between them name, commonest
 *  first and then alphabetically, the same ordering `moveClassesOf` uses and
 *  for the same reason: the handful a game's army mostly lives in belong near
 *  the top of the list a modder picks from. `"default"` is always included,
 *  since it is always a unit's class to move to or from even when nothing in
 *  the game's own file names it. */
export function armorClassesOf(
  armorDefs: Record<string, string[]>,
  moves: Record<string, string> | undefined,
): ArmorClassSummary[] {
  const resolved = resolvedArmorDefs(armorDefs, moves);
  const counts = new Map<string, number>();
  counts.set("default", 0);
  for (const [name, members] of Object.entries(resolved))
    counts.set(name, members.length);
  return [...counts]
    .map(([name, units]) => ({ name, units }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}

/**
 * Move a unit to a class, or clear the move when it matches what the game
 * already gives it.
 *
 * `base` is only ever written once: the first move a project makes takes the
 * snapshot the compiler will need, later moves are read against it exactly as
 * the first one was, and clearing every move drops it, since a snapshot with
 * nothing to apply says nothing the game does not already say.
 */
export function setArmorClass(
  armorClasses: ArmorClasses | undefined,
  liveArmorDefs: Record<string, string[]>,
  unitKey: string,
  className: string,
  inheritedClassName: string,
): ArmorClasses | undefined {
  const target = className.trim();
  const current = armorClasses ?? EMPTY_ARMOR_CLASSES;
  if (!target || target.toLowerCase() === inheritedClassName.toLowerCase()) {
    if (!Object.hasOwn(current.moves, unitKey)) return armorClasses;
    const { [unitKey]: _gone, ...moves } = current.moves;
    return Object.keys(moves).length === 0 ? undefined : { ...current, moves };
  }
  const base =
    Object.keys(current.base).length > 0 ? current.base : liveArmorDefs;
  return { base, moves: { ...current.moves, [unitKey]: target } };
}

/** One thing wrong with a definition, for the same rendering `RefProblem`
 *  already has in `WeaponSlotsPanel`. */
export interface ArmorProblem {
  /** Stable within a report, so React can key on it and a test can name one. */
  id: string;
  message: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The keys of a weapon's `damage` table that name no armour class, in the game
 * or in the project's own moves.
 *
 * `"default"` is never one of them: it is the engine's own distinguished key,
 * matched literally rather than against the class list (`WeaponDef.cpp` reads
 * it with `GetFloat("default", ...)` before it ever looks at a class name).
 * Every other key is looked up the way `GetTypeFromName` looks it up, case
 * insensitively, and one that resolves to nothing is not an error the game
 * reports: it is silently read as the default damage instead, which is why
 * this has to be a coilbox check rather than something the game would catch
 * first.
 */
export function unknownDamageClasses(
  def: Record<string, unknown> | undefined,
  knownClasses: readonly string[],
  holder: string,
): ArmorProblem[] {
  if (!def) return [];
  const damageKey = Object.keys(def).find((k) => k.toLowerCase() === "damage");
  const damage = damageKey === undefined ? undefined : def[damageKey];
  if (!isPlainObject(damage)) return [];
  const known = new Set(knownClasses.map((c) => c.toLowerCase()));
  known.add("default");
  const out: ArmorProblem[] = [];
  for (const key of Object.keys(damage)) {
    if (known.has(key.toLowerCase())) continue;
    out.push({
      id: `${holder}:damage:${key}`,
      message: `${holder}'s damage table names ${key}, which is not an armour class in this game or in the project. The engine reads an unknown class as the default damage instead, so this row has no effect.`,
    });
  }
  return out;
}
