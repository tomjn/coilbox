import { describe, expect, it } from "vitest";
import type {
  EvolutionRtsMap,
  HakoraMap,
  ReleaseArchive,
  SpringFile,
} from "../downloads/bindings";
import type {
  EnqueueInput,
  QueueItem,
  QueueStatus,
} from "../downloads/DownloadQueueProvider";
import type { DownloadHistory } from "../downloads/downloadHistory";
import type { HubGame, HubGameDownload } from "../hub/api";
import type { GameItem, MapItem } from "./bindings";
import { buildLibrary, type LibraryInput } from "./library";

const scannedGame = (
  name: string,
  archive: string,
  info: Record<string, string>,
): GameItem => ({
  name,
  primaryArchive: { name: archive },
  dependencyArchives: [],
  info,
});

const scannedMap = (name: string, archive: string): MapItem => ({
  name,
  archives: [{ name: archive }],
  info: {},
});

const hubGame = (
  shortname: string,
  title: string,
  downloads: HubGameDownload[],
): HubGame => ({
  shortname,
  title,
  description: null,
  featured: false,
  downloads,
  logo: null,
  card: null,
  faction_count: 0,
  unit_count: 0,
  item_count: 0,
});

const springFile = (
  springname: string,
  filename: string,
  category: string,
): SpringFile => ({
  springname,
  name: springname,
  filename,
  category,
  size: 100,
  timestamp: null,
  mirrors: [
    `https://one.example/${filename}`,
    `https://two.example/${filename}`,
  ],
  mapimages: [],
  metadata: { author: "", width: 0, height: 0 },
});

const release = (filename: string, tag: string): ReleaseArchive => ({
  filename,
  url: `https://github.example/${filename}`,
  size: 200,
  tag,
  publishedAt: "2026-10-01T00:00:00Z",
});

const hakoraFile = (filename: string): HakoraMap => ({
  filename,
  url: `https://hakora.example/${filename}`,
  size: "1M",
});

const evolutionRtsFile = (filename: string): EvolutionRtsMap => ({
  filename,
  url: `https://evolutionrts.example/${filename}`,
  size: 1000,
});

let nextId = 0;
const inQueue = (input: EnqueueInput, status: QueueStatus): QueueItem => {
  nextId += 1;
  return {
    ...input,
    id: `q${nextId}`,
    identity: `id${nextId}`,
    status,
    progress: null,
    rate: { bytesPerSec: null, secondsLeft: null, stalled: false },
    startedAt: null,
    error: null,
  } as QueueItem;
};

