import { beforeEach, describe, expect, it, vi } from "vitest";

/** Everything the run filed in the bell without showing it (issue #1703), which
 *  is where a stopped run lands (issue #1686). */
const recorded: { title: string; body: string; to?: string }[] = [];
vi.mock("@/notify/notify", () => ({
  notify: async () => {},
  recordQuietly: (input: { title: string; body: string; to?: string }) => {
    recorded.push(input);
  },
}));

/** What `hub_upload_cancel` was handed. The fake upload below is what a run
 *  actually calls, so this only fires when the stop reaches the plugin. */
const cancelled: unknown[] = [];
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      if (command === "hub_upload_cancel") cancelled.push(args);
      return {};
    },
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((sample: unknown) => void) | null = null;
  },
}));

import type { LocalRender, UnitDatasetEntry } from "@/content/bindings";
import {
  type BackfillTools,
  type BackfillUnit,
  backfillBlueprintUnits,
  blueprintBackfillUnits,
  unitsWanted,
} from "./blueprintBackfill";
import type { AssetKey, HaveResult, HaveStatus } from "./have";
import {
  forgetRunningUploads,
  type RunningUpload,
  readRunningUploads,
  stopUploadRun,
  uploadRunStopping,
} from "./runningUploads";
import type { AssetUpload, AssetUploadProgress } from "./upload";

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
  /** The id each run made itself cancellable by, and whether it offered a
   *  progress channel at all (issue #1686). */
  uploadOpIds: (string | undefined)[];
  uploadReported: boolean[];
  /** What the topbar held at each moment a picture was drawn, so a test can see
   *  the run while it is going rather than only after it. */
  shownWhileDrawing: RunningUpload[][];
  /** The units each lookup of this machine\'s own renders asked about, and what
   *  archive it named, so a test can see the local check happen (issue #1724). */
  heldAsks: { units: string[]; sourceArchive?: string }[];
  /** Every render written down after it was drawn, in order. */
  remembered: { unit: string; sourceHash: string }[];
  /** What each encode was handed, so a test can see whether the key it was named
   *  by came with it (issue #1720). */
  encodes: {
    object: string;
    modelDigest?: string;
    sourceMember?: string;
    sourceArchive?: string;
  }[];
}

/** A tool set that answers everything, with knobs for the two things a test
 *  varies: what the hub already has, and which units ship a build pic. */
