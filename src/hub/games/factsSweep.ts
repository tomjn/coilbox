import type { GameItem, Side, UnitDatasetEntry } from "@/content/bindings";
import {
  unitsyncGameInfo,
  unitsyncScan,
  unitsyncUnitDataset,
} from "@/content/bindings";
import { isSddName } from "@/content/format";
import { buildTechForest } from "@/content/techForest";
import {
  type GameFacts,
  type GameFaction,
  type GameFactsResult,
  type GameUnitFacts,
  publishGameFacts,
} from "./facts";

/**
 * Reading the installed games and telling the hub what is in each one (issue
 * #1875).
 *
 * ## What gets sent, and what does not
 *
 * A packaged release, and nothing else. A game installed as a loose `.sdd`
 * folder is development content - somebody's work in progress, coilbox's own
 * scratch game, the scenario test mutator - and none of it belongs in a public
 * catalog (issue #1890). The test is `isSddName` on the primary archive, which
 * is the one the picture backfill and the seed corpus already use, and coilbox's
 * own generated folders are `.sdd` so the same test takes them out. A rapid pool
 * install is a `.sdp` and is untouched by it.
 *
 * Two other things stop a game. A game with no modinfo shortname has nothing for
 * the hub to file it under, which is the reason the picture seed skips one too.
 * A game with no version string cannot be sent at all: `release` is required and
 * a submission without one is a 400 for the whole game, so it is skipped with a
 * reason rather than sent to be refused.
 *
 * ## One install per game
 *
 * The hub holds one set of current facts per shortname, and a release names
 * which install they came from. Four installed BAR releases posted in one run
 * would leave the current facts pointing at whichever went last, and the next
 * run would move them again, so nothing would ever settle. One install per
 * shortname is sent instead, chosen by archive name so that the same library
 * chooses the same install every time. That is a stable pick rather than a claim
 * about which release is newer: a version is whatever the game's author typed,
 * and an ordering invented for it would be a guess dressed up as a rule.
 *
 * ## Why it is a button and not something that happens
 *
 * A sweep mounts each game's archive set twice, once for its sides and once for
 * its unit graph, which is seconds a game. Nothing about opening a settings page
 * says that is wanted now, which is the reason the map catalog sweep is a button
 * too.
 */

/** Why a game the machine has was not sent. */
export type GameSkipReason =
  /** A loose `.sdd` working folder, or one coilbox generated for itself. */
  | "development-folder"
  /** No modinfo shortname, so the hub has nothing to file it under. */
  | "no-shortname"
  /** No modinfo version, and the hub requires one. */
  | "no-release"
  /** Another install of the same game is being sent instead. */
  | "another-install"
  /** Its archives mounted, and no units came out. */
  | "no-units";

/** One game that was not sent, by the name unitsync reports for it. */
export interface SkippedGame {
  game: string;
  reason: GameSkipReason;
}

/** One game the hub would not take, and what it said. */
export interface FailedGame {
  game: string;
  said: string;
}

/** How far along a sweep is, for a progress line. */
export interface GameSweepProgress {
  /** What the sweep is doing now. */
  phase: "scanning" | "reading" | "sending";
  /** Games finished, and how many there are to do. */
  done: number;
  total: number;
  /** The game being read or sent, when there is one. */
  game?: string;
}

/** What a sweep did, in counts rather than in words. */
export interface GameSweepReport {
  /** Games the machine has installed, before anything was ruled out. */
  found: number;
  /** Games whose units the hub now holds. */
  sent: number;
  /** Games that were never sent, and why. */
  skipped: SkippedGame[];
  /** Games the hub would not take, and what it said about each. */
  failed: FailedGame[];
  /** Units the hub refused inside an otherwise fine submission. */
  refused: GameFactsResult[];
  /** Anything the worker reported while reading. */
  errors: string[];
}

/** Everything this reaches outside itself, so a test can count the calls. */
export interface GameSweepTools {
  scan: typeof unitsyncScan;
  info: typeof unitsyncGameInfo;
  dataset: typeof unitsyncUnitDataset;
  send: typeof publishGameFacts;
}

export const liveGameSweepTools: GameSweepTools = {
  scan: unitsyncScan,
  info: unitsyncGameInfo,
  dataset: unitsyncUnitDataset,
  send: publishGameFacts,
};

export interface GameSweepTarget {
  hubUrl: string;
  enginePath: string;
  dataDir: string;
}

/** A game that will be sent, with the two modinfo fields already read off it. */
interface Sendable {
  game: GameItem;
  shortname: string;
  release: string;
}