const input: LibraryInput = {
  scan: {
    games: [
      scannedGame("SplinterFaction 0.1.86", "SplinterFaction_0.1.86.sdz", {
        shortname: "SF",
        version: "0.1.86",
      }),
      scannedGame("Balanced Annihilation V15.9.8", "ba-v15.9.8.sdz", {
        shortname: "BA",
        version: "V15.9.8",
      }),
      scannedGame("My Test Game 1.0", "mytestgame.sdz", { version: "1.0" }),
    ],
    maps: [
      scannedMap("Supreme Isthmus v2", "Supreme_Isthmus_v2.sd7"),
      scannedMap("Local Map", "localmap.sd7"),
    ],
  },
  files: {
    games: ["splinterfaction_0.1.86.sdz", "ba-v15.9.8.sdz", "mytestgame.sdz"],
    maps: ["supreme_isthmus_v2.sd7", "localmap.sd7", "orphan.sd7"],
  },
  hubGames: [
    hubGame("SF", "Splinter Faction", [
      { kind: "github", value: "splinterfaction/sf" },
    ]),
    hubGame("BA", "Balanced Annihilation", [
      { kind: "rapid", value: "ba:stable" },
    ]),
    hubGame("TA", "Tech Annihilation", []),
    hubGame("ZK", "Zero-K", [{ kind: "rapid", value: "zk:stable" }]),
    hubGame("EVO", "Evolution RTS", [{ kind: "rapid", value: "evo:stable" }]),
    hubGame("XTA", "XTA", [{ kind: "url", value: "https://x.example/x.sdz" }]),
  ],
  catalogues: [
    {
      source: "springfiles",
      kind: "game",
      entries: [
        springFile("Kernel Panic 4.4", "kp-4.4.sdz", "game"),
        springFile("XTA 9.8", "xta-9.8.sdz", "game"),
      ],
    },
    {
      source: "github",
      kind: "game",
      repo: "splinterfaction/sf",
      entries: [
        release("SplinterFaction_0.1.87.sdz", "v0.1.87"),
        release("SplinterFaction_0.1.86.sdz", "v0.1.86"),
      ],
    },
    {
      source: "springfiles",
      kind: "map",
      entries: [
        springFile("Supreme Isthmus v2", "supreme_isthmus_v2.sd7", "map"),
        springFile(
          "Comet Catcher Redux v3.1",
          "comet_catcher_redux_v3.1.sd7",
          "map",
        ),
        springFile("Tangerine", "tangerine.sd7", "map"),
      ],
    },
    {
      source: "hakora",
      entries: [
        hakoraFile("supreme_isthmus_v2.sd7"),
        hakoraFile("Throne_v8.sd7"),
      ],
    },
    {
      source: "evolutionrts",
      entries: [evolutionRtsFile("comet_catcher_redux_v3.1.sd7")],
    },
  ],
  queue: [
    inQueue(
      { kind: "rapid", label: "Zero-K", args: { tag: "zk:stable" } },
      "active",
    ),
    inQueue(
      { kind: "rapid", label: "Evolution RTS", args: { tag: "evo:stable" } },
      "queued",
    ),
    inQueue(
      {
        kind: "map",
        label: "Comet Catcher Redux v3.1",
        args: { springName: "Comet Catcher Redux v3.1" },
      },
      "active",
    ),
    inQueue(
      {
        kind: "file",
        label: "Throne_v8",
        args: {
          url: "https://hakora.example/Throne_v8.sd7",
          destDir: "/data/maps",
          filename: "Throne_v8.sd7",
        },
      },
      "queued",
    ),
  ],
};

describe("buildLibrary games", () => {
  const { games } = buildLibrary(input);
  const byId = (id: string) => {
    const game = games.find((g) => g.id === id);
    if (!game) throw new Error(`no record for ${id}`);
    return game;
  };

  it("gives one record per game, keyed by shortname or normalised name", () => {
    expect(games.map((g) => g.id).sort()).toEqual([
      "ba",
      "evo",
      "kernel panic",
      "my test game",
      "sf",
      "ta",
      "xta",
      "zk",
    ]);
  });

  it("marks an installed game the hub lists as installed", () => {
    const ba = byId("ba");
    expect(ba.state).toBe("installed");
    expect(ba.installed.map((g) => g.name)).toEqual([
      "Balanced Annihilation V15.9.8",
    ]);
    expect(ba.hub?.shortname).toBe("BA");
  });

  it("offers an update when a source has a newer version than installed", () => {
    const sf = byId("sf");
    expect(sf.state).toBe("update");
    expect(sf.update?.filename).toBe("SplinterFaction_0.1.87.sdz");
    expect(sf.update?.version).toBe("0.1.87");
    expect(sf.sources.map((s) => [s.kind, s.filename, s.installed])).toEqual([
      ["github", "SplinterFaction_0.1.87.sdz", false],
      ["github", "SplinterFaction_0.1.86.sdz", true],
    ]);
  });

  it("marks a game installed on no catalogue as local only", () => {
    const local = byId("my test game");
    expect(local.state).toBe("local");
    expect(local.hub).toBeUndefined();
    expect(local.sources).toEqual([]);
  });

  it("marks a hub game with no downloads as having no source", () => {
    expect(byId("ta").state).toBe("noSource");
  });

  it("reads the queue for downloading and queued games", () => {
    expect(byId("zk").state).toBe("downloading");
    expect(byId("zk").download?.status).toBe("active");
    expect(byId("evo").state).toBe("queued");
  });

  it("marks a catalogue game that is not installed as available", () => {
    expect(byId("kernel panic").state).toBe("available");
    expect(byId("kernel panic").sources[0].mirrors).toHaveLength(2);
  });

  it("joins a springfiles game to the hub game with the same title", () => {
    const xta = byId("xta");
    expect(xta.state).toBe("available");
    expect(xta.hub?.shortname).toBe("XTA");
    expect(xta.sources.map((s) => [s.kind, s.version])).toEqual([
      ["springfiles", "9.8"],
    ]);
  });
});

