/**
 * Where a game's equivalence table is kept (issue #1468).
 *
 * Beside the notification history and the container shortnames, in this
 * machine's storage, one table per game. Three things follow from that, and all
 * three were the questions worth settling before any of it was written:
 *
 * - It is per person. Nobody has to be given a table before they can convert
 *   anything, and nobody is stuck with somebody else's idea of which building
 *   answers which.
 * - It is corrigible, because correcting one is how it is made. Picking a
 *   different substitute for a def is a correction, and the next layout of that
 *   game gets the corrected answer. It is also readable and droppable on the
 *   game's own page, which is where somebody who suspects a wrong answer looks
 *   rather than where they were when they gave it (issue #1533).
 * - It never travels with a shared layout. A layout carries what it is made of
 *   and a table is a fact about the game, so the two are kept apart on purpose:
 *   see `./transfer.ts`, which has no idea this file exists.
 *
 * Keyed by the game's shortname rather than its archive name, because an archive
 * name moves on every release and a table keyed by one would be thrown away by
 * every update. That is the same reasoning, and the same store, as
 * `../container/shortnames.ts`. A game whose shortname coilbox has never read
 * falls back to its archive name, which loses the table on an update and is
 * still better than losing it now.
 */

import { useCallback, useEffect, useState } from "react";

import { carriedShortname, rememberedShortname } from "../container/shortnames";
import {
  coveredDefs,
  type EquivalenceTable,
  learnEquivalence,
  mergeEquivalents,
  NO_EQUIVALENTS,
  parseEquivalenceTable,
} from "./equivalents";

/** Where the tables are kept. */
const STORAGE_KEY = "coilbox.blueprint.equivalents";

function load(): Map<string, EquivalenceTable> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null) return new Map();
    return new Map(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        parseEquivalenceTable(value),
      ]),
    );
  } catch {
    return new Map();
  }
}

let tables = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(tables)),
    );
  } catch {
    // No storage. This session still learns, it simply teaches the next one
    // nothing.
  }
}

/**
 * What to key a game's table by.
 *
 * Empty for no game at all, which is a caller with nothing to look a table up
 * with rather than a game with an empty one. Lower case because an archive name
 * is written however the person who packaged it felt like.
 */
export function equivalentsKey(gameArchive: string | undefined): string {
  const name = (gameArchive ?? "").trim();
  if (name === "") return "";
  return (
    rememberedShortname(name) ?? carriedShortname(name) ?? name.toLowerCase()
  );
}

/** Everything said about this game, or an empty table for one nobody has said
 *  anything about. */
export function equivalentsFor(key: string): EquivalenceTable {
  return tables.get(key) ?? NO_EQUIVALENTS;
}

/** Hold onto one more answer about a game, and tell every panel showing it. */
export function rememberEquivalence(
  key: string,
  fromSide: string,
  fromDef: string,
  toSide: string,
  toDef: string,
): void {
  if (key === "") return;
  const grown = learnEquivalence(
    equivalentsFor(key),
    fromSide,
    fromDef,
    toSide,
    toDef,
  );
  if (grown === equivalentsFor(key)) return;
  tables.set(key, grown);
  persist();
  for (const listener of listeners) listener();
}

/**
 * Fold a game's own published table into this game's, and tell every panel
 * showing it (issue #1526).
 *
 * How many more defs it can answer for than it could before, which is the only
 * honest measure of what reading the game's file bought: most of what one says
 * is what the naming route was already right about.
 */
export function rememberShippedEquivalents(
  key: string,
  theirs: EquivalenceTable,
): number {
  if (key === "") return 0;
  const was = equivalentsFor(key);
  const grown = mergeEquivalents(was, theirs);
  if (grown === was) return 0;
  tables.set(key, grown);
  persist();
  for (const listener of listeners) listener();
  return coveredDefs(grown) - coveredDefs(was);
}

/**
 * Drop one of a game's pairings (issue #1533).
 *
 * By where it stands in the table, because that is what a list of them has to
 * name one by: a group holds no id, and naming one by a def it holds picks two
 * groups on the one case where two of them disagree, which is exactly the case
 * somebody is here to sort out.
 *
 * Dropping it rather than editing it is the whole correction. The next
 * conversion of this game asks the question again, and the answer given then is
 * the one that is kept.
 */
export function forgetEquivalence(key: string, at: number): void {
  const was = equivalentsFor(key);
  if (key === "" || at < 0 || at >= was.groups.length) return;
  tables.set(key, {
    groups: was.groups.filter((_, index) => index !== at),
  });
  persist();
  for (const listener of listeners) listener();
}

/** Drop everything said about one game, for somebody who would rather start
 *  again than pick through it. Every other game is untouched. */
export function forgetEquivalents(key: string): void {
  if (key === "" || !tables.has(key)) return;
  tables.delete(key);
  persist();
  for (const listener of listeners) listener();
}

/** Forget the lot. For tests, which each want to start from nothing. */
export function resetEquivalents(): void {
  tables = new Map();
}

/** Start from what storage holds now, after a test has stubbed it. */
export function loadEquivalents(): void {
  tables = load();
}

/**
 * This game's table, kept in step with anything learned anywhere else.
 *
 * Takes the archive name every caller already resolved to get the game's units,
 * so no surface has to know how a table is keyed.
 */
export function useEquivalents(gameArchive: string | undefined): {
  table: EquivalenceTable;
  /** Hold onto one answer about this game. */
  remember: (
    fromSide: string,
    fromDef: string,
    toSide: string,
    toDef: string,
  ) => void;
  /** Drop the pairing standing at this place in the table (issue #1533). */
  forget: (at: number) => void;
  /** Drop everything said about this game. */
  forgetAll: () => void;
} {
  const key = equivalentsKey(gameArchive);
  const [table, setTable] = useState(() => equivalentsFor(key));

  useEffect(() => {
    const listener = () => setTable(equivalentsFor(key));
    listener();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [key]);

  const remember = useCallback(
    (fromSide: string, fromDef: string, toSide: string, toDef: string) =>
      rememberEquivalence(key, fromSide, fromDef, toSide, toDef),
    [key],
  );
  const forget = useCallback((at: number) => forgetEquivalence(key, at), [key]);
  const forgetAll = useCallback(() => forgetEquivalents(key), [key]);

  return { table, remember, forget, forgetAll };
}