/**
 * Which installed games are worth sending, and why each of the others is not.
 *
 * Exported for its own test: the rules here are the whole of what keeps somebody
 * else's working folder out of a public catalog, and they are worth asserting
 * without a hub.
 */
export function gamesToSend(games: readonly GameItem[]): {
  sendable: Sendable[];
  skipped: SkippedGame[];
} {
  const skipped: SkippedGame[] = [];
  const best = new Map<string, Sendable>();

  for (const game of games) {
    if (isSddName(game.primaryArchive?.name)) {
      skipped.push({ game: game.name, reason: "development-folder" });
      continue;
    }
    const shortname = game.info?.shortname?.trim();
    if (!shortname) {
      skipped.push({ game: game.name, reason: "no-shortname" });
      continue;
    }
    const release = game.info?.version?.trim();
    if (!release) {
      skipped.push({ game: game.name, reason: "no-release" });
      continue;
    }

    // One install per shortname. The choice is on the archive name so that a
    // library that has not changed makes the same choice every run, which is
    // what stops the hub's current facts moving between two installs for ever.
    const key = shortname.toLowerCase();
    const held = best.get(key);
    if (!held) {
      best.set(key, { game, shortname, release });
    } else if (game.name > held.game.name) {
      best.set(key, { game, shortname, release });
      skipped.push({ game: held.game.name, reason: "another-install" });
    } else {
      skipped.push({ game: game.name, reason: "another-install" });
    }
  }

  return { sendable: [...best.values()], skipped };
}

/**
 * The key the hub joins a unit to its faction on.
 *
 * One expression, called from both the places that need it, because a unit's
 * `factionKey` and the `factions[].key` it points at have to agree character for
 * character or the hub's join finds nothing. Two of these that happen to agree
 * today would drift apart the first time either changed.
 */
function keyOf(side: Side): string {
  return side.name.trim().toLowerCase();
}

/**
 * The sides that are factions: a name to call one and a start unit to reach its
 * units from. A side missing either contributes nothing, which is what
 * `UnitPicker` asks of a side too.
 */
function rootedSides(sides: readonly Side[]): (Side & { startUnit: string })[] {
  return sides.filter(
    (side): side is Side & { startUnit: string } =>
      !!side.startUnit?.trim() && !!side.name?.trim(),
  );
}

/**
 * The factions this game has, in the order its modinfo lists them (issue #1878).
 *
 * The name is the modinfo spelling with nothing done to it but a trim, because
 * it is what the game calls the faction and the hub prints it as it arrives.
 * Two sides whose names lowercase to one key are one faction, keeping the first
 * spelling: sending the key twice would be the same row written twice.
 *
 * Exported for its own test.
 */
export function gameFactions(sides: readonly Side[]): GameFaction[] {
  const factions = new Map<string, GameFaction>();
  for (const side of rootedSides(sides)) {
    const key = keyOf(side);
    if (!factions.has(key)) factions.set(key, { key, name: side.name.trim() });
  }
  return [...factions.values()];
}

/**
 * Which faction reaches each unit, by the key the hub joins on.
 *
 * The forest is built over the whole dataset from every side's start unit at
 * once, which is what `UnitPicker` does, so a unit two factions can build is
 * attributed to whichever side comes first rather than appearing twice.
 *
 * Exported for its own test.
 */
export function factionKeys(
  units: readonly UnitDatasetEntry[],
  sides: readonly Side[],
): Map<string, string> {
  const rooted = rootedSides(sides);
  const forest = buildTechForest(
    [...units],
    rooted.map((side) => side.startUnit),
  );

  // Which side each root belongs to. The forest keeps the first side to claim a
  // start unit and drops the rest, so this does the same, and two sides sharing
  // a commander agree on one key rather than disagreeing about it.
  const sideOfRoot = new Map<string, string>();
  for (const side of rooted) {
    const root = side.startUnit.toLowerCase();
    if (!sideOfRoot.has(root)) sideOfRoot.set(root, keyOf(side));
  }

  const keys = new Map<string, string>();
  for (const unit of units) {
    const id = unit.name.toLowerCase();
    const key = sideOfRoot.get(forest.factionOf.get(id) ?? "");
    if (key) keys.set(id, key);
  }
  return keys;
}

