/**
 * The runs that are worth showing somebody, and the way to stop one (issue #1686).
 *
 * A backfill starts on its own when a blueprint is opened, and until now it was
 * invisible from beginning to end. For the ordinary run that is right: a layout
 * whose pictures the hub already holds is a have check and an archive read, and a
 * spinner for that is noise. The run this exists for is the first open of a game
 * nobody has uploaded, which draws a picture per unit and can hold the app for a
 * minute with nothing on screen saying why.
 *
 * ## What makes a run loud enough to show
 *
 * Renders, and nothing else. A run announces itself at the moment it knows it has
 * at least one picture to draw, which is after the have check and before the
 * models are read. Everything before that point is two requests, and everything
 * that stays silent is a run that had none to draw.
 *
 * That is a rule about the work rather than about the clock, so it is the same on
 * a fast machine and a slow one. What it does not cover is a run with no renders
 * and a long list of build pics to send, which stays invisible: those are already
 * extracted, cost nothing anybody shares, and are a few dozen files of about
 * 100 KB. If that turns out to be worth showing, this is the one predicate to
 * change.
 *
 * ## Stopping covers both halves of a run
 *
 * The minute is spent drawing, before `hub_upload_assets` is called at all, so a
 * stop that only reached the upload command would do nothing for most of the time
 * the button is on screen. {@link stopUploadRun} raises a flag the render loop
 * reads between pictures and calls `hub_upload_cancel` for the upload, so it
 * lands wherever the run has got to.
 *
 * Between pictures rather than inside one: a render is seconds, and unwinding a
 * GL draw halfway through to save two of them is not worth the machinery.
 *
 * Nothing here undoes an upload. A picture the hub has taken is on the hub, which
 * is what the run says afterwards.
 */

import { useSyncExternalStore } from "react";
import { cancelAssetUpload } from "./upload";

/** Which half of a run is going. */
export type UploadRunPhase = "drawing" | "sending";

/** One run somebody can see and stop. */
export interface RunningUpload {
  /** The id `hub_upload_cancel` stops the upload half by. */
  opId: string;
  /** The game whose pictures these are, so a person holding several knows. */
  game: string;
  phase: UploadRunPhase;
  /** Pictures decided in this phase, however they were decided. */
  done: number;
  /** Pictures this phase is working through. */
  total: number;
  /** Pictures the hub has taken. These stay on the hub whatever happens next. */
  sent: number;
  /** Somebody has asked it to stop and it has not stopped yet. */
  stopping: boolean;
}

let runs: readonly RunningUpload[] = [];
const listeners = new Set<() => void>();

function setRuns(next: readonly RunningUpload[]): void {
  runs = next;
  for (const listener of listeners) listener();
}

/** The runs on screen right now. A stable reference between changes, which is
 *  what `useSyncExternalStore` needs to not re-render forever. */
export function readRunningUploads(): readonly RunningUpload[] {
  return runs;
}

/** Subscribe a component to the running runs. */
export function useRunningUploads(): readonly RunningUpload[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readRunningUploads,
    readRunningUploads,
  );
}

/**
 * Put a run on screen. Called once the run knows it has pictures to draw, and
 * never for one that has not.
 *
 * A second call for the same id replaces the entry rather than adding one, so a
 * run cannot appear twice.
 */
export function showUploadRun(run: {
  opId: string;
  game: string;
  total: number;
}): void {
  const entry: RunningUpload = {
    opId: run.opId,
    game: run.game,
    phase: "drawing",
    done: 0,
    total: run.total,
    sent: 0,
    stopping: false,
  };
  setRuns([...runs.filter((r) => r.opId !== run.opId), entry]);
}

/** Move a run on. A no-op for an id that was never shown, which is how a run
 *  below the threshold reports progress to nobody. */
export function updateUploadRun(
  opId: string,
  patch: Partial<Omit<RunningUpload, "opId" | "game">>,
): void {
  if (!runs.some((run) => run.opId === opId)) return;
  setRuns(runs.map((run) => (run.opId === opId ? { ...run, ...patch } : run)));
}

/** Take a run off screen, however it ended. */
export function hideUploadRun(opId: string): void {
  if (!runs.some((run) => run.opId === opId)) return;
  setRuns(runs.filter((run) => run.opId !== opId));
}

/** Whether somebody has asked this run to stop. Read by the render loop between
 *  pictures, and false for a run nobody is watching. */
export function uploadRunStopping(opId: string): boolean {
  return runs.some((run) => run.opId === opId && run.stopping);
}

/** How many pictures this run has got onto the hub so far. */
export function uploadRunSent(opId: string): number {
  return runs.find((run) => run.opId === opId)?.sent ?? 0;
}

/**
 * Stop a run, wherever it has got to.
 *
 * The flag and the command both, because the two halves of a run are stopped by
 * different things and the button does not know which half it is in. The command
 * is a no-op for an id the plugin has not started yet, which is every moment of
 * the drawing half.
 */
export async function stopUploadRun(opId: string): Promise<void> {
  updateUploadRun(opId, { stopping: true });
  try {
    await cancelAssetUpload(opId);
  } catch (e) {
    // The flag is already up and the run reads that, so a plugin that would not
    // take the call still stops at the next picture.
    console.warn("could not cancel upload", opId, e);
  }
}

/** Forget every run. For tests, which must not inherit each other's. */
export function forgetRunningUploads(): void {
  setRuns([]);
}
