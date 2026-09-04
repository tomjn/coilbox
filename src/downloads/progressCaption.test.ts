import { describe, expect, it } from "vitest";
import type { DownloadProgress } from "./bindings";
import type { DownloadRate } from "./downloadRate";
import { IDLE_RATE } from "./downloadRate";
import { progressCaption } from "./pages/components/ProgressBar";

const MB = 1024 * 1024;

function sample(p: Partial<DownloadProgress> = {}): DownloadProgress {
  return {
    phase: "downloading",
    downloadedBytes: 0,
    totalBytes: null,
    percent: null,
    bytesPerSec: null,
    ...p,
  };
}

function rate(r: Partial<DownloadRate> = {}): DownloadRate {
  return { ...IDLE_RATE, ...r };
}

describe("progressCaption", () => {
  it("reads size, speed and time left when the source knows the total", () => {
    const caption = progressCaption(
      sample({ downloadedBytes: 12 * MB, totalBytes: 48 * MB, percent: 25 }),
      rate({ bytesPerSec: 3.5 * MB, secondsLeft: 10 }),
      4,
    );
    expect(caption).toBe("12 MB of 48 MB · 3.5 MB/s · 10s left");
  });

  it("leaves the percentage out when the byte total says the same thing", () => {
    const caption = progressCaption(
      sample({ downloadedBytes: 12 * MB, totalBytes: 48 * MB, percent: 25 }),
      rate({ bytesPerSec: 3.5 * MB, secondsLeft: 10 }),
      4,
    );
    expect(caption).not.toContain("25%");
  });

  it("shows the percentage on its own when there are no bytes to show", () => {
    // The pr-downloader sidecar's usual shape.
    const caption = progressCaption(
      sample({ percent: 42 }),
      rate({ secondsLeft: 20 }),
      8,
    );
    expect(caption).toBe("42% · 20s left");
  });

  it("falls back to elapsed time before the rate has settled", () => {
    const caption = progressCaption(sample({ percent: 3 }), IDLE_RATE, 4);
    expect(caption).toBe("3% · 4s elapsed");
  });

  it("says nothing at all in the first couple of seconds", () => {
    expect(progressCaption(sample(), IDLE_RATE, 1)).toBe("");
  });

  it("admits the size is unknown when the source reports nothing", () => {
    // A rapid game served by streamer.cgi: `0/0` once and then silence. No
    // size, no bytes, no percentage, and not stalled either.
    const caption = progressCaption(sample(), IDLE_RATE, 84);
    expect(caption).toBe("Size unknown · 1m 20s elapsed");
    expect(caption).not.toContain("stalled");
  });

  it("shows bytes and rate with no time left when the total is unknown", () => {
    // A chunked HTTP response with no Content-Length.
    const caption = progressCaption(
      sample({ downloadedBytes: 12 * MB }),
      rate({ bytesPerSec: 3.5 * MB }),
      30,
    );
    expect(caption).toBe("12 MB · 3.5 MB/s · 30s elapsed");
  });

  it("says a stalled download is stalled rather than quoting zero", () => {
    const caption = progressCaption(
      sample({ downloadedBytes: 12 * MB, totalBytes: 48 * MB, percent: 25 }),
      rate({ stalled: true }),
      130,
    );
    expect(caption).toBe("12 MB of 48 MB · stalled · 2m 10s elapsed");
  });

  it("names the extraction phase when there is nothing else to name", () => {
    // The pr-downloader path's shape: it knows unpacking has started and
    // nothing else, so the caption has to carry the phase on its own.
    const caption = progressCaption(
      sample({ phase: "extracting" }),
      IDLE_RATE,
      130,
    );
    expect(caption).toBe("Extracting… · 2m 10s elapsed");
    expect(caption).not.toContain("Size unknown");
  });

  it("names the extraction phase and gives it no speed or time left", () => {
    const caption = progressCaption(
      sample({ phase: "extracting", downloadedBytes: 48 * MB }),
      rate({ bytesPerSec: 3.5 * MB, secondsLeft: 10 }),
      12,
    );
    expect(caption).toBe("Extracting… · 12s elapsed");
  });
});
