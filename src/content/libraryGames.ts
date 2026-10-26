import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import type { EnqueueInput } from "../downloads/DownloadQueueProvider";
import { downloadKey, hostOf } from "../downloads/downloadHistory";
import {
  type GamePrefsStore,
  pinnedSource,
  readGamePrefs,
  sameStep,
} from "../downloads/gamePrefs";
import type { SourceStep } from "../downloads/sourceWalk";
import type { HubGameDownload } from "../hub/api";
import { hubGameDownloadRequest } from "../hub/games/download";
import { compareGameVersions } from "../play/installedGames";
import type { LibraryGame, LibrarySource } from "./library";

/**
 * The Games page's filter chips, in the order they are shown. The labels are
 * descriptors, resolved at render.
 */
export const GAME_CHIPS = [
  { value: "installed", label: msg`My Games` },
  { value: "notInstalled", label: msg`New Games` },
  { value: "updates", label: msg`Updates` },
  { value: "featured", label: msg`Featured` },
] as const;

export type GameChip = (typeof GAME_CHIPS)[number]["value"];

export type GameSort = "featured" | "name-asc" | "name-desc";

export const GAME_SORT_OPTIONS: {
  value: GameSort;
  label: MessageDescriptor;
}[] = [
  { value: "featured", label: msg`Featured first` },
  { value: "name-asc", label: msg`Name A–Z` },
  { value: "name-desc", label: msg`Name Z–A` },
];

/** Some version of the game is on disk. */
export function isOnDisk(g: LibraryGame): boolean {
  return (
    g.installed.length > 0 ||
    g.state === "installed" ||
    g.state === "update" ||
    g.state === "local"
  );
}

/**
 * Whether a record belongs on the Games page. The hub's list is the catalogue
 * and the disk is the install state, so a game only a mirror lists stays off
 * the page unless it is on disk or downloading. A mutator belongs on its
 * parent's page, so it is left out (see `isSearchableMutator`).
 */
export function inGamesGrid(g: LibraryGame): boolean {
  return (
    !g.parent &&
    (!!g.hub ||
      isOnDisk(g) ||
      g.download?.status === "active" ||
      g.download?.status === "queued")
  );
}

/**
 * Whether a record is a mutator that a search may list. The grid shows one card
 * per game, so a mutator turns up only when the player searches for it.
 */
export function isSearchableMutator(g: LibraryGame): boolean {
  return !!g.parent && isOnDisk(g);
}

/**
 * The mutators built on the game `parentId`, by title: the installed ones, and
 * the hub's that are not installed yet.
 */
export function mutatorsOf(
  games: readonly LibraryGame[],
  parentId: string,
): LibraryGame[] {
  return games
    .filter((g) => g.parent === parentId && (g.installed.length > 0 || !!g.hub))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function matchesChip(g: LibraryGame, chip: GameChip): boolean {
  switch (chip) {
    case "installed":
      return isOnDisk(g);
    case "updates":
      return g.state === "update";
    case "featured":
      return !!g.hub?.featured;
    case "notInstalled":
      return !isOnDisk(g);
  }
}

/** How many records each chip would show. */
export function chipCounts(
  games: readonly LibraryGame[],
): Record<GameChip, number> {
  const counts = Object.fromEntries(
    GAME_CHIPS.map((c) => [c.value, 0]),
  ) as Record<GameChip, number>;
  for (const g of games) {
    for (const c of GAME_CHIPS) {
      if (matchesChip(g, c.value)) counts[c.value]++;
    }
  }
  return counts;
}

export function matchesSearch(g: LibraryGame, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    g.title.toLowerCase().includes(q) ||
    g.id.includes(q) ||
    g.installed.some(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.primaryArchive.name.toLowerCase().includes(q),
    )
  );
}

export function sortGames(
  games: readonly LibraryGame[],
  sort: GameSort,
): LibraryGame[] {
  const byTitle = (a: LibraryGame, b: LibraryGame) =>
    a.title.localeCompare(b.title);
  return [...games].sort((a, b) => {
    if (sort === "name-desc") return byTitle(b, a);
    if (sort === "featured") {
      const f = Number(!!b.hub?.featured) - Number(!!a.hub?.featured);
      if (f !== 0) return f;
    }
    return byTitle(a, b);
  });
}

