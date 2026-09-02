import type { MapMinimapRow, MapMinimapsResult } from "@/content/bindings";
import { unitsyncMapMinimaps } from "@/content/bindings";
import { recordBackfillWrites, writesLeftNow } from "../assets/budget";
import {
  type AssetKey,
  assetsTheHubWants,
  type HaveResult,
} from "../assets/have";
import { type AssetUpload, uploadAssetsToHub } from "../assets/upload";
import { MINIMAP_VARIANT } from "../assets/vocabulary";

/**
 * Sending the hub a picture of every map on this computer (issue #2379).
 *
 * ## What was wrong
 *
 * Settings could send pictures of your games and it could send what your maps
 * say, and there was nothing in coilbox that ever sent a picture of a map. So
 * pressing "Send what your maps say" created hub rows for maps nobody had, each
 * with no picture on it and nothing that would ever fill it in. The hub browser
 * fell back to a drawing made from the map's name. Somebody contributing their
 * map library in good faith made the catalog worse.
 *
 * The switch above both buttons has always said coilbox "makes pictures of the
 * units and maps inside them, and sends those pictures to the hub". This is the
 * maps half of that sentence.
 *
 * ## This overturns section 4.6.1 of the asset pipeline design
 *
 * That section ruled there would be no client upload path for maps, on the
 * grounds that the map set is bounded at roughly 3,575 archives and a maintainer
 * holding them can seed the lot in one walk. The reasoning was sound and the
 * outcome was not: the seed is a maintainer job, nobody has run one, and the
 * gap it leaves is not one a player can close. Both paths now exist, the same
 * way both exist for a game's build pics, and they produce identical bytes for
 * an identical map because both go through the worker's one encoder.
 *
 * ## Ask before encoding anything
 *
 * A minimap's identity is the texture unitsync produces rather than the WebP
 * coilbox encodes from it, so the whole library can be named without encoding
 * any of it. The survey does that, the hub says which pictures it is missing,
 * and only those are encoded. On a library the hub already holds this costs one
 * question and no encoding at all.
 *
 * That order is also the whole of why pressing the button again carries on
 * rather than starting over. Nothing is remembered about where the last run got
 * to, because nothing needs to be: the hub's answers moved, so the second run's
 * survey comes back wanting what the first run did not reach.
 *
 * ## One hourly allowance for every map, not one per map
 *
 * A game's pictures are rationed at eighty writes an hour for that game, and the
 * hub's own cap is per subject too, so a client walking one roster is bounded
 * twice over. Neither of those bounds a map walk. Three thousand maps is three
 * thousand subjects with one picture each, so the hub's per subject cap never
 * bites and a per map cap here would be no cap at all.
 *
 * So the ration is one bucket over every map: eighty map pictures an hour from
 * this machine, whichever maps they are. It is the only thing standing between a
 * large library and an upload allowance the whole community shares, and running
 * that out is thirty days with no uploads at all.
 */

/** How far along a sweep is, for a progress line. Counted in maps. */
export interface MapPictureSweepProgress {
  /**
   * What the sweep is doing now. `reading` is the survey over the whole library,
   * `asking` is the have check, `encoding` is making the pictures the hub asked
   * for, and `sending` is the transfer.
   */
  phase: "reading" | "asking" | "encoding" | "sending";
  done: number;
  total: number;
}

/** What a sweep did, in counts rather than in words. */
export interface MapPictureSweepReport {
  /** Maps the library offered a picture for, after duplicates, working folders
   *  and maps with no minimap in them. */
  read: number;
  /** Maps the hub was missing a picture of, before this run. */
  wanted: number;
  /** Maps the hub now holds a picture of that it did not before. */
  sent: number;
  /** Maps still waiting after this run, which is what says whether pressing it
   *  again is worth anything. */
  left: number;
  /** Why the run did less than the whole library, when it did. */
  stopped?: string;
  /** Maps that produced no picture, and why. */
  skipped: MapMinimapsResult["skipped"];
  /** Anything the worker reported while reading. */
  errors: string[];
}

/** Everything this reaches outside itself, so a test can count the calls. */
export interface MapPictureSweepTools {
  minimaps: typeof unitsyncMapMinimaps;
  ask: typeof assetsTheHubWants;
  upload: typeof uploadAssetsToHub;
  /** What is left of the hour, in pictures. */
  writesLeft: typeof writesLeftNow;
  record: typeof recordBackfillWrites;
}