function spy(
  options: {
    hubHas?: (unit: string) => boolean;
    shipsBuildpic?: (unit: string) => boolean;
    modelless?: (unit: string) => boolean;
    /** Run before each draw, given how many have been drawn already. Where a
     *  test presses stop partway through the drawing half. */
    beforeDraw?: (drawn: number) => void | Promise<void>;
    /** Run inside the upload, given the progress channel the run handed over.
     *  Where a test presses stop partway through the sending half. */
    whileSending?: (
      report: (sample: AssetUploadProgress) => void,
    ) => void | Promise<void>;
    /** How many of the set the fake hub took, when the run was stopped partway.
     *  Defaults to all of them. */
    takes?: (assets: AssetUpload[]) => number;
    /** What this machine already drew, by unit name. Defaults to nothing, which is
     *  a machine that has never rendered anything (issue #1724). */
    alreadyDrawn?: (unit: string) => LocalRender | undefined;
  } = {},
): Spy {
  const hubHas = options.hubHas ?? (() => false);
  const shipsBuildpic = options.shipsBuildpic ?? (() => true);
  const modelless = options.modelless ?? (() => false);
  const takes = options.takes ?? ((assets: AssetUpload[]) => assets.length);
  const alreadyDrawn = options.alreadyDrawn ?? (() => undefined);

  const state = {
    renderKeyCalls: 0,
    buildpicCalls: 0,
    asked: [] as AssetKey[][],
    modelBatches: [] as string[][],
    draws: 0,
    uploads: [] as AssetUpload[][],
    startedBy: [] as string[],
    uploadOpIds: [] as (string | undefined)[],
    uploadReported: [] as boolean[],
    shownWhileDrawing: [] as RunningUpload[][],
    encodes: [] as Spy["encodes"],
    heldAsks: [] as Spy["heldAsks"],
    remembered: [] as Spy["remembered"],
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
      return {
        keys,
        sourceArchive: "Beyond All Reason test-1",
        skipped: {},
        errors: [],
      } as never;
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
      await options.beforeDraw?.(state.draws);
      state.draws += 1;
      state.shownWhileDrawing.push(
        readRunningUploads().map((run) => ({ ...run })),
      );
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
    encodeRender: async ({
      object,
      modelDigest,
      sourceMember,
      sourceArchive,
    }) => {
      state.encodes.push({ object, modelDigest, sourceMember, sourceArchive });
      return {
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
      };
    },
    held: async (_game, _variant, _version, units, sourceArchive) => {
      state.heldAsks.push({ units: [...units], sourceArchive });
      const found = new Map<string, LocalRender>();
      for (const unit of units) {
        const render = alreadyDrawn(unit);
        if (render) found.set(unit.toLowerCase(), render);
      }
      return found;
    },
    remember: async (_game, unit, asset) => {
      state.remembered.push({ unit, sourceHash: asset.sourceHash });
    },
    upload: async (_hubUrl, assets, given) => {
      state.uploads.push(assets);
      state.startedBy.push(given.startedBy);
      state.uploadOpIds.push(given.opId);
      state.uploadReported.push(Boolean(given.onProgress));
      await options.whileSending?.(given.onProgress ?? (() => {}));
      return { outcomes: [], written: takes(assets), error: null };
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
    get uploadOpIds() {
      return state.uploadOpIds;
    },
    get uploadReported() {
      return state.uploadReported;
    },
    get shownWhileDrawing() {
      return state.shownWhileDrawing;
    },
    get encodes() {
      return state.encodes;
    },
    get heldAsks() {
      return state.heldAsks;
    },
    get remembered() {
      return state.remembered;
    },
  };
}

/**
 * One progress sample as the plugin sends them, of which a test varies a field or
 * two. `wanted` is the one the topbar reads: null until the upload's have check
 * has answered, and how many pictures are really going from then on.
 */
function progress(
  patch: Partial<AssetUploadProgress> = {},
): AssetUploadProgress {
  return {
    phase: "uploading",
    done: 0,
    total: 12,
    percent: 0,
    uploaded: 0,
    alreadyHad: 0,
    refused: 0,
    uploadedBytes: 0,
    subject: null,
    wanted: null,
    ...patch,
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

beforeEach(() => {
  forgetRunningUploads();
  recorded.length = 0;
  cancelled.length = 0;
});

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

  /**
   * Issue #1720. The keys call already read every one of these models, so the
   * encode is handed what it would otherwise mount the game's archive set to work
   * out again: twenty buildings were twenty mounts on top of everything else.
   *
   * Each unit gets its own key rather than any key, which is the mis-wiring the
   * worker used to make impossible by computing the identity itself. That check
   * now lives here.
   */
  it("hands each encode the key its own unit was named by", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(20), 100, watch.tools);

    expect(watch.encodes).toHaveLength(20);
    for (const encode of watch.encodes) {
      const unit = encode.object.replace(/\.s3o$/, "");
      expect(encode.modelDigest).toBe(`model-${unit}`);
      expect(encode.sourceMember).toBe(`objects3d/${unit}.s3o`);
      expect(encode.sourceArchive).toBe("Beyond All Reason test-1");
    }
    // Every unit once, so no unit's key was handed to another unit's picture.
    expect(new Set(watch.encodes.map((e) => e.modelDigest)).size).toBe(20);
  });

  /**
   * The three travel together or not at all. A batch whose mount failed names no
   * archive, and two thirds of a key is refused rather than mounted for, so the
   * encode has to be left to work the whole thing out for itself.
   */
  it("hands down nothing at all when the batch could not name the archive", async () => {
    const watch = spy();
    const keys = watch.tools.renderKeys;
    watch.tools.renderKeys = async (input) => {
      const out = await keys(input);
      return { ...out, sourceArchive: undefined };
    };
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, watch.tools);

    expect(watch.encodes).toHaveLength(3);
    for (const encode of watch.encodes) {
      expect(encode.modelDigest).toBeUndefined();
      expect(encode.sourceMember).toBeUndefined();
      expect(encode.sourceArchive).toBeUndefined();
    }
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

describe("a render this machine already drew (issue #1724)", () => {
  /** One record in the shape the index answers with, for `unit`. */
  const drawn = (
    unit: string,
    patch: Partial<LocalRender> = {},
  ): LocalRender => ({
    game: "bar",
    unit,
    variant: "render:top",
    file: `render-hash-${unit}.s3o.webp`,
    path: `/cache/hub/render-hash-${unit}.webp`,
    mime: "image/webp",
    encodeProfile: "webp-q80-512",
    sourceHash: `render-src-${unit}`,
    modelDigest: `model-${unit}`,
    sourceArchive: "Beyond All Reason test-1",
    rendererVersion: 1,
    width: 128,
    height: 192,
    ...patch,
  });

  /**
   * The whole point of keeping one. A run that drew a picture and then failed to
   * send it used to draw the lot again next time, because the file is named after
   * its own bytes and nothing said which unit it was of.
   */
  it("is offered to the hub without being drawn again", async () => {
    const watch = spy({ alreadyDrawn: (unit) => drawn(unit) });
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(4),
      100,
      watch.tools,
    );

    expect(watch.draws).toBe(0);
    expect(report.rendered).toBe(0);
    // Still four renders and four build pics offered, so nothing was lost by not
    // drawing them.
    expect(report.offered).toBe(8);
    const renders = watch.uploads[0].filter((a) => a.origin === "rendered");
    expect(renders).toHaveLength(4);
    expect(renders[0].path).toBe("/cache/hub/render-hash-unit0.webp");
    expect(renders[0].source_hash).toBe("render-src-unit0");
    // And no models were mounted for, because nothing needed drawing.
    expect(watch.models).toHaveLength(0);
  });

  /**
   * The check that keeps a stale picture out. The key was worked out against the
   * archive a moment ago, so a game update is a different `sourceHash` and the old
   * picture must not go up under the new identity.
   */
  it("is drawn again when the game has moved under it", async () => {
    const watch = spy({
      alreadyDrawn: (unit) => drawn(unit, { sourceHash: "render-src-old" }),
    });
    await backfillBlueprintUnits(TARGET, unitsOf(4), 100, watch.tools);

    expect(watch.draws).toBe(4);
    const renders = watch.uploads[0].filter((a) => a.origin === "rendered");
    expect(renders.map((a) => a.source_hash)).toEqual([
      "render-src-unit0.s3o",
      "render-src-unit1.s3o",
      "render-src-unit2.s3o",
      "render-src-unit3.s3o",
    ]);
  });

  /** Asked for the archive the keys call reported, so the lookup can refuse a
   *  render of a different build without anybody mounting anything again. */
  it("is looked for under the archive the keys were taken against", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, watch.tools);

    expect(watch.heldAsks).toHaveLength(1);
    expect(watch.heldAsks[0].sourceArchive).toBe("Beyond All Reason test-1");
    expect(watch.heldAsks[0].units).toEqual(["unit0", "unit1", "unit2"]);
  });

  /** Only the units something is going to be done about. A layout the hub already
   *  holds every render of asks this nothing either. */
  it("is not looked for at all when the hub holds every render", async () => {
    const watch = spy({ hubHas: () => true });
    await backfillBlueprintUnits(TARGET, unitsOf(5), 100, watch.tools);

    expect(watch.heldAsks[0].units).toEqual([]);
    expect(watch.draws).toBe(0);
  });

  /** Written down as it is drawn, so the next run finds it. Before the upload
   *  rather than after, because a run that failed to send is the case this is
   *  for. */
  it("is written down for every render the run draws", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, watch.tools);

    expect(watch.remembered).toEqual([
      { unit: "unit0", sourceHash: "render-src-unit0.s3o" },
      { unit: "unit1", sourceHash: "render-src-unit1.s3o" },
      { unit: "unit2", sourceHash: "render-src-unit2.s3o" },
    ]);
  });

  /**
   * Stopping partway sends nothing, and every picture that was drawn is still
   * kept: it is on this machine and costs nobody anything, and next time is the
   * run that gets to send it.
   *
   * Three rather than two, because the stop is read between pictures and the one
   * already in flight finishes.
   */
  it("is kept for the pictures drawn before somebody pressed stop", async () => {
    const watch = spy({
      beforeDraw: (drawnSoFar) => {
        if (drawnSoFar === 2) {
          stopUploadRun(readRunningUploads()[0].opId);
        }
      },
    });
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(6),
      100,
      watch.tools,
    );

    expect(report.written).toBe(0);
    expect(watch.remembered.map((r) => r.unit)).toEqual([
      "unit0",
      "unit1",
      "unit2",
    ]);
  });
});

