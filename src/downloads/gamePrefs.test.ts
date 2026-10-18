import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import {
  pinnedSource,
  readGamePrefs,
  setGamePin,
  setGameUpdates,
  updatesOffKeys,
} from "./gamePrefs";

beforeEach(() => installSettingsStorage(memorySettingsStorage()));
afterEach(() => installSettingsStorage(null));

describe("game page choices (issue #4580)", () => {
  it("stores a pin per game and clears it", () => {
    setGamePin("game:ba", { source: "rapid", mirror: null });
    setGamePin("game:sf", { source: "github", mirror: null });
    expect(pinnedSource(readGamePrefs(), "game:ba")).toEqual({
      source: "rapid",
      mirror: null,
    });
    setGamePin("game:ba", null);
    expect(pinnedSource(readGamePrefs(), "game:ba")).toBeUndefined();
    expect(readGamePrefs()).toEqual({
      "game:sf": { pin: { source: "github", mirror: null } },
    });
  });

  it("finds the pin under any of a game's keys", () => {
    setGamePin("game:balanced annihilation", {
      source: "springfiles",
      mirror: null,
    });
    expect(
      pinnedSource(readGamePrefs(), "game:ba", "game:balanced annihilation"),
    ).toEqual({ source: "springfiles", mirror: null });
  });

  it("turns a game's updates off and on without touching its pin", () => {
    setGamePin("game:ba", { source: "rapid", mirror: null });
    setGameUpdates("game:ba", false);
    expect(updatesOffKeys(readGamePrefs())).toEqual(new Set(["game:ba"]));
    setGameUpdates("game:ba", true);
    expect(updatesOffKeys(readGamePrefs())).toEqual(new Set());
    expect(pinnedSource(readGamePrefs(), "game:ba")?.source).toBe("rapid");
  });
});
