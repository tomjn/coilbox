import { describe, expect, it } from "vitest";
import {
  addSample,
  formatDuration,
  IDLE_RATE,
  type RateSample,
  rateFrom,
} from "./downloadRate";

/** Build a run of samples at a steady rate, one per `stepMs`. */
function steady(opts: {
  count: number;
  stepMs: number;
  bytesPerStep: number;
  totalBytes?: number | null;
  startAt?: number;
}): RateSample[] {
  const start = opts.startAt ?? 1_000_000;
  let samples: RateSample[] = [];
  for (let i = 0; i < opts.count; i++) {
    const bytes = i * opts.bytesPerStep;
    samples = addSample(samples, {
      at: start + i * opts.stepMs,
      bytes,
      fraction:
        opts.totalBytes == null || opts.totalBytes === 0
          ? null
          : bytes / opts.totalBytes,
    });
  }
  return samples;
}

/** The timestamp of the newest sample, for a `now` that is not stale. */
function latest(samples: RateSample[]): number {
  return samples[samples.length - 1].at;
}

describe("addSample", () => {
  it("keeps samples that straddle the window and drops older ones", () => {
    // Ten seconds of samples, one per second, against a five second window.
    const samples = steady({ count: 11, stepMs: 1000, bytesPerStep: 1000 });
    const span = latest(samples) - samples[0].at;
    expect(span).toBeGreaterThanOrEqual(5000);
    // One sample beyond the window, so the average always spans it fully.
    expect(span).toBeLessThan(7000);
  });

  it("drops a sample that arrives too soon after the last one", () => {
    const first = addSample([], { at: 1000, bytes: 0, fraction: 0 });
    const second = addSample(first, { at: 1050, bytes: 500, fraction: 0.1 });
    expect(second).toBe(first);
  });

  it("ignores a sample whose byte count goes backwards", () => {
    // The sidecar's terminating event reports zero bytes. Believing it would
    // read as the download losing everything it had.
    const samples = steady({ count: 4, stepMs: 1000, bytesPerStep: 1000 });
    const after = addSample(samples, {
      at: latest(samples) + 1000,
      bytes: 0,
      fraction: null,
    });
    expect(after).toBe(samples);
  });

  it("ignores a sample whose percentage goes backwards", () => {
    let samples = addSample([], { at: 1000, bytes: 0, fraction: 0.5 });
    samples = addSample(samples, { at: 2000, bytes: 0, fraction: 0.6 });
    const after = addSample(samples, { at: 3000, bytes: 0, fraction: 0.2 });
    expect(after).toBe(samples);
  });

  it("always keeps two samples, however slowly they arrive", () => {
    let samples = addSample([], { at: 0, bytes: 0, fraction: null });
    samples = addSample(samples, { at: 60_000, bytes: 1000, fraction: null });
    samples = addSample(samples, { at: 120_000, bytes: 2000, fraction: null });
    expect(samples).toHaveLength(2);
    expect(samples[0].at).toBe(60_000);
  });
});

