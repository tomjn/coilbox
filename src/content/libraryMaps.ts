import type { MessageDescriptor } from "@lingui/core";
import { t as coreT, msg, plural } from "@lingui/core/macro";
import { formatBytes } from "@/lib/format";
import type { EnqueueInput } from "../downloads/DownloadQueueProvider";
import { parseApacheSize } from "../downloads/queueLanes";
import { mapSampleExtent } from "../hub/maps/facts";
import type { MapFacts } from "../hub/maps/lookup";
import type { MapThumbData } from "./config";
import type { LibraryMap, LibrarySourceKind } from "./library";
import type { CatalogueRequest } from "./useLibrary";

/** The GitHub repos whose releases carry maps, from skylobby's source list. */
export const MAP_REPOS = ["beyond-all-reason/Maps", "FluidPlay/TAP-maps"];

/** Every mirror index the Maps page merges. */
export const MAP_CATALOGUES: readonly CatalogueRequest[] = [
  { source: "springfiles", kind: "map" },
  { source: "hakora" },
  { source: "evolutionrts" },
  ...MAP_REPOS.map((repo) => ({
    source: "github" as const,
    kind: "map" as const,
    repo,
  })),
];

/** A mirror index's name, as a player would know it. */
export function catalogueLabel(c: CatalogueRequest): string {
  return c.source === "github" ? c.repo : c.source;
}

/**
 * The Maps page's filter chips, in the order they are shown. My Maps and New
 * Maps narrow by state. The other three are play types over every map, read
 * off the hub's facts for the map (see {@link mapPlayTypes}).
 */
export const MAP_CHIPS = [
  { value: "installed", label: msg`My Maps` },
  { value: "notInstalled", label: msg`New Maps` },
  { value: "1v1", label: msg`1v1` },
  { value: "team", label: msg`Team` },
  { value: "water", label: msg`Water` },
] as const;

export type MapChip = (typeof MAP_CHIPS)[number]["value"];
export type PlayType = Extract<MapChip, "1v1" | "team" | "water">;

export const isPlayType = (chip: MapChip): chip is PlayType =>
  chip === "1v1" || chip === "team" || chip === "water";

/**
 * The play types a map suits, from the hub's facts.
 *
 * The start count is how many spawn markers the author placed, not a player
 * count (issue #2414), so the two chips that read it are broad: two starts is
 * a 1v1 map and four or more is a team map. A maintainer's `1v1` tag also
 * counts, for a map drawn for two that places more starts. Water is the hub's
 * own `water map` tag, which it derives from the water coverage, so the
 * threshold lives in one place.
 */
export function mapPlayTypes(facts: MapFacts): Set<PlayType> {
  const starts = facts.points.start.length;
  const tags = new Set(facts.tags.map((t) => t.toLowerCase()));
  const types = new Set<PlayType>();
  if (starts === 2 || tags.has("1v1")) types.add("1v1");
  if (starts >= 4) types.add("team");
  if (tags.has("water map")) types.add("water");
  return types;
}

/** Some version of the map is on disk. */
export function isMapOnDisk(m: LibraryMap): boolean {
  return (
    !!m.installed || m.onDisk || m.state === "installed" || m.state === "local"
  );
}

/** Whether a state chip shows the map. A play type chip shows every map its
 *  facts match, so it asks {@link matchesPlayType} instead. */
export function matchesMapScope(m: LibraryMap, chip: MapChip): boolean {
  if (chip === "installed") return isMapOnDisk(m);
  if (chip === "notInstalled") return !isMapOnDisk(m);
  return true;
}

export function matchesPlayType(
  facts: MapFacts | undefined,
  type: PlayType,
): boolean {
  return !!facts && mapPlayTypes(facts).has(type);
}

export function matchesMapSearch(m: LibraryMap, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    m.id.toLowerCase().includes(q) ||
    m.sources.some((s) => s.filename.toLowerCase().includes(q))
  );
}

export type MapSort = "name-asc" | "name-desc" | "area-desc" | "area-asc";