describe("a game in a loose working folder (issue #1890)", () => {
  /** The same target, installed as the folder somebody edits rather than as the
   *  release they hand out. SplinterFaction is installed both ways here. */
  const LOOSE = { ...TARGET, archive: "SplinterFaction.sdd" };

  /**
   * The half the issue is about. A `.sdd` is somebody's half finished checkout
   * and a shared hub every other player reads from does not get it.
   */
  it("sends the hub nothing at all, and does not even ask", async () => {
    const watch = spy();
    const report = await backfillBlueprintUnits(
      LOOSE,
      unitsOf(4),
      100,
      watch.tools,
    );

    expect(watch.uploads).toEqual([]);
    expect(watch.asked).toEqual([]);
    // A have check is itself a request carrying this machine's archive hashes.
    expect(report.asked).toBe(0);
    expect(report.offered).toBe(0);
    expect(report.written).toBe(0);
    // And no build pics were extracted, because the only reason to encode one is
    // to upload it.
    expect(watch.buildpicCalls).toBe(0);
  });

  /**
   * The other half, and the one an over-broad filter breaks. Somebody developing
   * a game wants to see their own work in coilbox, which is the whole reason for
   * working in a folder at all.
   */
  it("still draws its pictures and writes them down for the app to show", async () => {
    const watch = spy();
    const report = await backfillBlueprintUnits(
      LOOSE,
      unitsOf(4),
      100,
      watch.tools,
    );

    expect(watch.draws).toBe(4);
    expect(report.rendered).toBe(4);
    // Written down under the unit they are of, which is what `localRenders`
    // reads back so a plan draws its buildings rather than squares.
    expect(watch.remembered.map((r) => r.unit)).toEqual([
      "unit0",
      "unit1",
      "unit2",
      "unit3",
    ]);
  });

  /** Drawing is the slow half, so a picture this machine already has is not
   *  drawn again just because nothing is going anywhere. */
  it("does not redraw a render this machine already holds", async () => {
    const watch = spy({
      alreadyDrawn: (unit) =>
        unit === "unit0"
          ? {
              game: "bar",
              unit,
              variant: "render:top",
              file: `render-hash-${unit}.s3o.webp`,
              path: `/cache/hub/render-hash-${unit}.webp`,
              mime: "image/webp",
              encodeProfile: "webp-q80-512",
              sourceHash: `render-src-${unit}`,
              modelDigest: `model-${unit}`,
              sourceArchive: "Beyond All Reason test-1",
              rendererVersion: 1,
              width: 128,
              height: 192,
            }
          : undefined,
    });
    const report = await backfillBlueprintUnits(
      LOOSE,
      unitsOf(4),
      100,
      watch.tools,
    );

    expect(watch.draws).toBe(3);
    expect(report.rendered).toBe(3);
    // The one it held was not offered either, which is the point.
    expect(watch.uploads).toEqual([]);
  });

  /** A packed install of the same game is untouched, so the rule is about the
   *  format rather than about the game. */
  it("leaves a packed install of the same game sending as it always did", async () => {
    const watch = spy();
    const report = await backfillBlueprintUnits(
      { ...TARGET, archive: "SplinterFaction_0.1.80.sdz" },
      unitsOf(4),
      100,
      watch.tools,
    );

    expect(watch.asked).toHaveLength(1);
    expect(watch.uploads).toHaveLength(1);
    expect(report.offered).toBe(8);
  });

  /** A rapid pool install is a `.sdp` package somebody plays, and Beyond All
   *  Reason installs no other way. */
  it("leaves a rapid pool install alone", async () => {
    const watch = spy();
    await backfillBlueprintUnits(
      { ...TARGET, archive: "ded9b29714a05164e4b4523b09809af2.sdp" },
      unitsOf(4),
      100,
      watch.tools,
    );

    expect(watch.uploads).toHaveLength(1);
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

describe("what a run says about itself while it is going (issue #1686)", () => {
  /**
   * The ordinary case, and the reason there is a threshold at all. A layout of
   * twelve units whose pictures the hub already holds is a have check and an
   * archive read, and putting a pill in the topbar for that is noise.
   */
  it("stays silent for a run with nothing to draw", async () => {
    // Read inside the upload, which is the one moment such a run is doing
    // anything at all. Nothing is drawn, so there is no other moment to look.
    let shownWhileSending: readonly RunningUpload[] = [];
    const watch = spy({
      hubHas: () => true,
      whileSending: () => {
        shownWhileSending = readRunningUploads();
      },
    });
    await backfillBlueprintUnits(TARGET, unitsOf(12), 100, watch.tools);

    expect(watch.draws).toBe(0);
    expect(shownWhileSending).toEqual([]);
    // And the run still happened: the build pics went.
    expect(watch.uploads[0]).toHaveLength(12);
  });

  /** The case the issue is about: twelve model reads and twelve renders, which
   *  can be a minute with nothing on screen saying why. */
  it("puts a run with pictures to draw on screen, named by its game", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(12), 100, watch.tools);

    const first = watch.shownWhileDrawing[0];
    expect(first).toHaveLength(1);
    expect(first[0].game).toBe("bar");
    expect(first[0].phase).toBe("drawing");
    expect(first[0].total).toBe(12);
  });

  it("counts the pictures off as they are drawn", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(4), 100, watch.tools);

    expect(watch.shownWhileDrawing.map((shown) => shown[0].done)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("leaves the topbar when the run ends", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(4), 100, watch.tools);

    expect(readRunningUploads()).toEqual([]);
  });

  /** A run that threw has still finished, and a pill nothing will ever clear is
   *  worse than no pill. */
  it("leaves the topbar when the run falls over", async () => {
    const watch = spy();
    watch.tools.models = async () => {
      throw new Error("the archive would not mount");
    };
    await expect(
      backfillBlueprintUnits(TARGET, unitsOf(4), 100, watch.tools),
    ).rejects.toThrow("would not mount");

    expect(readRunningUploads()).toEqual([]);
  });

  /** #1636 passed neither, which is the whole of why a run could not be
   *  stopped. */
  it("makes the upload cancellable and asks it for progress", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, watch.tools);

    expect(watch.uploadOpIds[0]).toEqual(expect.any(String));
    expect(watch.uploadReported).toEqual([true]);
  });

  it("gives each run an id of its own", async () => {
    const first = spy();
    const second = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, first.tools);
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, second.tools);

    expect(first.uploadOpIds[0]).not.toBe(second.uploadOpIds[0]);
  });

  it("shows the sending half once the drawing is done", async () => {
    let sending: RunningUpload | undefined;
    const watch = spy({
      whileSending: () => {
        sending = readRunningUploads()[0];
      },
    });
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, watch.tools);

    expect(sending?.phase).toBe("sending");
    // Six pictures rather than three: a build pic and a render each.
    expect(sending?.total).toBe(6);
  });

  it("moves the sending half on from what the plugin reports", async () => {
    let midway: RunningUpload | undefined;
    const watch = spy({
      whileSending: (report) => {
        report(
          progress({
            done: 4,
            total: 6,
            percent: 66,
            uploaded: 3,
            alreadyHad: 1,
            uploadedBytes: 900,
            subject: "bar's unit1 buildpic",
            wanted: 5,
          }),
        );
        midway = readRunningUploads()[0];
      },
    });
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, watch.tools);

    expect(midway?.done).toBe(4);
    expect(midway?.sent).toBe(3);
  });
});

