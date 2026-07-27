import { describe, expect, it } from "vitest";

import {
  clampAwayMinutes,
  DEFAULT_AUTO_AWAY_MINUTES,
  isIdle,
  MAX_AUTO_AWAY_MINUTES,
  MIN_AUTO_AWAY_MINUTES,
  resolveStatus,
  sameStatus,
} from "./awayStatus";

describe("clampAwayMinutes", () => {
  it("keeps a sensible value", () => {
    expect(clampAwayMinutes(5)).toBe(5);
  });

  it("clamps to the supported range", () => {
    expect(clampAwayMinutes(0)).toBe(MIN_AUTO_AWAY_MINUTES);
    expect(clampAwayMinutes(-3)).toBe(MIN_AUTO_AWAY_MINUTES);
    expect(clampAwayMinutes(9999)).toBe(MAX_AUTO_AWAY_MINUTES);
  });

  it("rounds fractional minutes", () => {
    expect(clampAwayMinutes(7.4)).toBe(7);
    expect(clampAwayMinutes(7.6)).toBe(8);
  });

  it("falls back to the default for anything unusable", () => {
    // A settings store holds whatever was last written, including a half-typed
    // number field ("" becomes NaN), so every caller goes through this guard.
    expect(clampAwayMinutes(Number.NaN)).toBe(DEFAULT_AUTO_AWAY_MINUTES);
    expect(clampAwayMinutes(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_AUTO_AWAY_MINUTES,
    );
    expect(clampAwayMinutes("10")).toBe(DEFAULT_AUTO_AWAY_MINUTES);
    expect(clampAwayMinutes(null)).toBe(DEFAULT_AUTO_AWAY_MINUTES);
    expect(clampAwayMinutes(undefined)).toBe(DEFAULT_AUTO_AWAY_MINUTES);
  });
});

describe("isIdle", () => {
  const MINUTE = 60_000;

  it("is false before the threshold", () => {
    expect(isIdle(1000, 1000 + 9 * MINUTE, 10)).toBe(false);
  });

  it("is true once the threshold is reached", () => {
    expect(isIdle(1000, 1000 + 10 * MINUTE, 10)).toBe(true);
    expect(isIdle(1000, 1000 + 30 * MINUTE, 10)).toBe(true);
  });

  it("treats a clock that jumped backwards as activity", () => {
    expect(isIdle(1000, 500, 10)).toBe(false);
  });
});

describe("resolveStatus", () => {
  it("is online when active and nothing is set", () => {
    expect(
      resolveStatus({ ingame: false, manualAway: false, idle: false }),
    ).toEqual({ ingame: false, away: false });
  });

  it("goes away on idle", () => {
    expect(
      resolveStatus({ ingame: false, manualAway: false, idle: true }),
    ).toEqual({ ingame: false, away: true });
  });

  it("keeps a manual away through activity", () => {
    expect(
      resolveStatus({ ingame: false, manualAway: true, idle: false }),
    ).toEqual({ ingame: false, away: true });
  });

  it("never auto-aways while in-game", () => {
    // The engine owns the keyboard while a game runs, so the webview sees no
    // input at all. Without this every match would report the player as away.
    expect(
      resolveStatus({ ingame: true, manualAway: false, idle: true }),
    ).toEqual({ ingame: true, away: false });
  });

  it("still honours a manual away while in-game", () => {
    expect(
      resolveStatus({ ingame: true, manualAway: true, idle: false }),
    ).toEqual({ ingame: true, away: true });
  });
});

describe("sameStatus", () => {
  it("compares both bits", () => {
    const a = { ingame: false, away: false };
    expect(sameStatus(a, { ingame: false, away: false })).toBe(true);
    expect(sameStatus(a, { ingame: false, away: true })).toBe(false);
    expect(sameStatus(a, { ingame: true, away: false })).toBe(false);
  });
});
