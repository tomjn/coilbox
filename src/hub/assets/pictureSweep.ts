import type { GameItem, UnitDatasetEntry } from "@/content/bindings";
import {
  unitsyncScan,
  unitsyncUnitDataset,
  unitsyncUnitRenderKeys,
} from "@/content/bindings";
import { dlRapidReleaseArchives } from "@/downloads/bindings";
import {
  type GameSkipReason,
  gamesToSend,
  type SkippedGame,
} from "../games/factsSweep";
import {
  type BackfillTools,
  type BackfillUnit,
  backfillBlueprintUnits,
  liveBackfillTools,
  picturesWanted,
  renderKeysToAsk,
} from "./blueprintBackfill";
import { recordBackfillWrites, unitsAffordableNow } from "./budget";
import { assetsTheHubWants } from "./have";
import { RENDER_VERSION } from "./renderTop";

/**
 * Filling in the pictures the hub has none of, for the games on this computer
 * (issue #1952).
 *
 * ## Why this exists next to the lazy path
 *
 * `./blueprintBackfill.ts` is the only thing in coilbox that has ever sent a
 * picture, and it runs when somebody opens a blueprint. That is deliberately
 * lazy and stays that way: it spends a shared allowance on units somebody was
 * actually looking at.
 *
 * What it cannot do is fill a gap nobody has walked into. Evolution RTS is on the
 * hub with no pictures at all, and it will stay that way until somebody opens a
 * layout naming an Evolution RTS unit, because nothing else offers the hub
 * anything. Meanwhile the switch in Settings that permits all of this says
 * coilbox "makes pictures of the units and maps inside them, and sends those
 * pictures to the hub", and the two buttons under it both say they send no
 * pictures. So somebody who agreed to the thing the switch describes had no way
 * to do it.
 *
 * This is that way: a button, over the whole roster of every released game.
 *
 * ## Ask first, then spend
 *
 * The order is the whole of what makes pressing it twice do anything.
 *
 * The lazy path takes its allowance off the top, before it reads: a layout of
 * thirty units with four left in the hour reads four. That is right for a
 * layout, where the units are the ones on the screen and cutting early saves
 * reading models nobody asked about.
 *
 * It is wrong for a roster. Cutting first takes the first sixteen units of the
 * game every time, so the second run asks about the same sixteen, hears that the
 * hub has them, writes nothing, and stops. It would never reach the seventeenth.
 * So the survey covers the whole roster and the allowance is spent on what came
 * back missing, which means every run makes progress and a game gets covered over
 * however many goes it takes.
 *
 * The survey is not free and is not meant to be: reading a game's models is
 * seconds, and asking about Beyond All Reason's 564 units is about 13 CPU seconds
 * of digesting. It costs no upload allowance, though, which is the allowance that
 * is shared, and it is what makes the answer to "what is missing" real rather
 * than a guess.
 *
 * ## Which games
 *
 * `gamesToSend` decides, which is the same rule the game facts sweep uses:
 * released games only, one install per shortname. A loose `.sdd` folder is
 * somebody's working copy and does not belong in a public catalog, and two
 * installs of one game would be two sets of pictures of the same units under one
 * shortname.
 *
 * ## Reported to the person who pressed it
 *
 * A refusal from a run coilbox started on its own goes quietly into the bell,
 * because #1690 ruled that a backfill nobody asked for must not interrupt
 * somebody reading a layout. That reasoning inverts here. Somebody pressing a
 * button is watching it, and a refusal they are never shown is a run that looks
 * like it worked, so this one reports as `user`.
 */

/** Why a game the machine has was not swept. The reasons are the game facts
 *  sweep's, because the rule about which games are ours to publish is one rule. */
export type PictureSkipReason = GameSkipReason;

/** How far along a sweep is, for a progress line. */
export interface PictureSweepProgress {
  /**
   * What the sweep is doing now. `reading` covers the survey, which is the
   * models and the question to the hub. `filling` is the drawing and the
   * sending, which is the part that takes minutes.
   */
  phase: "scanning" | "reading" | "filling";
  /** Games finished, and how many there are to do. */
  done: number;
  total: number;
  /** The game being read or filled, when there is one. */
  game?: string;
}

/** What one game's sweep came to. */
export interface GamePictures {
  /** The game as unitsync names it, which is what a person recognises. */
  game: string;
  /** The modinfo shortname, which is what the hub files the pictures under. */
  shortname: string;
  /** Units in the game's roster. */
  units: number;
  /** Units the hub was missing at least one picture of, before this run. */
  wanted: number;
  /** Units this run actually covered, which is what the hour's allowance left
   *  room for. */
  covered: number;
  /** Pictures the hub took. */
  written: number;
  /** Why the run did less than the whole game, when it did. */
  stopped?: string;
}