/** The factions, units and start units of one game, ready to send. */
function factsFor(
  { shortname, release }: Sendable,
  units: readonly UnitDatasetEntry[],
  sides: readonly Side[],
): GameFacts {
  const keys = factionKeys(units, sides);

  // A game whose sides did not read is a game with nothing to say about its
  // factions, and the field is left off rather than sent empty. Sending it empty
  // would retire the ones the hub holds, which is what a game that really did
  // lose all of its factions looks like, and no read failure should be able to
  // claim that.
  const factions = gameFactions(sides);

  return {
    shortname,
    release,
    startUnits: sides
      .map((side) => side.startUnit?.trim())
      .filter((start): start is string => !!start),
    ...(factions.length > 0 ? { factions } : {}),
    units: units.map((unit): GameUnitFacts => {
      const key = keys.get(unit.name.toLowerCase());
      return {
        name: unit.name,
        ...(unit.fullName ? { fullName: unit.fullName } : {}),
        ...(key ? { factionKey: key } : {}),
        buildOptions: unit.buildOptions ?? [],
      };
    }),
  };
}

const nothing: GameSweepReport = {
  found: 0,
  sent: 0,
  skipped: [],
  failed: [],
  refused: [],
  errors: [],
};

/**
 * Read the installed games and tell the hub what is in each one.
 *
 * `onProgress` is called as each phase moves, in games. A game the hub will not
 * take is recorded and the sweep carries on: one game says nothing about the
 * next, and a run that stopped at the first refusal would never reach the rest
 * of a library. What is not caught is a failure to read the library at all,
 * which is the caller's to report.
 */
export async function sweepGameFacts(
  target: GameSweepTarget,
  onProgress: (progress: GameSweepProgress) => void = () => {},
  tools: GameSweepTools = liveGameSweepTools,
): Promise<GameSweepReport> {
  const { hubUrl, enginePath, dataDir } = target;

  onProgress({ phase: "scanning", done: 0, total: 0 });
  const scanned = await tools.scan({ enginePath, dataDir });
  const { sendable, skipped } = gamesToSend(scanned.games);
  const report: GameSweepReport = {
    ...nothing,
    found: scanned.games.length,
    skipped,
    errors: [...scanned.errors],
  };
  if (sendable.length === 0) return report;

  for (const [at, entry] of sendable.entries()) {
    const name = entry.game.name;
    const gameArchive = entry.game.primaryArchive.name;
    onProgress({
      phase: "reading",
      done: at,
      total: sendable.length,
      game: name,
    });

    try {
      // Two mounts: the sides root the build graph, and the dataset is the graph.
      const [info, dataset] = await Promise.all([
        tools.info({ enginePath, dataDir, gameArchive }),
        tools.dataset({ enginePath, dataDir, gameArchive }),
      ]);
      report.errors.push(...info.errors, ...dataset.errors);

      // A complete submission with no units in it would retire everything the
      // hub holds for this game, so a read that came back empty is a skip.
      if (dataset.units.length === 0) {
        report.skipped.push({ game: name, reason: "no-units" });
        continue;
      }

      onProgress({
        phase: "sending",
        done: at,
        total: sendable.length,
        game: name,
      });
      const results = await tools.send(
        hubUrl,
        factsFor(entry, dataset.units, info.sides),
      );
      report.sent += 1;
      report.refused.push(
        ...results.filter((result) => result.outcome === "refused"),
      );
    } catch (e) {
      report.failed.push({
        game: name,
        said: e instanceof Error ? e.message : String(e),
      });
    }
  }

  onProgress({
    phase: "sending",
    done: sendable.length,
    total: sendable.length,
  });
  return report;
}

/**
 * What to tell somebody a sweep did, in one sentence.
 *
 * The counts a person can act on are the games the hub would not take and the
 * factions and units inside a game it would not take. Everything else is the
 * hub deciding
 * about facts it already holds, which nobody can do anything with.
 */
export function gameSweepSummary(report: GameSweepReport): string {
  if (report.found === 0) return "Coilbox found no games to read.";
  if (report.sent === 0 && report.failed.length === 0) {
    return "Coilbox found no games worth sending. Only released games are sent, not the ones you are working on.";
  }
  const games = report.sent === 1 ? "game" : "games";
  const sent = `Sent what ${report.sent} ${games} say about their units.`;
  if (report.failed.length > 0) {
    const would =
      report.failed.length === 1 ? "one game" : `${report.failed.length} games`;
    return `${sent} The hub would not take ${would}.`;
  }
  if (report.refused.length > 0) {
    // A result names the list it came from, so a refused faction is not reported
    // as a refused unit. They are fixed in different places.
    const counted = ([one, many]: [string, string]) => {
      const how = report.refused.filter((r) => r.kind === one).length;
      return how === 0 ? "" : `${how} ${how === 1 ? one : many}`;
    };
    const said = [counted(["unit", "units"]), counted(["faction", "factions"])]
      .filter(Boolean)
      .join(" and ");
    return `${sent} It would not take ${said}.`;
  }
  return sent;
}
