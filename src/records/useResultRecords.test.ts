import { beforeEach, describe, expect, it, vi } from "vitest";

// Same stub as `presets.test.ts`: `useSetting` writes through to the installed
// storage while the value a caller holds stays the one read when the hook ran.
vi.mock("@picoframe/frame", () => ({
  useSetting: (key: string, fallback: unknown) => [
    readStoredSetting(key, fallback),
    (next: unknown) => storage.set(key, JSON.stringify(next)),
  ],
}));

import {
  installSettingsStorage,
  memorySettingsStorage,
  readStoredSetting,
} from "../lib/storedSetting";
import type { GameResult, Ranking } from "./bestResult";
import { useResultRecords } from "./useResultRecords";

let storage = memorySettingsStorage();
installSettingsStorage(storage);

const win = (replayFilename: string, durationSec: number): GameResult => ({
  replayFilename,
  outcome: "victory",
  durationSec,
});

describe("useResultRecords", () => {
  beforeEach(() => {
    storage = memorySettingsStorage();
    installSettingsStorage(storage);
  });

  it("records a game once however many times it is offered", () => {
    const { record } = useResultRecords("test.records");
    expect(record("a", win("one.sdfz", 600)).kind).toBe("first-win");
    expect(record("a", win("one.sdfz", 600)).kind).toBe("duplicate");
    expect(readStoredSetting("test.records", {})).toMatchObject({
      a: { attempts: 1, wins: 1 },
    });
  });

  it("keeps two games recorded in one pass", () => {
    const { record } = useResultRecords("test.records");
    record("a", win("one.sdfz", 600));
    record("a", win("two.sdfz", 500));
    expect(readStoredSetting("test.records", {})).toMatchObject({
      a: {
        attempts: 2,
        best: { durationSec: 500, replayFilename: "two.sdfz" },
      },
    });
  });

  it("keeps identities apart and clears one without touching another", () => {
    const { record, clear } = useResultRecords("test.records");
    record("a", win("one.sdfz", 600));
    record("b", win("two.sdfz", 500));
    clear("a");
    const stored = readStoredSetting<Record<string, unknown>>(
      "test.records",
      {},
    );
    expect(Object.keys(stored)).toEqual(["b"]);
  });

  it("ranks by a ranking passed in", () => {
    const ranking: Ranking<{ id: string; n: number }, number, string> = {
      id: (r) => r.id,
      isWin: () => true,
      judge: (r, best) =>
        best === null || r.n > best
          ? { best: r.n, change: "up" }
          : { best, change: "same" },
    };
    const { record } = useResultRecords("test.ranked", ranking);
    expect(record("a", { id: "1", n: 5 })).toBe("up");
    expect(record("a", { id: "2", n: 3 })).toBe("same");
    expect(record("a", { id: "1", n: 9 })).toEqual({ kind: "duplicate" });
    expect(readStoredSetting("test.ranked", {})).toMatchObject({
      a: { attempts: 2, wins: 2, best: 5 },
    });
  });

  it("writes nothing under any other key", () => {
    const { record } = useResultRecords("test.records");
    record("a", win("one.sdfz", 600));
    expect(readStoredSetting("play.presets", null)).toBeNull();
  });
});
