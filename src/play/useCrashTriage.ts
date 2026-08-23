import { useCallback, useState } from "react";
import { type InfologTail, type LaunchOutcome, playInfolog } from "./bindings";
import { isAbnormal } from "./crash";

/**
 * Post-crash triage (issue #379): after an abnormal exit, fetch the engine log
 * and decide whether it belongs to the run that just died.
 *
 * The Tauri-calling half, kept apart from the pure logic in `crash.ts`, the same
 * way `useSkirmishDebrief` sits apart from `debrief.ts`.
 */

/** How many lines the drawer shows. Long enough for a stack trace plus the
 * loading that led to it, short enough to scroll. */
const TAIL_LINES = 200;

/** What the drawer needs to describe a dead run. */
export interface CrashContext {
  outcome: LaunchOutcome;
  /** What was being run: "skirmish", "replay" and so on. */
  runKind: string;
  game?: string;
  map?: string;
  engine?: string;
  /** The replay or savegame being played back, when that is what died. Coilbox
   * doesn't know its game or map: the engine reads those from the file. */
  file?: string;
}

export interface CrashTriage extends CrashContext {
  /** The log, or null when none was found or the newest predates the run. */
  log: InfologTail | null;
  /** Set when a log exists but was written before this run started, so it
   * cannot be this crash's. */
  stale: boolean;
}

export function useCrashTriage() {
  const [triage, setTriage] = useState<CrashTriage | null>(null);
  const [open, setOpen] = useState(false);

  /**
   * Look at a finished run and, when it ended badly, open the drawer with
   * whatever the engine left behind.
   *
   * `startedAtMs` is when the launch began, which is the only way to tell this
   * run's log from yesterday's. An engine that dies before it opens its log file
   * leaves the previous session's behind, and showing that would be worse than
   * showing nothing, because it reads as evidence.
   *
   * A failure to read the log is not reported as an error. The exit status is
   * the news, and it is shown either way.
   */
  const inspect = useCallback(
    async (ctx: CrashContext & { dataDir: string; startedAtMs: number }) => {
      const { dataDir, startedAtMs, ...rest } = ctx;
      if (!isAbnormal(rest.outcome)) return;

      let log: InfologTail | null = null;
      try {
        const res = await playInfolog({ dataDir, maxLines: TAIL_LINES });
        log = res.log;
      } catch {
        log = null;
      }
      const stale = log != null && log.modifiedMs < startedAtMs;
      setTriage({ ...rest, log: stale ? null : log, stale });
      setOpen(true);
    },
    [],
  );

  return { triage, open, setOpen, inspect };
}
