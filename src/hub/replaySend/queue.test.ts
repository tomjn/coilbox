import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
  writeStoredSetting,
} from "@/lib/storedSetting";

let offered = true;
vi.mock("@/profile/profile", () => ({
  isHubAssetUploadOffered: () => offered,
}));

import {
  AUTO_SEND_REPLAYS_KEY,
  queueFinishedReplay,
  readReplaySendQueue,
} from "./queue";

const TARGET = { dataDir: "/d", enginePath: "/e/spring" };
const REPLAY = { path: "/d/demos/match.sdfz" };

beforeEach(() => {
  offered = true;
  installSettingsStorage(memorySettingsStorage());
});
afterEach(() => installSettingsStorage(null));

describe("queueing a finished replay to send", () => {
  it("queues nothing while the setting has never been turned on", () => {
    queueFinishedReplay(TARGET, REPLAY, 1000);
    expect(readReplaySendQueue()).toEqual([]);
  });

  it("queues nothing while the setting is off", () => {
    writeStoredSetting(AUTO_SEND_REPLAYS_KEY, false);
    queueFinishedReplay(TARGET, REPLAY, 1000);
    expect(readReplaySendQueue()).toEqual([]);
  });

  it("queues nothing when the distribution has switched uploads off", () => {
    writeStoredSetting(AUTO_SEND_REPLAYS_KEY, true);
    offered = false;
    queueFinishedReplay(TARGET, REPLAY, 1000);
    expect(readReplaySendQueue()).toEqual([]);
  });

  it("queues a replay once, with where to read it from", () => {
    writeStoredSetting(AUTO_SEND_REPLAYS_KEY, true);
    queueFinishedReplay(TARGET, REPLAY, 1000);
    queueFinishedReplay(TARGET, REPLAY, 2000);
    expect(readReplaySendQueue()).toEqual([
      {
        path: REPLAY.path,
        dataDir: "/d",
        enginePath: "/e/spring",
        queuedAt: 1000,
        attempts: 0,
        notBefore: 1000,
      },
    ]);
  });
});
