import type { GameItem, UnitDatasetEntry } from "@/content/bindings";
import {
  unitsyncScan,
  unitsyncUnitBuildpics,
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
  createSweptAtTracker,
  type HubSweepProgress,
  type HubSweepReport,
  type HubSweepTarget,
} from "../sweepFrame";
import {
  type BackfillTools,
  type BackfillUnit,
  backfillBlueprintUnits,
  buildpicUploads,
  liveBackfillTools,
  picturesWanted,
  renderKeysToAsk,
} from "./blueprintBackfill";
import {
  recordBackfillWrites,
  unitsAffordableNow,
  writesLeftNow,
} from "./budget";
import { type AssetKey, assetsTheHubWants } from "./have";
import { RENDER_VERSION } from "./renderTop";
import { type AssetUpload, uploadAssetsToHub } from "./upload";

/**
 * Filling in the pictures the hub has none of, for the games on this computer
 * (issues #1952 and #1953).
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
 * ## Build pics before renders (issue #1953)
 *
 * Both classes are rationed the same way, at eighty writes a game an hour, and
 * that is what decides the order rather than which is cheaper to make.
 *
 * Eighty writes spent on build pics is eighty units that now have a picture on
 * the hub. The same eighty spent on renders is sixteen units with five pictures
 * each and three hundred and sixty three units still blank. For anybody reading a
 * game's unit list the first is most of a catalog and the second is a rounding
 * error, so the build pics go first and the renders get whatever is left.
 *
 * ## Whether a roster walk belongs in the client at all
 *
 * It was worth asking, because the map corpus answers the same question the
 * other way: map pictures reach the hub only through the seed export, run offline
 * by somebody who has the archives, on the grounds that the map set is bounded
 * and has no long tail.
 *
 * A game's roster is bounded in exactly that way, so a maintainer seed would
 * work. What decides it against is coverage rather than cost. A seed only ever
 * holds the games that maintainer has installed, at the versions they had, and a
 * unit's picture is keyed on the model's digest so a balance patch that changes a
 * model needs the picture made again. The client is the only thing that is
 * already sitting next to every installed game, including the ones nobody
 * maintaining a seed has heard of. So: both, eventually, and the client is the
 * one that does not need anybody to remember to run it.
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

/**
 * How far along a sweep is, for a progress line. `reading` covers the
 * survey, which is the models and the question to the hub. `filling` is the
 * drawing and the sending, which is the part that takes minutes. `done` and
 * `total` count games, and `game` is the one being read or filled.
 */
export type PictureSweepProgress = HubSweepProgress<
  "scanning" | "reading" | "filling"
>;

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
  /**
   * Units this run sent at least one picture of, which is what the hour's
   * allowance left room for.
   *
   * A union of the two passes rather than either of them. They overlap and
   * neither contains the other: a unit whose build pic the hub already held is
   * only in the render pass, and a unit the game ships no model for is only in
   * the other.
   */
  covered: number;
  /** Pictures the hub took. */
  written: number;
  /** Why the run did less than the whole game, when it did. */
  stopped?: string;
}

/** What a sweep did. `skipped` is the games that were never looked at, and
 *  `errors` is anything the worker reported while reading. */
export interface PictureSweepReport extends HubSweepReport<SkippedGame> {
  /** Games the machine has, before anything was ruled out. */
  found: number;
  /** One entry per game the sweep looked at. */
  games: GamePictures[];
  /** Games that fell over, and what they said. */
  failed: { game: string; said: string }[];
}

/** Everything this reaches outside itself, so a test can count the calls. */
export interface PictureSweepTools {
  scan: typeof unitsyncScan;
  dataset: typeof unitsyncUnitDataset;
  renderKeys: typeof unitsyncUnitRenderKeys;
  ask: typeof assetsTheHubWants;
  releases: typeof dlRapidReleaseArchives;
  /** Every build pic in a game, extracted and encoded ready to offer. */
  buildpics: typeof unitsyncUnitBuildpics;
  /** Send a set of pictures. Used directly for the build pic pass, which is a
   *  batch of ready bytes rather than anything that needs drawing. */
  upload: typeof uploadAssetsToHub;
  /** How much of the hour is left for one game, so a test can hand out its own. */
  affordable: typeof unitsAffordableNow;
  /** The same allowance in pictures rather than in units, which is what a pass
   *  sending one picture a unit counts in. */
  writesLeft: typeof writesLeftNow;
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
  buildpics: unitsyncUnitBuildpics,
  upload: uploadAssetsToHub,
  affordable: unitsAffordableNow,
  writesLeft: writesLeftNow,
  fill: backfillBlueprintUnits,
  backfill: liveBackfillTools,
  record: recordBackfillWrites,
};

