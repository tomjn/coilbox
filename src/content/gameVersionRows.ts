import { stripVersion } from "../career/games";
import type { Version } from "../downloads/bindings";
import type { EnqueueInput } from "../downloads/DownloadQueueProvider";
import { isCommitTag } from "../downloads/rapidVersionOrder";
import type { GameItem } from "./bindings";
import type { LibraryGame } from "./library";
import { sourceRequest } from "./libraryGames";

/** One rapid repository's versions, as its index on disk lists them. */
export interface RapidRepoVersions {
  /** The repository name, the part of a tag before the colon. */
  repo: string;
  masterUrl: string;
  versions: Version[];
  /** Seconds since the index was fetched. */
  ageSecs: number;
}

export type VersionKind = "release" | "branch" | "snapshot";

/** One row of the game page's Versions tab (issue #4580). */
export interface GameVersionRow {
  key: string;
  version: string;
  /** The rapid tag, or the GitHub repo. */
  from: string;
  kind: VersionKind;
  /** The rapid package md5, or the release archive's file name. */
  pkg: string;
  /** The tags or packages a rapid version pulls in. */
  needs: string[];
  /** When a GitHub release was published. */
  date?: string;
  /** A GitHub archive's size in bytes. */
  size?: number;
  installed: boolean;
  /** The scanned game this row is, when it is on disk, for Remove. */
  installedItem?: GameItem;
  /** What Install queues. Null when the row cannot be fetched. */
  request: EnqueueInput | null;
}

export interface GameVersionTable {
  /** Named rapid tags and GitHub release archives. */
  rows: GameVersionRow[];
  /** Commit snapshots, which the tab folds behind one row. */
  snapshots: GameVersionRow[];
}

/**
 * A named tag that names a version, such as `zk:1.12.3` or `byar:v2`, is a
 * release. Any other named tag, such as `byar:stable`, moves with a branch.
 */
export function rapidKind(tag: string): VersionKind {
  if (isCommitTag(tag)) return "snapshot";
  const suffix = tag.slice(tag.indexOf(":") + 1);
  return /^v?\d/i.test(suffix) ? "release" : "branch";
}

/** "a91f…c3e2" for an md5. */
export function shortMd5(md5: string): string {
  return md5.length > 10 ? `${md5.slice(0, 4)}…${md5.slice(-4)}` : md5;
}

const fileOf = (path: string | undefined) =>
  path?.split(/[\\/]/).pop()?.toLowerCase();

/** The version part of a long game name, or the whole name when it has none. */
function versionOf(name: string): string {
  return name.slice(stripVersion(name).length).trim() || name;
}

/**
 * Every version the game's sources list: a row per named rapid tag, with the
 * commit snapshots set apart, then a row per GitHub release archive. A rapid row
 * is installed when the pool holds its package, and a GitHub row when its
 * archive is on disk.
 */
export function gameVersionRows(
  game: LibraryGame,
  rapid: readonly RapidRepoVersions[],
  writePath: string | undefined,
): GameVersionTable {
  const rows: GameVersionRow[] = [];
  const snapshots: GameVersionRow[] = [];
  for (const repo of rapid) {
    for (const v of repo.versions) {
      const installedItem = v.md5
        ? game.installed.find(
            (g) =>
              fileOf(g.primaryArchive.path) === `${v.md5.toLowerCase()}.sdp`,
          )
        : undefined;
      const row: GameVersionRow = {
        key: `rapid:${repo.masterUrl}:${v.tag}`,
        version: versionOf(v.name || v.tag),
        from: v.tag,
        kind: rapidKind(v.tag),
        pkg: shortMd5(v.md5),
        needs: v.depends,
        installed: v.installed || !!installedItem,
        installedItem,
        request: {
          kind: "rapid",
          label: v.name || game.title,
          args: { tag: v.tag, masterUrl: repo.masterUrl, writePath },
        },
      };
      (row.kind === "snapshot" ? snapshots : rows).push(row);
    }
  }
  for (const s of game.sources) {
    if (s.kind !== "github") continue;
    const installedItem = game.installed.find(
      (g) => g.primaryArchive.name.toLowerCase() === s.filename.toLowerCase(),
    );
    rows.push({
      key: `github:${s.repo}:${s.filename}`,
      version: s.version ?? s.tag ?? s.filename,
      from: s.repo ?? "GitHub",
      kind: "release",
      pkg: s.filename,
      needs: [],
      date: s.date,
      size: typeof s.size === "number" ? s.size : undefined,
      installed: s.installed,
      installedItem,
      request: writePath ? sourceRequest(s, game.title, writePath) : null,
    });
  }
  return { rows, snapshots };
}
