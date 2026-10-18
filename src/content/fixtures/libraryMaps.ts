import type { HakoraMap, SpringFile } from "../../downloads/bindings";
import type { QueueItem } from "../../downloads/DownloadQueueProvider";
import type { MapFacts } from "../../hub/maps/lookup";
import type { MapItem } from "../bindings";
import type { LibraryInput } from "../library";

const scannedMap = (name: string, archive: string): MapItem => ({
  name,
  archives: [{ name: archive }],
  info: {},
  width: 384,
  height: 384,
});

const springFile = (springname: string, filename: string): SpringFile => ({
  springname,
  name: springname,
  filename,
  category: "map",
  size: 14 * 1024 * 1024,
  timestamp: null,
  mirrors: [`https://springfiles.example/${filename}`],
  mapimages: [],
  metadata: { author: "", width: 20, height: 20 },
});

const hakoraFile = (filename: string): HakoraMap => ({
  filename,
  url: `https://hakora.example/${filename}`,
  size: "14M",
});

/**
 * Comet Catcher Redux is installed and on two mirrors. Supreme Isthmus is on
 * two mirrors and not installed. Isis is queued. my_test_map is on disk and
 * on no mirror.
 */
export const LIBRARY_MAPS_INPUT: LibraryInput = {
  scan: {
    games: [],
    maps: [
      scannedMap("Comet Catcher Redux", "comet_catcher_redux.sd7"),
      scannedMap("my_test_map v3", "my_test_map_v3.sd7"),
    ],
  },
  files: {
    games: [],
    maps: ["comet_catcher_redux.sd7", "my_test_map_v3.sd7"],
  },
  hubGames: [],
  catalogues: [
    {
      source: "springfiles",
      kind: "map",
      entries: [
        springFile("Comet Catcher Redux", "comet_catcher_redux.sd7"),
        springFile("Supreme Isthmus v2", "Supreme_Isthmus_v2.sd7"),
        springFile("Isis", "isis.sd7"),
      ],
    },
    {
      source: "hakora",
      entries: [
        hakoraFile("comet_catcher_redux.sd7"),
        hakoraFile("Supreme_Isthmus_v2.sd7"),
      ],
    },
  ],
  queue: [
    {
      kind: "mapAnySource",
      label: "Isis",
      args: { mapName: "Isis", writePath: "/data" },
      id: "q1",
      identity: "mapAnySource:Isis",
      status: "queued",
      progress: null,
      rate: { bytesPerSec: null, secondsLeft: null, stalled: false },
      startedAt: null,
      error: null,
    } as QueueItem,
  ],
};

/** The hub's facts for one map, with this many starts and these tags. */
export function mapFacts(starts: number, tags: string[] = []): MapFacts {
  return {
    slug: "map",
    display_name: null,
    description: null,
    authors: [],
    width_elmos: 10240,
    height_elmos: 10240,
    world_height_min: 0,
    world_height_max: 100,
    min_wind: null,
    max_wind: null,
    tidal_strength: null,
    void_water: null,
    water_coverage: null,
    tags,
    points: {
      start: Array.from({ length: starts }, (_, i) => ({ x: i, z: i })),
      metal: [],
      geo: [],
    },
    appearance: {},
  };
}
