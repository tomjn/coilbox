/**
 * Generalises the one existing "is this content installed, offer a download"
 * pattern (replay detail's map/game download affordances, `useRefightSetup`,
 * and the campaign mission install gate in `campaign/run.ts`) into a single
 * "resolve content for this document" step every import path can call before
 * completing (issue #387): challenge import, preset import, campaign import,
 * and — per #415 — a setup pack referencing an engine + a game + a map list.
 *
 * Deliberately a *list* of requirements, not a single game+map pair, so a
 * caller with several missions (a whole campaign) or a pack (engine + game +
 * maps) can resolve everything in one step.
 *
 * Pure logic only (no React, no Tauri bindings) so it's unit-testable without
 * mocking anything — mirrors the `campaign/results.ts` + `campaign/run.ts`
 * split (pure transitions vs. the hook that drives them). The hook lives in
 * `useResolveContent.ts`.
 */

import type { ScanReading } from "./scanSettled";

export type ContentRequirementKind = "game" | "map" | "engine";

/** A snapshot of what's installed, built from a unitsync scan (games/maps) plus
 * every known content root's engines (engine versions). */
export interface InstalledContentSnapshot {
  games: { name: string; shortname?: string; version?: string }[];
  maps: string[];
  engineVersions: string[];
}

/**
 * One thing a document needs installed before it can be used. `isInstalled` is
 * a predicate rather than a plain name so each domain can keep its own match
 * convention — exact name (campaign missions, presets, replays) or
 * shortname+version (challenges, via `resolveGameByShortname`) — without this
 * module needing to know about either. `downloadKey` is the identifier passed
 * to the backend download command (rapid tag / springName / engine version)
 * when it differs from the display `label` — same "best effort, name may not
 * be exact" caveat as the existing `GameDownload`/`ReplayMapPreview`.
 */
export interface ContentRequirement {
  kind: ContentRequirementKind;
  label: string;
  downloadKey?: string;
  isInstalled: (installed: InstalledContentSnapshot) => boolean;
}

/** Build a requirement satisfied by an exact-name match — the convention already
 * used by campaign missions, skirmish presets and replay refight. */
/**
 * Normalise a game name/version string so version-form differences don't
 * break a match: lower-cased, a "v" directly before a version number dropped,
 * then every remaining separator (space, dot, dash) stripped. This collapses
 * "SplinterFaction 0.178", "SplinterFaction v0.178" and "SplinterFaction
 * 0.1.78" to the same identity (issue #494) without needing a real
 * `shortname` field, which a replay's `gameType` string doesn't carry.
 */
