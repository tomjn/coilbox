/**
 * Converting between what a restrictions editor shows and what a mission stores.
 *
 * The editor ticks the units a mission allows, because "everything, minus these"
 * is how an author thinks about a restriction and because a screen of empty boxes
 * says the opposite of what it means (#1051). A mission stores the bans, as
 * `disabledUnits`, and the engine reads them, so the complement is taken at the
 * edge and nothing on disk changes.
 *
 * Ids are compared lowercased, matching the dataset the picker lists.
 */

/** Units the editor should tick: everything the game has, minus what is banned. */
export function allowedFromBans(known: string[], bans: string[]): string[] {
  const banned = new Set(bans.map((b) => b.toLowerCase()));
  return known.filter((id) => !banned.has(id.toLowerCase()));
}

/**
 * The bans a ticked set implies.
 *
 * `bans` is the mission's current set, and any entry naming a unit this game does
 * not have is carried through untouched: it is not a box anyone could tick, and
 * dropping it would quietly rewrite a mission authored against another game.
 */
export function bansFromAllowed(
  known: string[],
  allowed: string[],
  bans: string[],
): string[] {
  const knownIds = new Set(known.map((id) => id.toLowerCase()));
  const ticked = new Set(allowed.map((id) => id.toLowerCase()));
  const kept = bans.filter((b) => !knownIds.has(b.toLowerCase()));
  return [...kept, ...known.filter((id) => !ticked.has(id.toLowerCase()))];
}