export const MAP_SORT_OPTIONS: { value: MapSort; label: MessageDescriptor }[] =
  [
    { value: "name-asc", label: msg`Name A–Z` },
    { value: "name-desc", label: msg`Name Z–A` },
    { value: "area-desc", label: msg`Largest` },
    { value: "area-asc", label: msg`Smallest` },
  ];

/**
 * The map's size in squares: the local thumbnail pass for an installed map,
 * then the springfiles index, then the hub.
 */
export function mapSquares(
  m: LibraryMap,
  thumb: MapThumbData | undefined,
  facts: MapFacts | undefined,
): { width: number; height: number } | null {
  const w = thumb?.width ?? m.installed?.width;
  const h = thumb?.height ?? m.installed?.height;
  if (w && h) return { width: w / 32, height: h / 32 };
  const listed = m.sources.find((s) => s.width && s.height);
  if (listed?.width && listed.height) {
    return { width: listed.width, height: listed.height };
  }
  const hub = mapSampleExtent(facts);
  return hub ? { width: hub.width / 32, height: hub.height / 32 } : null;
}

export function sortMaps(
  maps: readonly LibraryMap[],
  sort: MapSort,
  areaOf: (m: LibraryMap) => number,
): LibraryMap[] {
  const byName = (a: LibraryMap, b: LibraryMap) => a.id.localeCompare(b.id);
  return [...maps].sort((a, b) => {
    switch (sort) {
      case "name-desc":
        return byName(b, a);
      case "area-desc":
        return areaOf(b) - areaOf(a) || byName(a, b);
      case "area-asc":
        return areaOf(a) - areaOf(b) || byName(a, b);
      default:
        return byName(a, b);
    }
  });
}

/** Each kind of source the map is on, once, in the order the record lists
 *  them. */
export function mapSourceKinds(m: LibraryMap): LibrarySourceKind[] {
  return [...new Set(m.sources.map((s) => s.kind))];
}

/**
 * The card's caption: size, start count and where the map comes from. Up to
 * two sources are named and more are counted. A queued or running download
 * names its source and size instead of the start count.
 */
export function mapCaption(
  m: LibraryMap,
  squares: { width: number; height: number } | null,
  facts: MapFacts | undefined,
): string {
  const kinds = mapSourceKinds(m);
  if (m.state === "queued" || m.state === "downloading") {
    const size = m.sources.find((s) => s.size !== undefined)?.size;
    const bytes = typeof size === "string" ? parseApacheSize(size) : size;
    return [kinds[0], bytes ? formatBytes(bytes) : null]
      .filter(Boolean)
      .join(" · ");
  }
  const starts = facts?.points.start.length ?? 0;
  const where =
    m.state === "local"
      ? coreT`not on any mirror`
      : kinds.length > 2
        ? plural(kinds.length, { one: "# source", other: "# sources" })
        : kinds.join(" · ");
  return [
    squares
      ? `${Math.round(squares.width)} × ${Math.round(squares.height)}`
      : null,
    starts > 0 ? plural(starts, { one: "# start", other: "# starts" }) : null,
    where || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The queue request that installs a map. A map on springfiles, hakora or the
 * evolutionrts mirror is fetched by name through every mirror in policy order,
 * so one dead mirror does not stop it. A map only a GitHub repo carries is
 * fetched from its release. Null when there is nothing to fetch from.
 */
export function mapInstallRequest(
  m: LibraryMap,
  writePath: string,
): EnqueueInput | null {
  const sized = m.sources.find((s) => typeof s.size === "number");
  const sizeBytes = typeof sized?.size === "number" ? sized.size : undefined;
  if (m.sources.some((s) => s.kind !== "github")) {
    return {
      kind: "mapAnySource",
      label: m.id,
      sizeBytes,
      args: { mapName: m.id, writePath },
    };
  }
  const release = m.sources.find((s) => s.url);
  if (!release?.url) return null;
  return {
    kind: "file",
    label: m.id,
    sizeBytes: typeof release.size === "number" ? release.size : undefined,
    args: {
      url: release.url,
      destDir: `${writePath}/maps`,
      filename: release.filename,
    },
  };
}
