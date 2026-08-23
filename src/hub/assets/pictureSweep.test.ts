import { describe, expect, it, vi } from "vitest";

import type { GameItem, UnitDatasetEntry } from "@/content/bindings";
import type { BackfillReport, BackfillUnit } from "./blueprintBackfill";
import type { AssetKey, HaveResult } from "./have";
import {
  type PictureSweepProgress,
  type PictureSweepTools,
  pictureSweepSummary,
  rosterUnits,
  sweepGamePictures,
  unitsWithGaps,
} from "./pictureSweep";
import { RENDER_ANGLES, renderVariant } from "./vocabulary";

/**
 * The sweep is a survey and then a fill, and what these assert is the join
 * between the two: that the allowance is spent on units the hub is missing
 * rather than on the first however many of the roster.
 *
 * That is the whole of why pressing the button twice does anything. Cutting the
 * roster before asking takes the same sixteen units every run, hears that the hub
 * has them, writes nothing, and never reaches the seventeenth.
 */

const ANGLES = RENDER_ANGLES.length;

const TARGET = {
  hubUrl: "https://hub.example",
  enginePath: "/engines/105",
  dataDir: "/data",
};

/** A game unitsync reports, released and packaged so `gamesToSend` keeps it. */
function game(name: string, shortname: string): GameItem {
  return {
    name,
    primaryArchive: { name: `${name}.sdz`, path: `/games/${name}.sdz` },
    dependencyArchives: [],
    info: { shortname, version: "1.0" },
  } as GameItem;
}

/** A roster of `count` units, all with models. */
function roster(count: number): UnitDatasetEntry[] {
  return Array.from({ length: count }, (_, at) => ({
    name: `unit${at}`,
    objectName: `unit${at}.s3o`,
    footprintX: 2,
    footprintZ: 3,
  }));
}

interface Watch {
  tools: PictureSweepTools;
  /** The unit list each fill was handed, and what it was allowed to spend. */
  fills: { game: string; units: string[]; affordable: number }[];
  /** Every set of build pics sent, by the units they were of, so the ordering
   *  can be seen rather than inferred (issue #1953). */
  picsSent: string[][];
  /** The units each build pic extraction was asked for. */
  picsRead: string[][];
  /** What each caller was told about build pics, so a second extraction shows. */
  fillWantedPics: (boolean | undefined)[];
  /** What each fill reported as written, so the ledger side can be seen. */
  recorded: { game: string; written: number }[];
  asked: AssetKey[][];
  startedBy: string[];
  progress: PictureSweepProgress[];
}