describe("a run that only has build pics to send (issue #1768)", () => {
  /**
   * The case #1767 left out. Every render is already on the hub so nothing is
   * drawn, and the build pics the hub has never seen go anyway. On a slow
   * connection that is minutes of upload with nothing on screen saying so and no
   * way to stop it.
   */
  it("goes on screen once the upload says the hub wants some", async () => {
    let shownWhileSending: RunningUpload[] = [];
    const watch = spy({
      hubHas: () => true,
      whileSending: (report) => {
        report(progress({ wanted: 12, total: 12, subject: "bar's unit0" }));
        shownWhileSending = readRunningUploads().map((run) => ({ ...run }));
      },
    });
    await backfillBlueprintUnits(TARGET, unitsOf(12), 100, watch.tools);

    expect(watch.draws).toBe(0);
    expect(shownWhileSending).toHaveLength(1);
    expect(shownWhileSending[0].game).toBe("bar");
    expect(shownWhileSending[0].phase).toBe("sending");
    expect(shownWhileSending[0].total).toBe(12);
  });

  /**
   * The hard constraint. A layout whose pictures the hub already holds is two
   * requests, and a pill in the topbar for that is noise. Neither the samples
   * before the have check has answered nor the answer that it wants none of them
   * may put one there.
   */
  it("stays silent when the hub wants none of what it was offered", async () => {
    let shownWhileSending: readonly RunningUpload[] = [];
    const watch = spy({
      hubHas: () => true,
      whileSending: (report) => {
        report(progress({ phase: "asking", total: 12 }));
        report(progress({ wanted: 0, total: 12, done: 12, alreadyHad: 12 }));
        shownWhileSending = readRunningUploads();
      },
    });
    await backfillBlueprintUnits(TARGET, unitsOf(12), 100, watch.tools);

    expect(shownWhileSending).toEqual([]);
    // And the run still happened: the build pics were offered.
    expect(watch.uploads[0]).toHaveLength(12);
  });

  /** The point of being on screen at all. A run nobody can stop is a run that
   *  only had to be watched. */
  it("can be stopped, and says so where the run reads it", async () => {
    let stopping = false;
    const watch = spy({
      hubHas: () => true,
      whileSending: async (report) => {
        report(progress({ wanted: 12, total: 12 }));
        const [run] = readRunningUploads();
        await stopUploadRun(run.opId);
        stopping = uploadRunStopping(run.opId);
      },
    });
    await backfillBlueprintUnits(TARGET, unitsOf(12), 100, watch.tools);

    expect(stopping).toBe(true);
    expect(cancelled).toEqual([{ opId: watch.uploadOpIds[0] }]);
  });

  /** Counted off from the plugin's own samples, the same as the sending half of
   *  a run that drew something. */
  it("counts the pictures off as the hub takes them", async () => {
    let midway: RunningUpload | undefined;
    const watch = spy({
      hubHas: () => true,
      whileSending: (report) => {
        report(progress({ wanted: 12, total: 12 }));
        report(progress({ wanted: 12, total: 12, done: 5, uploaded: 5 }));
        midway = readRunningUploads()[0];
      },
    });
    await backfillBlueprintUnits(TARGET, unitsOf(12), 100, watch.tools);

    expect(midway?.done).toBe(5);
    expect(midway?.sent).toBe(5);
    expect(readRunningUploads()).toEqual([]);
  });
});