export function normalizeGameIdentity(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bv(?=\d)/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Whether two game name/version strings identify the same game, tolerant of
 * version-string form (see {@link normalizeGameIdentity}). Used to match a
 * replay's `gameType` against the live unitsync scan, e.g. by the replay
 * detail's missing-content check and `useRefightSetup`. */
export function gameNamesMatch(a: string, b: string): boolean {
  return normalizeGameIdentity(a) === normalizeGameIdentity(b);
}

/**
 * Strip a trailing version-looking token from a game display name, leaving
 * the family name modinfo keeps stable across releases, e.g. "Beyond All
 * Reason test-30018-d71d659" becomes "Beyond All Reason", "SplinterFaction
 * 0.178" becomes "SplinterFaction". A word counts as version-looking if it
 * contains a digit, so trailing such words are dropped, always keeping at
 * least one word. Used only as a proxy for a real modinfo `shortname` when
 * one isn't available (see {@link resolveReplayShortGameId}).
 */
export function stripVersionSuffix(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && /\d/.test(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

/**
 * The short game id an installed game is matched by (issue #503). It's the
 * real modinfo `shortname` when present, otherwise the normalised,
 * version-stripped family name of its display name.
 */
export function installedGameShortId(game: {
  name: string;
  shortname?: string;
}): string {
  const shortname = game.shortname?.trim();
  return shortname
    ? normalizeGameIdentity(shortname)
    : normalizeGameIdentity(stripVersionSuffix(game.name));
}

/**
 * A replay's short game id (issue #503), version-independent so it groups
 * every installed version of the same game while still excluding an
 * unrelated one. `exact` is true when it's a real modinfo `shortname`,
 * recovered from an installed game (any version) whose family name matches
 * the replay's `gameType`. The replay itself only carries `gameType` as a
 * display string, never a `shortname`. When no installed game's family
 * matches, there's nothing to recover a real shortname from, so the fallback
 * is `gameType`'s own version-stripped family identity, flagged
 * `exact: false` so callers can tell the user the check is approximate.
 */
export interface ShortGameId {
  id: string;
  exact: boolean;
}

export function resolveReplayShortGameId(
  gameType: string,
  installed: readonly { name: string; shortname?: string }[],
): ShortGameId {
  const family = normalizeGameIdentity(stripVersionSuffix(gameType));
  const match = installed.find(
    (g) =>
      g.shortname?.trim() &&
      normalizeGameIdentity(stripVersionSuffix(g.name)) === family,
  );
  if (match?.shortname) {
    return { id: normalizeGameIdentity(match.shortname), exact: true };
  }
  return { id: family, exact: false };
}

/** Whether an installed game is a valid remix/refight target for a replay's
 * short game id (see {@link resolveReplayShortGameId}), same short id, any
 * version. */
export function gameMatchesShortId(
  replayShortId: ShortGameId,
  game: { name: string; shortname?: string },
): boolean {
  return installedGameShortId(game) === replayShortId.id;
}

export function exactGameRequirement(name: string): ContentRequirement {
  return {
    kind: "game",
    label: name,
    isInstalled: (i) => i.games.some((g) => g.name === name),
  };
}

/** See {@link exactGameRequirement}. */
export function exactMapRequirement(name: string): ContentRequirement {
  return {
    kind: "map",
    label: name,
    isInstalled: (i) => i.maps.includes(name),
  };
}

/** A requirement satisfied by an exact engine version match. */
export function engineVersionRequirement(version: string): ContentRequirement {
  return {
    kind: "engine",
    label: version,
    isInstalled: (i) => i.engineVersions.includes(version),
  };
}

/** Drop requirements that are structurally identical (same kind + label),
 * keeping the first occurrence — so a campaign with several missions on the
 * same game only lists it once. */
export function dedupeRequirements(
  reqs: readonly ContentRequirement[],
): ContentRequirement[] {
  const seen = new Set<string>();
  const out: ContentRequirement[] = [];
  for (const r of reqs) {
    const key = `${r.kind}:${r.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Pure diff: which requirements aren't satisfied by `installed`, deduped. The
 * core of the "resolve content" step. */
export function computeMissingRequirements(
  reqs: readonly ContentRequirement[],
  installed: InstalledContentSnapshot,
): ContentRequirement[] {
  return dedupeRequirements(reqs).filter((r) => !r.isInstalled(installed));
}

/** Every reading the resolve gate decides from, as plain values. */
export interface ResolveReadings {
  requirements: readonly ContentRequirement[];
  /** What this machine has, as far as the readings below can vouch for. */
  installed: InstalledContentSnapshot;
  /** The target read that says which engine and data dir to scan is still in
   * flight, so `installed` carries no games or maps yet. */
  targetLoading: boolean;
  /** There is an engine and a data dir to scan. */
  hasTarget: boolean;
  scan: ScanReading;
  /** The content roots read that supplies the installed engine versions has
   * not landed. */
  enginesLoading: boolean;
  /** These requirements name an engine, and the release catalogs that say
   * whether it can be fetched have not landed. */
  engineCatalogPending: boolean;
}

/** What the resolve gate should say right now: whether it still has a question
 * outstanding, and what it can offer to download once it does not. */
export interface ResolveVerdict {
  loading: boolean;
  missing: ContentRequirement[];
  resolved: boolean;
}

/**
 * The gate's whole decision, kept pure so the "is this knowable yet" half can
 * be read on its own.
 *
 * The empty install snapshot the readings start on is a placeholder, not a
 * report of a machine with nothing on it. Judging requirements against it is
 * how the gate ends up offering to download content already on disk, so
 * `missing` stays empty until every reading has answered.
 *
 * Deliberately stricter than `./scanSettled`, which the home page's inventory
 * reads: there, a scan that failed has answered, because the worst it costs is
 * a card that draws nothing. Here it would cost the reader a download of
 * something already on disk, so a scan that has not produced a result is not an
 * answer whatever state it ended in.
 */
export function resolveVerdict(r: ResolveReadings): ResolveVerdict {
  const installKnown =
    !r.targetLoading && (!r.hasTarget || r.scan.data !== null);
  const loading = !installKnown || r.enginesLoading || r.engineCatalogPending;
  const missing = loading
    ? []
    : computeMissingRequirements(r.requirements, r.installed);
  return { loading, missing, resolved: !loading && missing.length === 0 };
}
