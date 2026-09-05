import type { GameRef } from "../conquest/model";

/**
 * Compare two game version strings segment-wise (numeric segments compare as
 * numbers, the rest lexically), so "1.10" > "1.9" and "test-26575" >
 * "test-9999". Returns <0, 0 or >0.
 */
export function compareGameVersions(a: string, b: string): number {
  const split = (v: string) => v.split(/(\d+)/).filter((s) => s !== "");
  const as = split(a);
  const bs = split(b);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i] ?? "";
    const y = bs[i] ?? "";
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The minimal shape of an installed game this helper needs (structural
 * subset of `GameItem` from content bindings, to keep this module pure).
 * `shortname` and `version` are read from modinfo metadata. */
export interface InstalledGame {
  name: string;
  info: Record<string, string>;
}

/**
 * Resolve a {@link GameRef} against the installed games. An exact `pinnedName`
 * match wins, otherwise the newest installed version of the shortname
 * (case-insensitive, by {@link compareGameVersions} on modinfo `version`).
 * Returns `undefined` when nothing matches, and the caller shows an install
 * gate.
 */
export function resolveGameByShortname<T extends InstalledGame>(
  game: GameRef,
  installed: T[],
): T | undefined {
  if (game.pinnedName) {
    const pinned = installed.find((g) => g.name === game.pinnedName);
    if (pinned) return pinned;
  }
  const want = game.shortname.trim().toLowerCase();
  let best: T | undefined;
  for (const g of installed) {
    if ((g.info.shortname ?? "").trim().toLowerCase() !== want) continue;
    if (
      !best ||
      compareGameVersions(g.info.version ?? "", best.info.version ?? "") > 0
    ) {
      best = g;
    }
  }
  return best;
}