export type PictureSweepTarget = HubSweepTarget;

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

  // The build pics first, and the whole roster's worth (issue #1953). They are
  // read out of the archive rather than drawn, so eighty of them is eighty units
  // that have a picture where the same eighty writes spent on renders would be
  // sixteen units with five each.
  const pics = await sendBuildpics(target, game, shortname, units, tools);

  // Then the renders. What every picture of every unit would be called, and
  // which of them the hub has not got, in one mount however long the roster is.
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
  // A unit is wanted if any of its pictures is, which is what makes the count
  // the one somebody is really asking about: how much of this game is uncovered.
  const wanting = unitsWithGaps(units, [...missing, ...pics.stillWanted]);
  const surveyed = {
    ...blank,
    units: units.length,
    wanted: wanting.length,
    written: pics.written,
    covered: pics.covered.length,
  };
  const rendering = unitsWithGaps(units, missing);
  if (rendering.length === 0) return surveyed;

  // And the render fill, over what came back missing rather than over the
  // roster's first however many. Whatever the build pics left of the hour.
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
      // Already done, a moment ago, over the whole roster rather than over this
      // narrowed list. Doing them again would be a mount and a few hundred
      // encodes to produce bytes the hub would answer `have` to.
      buildpics: false,
    },
    rendering,
    affordable,
    tools.backfill,
  );
  tools.record(shortname, filled.written);

  // A unit is covered if this run sent any picture of it, so the two passes are
  // a union rather than the larger of two counts: they overlap but neither
  // contains the other. A unit whose build pic the hub already had is only in
  // the render pass, and a unit the game ships no model for is only in the
  // other.
  //
  // The fill works through its list in order and reports how many it reached,
  // so its first `filled.units` are the ones it covered.
  const covered = new Set(pics.covered);
  for (const unit of rendering.slice(0, filled.units)) covered.add(unit.name);

  return {
    ...surveyed,
    covered: covered.size,
    written: surveyed.written + filled.written,
    ...(filled.stopped ? { stopped: filled.stopped } : {}),
  };
}

/** What the build pic pass came to. */
interface BuildpicPass {
  /** Pictures the hub took. */
  written: number;
  /** The units it sent one for, by name, so the run's coverage can be a union of
   *  the two passes rather than the larger of two counts. */
  covered: string[];
  /** The ones the hub is still missing, in {@link picturesWanted}'s spelling, so
   *  they can be folded into the count of how much of the game is uncovered. */
  stillWanted: string[];
}

/**
 * Send the build pics for a whole roster, before anything is drawn
 * (issue #1953).
 *
 * ## Why these go first
 *
 * A build pic is the icon the game already ships. Reading one out of the archive
 * is a mount and an encode, no GPU and no model, and it is 5 to 10 KB. A render
 * is seconds of drawing each and there are four of them a unit.
 *
 * Both are rationed the same way, at eighty writes a game an hour, and that is
 * what decides the order. Eighty writes spent on build pics is eighty units that
 * now have a picture on the hub. The same eighty spent on renders is sixteen
 * units with five pictures each and three hundred and sixty three units still
 * blank. For somebody looking at a game's unit list, the first is most of a
 * catalog and the second is a rounding error.
 *
 * ## Why they are extracted before they are asked about
 *
 * A build pic's `source_hash` is over the archive member, and reading that out
 * is most of the work of extracting it, so unlike a render there is no way to
 * ask the hub about one without making it first. That is affordable here for the
 * same reason it is affordable in the lazy path: extracting costs this machine a
 * mount and some encodes and costs the shared allowance nothing.
 *
 * Asking before uploading is what makes a second run reach units the first one
 * did not, which is the same rule the roster survey follows and for the same
 * reason. Offering the first eighty every time would find the hub already had
 * them and write nothing for ever.
 */
async function sendBuildpics(
  target: PictureSweepTarget,
  game: GameItem,
  shortname: string,
  units: readonly BackfillUnit[],
  tools: PictureSweepTools,
): Promise<BuildpicPass> {
  const nothing: BuildpicPass = { written: 0, covered: [], stillWanted: [] };

  const extracted = buildpicUploads(
    shortname,
    units,
    await tools.buildpics({
      enginePath: target.enginePath,
      dataDir: target.dataDir,
      gameArchive: game.primaryArchive.name,
      units: units.map((unit) => unit.name),
      assets: true,
    }),
  );
  if (extracted.length === 0) return nothing;

  const answers = await tools.ask(target.hubUrl, extracted.map(keyOf));
  const wanted = picturesWanted(extracted.map(keyOf), answers);
  if (wanted.length === 0) return nothing;

  // One write a picture here rather than a whole unit's worth, because that is
  // what this pass actually spends.
  const room = tools.writesLeft(shortname);
  if (room <= 0) return { ...nothing, stillWanted: wanted };

  const missing = new Set(wanted);
  const sending = extracted
    .filter((asset) => missing.has(pictureId(asset)))
    .slice(0, room);
  const run = await tools.upload(target.hubUrl, sending, {
    startedBy: "user",
    opId: crypto.randomUUID(),
  });
  tools.record(shortname, run.written);

  return {
    written: run.written,
    covered: sending.map((asset) =>
      asset.keyed_on === "unit" ? asset.unit_name : "",
    ),
    stillWanted: wanted,
  };
}

/** The have check's question for one ready upload. */
function keyOf(asset: AssetUpload): AssetKey {
  return asset.keyed_on === "unit"
    ? {
        keyed_on: "unit",
        game: asset.game,
        unit_name: asset.unit_name,
        variant: asset.variant,
        source_hash: asset.source_hash,
      }
    : {
        keyed_on: "map",
        map_name: asset.map_name,
        variant: asset.variant,
        source_hash: asset.source_hash,
      };
}

/** The same name `picturesWanted` answers in, so the two sets can be compared. */
function pictureId(asset: AssetUpload): string {
  return asset.keyed_on === "unit"
    ? `${asset.unit_name}\n${asset.variant}`
    : "";
}

/** Where the last sweep's finishing time is kept. */
export const LAST_SWEPT_KEY = "coilbox.hub.pictureSweptAt";

const sweptAt = createSweptAtTracker(LAST_SWEPT_KEY);

/** When a sweep last finished, or null for a machine that has never run one.
 *  See `createSweptAtTracker` in `../sweepFrame` for what this guards
 *  against. */
export const lastSweptAt = sweptAt.lastSweptAt;

/** Write down that a sweep has just finished. */
export const rememberSweptAt = sweptAt.rememberSweptAt;

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