/** What a sweep did. */
export interface PictureSweepReport {
  /** Games the machine has, before anything was ruled out. */
  found: number;
  /** One entry per game the sweep looked at. */
  games: GamePictures[];
  /** Games that were never looked at, and why. */
  skipped: SkippedGame[];
  /** Games that fell over, and what they said. */
  failed: { game: string; said: string }[];
  /** Anything the worker reported while reading. */
  errors: string[];
}

/** Everything this reaches outside itself, so a test can count the calls. */
export interface PictureSweepTools {
  scan: typeof unitsyncScan;
  dataset: typeof unitsyncUnitDataset;
  renderKeys: typeof unitsyncUnitRenderKeys;
  ask: typeof assetsTheHubWants;
  releases: typeof dlRapidReleaseArchives;
  /** How much of the hour is left for one game, so a test can hand out its own. */
  affordable: typeof unitsAffordableNow;
  /** What the fill itself uses. Handed down whole rather than reimplemented,
   *  because the drawing, the local render index and the upload are the lazy
   *  path's and this is the same work over a different unit list. */
  fill: typeof backfillBlueprintUnits;
  backfill: BackfillTools;
  record: typeof recordBackfillWrites;
}

export const livePictureSweepTools: PictureSweepTools = {
  scan: unitsyncScan,
  dataset: unitsyncUnitDataset,
  renderKeys: unitsyncUnitRenderKeys,
  ask: assetsTheHubWants,
  releases: dlRapidReleaseArchives,
  affordable: unitsAffordableNow,
  fill: backfillBlueprintUnits,
  backfill: liveBackfillTools,
  record: recordBackfillWrites,
};

export interface PictureSweepTarget {
  hubUrl: string;
  enginePath: string;
  dataDir: string;
}

/**
 * Every unit in a game's roster that a picture can be made of.
 *
 * The roster equivalent of `blueprintBackfillUnits`, and the one place that says
 * a sweep is over a whole game. A unit with no `objectname` is dropped for the
 * reason the layout path drops one: it would mint a key naming a picture nobody
 * can make. The footprints fall back to one square, which is the floor the engine
 * applies.
 *
 * Exported for its own test, since this is what makes a roster walk a roster
 * walk.
 */
export function rosterUnits(
  dataset: readonly UnitDatasetEntry[],
): BackfillUnit[] {
  const units: BackfillUnit[] = [];
  const seen = new Set<string>();
  for (const unit of dataset) {
    const name = unit.name?.toLowerCase();
    if (!name || seen.has(name) || !unit.objectName) continue;
    seen.add(name);
    units.push({
      name: unit.name,
      objectName: unit.objectName,
      footprintX: Math.max(1, Math.trunc(unit.footprintX ?? 1)),
      footprintZ: Math.max(1, Math.trunc(unit.footprintZ ?? 1)),
    });
  }
  return units;
}

/**
 * The units the hub is missing at least one picture of, in the roster's order.
 *
 * One missing angle is enough to make a unit worth working on, because the run
 * asks about every angle again on the way through and draws only what is still
 * wanted. A unit whose four pictures the hub holds is not here at all, which is
 * what stops a second run doing the first run's work again.
 *
 * Exported for its own test.
 */
export function unitsWithGaps(
  units: readonly BackfillUnit[],
  missing: readonly string[],
): BackfillUnit[] {
  const wanted = new Set(missing.map((id) => id.split("\n")[0]));
  return units.filter((unit) => wanted.has(unit.name));
}

const nothing: PictureSweepReport = {
  found: 0,
  games: [],
  skipped: [],
  failed: [],
  errors: [],
};

/**
 * Fill in the pictures the hub has none of, for every released game installed.
 *
 * `onProgress` is called as each phase moves, in games. A game that falls over is
 * recorded and the sweep carries on, the way the game facts sweep does: one game
 * says nothing about the next.
 */
export async function sweepGamePictures(
  target: PictureSweepTarget,
  onProgress: (progress: PictureSweepProgress) => void = () => {},
  tools: PictureSweepTools = livePictureSweepTools,
): Promise<PictureSweepReport> {
  const { hubUrl, enginePath, dataDir } = target;

  onProgress({ phase: "scanning", done: 0, total: 0 });
  const { md5s } = await tools.releases({ dataDir });
  const scanned = await tools.scan({ enginePath, dataDir });
  const { sendable, skipped } = gamesToSend(
    scanned.games,
    new Set(md5s.map((m) => m.toLowerCase())),
  );
  const report: PictureSweepReport = {
    ...nothing,
    found: scanned.games.length,
    games: [],
    skipped,
    failed: [],
    errors: [...scanned.errors],
  };
  if (sendable.length === 0) return report;

  for (const [at, entry] of sendable.entries()) {
    const name = entry.game.name;
    try {
      const one = await sweepOneGame(
        { hubUrl, enginePath, dataDir },
        entry.game,
        entry.shortname,
        at,
        sendable.length,
        onProgress,
        tools,
        report.errors,
      );
      report.games.push(one);
    } catch (e) {
      report.failed.push({
        game: name,
        said: e instanceof Error ? e.message : String(e),
      });
    }
  }

  onProgress({
    phase: "filling",
    done: sendable.length,
    total: sendable.length,
  });
  // Written down whatever the sweep found, including nothing, because what it
  // answers is whether this has ever run rather than whether it sent anything.
  rememberSweptAt();
  return report;
}

