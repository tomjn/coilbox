import { describe, expect, it } from "vitest";

import type { MapMinimapRow, MapMinimapsResult } from "@/content/bindings";
import type { AssetKey, HaveResult } from "../assets/have";
import {
  MAP_PICTURES_SUBJECT,
  type MapPictureSweepProgress,
  type MapPictureSweepTools,
  mapPictureSweepSummary,
  mapsTheHubHasNoPictureOf,
  minimapUpload,
  sweepMapPictures,
} from "./pictureSweep";

/**
 * The sweep is a survey and then an encode, and what these assert is the join
 * between the two: that the hour's allowance is spent on maps the hub is missing
 * rather than on the library's first however many.
 *
 * That is the whole of why pressing the button again carries on. Cutting the
 * library before asking takes the same eighty maps every run, hears that the hub
 * has them, sends nothing, and never reaches the eighty first.
 */

const TARGET = {
  hubUrl: "https://hub.example",
  enginePath: "/engines/105",
  dataDir: "/data",
};

/** One map as the survey pass reports it. */
function surveyed(name: string): MapMinimapRow {
  return {
    mapName: name,
    sourceHash: `src-${name}`,
    sourceArchive: name,
    mapWidth: 8192,
    mapHeight: 6144,
  };
}

/** The same map as the encode pass reports it, with a picture on it. */
function encoded(row: MapMinimapRow): MapMinimapRow {
  return {
    ...row,
    asset: {
      variant: "minimap",
      origin: "extracted",
      sourceArchive: row.sourceArchive,
      path: `/cache/${row.mapName}.webp`,
      hash: `bytes-${row.mapName}`,
      sourceHash: row.sourceHash,
      encodeProfile: "webp-q80-512",
      mime: "image/webp",
      width: 512,
      height: 512,
      bytes: 35458,
    },
  };
}

interface Watch {
  tools: MapPictureSweepTools;
  /** Every walk asked for, so a survey and an encode can be told apart. */
  walks: { maps?: string[]; assets?: boolean }[];
  asked: AssetKey[][];
  /** Every set of pictures offered, by the maps they were of. */
  sent: string[][];
  startedBy: string[];
  recorded: { subject: string; written: number }[];
  progress: MapPictureSweepProgress[];
}

function watcher(
  options: {
    library?: string[];
    /** Which maps the hub already has a picture of. */
    hubHas?: (map: string) => boolean;
    /** Which maps produce a picture when the encode pass runs. */
    encodes?: (map: string) => boolean;
    /** Writes left in the hour. */
    writesLeft?: number;
    /** Maps the survey found no picture in at all. */
    skipped?: MapMinimapsResult["skipped"];
  } = {},
): Watch {
  const library = options.library ?? ["Alpha", "Beta", "Gamma"];
  const hubHas = options.hubHas ?? (() => false);
  const encodes = options.encodes ?? (() => true);
  const writesLeft = options.writesLeft ?? 80;

  const watch: Watch = {
    tools: undefined as never,
    walks: [],
    asked: [],
    sent: [],
    startedBy: [],
    recorded: [],
    progress: [],
  };

  watch.tools = {
    minimaps: async ({ maps, assets }) => {
      watch.walks.push({ maps, assets });
      const names = maps ?? library;
      const rows = names.map(surveyed);
      return {
        maps: assets
          ? rows.filter((row) => encodes(row.mapName)).map(encoded)
          : rows,
        skipped: assets ? [] : (options.skipped ?? []),
        errors: [],
      };
    },
    ask: async (_hubUrl, keys): Promise<HaveResult[]> => {
      watch.asked.push(keys);
      return keys.map((key) => ({
        keyed_on: "map",
        map_name: key.keyed_on === "map" ? key.map_name : "",
        variant: key.variant,
        status:
          key.keyed_on === "map" && hubHas(key.map_name) ? "have" : "missing",
      }));
    },
    upload: async (_hubUrl, assets, options) => {
      watch.sent.push(
        assets.map((asset) => (asset.keyed_on === "map" ? asset.map_name : "")),
      );
      watch.startedBy.push(options.startedBy);
      return { outcomes: [], written: assets.length, error: null };
    },
    writesLeft: () => writesLeft,
    record: (subject, written) => {
      watch.recorded.push({ subject, written });
    },
  };

  return watch;
}

const run = (watch: Watch) =>
  sweepMapPictures(TARGET, (p) => watch.progress.push(p), watch.tools);

describe("which maps a sweep sends pictures of", () => {
  it("wants the ones the hub answered anything but have for", () => {
    const rows = ["Alpha", "Beta", "Gamma"].map(surveyed);
    const answers: HaveResult[] = [
      {
        keyed_on: "map",
        map_name: "Alpha",
        variant: "minimap",
        status: "have",
      },
      {
        keyed_on: "map",
        map_name: "Beta",
        variant: "minimap",
        status: "missing",
      },
      {
        keyed_on: "map",
        map_name: "Gamma",
        variant: "minimap",
        status: "changed",
      },
    ];

    expect(
      mapsTheHubHasNoPictureOf(rows, answers).map((row) => row.mapName),
    ).toEqual(["Beta", "Gamma"]);
  });

  /** Zipping by index is what the have check promises. A short answer cannot be
   *  lined up, and lining it up wrongly would send Alpha's picture as Beta's. */
  it("sends nothing at all when the answers cannot be lined up", () => {
    const rows = ["Alpha", "Beta"].map(surveyed);
    expect(mapsTheHubHasNoPictureOf(rows, [])).toEqual([]);
  });

  /** A map row is refused without both, and they are elmos rather than the
   *  picture's own square pixels. */
  it("puts the map's size in elmos on the upload", () => {
    const upload = minimapUpload(encoded(surveyed("Alpha")));
    expect(upload).toMatchObject({
      keyed_on: "map",
      map_name: "Alpha",
      variant: "minimap",
      source_hash: "src-Alpha",
      map_width: 8192,
      map_height: 6144,
      path: "/cache/Alpha.webp",
    });
  });

  it("offers nothing for a map that produced no picture", () => {
    expect(minimapUpload(surveyed("Alpha"))).toBeNull();
  });
});

