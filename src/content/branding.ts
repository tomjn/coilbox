import { defineCommand } from "@picoframe/plugin-sdk";
import { useEffect, useState } from "react";
import type { ConquestAiConfig } from "../conquest/ai";
import type { ConquestNames } from "../conquest/names";
import type { GameItem, MapItem } from "./bindings";
import { withMapSource } from "./mapSource";

/**
 * Branding catalog: GitHub-hosted JSON mapping a game identity to branding assets
 * and backfill links. Fetched at runtime (disk-cached + bundled seed by the Rust
 * side); entries are matched narrowly, per-project, and catalog art wins over the
 * game's own loading-screen art.
 */

/** Default catalog URL — the copy in the main coilbox repo (main branch, repo root). */
export const DEFAULT_BRANDING_CATALOG_URL =
  "https://raw.githubusercontent.com/tomjn/coilbox/main/catalog.json";

export interface BrandingMatch {
  /** Case-insensitive regex tested against game.name. */
  regex?: string;
  /** Case-insensitive exact matches against game.name or game.info.shortname. */
  names?: string[];
}
export interface BrandingScreenshot {
  urls: string[];
  caption?: string;
}
export type BrandingVideo =
  | { kind: "youtube"; id: string; title?: string }
  | { kind: "link"; url: string; title?: string };
export interface BrandingLink {
  label: string;
  url: string;
}
export interface BrandingEntry {
  id: string;
  match: BrandingMatch;
  title?: string;
  banner?: string[];
  logo?: string[];
  /**
   * Per-side faction emblems, keyed by side name (case-insensitive, e.g. `arm`,
   * `Armada`). Each value is a fallback URL list (first that resolves wins).
   * Curated art here is preferred over a game's own tiny 16px `Sidepics/` emblem.
   */
  factionLogos?: Record<string, string[]>;
  screenshots?: BrandingScreenshot[];
  videos?: BrandingVideo[];
  links?: BrandingLink[];
  /** Galactic-conquest naming defaults for this game (see `../conquest/names`). */
  conquest?: ConquestNames;
  /** Galactic-conquest AI rules for this game (deny-list, faction pool, chickens). */
  conquestAi?: ConquestAiConfig;
}
/**
 * How a suggested item is fetched. Mirrors the downloads-plugin commands:
 * `rapid` -> dlDownload (a rapid tag), `map` -> dlDownloadMap (a springname),
 * `url` -> dlDownloadFile (a direct mirror URL streamed into `<root>/<subdir>`),
 * and `github` -> resolve a repo's release archives then dlDownloadFile the one
 * whose filename contains `asset` (or the newest), for games shipped only via
 * GitHub releases (e.g. SplinterFaction).
 */
export type SuggestedDownload =
  | { kind: "rapid"; tag: string; masterUrl?: string }
  | { kind: "map"; springName: string; searchUrl?: string }
  | { kind: "url"; url: string; filename: string; subdir?: "games" | "maps" }
  | {
      kind: "github";
      repo: string;
      asset?: string;
      subdir?: "games" | "maps";
    };

/**
 * A curated game offered on the first-run/empty screens. `entryId` borrows a
 * branding entry's banner art and `match` (so an installed copy is detected even
 * for rapid content, which has no on-disk filename in `games/`). `filename` gives
 * cheap filename-based dedup for `url`/`map` kinds.
 */
export interface SuggestedGame {
  id: string;
  title: string;
  download: SuggestedDownload;
  entryId?: string;
  banner?: string[];
  filename?: string;
  blurb?: string;
}

/** A curated map offered on the first-run/empty screens. */
export interface SuggestedMap {
  id: string;
  title: string;
  download: SuggestedDownload;
  filename?: string;
  thumb?: string[];
  blurb?: string;
}

/**
 * A named pack of maps offered for bulk download (e.g. "Space maps", "Popular
 * maps"). The maps are the same {@link SuggestedMap} shape used everywhere else,
 * so a pack's "Download all" reuses the standard download queue. Sourced from the
 * branding catalog and/or the distribution profile.
 */
export interface SuggestedMapList {
  id: string;
  title: string;
  blurb?: string;
  maps: SuggestedMap[];
}

export interface BrandingCatalog {
  version: number;
  updated?: string;
  entries: BrandingEntry[];
  /** Pre-curated content offered when the user has none yet. */
  suggested?: {
    games?: SuggestedGame[];
    maps?: SuggestedMap[];
    mapLists?: SuggestedMapList[];
  };
}

