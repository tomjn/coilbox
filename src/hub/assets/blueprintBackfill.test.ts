import { describe, expect, it } from "vitest";

import type { UnitDatasetEntry } from "@/content/bindings";
import {
  type BackfillTools,
  type BackfillUnit,
  backfillBlueprintUnits,
  blueprintBackfillUnits,
  unitsWanted,
} from "./blueprintBackfill";
import type { AssetKey, HaveResult, HaveStatus } from "./have";
import type { AssetUpload } from "./upload";

/**
 * Beyond All Reason's roster after #1663, which is the number this file exists
 * to stay away from. A run that touches this many of anything has walked a
 * roster.
 */
const BAR_UNITS = 564;

/** A game's whole dataset, of which a layout names a handful. */
function roster(count = BAR_UNITS): UnitDatasetEntry[] {
  return Array.from({ length: count }, (_, at) => ({
    name: `unit${at}`,
    objectName: `unit${at}.s3o`,
    footprintX: 2,
    footprintZ: 3,
  }));
}

/** A layout naming `count` of them, plus one repeat and one unit the game has
 *  not got, because a real file has both. */
function buildings(count: number): { def: string }[] {
  const named = Array.from({ length: count }, (_, at) => ({
    def: `Unit${at}`,
  }));
  return [...named, { def: "unit0" }, { def: "somebody-elses-unit" }];
}

/** What every call the run makes was handed, so a test counts rather than
 *  inspects. */
interface Spy {
  tools: BackfillTools;
  renderKeyCalls: number;
  buildpicCalls: number;
  asked: AssetKey[][];
  /** One entry per batch model read, holding the objects it asked for. */
  modelBatches: string[][];
  /** Those batches flattened, which is the per-unit work the mounts used to
   *  cost one archive load each. */
  models: string[];
  draws: number;
  uploads: AssetUpload[][];
  /** Who each run said started it (issue #1690). */
  startedBy: string[];
}

/** A tool set that answers everything, with knobs for the two things a test
 *  varies: what the hub already has, and which units ship a build pic. */