/** One game, surveyed and then filled as far as the hour allows. */
async function sweepOneGame(
  target: PictureSweepTarget,
  game: GameItem,
  shortname: string,
  at: number,
  total: number,
  onProgress: (progress: PictureSweepProgress) => void,
  tools: PictureSweepTools,
  errors: string[],
): Promise<GamePictures> {
  const { hubUrl, enginePath, dataDir } = target;
  const archive = game.primaryArchive.name;
  const mount = { enginePath, dataDir, gameArchive: archive };
  const blank: GamePictures = {
    game: game.name,
    shortname,
    units: 0,
    wanted: 0,
    covered: 0,
    written: 0,
  };

  onProgress({ phase: "reading", done: at, total, game: game.name });

  const dataset = await tools.dataset(mount);
  errors.push(...dataset.errors);
  const units = rosterUnits(dataset.units);
  if (units.length === 0) return blank;

  // The survey: what every picture of every unit would be called, and which of
  // them the hub has not got. One mount for the keys however long the roster is.
  const keyed = await tools.renderKeys({
    ...mount,
    rendererVersion: RENDER_VERSION,
    units: units.map((unit) => ({
      unit: unit.name,
      object: unit.objectName,
      footprintX: unit.footprintX,
      footprintZ: unit.footprintZ,
    })),
  });
  const keys = renderKeysToAsk(shortname, units, keyed);
  const missing = picturesWanted(keys, await tools.ask(hubUrl, keys));
  const wanting = unitsWithGaps(units, missing);
  const surveyed = { ...blank, units: units.length, wanted: wanting.length };
  if (wanting.length === 0) return surveyed;

  // And the fill, over what came back missing rather than over the roster's
  // first however many. This is the half that spends the shared allowance.
  const affordable = tools.affordable(shortname);
  if (affordable <= 0) {
    return {
      ...surveyed,
      stopped: `Coilbox has already sent this hour's pictures for ${shortname}.`,
    };
  }

  onProgress({ phase: "filling", done: at, total, game: game.name });
  const filled = await tools.fill(
    {
      hubUrl,
      game: shortname,
      archive,
      enginePath,
      dataDir,
      startedBy: "user",
    },
    wanting,
    affordable,
    tools.backfill,
  );
  tools.record(shortname, filled.written);

  return {
    ...surveyed,
    covered: filled.units,
    written: filled.written,
    ...(filled.stopped ? { stopped: filled.stopped } : {}),
  };
}

/** Where the last sweep's finishing time is kept. */
export const LAST_SWEPT_KEY = "coilbox.hub.pictureSweptAt";

/**
 * When a sweep last finished, or null for a machine that has never run one.
 *
 * Recorded here rather than read off the rate limit ledger, which was the
 * obvious place and is the wrong one: that ledger prunes itself to a rolling
 * hour, so anything it could answer about is by definition less than an hour
 * old, and the question somebody is asking is whether this has ever happened.
 *
 * Guarded the way the ledger's reader is, and for the same reason: a webview
 * with storage off reads as never, which is a line that does not appear rather
 * than a run that cannot start.
 */
export function lastSweptAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SWEPT_KEY);
    const at = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/** Write down that a sweep has just finished. */
export function rememberSweptAt(now = Date.now()): void {
  try {
    localStorage.setItem(LAST_SWEPT_KEY, String(now));
  } catch {
    // No storage. The sweep still happened, it simply cannot say so next launch.
  }
}

/**
 * What to tell somebody a sweep did, in one sentence.
 *
 * The number that matters is how much of the library is still missing, because
 * that is the one that says whether pressing the button again is worth anything.
 */
export function pictureSweepSummary(report: PictureSweepReport): string {
  if (report.found === 0) return "Coilbox found no games to draw.";
  if (report.games.length === 0) {
    return "Coilbox found no released games to draw. Only released games are sent, not the ones you are working on.";
  }

  const written = report.games.reduce((sum, one) => sum + one.written, 0);
  const left = report.games.reduce(
    (sum, one) => sum + Math.max(0, one.wanted - one.covered),
    0,
  );

  if (written === 0 && left === 0) {
    return "The hub already has a picture of every unit in your games.";
  }
  const sent =
    written === 1 ? "Sent one picture." : `Sent ${written} pictures.`;
  if (left === 0) return `${sent} The hub now has every unit in your games.`;
  const units = left === 1 ? "unit is" : "units are";
  return `${sent} ${left} more ${units} still waiting. Press it again later to carry on.`;
}
