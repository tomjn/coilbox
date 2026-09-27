import { Channel } from "@tauri-apps/api/core";
import type {
  MapCatalogEntry,
  MapCatalogProgress,
  MapCatalogResult,
  MapCatalogSkip,
} from "../../content/bindings";
import { unitsyncMapCatalog } from "../../content/bindings";
import {
  type HubSweepProgress,
  type HubSweepReport,
  type HubSweepTarget,
  skipSummary,
} from "../sweepFrame";
import {
  type MapSubmitOutcome,
  type MapSubmitResult,
  mapsTheHubWants,
  publishMapFacts,
  wantsSubmission,
} from "./catalog";

/**
 * Read the map library, through a plain callback rather than the raw
 * `Channel` `unitsyncMapCatalog` itself takes.
 *
 * A fresh channel per call, never reused: a `Channel` stops delivering once the
 * command it was made for has returned. Wrapping it here, rather than in
 * {@link sweepMapCatalog} itself, is also what keeps a test able to swap the
 * whole call out through {@link SweepTools} without a real `Channel` ever being
 * constructed, since that needs a webview to exist.
 */
async function readMapCatalog(
  args: {
    enginePath: string;
    dataDir: string;
    maps?: string[];
    keysOnly: boolean;
  },
  onProgress: (sample: MapCatalogProgress) => void = () => {},
): Promise<MapCatalogResult> {
  const channel = new Channel<MapCatalogProgress>();
  channel.onmessage = onProgress;
  return unitsyncMapCatalog({ ...args, onProgress: channel });
}

/**
 * Reading the installed map library and sending the hub what it does not have
 * (issue #1737).
 *
 * ## Why it is two passes and not one
 *
 * A library is almost entirely maps the hub already knows about. The first pass
 * asks each map's archive for its name and its sha256, which is a have check's
 * whole question, and the second reads the facts of only the maps the hub said
 * it wanted. The facts are the expensive half: they cost a read of the map's
 * whole height grid, tens of megabytes each.
 *
 * On this maintainer's library of 103 maps, a cold first pass is about 48
 * seconds, almost all of it hashing archives, and a second run is one second
 * because the hashes are cached on file identity. The second pass is about 0.7
 * seconds a map, paid only for the maps the hub wants.
 *
 * ## What it does not do
 *
 * It does not send pictures. That is `./pictureSweep.ts`, on its own button
 * (issue #2379), because the two halves of what a map contributes are paced
 * nothing alike: these facts finish in one press and a picture spends part of an
 * hourly allowance the whole community shares.
 *
 * ## What is worth telling somebody afterwards
 *
 * Two numbers: how many maps were sent, and how many the hub would not take. The
 * second one is the interesting one, and not because the hub misbehaved. A
 * conflict means an archive on this machine differs from the one everybody else
 * has under that name, which is a thing worth knowing on its own: that install
 * shows as out of sync in a lobby and desyncs in a game.
 */

/** How far along a sweep is, for a progress line. `done` and `total` count
 *  maps rather than bytes, because facts are small and what moves is the
 *  count. */
export type SweepProgress = HubSweepProgress<"reading" | "asking" | "sending">;

/** What a sweep did, in counts rather than in words. `skipped` is the maps
 *  the library could not produce facts for, and why. */
export interface SweepReport
  extends HubSweepReport<MapCatalogResult["skipped"][number]> {
  /** Maps the library offered, after duplicates and unreadable archives. */
  read: number;
  /** Maps the hub was asked about, which is the same number. */
  asked: number;
  /** Maps the hub said it wanted. */
  wanted: number;
  /** Maps whose facts the hub now holds: stored, replaced or already the same. */
  sent: number;
  /** Maps the hub would not take, which is a conflict or a refusal. */
  refused: number;
  /** The refusals themselves, so a caller can say which maps and why. */
  problems: MapSubmitResult[];
}

/** Everything this reaches outside itself, so a test can count the calls. */
export interface SweepTools {
  catalog: typeof readMapCatalog;
  ask: typeof mapsTheHubWants;
  send: typeof publishMapFacts;
}

export const liveSweepTools: SweepTools = {
  catalog: readMapCatalog,
  ask: mapsTheHubWants,
  send: publishMapFacts,
};

export type SweepTarget = HubSweepTarget;

/** An outcome that means the hub now holds these facts, or already did. */
function isHeld(outcome: MapSubmitOutcome): boolean {
  return (
    outcome === "stored" || outcome === "replaced" || outcome === "unchanged"
  );
}

const nothing: SweepReport = {
  read: 0,
  asked: 0,
  wanted: 0,
  sent: 0,
  refused: 0,
  problems: [],
  skipped: [],
  errors: [],
};

/**
 * Read the map library and send the hub the facts it does not have.
 *
 * `onProgress` is called as each phase moves, in maps. Nothing here catches its
 * own errors: a hub that cannot be reached, or a consent that has not been
 * given, is the caller's to report, and the Rust side words both.
 */
