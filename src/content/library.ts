import { createGameResolver, stripVersion } from "../career/games";
import type {
  EvolutionRtsMap,
  HakoraMap,
  ReleaseArchive,
  SpringFile,
} from "../downloads/bindings";
import type { QueueItem } from "../downloads/DownloadQueueProvider";
import {
  type DownloadHistory,
  downloadKey,
  recordsFor,
} from "../downloads/downloadHistory";
import type { HubGame } from "../hub/api";
import { compareGameVersions } from "../play/installedGames";
import type { GameItem, MapItem, ScanResult } from "./bindings";
import {
  githubGameUpdate,
  type RapidTagState,
  type RapidUpdate,
  rapidGameUpdate,
} from "./updates";

/**
 * Where a game or map stands for the player.
 *
 * - `installed`: on disk, and some catalogue lists it.
 * - `update`: on disk, and a catalogue has a newer version (games only).
 * - `downloading` / `queued`: the download queue holds it.
 * - `available`: a catalogue lists it and it is not on disk.
 * - `local`: on disk, and no catalogue lists it.
 * - `noSource`: the hub lists it with no download, and no mirror has it.
 */
export type LibraryState =
  | "installed"
  | "update"
  | "downloading"
  | "queued"
  | "available"
  | "local"
  | "noSource";

export type LibrarySourceKind =
  | "springfiles"
  | "hakora"
  | "evolutionrts"
  | "github";

/** One archive a mirror index offers for a game or map. */
export interface LibrarySource {
  kind: LibrarySourceKind;
  /** The `owner/name` repo, for a GitHub release archive. */
  repo?: string;
  filename: string;
  /** The direct address. Springfiles lists every mirror in `mirrors`. */
  url?: string;
  /** Every springfiles mirror, best first. */
  mirrors?: string[];
  /** The springfiles spring name, which pr-downloader fetches by. */
  springName?: string;
  /** Bytes, or the mirror's own text for hakora. */
  size?: number | string;
  /** The GitHub release tag. */
  tag?: string;
  /** When the source says the archive was published. */
  date?: string;
  /** The version read from a game archive's name. */
  version?: string;
  /** Springfiles map art and metadata. */
  thumb?: string;
  author?: string;
  width?: number;
  height?: number;
  /** This archive is on disk. */
  installed: boolean;
}

/**
 * Which queue item holds a game or map, and how it stands. Progress is left
 * out because it changes many times a second: read it from the queue by
 * `identity`.
 */
export type LibraryDownload = Pick<
  QueueItem,
  "id" | "identity" | "status" | "error"
>;

export interface LibraryGame {
  /** The hub shortname, or the game's name without its version, lower case. */
  id: string;
  title: string;
  state: LibraryState;
  /** Every scanned version, newest first. Empty when not installed. */
  installed: GameItem[];
  hub?: HubGame;
  sources: LibrarySource[];
  /**
   * The newest GitHub release the game is not on, or a mirror's archive with a
   * higher version than the newest installed.
   */
  update?: LibrarySource;
  /** The rapid tag the game was fetched from now points at a new package. */
  rapidUpdate?: RapidUpdate;
  /** The queue's item for this game, running or not. */
  download?: LibraryDownload;
}

export interface LibraryMap {
  /** The spring name, or the archive name without its extension. */
  id: string;
  state: LibraryState;
  /** The scan's entry. Missing for a map only the disk listing found. */
  installed?: MapItem;
  /** The map's archive is on disk, whether or not the scan has read it. */
  onDisk: boolean;
  sources: LibrarySource[];
  download?: LibraryDownload;
}

/** A mirror index that has been read, as the merge takes it. */
export type LoadedCatalogue =
  | { source: "springfiles"; kind: "map" | "game"; entries: SpringFile[] }
  | { source: "hakora"; entries: HakoraMap[] }
  | { source: "evolutionrts"; entries: EvolutionRtsMap[] }
  | {
      source: "github";
      kind: "map" | "game";
      repo: string;
      entries: ReleaseArchive[];
    };

