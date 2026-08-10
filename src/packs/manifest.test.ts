import { describe, expect, it, vi } from "vitest";

// `manifest.ts` pulls in `play/presets.ts`, which pulls in `useSetting` from
// the frame package, whose `AppFrame` subpath doesn't resolve under vitest's
// node resolver. We only exercise pure functions, so stub the hook to keep the
// module importable (mirrors `play/presets.test.ts`).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [undefined, () => {}],
}));

import { encodeContainerCode, identify } from "../container/container";
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
    games: [{ name: "Beyond All Reason test-27000" }],
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

  it("accepts a manifest with no engine pinned", () => {
    const { engineVersion: _engineVersion, ...rest } = manifest();
    expect(parseSetupPackManifest(rest)).toEqual(rest);
  });

  it("treats a blank engineVersion as no engine pinned", () => {
    const m = manifest({ engineVersion: "  " });
    const { engineVersion: _engineVersion, ...expected } = manifest();
    expect(parseSetupPackManifest(m)).toEqual(expected);
  });

  it("treats a legacy .spring engineVersion as no engine pinned", () => {
    const m = manifest({ engineVersion: ".spring" });
    const { engineVersion: _engineVersion, ...expected } = manifest();
    expect(parseSetupPackManifest(m)).toEqual(expected);
  });

  it("accepts a manifest with a rapid tag and presets", () => {
    const m = manifest({
      games: [{ name: "Beyond All Reason test-27000", rapidTag: "byar:test" }],
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
    ["a non-string engineVersion", { ...manifest(), engineVersion: 1 }],
    ["a non-string title", { ...manifest(), title: 5 }],
    ["a game without a name", { ...manifest(), games: [{ name: "" }] }],
    [
      "a game with a non-string rapidTag",
      { ...manifest(), games: [{ name: "g", rapidTag: 1 }] },
    ],
    ["a games field that isn't an array", { ...manifest(), games: "oops" }],
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

describe("a pack as a collection", () => {
  it("takes several games", () => {
    const parsed = parseSetupPackManifest({
      games: [{ name: "Game A" }, { name: "Game B" }],
      maps: ["Map One"],
    });
    expect(parsed?.games?.map((g) => g.name)).toEqual(["Game A", "Game B"]);
  });

  it("takes maps with no game", () => {
    const parsed = parseSetupPackManifest({ maps: ["Map One", "Map Two"] });
    expect(parsed?.maps).toEqual(["Map One", "Map Two"]);
    expect(parsed?.games).toBeUndefined();
  });

  it("takes games with no maps", () => {
    const parsed = parseSetupPackManifest({ games: [{ name: "Game A" }] });
    expect(parsed?.games?.length).toBe(1);
    expect(parsed?.maps).toBeUndefined();
  });

  it("rejects a pack holding neither", () => {
    expect(parseSetupPackManifest({ presets: [] })).toBeNull();
    expect(parseSetupPackManifest({ games: [], maps: [] })).toBeNull();
  });

  it("keeps a title when given one", () => {
    const parsed = parseSetupPackManifest({
      title: "Popular water maps",
      maps: ["Map One"],
    });
    expect(parsed?.title).toBe("Popular water maps");
  });

  it("drops a blank title rather than carrying it", () => {
    const parsed = parseSetupPackManifest({ title: "  ", maps: ["Map One"] });
    expect(parsed?.title).toBeUndefined();
  });

  it("reads a pack shared before this as one game", () => {
    const parsed = parseSetupPackManifest({
      engineVersion: "105.1.1-2554-gabcdef",
      game: { name: "Beyond All Reason test-27000", rapidTag: "byar:test" },
      maps: ["Red Comet Remake 1.8"],
    });
    expect(parsed?.games).toEqual([
      { name: "Beyond All Reason test-27000", rapidTag: "byar:test" },
    ]);
    expect(parsed?.engineVersion).toBe("105.1.1-2554-gabcdef");
  });

  it("asks for every game and every map", () => {
    const reqs = requirementsForPack(
      manifest({
        games: [{ name: "Game A" }, { name: "Game B" }],
        maps: ["Map One", "Map Two"],
      }),
    );
    expect(reqs.filter((r) => r.kind === "game").map((r) => r.label)).toEqual([
      "Game A",
      "Game B",
    ]);
    expect(reqs.filter((r) => r.kind === "map").length).toBe(2);
  });

  it("asks for nothing but maps when the pack pins no game", () => {
    const reqs = requirementsForPack({ maps: ["Map One"] });
    expect(reqs.every((r) => r.kind === "map")).toBe(true);
  });
});

describe("encodeSetupPack / decodeSetupPack", () => {
  it("round-trips a manifest with a pinned engine", () => {
    const m = manifest({ engineVersion: "105.1.1-2554-gabcdef" });
    const result = decodeSetupPack(encodeSetupPack(m));
    expect(result).toEqual({ ok: true, settings: m });
  });

  it("round-trips a manifest with no engine pinned", () => {
    const { engineVersion: _engineVersion, ...m } = manifest();
    const result = decodeSetupPack(encodeSetupPack(m));
    expect(result).toEqual({ ok: true, settings: m });
  });

  it("reads a legacy pack carrying the literal .spring as no engine pinned", () => {
    const { engineVersion: _engineVersion, ...rest } = manifest();
    const legacyPayload = { ...rest, engineVersion: ".spring" };
    const code = encodeContainerCode("setup-pack", 1, legacyPayload);
    const result = decodeSetupPack(code);
    expect(result).toEqual({ ok: true, settings: rest });
  });

  it("round-trips the game's shortname beside its archive name", () => {
    const m = manifest({
      games: [{ name: "Beyond All Reason test-27000", shortname: "byar" }],
    });
    const result = decodeSetupPack(encodeSetupPack(m));
    expect(result).toEqual({ ok: true, settings: m });
  });

  it("reads a legacy pack that names its game without a shortname", () => {
    const legacyPayload = {
      maps: manifest().maps,
      game: { name: "Beyond All Reason test-27000" },
    };
    const code = encodeContainerCode("setup-pack", 1, legacyPayload);
    expect(decodeSetupPack(code)).toEqual({
      ok: true,
      settings: {
        maps: manifest().maps,
        games: [{ name: "Beyond All Reason test-27000" }],
      },
    });
    expect(identify(code).game).toEqual({
      name: "Beyond All Reason test-27000",
    });
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

  it("omits the engine requirement when the pack pins no engine", () => {
    const { engineVersion: _engineVersion, ...noEngine } = manifest();
    const reqs = requirementsForPack(noEngine);
    expect(reqs.some((r) => r.kind === "engine")).toBe(false);
    expect(reqs.map((r) => r.kind)).toEqual(["game", "map"]);
  });

  it("uses the rapid tag as the download key when given", () => {
    const [gameReq] = requirementsForPack(
      manifest({ games: [{ name: "g", rapidTag: "byar:test" }] }),
    );
    expect(gameReq.downloadKey).toBe("byar:test");
  });

  it("falls back to the archive name as the download key otherwise", () => {
    const [gameReq] = requirementsForPack(manifest());
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
