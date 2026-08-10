/**
 * How every coilbox container names the game it targets (issue #1335).
 *
 * Before this, each kind spelled it differently: a setup pack wrote
 * `game.name` with the full archive string ("SplinterFaction 0.1.78"), a
 * challenge wrote `settings.game.shortname` with the modinfo shortname ("BA"),
 * and presets, campaigns and scenarios wrote a bare `gameName`. Two items
 * targeting the same game were therefore unrecognisable as such, so anything
 * listing shared items (Coilbox Hub filters by game) could only filter within
 * one kind.
 *
 * One shape now carries both spellings side by side, because dropping either
 * loses something the reader cannot recover:
 *
 * - `name` is the exact archive name. It pins one build, which is what a setup
 *   pack, preset, campaign or scenario needs to launch the same battle.
 * - `shortname` is the modinfo shortname. It is stable across versions, so it
 *   is what a human filters or groups by, and it is the only thing a challenge
 *   has: a challenge deliberately resolves to the newest installed build.
 *
 * Both fields are optional and at least one must be present, because neither is
 * always knowable. A challenge that pins no build has no `name`. An item whose
 * game coilbox has never read a modinfo for has no `shortname`, since the
 * shortname only exists in the game's modinfo and coilbox reads that from an
 * installed archive. It does not have to be installed right now: `./shortnames`
 * keeps every shortname read here, so a build that has since been superseded
 * still gets one.
 *
 * The shape sits at the top of each kind's payload as `game`, so a consumer
 * reads one field in one place whatever the kind. Payloads shared before this
 * carry no `game`, so {@link gameIdentityFromPayload} reads each kind's old
 * spelling and returns the same shape.
 */

import { rememberedShortname } from "./shortnames";

export interface GameIdentity {
  /** Exact installed archive name, e.g. "SplinterFaction 0.1.78". Absent when
   * the item deliberately pins no build. */
  name?: string;
  /** modinfo shortname, e.g. "BA". Absent when it could not be read, which
   * means the game was not installed where the item was exported. */
  shortname?: string;
}

/** The minimal shape of an installed game needed to read a shortname off it, a
 * structural subset of `GameItem` from the content bindings. */
export interface InstalledGameInfo {
  name: string;
  info?: Record<string, string>;
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Narrow an untrusted value to a {@link GameIdentity}, or `null` when it names
 * no game at all.
 *
 * Accepts the old spellings so a code shared before issue #1335 normalises to
 * the same shape as one shared after: a bare string is an archive name, and
 * `gameName` and `pinnedName` are both read as `name`.
 */
export function parseGameIdentity(value: unknown): GameIdentity | null {
  if (typeof value === "string") {
    const name = trimmedString(value);
    return name ? { name } : null;
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const name =
    trimmedString(v.name) ??
    trimmedString(v.gameName) ??
    trimmedString(v.pinnedName);
  const shortname = trimmedString(v.shortname);
  if (!name && !shortname) return null;
  return { ...(name ? { name } : {}), ...(shortname ? { shortname } : {}) };
}

/**
 * Build an identity for an archive name, filling in the shortname from the
 * game's modinfo.
 *
 * `name` is the build the item pins and it is never rewritten: it is what makes
 * the same battle launch again, so an item pinned to 0.1.77 keeps saying 0.1.77
 * even on a machine that has moved to 0.1.78.
 *
 * The shortname comes from the live scan when the pinned build is installed, and
 * otherwise from the shortnames coilbox has already read here (issue #1364),
 * which is what a build that has since been superseded falls back on. Both are
 * modinfo this machine read, the live one being the more recent of the two.
 */
export function gameIdentityForName(
  name: string,
  installed: readonly InstalledGameInfo[] = [],
): GameIdentity | null {
  const trimmed = trimmedString(name);
  if (!trimmed) return null;
  const shortname =
    trimmedString(installed.find((g) => g.name === trimmed)?.info?.shortname) ??
    trimmedString(rememberedShortname(trimmed));
  return { name: trimmed, ...(shortname ? { shortname } : {}) };
}

/** Read the identity out of a challenge's `settings.game`, which is a
 * `GameRef`: a shortname plus an optional `pinnedName` archive pin. */
function challengeSettingsIdentity(payload: Record<string, unknown>) {
  const settings = payload.settings;
  if (typeof settings !== "object" || settings === null) return null;
  return parseGameIdentity((settings as Record<string, unknown>).game);
}

/** Read the identity out of a campaign document: every mission carries its own
 * skirmish snapshot, and the campaign is only "for" one game when they agree. */
function campaignDocumentIdentity(document: unknown): GameIdentity | null {
  if (typeof document !== "object" || document === null) return null;
  const missions = (document as Record<string, unknown>).missions;
  if (!Array.isArray(missions)) return null;
  const names = new Set<string>();
  for (const mission of missions) {
    if (typeof mission !== "object" || mission === null) continue;
    const snapshot = (mission as Record<string, unknown>).snapshot;
    if (typeof snapshot !== "object" || snapshot === null) continue;
    const name = trimmedString((snapshot as Record<string, unknown>).gameName);
    if (name) names.add(name);
  }
  return names.size === 1 ? { name: [...names][0] } : null;
}

/**
 * The game a container payload targets, whatever kind it is and whichever
 * spelling it was written with. The one place that knows the old per-kind
 * spellings, so no consumer has to.
 *
 * `kind` is the container's `kind` string, taken as a plain string so this
 * module stays free of the envelope's own types.
 */
export function gameIdentityFromPayload(
  kind: string,
  payload: unknown,
): GameIdentity | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  // Written by every kind since issue #1335, and the setup pack's field since
  // it was introduced.
  const current = parseGameIdentity(p.game);
  if (current) return current;

  switch (kind) {
    case "preset":
      return parseGameIdentity(p.gameName);
    case "challenge":
      return challengeSettingsIdentity(p);
    case "scenario": {
      const scenario = p.scenario;
      if (typeof scenario !== "object" || scenario === null) return null;
      const setup = (scenario as Record<string, unknown>).setup;
      if (typeof setup !== "object" || setup === null) return null;
      return parseGameIdentity((setup as Record<string, unknown>).gameName);
    }
    case "campaign":
      // A campaign carrying scenario media wraps the document (kindVersion 2).
      // Otherwise the payload is the document itself.
      return campaignDocumentIdentity(
        typeof p.campaign === "object" && p.campaign !== null
          ? p.campaign
          : payload,
      );
    default:
      return null;
  }
}
