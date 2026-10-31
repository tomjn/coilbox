import { beforeEach, describe, expect, it, vi } from "vitest";

// As in `presets.test.ts`: the frame's `AppFrame` subpath does not resolve under
// vitest's node resolver, and the stub writes through to the installed storage.
vi.mock("@picoframe/frame", () => ({
  useSetting: (key: string, fallback: unknown) => [
    readStoredSetting(key, fallback),
    (next: unknown) => storage.set(key, JSON.stringify(next)),
  ],
}));

const fetchPack = vi.hoisted(() =>
  vi.fn<(args: { url: string }) => Promise<{ text: string }>>(),
);
vi.mock("../downloads/bindings", () => ({ dlFetchPresetPack: fetchPack }));

import { encodeContainerCode } from "../container/container";
import {
  installSettingsStorage,
  memorySettingsStorage,
  readStoredSetting,
} from "../lib/storedSetting";
import {
  FOLLOWED_PACKS_KEY,
  type FollowedPack,
  mergePresets,
  presetForBattle,
  readPack,
  useFollowedPacks,
} from "./followedPacks";
import { PRESETS_KEY } from "./presets";

let storage = memorySettingsStorage();

const URL_A = "https://raw.githubusercontent.com/o/r/main/pack.json";

const you = {
  id: "p0",
  kind: "you",
  name: "You",
  side: "arm",
  color: [0.5, 0.5, 0.5],
  allyTeam: 0,
  spectator: false,
};

const rawPreset = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  participants: [you],
  gameName: "SplinterFaction 0.1.75",
  mapName: "All That Glitters v2.2.3",
  startPosType: 0,
  modOptionValues: { maxunits: "8000", tweakdefs: "bHVh" },
  ...over,
});

const manifest = (presets: unknown[], over: Record<string, unknown> = {}) => ({
  title: "Community pack",
  games: [{ name: "SplinterFaction 0.1.75" }],
  presets,
  ...over,
});

const answering = (value: unknown) =>
  fetchPack.mockResolvedValue({ text: JSON.stringify(value) });

const stored = () => readStoredSetting<FollowedPack[]>(FOLLOWED_PACKS_KEY, []);

const parsed = (presets: ReturnType<typeof rawPreset>[]) => {
  const reading = readPack(JSON.stringify(manifest(presets)));
  if (!reading.ok) throw new Error(reading.message);
  return reading.presets;
};

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
  fetchPack.mockReset();
});

describe("readPack", () => {
  it("reads a bare manifest", () => {
    const reading = readPack(JSON.stringify(manifest([rawPreset("A")])));
    expect(reading).toMatchObject({ ok: true, title: "Community pack" });
  });

  it("reads a pack exported from coilbox", () => {
    const code = encodeContainerCode(
      "setup-pack",
      1,
      manifest([rawPreset("A")]),
    );
    expect(readPack(code)).toMatchObject({ ok: true });
  });

  it.each([
    ["text that is not JSON", "<html>not found</html>"],
    ["a list", "[]"],
    [
      "a manifest with no game or map",
      JSON.stringify({ presets: [rawPreset("A")] }),
    ],
    [
      "a preset with no game",
      JSON.stringify(manifest([rawPreset("A", { gameName: 7 })])),
    ],
    [
      "a preset with a number for an option",
      JSON.stringify(
        manifest([rawPreset("A", { modOptionValues: { tweakdefs: 7 } })]),
      ),
    ],
    [
      "a participant that is not one",
      JSON.stringify(manifest([rawPreset("A", { participants: [1] })])),
    ],
    [
      "a participant of an unknown kind",
      JSON.stringify(
        manifest([
          rawPreset("A", { participants: [{ ...you, kind: "host" }] }),
        ]),
      ),
    ],
    [
      "one bad preset among good ones",
      JSON.stringify(
        manifest([rawPreset("A"), rawPreset("B", { participants: [1] })]),
      ),
    ],
  ])("refuses %s", (_what, text) => {
    expect(readPack(text)).toEqual({
      ok: false,
      message: "That address did not return a setup pack.",
    });
  });

  it("refuses a pack with no presets, and says that is why", () => {
    for (const body of [manifest([]), { games: [{ name: "G" }] }])
      expect(readPack(JSON.stringify(body))).toEqual({
        ok: false,
        message: "That setup pack has no presets to follow.",
      });
  });
});

