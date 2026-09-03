import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * The one hub call a game facts sweep makes (issue #1875), as the webview sees
 * it.
 *
 * Thin on purpose, the way `../maps/catalog.ts` is. Everything that decides
 * anything is in Rust: the token, the consent check, the envelope, the local
 * checks that stop a game the hub could never accept from being sent, and the
 * retry. What is here is the shape of the question and the shape of the answer.
 *
 * The field names are the hub's own camel case rather than the snake case every
 * other type crossing the serde boundary uses. The Rust struct is the wire shape
 * as well as the argument shape, which is what stops a field the hub does not
 * know from ever reaching it, and one spelling is the price of that.
 */

/** One unit as the game declares it. */
export interface GameUnitFacts {
  /** The unit's internal name, which is what the hub keys on. */
  name: string;
  /** The name a player sees, when the game gives one. */
  fullName?: string;
  /** Which faction reaches this unit over the build graph. Absent for a unit no
   *  start unit can reach. */
  factionKey?: string;
  /** The units this one can build, in whatever order the game listed them. The
   *  hub sorts and deduplicates before it digests. */
  buildOptions: string[];
  /** What this unit turns into (issue #2063): one object per edge, each with
   *  `into` and whatever conditions the game declared. The hub stores it as
   *  schemaless JSON and renders what arrives. Sent even when empty. */
  morphTargets: Record<string, unknown>[];
  /** Everything the unitdef declares about the unit (issue #1876). The hub
   *  stores it as schemaless JSON and renders what arrives, so nothing here
   *  narrows it. Sent even when empty, the way `buildOptions` is. */
  stats: Record<string, unknown>;
}

/** One faction, as the game's modinfo spells it. */
export interface GameFaction {
  /** What a unit's `factionKey` points at. The hub joins the two character for
   *  character. */
  key: string;
  /** The name a player sees, in the game's own spelling. */
  name: string;
}

/** One place to find a game or its people, the shape coilbox's own branding
 *  catalog already uses. */
export interface GameLink {
  label: string;
  url: string;
}

/** One whole game. There is no `complete` here: the Rust side always sends the
 *  whole game, because a partial batch would retire the units it left out. */
export interface GameFacts {
  /** The modinfo shortname, never an archive name. */
  shortname: string;
  /** The archive's declared version string, verbatim. */
  release: string;
  /** What the game calls itself, off modinfo's `name` (issue #1950). Never
   *  `GameItem.name`, which falls back to the archive filename, and that
   *  carries a build number that would pin one build's name onto a row meant
   *  to outlive every build. Left off rather than sent empty for a game whose
   *  name could not be read. The hub fills it only when its held value is
   *  null, so it never argues with a name an owner has since edited by hand. */
  name?: string;
  /** What the game calls itself, off modinfo's optional `description` tag.
   *  Left off rather than sent empty for a game that declares none. */
  description?: string;
  /** Starting links for the game's page, matched out of coilbox's own
   *  curated branding catalog rather than read from the archive. Left off
   *  for a game the catalog does not recognise. The hub fills it only when
   *  its held value is still empty. */
  links?: GameLink[];
  /** The start unit of each side that has one. */
  startUnits: string[];
  /** Every faction the game has. Sending them replaces the hub's held set for
   *  this game, so leaving the field off is how a caller says nothing about
   *  them rather than saying there are none. */
  factions?: GameFaction[];
  units: GameUnitFacts[];
}

/**
 * What the hub did with one unit.
 *
 * - `accepted`: current facts changed, and this release's revision was written.
 * - `recorded`: the facts were already held, but this release had no revision
 *   yet, which is the ordinary answer the second time a release is reported.
 * - `unchanged`: nothing was written at all.
 * - `refused`: the entry is malformed, and `said` carries why.
 */
export type GameFactsOutcome =
  | "accepted"
  | "recorded"
  | "unchanged"
  | "refused";

export interface GameFactsResult {
  kind: "faction" | "unit";
  name: string;
  outcome: GameFactsOutcome;
  /** Why, on a refusal. */
  said?: string;
}

const hubPublishGameFacts = defineCommand<
  { hubUrl: string; game: GameFacts },
  { results: GameFactsResult[] }
>("coilbox-hub", "hub_publish_game_facts");

/**
 * Send one game's units, and say what the hub did with each.
 *
 * Rejects when the hub would not take the game at all, which is one request's
 * worth of failure rather than the sweep's: the caller carries on to the next
 * game.
 */
export async function publishGameFacts(
  hubUrl: string,
  game: GameFacts,
): Promise<GameFactsResult[]> {
  const { results } = await hubPublishGameFacts({ hubUrl, game });
  return results;
}
