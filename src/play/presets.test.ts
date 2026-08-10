import { beforeEach, describe, expect, it, vi } from "vitest";

// `presets.ts` pulls in `useSetting` from the frame package, whose `AppFrame`
// subpath doesn't resolve under vitest's node resolver, so stub it. The stub
// copies the real hook's behaviour that matters here: it writes through to the
// storage the app installs, while the value a caller holds is the one read when
// the hook ran, so it doesn't move under a later write.
vi.mock("@picoframe/frame", () => ({
  useSetting: (key: string, fallback: unknown) => [
    readStoredSetting(key, fallback),
    (next: unknown) => storage.set(key, JSON.stringify(next)),
  ],
}));

import { encodeContainerCode, identify } from "../container/container";
import { rememberShortnames, resetShortnames } from "../container/shortnames";
import {
  installSettingsStorage,
  memorySettingsStorage,
  readStoredSetting,
} from "../lib/storedSetting";
import type { SkirmishDraft } from "./drafts";
import {
  PRESET_KIND_VERSION,
  PRESETS_KEY,
  parsePresetJson,
  presetMatchesDraft,
  presetPayload,
  presetRoute,
  type SkirmishPreset,
  useSkirmishPresets,
} from "./presets";

/** The store the frame stub above reads and writes, replaced per test. */
let storage = memorySettingsStorage();
installSettingsStorage(storage);

const base = {
  name: "My battle",
  participants: [],
  gameName: "SplinterFaction 0.1.75",
  mapName: "All That Glitters v2.2.3",
  startPosType: 0,
  modOptionValues: {},
};

describe("parsePresetJson restrictions", () => {
  it("carries a valid restrictions blob through", () => {
    const parsed = parsePresetJson(
      JSON.stringify({
        ...base,
        restrictions: {
          disabledUnits: ["armcom", "corcom"],
          advantage: 0.1,
          incomeMultiplier: 0.2,
        },
      }),
    );
    expect(parsed?.restrictions).toEqual({
      disabledUnits: ["armcom", "corcom"],
      advantage: 0.1,
      incomeMultiplier: 0.2,
    });
  });

  it("leaves restrictions undefined when absent", () => {
    const parsed = parsePresetJson(JSON.stringify(base));
    expect(parsed).not.toBeNull();
    expect(parsed?.restrictions).toBeUndefined();
  });

  it("drops malformed restriction fields but keeps the preset", () => {
    const parsed = parsePresetJson(
      JSON.stringify({
        ...base,
        restrictions: {
          disabledUnits: ["ok", 3], // not all strings -> dropped
          advantage: "lots", // not a number -> dropped
          incomeMultiplier: 0.5, // valid -> kept
        },
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.restrictions).toEqual({ incomeMultiplier: 0.5 });
  });

  it("drops an empty restrictions object to undefined", () => {
    const parsed = parsePresetJson(
      JSON.stringify({ ...base, restrictions: {} }),
    );
    expect(parsed?.restrictions).toBeUndefined();
  });

  it("returns null when a required base field is missing", () => {
    const { gameName, ...noGame } = base;
    expect(parsePresetJson(JSON.stringify(noGame))).toBeNull();
  });
});

describe("parsePresetJson container handling", () => {
  it("reads a canonical container preset (issue #479)", () => {
    const container = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "preset",
      kindVersion: 1,
      payload: base,
    });
    const parsed = parsePresetJson(container);
    expect(parsed?.gameName).toBe(base.gameName);
    expect(parsed?.name).toBe(base.name);
  });

  it("still reads a legacy bare preset file (no envelope)", () => {
    const parsed = parsePresetJson(JSON.stringify(base));
    expect(parsed?.gameName).toBe(base.gameName);
  });

  it("rejects a container of the wrong kind", () => {
    const container = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "campaign",
      kindVersion: 1,
      payload: base,
    });
    expect(parsePresetJson(container)).toBeNull();
  });

  it("rejects a container from a newer version of coilbox", () => {
    const container = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "preset",
      kindVersion: 99,
      payload: base,
    });
    expect(parsePresetJson(container)).toBeNull();
  });
});

const rgb = (r: number, g: number, b: number): [number, number, number] => [
  r,
  g,
  b,
];

/** A draft with session-tagged participant ids, to prove ids don't affect matching. */
const draftWith = (
  ids: [string, string],
  over: Partial<SkirmishDraft> = {},
): SkirmishDraft => ({
  participants: [
    {
      id: ids[0],
      kind: "you",
      name: "You",
      side: "",
      color: rgb(0.31, 0.55, 1),
      allyTeam: 0,
      spectator: false,
    },
    {
      id: ids[1],
      kind: "ai",
      name: "Hostile 1",
      ai: { shortName: "BARb", kind: "native", name: "BARb" },
      side: "",
      color: rgb(0.9, 0.24, 0.2),
      allyTeam: 1,
      spectator: false,
    },
  ],
  gameName: "BAR",
  mapName: "Comet Catcher",
  startPosType: 0,
  modOptionValues: {},
  ...over,
});

const asPreset = (draft: SkirmishDraft, name = "Saved"): SkirmishPreset => ({
  ...draft,
  id: "preset-1",
  name,
  createdAt: "2020-01-01T00:00:00.000Z",
  lastUsedAt: "2020-01-01T00:00:00.000Z",
});

