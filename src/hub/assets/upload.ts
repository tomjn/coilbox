/**
 * The one door to `hub_upload_assets` (issue #1679).
 *
 * The command has been sitting there with no caller since #1633 built it, which
 * meant a terminal rejection was returned to nobody: #1634 wrote the wording for
 * one and nothing ever called it. So this is deliberately the only way in. Every
 * run goes through {@link uploadAssetsToHub}, and it reports before it returns,
 * so the reporting cannot be forgotten by whatever gets written next.
 *
 * The have check runs inside the command, before anything is sent, so an asset
 * the hub already holds costs one key in a batch rather than a transfer. What is
 * handed back is one outcome per asset in the order they were given.
 *
 * ## Why the field names are snake case
 *
 * {@link AssetUpload} crosses into Rust as a struct rather than as a command
 * argument, and serde reads struct fields by the names they are declared with.
 * Tauri camelCases the command's own arguments and nothing inside them. The hub
 * refuses a field name it does not know rather than ignoring it, so a `sourceHash`
 * here would come back as a rejected upload on somebody's machine.
 */

import { defineCommand } from "@picoframe/plugin-sdk";
import { Channel } from "@tauri-apps/api/core";
import {
  type AssetOutcome,
  reportAssetUploadFailure,
  reportAssetUploadOutcomes,
  type UploadInitiator,
} from "../uploadOutcomes";
import type { AssetIdentity } from "./have";

/** What produced the bytes, which the hub records on the row so a later
 *  re-encode pass can target only what needs redoing. */
export type AssetOrigin = "extracted" | "rendered" | "uploaded";

/**
 * One picture to send: what it is, and where its encoded bytes are on disk.
 *
 * Three fields a caller might expect are deliberately absent. `width` and
 * `height` are read off the image header by the hub, `hash` is over the bytes in
 * the request and is computed by the hub, and `bytes` is filled in from the
 * file's own length. `source_hash` stays the caller's word because it is over the
 * raw archive bytes, which never reach the hub.
 */
export type AssetUpload = AssetIdentity & {
  /** sha256 over the source the picture was derived from, never over the encoded
   *  bytes. The same hash the have check was asked with. */
  source_hash: string;
  /** The vocabulary's `encodeProfile` for this variant's class. */
  encode_profile: string;
  origin: AssetOrigin;
  mime: string;
  /** The name the archive the picture came out of declares for itself, verbatim
   *  from the worker and never a file name (issue #1678). */
  source_archive: string;
  /** The map's size in elmos. Required on a map row, refused on a unit one. */
  map_width?: number;
  map_height?: number;
  /** For `overlay:height` and nothing else. */
  world_height_min?: number;
  world_height_max?: number;
  /** Where the encoded file is on this machine. Never sent. */
  path: string;
};

/** One progress sample, per asset rather than per chunk. */
export interface AssetUploadProgress {
  /** `asking` while the have check runs, `uploading` while an asset is in
   *  flight, `done` at the end. */
  phase: string;
  done: number;
  total: number;
  /** 0..=100, and null for an empty set. */
  percent: number | null;
  uploaded: number;
  alreadyHad: number;
  refused: number;
  uploadedBytes: number;
  /** Which picture this sample is about, when it is about one. */
  subject: string | null;
}

const hubUploadAssets = defineCommand<
  {
    hubUrl: string;
    assets: AssetUpload[];
    opId?: string;
    onProgress: Channel<AssetUploadProgress>;
  },
  { outcomes: AssetOutcome[]; outOfDate?: boolean }
>("coilbox-hub", "hub_upload_assets");

const hubUploadCancel = defineCommand<{ opId: string }, Record<string, never>>(
  "coilbox-hub",
  "hub_upload_cancel",
);

/** What a finished run came to. */
export interface AssetUploadRun {
  /** One per asset, in the order they were given. Empty when the run never
   *  started, which is what {@link error} says. */
  outcomes: AssetOutcome[];
  /** Rows the hub now holds these bytes for: taken plus replaced. This is what a
   *  rate limit counts, because it is what spends the shared allowance. */
  written: number;
  /** Why the run never started, in the words of whoever refused it: no usable
   *  sign-in, no permission to send pictures at all, or a hub that never
   *  answered. Null when the hub answered, however it answered. */
  error: string | null;
}

/**
 * Send a set of pictures to the hub, and tell somebody what came of it.
 *
 * Reports either way, which is the point of this being the only door. A run the
 * hub answered is summarised from its outcomes, and a run that never started is
 * worded from what refused it. Both go through `../uploadOutcomes`, so the run is
 * summarised rather than narrated and a run of three hundred rejections is still
 * at most two notifications.
 *
 * `startedBy` says who to report to and has no default, so a new caller cannot
 * get one by not thinking about it (issue #1690). Say `user` only when somebody
 * pressed something and is waiting for the answer.
 *
 * Nothing throws. A backfill is a background job, and a rejected promise from one
 * is a caller that has to remember to catch it or an unhandled rejection in the
 * console. The reason is in {@link AssetUploadRun.error} and has already been
 * said out loud.
 */
export async function uploadAssetsToHub(
  hubUrl: string,
  assets: AssetUpload[],
  options: {
    /** Who asked for this run, which decides whether it interrupts them. */
    startedBy: UploadInitiator;
    /** Makes the run cancellable by {@link cancelAssetUpload}. */
    opId?: string;
    onProgress?: (sample: AssetUploadProgress) => void;
  },
): Promise<AssetUploadRun> {
  if (assets.length === 0) return { outcomes: [], written: 0, error: null };

  const onProgress = new Channel<AssetUploadProgress>();
  if (options.onProgress) onProgress.onmessage = options.onProgress;

  const run = { game: gameUploadedFor(assets) };

  try {
    const { outcomes, outOfDate } = await hubUploadAssets({
      hubUrl,
      assets,
      ...(options.opId ? { opId: options.opId } : {}),
      onProgress,
    });
    reportAssetUploadOutcomes(outcomes, options.startedBy, {
      ...run,
      outOfDate: outOfDate === true,
    });
    return { outcomes, written: written(outcomes), error: null };
  } catch (e) {
    const said = e instanceof Error ? e.message : String(e);
    reportAssetUploadFailure(said, assets.length, options.startedBy, run);
    return { outcomes: [], written: 0, error: said };
  }
}

/**
 * The game a run's pictures are all for, or null when they are not all for one
 * (issue #1703).
 *
 * Read off the assets rather than passed in alongside them, so a caller cannot
 * name one game in the report and send another game's pictures. A map picture
 * has no game at all, which makes the whole run unattributable rather than
 * attributable to whatever the units in it happened to say.
 */
export function gameUploadedFor(assets: readonly AssetUpload[]): string | null {
  let game: string | null = null;
  for (const asset of assets) {
    if (asset.keyed_on !== "unit") return null;
    if (game === null) game = asset.game;
    else if (game !== asset.game) return null;
  }
  return game;
}

/** Stop a running upload by its `opId`. A no-op for an unknown or finished id. */
export async function cancelAssetUpload(opId: string): Promise<void> {
  await hubUploadCancel({ opId });
}

/** How many rows the hub now holds new bytes for. */
function written(outcomes: AssetOutcome[]): number {
  return outcomes.filter(
    (outcome) => outcome.result === "uploaded" || outcome.result === "replaced",
  ).length;
}
