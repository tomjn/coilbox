/**
 * Which of a game's buildings are which side's version of the same thing (issue
 * #1468).
 *
 * `./substitution.ts` suggests a substitute by swapping a side's prefix off a
 * def, and says plainly that it is reading meaning off a name. It is right often
 * enough to keep, because games in the Total Annihilation line name a side's
 * buildings for what they do. It is also wrong or silent for a lot of them, and
 * silent for almost every mobile unit, because those are named for what they
 * are: Armada's Pawn is `armpw` and Cortex's answer to it is `corak`, and no
 * amount of reading `armpw` reaches `corak`.
 *
 * The fix is a table, and the honest question is where a table comes from.
 *
 * ## Where a table comes from
 *
 * From the person, one answer at a time, kept for the game they answered about.
 * Every other route was looked at and none of them work:
 *
 * - Coilbox cannot compute one. Two sides' equivalents are a design decision
 *   made by whoever made the game, and nothing in a unit's data says which
 *   building on the other side is meant to answer it.
 * - Coilbox shipping one per game is a table per game per release, kept by
 *   people who do not play most of those games, going stale every time a game
 *   renames a unit. It also says nothing at all about the mods, which are most
 *   of what this app is for.
 * - Reading one out of the game is worth having and is not the fix. Beyond All
 *   Reason ships the only one anybody has, and coilbox now reads it on being
 *   asked to: `./shippedEquivalents.ts`. It covers 87 categories, all of them
 *   buildings bar the commander, so it does not reach the queued units that are
 *   the actual gap, and it is one game.
 *
 * A person's own answers cost nothing to be right, are corrigible by
 * definition because correcting one is how they are made, and are the only route
 * that ever reaches `corak`. Converting the first layout of a game is the same
 * work it was before. Converting the second is nearly free, and the tenth is
 * free.
 *
 * ## The shape
 *
 * A group is one thing the game has a version of per side, keyed by the side's
 * own name: `{ Armada: "armsolar", Cortex: "corsolar", Legion: "legsolar" }`.
 * Same shape BAR arrived at independently, and it is the right one for a reason:
 * a game with three sides needs one group rather than six pairs, and a game that
 * gains a fourth side gains a key rather than a rewrite.
 *
 * Nothing here answers when it cannot. A def two groups disagree about has no
 * answer rather than the first answer found, because a wrong substitution is
 * worse than none: it silently changes what a base builds.
 *
 * Pure values. Where a table is kept is `./equivalentsStore.ts`, and it is kept
 * per game and per machine: it is a fact about the game rather than about any
 * layout, so it never travels with a shared one.
 */

/** One thing a game has a version of per side, by the side's own name. Defs are
 *  lower case, because a def is written however its author felt like. */
export type Equivalence = Record<string, string>;

/** Everything a person has said about one game. */
export interface EquivalenceTable {
  groups: Equivalence[];
}

/** A game nobody has answered anything about yet. */
export const NO_EQUIVALENTS: EquivalenceTable = { groups: [] };

/** Every group holding this def, under any side. */
function groupsHolding(def: string, table: EquivalenceTable): Equivalence[] {
  const name = def.trim().toLowerCase();
  if (name === "") return [];
  return table.groups.filter((group) => Object.values(group).includes(name));
}

/**
 * What this def is on that side, or nothing.
 *
 * Nothing covers three different things, and they are all the same answer to a
 * caller: a def the table has never been told about, a side it has not been told
 * about, and a def whose groups disagree about the answer. The last is the one
 * worth the rule: a def can honestly sit in two groups, because a game really
 * does give two of its things one shared building, and there is then no single
 * answer to give.
 */
export function equivalentOf(
  def: string,
  toSide: string,
  table: EquivalenceTable,
): string | undefined {
  const side = toSide.trim();
  const answers = new Set(
    groupsHolding(def, table)
      .map((group) => group[side])
      .filter((answer) => answer !== undefined),
  );
  return answers.size === 1 ? [...answers][0] : undefined;
}

/**
 * Which side this def is, according to what a person has said.
 *
 * The half of a table `./substitution.ts` cannot get from a name at all. A game
 * whose sides share no naming gets no prefixes, so nothing there can tell whose
 * a building is, and this can: somebody said so.
 */
export function sideOfDefInTable(
  def: string,
  table: EquivalenceTable,
): string | undefined {
  const name = def.trim().toLowerCase();
  const sides = new Set<string>();
  for (const group of groupsHolding(def, table)) {
    for (const [side, held] of Object.entries(group)) {
      if (held === name) sides.add(side);
    }
  }
  return sides.size === 1 ? [...sides][0] : undefined;
}

