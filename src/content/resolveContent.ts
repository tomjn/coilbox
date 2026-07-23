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