describe("presetPayload", () => {
  const preset: SkirmishPreset = {
    ...base,
    id: "id-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(resetShortnames);

  it("round-trips a shared preset that names its game both ways", () => {
    const code = encodeContainerCode(
      "preset",
      PRESET_KIND_VERSION,
      presetPayload(preset, [
        { name: base.gameName, info: { shortname: "SF" } },
      ]),
    );
    expect(identify(code).game).toEqual({
      name: base.gameName,
      shortname: "SF",
    });
    expect(parsePresetJson(code)?.gameName).toBe(base.gameName);
  });

  it("names the game by archive name alone when it isn't installed here", () => {
    expect(presetPayload(preset, []).game).toEqual({ name: base.gameName });
  });

  // Issue #1364: the shortname is what Coilbox Hub groups an item by, and the
  // build a preset pins is gone the moment the game updates.
  it("names the game both ways when only an older build was ever installed", () => {
    rememberShortnames([{ name: base.gameName, info: { shortname: "SF" } }]);
    const installedNow = [
      { name: "SplinterFaction 0.1.78", info: { shortname: "SF" } },
    ];
    expect(presetPayload(preset, installedNow).game).toEqual({
      name: base.gameName,
      shortname: "SF",
    });
  });

  it("reads the game out of a preset shared before the shared field", () => {
    const code = encodeContainerCode("preset", 1, base);
    expect(identify(code).game).toEqual({ name: base.gameName });
    expect(parsePresetJson(code)?.gameName).toBe(base.gameName);
  });

  it("reads a preset that names its game only the shared way", () => {
    const { gameName: _gameName, ...rest } = base;
    const parsed = parsePresetJson(
      JSON.stringify({ ...rest, game: { name: "BAR 1.2", shortname: "BAR" } }),
    );
    expect(parsed?.gameName).toBe("BAR 1.2");
  });
});

describe("presetMatchesDraft", () => {
  it("matches the same battle despite different session participant ids", () => {
    const saved = asPreset(draftWith(["rl0", "rl1"]), "A whatever name");
    expect(presetMatchesDraft([saved], draftWith(["rl4", "rl5"]))).toBe(true);
  });

  it("is false when no preset captures the battle", () => {
    expect(presetMatchesDraft([], draftWith(["rl0", "rl1"]))).toBe(false);
  });

  it("distinguishes battles that differ in a meaningful field", () => {
    const saved = asPreset(draftWith(["rl0", "rl1"]));
    const otherMap = draftWith(["rl0", "rl1"], { mapName: "Another Map" });
    expect(presetMatchesDraft([saved], otherMap)).toBe(false);
  });

  it("treats absent restrictions as distinct from present ones", () => {
    const plain = asPreset(draftWith(["rl0", "rl1"]));
    const restricted = draftWith(["rl0", "rl1"], {
      restrictions: { advantage: 0.1 },
    });
    expect(presetMatchesDraft([plain], restricted)).toBe(false);
    expect(presetMatchesDraft([asPreset(restricted)], restricted)).toBe(true);
  });

  it("ignores mod-option key order", () => {
    const saved = asPreset(
      draftWith(["rl0", "rl1"], { modOptionValues: { a: "1", b: "2" } }),
    );
    const reordered = draftWith(["rl4", "rl5"], {
      modOptionValues: { b: "2", a: "1" },
    });
    expect(presetMatchesDraft([saved], reordered)).toBe(true);
  });
});

describe("useSkirmishPresets", () => {
  beforeEach(() => {
    storage = memorySettingsStorage();
    installSettingsStorage(storage);
  });

  const stored = () => readStoredSetting<SkirmishPreset[]>(PRESETS_KEY, []);

  it("keeps every preset when several are saved in one pass", () => {
    // What importing a setup pack that bundles three presets does: one pass over
    // the bundle, one save each, no re-render in between (issue #1371).
    const { savePreset } = useSkirmishPresets();
    const ids = ["One", "Two", "Three"].map(
      (name) => savePreset(name, draftWith(["rl0", "rl1"])).id,
    );
    expect(stored().map((p) => p.name)).toEqual(["Three", "Two", "One"]);
    // Every id handed back names a preset that is actually there, so a caller
    // recording what the import produced records real presets.
    expect(ids.every((id) => stored().some((p) => p.id === id))).toBe(true);
  });

  it("removes a preset saved earlier in the same pass", () => {
    const { savePreset, removePreset } = useSkirmishPresets();
    savePreset("Keep", draftWith(["rl0", "rl1"]));
    const drop = savePreset("Drop", draftWith(["rl0", "rl1"]));
    removePreset(drop.id);
    expect(stored().map((p) => p.name)).toEqual(["Keep"]);
  });
});

describe("presetRoute", () => {
  it("names the preset on the Singleplayer page", () => {
    expect(presetRoute("abc")).toBe("/play/skirmish?preset=abc");
  });

  it("encodes an id that would otherwise break the query string", () => {
    expect(presetRoute("a&b=c")).toBe("/play/skirmish?preset=a%26b%3Dc");
  });
});
