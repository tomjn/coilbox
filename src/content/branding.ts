import { defineCommand } from "@picoframe/plugin-sdk";
import { useEffect, useState } from "react";
import type { ConquestNames } from "../conquest/names";
import type { GameRepo } from "../downloads/gameRepos";
import { contentBrandingUrl } from "../lib/assetUrl";
import { fetchAsDataUrl } from "../lib/dataUrl";
import type { GameAiConfig } from "../play/gameAi";
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
  /** This game's AI catalogue: ranking, standard pick, banned and mini-game
   * bots, neutral-world garrisons (see `../play/gameAi`). */
  ai?: GameAiConfig;
}
/** What an exclusion rule tests against an installed map's spring name. */
export interface MapMatch {
  /** Case-insensitive regex. The usual choice, since a map family is versioned
   * into its spring name (`Hex Farm 8`, `Hex Farm 9`) and exact names miss the rest. */
  regex?: string;
  /** Case-insensitive exact spring names. */
  names?: string[];
}

/**
 * A rule keeping maps out of warpath and galactic conquest. Aimed at maps that
 * load fine but make a nonsense match. Kernel Panic maps such as zwzsg's Hex
 * Farm carry their own LuaRules gadgets and near-zero metal, so a normal game
 * played on one has no economy.
 *
 * Exclusion is additive across the three sources (catalog, distribution profile,
 * player). Nothing re-enables a map another source excluded. It applies to
 * warpath and conquest only: the map stays visible in Content and playable in
 * skirmish and multiplayer, where the player chose it deliberately.
 */
export interface MapExclusion {
  id: string;
  match: MapMatch;
  /** Why, shown on the map's detail page. */
  reason?: string;
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
      /** A direct repo, or a `githubGameRepos` key to resolve one from the
       * unified registry (issue #512). At least one must be set. `repo` wins
       * when both are given. */
      repo?: string;
      sourceKey?: string;
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
  /** Curated maps kept out of warpath/conquest (see {@link MapExclusion}). A
   * distribution profile's `excludedMaps` and the player's own opt-outs add to
   * this list. Neither can shorten it. */
  excludedMaps?: MapExclusion[];
  /** Pre-curated content offered when the user has none yet. */
  suggested?: {
    games?: SuggestedGame[];
    maps?: SuggestedMap[];
    mapLists?: SuggestedMapList[];
  };
  /** The unified per-game GitHub source registry (issue #512): one declarative
   * list of curated release repos, consumed by both the any-source game
   * download resolver and the Downloads > Games browse dropdown, plus any
   * `suggested.games[]` entry whose `github` download references it by
   * `sourceKey`. See `downloads/gameRepos.ts` for the in-code fallback seed. */
  githubGameRepos?: GameRepo[];
}

interface CatalogResult {
  json: string;
  source: string;
  errors: string[];
}
interface ImageResult {
  /** The picture's cache file, served over `coilbox://contentbranding/`. How a
   *  resolved picture normally arrives. */
  file?: string;
  /** The picture inline, only when it had nowhere on disk to go. */
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
  githubGameRepos: GameRepo[];
  excludedMaps: MapExclusion[];
}

const EMPTY_CATALOG: LoadedCatalog = {
  entries: [],
  games: [],
  maps: [],
  mapLists: [],
  githubGameRepos: [],
  excludedMaps: [],
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
          githubGameRepos: parsed.githubGameRepos ?? [],
          excludedMaps: parsed.excludedMaps ?? [],
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
 * Whether the one catalog load has settled, either way.
 *
 * The `useSuggested*` hooks above start empty and stay empty when the load
 * fails, so on their own a caller cannot tell "not back yet" from "nothing
 * curated". A zone that must show a placeholder for one and nothing for the
 * other reads this alongside them. It shares the same module-level promise, so
 * asking costs no extra fetch and no second cache.
 */
export function useCatalogLoaded(): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadCatalog().then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return loaded;
}

/** The catalog's map-exclusion rules, loaded once. Merged with the profile's and
 * the player's by `mapEligibility.ts` (empty on load failure, so a catalog that
 * cannot be fetched never hides a map). */
