import { getVersion } from "@tauri-apps/api/app";
import { useCallback, useState } from "react";
import { loadContentState } from "@/content/contentState";
import {
  type InfologTail,
  type LaunchOutcome,
  playEngineOutput,
  playInfolog,
  playSystemInfo,
  type SystemInfo,
} from "./bindings";
import { isAbnormal } from "./crash";

/**
 * Post-crash triage (issue #379): after an abnormal exit, fetch the engine log
 * and decide whether it belongs to the run that just died.
 *
 * The Tauri-calling half, kept apart from the pure logic in `crash.ts`, the same
 * way `useSkirmishDebrief` sits apart from `debrief.ts`.
 */

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
  /** The whole log, or null when none was found or the newest predates the
   * run. The drawer shows only its path. The lines go into the copied report. */
  log: InfologTail | null;
  /** The whole of what the engine printed this run, or null when nothing was
   * written. It holds what never reaches the log, such as a C++ abort message. */
  output: InfologTail | null;
  system: SystemInfo | null;
  appVersion: string | null;
  /** The version the engine that ran reported, or its folder name when it has
   * not reported one. Null when the engine is no longer among the installed. */
  engineVersion: string | null;
  /** Set when a log exists but was written before this run started, so it
   * cannot be this crash's. */
  stale: boolean;
  /** When the run was looked at, milliseconds since the unix epoch. The
   * engine's output file was last written no later than this. */
  triagedAt: number;
}

/** The version of the installed engine whose binary is `executable`. */
async function installedEngineVersion(
  executable: string | undefined,
): Promise<string | null> {
  if (!executable) return null;
  try {
    const state = await loadContentState();
    for (const root of state.roots) {
      const e = root.engines.find((e) => e.executable === executable);
      if (e) return e.syncVersion ?? e.version;
    }
  } catch {
    // The report says the version is unknown.
  }
  return null;
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

      // Read now rather than when the player copies, because the next launch
      // overwrites both files. The whole of each: the drawer shows neither, and
      // the copied report carries all of it.
      const [log, output, system, appVersion, engineVersion] =
        await Promise.all([
          playInfolog({ dataDir }).then(
            (r) => r.log,
            () => null,
          ),
          playEngineOutput({}).then(
            (r) => r.log,
            () => null,
          ),
          playSystemInfo({}).catch(() => null),
          getVersion().catch(() => null),
          installedEngineVersion(rest.engine),
        ]);
      const stale = log != null && log.modifiedMs < startedAtMs;
      setTriage({
        ...rest,
        log: stale ? null : log,
        output: output && output.modifiedMs >= startedAtMs ? output : null,
        system,
        appVersion,
        engineVersion,
        stale,
        triagedAt: Date.now(),
      });
      setOpen(true);
    },
    [],
  );

  return { triage, open, setOpen, inspect };
}