describe("buildLibrary maps", () => {
  const { maps } = buildLibrary(input);
  const byId = (id: string) => {
    const map = maps.find((m) => m.id === id);
    if (!map) throw new Error(`no record for ${id}`);
    return map;
  };

  it("gives one record per spring name", () => {
    expect(maps.map((m) => m.id).sort()).toEqual([
      "Comet Catcher Redux v3.1",
      "Local Map",
      "Supreme Isthmus v2",
      "Tangerine",
      "Throne_v8",
      "orphan",
    ]);
  });

  it("merges an installed map on two mirrors into one installed record", () => {
    const map = byId("Supreme Isthmus v2");
    expect(map.state).toBe("installed");
    expect(map.installed?.name).toBe("Supreme Isthmus v2");
    expect(map.sources.map((s) => [s.kind, s.installed])).toEqual([
      ["springfiles", true],
      ["hakora", true],
    ]);
  });

  it("marks a map no catalogue lists as local only, from the scan or the disk", () => {
    expect(byId("Local Map").state).toBe("local");
    expect(byId("orphan").state).toBe("local");
    expect(byId("orphan").installed).toBeUndefined();
  });

  it("reads the queue by spring name and by file name", () => {
    const comet = byId("Comet Catcher Redux v3.1");
    expect(comet.state).toBe("downloading");
    expect(comet.sources.map((s) => s.kind)).toEqual([
      "springfiles",
      "evolutionrts",
    ]);
    expect(byId("Throne_v8").state).toBe("queued");
  });

  it("marks a catalogue map that is not installed as available", () => {
    expect(byId("Tangerine").state).toBe("available");
  });
});

describe("buildLibrary update state", () => {
  const rapidRecord = (md5: string | null): DownloadHistory => ({
    "game:ba": {
      "rapid|": {
        source: "rapid",
        outcome: "ok",
        reference: "ba:stable",
        filename: null,
        md5,
        mirror: null,
        failure: null,
        durationMs: 10,
        at: "2026-10-01T00:00:00.000Z",
      },
    },
  });
  const ba = (extra: Partial<LibraryInput>) =>
    buildLibrary({ ...input, ...extra }).games.find((g) => g.id === "ba");

  it("raises an update for a rapid game whose tag md5 moved", () => {
    const game = ba({
      history: rapidRecord(null),
      rapidVersions: { "ba:stable": { md5: "bbbb", installed: false } },
    });
    expect(game?.state).toBe("update");
    expect(game?.rapidUpdate).toEqual({ tag: "ba:stable", md5: "bbbb" });
  });

  it("raises nothing while the tag md5 is the installed one", () => {
    const game = ba({
      history: rapidRecord(null),
      rapidVersions: { "ba:stable": { md5: "aaaa", installed: true } },
    });
    expect(game?.state).toBe("installed");
    expect(game?.rapidUpdate).toBeUndefined();
  });

  it("raises nothing for a rapid game before the tag has been read", () => {
    const game = ba({ history: rapidRecord(null), rapidVersions: {} });
    expect(game?.state).toBe("installed");
  });

  it("raises nothing for a game that was not installed from rapid", () => {
    const history = rapidRecord(null);
    history["game:ba"]["github|"] = {
      ...history["game:ba"]["rapid|"],
      source: "github",
      at: "2026-10-02T00:00:00.000Z",
    };
    const game = ba({
      history,
      rapidVersions: { "ba:stable": { md5: "bbbb", installed: false } },
    });
    expect(game?.state).toBe("installed");
  });

  it("raises an update for a GitHub game whose latest release is not installed", () => {
    const sf = buildLibrary(input).games.find((g) => g.id === "sf");
    expect(sf?.state).toBe("update");
    expect(sf?.update?.tag).toBe("v0.1.87");
  });

  it("raises nothing once the latest GitHub release is installed", () => {
    const sf = buildLibrary({
      ...input,
      files: {
        ...(input.files as NonNullable<LibraryInput["files"]>),
        games: ["splinterfaction_0.1.87.sdz", "ba-v15.9.8.sdz"],
      },
      scan: {
        ...(input.scan as NonNullable<LibraryInput["scan"]>),
        games: [
          scannedGame("SplinterFaction 0.1.87", "SplinterFaction_0.1.87.sdz", {
            shortname: "SF",
            version: "0.1.87",
          }),
        ],
      },
    }).games.find((g) => g.id === "sf");
    expect(sf?.state).toBe("installed");
    expect(sf?.update).toBeUndefined();
  });

  it("keeps the update but shows no update state once the player turns updates off (issue #4580)", () => {
    const sf = buildLibrary({
      ...input,
      updatesOff: new Set(["game:splinterfaction"]),
    }).games.find((g) => g.id === "sf");
    expect(sf?.state).toBe("installed");
    expect(sf?.update?.tag).toBe("v0.1.87");
  });
});

