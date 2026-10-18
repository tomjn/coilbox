import type { DownloadRecord } from "../downloads/downloadHistory";
import { compareEngineVersions, isRealEngineVersion } from "./engineVersion";
import type { LibraryGame, LibrarySource } from "./library";

/**
 * What a rapid tag points at now, as the rapid index says. `installed` is true
 * when the pool holds a `.sdp` named after `md5`.
 */
export interface RapidTagState {
  md5: string;
  installed: boolean;
}

/** A rapid tag whose package has changed since the game was installed. */
export interface RapidUpdate {
  tag: string;
  md5: string;
}

/**
 * A release is new when none of its game archives is installed. An empty
 * release has nothing to install, so it is never new.
 */
export function releaseIsNew(
  archiveNames: readonly string[],
  installedFiles: ReadonlySet<string>,
): boolean {
  if (archiveNames.length === 0) return false;
  return !archiveNames.some((n) => installedFiles.has(n.toLowerCase()));
}

/**
 * The newest GitHub release's archive for a game installed from GitHub, when
 * that release is not installed. A game counts as installed from a repo when
 * one of that repo's archives is on disk. Releases are in the order GitHub
 * lists them, newest first.
 */
export function githubGameUpdate(
  sources: readonly LibrarySource[],
): LibrarySource | undefined {
  const byRepo = new Map<string, LibrarySource[]>();
  for (const s of sources) {
    if (s.kind !== "github" || !s.repo) continue;
    byRepo.set(s.repo, [...(byRepo.get(s.repo) ?? []), s]);
  }
  for (const list of byRepo.values()) {
    const installed = new Set(
      list.filter((s) => s.installed).map((s) => s.filename.toLowerCase()),
    );
    if (installed.size === 0) continue;
    const latest = list.filter((s) => s.tag === list[0].tag);
    if (
      releaseIsNew(
        latest.map((s) => s.filename),
        installed,
      )
    ) {
      return latest[0];
    }
  }
  return undefined;
}

/**
 * Whether the tag a game was last fetched from through rapid now points at a
 * package the pool does not hold. `records` are the game's download records,
 * newest first. Only the newest successful fetch counts, so a game later
 * installed from another source is not judged by its older rapid tag.
 */
export function rapidGameUpdate(
  records: readonly DownloadRecord[],
  tags: Readonly<Record<string, RapidTagState>>,
): RapidUpdate | undefined {
  const last = records.find((r) => r.outcome === "ok");
  if (last?.source !== "rapid" || !last.reference) return undefined;
  const now = tags[last.reference];
  if (!now?.md5 || now.installed) return undefined;
  if (last.md5 && last.md5 === now.md5) return undefined;
  return { tag: last.reference, md5: now.md5 };
}

export interface EngineUpdateInput {
  /** The engines on disk. */
  installed: readonly { version: string; syncVersion?: string }[];
  recoil: readonly { version: string; prerelease: boolean }[];
  springfiles: readonly { version: string }[];
  /** Engine versions a game pins, which are not nagged about. */
  pinned: ReadonlySet<string>;
}

const startsWithNumber = (v: string) => /^\d/.test(v.trim());

/**
 * The newest listed engine version that is newer than every installed one, or
 * undefined. Nothing is offered when no real engine is installed, when the
 * newest installed engine is pinned by a game, or for a prerelease. An update
 * is an addition. It never stands for removing an installed engine.
 */
export function engineUpdate(input: EngineUpdateInput): string | undefined {
  const own = input.installed
    .map((e) => e.syncVersion ?? e.version)
    .filter((v) => isRealEngineVersion(v) && startsWithNumber(v));
  if (own.length === 0) return undefined;
  const newest = own.reduce((a, b) =>
    compareEngineVersions(b, a) > 0 ? b : a,
  );
  const newestEngine = input.installed.find(
    (e) => (e.syncVersion ?? e.version) === newest,
  );
  const held = [newestEngine?.version, newestEngine?.syncVersion].some(
    (v) => v !== undefined && input.pinned.has(v),
  );
  if (held) return undefined;
  const listed = [
    ...input.recoil.filter((e) => !e.prerelease).map((e) => e.version),
    ...input.springfiles.map((e) => e.version),
  ].filter(startsWithNumber);
  let best: string | undefined;
  for (const v of listed) {
    if (compareEngineVersions(v, newest) <= 0) continue;
    if (!best || compareEngineVersions(v, best) > 0) best = v;
  }
  return best;
}

/** The number the topbar badge shows: games with an update, plus a newer engine. */
export function countUpdates({
  games,
  engine,
}: {
  games: readonly Pick<LibraryGame, "state">[];
  engine: string | undefined;
}): number {
  return games.filter((g) => g.state === "update").length + (engine ? 1 : 0);
}
