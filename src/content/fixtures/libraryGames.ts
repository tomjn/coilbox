import type { QueueItem } from "../../downloads/DownloadQueueProvider";
import type { HubGame, HubGameDownload } from "../../hub/api";
import type { GameItem } from "../bindings";
import type { LibraryInput } from "../library";

const scanned = (
  name: string,
  archive: string,
  info: Record<string, string>,
): GameItem => ({
  name,
  primaryArchive: { name: archive },
  dependencyArchives: [],
  info,
});

const hub = (
  shortname: string,
  title: string,
  downloads: HubGameDownload[],
  featured = false,
): HubGame => ({
  shortname,
  title,
  description: null,
  featured,
  downloads,
  logo: null,
  card: null,
  faction_count: 0,
  unit_count: 0,
  item_count: 0,
});

const queued = (
  id: string,
  tag: string,
  label: string,
  status: "active" | "queued",
): QueueItem =>
  ({
    kind: "rapid",
    label,
    args: { tag },
    id,
    identity: `rapid::${tag}`,
    status,
    progress: null,
    rate: { bytesPerSec: null, secondsLeft: null, stalled: false },
    startedAt: null,
    error: null,
  }) as QueueItem;

/**
 * A library input with one game in each state the Games page draws, plus a
 * game only springfiles lists, which the page leaves out.
 *
 * - Splinter Faction: installed 0.1.86, GitHub has 0.1.87, so `update`.
 * - Balanced Annihilation: installed and on the hub, so `installed`.
 * - Zero-K: downloading. Evolution RTS: queued.
 * - Metal Factions: on the hub and springfiles, not installed, so `available`.
 * - My Test Game: installed and on no catalogue, so `local`.
 * - Tech Annihilation: on the hub with no download, so `noSource`.
 */
export const LIBRARY_GAMES_INPUT: LibraryInput = {
  scan: {
    games: [
      scanned("SplinterFaction 0.1.86", "SplinterFaction_0.1.86.sdz", {
        shortname: "SF",
        version: "0.1.86",
      }),
      scanned("Balanced Annihilation V15.9.8", "ba-v15.9.8.sdz", {
        shortname: "BA",
        version: "V15.9.8",
      }),
      scanned("My Test Game 1.0", "mytestgame.sdz", { version: "1.0" }),
    ],
    maps: [],
  },
  files: {
    games: ["splinterfaction_0.1.86.sdz", "ba-v15.9.8.sdz", "mytestgame.sdz"],
    maps: [],
  },
  hubGames: [
    hub(
      "SF",
      "Splinter Faction",
      [{ kind: "github", value: "splinterfaction/sf" }],
      true,
    ),
    hub("BA", "Balanced Annihilation", [{ kind: "rapid", value: "ba:stable" }]),
    hub("ZK", "Zero-K", [{ kind: "rapid", value: "zk:stable" }], true),
    hub("EVO", "Evolution RTS", [{ kind: "rapid", value: "evo:stable" }]),
    hub("MF", "Metal Factions", [
      { kind: "rapid", value: "mf:stable" },
      { kind: "github", value: "metalfactions/mf" },
    ]),
    hub("TA", "Tech Annihilation", []),
  ],
  catalogues: [
    {
      source: "springfiles",
      kind: "game",
      entries: [
        {
          springname: "Metal Factions V1.4",
          name: "Metal Factions V1.4",
          filename: "mf-v1.4.sdz",
          category: "game",
          size: 100,
          timestamp: null,
          mirrors: ["https://one.example/mf-v1.4.sdz"],
          mapimages: [],
          metadata: { author: "", width: 0, height: 0 },
        },
        {
          springname: "Kernel Panic 4.4",
          name: "Kernel Panic 4.4",
          filename: "kp-4.4.sdz",
          category: "game",
          size: 100,
          timestamp: null,
          mirrors: ["https://one.example/kp-4.4.sdz"],
          mapimages: [],
          metadata: { author: "", width: 0, height: 0 },
        },
      ],
    },
    {
      source: "github",
      kind: "game",
      repo: "splinterfaction/sf",
      entries: [
        {
          filename: "SplinterFaction_0.1.87.sdz",
          url: "https://github.example/SplinterFaction_0.1.87.sdz",
          size: 200,
          tag: "v0.1.87",
          publishedAt: "2026-10-01T00:00:00Z",
        },
        {
          filename: "SplinterFaction_0.1.86.sdz",
          url: "https://github.example/SplinterFaction_0.1.86.sdz",
          size: 200,
          tag: "v0.1.86",
          publishedAt: "2026-09-01T00:00:00Z",
        },
      ],
    },
  ],
  queue: [
    queued("q1", "zk:stable", "Zero-K", "active"),
    queued("q2", "evo:stable", "Evolution RTS", "queued"),
  ],
};