interface CatalogResult {
  json: string;
  source: string;
  errors: string[];
}
interface ImageResult {
  dataUrl?: string;
}

const brandingCatalogCmd = defineCommand<{ url: string }, CatalogResult>(
  "coilbox-content",
  "branding_catalog",
);
const brandingImageCmd = defineCommand<
  { urls: string[]; reencode: boolean },
  ImageResult
>("coilbox-content", "branding_image");

/** An entry with its regex precompiled (invalid regex -> undefined, entry kept). */
interface CompiledEntry extends BrandingEntry {
  compiledRegex?: RegExp;
}

function compile(entries: BrandingEntry[]): CompiledEntry[] {
  return entries.map((e) => {
    let compiledRegex: RegExp | undefined;
    if (e.match.regex) {
      try {
        compiledRegex = new RegExp(e.match.regex, "i");
      } catch {
        console.warn(`branding: entry "${e.id}" has an invalid regex, skipped`);
      }
    }
    return { ...e, compiledRegex };
  });
}

const eq = (a: string, b?: string) =>
  !!b && a.toLowerCase() === b.toLowerCase();

/** Does this entry match the game? names (exact) are checked before regex. */
function entryMatches(
  e: CompiledEntry,
  name: string,
  shortname?: string,
): boolean {
  if (e.match.names?.some((n) => eq(n, name) || eq(n, shortname))) return true;
  if (e.compiledRegex?.test(name)) return true;
  return false;
}

/**
 * Resolve the branding entry for a game: entries are evaluated top-to-bottom and
 * the first match wins (authors order them most-specific-first). Returns null when
 * nothing matches — the UI then keeps the game's own art.
 */
export function resolveBranding(
  entries: CompiledEntry[],
  game: GameItem,
): CompiledEntry | null {
  for (const e of entries) {
    if (entryMatches(e, game.name, game.info.shortname)) {
      return e;
    }
  }
  return null;
}

// --- hooks -----------------------------------------------------------------

interface LoadedCatalog {
  entries: CompiledEntry[];
  games: SuggestedGame[];
  maps: SuggestedMap[];
  mapLists: SuggestedMapList[];
}

const EMPTY_CATALOG: LoadedCatalog = {
  entries: [],
  games: [],
  maps: [],
  mapLists: [],
};

let catalogPromise: Promise<LoadedCatalog> | null = null;

/** Load + compile the catalog once per session (module-level promise cache). */
function loadCatalog(): Promise<LoadedCatalog> {
  if (!catalogPromise) {
    catalogPromise = brandingCatalogCmd({ url: DEFAULT_BRANDING_CATALOG_URL })
      .then((res) => {
        const parsed = JSON.parse(res.json) as BrandingCatalog;
        return {
          entries: compile(parsed.entries ?? []),
          games: parsed.suggested?.games ?? [],
          maps: (parsed.suggested?.maps ?? []).map(withMapSource),
          mapLists: (parsed.suggested?.mapLists ?? []).map((l) => ({
            ...l,
            maps: l.maps.map(withMapSource),
          })),
        };
      })
      .catch((e) => {
        console.warn("branding: catalog load failed", e);
        return EMPTY_CATALOG;
      });
  }
  return catalogPromise;
}

/** Load + compile just the branding entries once per session. */
export function loadBrandingCatalog(): Promise<CompiledEntry[]> {
  return loadCatalog().then((c) => c.entries);
}