export interface LibraryInput {
  /** The unitsync scan, or null before it lands. */
  scan: Pick<ScanResult, "games" | "maps"> | null;
  /** Lowercased archive names on disk across every content root. */
  files: { maps: readonly string[]; games: readonly string[] } | null;
  hubGames: readonly HubGame[] | null;
  catalogues: readonly LoadedCatalogue[];
  queue: readonly QueueItem[];
  /** Where each item came from, so a rapid game's tag is known. */
  history?: DownloadHistory;
  /** What each rapid tag points at now, for the tags the history names. */
  rapidVersions?: Readonly<Record<string, RapidTagState>>;
}

export interface Library {
  games: LibraryGame[];
  maps: LibraryMap[];
  /**
   * Lowercased archive names on disk or in the scan. One archive is installed
   * when its name is in here, which is the one test every page uses.
   */
  installedFiles: { maps: Set<string>; games: Set<string> };
}

const lc = (s: string) => s.toLowerCase();
const stem = (filename: string) => filename.replace(/\.(sd7|sdz)$/i, "");
/** A version compares the same with or without a leading v. */
const bareVersion = (v: string) => v.trim().replace(/^v(?=\d)/i, "");

function sourceKind(item: QueueItem): "map" | "game" | null {
  switch (item.kind) {
    case "map":
    case "mapAnySource":
      return "map";
    case "game":
    case "rapid":
      return "game";
    case "file":
      if (item.args.destDir.endsWith("/maps")) return "map";
      if (item.args.destDir.endsWith("/games")) return "game";
      return null;
    default:
      return null;
  }
}

/** The running item over a waiting one, and either over a settled one. */
function pick(
  held: LibraryDownload | undefined,
  next: QueueItem,
): LibraryDownload {
  const rank = (i: LibraryDownload) =>
    i.status === "active" ? 2 : i.status === "queued" ? 1 : 0;
  if (held && rank(next) < rank(held)) return held;
  const { id, identity, status, error } = next;
  return { id, identity, status, error };
}

function stateOf(
  installed: boolean,
  listed: boolean,
  download: LibraryDownload | undefined,
  update: boolean,
  noSource: boolean,
): LibraryState {
  if (download?.status === "active") return "downloading";
  if (download?.status === "queued") return "queued";
  if (installed) return update ? "update" : listed ? "installed" : "local";
  return noSource ? "noSource" : "available";
}

function installedFilesOf(input: LibraryInput): Library["installedFiles"] {
  const maps = new Set(input.files?.maps.map(lc));
  const games = new Set(input.files?.games.map(lc));
  for (const m of input.scan?.maps ?? []) {
    for (const a of m.archives) maps.add(lc(a.name));
    if (m.fileName) maps.add(lc(m.fileName));
  }
  for (const g of input.scan?.games ?? []) {
    games.add(lc(g.primaryArchive.name));
  }
  return { maps, games };
}

