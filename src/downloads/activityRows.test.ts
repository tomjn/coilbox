import { describe, expect, it } from "vitest";
import {
  activityRows,
  retryInput,
  retryLabel,
  sourceText,
} from "./activityRows";
import type { QueueItem } from "./DownloadQueueProvider";
import { DOWNLOADING, FAILED, HISTORY, QUEUED } from "./fixtures/activity";

describe("activityRows", () => {
  it("draws a download this session stopped from the queue, not again from history", () => {
    const rows = activityRows({
      items: [],
      settled: [FAILED],
      history: HISTORY,
    });
    expect(rows.map((r) => r.id)).toEqual([
      "dl-isthmus",
      "game:splinter faction",
    ]);
    expect(rows[0].next).toEqual(FAILED.next);
  });

  it("keeps an older version's history beside this session's run of the game", () => {
    const newer: QueueItem = {
      ...DOWNLOADING,
      kind: "game",
      args: { gameName: "Splinter Faction 0.1.87", writePath: "/data" },
      identity: "game:Splinter Faction 0.1.87",
      status: "canceled",
      settledAt: (DOWNLOADING.startedAt ?? 0) + 1000,
    };
    const rows = activityRows({
      items: [],
      settled: [newer],
      history: HISTORY,
    });
    expect(rows.map((r) => r.name)).toContain("Splinter Faction 0.1.86");
    expect(rows.map((r) => r.name)).toContain("Splinter Faction 0.1.87");
  });

  it("names a running download's source from the attempt it is on", () => {
    const [row] = activityRows({
      items: [DOWNLOADING],
      settled: [],
      history: {},
    });
    expect(row.source).toBe("GitHub · github.com");
  });

  it("offers no next source on a running or waiting row", () => {
    const rows = activityRows({
      items: [{ ...QUEUED, next: FAILED.next }],
      settled: [],
      history: {},
    });
    expect(rows[0].next).toBeNull();
  });

  it("reads a finished run's source from its own successful attempt", () => {
    const at = Date.parse("2026-10-18T22:00:00Z");
    const done = {
      ...QUEUED,
      status: "done",
      startedAt: at,
      settledAt: at + 5000,
    } as const;
    const record = {
      outcome: "ok",
      reference: null,
      filename: "Isis.sd7",
      md5: null,
      failure: null,
      durationMs: 5000,
    } as const;
    const [row] = activityRows({
      items: [],
      settled: [done],
      history: {
        "map:isis": {
          "hakora|hakora.xyz": {
            ...record,
            source: "hakora",
            mirror: "hakora.xyz",
            at: new Date(at + 4000).toISOString(),
          },
          // Older than this run, so not part of it.
          "evolutionrts|old.test": {
            ...record,
            source: "evolutionrts",
            mirror: "old.test",
            at: new Date(at - 1).toISOString(),
          },
        },
      },
    });
    expect(row.source).toBe("Hakora · hakora.xyz");
    expect(row.records).toHaveLength(1);
  });
});

describe("retry", () => {
  it("asks for a game again from the next source", () => {
    const next = { source: "rapid", mirror: null } as const;
    expect(retryInput(DOWNLOADING, next)).toEqual({
      kind: "game",
      label: DOWNLOADING.label,
      args: { gameName: "Zero-K v1.12.5", writePath: "/data", startAt: next },
      sizeBytes: undefined,
    });
  });

  it("has nothing to retry for a kind with one source", () => {
    const file = {
      ...QUEUED,
      kind: "file",
      args: { url: "https://x.test/a.sd7", destDir: "/d/maps", filename: "a" },
    } as const;
    expect(retryInput(file, { source: "url", mirror: null })).toBeNull();
  });

  it("labels the button by the source it would try", () => {
    expect(retryLabel({ source: "github", mirror: null }, "game")).toBe(
      "Try GitHub",
    );
    expect(
      retryLabel({ source: "springfiles", mirror: "m2.test" }, "map"),
    ).toBe("Try next mirror");
    expect(retryLabel({ source: "rapid", mirror: null }, "map")).toBe(
      "Try pr-downloader",
    );
    expect(sourceText({ source: "url", mirror: null })).toBe("Direct");
  });
});