function spy(
  options: {
    hubHas?: (unit: string) => boolean;
    shipsBuildpic?: (unit: string) => boolean;
    modelless?: (unit: string) => boolean;
  } = {},
): Spy {
  const hubHas = options.hubHas ?? (() => false);
  const shipsBuildpic = options.shipsBuildpic ?? (() => true);
  const modelless = options.modelless ?? (() => false);

  const state = {
    renderKeyCalls: 0,
    buildpicCalls: 0,
    asked: [] as AssetKey[][],
    modelBatches: [] as string[][],
    draws: 0,
    uploads: [] as AssetUpload[][],
    startedBy: [] as string[],
  };

  const tools: BackfillTools = {
    renderKeys: async ({ units }) => {
      state.renderKeyCalls += 1;
      const keys: Record<string, never> | Record<string, unknown> = {};
      for (const unit of units) {
        if (modelless(unit.unit)) continue;
        keys[unit.unit] = {
          objectName: unit.object,
          sourceMember: `objects3d/${unit.object}`,
          modelDigest: `model-${unit.unit}`,
          variant: "render:top",
          rendererVersion: 1,
          footprintX: unit.footprintX,
          footprintZ: unit.footprintZ,
          widthPx: 128,
          heightPx: 192,
          sourceHash: `render-src-${unit.unit}`,
        };
      }
      return { keys, skipped: {}, errors: [] } as never;
    },
    ask: async (_hubUrl, keys) => {
      state.asked.push(keys);
      return keys.map((key): HaveResult => {
        const status: HaveStatus =
          key.keyed_on === "unit" && hubHas(key.unit_name) ? "have" : "missing";
        return { ...key, status } as HaveResult;
      });
    },
    buildpics: async ({ units }) => {
      state.buildpicCalls += 1;
      const out: Record<string, unknown> = {};
      for (const unit of units) {
        out[unit] = shipsBuildpic(unit)
          ? {
              asset: {
                variant: "buildpic",
                origin: "extracted",
                sourceArchive: "Beyond All Reason test-1",
                path: `/cache/${unit}.webp`,
                hash: `hash-${unit}`,
                sourceHash: `pic-src-${unit}`,
                sourceMember: `unitpics/${unit}.dds`,
                encodeProfile: "webp-q80-512",
                mime: "image/webp",
                width: 128,
                height: 128,
                bytes: 900,
              },
            }
          : { assetSkipped: "no-source" };
      }
      return { units: out, errors: [] } as never;
    },
    models: async ({ objects }) => {
      state.modelBatches.push([...objects]);
      const models: Record<string, unknown> = {};
      for (const object of objects) {
        models[object] = {
          file: `abcd_objects3d_${object}.json`,
          path: `objects3d/${object}`,
          format: "s3o",
        };
      }
      return { models, skipped: {}, errors: [] } as never;
    },
    readModel: async (file) => ({
      format: "s3o",
      path: file,
      radius: 10,
      height: 10,
      mid: [0, 0, 0],
      textures: [],
      paletteFaces: 0,
      errors: [],
    }),
    draw: async () => {
      state.draws += 1;
      return {
        width: 4,
        height: 4,
        rgba: new Uint8Array(4 * 4 * 4),
        frame: {
          squaresX: 4,
          squaresZ: 5,
          widthElmos: 64,
          heightElmos: 80,
          widthPx: 4,
          heightPx: 4,
          pixelsPerSquare: 1,
        },
      };
    },
    encodeRender: async ({ object }) => ({
      asset: {
        variant: "render:top",
        origin: "rendered",
        sourceArchive: "Beyond All Reason test-1",
        path: `/cache/${object}.render.webp`,
        hash: `render-hash-${object}`,
        sourceHash: `render-src-${object}`,
        sourceMember: `objects3d/${object}`,
        modelDigest: `model-${object}`,
        rendererVersion: 1,
        footprintX: 2,
        footprintZ: 3,
        encodeProfile: "webp-q80-512",
        mime: "image/webp",
        width: 128,
        height: 192,
        bytes: 4000,
      },
      errors: [],
    }),
    upload: async (_hubUrl, assets, options) => {
      state.uploads.push(assets);
      state.startedBy.push(options.startedBy);
      return { outcomes: [], written: assets.length, error: null };
    },
  };

  return {
    tools,
    get renderKeyCalls() {
      return state.renderKeyCalls;
    },
    get buildpicCalls() {
      return state.buildpicCalls;
    },
    get asked() {
      return state.asked;
    },
    get modelBatches() {
      return state.modelBatches;
    },
    get models() {
      return state.modelBatches.flat();
    },
    get draws() {
      return state.draws;
    },
    get uploads() {
      return state.uploads;
    },
    get startedBy() {
      return state.startedBy;
    },
  };
}

const TARGET = {
  hubUrl: "https://hub.example",
  game: "bar",
  archive: "Beyond All Reason test-1",
  enginePath: "/engines/105",
  dataDir: "/data",
};

function unitsOf(count: number): BackfillUnit[] {
  return blueprintBackfillUnits(buildings(count), roster());
}

