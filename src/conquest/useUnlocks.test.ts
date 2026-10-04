import { beforeEach, describe, expect, it, vi } from "vitest";

// Same stub as `useResultRecords.test.ts`: `useSetting` writes through to the
// installed storage while the value a caller holds stays the one read when the
// hook ran.
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
import { CONQUEST_UNLOCKS_KEY, type ConquestUnlocks } from "./unlocks";
import { useConquestUnlocks } from "./useUnlocks";

let storage = memorySettingsStorage();
installSettingsStorage(storage);

const win = (runId: string, level = 0) => ({
  runId,
  game: "tg",
  won: true,
  level,
});

const stored = () =>
  readStoredSetting<ConquestUnlocks>(CONQUEST_UNLOCKS_KEY, {});

describe("useConquestUnlocks", () => {
  beforeEach(() => {
    storage = memorySettingsStorage();
    installSettingsStorage(storage);
  });

  it("counts a finished conquest once however many times it is offered", () => {
    const { award } = useConquestUnlocks();
    award(win("g:1"));
    award(win("g:1"));
    expect(stored().tg).toMatchObject({ finished: 1, won: 1, threatLevel: 1 });
  });

  it("keeps two conquests finished in one pass", () => {
    const { award } = useConquestUnlocks();
    award(win("g:1"));
    award(win("g:2", 1));
    expect(stored().tg).toMatchObject({ finished: 2, threatLevel: 2 });
  });
});
