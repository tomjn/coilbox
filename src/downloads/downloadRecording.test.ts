import { describe, expect, it } from "vitest";
import type { QueueItem } from "./DownloadQueueProvider";
import type { DownloadAttempt } from "./downloadHistory";
import { attemptsToRecord } from "./downloadRecording";

const meta = {
  id: "1",
  identity: "x",
  status: "active",
  progress: null,
  rate: {},
  startedAt: 1000,
  error: null,
};
const item = (fields: object) =>
  ({ ...meta, ...fields }) as unknown as QueueItem;

const reported: DownloadAttempt = {
  source: "hakora",
  outcome: "ok",
  reference: "https://hakora.test/a.sd7",
  filename: "a.sd7",
  md5: null,
  mirror: "hakora.test",
  failure: null,
  durationMs: 10,
};

describe("attemptsToRecord", () => {
  it("keys a map downloaded from any source on its name and keeps what was reported", () => {
    const out = attemptsToRecord(
      item({ kind: "mapAnySource", label: "m", args: { mapName: "Isis" } }),
      [reported],
      null,
      5000,
    );
    expect(out).toEqual([{ key: "map:isis", attempt: reported }]);
  });

  it("writes one record for a single-source map download", () => {
    const out = attemptsToRecord(
      item({
        kind: "map",
        label: "m",
        args: { springName: "Isis", searchUrl: "https://sf.test/find" },
      }),
      [],
      null,
      5000,
    );
    expect(out).toEqual([
      {
        key: "map:isis",
        attempt: {
          source: "springfiles",
          outcome: "ok",
          reference: "https://sf.test/find",
          filename: null,
          md5: null,
          mirror: "sf.test",
          failure: null,
          durationMs: 4000,
        },
      },
    ]);
  });

  it("writes the failure text for a rapid tag that failed", () => {
    const [only] = attemptsToRecord(
      item({
        kind: "rapid",
        label: "Splinter Faction",
        args: { tag: "sf:test" },
      }),
      [],
      "no such tag",
      5000,
    );
    expect(only.key).toBe("game:splinter faction");
    expect(only.attempt).toMatchObject({
      source: "rapid",
      outcome: "failed",
      reference: "sf:test",
      failure: "no such tag",
    });
  });

  it("keys a file in the games folder like the library keys an archive", () => {
    const [only] = attemptsToRecord(
      item({
        kind: "file",
        label: "f",
        args: {
          url: "https://x.test/SplinterFaction_0.1.86.sdz",
          destDir: "/root/games",
          filename: "SplinterFaction_0.1.86.sdz",
        },
      }),
      [],
      null,
      5000,
    );
    expect(only.key).toBe("game:splinterfaction");
    expect(only.attempt).toMatchObject({ source: "url", mirror: "x.test" });
  });

  it("records nothing for an engine, or a file outside the library folders", () => {
    expect(
      attemptsToRecord(
        item({
          kind: "engineSpring",
          label: "e",
          args: { version: "105.0" },
        }),
        [],
        null,
        5000,
      ),
    ).toEqual([]);
    expect(
      attemptsToRecord(
        item({
          kind: "file",
          label: "f",
          args: {
            url: "https://x.test/a",
            destDir: "/root/other",
            filename: "a",
          },
        }),
        [],
        null,
        5000,
      ),
    ).toEqual([]);
  });

  it("records nothing for a game that failed before any source was tried", () => {
    expect(
      attemptsToRecord(
        item({ kind: "game", label: "g", args: { gameName: "G 1.0" } }),
        [],
        "No source could provide",
        5000,
      ),
    ).toEqual([]);
  });
});
