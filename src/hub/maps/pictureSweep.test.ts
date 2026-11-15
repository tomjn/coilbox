import { describe, expect, it } from "vitest";

import type { MapMinimapRow, MapMinimapsResult } from "@/content/bindings";
import type { AssetKey, HaveResult } from "../assets/have";
import {
  MAP_PICTURES_SUBJECT,
  type MapPictureSweepProgress,
  type MapPictureSweepTools,
  mapLayerUpload,
  mapPictureKey,
  mapPictureSkipSummary,
  mapPictureSweepSummary,
  minimapUpload,
  picturesOffered,
  picturesTheHubWants,
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

const HEIGHT = "overlay:height";
const METAL = "overlay:metal";

/** One map as the survey pass reports it, with the overlay layers named. */
function surveyed(name: string, layers: string[] = []): MapMinimapRow {
  return {
    mapName: name,
    sourceHash: `src-${name}`,
    sourceArchive: name,
    mapWidth: 8192,
    mapHeight: 6144,
    overlays: layers.map((variant) => ({
      variant,
      sourceHash: `src-${name}-${variant}`,
    })),
  };
}

/** One layer of a map as the encode pass writes it. */
function asset(row: MapMinimapRow, variant: string, sourceHash: string) {
  return {
    variant,
    origin: "extracted",
    sourceArchive: row.sourceArchive,
    path: `/cache/${row.mapName}-${variant}.webp`,
    hash: `bytes-${row.mapName}-${variant}`,
    sourceHash,
    encodeProfile: "webp-q80-512",
    mime: "image/webp",
    width: 512,
    height: 512,
    bytes: 35458,
    ...(variant === HEIGHT ? { minHeight: -40, maxHeight: 620.5 } : {}),
  };
}

/** The same map as the encode pass reports it, with every layer on it. */
function encoded(row: MapMinimapRow): MapMinimapRow {
  return {
    ...row,
    asset: asset(row, "minimap", row.sourceHash),
    overlays: (row.overlays ?? []).map((layer) => ({
      ...layer,
      asset: asset(row, layer.variant, layer.sourceHash),
    })),
  };
}

interface Watch {
  tools: MapPictureSweepTools;
  /** Every walk asked for, so a survey and an encode can be told apart. */
  walks: { maps?: string[]; assets?: boolean }[];
  asked: AssetKey[][];
  /** Every set of pictures offered, by the maps they were of. */
  sent: string[][];
  /** The same sets, as `map variant`. */
  sentLayers: string[][];
  startedBy: string[];
  recorded: { subject: string; written: number }[];
  progress: MapPictureSweepProgress[];
}

function watcher(
  options: {
    library?: string[];
    /** The overlay layers every map in the library offers. */
    layers?: string[];
    /** Which pictures the hub already has. */
    hubHas?: (map: string, variant: string) => boolean;
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
    sentLayers: [],
    startedBy: [],
    recorded: [],
    progress: [],
  };

  watch.tools = {
    minimaps: async ({ maps, assets }) => {
      watch.walks.push({ maps, assets });
      const names = maps ?? library;
      const rows = names.map((name) => surveyed(name, options.layers));
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
          key.keyed_on === "map" && hubHas(key.map_name, key.variant)
            ? "have"
            : "missing",
      }));
    },
    upload: async (_hubUrl, assets, options) => {
      watch.sent.push(
        assets.map((asset) => (asset.keyed_on === "map" ? asset.map_name : "")),
      );
      watch.sentLayers.push(
        assets.map((asset) =>
          asset.keyed_on === "map" ? `${asset.map_name} ${asset.variant}` : "",
        ),
      );
      watch.startedBy.push(options.startedBy);
      return {
        outcomes: assets.map(() => ({
          result: "uploaded" as const,
          status: 200,
          said: null,
          verdict: null,
        })),
        written: assets.length,
        error: null,
      };
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
    const rows = ["Alpha", "Beta", "Gamma"].map((name) => surveyed(name));
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
      picturesTheHubWants(picturesOffered(rows), answers).map(
        (picture) => picture.row.mapName,
      ),
    ).toEqual(["Beta", "Gamma"]);
  });

  /** Zipping by index is what the have check promises. A short answer cannot be
   *  lined up, and lining it up wrongly would send Alpha's picture as Beta's. */
  it("sends nothing at all when the answers cannot be lined up", () => {
    const rows = ["Alpha", "Beta"].map((name) => surveyed(name));
    expect(picturesTheHubWants(picturesOffered(rows), [])).toEqual([]);
  });

  it("offers each map's minimap and then its overlay layers", () => {
    const keys = picturesOffered([surveyed("Alpha", [HEIGHT, METAL])]).map(
      mapPictureKey,
    );
    expect(keys).toEqual([
      {
        keyed_on: "map",
        map_name: "Alpha",
        variant: "minimap",
        source_hash: "src-Alpha",
      },
      {
        keyed_on: "map",
        map_name: "Alpha",
        variant: HEIGHT,
        source_hash: `src-Alpha-${HEIGHT}`,
      },
      {
        keyed_on: "map",
        map_name: "Alpha",
        variant: METAL,
        source_hash: `src-Alpha-${METAL}`,
      },
    ]);
  });

  /** The hub refuses a height layer without its world range, and a range on
   *  anything else. */
  it("puts the world height range on the height layer alone", () => {
    const row = encoded(surveyed("Alpha", [HEIGHT, METAL]));
    const [height, metal] = (row.overlays ?? []).map((layer) =>
      mapLayerUpload(row, layer.asset as NonNullable<typeof layer.asset>),
    );
    expect(height).toMatchObject({
      variant: HEIGHT,
      source_hash: `src-Alpha-${HEIGHT}`,
      world_height_min: -40,
      world_height_max: 620.5,
      map_width: 8192,
      map_height: 6144,
    });
    expect(metal).not.toHaveProperty("world_height_min");
    expect(metal).not.toHaveProperty("world_height_max");
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
      path: "/cache/Alpha-minimap.webp",
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

  it("sends only the layers the hub is missing", async () => {
    const watch = watcher({
      library: ["Alpha", "Beta"],
      layers: [HEIGHT, METAL],
      hubHas: (map, variant) => map === "Alpha" || variant !== HEIGHT,
    });
    const report = await run(watch);

    expect(watch.asked[0]).toHaveLength(6);
    expect(watch.walks[1]).toEqual({ maps: ["Beta"], assets: true });
    expect(watch.sentLayers).toEqual([[`Beta ${HEIGHT}`]]);
    expect(report.wanted).toBe(1);
    expect(report.sent).toBe(1);
    expect(report.left).toBe(0);
  });

  it("counts a map still waiting until every layer it wanted is written", async () => {
    const watch = watcher({ library: ["Alpha"], layers: [HEIGHT] });
    watch.tools.upload = async (_hubUrl, assets) => ({
      outcomes: assets.map((asset) => ({
        result: asset.variant === HEIGHT ? "refused" : "uploaded",
        status: asset.variant === HEIGHT ? 400 : 200,
        said: null,
        verdict: null,
      })),
      written: 1,
      error: null,
    });
    const report = await run(watch);

    expect(report.sent).toBe(1);
    expect(report.left).toBe(1);
  });

  it("keeps a layer the walk could not offer apart from the maps it skipped", async () => {
    const watch = watcher({
      skipped: [
        { mapName: "Alpha", reason: "read-failed", variant: METAL },
        { mapName: "Delta", reason: "blank" },
      ],
    });
    const report = await run(watch);
    expect(report.skipped).toEqual([{ mapName: "Delta", reason: "blank" }]);
    expect(report.layersSkipped).toEqual([
      { mapName: "Alpha", reason: "read-failed", variant: METAL },
    ]);
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
    expect(report.stopped).toContain("1 of the 2 map pictures");
  });

  /** A map can want four pictures, so the hour is counted in pictures and can
   *  end part way through one map. The next press asks again and finishes it. */
  it("counts pictures rather than maps, and can stop part way through a map", async () => {
    const watch = watcher({
      library: ["Alpha"],
      layers: [HEIGHT, METAL],
      writesLeft: 2,
    });
    const report = await run(watch);

    expect(watch.sentLayers).toEqual([["Alpha minimap", `Alpha ${HEIGHT}`]]);
    expect(watch.recorded).toEqual([
      { subject: MAP_PICTURES_SUBJECT, written: 2 },
    ]);
    expect(report.sent).toBe(1);
    expect(report.left).toBe(1);
    expect(report.stopped).toContain("2 of the 3 map pictures");
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
        layersSkipped: [],
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
        layersSkipped: [],
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
        layersSkipped: [],
        errors: [],
      }),
    ).toBe("Coilbox found no maps to draw.");
  });

  /// Follows on from #2379: the closing sentence claimed every map had a
  /// picture, which was not true of a library that had any skips (#2390).
  it("stops short of 'every map' once any were skipped", () => {
    expect(
      mapPictureSweepSummary({
        read: 10,
        wanted: 1,
        sent: 1,
        left: 0,
        skipped: [{ mapName: "Empty Quarter", reason: "no-source" }],
        layersSkipped: [],
        errors: [],
      }),
    ).toContain("every map coilbox could draw one for");
  });

  it("still says 'every map' when nothing was skipped", () => {
    expect(
      mapPictureSweepSummary({
        read: 10,
        wanted: 1,
        sent: 1,
        left: 0,
        skipped: [],
        layersSkipped: [],
        errors: [],
      }),
    ).toContain("every map on this computer");
  });

  it("says how many layers it could not send, apart from the maps", () => {
    expect(
      mapPictureSweepSummary({
        read: 10,
        wanted: 1,
        sent: 1,
        left: 0,
        skipped: [],
        layersSkipped: [
          { mapName: "A", reason: "read-failed", variant: METAL },
          { mapName: "B", reason: "no-bounds", variant: HEIGHT },
        ],
        errors: [],
      }),
    ).toBe(
      "Sent one map's picture. The hub now has a picture of every map on this computer. Coilbox could not send 2 terrain, metal or type layers.",
    );
  });
});

