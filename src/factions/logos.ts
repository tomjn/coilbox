import { useEffect, useState } from "react";
import { type GameItem, unitsyncFactionLogos } from "../content/bindings";
import { resolveBrandingImage, useBrandingEntry } from "../content/branding";
import { unitsyncFactionLogoUrl } from "../lib/assetUrl";
import { getProfile, resolveProfileImage } from "../profile/profile";
import { type FactionLogoSrc, fallbackFactionLogo } from "./fallback";
import { DEFAULT_LOGO_SIZE, selectFactionLogo } from "./select";

/**
 * Resolves a faction emblem per side, size-aware so nothing is upscaled into
 * pixelation (see {@link selectFactionLogo}). `size` is the px the caller renders
 * at — a 16px sidepic is kept in a 16px picker but yields to the crisp vector
 * emblem in a 32px HUD tile. All layers run in one effect (not a hook per side),
 * sidestepping the rules-of-hooks problem of an unknown number of sides.
 */

export interface FactionLogoCtx {
  /** The game (for its branding-catalog entry). */
  game?: GameItem;
  /** Engine/data/archive for the archive `Sidepics` lookup. Omit if not installed. */
  enginePath?: string;
  dataDir?: string;
  gameArchive?: string;
  /** Side names to resolve (from `unitsyncGameInfo` sides, or a mode's stored side). */
  sideNames: string[];
  /** The px these emblems will render at (defaults to {@link DEFAULT_LOGO_SIZE}).
   * Governs whether a small archive sidepic is used or a crisper source preferred. */
  size?: number;
}

/** Lowercased-side -> resolved logo. Keyed by (game identity, sides) for the session. */
type LogoMap = Record<string, FactionLogoSrc>;

/** Session cache of resolved maps — profile/catalog/archive are all static per
 * session, so a resolved map is safe to reuse across every picker/display. */
const logoMapCache = new Map<string, LogoMap>();

/** Case-insensitive lookup in a record whose keys may be any-case side names. */
function pickCI<T>(
  rec: Record<string, T> | undefined,
  lowerSide: string,
): T | undefined {
  if (!rec) return undefined;
  for (const k of Object.keys(rec)) {
    if (k.toLowerCase() === lowerSide) return rec[k];
  }
  return undefined;
}

/**
 * Resolve emblems for every side in `ctx.sideNames`. Returns a map keyed by the
 * lowercased side name; sides that resolve to nothing are simply absent.
 */
export function useFactionLogos(ctx: FactionLogoCtx): LogoMap {
  const { game, enginePath, dataDir, gameArchive, sideNames } = ctx;
  const size = ctx.size ?? DEFAULT_LOGO_SIZE;
  const entry = useBrandingEntry(game);

  const sidesKey = sideNames
    .map((s) => s.toLowerCase())
    .sort()
    .join(",");
  const gameKey = gameArchive ?? game?.name ?? "";
  // `size` is part of the key: the same game resolves differently at 16px vs 32px.
  const cacheKey = `${dataDir ?? ""}::${enginePath ?? ""}::${gameKey}::${size}::${sidesKey}`;
  // The catalog's per-side art can vary the outcome even for the same game key.
  const catalogKey = JSON.stringify(entry?.factionLogos ?? null);

  const [map, setMap] = useState<LogoMap>(
    () => logoMapCache.get(cacheKey) ?? {},
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheKey and catalogKey are derived from every input (engine/data/archive/sides/catalog); depending on the raw values would re-run each render since sideNames is a fresh array.
  useEffect(() => {
    if (!sideNames.length) {
      setMap({});
      return;
    }
    const cached = logoMapCache.get(cacheKey);
    if (cached) {
      setMap(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      // Archive: one batch call for all sides (returns each side's PNG + size).
      const archive: Record<string, { src: string; maxDim: number }> = {};
      if (enginePath && dataDir && gameArchive) {
        try {
          const res = await unitsyncFactionLogos({
            enginePath,
            dataDir,
            gameArchive,
            sides: sideNames,
          });
          for (const e of res.logos) {
            // The cache file where there is one, and the inline copy only where
            // the worker had nowhere to write the emblem.
            const src = e.file ? unitsyncFactionLogoUrl(e.file) : e.dataUri;
            if (!src) continue;
            archive[e.side.toLowerCase()] = { src, maxDim: e.maxDim };
          }
        } catch {
          // Archive layer unavailable (e.g. worker error) — fall through per side.
        }
      }

      const profileLogos = getProfile().factionLogos;
      const result: LogoMap = {};
      for (const raw of sideNames) {
        const side = raw.toLowerCase();
        // Resolve each layer that has data for this side, then pick by precedence.
        // Profile/catalog only hit Rust when a matching entry exists, so the common
        // case (neither set) costs nothing.
        const prefPath = pickCI(profileLogos, side);
        const profile = prefPath
          ? ((await resolveProfileImage(prefPath)) ?? undefined)
          : undefined;
        const catUrls = pickCI(entry?.factionLogos, side);
        const catalog = catUrls?.length
          ? await resolveBrandingImage(catUrls, false)
          : undefined;
        const chosen = selectFactionLogo(
          {
            profile,
            archive: archive[side],
            catalog,
            fallback: fallbackFactionLogo(side),
          },
          size,
        );
        if (chosen) result[side] = chosen;
      }

      logoMapCache.set(cacheKey, result);
      if (!cancelled) setMap(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, catalogKey]);

  return map;
}

/** Convenience: resolve one side's emblem (indexes {@link useFactionLogos}). */
export function useFactionLogo(
  ctx: Omit<FactionLogoCtx, "sideNames">,
  sideName?: string,
): FactionLogoSrc | undefined {
  const map = useFactionLogos({
    ...ctx,
    sideNames: sideName ? [sideName] : [],
  });
  return sideName ? map[sideName.toLowerCase()] : undefined;
}
