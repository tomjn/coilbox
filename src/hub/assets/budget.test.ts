import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BACKFILL_LEDGER_KEY,
  type BackfillLedger,
  readLedger,
  recordBackfillWrites,
  recordWrites,
  remaining,
  spent,
  unitsAffordable,
  unitsAffordableNow,
  VARIANTS_PER_UNIT,
  WINDOW_MS,
  WRITES_PER_GAME_PER_HOUR,
} from "./budget";

/** The node test environment has no `localStorage`, so this is one, and it is
 *  also what a restart is simulated with: the file survives, the module does
 *  not. */
function installStorage(seed: Record<string, string> = {}) {
  const entries = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  });
  return entries;
}

const NOW = 1_700_000_000_000;

/** A ledger with `count` writes for `game`, all just now. */
function ledgerOf(game: string, count: number, at = NOW): BackfillLedger {
  return { [game]: Array(count).fill(at) };
}

describe("the ledger's arithmetic", () => {
  it("counts only what is inside the window", () => {
    const ledger: BackfillLedger = {
      bar: [NOW - WINDOW_MS - 1, NOW - WINDOW_MS, NOW - 1000, NOW],
    };
    expect(spent(ledger, "bar", NOW)).toBe(2);
    expect(remaining(ledger, "bar", NOW)).toBe(WRITES_PER_GAME_PER_HOUR - 2);
  });

  it("is per game, so one game's spending does not touch another's", () => {
    const ledger = ledgerOf("bar", WRITES_PER_GAME_PER_HOUR);
    expect(remaining(ledger, "bar", NOW)).toBe(0);
    expect(remaining(ledger, "xta", NOW)).toBe(WRITES_PER_GAME_PER_HOUR);
  });

  it("never reads as credit, however much a ledger claims", () => {
    const ledger = ledgerOf("bar", WRITES_PER_GAME_PER_HOUR + 50);
    expect(remaining(ledger, "bar", NOW)).toBe(0);
    expect(unitsAffordable(ledger, "bar", NOW)).toBe(0);
  });

  /** The reservation is per unit at both variants, and applied before anything
   *  is read, so a run can never finish over the limit. */
  it("reserves a whole unit's worth of pictures per unit", () => {
    const spentAlready = WRITES_PER_GAME_PER_HOUR - 5;
    const ledger = ledgerOf("bar", spentAlready);
    expect(remaining(ledger, "bar", NOW)).toBe(5);
    expect(unitsAffordable(ledger, "bar", NOW)).toBe(
      Math.floor(5 / VARIANTS_PER_UNIT),
    );
  });

  it("rolls, so writes at the far end of the window fall out one by one", () => {
    const ledger: BackfillLedger = {
      bar: [NOW - 50 * 60 * 1000, NOW - 10 * 60 * 1000],
    };
    expect(spent(ledger, "bar", NOW)).toBe(2);
    // Twenty minutes later the first has aged out and the second has not.
    expect(spent(ledger, "bar", NOW + 20 * 60 * 1000)).toBe(1);
  });

  it("prunes what has aged out, including for games nobody is writing", () => {
    const ledger: BackfillLedger = {
      bar: [NOW - WINDOW_MS - 1],
      xta: [NOW - 1000],
    };
    const after = recordWrites(ledger, "xta", 1, NOW);
    expect(after.bar).toBeUndefined();
    expect(after.xta).toHaveLength(2);
  });

  it("hands back the same ledger when there is nothing to change", () => {
    const ledger = ledgerOf("bar", 2);
    expect(recordWrites(ledger, "bar", 0, NOW)).toBe(ledger);
  });
});

describe("the stored ledger", () => {
  beforeEach(() => installStorage());
  afterEach(() => vi.unstubAllGlobals());

  it("charges a run's writes and reads them back", () => {
    expect(unitsAffordableNow("bar", NOW)).toBe(
      Math.floor(WRITES_PER_GAME_PER_HOUR / VARIANTS_PER_UNIT),
    );
    recordBackfillWrites("bar", 24, NOW);
    expect(spent(readLedger(), "bar", NOW)).toBe(24);
    expect(unitsAffordableNow("bar", NOW)).toBe(
      Math.floor((WRITES_PER_GAME_PER_HOUR - 24) / VARIANTS_PER_UNIT),
    );
  });

  it("writes nothing for a run that uploaded nothing", () => {
    recordBackfillWrites("bar", 0, NOW);
    expect(readLedger()).toEqual({});
  });

  /**
   * The one property a rate limit has to have. The stored file is the same one,
   * the module is loaded fresh, and the limit still bites: nothing about it is
   * held in memory.
   */
  it("holds across a restart", async () => {
    const stored = installStorage();
    recordBackfillWrites("bar", WRITES_PER_GAME_PER_HOUR, NOW);
    expect(unitsAffordableNow("bar", NOW)).toBe(0);

    vi.resetModules();
    installStorage(Object.fromEntries(stored));
    const relaunched = await import("./budget");

    expect(relaunched.unitsAffordableNow("bar", NOW)).toBe(0);
    // And it lets go again once the hour is up, rather than being a lifetime cap.
    expect(relaunched.unitsAffordableNow("bar", NOW + WINDOW_MS)).toBe(
      Math.floor(WRITES_PER_GAME_PER_HOUR / VARIANTS_PER_UNIT),
    );
  });

  it("reads a ledger nobody can parse as an empty one", () => {
    installStorage({ [BACKFILL_LEDGER_KEY]: "{ not json" });
    expect(readLedger()).toEqual({});
    installStorage({ [BACKFILL_LEDGER_KEY]: '["not a map"]' });
    expect(readLedger()).toEqual({});
  });

  it("survives a webview with no storage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readLedger()).toEqual({});
    expect(() => recordBackfillWrites("bar", 3, NOW)).not.toThrow();
  });
});