const HUB_KIND_LABEL = { rapid: "rapid", github: "github", url: "direct" };

/** Where the game can be fetched from, hub sources first, without repeats. */
export function sourceKinds(g: LibraryGame): string[] {
  const kinds = [
    ...(g.hub?.downloads ?? []).map((d) => HUB_KIND_LABEL[d.kind]),
    ...g.sources.map((s) => s.kind),
  ];
  return [...new Set(kinds)];
}

/** The mirror archive with the highest version that is not on disk. */
export function bestSource(g: LibraryGame): LibrarySource | undefined {
  const candidates = g.sources.filter((s) => !s.installed && s.url);
  return candidates.sort((a, b) => {
    if (!a.version || !b.version)
      return Number(!a.version) - Number(!b.version);
    return compareGameVersions(b.version, a.version);
  })[0];
}

/**
 * The queue request for one mirror archive. A springfiles archive is fetched
 * by its spring name, so the queue walks every mirror in policy order. Any
 * other archive is fetched from its own address.
 */
export function sourceRequest(
  source: LibrarySource,
  label: string,
  writePath: string,
): EnqueueInput | null {
  const sizeBytes = typeof source.size === "number" ? source.size : undefined;
  if (source.kind === "springfiles" && source.springName) {
    return {
      kind: "game",
      label,
      args: { gameName: source.springName, writePath },
      sizeBytes,
    };
  }
  if (!source.url) return null;
  return {
    kind: "file",
    label,
    args: {
      url: source.url,
      destDir: `${writePath}/games`,
      filename: source.filename,
    },
    sizeBytes,
  };
}

/**
 * Every key the game's history and choices can be stored under: the record's
 * id, its title and each installed version's name.
 */
export function gameKeys(g: LibraryGame): string[] {
  return [
    ...new Set([
      `game:${g.id}`,
      downloadKey("game", g.title),
      ...g.installed.map((i) => downloadKey("game", i.name)),
    ]),
  ];
}

/**
 * The key the game page stores its choices under. It is the one a download
 * that knows only the game's name reads (see `downloadGame.ts`).
 */
export function gamePrefKey(g: LibraryGame): string {
  return downloadKey("game", g.installed[0]?.name ?? g.title);
}

/** The step a hub download stands for, as a pin names it. */
export function hubDownloadStep(d: HubGameDownload): SourceStep {
  return d.kind === "url"
    ? { source: "url", mirror: hostOf(d.value) }
    : { source: d.kind, mirror: null };
}

/** The hub's downloads with the pinned one first, the rest in the hub's order. */
export function pinnedHubDownloads(
  downloads: readonly HubGameDownload[],
  pin: SourceStep | undefined,
): HubGameDownload[] {
  const first = downloads.filter((d) => sameStep(pin, hubDownloadStep(d)));
  return [...first, ...downloads.filter((d) => !first.includes(d))];
}

/**
 * The queue request that installs a game: the hub's sources in the hub's
 * order with the player's pinned source first, or the best mirror archive when
 * the hub names none. Throws with the reason when nothing can be fetched.
 */
export async function installRequest(
  g: LibraryGame,
  writePath: string,
  prefs: GamePrefsStore = readGamePrefs(),
): Promise<EnqueueInput> {
  if (g.hub && g.hub.downloads.length > 0) {
    return hubGameDownloadRequest(
      pinnedHubDownloads(g.hub.downloads, pinnedSource(prefs, ...gameKeys(g))),
      `${writePath}/games`,
      g.title,
    );
  }
  const source = bestSource(g);
  const request = source && sourceRequest(source, g.title, writePath);
  if (!request) {
    const title = g.title;
    throw new Error(t`No download source for ${title}.`);
  }
  return request;
}

/**
 * The queue request that fetches a game's newer version: the newer archive
 * itself, or the rapid tag that now points at a new package.
 */
export async function updateRequest(
  g: LibraryGame,
  writePath: string,
): Promise<EnqueueInput> {
  const request = g.update && sourceRequest(g.update, g.title, writePath);
  if (request) return request;
  if (g.rapidUpdate) {
    return { kind: "rapid", label: g.title, args: { tag: g.rapidUpdate.tag } };
  }
  return installRequest(g, writePath);
}