describe("mergePresets", () => {
  it("marks nothing on a first follow, with nothing opened yet", () => {
    const [entry] = mergePresets("pack", parsed([rawPreset("A")]), null, "now");
    expect(entry.updated).toBe(false);
    expect(entry.seenKey).toBeNull();
    expect(entry.preset.id).toBe("pack/A");
  });

  it("leaves an unchanged preset exactly as it was", () => {
    const before = mergePresets("pack", parsed([rawPreset("A")]), null, "t0");
    const after = mergePresets("pack", parsed([rawPreset("A")]), before, "t1");
    expect(after[0]).toBe(before[0]);
  });

  it("marks a changed preset and keeps its identity and what was opened", () => {
    const [first] = mergePresets("pack", parsed([rawPreset("A")]), null, "t0");
    const opened = { ...first, seenKey: first.contentKey };
    const [changed] = mergePresets(
      "pack",
      parsed([rawPreset("A", { mapName: "Elsewhere" })]),
      [opened],
      "t1",
    );
    expect(changed.updated).toBe(true);
    expect(changed.preset.id).toBe(first.preset.id);
    expect(changed.preset.createdAt).toBe("t0");
    expect(changed.preset.mapName).toBe("Elsewhere");
    expect(changed.seenKey).toBe(first.contentKey);
  });

  it("marks a preset a refresh added and drops one it removed", () => {
    const before = mergePresets("pack", parsed([rawPreset("A")]), null, "t0");
    const after = mergePresets("pack", parsed([rawPreset("B")]), before, "t1");
    expect(after.map((e) => [e.preset.name, e.updated])).toEqual([["B", true]]);
  });

  it("tells two presets of one name apart, in the same order every time", () => {
    const twins = parsed([
      rawPreset("A"),
      rawPreset("A", { mapName: "Elsewhere" }),
    ]);
    const before = mergePresets("pack", twins, null, "t0");
    expect(before.map((e) => e.preset.name)).toEqual(["A", "A (2)"]);
    const after = mergePresets("pack", twins, before, "t1");
    expect(after.every((e, i) => e === before[i])).toBe(true);
  });
});

describe("presetForBattle", () => {
  const entryOf = (seenKey: "own" | "other" | null) => {
    const [entry] = mergePresets("pack", parsed([rawPreset("A")]), null, "t0");
    return {
      ...entry,
      seenKey: seenKey === "own" ? entry.contentKey : seenKey && "older",
    };
  };

  it("holds back tweak slots on a preset never opened, first follow included", () => {
    const options = presetForBattle(entryOf(null)).modOptionValues;
    expect(options).toEqual({ maxunits: "8000" });
  });

  it("holds back tweak slots on a version newer than the one opened", () => {
    const options = presetForBattle(entryOf("other")).modOptionValues;
    expect(options).toEqual({ maxunits: "8000" });
  });

  it("gives the whole preset once this version was opened", () => {
    const options = presetForBattle(entryOf("own")).modOptionValues;
    expect(options.tweakdefs).toBe("bHVh");
  });
});

