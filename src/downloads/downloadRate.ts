/**
 * Speed and time-left estimates for a download, from the progress samples the
 * backend streams.
 *
 * Sources disagree about what they can report. A direct HTTP transfer knows its
 * byte count, and its total when the server sent a Content-Length. The
 * pr-downloader sidecar reports a percentage and usually nothing else.
 * Extraction reports neither. So the estimator works from whatever a sample
 * carries and answers null rather than guessing.
 *
 * The backend does send a `bytesPerSec` on HTTP transfers, but it is the
 * average since the transfer started, so it lags a connection that speeds up or
 * stalls and it is missing entirely on the sidecar paths. This computes its own
 * rate over a trailing window instead, which reacts and is available everywhere.
 *
 * Everything here is a pure function over a list of samples, so the awkward
 * parts (a rate that has not settled, a transfer that stopped moving, a total
 * nobody knows) are decided in one place and tested rather than eyeballed.
 */

/** One progress sample, as it arrived. */
export interface RateSample {
  /** Millisecond timestamp, from the same clock throughout a download. */
  at: number;
  /** Bytes transferred so far, as reported. */
  bytes: number;
  /** Fraction complete, 0 to 1, or null when the source reports no percentage. */
  fraction: number | null;
}

/** What a run of samples says about speed and time left. */
export interface DownloadRate {
  /** Smoothed bytes per second, or null when the byte count is not moving. */
  bytesPerSec: number | null;
  /** Whole seconds left, or null when no estimate is worth reading yet. */
  secondsLeft: number | null;
  /** Nothing has moved for a while: the numbers are real but stuck. */
  stalled: boolean;
}

/**
 * Samples inside this trailing window are averaged. Long enough that one slow
 * chunk does not halve the quoted rate, short enough that the number still
 * reacts when the connection genuinely changes speed.
 */
const WINDOW_MS = 5000;

/** Below this much elapsed time, or this many samples, no rate is quoted. */
const MIN_SPAN_MS = 1500;
const MIN_SAMPLES = 3;

/**
 * Samples closer together than this are dropped. The sidecar path emits one per
 * terminal redraw with no throttle of its own, which would otherwise put
 * hundreds of entries in a five second window for no extra accuracy.
 */
const MIN_GAP_MS = 100;

/** No forward movement for this long counts as stalled. */
const STALL_MS = 5000;

/** An estimate longer than this is noise, so it is not shown at all. */
const MAX_SECONDS_LEFT = 24 * 60 * 60;

/** No samples yet, so nothing to say. */
export const IDLE_RATE: DownloadRate = {
  bytesPerSec: null,
  secondsLeft: null,
  stalled: false,
};

/**
 * Append a sample and drop the ones that have aged out, keeping the oldest
 * sample that still straddles the window so the average always spans it. Two
 * samples are always kept, so a source that reports once every ten seconds
 * still yields a rate rather than nothing.
 *
 * A sample that arrived too soon after the last one is dropped, since the
 * sidecar path emits one per terminal redraw with no throttle of its own.
 *
 * A sample that goes backwards starts the window again from itself. That is not
 * a download losing what it had, it is the source changing what it is counting:
 * pr-downloader fetches a one byte file, reports it at 100%, and then starts the
 * real archive at 0%. Discarding those samples instead would leave the window
 * stuck on the one byte file and the whole download reading as stalled.
 */
export function addSample(
  samples: RateSample[],
  sample: RateSample,
): RateSample[] {
  const last = samples[samples.length - 1];
  if (last) {
    if (sample.at - last.at < MIN_GAP_MS) return samples;
    const backwards =
      sample.bytes < last.bytes ||
      (sample.fraction != null &&
        last.fraction != null &&
        sample.fraction < last.fraction);
    if (backwards) return [sample];
  }
  const next = [...samples, sample];
  const cutoff = sample.at - WINDOW_MS;
  while (next.length > 2 && next[1].at <= cutoff) next.shift();
  return next;
}

/**
 * Speed and time left from a window of samples. `totalBytes` is the size the
 * source reported, or null when it did not report one. `now` is the current
 * time on the same clock as the samples, which is what makes a download that
 * stopped sending samples show as stalled rather than frozen at its last rate.
 */
export function rateFrom(
  samples: RateSample[],
  totalBytes: number | null,
  now: number,
): DownloadRate {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return IDLE_RATE;

  const spanMs = last.at - first.at;
  const byteDelta = last.bytes - first.bytes;
  const fractionDelta =
    first.fraction != null && last.fraction != null
      ? last.fraction - first.fraction
      : 0;

  // Two ways to stop. The samples stop arriving, or they keep arriving and say
  // the same thing. Both look identical to somebody watching the bar.
  const silentFor = now - last.at;
  const stuckFor = byteDelta === 0 && fractionDelta === 0 ? spanMs : 0;
  const stalled = Math.max(silentFor, stuckFor) >= STALL_MS;

  const settled = samples.length >= MIN_SAMPLES && spanMs >= MIN_SPAN_MS;
  if (!settled || stalled) {
    return { bytesPerSec: null, secondsLeft: null, stalled };
  }

  const bytesPerSec = byteDelta > 0 ? (byteDelta * 1000) / spanMs : null;
  return {
    bytesPerSec,
    secondsLeft: secondsLeftFrom({
      bytesPerSec,
      totalBytes,
      doneBytes: last.bytes,
      fractionPerSec:
        fractionDelta > 0 ? (fractionDelta * 1000) / spanMs : null,
      fraction: last.fraction,
    }),
    stalled: false,
  };
}

/**
 * Prefer bytes, because a byte total is a real size the source measured. Fall
 * back to how fast the percentage is climbing, which is all the pr-downloader
 * sidecar gives us but still answers "how much longer".
 */
function secondsLeftFrom(x: {
  bytesPerSec: number | null;
  totalBytes: number | null;
  doneBytes: number;
  fractionPerSec: number | null;
  fraction: number | null;
}): number | null {
  let seconds: number | null = null;
  if (x.bytesPerSec && x.totalBytes != null && x.totalBytes > x.doneBytes) {
    seconds = (x.totalBytes - x.doneBytes) / x.bytesPerSec;
  } else if (x.fractionPerSec && x.fraction != null && x.fraction < 1) {
    seconds = (1 - x.fraction) / x.fractionPerSec;
  }
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds > MAX_SECONDS_LEFT) return null;
  return Math.max(0, Math.round(seconds));
}

/**
 * A short duration, e.g. `45s`, `3m 20s`, `2h 5m`. Anything over a minute is
 * rounded to ten seconds, because a time left that ticks between `3m 24s` and
 * `3m 19s` invites you to read a precision that is not there.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const mins = Math.floor(total / 60);
    const rest = Math.round((total - mins * 60) / 10) * 10;
    // Rounding 3m 57s up lands on 60s, which would read as "3m 60s".
    if (rest >= 60) return `${mins + 1}m`;
    return rest === 0 ? `${mins}m` : `${mins}m ${rest}s`;
  }
  const hours = Math.floor(total / 3600);
  const mins = Math.round((total - hours * 3600) / 60);
  if (mins >= 60) return `${hours + 1}h`;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}
