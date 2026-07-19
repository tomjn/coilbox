import { describe, expect, it, vi } from "vitest";

// `presets.ts` pulls in `useSetting` from the frame package, whose `AppFrame`
// subpath doesn't resolve under vitest's node resolver. We only test the pure
// `parsePresetJson`, so stub the hook to keep the module importable.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [undefined, () => {}],
}));

import { parsePresetJson } from "./presets";

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