function buildGames(
  input: LibraryInput,
  installedFiles: Set<string>,
): LibraryGame[] {
  const scanned = input.scan?.games ?? null;
  const resolver = createGameResolver(scanned);
  const records = new Map<string, LibraryGame>();
  /** An archive name, lowercased, to the record it belongs to. */
  const byFile = new Map<string, string>();
  /** A hub title's key to the hub game's key, so a mirror's name finds it. */
  const aliases = new Map<string, string>();

  const record = (id: string, title: string): LibraryGame => {
    let r = records.get(id);
    if (!r) {
      r = { id, title, state: "available", installed: [], sources: [] };
      records.set(id, r);
    }
    return r;
  };
  const keyOfName = (name: string) => {
    const id = resolver.byName(name);
    return { key: aliases.get(id.key) ?? id.key, title: id.title };
  };

  for (const g of scanned ?? []) {
    const id = resolver.byName(g.name);
    record(id.key, id.title).installed.push(g);
    byFile.set(lc(g.primaryArchive.name), id.key);
  }

  for (const h of input.hubGames ?? []) {
    let id = resolver.byShortname(h.shortname);
    if (!id.installed) {
      const byTitle = resolver.byName(h.title);
      if (byTitle.installed) id = byTitle;
      else aliases.set(byTitle.key, id.key);
    }
    const r = record(id.key, id.installed ? id.title : h.title);
    r.hub = h;
  }

  const addSource = (name: string, source: LibrarySource) => {
    const file = lc(source.filename);
    const found = byFile.get(file);
    const { key, title } = found ? { key: found, title: "" } : keyOfName(name);
    const r = record(key, title);
    r.sources.push({
      ...source,
      version: name.slice(stripVersion(name).length).trim() || undefined,
    });
    if (!found) byFile.set(file, key);
  };

  for (const c of input.catalogues) {
    if (c.source === "springfiles" && c.kind === "game") {
      for (const f of c.entries) {
        addSource(f.springname || f.name, {
          kind: "springfiles",
          filename: f.filename,
          springName: f.springname,
          url: f.mirrors[0],
          mirrors: f.mirrors,
          size: f.size,
          date: f.timestamp ?? undefined,
          installed: installedFiles.has(lc(f.filename)),
        });
      }
    } else if (c.source === "github" && c.kind === "game") {
      for (const a of c.entries) {
        addSource(stem(a.filename).replace(/_/g, " "), {
          kind: "github",
          repo: c.repo,
          filename: a.filename,
          url: a.url,
          size: a.size,
          tag: a.tag,
          date: a.publishedAt ?? undefined,
          installed: installedFiles.has(lc(a.filename)),
        });
      }
    }
  }

  // An archive on disk that neither the scan nor a catalogue accounts for
  // gets a record of its own.
  const onDisk = new Set<string>();
  for (const file of installedFiles) {
    let key = byFile.get(file);
    if (!key) {
      const id = keyOfName(stem(file).replace(/_/g, " "));
      key = record(id.key, id.title).id;
      byFile.set(file, key);
    }
    onDisk.add(key);
  }

  const rapidTags = new Map<string, string>();
  for (const r of records.values()) {
    for (const d of r.hub?.downloads ?? []) {
      if (d.kind === "rapid") rapidTags.set(d.value, r.id);
    }
  }
  for (const item of input.queue) {
    if (sourceKind(item) !== "game") continue;
    let key: string | undefined;
    if (item.kind === "rapid") {
      // A rapid tag names a game only through the hub's download list. Other
      // tags are AIs and the like.
      key = rapidTags.get(item.args.tag);
      if (!key) continue;
    } else if (item.kind === "file") key = byFile.get(lc(item.args.filename));
    if (!key) {
      const name = item.kind === "game" ? item.args.gameName : item.label;
      key = keyOfName(name).key;
    }
    const r = records.get(key);
    if (r) r.download = pick(r.download, item);
    else if (item.status === "active" || item.status === "queued") {
      record(key, item.label).download = pick(undefined, item);
    }
  }

  for (const r of records.values()) {
    r.installed.sort((a, b) =>
      compareGameVersions(
        bareVersion(b.info.version ?? ""),
        bareVersion(a.info.version ?? ""),
      ),
    );
    r.update = githubGameUpdate(r.sources);
    const keys = new Set([
      `game:${r.id}`,
      downloadKey("game", r.title),
      ...r.installed.map((g) => downloadKey("game", g.name)),
    ]);
    r.rapidUpdate = rapidGameUpdate(
      recordsFor(input.history ?? {}, ...keys),
      input.rapidVersions ?? {},
    );
    // A GitHub release is judged above by its archives. A mirror that names no
    // release is judged by the version in the archive's name.
    const newest = r.installed[0]?.info.version;
    if (newest && !r.update) {
      for (const s of r.sources) {
        if (s.kind === "github" || s.installed || !s.version) continue;
        const ahead =
          compareGameVersions(bareVersion(s.version), bareVersion(newest)) > 0;
        const best =
          !r.update?.version ||
          compareGameVersions(
            bareVersion(s.version),
            bareVersion(r.update.version),
          ) > 0;
        if (ahead && best) r.update = s;
      }
    }
    if (!r.title) r.title = r.installed[0]?.name ?? r.id;
    r.state = stateOf(
      r.installed.length > 0 || onDisk.has(r.id),
      !!r.hub || r.sources.length > 0,
      r.download,
      !!r.update || !!r.rapidUpdate,
      r.sources.length === 0 && r.hub?.downloads.length === 0,
    );
  }
  return [...records.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function buildMaps(
  input: LibraryInput,
  installedFiles: Set<string>,
): LibraryMap[] {
  const records = new Map<string, LibraryMap>();
  const byFile = new Map<string, string>();

  const record = (id: string): LibraryMap => {
    let r = records.get(lc(id));
    if (!r) {
      r = { id, state: "available", onDisk: false, sources: [] };
      records.set(lc(id), r);
    }
    return r;
  };

  for (const m of input.scan?.maps ?? []) {
    const r = record(m.name);
    r.installed ??= m;
    for (const a of m.archives) byFile.set(lc(a.name), lc(m.name));
    if (m.fileName) byFile.set(lc(m.fileName), lc(m.name));
  }

  // Springfiles names its maps, so it goes first and the mirrors that only
  // give a file name can find the spring name through it.
  const ordered = [...input.catalogues].sort(
    (a, b) =>
      Number(b.source === "springfiles") - Number(a.source === "springfiles"),
  );
  const add = (springName: string | undefined, source: LibrarySource) => {
    const file = lc(source.filename);
    const found = byFile.get(file) ?? (springName ? lc(springName) : undefined);
    const r = found
      ? (records.get(found) ?? record(springName ?? stem(source.filename)))
      : record(stem(source.filename));
    r.sources.push(source);
    byFile.set(file, lc(r.id));
  };
  for (const c of ordered) {
    if (c.source === "springfiles" && c.kind === "map") {
      for (const f of c.entries) {
        add(f.springname, {
          kind: "springfiles",
          filename: f.filename,
          springName: f.springname,
          url: f.mirrors[0],
          mirrors: f.mirrors,
          size: f.size,
          date: f.timestamp ?? undefined,
          thumb: f.mapimages[0],
          author: f.metadata.author || undefined,
          width: f.metadata.width || undefined,
          height: f.metadata.height || undefined,
          installed: installedFiles.has(lc(f.filename)),
        });
      }
    } else if (c.source === "hakora" || c.source === "evolutionrts") {
      for (const f of c.entries) {
        add(undefined, {
          kind: c.source,
          filename: f.filename,
          url: f.url,
          size: f.size,
          installed: installedFiles.has(lc(f.filename)),
        });
      }
    } else if (c.source === "github" && c.kind === "map") {
      for (const a of c.entries) {
        add(undefined, {
          kind: "github",
          repo: c.repo,
          filename: a.filename,
          url: a.url,
          size: a.size,
          tag: a.tag,
          date: a.publishedAt ?? undefined,
          installed: installedFiles.has(lc(a.filename)),
        });
      }
    }
  }

  for (const file of installedFiles) {
    const key = byFile.get(file);
    if (key) {
      const r = records.get(key);
      if (r) r.onDisk = true;
      continue;
    }
    const r = record(stem(file));
    r.onDisk = true;
    byFile.set(file, lc(r.id));
  }

  for (const item of input.queue) {
    if (sourceKind(item) !== "map") continue;
    const key =
      item.kind === "map"
        ? lc(item.args.springName)
        : item.kind === "mapAnySource"
          ? lc(item.args.mapName)
          : item.kind === "file"
            ? (byFile.get(lc(item.args.filename)) ??
              lc(stem(item.args.filename)))
            : undefined;
    if (!key) continue;
    const r = records.get(key);
    if (r) r.download = pick(r.download, item);
    else if (item.status === "active" || item.status === "queued") {
      const name =
        item.kind === "map"
          ? item.args.springName
          : item.kind === "mapAnySource"
            ? item.args.mapName
            : item.label;
      record(name).download = pick(undefined, item);
    }
  }

  for (const r of records.values()) {
    r.state = stateOf(
      !!r.installed || r.onDisk,
      r.sources.length > 0,
      r.download,
      false,
      false,
    );
  }
  return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * One record per game and per map, merging the scan, the disk listing, the hub
 * games list, the mirror indexes and the download queue.
 *
 * A map is known by its spring name. A mirror that gives only a file name is
 * matched through the scan's archives and springfiles' file names, and falls
 * back to the file name without its extension. A game is known by its hub
 * shortname, or by its name without the version (see `createGameResolver`). A
 * mirror's game name meets the hub's entry through the hub title.
 */
export function buildLibrary(input: LibraryInput): Library {
  const installedFiles = installedFilesOf(input);
  return {
    games: buildGames(input, installedFiles.games),
    maps: buildMaps(input, installedFiles.maps),
    installedFiles,
  };
}