export async function sweepMapCatalog(
  target: SweepTarget,
  onProgress: (progress: SweepProgress) => void = () => {},
  tools: SweepTools = liveSweepTools,
): Promise<SweepReport> {
  const { hubUrl, enginePath, dataDir } = target;

  // Pass one: every map's archive, hashed. No infomaps, no height grids. The
  // worker reports one sample per map as it hashes, rather than one at the end,
  // because this pass alone is close to a minute on a large library (issue
  // #3147).
  onProgress({ phase: "reading", done: 0, total: 0 });
  const keys = await tools.catalog(
    { enginePath, dataDir, keysOnly: true },
    (sample) => onProgress({ phase: "reading", ...sample }),
  );
  const rows = keys.maps;
  onProgress({ phase: "reading", done: rows.length, total: rows.length });
  if (rows.length === 0) {
    return { ...nothing, skipped: keys.skipped, errors: keys.errors };
  }

  // The have check, which is what turns a library into a handful. Reported
  // after every request it takes, so a library split into six batches moves in
  // six steps rather than sitting at zero until the last one lands.
  onProgress({ phase: "asking", done: 0, total: rows.length });
  const answers = await tools.ask(
    hubUrl,
    rows.map((row) => ({
      map_name: row.mapName,
      source_hash: row.sourceHash,
      catalog_version: row.catalogVersion,
    })),
    (sample) => onProgress({ phase: "asking", ...sample }),
  );
  onProgress({ phase: "asking", done: rows.length, total: rows.length });

  // Answers come back in request order, and the Rust side has already refused
  // any batch that did not, so this reads by index.
  const wanted = rows
    .filter((_, index) => {
      const answer = answers[index];
      return answer !== undefined && wantsSubmission(answer.status);
    })
    .map((row) => row.mapName);

  if (wanted.length === 0) {
    return {
      ...nothing,
      read: rows.length,
      asked: rows.length,
      skipped: keys.skipped,
      errors: keys.errors,
    };
  }

  // Pass two: the facts, for the wanted maps alone.
  onProgress({ phase: "reading", done: 0, total: wanted.length });
  const facts = await tools.catalog(
    { enginePath, dataDir, maps: wanted, keysOnly: false },
    (sample) => onProgress({ phase: "reading", ...sample }),
  );
  const entries = facts.maps
    .map((row) => row.entry)
    .filter((entry): entry is MapCatalogEntry => entry !== undefined);
  onProgress({
    phase: "reading",
    done: entries.length,
    total: wanted.length,
  });

  onProgress({ phase: "sending", done: 0, total: entries.length });
  const results = await tools.send(hubUrl, entries, (sample) =>
    onProgress({ phase: "sending", ...sample }),
  );
  onProgress({ phase: "sending", done: entries.length, total: entries.length });

  const problems = results.filter((result) => !isHeld(result.outcome));
  return {
    read: rows.length,
    asked: rows.length,
    wanted: wanted.length,
    sent: results.length - problems.length,
    refused: problems.length,
    problems,
    // Both passes can skip a map, and the second one only sees the maps the
    // first one produced, so its skips are the ones that turned up on a closer
    // read.
    skipped: [...keys.skipped, ...facts.skipped],
    errors: [...keys.errors, ...facts.errors],
  };
}

/**
 * The order a map catalog skip is worth mentioning in, and what to call it.
 * There is no ordinary case here the way `no-source` is for a picture: every
 * one of these is coilbox finding a problem with an archive rather than a map
 * simply having nothing to offer.
 */
const CATALOG_SKIP_ORDER: readonly MapCatalogSkip[] = [
  "no-archive-file",
  "unreadable-archive",
  "duplicate-map",
  "no-extent",
  "no-height-range",
];

const CATALOG_SKIP_CLAUSES: Record<MapCatalogSkip, string> = {
  "no-archive-file": "whose archive file is missing",
  "unreadable-archive": "whose archive coilbox could not read",
  "duplicate-map": "listed twice in the library",
  "no-extent": "whose size coilbox could not work out",
  "no-height-range": "whose height range coilbox could not read",
};

/** What to tell somebody about the maps a sweep skipped, in one sentence, or
 *  `null` when nothing was skipped. */
export function catalogSkipSummary(
  skipped: SweepReport["skipped"],
): string | null {
  return skipSummary(skipped, CATALOG_SKIP_ORDER, CATALOG_SKIP_CLAUSES);
}

/**
 * What to tell somebody a sweep did, in one sentence, or `null` when there is
 * nothing worth saying.
 *
 * A conflict is worded as what it means for this machine rather than as a hub
 * problem, because that is the more useful reading and the one nobody else can
 * tell them. A skip account is appended when there is one, since those maps
 * were never asked about at all (issue #2390).
 */
export function sweepSummary(report: SweepReport): string | null {
  const skipNote = catalogSkipSummary(report.skipped);
  const say = (sentence: string): string =>
    skipNote ? `${sentence} ${skipNote}` : sentence;

  if (report.read === 0) return say("Coilbox found no maps to read.");
  const sent =
    report.sent === 0
      ? "The hub already had every map on this machine."
      : `Sent facts for ${report.sent} ${report.sent === 1 ? "map" : "maps"}.`;
  if (report.refused === 0) return say(sent);
  const conflicts = report.problems.filter(
    (problem) => problem.outcome === "conflict",
  ).length;
  if (conflicts === report.refused) {
    return say(
      `${sent} ${conflicts} ${conflicts === 1 ? "map differs" : "maps differ"} from the version everyone else has under the same name, so ${conflicts === 1 ? "it" : "they"} would not match in a game.`,
    );
  }
  return say(`${sent} The hub would not take ${report.refused} of them.`);
}