/** Every side this table has been told about, in the order it was first told.
 *  A game whose sides coilbox cannot read off its unit names still has these. */
export function tableSides(table: EquivalenceTable): string[] {
  const out: string[] = [];
  for (const group of table.groups) {
    for (const side of Object.keys(group)) {
      if (!out.includes(side)) out.push(side);
    }
  }
  return out;
}

/** How many defs this table can answer for, which is what says whether it is
 *  worth mentioning to anybody. */
export function coveredDefs(table: EquivalenceTable): number {
  return new Set(table.groups.flatMap((group) => Object.values(group))).size;
}

/**
 * The table with one more thing said about it: that on `fromSide` this game
 * calls it `fromDef`, and on `toSide` it calls it `toDef`.
 *
 * The pair joins whatever group already holds either def, so answering that
 * `armpw` is `corak` and later that `armpw` is `legpw` leaves one thing with
 * three names rather than two things with two. Answering a third time overwrites
 * that side's name, because that is what correcting one looks like.
 *
 * Nothing is learned from a pair that says nothing: a def standing in for
 * itself, one side standing in for itself, or a blank.
 */
export function learnEquivalence(
  table: EquivalenceTable,
  fromSide: string,
  fromDef: string,
  toSide: string,
  toDef: string,
): EquivalenceTable {
  const from = fromSide.trim();
  const to = toSide.trim();
  const was = fromDef.trim().toLowerCase();
  const now = toDef.trim().toLowerCase();
  if (from === "" || to === "" || was === "" || now === "") return table;
  if (from === to || was === now) return table;

  const held = groupsHolding(was, table)[0] ?? groupsHolding(now, table)[0];
  const grown: Equivalence = { ...held, [from]: was, [to]: now };
  return {
    groups: held
      ? table.groups.map((group) => (group === held ? grown : group))
      : [...table.groups, grown],
  };
}

/**
 * This machine's table with a game's own folded into it (issue #1526).
 *
 * A person's answer always wins, because they are the one who plays the game and
 * the game's file is a fact about a version of it. So a side they have already
 * answered for is left exactly as it is, and only the sides they never answered
 * are filled in: somebody who has said Armada's annihilator is Cortex's shipyard
 * keeps that, and still gains Legion's from the game.
 *
 * A group two of their groups both claim is left alone entirely. That is the
 * same rule as everywhere else here: two answers is no answer, and merging into
 * one of them at random would silently change what a base builds.
 *
 * The same table back, unchanged, when there is nothing to add, so reading a
 * game's file twice writes nothing the second time.
 */
export function mergeEquivalents(
  mine: EquivalenceTable,
  theirs: EquivalenceTable,
): EquivalenceTable {
  const groups = [...mine.groups];
  let grew = false;

  for (const group of theirs.groups) {
    const defs = Object.values(group);
    const holding = groups.filter((held) =>
      Object.values(held).some((def) => defs.includes(def)),
    );
    if (holding.length > 1) continue;

    if (holding.length === 0) {
      groups.push({ ...group });
      grew = true;
      continue;
    }

    const held = holding[0];
    const added = Object.fromEntries(
      Object.entries(group).filter(([side]) => held[side] === undefined),
    );
    if (Object.keys(added).length === 0) continue;
    groups[groups.indexOf(held)] = { ...held, ...added };
    grew = true;
  }

  return grew ? { groups } : mine;
}

/**
 * A table read back off disk, with everything unreadable dropped.
 *
 * A group of one is dropped rather than kept, because a group is a comparison
 * and one name compares to nothing. Storage is a place a person can edit by
 * hand and a place an older coilbox wrote, so nothing here trusts what it finds.
 */
export function parseEquivalenceTable(value: unknown): EquivalenceTable {
  if (typeof value !== "object" || value === null) return NO_EQUIVALENTS;
  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return NO_EQUIVALENTS;

  const out: Equivalence[] = [];
  for (const group of groups) {
    if (typeof group !== "object" || group === null) continue;
    const kept: Equivalence = {};
    for (const [side, def] of Object.entries(
      group as Record<string, unknown>,
    )) {
      if (typeof def !== "string") continue;
      const name = def.trim().toLowerCase();
      if (side.trim() === "" || name === "") continue;
      kept[side] = name;
    }
    if (Object.keys(kept).length >= 2) out.push(kept);
  }
  return { groups: out };
}