describe("buildLibrary installed files", () => {
  it("joins the disk listing and the scanned archives, lowercased", () => {
    const { installedFiles } = buildLibrary(input);
    expect(installedFiles.maps.has("supreme_isthmus_v2.sd7")).toBe(true);
    expect(installedFiles.maps.has("orphan.sd7")).toBe(true);
    expect(installedFiles.games.has("splinterfaction_0.1.86.sdz")).toBe(true);
  });

  it("claims nothing is installed before the scan and the listing land", () => {
    const empty = buildLibrary({
      scan: null,
      files: null,
      hubGames: null,
      catalogues: [],
      queue: [],
    });
    expect(empty.games).toEqual([]);
    expect(empty.maps).toEqual([]);
    expect(empty.installedFiles.maps.size).toBe(0);
  });
});

describe("buildLibrary stray files (#4646)", () => {
  const JUNK = [".DS_Store", "Thumbs.db", "notes.txt"];
  const bare: LibraryInput = {
    scan: { games: [], maps: [] },
    files: {
      games: [...JUNK, "Stray_Game-1.0.sdz"],
      maps: [...JUNK, "Stray_Map.SD7"],
    },
    hubGames: [],
    catalogues: [],
    queue: [],
  };

  it("makes no record of a file on disk that is not an archive", () => {
    const { games, maps, installedFiles } = buildLibrary(bare);
    expect(games.map((g) => [g.id, g.state])).toEqual([
      ["stray game-1.0", "local"],
    ]);
    expect(maps.map((m) => [m.id, m.state])).toEqual([["stray_map", "local"]]);
    // Still listed as on disk, which marks nothing installed by itself.
    expect(installedFiles.games.has(".ds_store")).toBe(true);
  });

  it("keeps the card of a scanned .sdd game, a rapid game and a .sdd map", () => {
    const { games, maps } = buildLibrary({
      ...bare,
      scan: {
        games: [
          scannedGame("Folder Game 0.1", "foldergame.sdd", { version: "0.1" }),
          scannedGame("Rapid Game test-42", "rapid game test-42", {
            version: "test-42",
          }),
        ],
        maps: [scannedMap("Folder Map", "foldermap.sdd")],
      },
    });
    expect(games.map((g) => g.title).sort()).toEqual([
      "Folder Game",
      "Rapid Game",
      "stray game-1.0",
    ]);
    for (const g of games) expect(g.state).toBe("local");
    expect(maps.map((m) => m.id).sort()).toEqual(["Folder Map", "stray_map"]);
    expect(maps.find((m) => m.id === "Folder Map")?.state).toBe("local");
  });
});
