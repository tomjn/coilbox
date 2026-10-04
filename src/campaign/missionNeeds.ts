import { missingLaunchContent } from "@/play/launchContent";

/** One thing a mission needs and this machine does not have. */
export interface MissionNeed {
  kind: "engine" | "game" | "map";
  /** The game or map name. An engine has none: a campaign does not name one. */
  name: string;
}

export interface NeedsFacts {
  /** The mission names no game or map, so no download can help. */
  unfinished: boolean;
  /** There is no engine to run or to read the install with. */
  noEngine: boolean;
  /** The install has been read, so absence of a name means it is not there. */
  scanReady: boolean;
  gameName: string;
  mapName: string;
  games: { name: string }[];
  maps: { name: string }[];
}

/**
 * What the briefing page has to get before the mission can start, in the order
 * the downloads have to happen: the engine, then the game, then the map.
 *
 * Without an engine nothing can read the install, so the engine is the only
 * thing named until one exists. Empty means the mission can start.
 */
export function missionNeeds(f: NeedsFacts): MissionNeed[] {
  if (f.unfinished) return [];
  if (f.noEngine) return [{ kind: "engine", name: "" }];
  if (!f.scanReady) return [];
  return missingLaunchContent(
    { game: f.gameName, map: f.mapName },
    {
      games: f.games,
      maps: f.maps.map((m) => m.name),
      engineVersions: [],
    },
  ).flatMap((r) =>
    r.kind === "game" || r.kind === "map"
      ? [{ kind: r.kind, name: r.label }]
      : [],
  );
}

/** What one row of the panel says and whether it can offer a download. */
export interface NeedNotice {
  canDownload: boolean;
  message: string | null;
}

/**
 * The wording under one row, and whether its button works.
 *
 * A campaign names its game by full name, version included, and the install
 * check is an exact match, so only that version will do. When its download
 * fails the row says so rather than offering a retry as if another version
 * could stand in. It cannot tell a version that is no longer published from a
 * dropped connection, so it names both and leaves the retry open.
 */
export function needNotice(input: {
  need: MissionNeed;
  /** Why the last attempt to download it failed, when it did. */
  failure: string | null;
  /** The newest engine release for this platform: not asked yet, or the answer. */
  engineRelease: "pending" | "none" | "found";
  noWriteRoot: boolean;
}): NeedNotice {
  const { need, failure, engineRelease, noWriteRoot } = input;
  if (noWriteRoot) {
    return {
      canDownload: false,
      message: "Set a download folder in Downloads settings to enable this.",
    };
  }
  if (need.kind === "engine") {
    if (engineRelease === "none") {
      return {
        canDownload: false,
        message:
          "No engine build is available to download for this platform. Install one from Settings → Engines.",
      };
    }
    return {
      canDownload: engineRelease === "found",
      message: failure,
    };
  }
  if (need.kind === "game" && failure) {
    return {
      canDownload: true,
      message: `${need.name} is the exact version this mission was made for, and it could not be downloaded. It may no longer be published, or the download failed (${failure}). Another version will not run this mission.`,
    };
  }
  return { canDownload: true, message: failure };
}