export const liveMapPictureSweepTools: MapPictureSweepTools = {
  minimaps: unitsyncMapMinimaps,
  ask: assetsTheHubWants,
  upload: uploadAssetsToHub,
  writesLeft: writesLeftNow,
  record: recordBackfillWrites,
};

export interface MapPictureSweepTarget {
  hubUrl: string;
  enginePath: string;
  dataDir: string;
}

/**
 * What the hourly allowance is counted against for map pictures.
 *
 * One name for every map, which is the point: see the note above about why a per
 * map bucket would bound nothing. It shares the ledger with the game buckets so
 * the pruning is one rule, and the colon keeps it out of the namespace those use,
 * since a modinfo shortname with one in it could not be addressed by rapid.
 */
export const MAP_PICTURES_SUBJECT = "map:minimap";

/** Where the last map picture sweep's finishing time is kept. */
export const LAST_MAP_SWEPT_KEY = "coilbox.hub.mapPictureSweptAt";

const nothing: MapPictureSweepReport = {
  read: 0,
  wanted: 0,
  sent: 0,
  left: 0,
  skipped: [],
  errors: [],
};

/**
 * The maps the hub still wants a picture of, in the survey's order.
 *
 * Zipped by index, which is what the have check promises. A short answer means
 * the two cannot be lined up, and lining them up wrongly would send the wrong
 * pictures under the wrong names, so it sends none.
 *
 * Exported for its own test, since this is the whole of what makes a second run
 * reach maps the first one did not.
 */
export function mapsTheHubHasNoPictureOf(
  rows: readonly MapMinimapRow[],
  answers: readonly HaveResult[],
): MapMinimapRow[] {
  if (answers.length !== rows.length) return [];
  return rows.filter((_, at) => answers[at].status !== "have");
}

/** The have check's question for one surveyed map. */
export function minimapKey(row: MapMinimapRow): AssetKey {
  return {
    keyed_on: "map",
    map_name: row.mapName,
    variant: MINIMAP_VARIANT,
    source_hash: row.sourceHash,
  };
}

/**
 * One encoded minimap as a declaration the upload takes.
 *
 * `map_width` and `map_height` are required on a map row and refused on a unit
 * one, and they are the map's size in elmos rather than the picture's pixels:
 * the texture is square and almost no map is, so they are what a consumer
 * stretches it back to.
 *
 * Null for a map the encode pass produced nothing for, which is a map that was
 * wanted and then would not encode.
 */
export function minimapUpload(row: MapMinimapRow): AssetUpload | null {
  const asset = row.asset;
  if (!asset) return null;
  return {
    keyed_on: "map",
    map_name: row.mapName,
    variant: asset.variant,
    source_hash: asset.sourceHash,
    encode_profile: asset.encodeProfile,
    // Read out of the map file rather than drawn, the same word the worker puts
    // on the asset and the same one a build pic carries.
    origin: "extracted",
    mime: asset.mime,
    source_archive: asset.sourceArchive,
    map_width: row.mapWidth,
    map_height: row.mapHeight,
    path: asset.path,
  };
}

/**
 * Send the hub a picture of every map on this machine that it has not got.
 *
 * `onProgress` is called as each phase moves, in maps. Nothing here catches its
 * own errors: a hub that cannot be reached, or a consent that has not been
 * given, is refused on the Rust side and worded there, and the caller reports it.
 */
export async function sweepMapPictures(
  target: MapPictureSweepTarget,
  onProgress: (progress: MapPictureSweepProgress) => void = () => {},
  tools: MapPictureSweepTools = liveMapPictureSweepTools,
): Promise<MapPictureSweepReport> {
  const report = await sweep(target, onProgress, tools);
  // Written down whatever the sweep found, including nothing, because what it
  // answers is whether this has ever run rather than whether it sent anything.
  rememberMapSweptAt();
  return report;
}