describe("a sweep over the installed maps", () => {
  it("asks about every map before encoding any of them", async () => {
    const watch = watcher();
    const report = await run(watch);

    // The survey covers the library and takes no asset directory, so nothing was
    // encoded to ask the question.
    expect(watch.walks[0]).toEqual({ maps: undefined, assets: undefined });
    expect(watch.asked[0].map((key) => key.source_hash)).toEqual([
      "src-Alpha",
      "src-Beta",
      "src-Gamma",
    ]);
    expect(watch.asked[0][0]).toMatchObject({
      keyed_on: "map",
      map_name: "Alpha",
      variant: "minimap",
    });
    expect(report.read).toBe(3);
    expect(report.sent).toBe(3);
  });

  it("encodes only the maps the hub said it wanted", async () => {
    const watch = watcher({ hubHas: (map) => map !== "Beta" });
    const report = await run(watch);

    expect(watch.walks[1]).toEqual({ maps: ["Beta"], assets: true });
    expect(watch.sent).toEqual([["Beta"]]);
    expect(report.wanted).toBe(1);
    expect(report.sent).toBe(1);
    expect(report.left).toBe(0);
  });

  it("does not open the upload at all when the hub has every map", async () => {
    const watch = watcher({ hubHas: () => true });
    const report = await run(watch);

    expect(watch.walks).toHaveLength(1);
    expect(watch.sent).toEqual([]);
    expect(report.wanted).toBe(0);
    expect(report.left).toBe(0);
  });

  it("says the run was somebody's, so a refusal reaches them", async () => {
    const watch = watcher();
    await run(watch);
    expect(watch.startedBy).toEqual(["user"]);
  });

  it("charges what the hub took against one bucket for every map", async () => {
    const watch = watcher();
    await run(watch);
    expect(watch.recorded).toEqual([
      { subject: MAP_PICTURES_SUBJECT, written: 3 },
    ]);
  });

  it("counts a map the encode pass could not make a picture of as still waiting", async () => {
    const watch = watcher({ encodes: (map) => map !== "Gamma" });
    const report = await run(watch);

    expect(watch.sent).toEqual([["Alpha", "Beta"]]);
    expect(report.wanted).toBe(3);
    expect(report.sent).toBe(2);
    expect(report.left).toBe(1);
  });

  it("reports the maps the library had no picture in", async () => {
    const watch = watcher({
      skipped: [{ mapName: "Delta", reason: "blank" }],
    });
    const report = await run(watch);
    expect(report.skipped).toEqual([{ mapName: "Delta", reason: "blank" }]);
  });
});

describe("the hour's allowance", () => {
  it("spends it on what the hub is missing, not on the library's first maps", async () => {
    const watch = watcher({
      library: ["Alpha", "Beta", "Gamma", "Delta"],
      // The hub already holds the two the library lists first, which is exactly
      // the case a run that cut before asking would never get past.
      hubHas: (map) => map === "Alpha" || map === "Beta",
      writesLeft: 1,
    });
    const report = await run(watch);

    expect(watch.walks[1]).toEqual({ maps: ["Gamma"], assets: true });
    expect(report.wanted).toBe(2);
    expect(report.sent).toBe(1);
    expect(report.left).toBe(1);
    expect(report.stopped).toContain("1 of the 2 maps");
  });

  /**
   * The second press, which is the whole point of the ordering. The first run
   * sent Gamma, so the hub now has it, so the same library with one write left
   * reaches Delta rather than offering Gamma again.
   */
  it("reaches the next maps along on the run after", async () => {
    const watch = watcher({
      library: ["Alpha", "Beta", "Gamma", "Delta"],
      hubHas: (map) => map !== "Delta",
      writesLeft: 1,
    });
    const report = await run(watch);

    expect(watch.walks[1]).toEqual({ maps: ["Delta"], assets: true });
    expect(report.sent).toBe(1);
    expect(report.left).toBe(0);
  });

  it("encodes nothing when the hour is spent, and says so", async () => {
    const watch = watcher({ writesLeft: 0 });
    const report = await run(watch);

    // Asked, because asking costs no allowance, and stopped before the encode.
    expect(watch.walks).toHaveLength(1);
    expect(watch.sent).toEqual([]);
    expect(report.wanted).toBe(3);
    expect(report.left).toBe(3);
    expect(report.stopped).toContain("already sent this hour's map pictures");
  });
});

describe("what a sweep is reported as", () => {
  it("says how many are still waiting, which is what says to press again", () => {
    expect(
      mapPictureSweepSummary({
        read: 100,
        wanted: 90,
        sent: 80,
        left: 10,
        skipped: [],
        errors: [],
      }),
    ).toBe(
      "Sent 80 maps' pictures. 10 more maps are still waiting. Press it again later to carry on.",
    );
  });

  it("says so when the hub has the lot", () => {
    expect(
      mapPictureSweepSummary({
        read: 100,
        wanted: 0,
        sent: 0,
        left: 0,
        skipped: [],
        errors: [],
      }),
    ).toBe("The hub already has a picture of every map on this computer.");
  });

  it("says so when there are no maps to draw", () => {
    expect(
      mapPictureSweepSummary({
        read: 0,
        wanted: 0,
        sent: 0,
        left: 0,
        skipped: [],
        errors: [],
      }),
    ).toBe("Coilbox found no maps to draw.");
  });
});
