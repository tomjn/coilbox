/**
 * How much a client will write to the hub for one game in an hour (issue #1636).
 *
 * The hub has its own limit and refuses past it, so the reason for one here is
 * not that the hub cannot defend itself. It is that finding out by being refused
 * has already spent the request, and a refusal costs the account a 429 that ends
 * the whole run. Staying under the hub's number means coilbox never has to learn
 * it the expensive way.
 *
 * The failure being prevented is bigger than the request, though. Every accepted
 * upload spends a storage operation out of an allowance the whole community
 * shares, and running out is thirty days with no uploads at all and no way to pay
 * through it. A client that walked a roster would spend it for everybody.
 *
 * ## What is counted
 *
 * Rows the hub actually took, per game, over a rolling hour. Not runs and not
 * pictures offered: a blueprint whose units the hub already holds asks a question
 * and writes nothing, and charging that against a limit would punish exactly the
 * behaviour the have check exists to encourage.
 *
 * ## Where it lives
 *
 * `localStorage`, under one key, as a map of game to the times it was written
 * for. Stored rather than held in memory, because a limit a restart clears is not
 * a limit: relaunching the app is not slow, and a loop that trips this once would
 * trip it once per launch for ever.
 *
 * `localStorage` rather than the settings file, for the reason the shortname
 * store gives: this is a machine-scoped record and not a preference anybody sets.
 * Two installs on one machine share it, which here is right rather than a leak,
 * since they share the hub account and therefore share its limit.
 *
 * Nothing is cached in this module. It is read on every question and written on
 * every run, both of which happen once per blueprint opened, and holding it would
 * mean a second window onto the same file that only one of them writes.
 *
 * Times rather than a count and a window start, because a fixed window lets twice
 * the limit through across a boundary. Eighty numbers a game is nothing to store
 * and the arithmetic is a filter.
 */

/**
 * How many pictures coilbox will write for one game in a rolling hour.
 *
 * The hub's own `SUBJECT_UPLOADS_PER_HOUR` is 100, so this leaves room for the
 * hub to still be the authority on anything this misses, including uploads made
 * by another install signed in to the same account.
 *
 * Eighty against real use: a blueprint of 10 to 30 buildings is 20 to 60 pictures
 * at both variants, so a whole one always fits and it is a second one in the same
 * hour that runs out. A second blueprint of the same game is mostly the same
 * buildings, which the have check answers for nothing, so what actually gets
 * stopped here is a client uploading eighty distinct new pictures for one game in
 * an hour. Nothing that reads a blueprint does that.
 */
export const WRITES_PER_GAME_PER_HOUR = 80;

/** How many pictures one unit can produce, which is a build pic and a render.
 *  A run reserves this much budget per unit before it starts, so it can never
 *  finish over the limit. */
export const VARIANTS_PER_UNIT = 2;

/** The window the limit is over. */
export const WINDOW_MS = 60 * 60 * 1000;

/** Where the ledger is kept. Mirrored nowhere: this is the only reader. */
export const BACKFILL_LEDGER_KEY = "coilbox.hub.assetBackfill";

/**
 * When each picture was written, per game shortname. Epoch milliseconds, oldest
 * first, and never longer than the window because {@link recordWrites} prunes on
 * every write.
 */
export type BackfillLedger = Record<string, number[]>;

/** How many writes this game has had inside the window. */
export function spent(
  ledger: BackfillLedger,
  game: string,
  now: number,
): number {
  return (ledger[game] ?? []).filter((at) => now - at < WINDOW_MS).length;
}

/** How many more this game may have. Never negative, so a ledger written by a
 *  build with a higher limit reads as nothing left rather than as credit. */
export function remaining(
  ledger: BackfillLedger,
  game: string,
  now: number,
): number {
  return Math.max(0, WRITES_PER_GAME_PER_HOUR - spent(ledger, game, now));
}

/**
 * How many units a run may work on, from what is left.
 *
 * Applied before anything is read, rendered or asked about, because that is the
 * only place it can stop work rather than waste it. Each unit is reserved its
 * full {@link VARIANTS_PER_UNIT}, which over-reserves for a unit whose pictures
 * the hub turns out to already hold, and over-reserving is the direction that
 * cannot end in a refusal.
 */
export function unitsAffordable(
  ledger: BackfillLedger,
  game: string,
  now: number,
): number {
  return Math.floor(remaining(ledger, game, now) / VARIANTS_PER_UNIT);
}

/**
 * Add `count` writes for this game, and drop everything that has fallen out of
 * the window.
 *
 * Hands back a new ledger, and the same one when there is nothing to change, so
 * a caller folding this through `updateStoredSetting` does not write on every
 * run that uploaded nothing.
 *
 * Pruning covers every game rather than the one being written, because a game
 * nobody has opened since is exactly the entry that would otherwise sit there for
 * ever.
 */
export function recordWrites(
  ledger: BackfillLedger,
  game: string,
  count: number,
  now: number,
): BackfillLedger {
  const pruned: BackfillLedger = {};
  let changed = false;
  for (const [name, times] of Object.entries(ledger)) {
    const kept = times.filter((at) => now - at < WINDOW_MS);
    if (kept.length !== times.length) changed = true;
    if (kept.length > 0) pruned[name] = kept;
  }
  if (count <= 0) return changed ? pruned : ledger;
  pruned[game] = [...(pruned[game] ?? []), ...Array(count).fill(now)];
  return pruned;
}

/**
 * The ledger as an earlier session left it.
 *
 * Guarded the way every other `localStorage` reader here is: a webview with
 * storage off, a node test environment, and text that is no longer JSON all read
 * as an empty ledger. That direction is deliberate. A ledger nobody can read
 * means the limit stops biting, which allows a run, and the hub's own limit is
 * still underneath it. Refusing instead would mean a corrupt file switching
 * backfill off for good with nothing on screen to say so.
 */
export function readLedger(): BackfillLedger {
  try {
    const raw = localStorage.getItem(BACKFILL_LEDGER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const ledger: BackfillLedger = {};
    for (const [game, times] of Object.entries(parsed)) {
      if (Array.isArray(times)) {
        ledger[game] = times.filter(
          (at): at is number => typeof at === "number",
        );
      }
    }
    return ledger;
  } catch {
    return {};
  }
}

/** How many units a run for this game may work on right now. */
export function unitsAffordableNow(game: string, now = Date.now()): number {
  return unitsAffordable(readLedger(), game, now);
}

/** Charge a finished run's writes against this game and store the result. */
export function recordBackfillWrites(
  game: string,
  count: number,
  now = Date.now(),
): void {
  const before = readLedger();
  const after = recordWrites(before, game, count, now);
  if (after === before) return;
  try {
    localStorage.setItem(BACKFILL_LEDGER_KEY, JSON.stringify(after));
  } catch {
    // No storage. The run still happened and the hub's own limit is still
    // there, it simply teaches the next launch nothing.
  }
}