describe("rateFrom", () => {
  it("says nothing with no samples", () => {
    expect(rateFrom([], null, 0)).toEqual(IDLE_RATE);
  });

  it("holds off until the samples have settled", () => {
    // Two samples 200ms apart is not enough to quote a rate from.
    let samples = addSample([], { at: 1000, bytes: 0, fraction: 0 });
    samples = addSample(samples, { at: 1200, bytes: 900_000, fraction: 0.5 });
    const rate = rateFrom(samples, 1_800_000, 1200);
    expect(rate.bytesPerSec).toBeNull();
    expect(rate.secondsLeft).toBeNull();
    expect(rate.stalled).toBe(false);
  });

  it("averages a steady transfer to its actual rate", () => {
    const samples = steady({ count: 6, stepMs: 1000, bytesPerStep: 1_000_000 });
    const rate = rateFrom(samples, null, latest(samples));
    expect(rate.bytesPerSec).toBeCloseTo(1_000_000, -1);
  });

  it("rides out a single stalled chunk instead of reporting zero", () => {
    // One second where nothing arrives, in the middle of a 1 MB/s transfer.
    let samples: RateSample[] = [];
    const bytes = [0, 1e6, 2e6, 3e6, 3e6, 4e6, 5e6];
    bytes.forEach((b, i) => {
      samples = addSample(samples, {
        at: 1_000_000 + i * 1000,
        bytes: b,
        fraction: null,
      });
    });
    const rate = rateFrom(samples, null, latest(samples));
    // The window average dips, but nowhere near the zero the last two samples
    // on their own would give.
    expect(rate.bytesPerSec).toBeGreaterThan(700_000);
    expect(rate.bytesPerSec).toBeLessThan(1_000_000);
  });

  it("estimates time left from bytes when the total is known", () => {
    // 1 MB/s, 10 MB total, 5 MB done.
    let samples: RateSample[] = [];
    for (let i = 0; i <= 5; i++) {
      samples = addSample(samples, {
        at: 1_000_000 + i * 1000,
        bytes: i * 1_000_000,
        fraction: i / 10,
      });
    }
    const rate = rateFrom(samples, 10_000_000, latest(samples));
    expect(rate.secondsLeft).toBe(5);
  });

  it("estimates time left from the percentage when there are no bytes", () => {
    // The pr-downloader sidecar's usual shape: a percentage and nothing else.
    // 10% per second from 40% means six seconds to go.
    let samples: RateSample[] = [];
    for (let i = 0; i <= 4; i++) {
      samples = addSample(samples, {
        at: 1_000_000 + i * 1000,
        bytes: 0,
        fraction: i / 10,
      });
    }
    const rate = rateFrom(samples, null, latest(samples));
    expect(rate.bytesPerSec).toBeNull();
    expect(rate.secondsLeft).toBe(6);
  });

  it("gives no time left when the total is unknown and so is the percentage", () => {
    const samples = steady({ count: 6, stepMs: 1000, bytesPerStep: 1_000_000 });
    const rate = rateFrom(samples, null, latest(samples));
    expect(rate.bytesPerSec).not.toBeNull();
    expect(rate.secondsLeft).toBeNull();
  });

  it("withholds an estimate longer than a day", () => {
    // 100 bytes/s against a 100 GB total is a number nobody should read.
    let samples: RateSample[] = [];
    for (let i = 0; i <= 5; i++) {
      samples = addSample(samples, {
        at: 1_000_000 + i * 1000,
        bytes: i * 100,
        fraction: null,
      });
    }
    const rate = rateFrom(samples, 100_000_000_000, latest(samples));
    expect(rate.bytesPerSec).toBeCloseTo(100, 0);
    expect(rate.secondsLeft).toBeNull();
  });

  it("calls a download stalled when the samples stop arriving", () => {
    const samples = steady({ count: 6, stepMs: 1000, bytesPerStep: 1_000_000 });
    const rate = rateFrom(samples, 10_000_000, latest(samples) + 6000);
    expect(rate.stalled).toBe(true);
    expect(rate.bytesPerSec).toBeNull();
    expect(rate.secondsLeft).toBeNull();
  });

  it("calls a download stalled when samples arrive saying nothing moved", () => {
    let samples: RateSample[] = [];
    for (let i = 0; i <= 6; i++) {
      samples = addSample(samples, {
        at: 1_000_000 + i * 1000,
        bytes: 5_000_000,
        fraction: 0.5,
      });
    }
    const rate = rateFrom(samples, 10_000_000, latest(samples));
    expect(rate.stalled).toBe(true);
  });

  it("does not call a brief pause a stall", () => {
    const samples = steady({ count: 6, stepMs: 1000, bytesPerStep: 1_000_000 });
    const rate = rateFrom(samples, 10_000_000, latest(samples) + 2000);
    expect(rate.stalled).toBe(false);
    expect(rate.bytesPerSec).not.toBeNull();
  });

  it("gives no time left for a download already at its total", () => {
    let samples: RateSample[] = [];
    for (let i = 0; i <= 5; i++) {
      samples = addSample(samples, {
        at: 1_000_000 + i * 1000,
        bytes: i * 2_000_000,
        fraction: i / 5,
      });
    }
    const rate = rateFrom(samples, 10_000_000, latest(samples));
    expect(rate.secondsLeft).toBeNull();
  });
});

describe("formatDuration", () => {
  it("counts whole seconds under a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(1.4)).toBe("1s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("rounds to ten seconds above a minute", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(84)).toBe("1m 20s");
    expect(formatDuration(200)).toBe("3m 20s");
  });

  it("carries a rounded-up minute rather than saying 60 seconds", () => {
    expect(formatDuration(238)).toBe("4m");
  });

  it("drops to minutes above an hour", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3900)).toBe("1h 5m");
    expect(formatDuration(7500)).toBe("2h 5m");
  });

  it("carries a rounded-up hour rather than saying 60 minutes", () => {
    expect(formatDuration(7195)).toBe("2h");
  });

  it("never shows a negative duration", () => {
    expect(formatDuration(-5)).toBe("0s");
  });
});
