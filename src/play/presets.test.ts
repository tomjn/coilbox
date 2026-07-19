import { describe, expect, it, vi } from "vitest";

// `presets.ts` pulls in `useSetting` from the frame package, whose `AppFrame`
// subpath doesn't resolve under vitest's node resolver. We only test the pure
// `parsePresetJson`, so stub the hook to keep the module importable.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [undefined, () => {}],
}));

import type { SkirmishDraft } from "./drafts";
import {
  parsePresetJson,
  presetMatchesDraft,
  type SkirmishPreset,
} from "./presets";

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
