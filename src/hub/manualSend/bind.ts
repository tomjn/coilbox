import {
  livePictureSweepTools,
  type PictureSweepTools,
} from "../assets/pictureSweep";
import { uploadRunStopping } from "../assets/runningUploads";
import { liveSweepTools, type SweepTools } from "../maps/catalogSweep";
import {
  liveMapPictureSweepTools,
  type MapPictureSweepTools,
} from "../maps/pictureSweep";

/**
 * The sweeps' tools with one manual send's grant and run bound in.
 *
 * The sweeps already take their tools as an argument, so a manual send runs the
 * same sweep code as an automatic one and only the tools differ. Each call that
 * reaches the hub carries the grant, every upload carries the run's op id so the
 * badge's Stop cancels whichever upload is in flight, and the picture fill
 * reports into the run's row rather than opening its own.
 *
 * Every bound call checks the run's stop flag first and throws
 * {@link SendStopped} when it is up. That is what ends a send between its
 * phases: the facts, the build pics and the renders are separate calls, and a
 * cancelled upload alone would let the next phase start.
 */
export interface ManualRun {
  grant: string;
  opId: string;
  /** Set when the send has failed and must go no further. Every bound call
   *  after that throws it. */
  abort?: string;
}

/** Thrown by a bound tool once somebody has pressed Stop on the run. */
export class SendStopped extends Error {
  constructor() {
    super("Stopped");
    this.name = "SendStopped";
  }
}

function guard(run: ManualRun): void {
  if (uploadRunStopping(run.opId)) throw new SendStopped();
  if (run.abort) throw new Error(run.abort);
}

/** Tools for `sweepGamePictures`, which sends a game's facts and pictures. */
export function bindGameTools(
  run: ManualRun,
  base: PictureSweepTools = livePictureSweepTools,
): PictureSweepTools {
  const ask: PictureSweepTools["ask"] = (hubUrl, keys) => {
    guard(run);
    return base.ask(hubUrl, keys, run.grant);
  };
  const upload: PictureSweepTools["upload"] = (hubUrl, assets, options) => {
    guard(run);
    return base.upload(hubUrl, assets, {
      ...options,
      opId: run.opId,
      grant: run.grant,
    });
  };
  return {
    ...base,
    ask,
    upload,
    publishFacts: (hubUrl, game) => {
      guard(run);
      return base.publishFacts(hubUrl, game, run.grant);
    },
    fill: (target, units, affordable, backfill) => {
      guard(run);
      return base.fill(
        { ...target, opId: run.opId },
        units,
        affordable,
        backfill,
      );
    },
    backfill: { ...base.backfill, ask, upload },
  };
}

/** Tools for `sweepMapCatalog`, which sends a map's facts. */
export function bindMapTools(
  run: ManualRun,
  base: SweepTools = liveSweepTools,
): SweepTools {
  return {
    ...base,
    ask: (hubUrl, keys, onProgress) => {
      guard(run);
      return base.ask(hubUrl, keys, onProgress, run.grant);
    },
    send: (hubUrl, entries, onProgress) => {
      guard(run);
      return base.send(hubUrl, entries, onProgress, run.grant);
    },
  };
}

/** Tools for `sweepMapPictures`, which sends a map's minimap and overlays. */
export function bindMapPictureTools(
  run: ManualRun,
  base: MapPictureSweepTools = liveMapPictureSweepTools,
): MapPictureSweepTools {
  return {
    ...base,
    ask: (hubUrl, keys) => {
      guard(run);
      return base.ask(hubUrl, keys, run.grant);
    },
    upload: (hubUrl, assets, options) => {
      guard(run);
      return base.upload(hubUrl, assets, {
        ...options,
        opId: run.opId,
        grant: run.grant,
      });
    },
  };
}
