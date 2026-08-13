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
 * own name. Same shape BAR arrived at independently, and it is the right one for
 * a reason: a game with three sides needs one group rather than six pairs, and a
 * game that gains a fourth side gains a key rather than a rewrite.
 *
 * Each side's answer carries where it came from with it (issue #1537), so a
 * group is `{ Armada: { def: "armsolar", from: "you" }, ... }`. Per answer
 * rather than per group, because merging a game's own table fills in the sides a
 * person never answered for and leaves the ones they did, so a group really is
 * part theirs and part the game's and there is no one true source to give it.
 *
 * Nothing here answers when it cannot. A def two groups disagree about has no
 * answer rather than the first answer found, because a wrong substitution is
 * worse than none: it silently changes what a base builds.
 *
 * Pure values. Where a table is kept is `./equivalentsStore.ts`, and it is kept
 * per game and per machine: it is a fact about the game rather than about any
 * layout, so it never travels with a shared one.
 */

/**
 * Where one answer came from (issue #1537).
 *
 * Two rather than three. A pair picked by hand in a conversion and a pair
 * suggested and then applied both reach here through the same call, because in
 * both a person looked at the suggestion and said yes, and that is the thing
 * being recorded: that somebody who plays the game agreed to it.
 */
export type EquivalenceSource = "you" | "game";

/**
 * What one side calls a thing, and where coilbox got it.
 *
 * The source lives inside the answer rather than beside it, because a group is
 * keyed by the game's own side names and a game is free to call a side
 * anything, "source" included. Nothing can be added alongside those keys
 * without a game being able to collide with it, so nothing is.
 *
 * No source at all is a real state and means nobody can say: a table an older
 * coilbox wrote holds the def and not where it came from, and inventing one
 * would be worse than admitting it.
 */
export interface SideDef {
  /** Lower case, because a def is written however its author felt like. */
  def: string;
  from?: EquivalenceSource;
}

/** One thing a game has a version of per side, by the side's own name. */
export type Equivalence = Record<string, SideDef>;

/** Everything a person has said about one game. */
export interface EquivalenceTable {
  groups: Equivalence[];
}

/** A game nobody has answered anything about yet. */
export const NO_EQUIVALENTS: EquivalenceTable = { groups: [] };

/** What this group says that side calls the thing, or nothing. */
export function defIn(group: Equivalence, side: string): string | undefined {
  return group[side.trim()]?.def;
}

/** Where this group's answer for that side came from, or nothing for a side it
 *  has no answer for and for one an older coilbox stored. */
export function sourceIn(
  group: Equivalence,
  side: string,
): EquivalenceSource | undefined {
  return group[side.trim()]?.from;
}

/** Every def this group names, whichever side names it. */
export function defsIn(group: Equivalence): string[] {
  return Object.values(group).map((held) => held.def);
}

/** Every group holding this def, under any side. */
function groupsHolding(def: string, table: EquivalenceTable): Equivalence[] {
  const name = def.trim().toLowerCase();
  if (name === "") return [];
  return table.groups.filter((group) => defsIn(group).includes(name));
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
  const answers = new Set(
    groupsHolding(def, table)
      .map((group) => defIn(group, toSide))
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
      if (held.def === name) sides.add(side);
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
  return new Set(table.groups.flatMap(defsIn)).size;
}

/** The same count, split by whose answer names each def (issue #1544). */
export interface DefsBySource {
  /** Every def, whoever named it, which is `coveredDefs`. */
  all: number;
  you: number;
  game: number;
  /** Defs only an answer from before coilbox recorded any of this names. */
  unsaid: number;
}

/**
 * How many defs this table can answer for and where each of them came from
 * (issue #1544).
 *
 * Per def rather than per answer, because that is what the panels count and a
 * def is one thing whichever group names it. A def two answers name is filed
 * under the more trusted of them, the same order the table itself keeps: a
 * person's answer beats a game's file, and either beats one nobody can account
 * for. So a def somebody answered for is theirs even where a game's file names
 * it as well, and the three counts always add up to `all`.
 */
export function coveredDefsBySource(table: EquivalenceTable): DefsBySource {
  const trust = { you: 2, game: 1, unsaid: 0 };
  const best = new Map<string, number>();
  for (const group of table.groups) {
    for (const held of Object.values(group)) {
      const rank = trust[held.from ?? "unsaid"];
      best.set(held.def, Math.max(best.get(held.def) ?? 0, rank));
    }
  }

  const ranks = [...best.values()];
  return {
    all: ranks.length,
    you: ranks.filter((rank) => rank === trust.you).length,
    game: ranks.filter((rank) => rank === trust.game).length,
    unsaid: ranks.filter((rank) => rank === trust.unsaid).length,
  };
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
 *
 * Both sides of the pair are marked as the person's, including when the pair
 * corrects one a game's file brought: they looked at that answer and replaced
 * it, which makes the new one theirs (issue #1537).
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
  const grown: Equivalence = {
    ...held,
    [from]: { def: was, from: "you" },
    [to]: { def: now, from: "you" },
  };
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
 *
 * Each answer arrives already saying where it came from and is copied as it
 * stands, so a group half of which a person gave and half of which a game's
 * file filled in says exactly that, side by side (issue #1537). Marking the
 * whole group one way would be a lie on every group merging touches, which is
 * every group worth looking at.
 */
export function mergeEquivalents(
  mine: EquivalenceTable,
  theirs: EquivalenceTable,
): EquivalenceTable {
  const groups = [...mine.groups];
  let grew = false;

  for (const group of theirs.groups) {
    const defs = defsIn(group);
    const holding = groups.filter((held) =>
      defsIn(held).some((def) => defs.includes(def)),
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

/** One side's answer read back off disk, or nothing for one that reads as
 *  neither shape.
 *
 * A bare string is what every coilbox before issue #1537 wrote, and it reads
 * back as the answer it is with no source, because there is nobody left to ask
 * where it came from. A source that is not one of the two coilbox writes goes
 * the same way: the answer is still the answer, and only the claim about it is
 * dropped. */
function parseSideDef(value: unknown): SideDef | undefined {
  const held =
    typeof value === "string"
      ? { def: value }
      : typeof value === "object" && value !== null
        ? (value as { def?: unknown; from?: unknown })
        : undefined;
  if (typeof held?.def !== "string") return undefined;

  const def = held.def.trim().toLowerCase();
  if (def === "") return undefined;
  return held.from === "you" || held.from === "game"
    ? { def, from: held.from }
    : { def };
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
      const held = parseSideDef(def);
      if (!held || side.trim() === "") continue;
      kept[side] = held;
    }
    if (Object.keys(kept).length >= 2) out.push(kept);
  }
  return { groups: out };
}
