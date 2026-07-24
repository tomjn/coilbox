import { describe, expect, it, vi } from "vitest";

// `manifest.ts` pulls in `play/presets.ts`, which pulls in `useSetting` from
// the frame package, whose `AppFrame` subpath doesn't resolve under vitest's
// node resolver. We only exercise pure functions, so stub the hook to keep the
// module importable (mirrors `play/presets.test.ts`).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [undefined, () => {}],
}));

import type { InstalledContentSnapshot } from "../content/resolveContent";
import type { SkirmishPreset } from "../play/presets";
import {
  decodeSetupPack,
  dedupePresetName,
  encodeSetupPack,
  namesForPackPresets,
  parseSetupPackManifest,
  requirementsForPack,
  type SetupPackManifest,
} from "./manifest";

function manifest(
  overrides: Partial<SetupPackManifest> = {},
): SetupPackManifest {
  return {
    engineVersion: "105.1.1-2554-gabcdef",
    game: { name: "Beyond All Reason test-27000" },
    maps: ["Red Comet Remake 1.8"],
    ...overrides,
  };
}

function preset(overrides: Partial<SkirmishPreset> = {}): SkirmishPreset {
  return {
    id: "id-1",
    name: "My preset",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-01-01T00:00:00.000Z",
    participants: [],
    gameName: "Beyond All Reason test-27000",
    mapName: "Red Comet Remake 1.8",
    startPosType: 0,
    modOptionValues: {},
    ...overrides,
  };
}

describe("parseSetupPackManifest", () => {
  it("accepts a minimal valid manifest", () => {
    expect(parseSetupPackManifest(manifest())).toEqual(manifest());
  });

  it("accepts a manifest with a rapid tag and presets", () => {
    const m = manifest({
      game: { name: "Beyond All Reason test-27000", rapidTag: "byar:test" },
      presets: [
        {
          participants: [],
          gameName: "Beyond All Reason test-27000",
          mapName: "Red Comet Remake 1.8",
          startPosType: 0,
          modOptionValues: {},
          name: "1v1",
        },
      ],
    });
    expect(parseSetupPackManifest(m)).toEqual(m);
  });

  it.each([
    ["not an object", null],
    ["a string", "hello"],
    ["missing engineVersion", { ...manifest(), engineVersion: undefined }],
    ["blank engineVersion", { ...manifest(), engineVersion: "  " }],
    ["missing game", { ...manifest(), game: undefined }],
    ["game without a name", { ...manifest(), game: { name: "" } }],
    [
      "game with a non-string rapidTag",
      { ...manifest(), game: { name: "g", rapidTag: 1 } },
    ],
    ["missing maps", { ...manifest(), maps: undefined }],
    ["an empty map list", { ...manifest(), maps: [] }],
    ["a map list with a blank entry", { ...manifest(), maps: [""] }],
    ["a map list with a non-string entry", { ...manifest(), maps: [1] }],
    ["presets that aren't an array", { ...manifest(), presets: "nope" }],
    [
      "a preset missing required draft fields",
      { ...manifest(), presets: [{ name: "broken" }] },
    ],
    [
      "a preset without a name",
      {
        ...manifest(),
        presets: [
          {
            participants: [],
            gameName: "g",
            mapName: "m",
            startPosType: 0,
            modOptionValues: {},
          },
        ],
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseSetupPackManifest(value)).toBeNull();
  });
});

describe("encodeSetupPack / decodeSetupPack", () => {
  it("round-trips a manifest", () => {
    const m = manifest();
    const result = decodeSetupPack(encodeSetupPack(m));
    expect(result).toEqual({ ok: true, settings: m });
  });

  it("rejects a corrupted code cleanly", () => {
    const code = encodeSetupPack(manifest());
    const corrupted = `${code.slice(0, -4)}xxxx`;
    const result = decodeSetupPack(corrupted);
    expect(result.ok).toBe(false);
  });
});

describe("requirementsForPack", () => {
  const installed: InstalledContentSnapshot = {
    games: [{ name: "Beyond All Reason test-27000", shortname: "byar" }],
    maps: ["Red Comet Remake 1.8"],
    engineVersions: ["105.1.1-2554-gabcdef"],
  };

  it("is fully satisfied when everything matches", () => {
    const reqs = requirementsForPack(manifest());
    expect(reqs.every((r) => r.isInstalled(installed))).toBe(true);
  });

  it("flags a missing engine, game or map independently", () => {
    const reqs = requirementsForPack(
      manifest({ engineVersion: "999", maps: ["Some Other Map"] }),
    );
    const byKind = Object.fromEntries(reqs.map((r) => [r.kind, r]));
    expect(byKind.engine.isInstalled(installed)).toBe(false);
    expect(byKind.game.isInstalled(installed)).toBe(true);
    expect(byKind.map.isInstalled(installed)).toBe(false);
  });

  it("uses the rapid tag as the download key when given", () => {
    const [, gameReq] = requirementsForPack(
      manifest({ game: { name: "g", rapidTag: "byar:test" } }),
    );
    expect(gameReq.downloadKey).toBe("byar:test");
  });

  it("falls back to the archive name as the download key otherwise", () => {
    const [, gameReq] = requirementsForPack(manifest());
    expect(gameReq.downloadKey).toBe("Beyond All Reason test-27000");
  });

  it("dedupes repeated maps", () => {
    const reqs = requirementsForPack(
      manifest({ maps: ["Map A", "Map A", "Map B"] }),
    );
    expect(reqs.filter((r) => r.kind === "map")).toHaveLength(2);
  });
});

describe("dedupePresetName", () => {
  it("keeps a name that isn't taken", () => {
    expect(dedupePresetName(["Other"], "1v1")).toBe("1v1");
  });

  it("appends a counter on collision", () => {
    expect(dedupePresetName(["1v1"], "1v1")).toBe("1v1 (2)");
  });

  it("skips past already-numbered collisions", () => {
    expect(dedupePresetName(["1v1", "1v1 (2)"], "1v1")).toBe("1v1 (3)");
  });
});

describe("namesForPackPresets", () => {
  it("disambiguates against existing presets", () => {
    const existing = [preset({ name: "1v1" })];
    const names = namesForPackPresets(existing, [{ ...preset(), name: "1v1" }]);
    expect(names).toEqual(["1v1 (2)"]);
  });

  it("disambiguates two bundled presets sharing a name against each other", () => {
    const names = namesForPackPresets(
      [],
      [
        { ...preset(), name: "1v1" },
        { ...preset(), name: "1v1" },
      ],
    );
    expect(names).toEqual(["1v1", "1v1 (2)"]);
  });

  it("never overwrites: an existing preset's name is untouched", () => {
    const existing = [preset({ id: "keep-me", name: "1v1" })];
    namesForPackPresets(existing, [{ ...preset(), name: "1v1" }]);
    expect(existing[0].id).toBe("keep-me");
    expect(existing[0].name).toBe("1v1");
  });
});