describe("stopping a run that is going (issue #1686)", () => {
  /**
   * The proof that a stop stops the work rather than hiding it. Twelve units to
   * draw, stopped while the third is being drawn, and the run draws three. A
   * button that only cleared the pill would leave this at twelve.
   *
   * Three rather than two, because the flag is read between pictures: the one in
   * hand when the button is pressed is finished. That is the design, not a
   * rounding error, and unwinding a GL draw halfway through to save one render
   * is not worth the machinery.
   */
  it("stops drawing where it was told to, rather than running on", async () => {
    const watch = spy({
      beforeDraw: async (drawn) => {
        if (drawn === 2) await stopUploadRun(readRunningUploads()[0].opId);
      },
    });
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(12),
      100,
      watch.tools,
    );

    expect(watch.draws).toBe(3);
    expect(report.rendered).toBe(3);
  });

  /**
   * And nothing goes. The pictures drawn so far are in this machine's cache,
   * which costs nobody anything, and the build pics were extracted before the
   * hub was asked, so a stop while drawing has nothing to be honest about.
   */
  it("sends nothing at all when it was stopped while drawing", async () => {
    const watch = spy({
      beforeDraw: async (drawn) => {
        if (drawn === 2) await stopUploadRun(readRunningUploads()[0].opId);
      },
    });
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(12),
      100,
      watch.tools,
    );

    expect(watch.uploads).toEqual([]);
    expect(report.written).toBe(0);
    expect(recorded).toEqual([
      {
        title: "You stopped the picture uploads",
        body: "Coilbox has stopped sending pictures for bar. Nothing had been sent, so nothing was added to the hub.",
        level: "info",
        to: "/settings/hub",
      },
    ]);
  });

  /** The other half. `hub_upload_cancel` is what stops a run the plugin has
   *  already started, and nothing reached it before this. */
  it("asks the plugin to stop an upload it is in the middle of", async () => {
    const watch = spy({
      whileSending: async () => {
        await stopUploadRun(readRunningUploads()[0].opId);
      },
    });
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, watch.tools);

    expect(cancelled).toEqual([{ opId: watch.uploadOpIds[0] }]);
  });

  /**
   * A stop is not an undo. Three pictures reached the hub before the button was
   * pressed and they are on the hub, in a public repository, so the sentence
   * left behind says so and counts them.
   */
  it("says what had already gone when it was stopped while sending", async () => {
    const watch = spy({
      takes: () => 3,
      whileSending: async () => {
        await stopUploadRun(readRunningUploads()[0].opId);
      },
    });
    const report = await backfillBlueprintUnits(
      TARGET,
      unitsOf(3),
      100,
      watch.tools,
    );

    expect(report.written).toBe(3);
    expect(recorded).toEqual([
      {
        title: "You stopped the picture uploads",
        body: "Coilbox has stopped sending pictures for bar. 3 pictures had already gone, and they stay on the hub.",
        level: "info",
        to: "/settings/hub",
      },
    ]);
  });

  it("leaves nothing in the bell for a run nobody stopped", async () => {
    const watch = spy();
    await backfillBlueprintUnits(TARGET, unitsOf(3), 100, watch.tools);

    expect(recorded).toEqual([]);
  });

  it("takes a stopped run off the topbar", async () => {
    const watch = spy({
      beforeDraw: async (drawn) => {
        if (drawn === 1) await stopUploadRun(readRunningUploads()[0].opId);
      },
    });
    await backfillBlueprintUnits(TARGET, unitsOf(12), 100, watch.tools);

    expect(readRunningUploads()).toEqual([]);
  });
});