export function useCatalogMapExclusions(): MapExclusion[] {
  const [rules, setRules] = useState<MapExclusion[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadCatalog().then((c) => {
      if (!cancelled) setRules(c.excludedMaps);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return rules;
}

/** Load just the catalog's `githubGameRepos` registry once per session, for
 * non-React callers (issue #512). Callers merge with the in-code fallback seed
 * via `gameRepos.ts`'s `mergeGameRepos`. Empty on load failure. */
export function loadGithubGameRepos(): Promise<GameRepo[]> {
  return loadCatalog().then((c) => c.githubGameRepos);
}

/** The catalog's `githubGameRepos` registry (issue #512), unmerged with the
 * in-code fallback seed, matching `useSuggestedMapLists`. Callers merge in the
 * fallback via `gameRepos.ts`'s `mergeGameRepos`. Empty until loaded/on failure. */
export function useGithubGameRepos(): GameRepo[] {
  const [repos, setRepos] = useState<GameRepo[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadGithubGameRepos().then((r) => {
      if (!cancelled) setRepos(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return repos;
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
 * Session-cache key for an image request. Encodes the re-encode variant (`j` =
 * JPEG re-encode, `r` = raw) then the ordered URL list, so two calls share a
 * cache entry iff they would resolve identically. Empty string for no URLs (the
 * caller then renders nothing). Self-contained so the hook's effect can depend on
 * the key alone.
 */
export function imageCacheKey(urls?: string[], reencode = false): string {
  if (!urls?.length) return "";
  return `${reencode ? "j" : "r"}\n${urls.join("\n")}`;
}

/** The `src` to draw a resolved picture with: its cache file where there is one,
 *  and the inline copy only where the Rust side had nowhere to write it. */
function imageSrc(res: ImageResult): string | undefined {
  return res.file ? contentBrandingUrl(res.file) : res.dataUrl;
}

/**
 * Promise form of {@link useBrandingImage} for imperative resolvers (e.g. the
 * faction-logo layer, which resolves many sides in one effect and can't call a
 * hook per side). Shares the same session cache. Resolves to a `src` or
 * `undefined`. `reencode=false` preserves original bytes (logos).
 */
export function resolveBrandingImage(
  urls?: string[],
  reencode = false,
): Promise<string | undefined> {
  if (!urls?.length) return Promise.resolve(undefined);
  const key = imageCacheKey(urls, reencode);
  let promise = imageCache.get(key);
  if (!promise) {
    promise = brandingImageCmd({ urls, reencode });
    imageCache.set(key, promise);
  }
  return promise.then(imageSrc).catch(() => undefined);
}

/**
 * The same picture as a base64 `data:` URL. Only the build-tree export wants
 * this, because what it writes leaves this machine and a name pointing at this
 * cache is no use to it.
 */
export async function resolveBrandingDataUrl(
  urls?: string[],
  reencode = false,
): Promise<string | undefined> {
  const src = await resolveBrandingImage(urls, reencode);
  if (!src || src.startsWith("data:")) return src;
  return await fetchAsDataUrl(src);
}

/**
 * Resolve the first working URL to a `src` via the Rust proxy, which fetches it
 * once and caches the bytes as a file. No-ops for empty input, and session-cached
 * by the joined URL list.
 *
 * Set `reencode` for opaque photographic art (banners, screenshots): the Rust side
 * downsamples and JPEG-encodes it to bound what is kept. Leave it off for logos,
 * which are usually transparent and small and must keep their original bytes.
 */
export function useBrandingImage(
  urls?: string[],
  reencode = false,
): string | undefined {
  const key = imageCacheKey(urls, reencode);
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
        if (!cancelled) setDataUrl(imageSrc(res));
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

/**
 * Generalised name for {@link useBrandingImage}: fetch any remote artwork URL once
 * through the Rust image proxy and serve the cached `data:` URL thereafter (shared
 * `coilbox-branding-images` disk cache, `.none` negative-marker TTL, reclaim). Used
 * by the download browsers so their catalog/CDN thumbnails aren't refetched every
 * visit and still render offline from cache. Kept as an alias (not a copy) so there
 * is one fetch/cache pipeline.
 */
export const useCachedImage = useBrandingImage;