async function sweep(
  target: MapPictureSweepTarget,
  onProgress: (progress: MapPictureSweepProgress) => void,
  tools: MapPictureSweepTools,
): Promise<MapPictureSweepReport> {
  const { hubUrl, enginePath, dataDir } = target;

  // The survey: what every map's picture would be called, with nothing encoded.
  onProgress({ phase: "reading", done: 0, total: 0 });
  const surveyed = await tools.minimaps({ enginePath, dataDir });
  const rows = surveyed.maps;
  onProgress({ phase: "reading", done: rows.length, total: rows.length });
  const found: MapPictureSweepReport = {
    ...nothing,
    read: rows.length,
    skipped: surveyed.skipped,
    errors: surveyed.errors,
  };
  if (rows.length === 0) return found;

  // The have check, which is what turns a library into a handful.
  onProgress({ phase: "asking", done: 0, total: rows.length });
  const answers = await tools.ask(hubUrl, rows.map(minimapKey));
  onProgress({ phase: "asking", done: rows.length, total: rows.length });
  const wanted = mapsTheHubHasNoPictureOf(rows, answers);
  const surveyedReport = {
    ...found,
    wanted: wanted.length,
    left: wanted.length,
  };
  if (wanted.length === 0) return surveyedReport;

  // The hour's allowance, spent on what came back missing rather than on the
  // library's first however many. Taken after the survey and before the encode,
  // which is the only place it saves work rather than wasting it.
  const room = tools.writesLeft(MAP_PICTURES_SUBJECT);
  if (room <= 0) {
    return {
      ...surveyedReport,
      stopped:
        "Coilbox has already sent this hour's map pictures. Press it again later to carry on.",
    };
  }
  const sending = wanted.slice(0, room);

  // The encode, for those maps alone.
  onProgress({ phase: "encoding", done: 0, total: sending.length });
  const encoded = await tools.minimaps({
    enginePath,
    dataDir,
    maps: sending.map((row) => row.mapName),
    assets: true,
  });
  const uploads = encoded.maps
    .map(minimapUpload)
    .filter((upload): upload is AssetUpload => upload !== null);
  onProgress({
    phase: "encoding",
    done: uploads.length,
    total: sending.length,
  });

  const report: MapPictureSweepReport = {
    ...surveyedReport,
    skipped: [...surveyed.skipped, ...encoded.skipped],
    errors: [...surveyed.errors, ...encoded.errors],
    ...(wanted.length > sending.length
      ? {
          stopped: `${sending.length} of the ${wanted.length} maps the hub is missing fit in this hour's allowance.`,
        }
      : {}),
  };
  if (uploads.length === 0) return report;

  onProgress({ phase: "sending", done: 0, total: uploads.length });
  const run = await tools.upload(hubUrl, uploads, {
    startedBy: "user",
    opId: crypto.randomUUID(),
    onProgress: (sample) =>
      onProgress({
        phase: "sending",
        done: sample.done,
        total: sample.total,
      }),
  });
  tools.record(MAP_PICTURES_SUBJECT, run.written);

  return {
    ...report,
    sent: run.written,
    left: Math.max(0, wanted.length - run.written),
  };
}

/**
 * When a map picture sweep last finished, or null on a machine that has never
 * run one.
 *
 * Guarded the way every other `localStorage` reader here is: a webview with
 * storage off reads as never, which is a line that does not appear rather than a
 * run that cannot start.
 */
export function lastMapSweptAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_MAP_SWEPT_KEY);
    const at = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/** Write down that a sweep has just finished. */
export function rememberMapSweptAt(now = Date.now()): void {
  try {
    localStorage.setItem(LAST_MAP_SWEPT_KEY, String(now));
  } catch {
    // No storage. The sweep still happened, it simply cannot say so next launch.
  }
}

/**
 * What to tell somebody a sweep did, in one sentence.
 *
 * The number that matters is how many maps are still waiting, because that is
 * the one that says whether pressing the button again is worth anything.
 */
export function mapPictureSweepSummary(report: MapPictureSweepReport): string {
  if (report.read === 0) return "Coilbox found no maps to draw.";
  if (report.wanted === 0) {
    return "The hub already has a picture of every map on this computer.";
  }
  const sent =
    report.sent === 0
      ? "Sent no pictures."
      : report.sent === 1
        ? "Sent one map's picture."
        : `Sent ${report.sent} maps' pictures.`;
  if (report.left === 0) {
    return `${sent} The hub now has a picture of every map on this computer.`;
  }
  const maps = report.left === 1 ? "map is" : "maps are";
  return `${sent} ${report.left} more ${maps} still waiting. Press it again later to carry on.`;
}