describe("mapPictureSkipSummary", () => {
  it("says nothing when nothing was skipped", () => {
    expect(mapPictureSkipSummary([])).toBeNull();
  });

  /// A map with nothing to draw is the ordinary case (#2390), so it leads the
  /// sentence rather than being singled out.
  it("puts the ordinary reason first and names the rest", () => {
    const said = mapPictureSkipSummary([
      { mapName: "A", reason: "no-source" },
      { mapName: "B", reason: "no-source" },
      { mapName: "C", reason: "duplicate-map" },
      { mapName: "D", reason: "working-folder" },
    ]);
    expect(said).toBe(
      "4 maps were skipped: 2 with no minimap to draw, 1 listed twice in the library, 1 in a loose working folder.",
    );
  });

  it("names a reason coilbox has no ordinary case for", () => {
    const said = mapPictureSkipSummary([
      { mapName: "A", reason: "blank" },
      { mapName: "B", reason: "no-extent" },
    ]);
    expect(said).toBe(
      "2 maps were skipped: 1 with a minimap that is one flat colour, 1 whose size coilbox could not work out.",
    );
  });
});

describe("a sweep of one map's picture", () => {
  it("surveys and sends that map alone", async () => {
    const watch = watcher({ library: ["Alpha", "Beta"] });

    const report = await sweepMapPictures(
      { ...TARGET, only: "Beta" },
      () => {},
      watch.tools,
    );

    expect(watch.walks).toEqual([
      { maps: ["Beta"], assets: undefined },
      { maps: ["Beta"], assets: true },
    ]);
    expect(watch.sent).toEqual([["Beta"]]);
    expect(report.sent).toBe(1);
  });
});
