/**
 * What the four hub background sweeps have in common (issue #2442):
 * `hub/assets/pictureSweep.ts`, `hub/maps/pictureSweep.ts`,
 * `hub/games/factsSweep.ts` and `hub/maps/catalogSweep.ts`.
 *
 * Every sweep sends to the same three-field target, reports its progress as a
 * phase with a count, and lists what it skipped and what the worker
 * complained about. That much is the frame below. What is not here is
 * everything that makes the four different: the tools each one calls, the
 * shape of what it sends, and the fields that count its own work.
 *
 * Two of the four also keep a "last swept at" timestamp: `pictureSweepAt` in
 * `hub/assets/pictureSweep.ts` and `mapPictureSweptAt` in
 * `hub/maps/pictureSweep.ts`, both built on `createSweptAtTracker` below.
 * `hub/games/factsSweep.ts` and `hub/maps/catalogSweep.ts` keep no such
 * record, and nothing here asks them to.
 */

/** Where a sweep sends to and what it reads from. The same three fields for
 *  every sweep, whatever the subject. */
export interface HubSweepTarget {
  hubUrl: string;
  enginePath: string;
  dataDir: string;
}

/**
 * How far along a sweep is, for a progress line.
 *
 * `Phase` is each sweep's own set of stages: a map picture sweep asks and
 * encodes as well as reads and sends, a game facts sweep only scans, reads
 * and sends. `game` is set only by a sweep that walks one subject at a time
 * and names it as it goes, which is the two that sweep a whole game rather
 * than a whole library in one pass.
 */
export interface HubSweepProgress<Phase extends string> {
  phase: Phase;
  done: number;
  total: number;
  game?: string;
}

/**
 * What every sweep report holds regardless of subject: which of the found
 * subjects were never attempted, and anything the worker reported while
 * reading. `Skipped` is each sweep's own reason shape, since a game is
 * skipped for a different set of reasons than a map is.
 */
export interface HubSweepReport<Skipped> {
  skipped: Skipped[];
  errors: string[];
}

/**
 * Read and write when a sweep last finished, kept in `localStorage` under
 * `key`.
 *
 * Not read off the rate limit ledger, which was the obvious place and is the
 * wrong one: that ledger prunes itself to a rolling hour, so anything it
 * could answer about is by definition less than an hour old, and the
 * question somebody is asking is whether this has ever run at all.
 *
 * Guarded against a webview with storage turned off. A read that fails comes
 * back as never run, which is a line that does not appear rather than a run
 * that cannot start. A write that fails is swallowed: the sweep still ran,
 * it just cannot say so next launch.
 */
export function createSweptAtTracker(key: string): {
  lastSweptAt(): number | null;
  rememberSweptAt(now?: number): void;
} {
  return {
    lastSweptAt(): number | null {
      try {
        const raw = localStorage.getItem(key);
        const at = raw ? Number(raw) : Number.NaN;
        return Number.isFinite(at) && at > 0 ? at : null;
      } catch {
        return null;
      }
    },
    rememberSweptAt(now = Date.now()): void {
      try {
        localStorage.setItem(key, String(now));
      } catch {
        // No storage. The sweep still ran, it just cannot say so next launch.
      }
    },
  };
}