describe("which units a layout names", () => {
  /** The property the whole issue is about. */
  it("is the layout's own buildings and never the roster", () => {
    const units = unitsOf(12);
    expect(units).toHaveLength(12);
    expect(units.map((unit) => unit.name)).toEqual(
      Array.from({ length: 12 }, (_, at) => `unit${at}`),
    );
  });

  it("names one unit once, however many times the layout places it", () => {
    const units = blueprintBackfillUnits(
      [{ def: "unit3" }, { def: "Unit3" }, { def: "unit4" }],
      roster(),
    );
    expect(units.map((unit) => unit.name)).toEqual(["unit3", "unit4"]);
  });

  it("drops a unit this game has not got, rather than keying a picture for it", () => {
    expect(
      blueprintBackfillUnits([{ def: "somebody-elses-unit" }], roster()),
    ).toEqual([]);
  });

  it("drops a unit with no model to render", () => {
    const dataset: UnitDatasetEntry[] = [{ name: "armsolar" }];
    expect(blueprintBackfillUnits([{ def: "armsolar" }], dataset)).toEqual([]);
  });

  it("floors a missing footprint at one square, the way the engine does", () => {
    const dataset: UnitDatasetEntry[] = [
      { name: "armsolar", objectName: "armsolar.s3o" },
    ];
    expect(blueprintBackfillUnits([{ def: "armsolar" }], dataset)[0]).toEqual({
      name: "armsolar",
      objectName: "armsolar.s3o",
      footprintX: 1,
      footprintZ: 1,
    });
  });
});

describe("a run over one layout", () => {
  /**
   * The count that says this is not a roster walk. Twelve units named out of
   * five hundred and sixty four, and twelve of everything the run does.
   */
  it("does twelve units' work for a twelve unit layout in a 564 unit game", async () => {
    const watch = spy();
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(12),
      100,
      watch.tools,
    );

    expect(report.units).toBe(12);
    expect(report.asked).toBe(12);
    expect(report.rendered).toBe(12);
    expect(report.offered).toBe(24);
    expect(report.written).toBe(24);

    // And in requests rather than in the report's own words.
    expect(watch.asked).toHaveLength(1);
    expect(watch.asked[0]).toHaveLength(12);
    expect(watch.models).toHaveLength(12);
    expect(watch.uploads).toHaveLength(1);
    expect(watch.uploads[0]).toHaveLength(24);
  });

  /**
   * Issue #1690. Opening a layout is coilbox deciding to do this, not somebody
   * asking for it, and the door reports to the console rather than to a toast on
   * the strength of this word.
   */
  it("tells the upload that coilbox started it, not a person", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, watch.tools);

    expect(watch.startedBy).toEqual(["coilbox"]);
  });

  /**
   * One mount per question, not one per unit. The models one is issue #1684:
   * thirty units used to be thirty mounts on their own, a second or more each on
   * a game like Beyond All Reason.
   */
  it("reads the archive once for the keys, once for the build pics and once for the models", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(30), 100, watch.tools);
    expect(watch.renderKeyCalls).toBe(1);
    expect(watch.buildpicCalls).toBe(1);
    expect(watch.modelBatches).toHaveLength(1);
    expect(watch.modelBatches[0]).toHaveLength(30);
    expect(watch.asked).toHaveLength(1);
  });

  /** Two units on one model are one model read, since the batch is keyed on the
   *  `objectname` and a game's re-skins and wrecks all name the same file. */
  it("asks for one model however many units name it", async () => {
    const dataset: UnitDatasetEntry[] = [
      { name: "armsolar", objectName: "shared.s3o", footprintX: 2 },
      { name: "armwreck", objectName: "shared.s3o", footprintX: 3 },
    ];
    const watch = spy();
    const units = blueprintBackfillUnits(
      [{ def: "armsolar" }, { def: "armwreck" }],
      dataset,
    );
    await backfillBlueprintUnits(TARGET, units, 100, watch.tools);

    expect(watch.modelBatches).toEqual([["shared.s3o"]]);
    expect(watch.draws).toBe(2);
  });

  /**
   * The have check comes first, and that is what it is for: a layout whose
   * pictures the hub already holds costs one question and draws nothing.
   */
  it("draws nothing when the hub already has every render", async () => {
    const watch = spy({ hubHas: () => true });
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(12),
      100,
      watch.tools,
    );

    expect(report.asked).toBe(12);
    expect(report.rendered).toBe(0);
    expect(watch.draws).toBe(0);
    // And no mount for models either, which is what asking after the have check
    // rather than before it buys (issue #1684).
    expect(watch.modelBatches).toEqual([]);
  });

  /**
   * And when the hub has nothing at all either, nothing is uploaded. The build
   * pics are still extracted, because their identity cannot be known without
   * reading them, but a game that ships none means an empty run.
   */
  it("uploads nothing at all when there is nothing to send", async () => {
    const watch = spy({ hubHas: () => true, shipsBuildpic: () => false });
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(12),
      100,
      watch.tools,
    );

    expect(report.offered).toBe(0);
    expect(report.written).toBe(0);
    expect(watch.draws).toBe(0);
    expect(watch.uploads).toEqual([]);
  });

  it("draws only the renders the hub said it wanted", async () => {
    const watch = spy({ hubHas: (unit) => unit !== "unit5" });
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(12),
      100,
      watch.tools,
    );

    expect(report.rendered).toBe(1);
    expect(watch.models).toEqual(["unit5.s3o"]);
  });

  it("asks about a unit whose model could not be read at all", async () => {
    const watch = spy({ modelless: (unit) => unit === "unit2" });
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(12),
      100,
      watch.tools,
    );

    expect(report.asked).toBe(11);
    expect(report.rendered).toBe(11);
    // The build pic still goes, because it does not need the model.
    expect(report.offered).toBe(23);
  });

  it("sends a unit key with the game's shortname and the source hash it asked with", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(2), 100, watch.tools);

    expect(watch.asked[0][0]).toEqual({
      keyed_on: "unit",
      game: "bar",
      unit_name: "unit0",
      variant: "render:top",
      source_hash: "render-src-unit0",
    });
    const sent = watch.uploads[0];
    expect(sent.map((asset) => asset.variant).sort()).toEqual([
      "buildpic",
      "buildpic",
      "render:top",
      "render:top",
    ]);
    expect(
      sent.every((asset) => asset.keyed_on === "unit" && asset.game === "bar"),
    ).toBe(true);
  });
});