/** The compiled catalog entries, loaded once. */
export function useBrandingCatalog(): CompiledEntry[] {
  const [entries, setEntries] = useState<CompiledEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadBrandingCatalog().then((e) => {
      if (!cancelled) setEntries(e);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return entries;
}

/** The curated game suggestions from the catalog (empty on load failure). */
export function useSuggestedGames(): SuggestedGame[] {
  const [games, setGames] = useState<SuggestedGame[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadCatalog().then((c) => {
      if (!cancelled) setGames(c.games);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return games;
}

/** The curated map suggestions from the catalog (empty on load failure). */
export function useSuggestedMaps(): SuggestedMap[] {
  const [maps, setMaps] = useState<SuggestedMap[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadCatalog().then((c) => {
      if (!cancelled) setMaps(c.maps);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return maps;
}

/** The curated map packs from the catalog (empty on load failure). */
export function useSuggestedMapLists(): SuggestedMapList[] {
  const [lists, setLists] = useState<SuggestedMapList[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadCatalog().then((c) => {
      if (!cancelled) setLists(c.mapLists);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return lists;
}

/**
 * Art URLs for a suggested game: the referenced branding entry's banner wins,
 * else the suggestion's own inline `banner`. Undefined when neither is present.
 */
export function resolveSuggestedArt(
  entries: CompiledEntry[],
  game: SuggestedGame,
): string[] | undefined {
  const entry = game.entryId
    ? entries.find((e) => e.id === game.entryId)
    : undefined;
  const art = entry?.banner ?? game.banner;
  return art?.length ? art : undefined;
}

const has = (set: Set<string>, name?: string) =>
  !!name && set.has(name.toLowerCase());

/**
 * Drop suggested games the user already has. `url`/`map` kinds are matched by
 * filename against `installed` (from dlInstalledContent); `rapid` kinds have no
 * on-disk filename in `games/`, so they're matched by the referenced branding
 * entry's `match` against the scanned game names (empty until a scan exists).
 */
export function filterUninstalledGames(
  suggestions: SuggestedGame[],
  entries: CompiledEntry[],
  installed: Set<string>,
  scannedGames: GameItem[],
): SuggestedGame[] {
  return suggestions.filter((g) => {
    if (has(installed, g.filename)) return false;
    const entry = g.entryId
      ? entries.find((e) => e.id === g.entryId)
      : undefined;
    if (
      entry &&
      scannedGames.some((s) => entryMatches(entry, s.name, s.info.shortname))
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Drop suggested maps the user already has: by filename against `installed`, or
 * by the map's spring name / title against the scanned map names.
 */
export function filterUninstalledMaps(
  suggestions: SuggestedMap[],
  installed: Set<string>,
  scannedMaps: MapItem[],
): SuggestedMap[] {
  const names = new Set(scannedMaps.map((m) => m.name.toLowerCase()));
  return suggestions.filter((m) => {
    if (has(installed, m.filename)) return false;
    const springName =
      m.download.kind === "map" ? m.download.springName : undefined;
    if (has(names, springName) || has(names, m.title)) return false;
    return true;
  });
}

/**
 * The branding entry matching a game (or null). Accepts `undefined` so it can be
 * called unconditionally before a page's early-return guards (rules of hooks).
 */
export function useBrandingEntry(
  game: GameItem | undefined,
): BrandingEntry | null {
  const entries = useBrandingCatalog();
  const entry = game ? resolveBranding(entries, game) : null;
  useEffect(() => {
    if (game && entry)
      console.debug(`branding: "${game.name}" -> entry "${entry.id}"`);
  }, [game, entry]);
  return entry;
}

const imageCache = new Map<string, Promise<ImageResult>>();

/**
 * Promise form of {@link useBrandingImage} for imperative resolvers (e.g. the
 * faction-logo layer, which resolves many sides in one effect and can't call a
 * hook per side). Shares the same session cache. Resolves to the cached `data:`
 * URL or `undefined`. `reencode=false` preserves original bytes (logos).
 */
export function resolveBrandingImage(
  urls?: string[],
  reencode = false,
): Promise<string | undefined> {
  if (!urls?.length) return Promise.resolve(undefined);
  const key = `${reencode ? "j" : "r"}\n${urls.join("\n")}`;
  let promise = imageCache.get(key);
  if (!promise) {
    promise = brandingImageCmd({ urls, reencode });
    imageCache.set(key, promise);
  }
  return promise.then((r) => r.dataUrl ?? undefined).catch(() => undefined);
}

/**
 * Resolve the first working URL to a cached `data:` URL via the Rust proxy (fetch
 * once, CSP-safe). No-ops for empty input; session-cached by the joined URL list.
 *
 * Set `reencode` for opaque photographic art (banners, screenshots): the Rust side
 * downsamples and JPEG-encodes it to bound the data URL. Leave it off for logos,
 * which are usually transparent and small and must keep their original bytes.
 */
export function useBrandingImage(
  urls?: string[],
  reencode = false,
): string | undefined {
  const key = urls?.length ? `${reencode ? "j" : "r"}\n${urls.join("\n")}` : "";
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!key) {
      setDataUrl(undefined);
      return;
    }
    let cancelled = false;
    let promise = imageCache.get(key);
    if (!promise) {
      // key = "<variant>\n<url>\n<url>..." — self-contained so the effect need
      // only depend on `key` (variant "j" = re-encode as JPEG, "r" = raw).
      const [variant, ...urlList] = key.split("\n");
      promise = brandingImageCmd({ urls: urlList, reencode: variant === "j" });
      imageCache.set(key, promise);
    }
    promise
      .then((res) => {
        if (!cancelled) setDataUrl(res.dataUrl ?? undefined);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return dataUrl;
}