describe("useFollowedPacks", () => {
  const follow = async () => {
    answering(manifest([rawPreset("A")]));
    expect(await useFollowedPacks().follow(`  ${URL_A} `)).toBeNull();
  };

  it("follows a pack, its presets stored apart from the player's own", async () => {
    await follow();
    expect(fetchPack).toHaveBeenCalledWith({ url: URL_A });
    const [pack] = stored();
    expect(pack).toMatchObject({ url: URL_A, title: "Community pack" });
    expect(pack.presets[0].preset.name).toBe("A");
    expect(storage.get(PRESETS_KEY)).toBeNull();
  });

  it("names a pack with no title after its host", async () => {
    answering(manifest([rawPreset("A")], { title: undefined }));
    await useFollowedPacks().follow(URL_A);
    expect(stored()[0].title).toBe("raw.githubusercontent.com");
  });

  it("reports a refused host in the words the fetch used, keeping nothing", async () => {
    fetchPack.mockRejectedValue(
      new Error("Coilbox does not follow packs from example.test."),
    );
    expect(await useFollowedPacks().follow("https://example.test/p")).toBe(
      "Coilbox does not follow packs from example.test.",
    );
    expect(stored()).toEqual([]);
  });

  it("refuses a malformed manifest, keeping nothing", async () => {
    fetchPack.mockResolvedValue({ text: "<html></html>" });
    expect(await useFollowedPacks().follow(URL_A)).toBe(
      "That address did not return a setup pack.",
    );
    expect(stored()).toEqual([]);
  });

  it("will not follow one address twice", async () => {
    await follow();
    fetchPack.mockClear();
    expect(await useFollowedPacks().follow(URL_A)).toBe(
      "You already follow that pack.",
    );
    expect(fetchPack).not.toHaveBeenCalled();
    expect(stored()).toHaveLength(1);
  });

  it("brings in a change and marks it, never touching the player's presets", async () => {
    const own = JSON.stringify([{ id: "mine", name: "Mine" }]);
    storage.set(PRESETS_KEY, own);
    await follow();
    answering(
      manifest([rawPreset("A", { modOptionValues: { tweakdefs: "bmV3" } })]),
    );
    await useFollowedPacks().refreshAll();
    const entry = stored()[0].presets[0];
    expect(entry.updated).toBe(true);
    expect(entry.preset.modOptionValues.tweakdefs).toBe("bmV3");
    expect(presetForBattle(entry).modOptionValues.tweakdefs).toBeUndefined();
    expect(storage.get(PRESETS_KEY)).toBe(own);
  });

  it("clears the mark and releases the slots when the new version is opened", async () => {
    await follow();
    answering(manifest([rawPreset("A", { mapName: "Elsewhere" })]));
    await useFollowedPacks().refreshAll();
    const [pack] = stored();
    const entry = pack.presets[0];
    useFollowedPacks().markSeen(pack.id, entry.preset.id, entry.contentKey);
    const opened = stored()[0].presets[0];
    expect(opened.updated).toBe(false);
    expect(presetForBattle(opened).modOptionValues.tweakdefs).toBe("bHVh");
  });

  it("keeps the mark when a refresh overtook the version being opened", async () => {
    await follow();
    const [pack] = stored();
    const opening = pack.presets[0].contentKey;
    answering(manifest([rawPreset("A", { mapName: "Elsewhere" })]));
    await useFollowedPacks().refreshAll();
    useFollowedPacks().markSeen(pack.id, pack.presets[0].preset.id, opening);
    expect(stored()[0].presets[0].updated).toBe(true);
    expect(stored()[0].presets[0].seenKey).toBeNull();
  });

  it("keeps the cached copy when the network is off, and says why", async () => {
    await follow();
    const before = stored()[0];
    fetchPack.mockRejectedValue(new Error("Could not reach the host."));
    await useFollowedPacks().refreshAll();
    const [after] = stored();
    expect(after.lastError).toBe("Could not reach the host.");
    expect(after.presets).toEqual(before.presets);
    expect(after.lastUpdatedAt).toBe(before.lastUpdatedAt);
  });

  it("keeps the cached copy when a refresh returns a malformed manifest", async () => {
    await follow();
    const before = stored()[0];
    fetchPack.mockResolvedValue({ text: "{ not json" });
    await useFollowedPacks().refreshAll();
    const [after] = stored();
    expect(after.lastError).toBe("That address did not return a setup pack.");
    expect(after.presets).toEqual(before.presets);
    expect(after.lastUpdatedAt).toBe(before.lastUpdatedAt);
  });

  it("clears the failure when a later refresh works", async () => {
    await follow();
    fetchPack.mockRejectedValue(new Error("Could not reach the host."));
    await useFollowedPacks().refreshAll();
    answering(manifest([rawPreset("A")]));
    await useFollowedPacks().refreshAll();
    expect(stored()[0].lastError).toBeNull();
  });

  it("does not bring back a pack unfollowed while its refresh was out", async () => {
    await follow();
    let answer: (value: { text: string }) => void = () => {};
    fetchPack.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const refreshing = useFollowedPacks().refreshAll();
    useFollowedPacks().unfollow(stored()[0].id);
    answer({ text: JSON.stringify(manifest([rawPreset("A")])) });
    await refreshing;
    expect(stored()).toEqual([]);
  });

  it("removes a pack's presets on unfollow, leaving saved copies", async () => {
    const copy = JSON.stringify([{ id: "copy", name: "A" }]);
    await follow();
    storage.set(PRESETS_KEY, copy);
    useFollowedPacks().unfollow(stored()[0].id);
    expect(stored()).toEqual([]);
    expect(storage.get(PRESETS_KEY)).toBe(copy);
  });
});
