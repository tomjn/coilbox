import { defineCommand } from "@picoframe/plugin-sdk";
import { useEffect, useState } from "react";
import type { GameItem } from "./bindings";

/**
 * Branding catalog: GitHub-hosted JSON mapping a game identity to branding assets
 * and backfill links. Fetched at runtime (disk-cached + bundled seed by the Rust
 * side); entries are matched narrowly, per-project, and catalog art wins over the
 * game's own loading-screen art.
 */

/** Default catalog URL — the copy in the main coilbox repo (main branch). */
export const DEFAULT_BRANDING_CATALOG_URL =
  "https://raw.githubusercontent.com/tomjn/coilbox/main/src-tauri/branding/catalog.json";

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
  screenshots?: BrandingScreenshot[];
  videos?: BrandingVideo[];
  links?: BrandingLink[];
}
export interface BrandingCatalog {
  version: number;
  updated?: string;
  entries: BrandingEntry[];
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
const brandingImageCmd = defineCommand<{ urls: string[] }, ImageResult>(
  "coilbox-content",
  "branding_image",
);

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

let catalogPromise: Promise<CompiledEntry[]> | null = null;

/** Load + compile the catalog once per session (module-level promise cache). */
export function loadBrandingCatalog(): Promise<CompiledEntry[]> {
  if (!catalogPromise) {
    catalogPromise = brandingCatalogCmd({ url: DEFAULT_BRANDING_CATALOG_URL })
      .then((res) => {
        const parsed = JSON.parse(res.json) as BrandingCatalog;
        return compile(parsed.entries ?? []);
      })
      .catch((e) => {
        console.warn("branding: catalog load failed", e);
        return [] as CompiledEntry[];
      });
  }
  return catalogPromise;
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
 * Resolve the first working URL to a cached `data:` URL via the Rust proxy (fetch
 * once, CSP-safe). No-ops for empty input; session-cached by the joined URL list.
 */
export function useBrandingImage(urls?: string[]): string | undefined {
  const key = urls?.length ? urls.join("\n") : "";
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!key) {
      setDataUrl(undefined);
      return;
    }
    let cancelled = false;
    let promise = imageCache.get(key);
    if (!promise) {
      promise = brandingImageCmd({ urls: key.split("\n") });
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
