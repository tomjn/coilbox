/**
 * The movement classes a game declares, so the field is picked rather than
 * typed (issue #2651).
 *
 * A movement class names an entry in the game's own move definitions, and the
 * engine drops a unit whose `canMove` is set and whose class does not resolve.
 * That failure is the reason the lego builder writes `canmove = false` and
 * leaves the class out: it is a game-independent tool with nothing to name.
 * From here there is a game, so there is something to name, and a list is the
 * only honest way to offer it. Typing a class is guessing at another file's
 * spelling, and the only report you get is a unit that is not in the game.
 *
 * Read off the game's own units rather than out of `gamedata/movedefs.lua`,
 * for two reasons. Nothing in coilbox reads that file, so there is no reader to
 * ask, and the workshop already holds every unit definition in the game, so
 * this costs one pass over a table that is already in memory. It is also the
 * stronger guarantee of the two: a class some unit in this game already moves
 * on is one the engine has resolved, where a class declared in a file may be
 * declared and unreachable. What it misses is a class no unit uses, which is a
 * class nothing can vouch for, and the field stays typeable for anyone who
 * knows one is there.
 *
 * Keys arrive lowercased from `gamedata/defs.lua`, so the read is case
 * insensitive the way every other field lookup in the workshop is. Values are
 * not: a class name is matched against the move definitions by whatever the
 * game wrote, and folding its case here would offer a name the engine may not
 * accept.
 */

/** One class, and how much of the game is already using it. */
export interface MoveClass {
  /** The name, exactly as the game's units spell it. */
  name: string;
  /** How many units in the game declare it. */
  units: number;
}

/** A def's value for `key`, whatever case the game wrote the key in. */
function field(def: Record<string, unknown> | undefined, key: string): unknown {
  if (!def) return undefined;
  for (const [k, value] of Object.entries(def)) {
    if (k.toLowerCase() === key) return value;
  }
  return undefined;
}

/**
 * A unit definition's flag, as the engine reads one.
 *
 * `true`, `1` and `"1"` all reach here: a game writes Lua booleans in some
 * files and the numbers it inherited from a `.fbi` in others, and the engine's
 * own `GetBool` takes either.
 */
function flag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text === "true" || text === "1";
  }
  return false;
}

/**
 * Whether the movement class is a field worth showing for this unit.
 *
 * A definition that says anything at all about moving, either way, is one whose
 * class is a live question, and a unit that has never mentioned it is a
 * building nobody is going to drive. The distinction matters because the
 * relevant view otherwise hides a field the definition does not declare, and
 * for this field not being declared is the whole problem: a unit built in the
 * lego builder arrives with `canmove = false` and no class at all, and hiding
 * the class would hide the one edit that turns it into a unit somebody can
 * drive (issues #663 and #2651).
 */
export function asksAboutMovement(
  def: Record<string, unknown> | undefined,
): boolean {
  if (flag(field(def, "canfly"))) return false;
  return (
    field(def, "canmove") !== undefined ||
    field(def, "movementclass") !== undefined
  );
}

/**
 * What is wrong with this unit's movement, said where the class is picked.
 *
 * Both halves have to agree or the unit is not the unit somebody meant, and
 * neither says so anywhere a person would see. A moving unit with no class is
 * dropped at load by `UnitDefHandler`, which is the failure #663 recorded, and
 * a class on a unit that does not move is a field with no effect, which is
 * quieter and just as wrong. A flier resolves neither against the move
 * definitions, so it is asked about neither.
 */
export function moveClassProblem(
  def: Record<string, unknown> | undefined,
): string | undefined {
  if (flag(field(def, "canfly"))) return undefined;
  const moves = flag(field(def, "canmove"));
  const named = moveClassOf(def) !== "";
  if (moves && !named)
    return "This unit moves but names no movement class, so the engine drops it at load. Pick one.";
  if (named && !moves)
    return "This unit does not move, so the class has no effect until Can move is on.";
  return undefined;
}

/** Whatever a def calls its movement class, or nothing. */
export function moveClassOf(def: Record<string, unknown> | undefined): string {
  const value = field(def, "movementclass");
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Every movement class the game's units name, commonest first and then
 * alphabetically.
 *
 * Commonest first because a game's classes are not a flat list of equals: BA
 * has a handful that most of the army uses and a long tail of one-offs, and the
 * one somebody wants for a new tank is near the top of the first group. Ties
 * break on the name so the order does not shuffle between reads.
 */
export function moveClassesOf(
  units: Record<string, Record<string, unknown>>,
): MoveClass[] {
  const counts = new Map<string, number>();
  for (const def of Object.values(units)) {
    const name = moveClassOf(def);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, units]) => ({ name, units }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}
