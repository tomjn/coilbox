import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";

/** What the taskbar button (Windows) or dock icon (macOS) should show. */
export type TaskbarProgress =
  | { kind: "none" }
  | { kind: "indeterminate" }
  | { kind: "normal"; percent: number }
  | { kind: "error" };

/** The part of a running download the combined figure reads. */
export interface ProgressReading {
  progress: { percent: number | null } | null;
}

/**
 * The one figure for every download running now: the mean of the percentages
 * of those that have one, rounded to a whole number. A download that has not
 * reported yet, or reports no percentage (see `progressChannel`), is left out
 * of the mean rather than counted as zero, so it does not drag the bar back.
 * When none of them has a percentage the bar is indeterminate, and when none
 * is running there is nothing to show.
 */
export function combineProgress(running: ProgressReading[]): TaskbarProgress {
  if (running.length === 0) return { kind: "none" };
  const percents = running.flatMap((d) =>
    d.progress?.percent == null ? [] : [d.progress.percent],
  );
  if (percents.length === 0) return { kind: "indeterminate" };
  const mean = percents.reduce((sum, p) => sum + p, 0) / percents.length;
  return {
    kind: "normal",
    percent: Math.round(Math.min(100, Math.max(0, mean))),
  };
}

/**
 * What to show given the downloads running and whether a failure is still
 * unseen. Running downloads win over a failure, since their progress is what
 * is changing. The failure shows once nothing else is running.
 */
export function taskbarProgress(
  running: ProgressReading[],
  failureUnseen: boolean,
): TaskbarProgress {
  const combined = combineProgress(running);
  if (combined.kind === "none" && failureUnseen) return { kind: "error" };
  return combined;
}

// Calls go out one after another, so a clear cannot land after the bar that
// replaced it.
let queue: Promise<void> = Promise.resolve();

function warn(e: unknown) {
  console.warn("downloads: setProgressBar failed", e);
}

/**
 * Send the state to the window. A rejection is logged and dropped, because
 * some desktops have no taskbar progress, and so is a missing window API.
 *
 * The native bar keeps the last value it was given when it is hidden, and
 * macOS draws that value again under the next state that sends none. So a
 * clear resets the value to zero first, then hides. Indeterminate sends no
 * value on purpose: on Windows a value turns it back into a normal bar.
 */
async function send(next: TaskbarProgress) {
  const win = getCurrentWindow();
  switch (next.kind) {
    case "none":
      await win.setProgressBar({ progress: 0 });
      await win.setProgressBar({ status: ProgressBarStatus.None });
      return;
    case "indeterminate":
      await win.setProgressBar({ status: ProgressBarStatus.Indeterminate });
      return;
    case "normal":
      await win.setProgressBar({
        status: ProgressBarStatus.Normal,
        progress: next.percent,
      });
      return;
    case "error":
      await win.setProgressBar({
        status: ProgressBarStatus.Error,
        progress: 100,
      });
      return;
  }
}

/**
 * Keep the taskbar progress matching `next`. Calls the window only when the
 * state changes, and never before something has been shown, so an app that has
 * downloaded nothing never touches the progress bar.
 */
export function useTaskbarProgress(next: TaskbarProgress): void {
  const shown = useRef<string | null>(null);
  const key = next.kind === "normal" ? `normal:${next.percent}` : next.kind;
  useEffect(() => {
    if (key === shown.current) return;
    if (key === "none" && shown.current === null) return;
    shown.current = key === "none" ? null : key;
    queue = queue.then(() => send(next)).catch(warn);
  }, [key, next]);
}