describe("the rate limit's say", () => {
  it("does nothing at all when the game has none of the hour left", async () => {
    const watch = spy();
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(12),
      0,
      watch.tools,
    );

    expect(report).toMatchObject({ units: 0, asked: 0, rendered: 0 });
    expect(report.stopped).toContain("bar");
    expect(watch.renderKeyCalls).toBe(0);
    expect(watch.buildpicCalls).toBe(0);
    expect(watch.asked).toEqual([]);
    expect(watch.uploads).toEqual([]);
  });

  /** Applied before anything is read, so the work saved is the work itself and
   *  not a list trimmed after it was done. */
  it("cuts the unit list before it reads or draws anything", async () => {
    const watch = spy();
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(30),
      4,
      watch.tools,
    );

    expect(report.units).toBe(4);
    expect(report.asked).toBe(4);
    expect(report.rendered).toBe(4);
    expect(report.offered).toBe(8);
    expect(watch.asked[0]).toHaveLength(4);
    expect(watch.models).toHaveLength(4);
    expect(report.stopped).toContain("4 of this layout's 30");
  });
});

describe("lining the answers up", () => {
  const keys: AssetKey[] = [
    {
      keyed_on: "unit",
      game: "bar",
      unit_name: "a",
      variant: "render:top",
      source_hash: "x",
    },
    {
      keyed_on: "unit",
      game: "bar",
      unit_name: "b",
      variant: "render:top",
      source_hash: "y",
    },
  ];

  it("wants what is not already held", () => {
    expect(
      unitsWanted(keys, [
        { ...keys[0], status: "have" },
        { ...keys[1], status: "changed" },
      ]),
    ).toEqual(["b"]);
  });

  /** Guessing which answer belongs to which key would draw the wrong pictures,
   *  so an answer that does not cover the batch draws none. */
  it("draws nothing when the answers do not cover the keys", () => {
    expect(unitsWanted(keys, [{ ...keys[0], status: "missing" }])).toEqual([]);
  });
});
