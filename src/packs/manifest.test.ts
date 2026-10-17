import { describe, expect, it, vi } from "vitest";

// `manifest.ts` pulls in `play/presets.ts`, which pulls in `useSetting` from
// the frame package, whose `AppFrame` subpath doesn't resolve under vitest's
// node resolver. We only exercise pure functions, so stub the hook to keep the
// module importable (mirrors `play/presets.test.ts`).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [undefined, () => {}],
}));

import type { BlueprintPayload } from "../blueprint/payload";
import { encodeContainerCode, identify } from "../container/container";
import type { InstalledContentSnapshot } from "../content/resolveContent";
import type { SkirmishPreset } from "../play/presets";
import {
  blueprintsFromPack,
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

function layout(overrides: Partial<BlueprintPayload> = {}): BlueprintPayload {
  return {
    game: { name: "Beyond All Reason test-27000", shortname: "byar" },
    name: "Opening solars",
    buildings: [
      { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
      { def: "armlab", offset: { x: 96, z: 0 }, facing: 1 },
    ],
    footprints: { armsolar: { x: 4, z: 4 }, armlab: { x: 8, z: 6 } },
    ...overrides,
  };
}

/** A pack code, or a failed test naming why there is none. */
function code(m: SetupPackManifest): string {
  const encoded = encodeSetupPack(m);
  if (!encoded.ok) throw new Error(encoded.message);
  return encoded.code;
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
    const result = decodeSetupPack(code(m));
    expect(result).toEqual({ ok: true, settings: m });
  });

  it("round-trips a manifest with no engine pinned", () => {
    const { engineVersion: _engineVersion, ...m } = manifest();
    const result = decodeSetupPack(code(m));
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
    const result = decodeSetupPack(code(m));
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

  it("round-trips the blueprints a pack carries", () => {
    const m = manifest({
      blueprints: [layout(), layout({ name: "Wall", ordered: true })],
    });
    expect(decodeSetupPack(code(m))).toEqual({ ok: true, settings: m });
  });

  it("still imports a pack shared before packs carried blueprints", () => {
    const old = encodeContainerCode("setup-pack", 1, {
      title: "Comet nights",
      games: [{ name: "Beyond All Reason test-27000" }],
      maps: ["Red Comet Remake 1.8"],
      presets: [{ ...preset(), id: undefined }],
    });
    const result = decodeSetupPack(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.blueprints).toBeUndefined();
    expect(result.settings.title).toBe("Comet nights");
    expect(result.settings.presets).toHaveLength(1);
  });

  it("refuses to make a code the far end could not read back", () => {
    // Distinct names so the text cannot compress down to nothing, and enough
    // of them that the container's JSON is past the inflate ceiling.
    const many = Array.from({ length: 4000 }, (_, i) =>
      layout({ name: `Layout ${i} ${"x".repeat(100)}` }),
    );
    const encoded = encodeSetupPack(manifest({ blueprints: many }));
    expect(encoded.ok).toBe(false);
    if (encoded.ok) return;
    expect(encoded.message).toContain("512 KB");
    expect(encoded.message).toContain("blueprints");
  });

  it("rejects a corrupted code cleanly", () => {
    const good = code(manifest());
    const corrupted = `${good.slice(0, -4)}xxxx`;
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

describe("parseSetupPackManifest, for blueprints", () => {
  it("reads the layouts a pack carries", () => {
    const m = manifest({ blueprints: [layout()] });
    expect(parseSetupPackManifest(m)).toEqual(m);
  });

  it("is not a pack when blueprints are all it holds", () => {
    expect(parseSetupPackManifest({ blueprints: [layout()] })).toBeNull();
  });

  it("rejects a pack whose blueprints are not a list", () => {
    expect(
      parseSetupPackManifest({ ...manifest(), blueprints: layout() }),
    ).toBeNull();
  });

  it("rejects a pack holding a damaged blueprint", () => {
    expect(
      parseSetupPackManifest({
        ...manifest(),
        blueprints: [layout(), { name: "No buildings list" }],
      }),
    ).toBeNull();
  });
});

describe("blueprintsFromPack", () => {
  const at = new Date("2026-10-17T09:00:00.000Z");

  it("keeps each layout under a fresh id, noting the pack it came in", () => {
    const [kept] = blueprintsFromPack(
      [],
      manifest({ title: "Comet nights", blueprints: [layout()] }),
      at,
    );
    expect(kept.id).not.toBe("");
    expect(kept.layout).toEqual(layout());
    expect(kept.source).toEqual({
      kind: "setup-pack",
      title: "Comet nights",
      at: "2026-10-17T09:00:00.000Z",
    });
  });

  it("counts a name up past the library and the pack's other layouts", () => {
    const kept = blueprintsFromPack(
      ["opening solars"],
      manifest({
        blueprints: [layout(), layout(), layout({ name: "Wall" })],
      }),
      at,
    );
    expect(kept.map((k) => k.layout.name)).toEqual([
      "Opening solars 2",
      "Opening solars 3",
      "Wall",
    ]);
    expect(kept.map((k) => k.source?.wasCalled)).toEqual([
      "Opening solars",
      "Opening solars",
      undefined,
    ]);
  });

  it("mints a different id for every layout", () => {
    const kept = blueprintsFromPack(
      [],
      manifest({ blueprints: [layout(), layout()] }),
      at,
    );
    expect(new Set(kept.map((k) => k.id)).size).toBe(2);
  });

  it("keeps nothing for a pack that carries no blueprints", () => {
    expect(blueprintsFromPack([], manifest(), at)).toEqual([]);
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