function watcher(
  options: {
    games?: GameItem[];
    dataset?: (archive: string) => UnitDatasetEntry[];
    /** Which units the hub already holds every picture of. */
    hubHas?: (unit: string) => boolean;
    /** Which units the hub already holds the build pic of. Separate from
     *  `hubHas`, which is about renders. */
    hubHasPic?: (unit: string) => boolean;
    /** Which units the game ships a build pic for at all. */
    shipsPic?: (unit: string) => boolean;
    affordable?: number;
    /** Writes left in the hour, which is what the build pic pass counts in. */
    writesLeft?: number;
    /** Units the fill claims to have covered. Defaults to all it was given. */
    covered?: (units: readonly BackfillUnit[]) => number;
  } = {},
): Watch {
  const games = options.games ?? [game("Balanced Annihilation", "ba")];
  const dataset = options.dataset ?? (() => roster(10));
  const hubHas = options.hubHas ?? (() => false);
  const hubHasPic = options.hubHasPic ?? (() => false);
  const shipsPic = options.shipsPic ?? (() => true);
  const affordable = options.affordable ?? 100;
  const writesLeft = options.writesLeft ?? 500;
  const covered = options.covered ?? ((units) => units.length);

  const watch: Watch = {
    fills: [],
    picsSent: [],
    picsRead: [],
    fillWantedPics: [],
    recorded: [],
    asked: [],
    startedBy: [],
    progress: [],
    tools: undefined as never,
  };

  watch.tools = {
    releases: async () => ({ md5s: [], errors: [] }) as never,
    scan: async () => ({ games, maps: [], errors: [] }) as never,
    dataset: async ({ gameArchive }) =>
      ({ units: dataset(gameArchive), errors: [] }) as never,
    renderKeys: async ({ units }) => {
      const keys: Record<string, unknown> = {};
      for (const unit of units) {
        keys[unit.unit] = Object.fromEntries(
          RENDER_ANGLES.map((angle) => [
            renderVariant(angle),
            {
              objectName: unit.object,
              sourceMember: `objects3d/${unit.object}`,
              modelDigest: `model-${unit.unit}`,
              variant: renderVariant(angle),
              rendererVersion: 1,
              footprintX: unit.footprintX,
              footprintZ: unit.footprintZ,
              widthPx: 128,
              heightPx: 128,
              sourceHash: `src-${unit.unit}-${angle}`,
            },
          ]),
        );
      }
      return {
        keys,
        sourceArchive: "BA V15",
        skipped: {},
        errors: [],
      } as never;
    },
    ask: async (_hubUrl, keys) => {
      watch.asked.push(keys);
      return keys.map((key): HaveResult => {
        const held =
          key.keyed_on === "unit" &&
          (key.variant === "buildpic"
            ? hubHasPic(key.unit_name)
            : hubHas(key.unit_name));
        return { ...key, status: held ? "have" : "missing" } as HaveResult;
      });
    },
    buildpics: async ({ units }) => {
      watch.picsRead.push([...units]);
      const out: Record<string, unknown> = {};
      for (const unit of units) {
        out[unit] = shipsPic(unit)
          ? {
              asset: {
                variant: "buildpic",
                origin: "extracted",
                sourceArchive: "BA V15",
                path: `/cache/${unit}.webp`,
                hash: `hash-${unit}`,
                sourceHash: `pic-src-${unit}`,
                sourceMember: `unitpics/${unit}.dds`,
                encodeProfile: "webp-lossless-256",
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
    upload: async (_hubUrl, assets) => {
      watch.picsSent.push(
        assets.map((asset) =>
          asset.keyed_on === "unit" ? asset.unit_name : "",
        ),
      );
      return { outcomes: [], written: assets.length, error: null };
    },
    writesLeft: () => writesLeft,
    affordable: () => affordable,
    fill: async (target, units, allowed): Promise<BackfillReport> => {
      watch.fills.push({
        game: target.game,
        units: units.map((unit) => unit.name),
        affordable: allowed,
      });
      watch.startedBy.push(target.startedBy);
      watch.fillWantedPics.push(target.buildpics);
      const did = Math.min(covered(units), allowed);
      return {
        units: did,
        asked: units.length * ANGLES,
        rendered: did * ANGLES,
        offered: did * (ANGLES + 1),
        written: did * (ANGLES + 1),
      };
    },
    backfill: undefined as never,
    record: (game, written) => {
      watch.recorded.push({ game, written });
    },
  };

  return watch;
}

const run = (watch: Watch) =>
  sweepGamePictures(TARGET, (p) => watch.progress.push(p), watch.tools);

describe("which units a roster sweep works on", () => {
  it("takes every unit in the game that has a model", () => {
    const units = rosterUnits([
      { name: "armsolar", objectName: "armsolar.s3o", footprintX: 2 },
      { name: "armcom", objectName: "armcom.s3o" },
      // No model, so no picture can be made and no key should be minted.
      { name: "armnothing" },
    ]);

    expect(units.map((unit) => unit.name)).toEqual(["armsolar", "armcom"]);
    // The engine floors a footprint at one square, and so does this.
    expect(units[1]).toEqual({
      name: "armcom",
      objectName: "armcom.s3o",
      footprintX: 1,
      footprintZ: 1,
    });
  });

  it("counts a unit named twice once", () => {
    expect(
      rosterUnits([
        { name: "armsolar", objectName: "a.s3o" },
        { name: "ARMSOLAR", objectName: "a.s3o" },
      ]),
    ).toHaveLength(1);
  });

  /** One missing angle is enough. A unit whose four the hub holds is not work,
   *  and a unit missing one of them is. */
  it("wants a unit the hub is missing any one picture of", () => {
    const units = rosterUnits(roster(3));
    expect(
      unitsWithGaps(units, ["unit1\nrender:angled"]).map((unit) => unit.name),
    ).toEqual(["unit1"]);
    expect(unitsWithGaps(units, [])).toEqual([]);
  });
});

describe("a sweep over the installed games", () => {
  /**
   * The point of the whole file. The hub holding the first forty units must not
   * stop the sweep reaching the forty first, which is what cutting the roster
   * before the question would do.
   */
  it("spends the allowance on units the hub is missing, not on the first few", async () => {
    const watch = watcher({
      dataset: () => roster(50),
      // The hub has every render except the last five, and every build pic.
      hubHas: (unit) => Number(unit.replace("unit", "")) < 45,
      hubHasPic: () => true,
      affordable: 3,
    });
    const report = await run(watch);

    expect(watch.fills).toHaveLength(1);
    // Handed the five it is missing, and told it may do three of them. Not
    // unit0, which the hub already has.
    expect(watch.fills[0].units).toEqual([
      "unit45",
      "unit46",
      "unit47",
      "unit48",
      "unit49",
    ]);
    expect(watch.fills[0].affordable).toBe(3);
    expect(report.games[0]).toMatchObject({
      shortname: "ba",
      units: 50,
      wanted: 5,
      covered: 3,
    });
  });

  /**
   * The whole of issue #1953. Eighty writes spent on build pics is eighty units
   * that have a picture. The same eighty spent on renders is sixteen units with
   * five each, and three hundred and sixty three still blank.
   */
  it("sends a whole roster's build pics before it draws anything", async () => {
    const watch = watcher({ dataset: () => roster(400), writesLeft: 80 });
    await run(watch);

    expect(watch.picsSent).toHaveLength(1);
    // Eighty units with a picture, rather than sixteen with five each.
    expect(watch.picsSent[0]).toHaveLength(80);
    expect(watch.picsSent[0][0]).toBe("unit0");
    // And the extraction covered the roster rather than the eighty, since which
    // eighty is not knowable until the hub has answered.
    expect(watch.picsRead[0]).toHaveLength(400);
  });

  /** The render pass must not extract them a second time: the hub was handed
   *  them a moment ago and would answer `have` to every one. */
  it("does not read the build pics again for the render pass", async () => {
    const watch = watcher({ dataset: () => roster(5) });
    await run(watch);

    expect(watch.picsRead).toHaveLength(1);
    expect(watch.fillWantedPics).toEqual([false]);
  });

  /**
   * The same progressive rule the render survey follows. Offering the first
   * eighty every run would find the hub already had them and write nothing for
   * ever, which is exactly the bug this ordering could have reintroduced.
   */
  it("sends build pics the hub is missing, not the first few of the roster", async () => {
    const watch = watcher({
      dataset: () => roster(50),
      hubHasPic: (unit) => Number(unit.replace("unit", "")) < 40,
      writesLeft: 5,
    });
    await run(watch);

    expect(watch.picsSent[0]).toEqual([
      "unit40",
      "unit41",
      "unit42",
      "unit43",
      "unit44",
    ]);
  });

  /** A game whose hour is gone sends none, and the units it could not reach are
   *  still counted as waiting rather than quietly dropped. */
  it("sends no build pics when the hour is spent, and still counts them", async () => {
    const watch = watcher({
      dataset: () => roster(6),
      writesLeft: 0,
      // Renders are all held, so the build pics are the only gap left.
      hubHas: () => true,
    });
    const report = await run(watch);

    expect(watch.picsSent).toEqual([]);
    expect(report.games[0]).toMatchObject({ units: 6, wanted: 6, covered: 0 });
  });

  /** A unit the game ships no build pic for is not a gap, so it must not be
   *  counted as one and must not stop the renders. */
  it("passes over a unit the game ships no build pic for", async () => {
    const watch = watcher({
      dataset: () => roster(4),
      shipsPic: (unit) => unit !== "unit2",
      hubHas: () => true,
    });
    const report = await run(watch);

    expect(watch.picsSent[0]).toEqual(["unit0", "unit1", "unit3"]);
    expect(report.games[0]).toMatchObject({ wanted: 3, covered: 3 });
  });

  /** Asked about before anything is drawn, which is what makes the count real
   *  rather than a guess at what the hub might be missing. */
  it("asks the hub about every picture of every unit", async () => {
    const watch = watcher({ dataset: () => roster(6) });
    await run(watch);

    // Two questions, in the order the two passes run: the build pics, then
    // every angle of every unit.
    expect(watch.asked).toHaveLength(2);
    expect(watch.asked[0]).toHaveLength(6);
    expect(watch.asked[0].every((key) => key.variant === "buildpic")).toBe(
      true,
    );
    expect(watch.asked[1]).toHaveLength(6 * ANGLES);
    const first = watch.asked[1][0];
    expect(first.keyed_on === "unit" && first.game).toBe("ba");
  });

  /** The ordinary second run: nothing to do, no allowance spent, and it says so
   *  rather than looking like a failure. */
  it("does no work at all on a game the hub has covered", async () => {
    const watch = watcher({ hubHas: () => true, hubHasPic: () => true });
    const report = await run(watch);

    expect(watch.fills).toEqual([]);
    expect(watch.picsSent).toEqual([]);
    expect(watch.recorded).toEqual([]);
    expect(report.games[0]).toMatchObject({ units: 10, wanted: 0, covered: 0 });
    expect(pictureSweepSummary(report)).toContain("already has a picture");
  });

  /** Reported to the person who pressed the button, not filed in the bell
   *  (issue #1952). */
  it("tells the fill that a person started it", async () => {
    const watch = watcher();
    await run(watch);

    expect(watch.startedBy).toEqual(["user"]);
  });

  /** The ledger is what the next hour reads, so a run that wrote has to say so
   *  or the limit stops biting. */
  it("charges what the hub took against the game's hour", async () => {
    const watch = watcher({ dataset: () => roster(4) });
    await run(watch);

    // Once for the build pics and once for the renders, because they are two
    // uploads and the second one's allowance has to see the first one's spend.
    expect(watch.recorded).toEqual([
      { game: "ba", written: 4 },
      { game: "ba", written: 4 * (ANGLES + 1) },
    ]);
  });

  /** A game with none of its hour left is not read, drawn or sent, and the
   *  sentence says which game rather than leaving somebody guessing. */
  it("stops at a game whose hour is spent", async () => {
    const watch = watcher({ affordable: 0 });
    const report = await run(watch);

    expect(watch.fills).toEqual([]);
    expect(report.games[0].stopped).toContain("ba");
  });

  /**
   * Every game, and one that falls over does not take the others with it. A
   * library is nine games here and a failure in the third says nothing about the
   * fourth.
   */
  it("carries on to the next game when one falls over", async () => {
    const watch = watcher({
      games: [game("Alpha", "a"), game("Beta", "b"), game("Gamma", "c")],
    });
    const dataset = watch.tools.dataset;
    watch.tools.dataset = async (input) => {
      if (input.gameArchive.startsWith("Beta"))
        throw new Error("would not mount");
      return dataset(input);
    };
    const report = await run(watch);

    expect(report.games.map((one) => one.shortname)).toEqual(["a", "c"]);
    expect(report.failed).toEqual([{ game: "Beta", said: "would not mount" }]);
  });

  /** A working folder is somebody's half finished checkout, and the rule about
   *  which games are ours to publish is the game facts sweep's rule. */
  it("leaves a loose working folder out", async () => {
    const loose = game("SplinterFaction", "sf");
    loose.primaryArchive = {
      name: "SplinterFaction.sdd",
      path: "/games/SplinterFaction.sdd",
    } as GameItem["primaryArchive"];
    const watch = watcher({ games: [loose] });
    const report = await run(watch);

    expect(report.games).toEqual([]);
    expect(report.skipped).toEqual([
      { game: "SplinterFaction", reason: "development-folder" },
    ]);
    expect(watch.asked).toEqual([]);
  });

  it("says which game it is on as it goes", async () => {
    const watch = watcher({
      games: [game("Alpha", "a"), game("Beta", "b")],
    });
    await run(watch);

    const named = watch.progress.filter((one) => one.game);
    expect(named.map((one) => one.game)).toContain("Beta");
    expect(named.every((one) => one.total === 2)).toBe(true);
  });
});

describe("what a sweep is said to have done", () => {
  it("says how many are left, since that is what says to press it again", () => {
    expect(
      pictureSweepSummary({
        found: 1,
        games: [
          {
            game: "BA",
            shortname: "ba",
            units: 50,
            wanted: 20,
            covered: 3,
            written: 15,
          },
        ],
        skipped: [],
        failed: [],
        errors: [],
      }),
    ).toBe(
      "Sent 15 pictures. 17 more units are still waiting. Press it again later to carry on.",
    );
  });

  it("says so plainly when a library has no released games in it", () => {
    expect(
      pictureSweepSummary({
        found: 2,
        games: [],
        skipped: [],
        failed: [],
        errors: [],
      }),
    ).toContain("no released games");
  });

  it("says nothing was found when nothing is installed", () => {
    expect(
      pictureSweepSummary({
        found: 0,
        games: [],
        skipped: [],
        failed: [],
        errors: [],
      }),
    ).toBe("Coilbox found no games to draw.");
  });
});

/** The live tool set is what the button uses, so a missing wire is a run that
 *  cannot happen rather than a test that fails. */
it("wires every tool a sweep needs", async () => {
  const { livePictureSweepTools } = await import("./pictureSweep");
  for (const [name, tool] of Object.entries(livePictureSweepTools)) {
    expect(tool, name).toBeDefined();
  }
  expect(vi.isMockFunction(livePictureSweepTools.scan)).toBe(false);
});
