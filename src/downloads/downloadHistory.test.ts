import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import {
  type DownloadAttempt,
  downloadKey,
  hostOf,
  readDownloadHistory,
  recordDownload,
  recordsFor,
  subscribeDownloadHistory,
} from "./downloadHistory";

const ok: DownloadAttempt = {
  source: "github",
  outcome: "ok",
  reference: "v0.1.86",
  filename: "SplinterFaction_0.1.86.sdz",
  md5: null,
  mirror: "github.com",
  failure: null,
  durationMs: 4200,
};

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
});

describe("downloadKey", () => {
  it("keys a game on its name without the version, lower case", () => {
    expect(downloadKey("game", "Splinter Faction 0.1.86")).toBe(
      "game:splinter faction",
    );
  });

  it("keys a map on its spring name", () => {
    expect(downloadKey("map", "Supreme Isthmus v2")).toBe(
      "map:supreme isthmus v2",
    );
  });
});

describe("hostOf", () => {
  it("names the host of a url and gives null for anything else", () => {
    expect(hostOf("https://mirror1.example.test/files/a.sd7")).toBe(
      "mirror1.example.test",
    );
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("the download history", () => {
  it("reads back the source and date of a completed download", () => {
    const key = downloadKey("game", "Splinter Faction 0.1.86");
    recordDownload(key, ok, new Date("2026-10-18T12:00:00.000Z"));

    const [record] = recordsFor(readDownloadHistory(), key);
    expect(record).toMatchObject({
      source: "github",
      outcome: "ok",
      reference: "v0.1.86",
      filename: "SplinterFaction_0.1.86.sdz",
      mirror: "github.com",
      at: "2026-10-18T12:00:00.000Z",
      durationMs: 4200,
      failure: null,
    });
  });

  it("reads back the failure text of a failed attempt", () => {
    const key = downloadKey("map", "Supreme Isthmus v2");
    recordDownload(key, {
      ...ok,
      source: "springfiles",
      outcome: "failed",
      mirror: "mirror1.example.test",
      failure: "the mirror answered 404 for Supreme_Isthmus_v2.sd7",
    });

    const [record] = recordsFor(readDownloadHistory(), key);
    expect(record.outcome).toBe("failed");
    expect(record.failure).toBe(
      "the mirror answered 404 for Supreme_Isthmus_v2.sd7",
    );
  });

  it("keeps a failed first mirror and a good second one side by side", () => {
    const key = downloadKey("map", "Supreme Isthmus v2");
    const base = { ...ok, source: "springfiles" as const };
    recordDownload(key, {
      ...base,
      outcome: "failed",
      mirror: "one.test",
      failure: "404",
    });
    recordDownload(key, { ...base, mirror: "two.test" });

    const mirrors = recordsFor(readDownloadHistory(), key).map(
      (r) => `${r.mirror}:${r.outcome}`,
    );
    expect(mirrors.sort()).toEqual(["one.test:failed", "two.test:ok"]);
  });

  it("replaces the last result for the same source and mirror", () => {
    const key = downloadKey("game", "Splinter Faction");
    recordDownload(key, { ...ok, outcome: "failed", failure: "timed out" });
    recordDownload(key, ok, new Date("2026-10-19T09:00:00.000Z"));

    const records = recordsFor(readDownloadHistory(), key);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      outcome: "ok",
      failure: null,
      at: "2026-10-19T09:00:00.000Z",
    });
  });

  it("lists the newest first and merges several keys", () => {
    recordDownload(
      "game:a",
      { ...ok, source: "rapid" },
      new Date("2026-10-01T00:00:00.000Z"),
    );
    recordDownload("game:b", ok, new Date("2026-10-02T00:00:00.000Z"));

    expect(
      recordsFor(readDownloadHistory(), "game:a", "game:b", "game:none").map(
        (r) => r.source,
      ),
    ).toEqual(["github", "rapid"]);
  });

  it("survives an app restart", () => {
    const key = downloadKey("game", "Splinter Faction");
    const before = memorySettingsStorage();
    installSettingsStorage(before);
    recordDownload(key, ok, new Date("2026-10-18T12:00:00.000Z"));
    const stored = before.get("downloads.history");
    expect(stored).not.toBeNull();

    // A new process starts with a new storage, loaded from what was saved.
    const after = memorySettingsStorage();
    after.set("downloads.history", stored as string);
    installSettingsStorage(after);

    expect(recordsFor(readDownloadHistory(), key)[0]?.at).toBe(
      "2026-10-18T12:00:00.000Z",
    );
  });

  it("starts empty when the stored value is damaged", () => {
    const storage = memorySettingsStorage();
    storage.set("downloads.history", "{not json");
    installSettingsStorage(storage);
    expect(readDownloadHistory()).toEqual({});
  });

  it("does nothing, and does not throw, with no storage installed", () => {
    installSettingsStorage(null);
    expect(() => recordDownload("game:a", ok)).not.toThrow();
    expect(readDownloadHistory()).toEqual({});
  });

  it("tells subscribers about a write", () => {
    const heard = vi.fn();
    const stop = subscribeDownloadHistory(heard);
    recordDownload("game:a", ok);
    stop();
    recordDownload("game:a", ok);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
