import { useEffect, useState } from "react";
import { LayoutPlan } from "@/blueprint/LayoutPlan";
import { asContainer, decodeContainerText } from "@/container/container";
import {
  THUMB_MINIMAP_MIP,
  useScanTargetSelection,
  useUnitsyncMinimap,
} from "@/content/config";
import { shareInFlight } from "@/content/inFlight";
import { fetchImportPlan } from "@/deeplink/fetchImport";
import { fetchImportText } from "@/deeplink/fetchText";
import { cn } from "@/lib/utils";
import { fetchHubItem, type HubItem, type HubKind } from "../../api";
import { MapOutline } from "../../assets/MapPicture";
import {
  useMapPictureLadder,
  useMapPictureRung,
} from "../../assets/useMapPicture";
import { KindIcon } from "../../components/KindIcon";
import { useHubUrl } from "../../config";
import {
  type BlueprintShape,
  type GalaxyShape,
  type HubPreview,
  type RunShape,
  readPreview,
} from "../../preview";
import { Galaxy, RunMap } from "./ItemPreview";

/**
 * The art slot on a hub browse card (issue #2559). Nine cards of title, badge
 * and chips read as one undifferentiated block, so every card gets a picture,
 * filled in the order the issue sets out: a map picture, then a blueprint's own
 * layout, then a conquest challenge's own galaxy (issue #2598), then a warpath
 * challenge's own run (issue #2599), then a tinted plate carrying the kind
 * glyph everything else already has in its badge.
 *
 * The slot is a fixed `aspect-video` box regardless of which fills it, so a
 * picture that resolves after the grid first paints - a minimap render, a
 * blueprint's or challenge's container fetch - never reflows the row it sits
 * in. It is
 * `aria-hidden`: the card's title link already names the item and its badge
 * already names the kind, so the picture, the plan and the glyph all repeat
 * something a screen reader has already been told, and would otherwise say it a
 * second time.
 */
export function BrowseCardArt({ item }: { item: HubItem }) {
  // A setup pack can carry a `map_name` (its first map, issue #1721) but draws
  // as its own list of maps on the item page rather than as one picture, so it
  // is excluded here the same way `ItemPage.tsx`'s `ItemMapPicture` excludes it.
  const showMap = !!item.map_name && item.kind !== "setup-pack";

  return (
    <div
      aria-hidden="true"
      className="aspect-video w-full shrink-0 overflow-hidden rounded-md border border-border bg-muted"
    >
      {showMap ? (
        <MapArt mapName={item.map_name as string} />
      ) : item.kind === "blueprint" ? (
        <BlueprintArt item={item} />
      ) : item.kind === "challenge" && item.mode === "conquest" ? (
        <ConquestArt item={item} />
      ) : item.kind === "challenge" && item.mode === "warpath" ? (
        <WarpathArt item={item} />
      ) : item.kind === "scenario" ? (
        <ScenarioArt item={item} />
      ) : (
        <KindArt item={item} />
      )}
    </div>
  );
}

/**
 * A map's picture, at thumbnail resolution: the same ladder the item page reads
 * (`../../assets/picture.ts`), through the mip `THUMB_MINIMAP_MIP` reserves for
 * "a screen showing hundreds of rows" rather than the full 1024px render a
 * single map page asks for. The ladder always answers, down to a drawn outline
 * when nothing has a picture, so this never has an empty case of its own.
 */
function MapArt({ mapName }: { mapName: string }) {
  const { selected } = useScanTargetSelection();
  const minimap = useUnitsyncMinimap(
    selected?.enginePath,
    selected?.rootPath,
    mapName,
    THUMB_MINIMAP_MIP,
  );
  const ladder = useMapPictureLadder(mapName, minimap.url);
  const { picture, onError } = useMapPictureRung(ladder);

  if (picture.from === "placeholder") {
    return (
      <div className="flex size-full items-center justify-center p-3">
        <MapOutline picture={picture} className="max-h-full max-w-full" />
      </div>
    );
  }

  return (
    <img
      src={picture.url}
      // Decorative: the parent slot is `aria-hidden`, and the map's own name is
      // already the card's "By map" chip below.
      alt=""
      loading="lazy"
      onError={onError}
      className="size-full object-cover"
    />
  );
}

/**
 * A blueprint's layout, read off the same container the item page fetches for
 * `ItemPreview.tsx` - there is no image stored anywhere for a blueprint, only
 * the build order the container carries. Drawn with no unit pictures: the item
 * page's version looks each building's picture up too, and doing that for
 * every blueprint card on a page of results would fan one container fetch out
 * into one more fetch per building. `LayoutPlan` draws a plain outline without
 * them, which is enough to read as a base at thumbnail size.
 *
 * While the container has not arrived yet, or turned out not to be a blueprint
 * after all, the slot falls back to {@link KindArt} - the same box, same size,
 * so the fetch landing does not reflow the card.
 */
function BlueprintArt({ item }: { item: HubItem }) {
  const hubUrl = useHubUrl();
  const layout = useBlueprintCardLayout(hubUrl, item.id);

  if (!layout) return <KindArt item={item} />;

  return (
    <div className="flex size-full items-center justify-center p-2">
      <LayoutPlan shape={layout} className="size-full" />
    </div>
  );
}

/**
 * A conquest challenge's galaxy, read off the same container the item page
 * fetches for `ItemPreview.tsx` - there is no image stored anywhere for a
 * challenge, only the settings its galaxy is regenerated from. Drawn with the
 * same `Galaxy` component the item page uses, sized to fill the card rather
 * than capped at a column's width.
 *
 * While the container has not arrived yet, or turned out not to be a conquest
 * challenge with a galaxy to draw after all, the slot falls back to
 * {@link KindArt} - the same box, same size, so the fetch landing does not
 * reflow the card.
 */
function ConquestArt({ item }: { item: HubItem }) {
  const hubUrl = useHubUrl();
  const galaxy = useConquestCardGalaxy(hubUrl, item.id);

  if (!galaxy) return <KindArt item={item} />;

  return (
    <div className="flex size-full items-center justify-center p-2">
      <Galaxy shape={galaxy} className="size-full" />
    </div>
  );
}

/**
 * A warpath challenge's run, read off the same container the item page
 * fetches for `ItemPreview.tsx` - there is no image stored anywhere for a
 * challenge, only the settings its run is regenerated from. Drawn with the
 * same `RunMap` component the item page uses, with its legend left off: seven
 * swatches under an already card-sized drawing would be smaller than anyone
 * could read.
 *
 * While the container has not arrived yet, or turned out not to be a warpath
 * challenge with a run to draw after all, the slot falls back to
 * {@link KindArt} - the same box, same size, so the fetch landing does not
 * reflow the card.
 */
function WarpathArt({ item }: { item: HubItem }) {
  const hubUrl = useHubUrl();
  const run = useWarpathCardRun(hubUrl, item.id);

  if (!run) return <KindArt item={item} />;

  return (
    <div className="flex size-full items-center justify-center p-2">
      <RunMap shape={run} className="size-full" legend={false} />
    </div>
  );
}

/**
 * A scenario's own map, read off the same container the item page fetches for
 * `ItemPreview.tsx`. The listing's `map_name` is null for every scenario today
 * (issue #2600: the hub does not populate it at publish time), so this is the
 * only way to learn it - the container names the map at `setup.mapName`, and
 * `scenarioPreview()` reads it in. Draws with {@link MapArt}, the same
 * minimap a preset's card gets from its listing field.
 *
 * While the container has not arrived yet, or the scenario turns out to have
 * no map name after all (an unset draft), the slot falls back to
 * {@link KindArt} - the same box, same size, so the fetch landing does not
 * reflow the card.
 */
function ScenarioArt({ item }: { item: HubItem }) {
  const hubUrl = useHubUrl();
  const mapName = useScenarioCardMapName(hubUrl, item.id);

  if (!mapName) return <KindArt item={item} />;

  return <MapArt mapName={mapName} />;
}

/** Everything else: a tinted plate with the kind's own glyph, the one
 * `KindIcon` draws in every badge, so a card without a picture at least reads
 * as "this kind of thing" rather than as a blank box. */
function KindArt({ item }: { item: HubItem }) {
  return (
    <div
      className={cn(
        "flex size-full items-center justify-center",
        KIND_TINT[item.kind],
      )}
    >
      <KindIcon kind={item.kind} mode={item.mode} className="size-8" />
    </div>
  );
}

/** A faint tint per kind, so a grid of tiles is not one undifferentiated grey
 * even before a reader gets to the glyph in the middle of it. */
const KIND_TINT: Record<HubKind, string> = {
  preset: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  challenge: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "setup-pack": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  scenario: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  blueprint: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
};

/** Fetch one item's container and read it into a preview, or null when the
 * item's detail could not be fetched, its container could not be fetched, or
 * the container decoded into nothing `readPreview` recognises. Never throws:
 * this runs unattended for every card on the page. The shared first half of a
 * blueprint's layout, a conquest challenge's galaxy and a scenario's map -
 * each reads the same container fetch and picks a different field off the
 * preview it returns. */
async function fetchItemPreview(
  hubUrl: string,
  id: string,
): Promise<HubPreview | null> {
  const detail = await fetchHubItem(hubUrl, id);
  if (!detail.ok) return null;
  const result = await fetchImportPlan(
    detail.value.container_url,
    fetchImportText,
  );
  if (!result.ok) return null;
  const container = asContainer(decodeContainerText(result.text));
  if (!container) return null;
  return readPreview(container);
}

/** Read one blueprint's layout off its container. See {@link fetchItemPreview}. */
async function fetchBlueprintLayout(
  hubUrl: string,
  id: string,
): Promise<BlueprintShape | null> {
  const preview = await fetchItemPreview(hubUrl, id);
  return preview?.kind === "blueprint" ? preview.layout : null;
}

/** Session cache of resolved layouts, keyed by `hubUrl::id`, so paging away
 * from a blueprint card and back does not repeat its container fetch. Holds
 * `null` for "asked and got nothing to draw", which is itself worth
 * remembering rather than asking again on every remount. */
const blueprintLayoutCache = new Map<string, BlueprintShape | null>();
/** Open reads, so two mounts of the same card (StrictMode, or a duplicate id on
 * the page) share one fetch rather than opening two. */
const blueprintLayoutPending = new Map<
  string,
  Promise<BlueprintShape | null>
>();

/** `undefined` while nothing has answered yet, otherwise the cached answer -
 * `null` included, for "asked and there is nothing to draw". Both fall back to
 * {@link KindArt} in the caller, so the distinction is only ever used here to
 * decide whether to fetch. */
function useBlueprintCardLayout(
  hubUrl: string,
  id: string,
): BlueprintShape | null | undefined {
  const key = `${hubUrl}::${id}`;
  // `Map.get` already types as `V | undefined`, and the cache never stores
  // `undefined` as a value, so an `undefined` read means "not cached" and a
  // `null` read means "cached: nothing to draw" - no separate sentinel needed.
  const [layout, setLayout] = useState<BlueprintShape | null | undefined>(() =>
    blueprintLayoutCache.get(key),
  );

  useEffect(() => {
    const cached = blueprintLayoutCache.get(key);
    if (cached !== undefined) {
      setLayout(cached);
      return;
    }
    let cancelled = false;
    shareInFlight(blueprintLayoutPending, key, () =>
      fetchBlueprintLayout(hubUrl, id),
    ).then((result) => {
      blueprintLayoutCache.set(key, result);
      if (!cancelled) setLayout(result);
    });
    return () => {
      cancelled = true;
    };
  }, [hubUrl, id, key]);

  return layout;
}

/** Read one conquest challenge's galaxy off its container - null too when the
 * container did not turn out to hold a galaxy to draw (a challenge
 * `preview.ts` could not rebuild). See {@link fetchItemPreview}. */
async function fetchConquestGalaxy(
  hubUrl: string,
  id: string,
): Promise<GalaxyShape | null> {
  const preview = await fetchItemPreview(hubUrl, id);
  return preview?.kind === "challenge" ? preview.galaxy : null;
}

/** Session cache of resolved galaxies, keyed by `hubUrl::id`, so paging away
 * from a challenge card and back does not repeat its container fetch. Holds
 * `null` for "asked and got nothing to draw", which is itself worth
 * remembering rather than asking again on every remount. */
const conquestGalaxyCache = new Map<string, GalaxyShape | null>();
/** Open reads, so two mounts of the same card (StrictMode, or a duplicate id on
 * the page) share one fetch rather than opening two. */
const conquestGalaxyPending = new Map<string, Promise<GalaxyShape | null>>();

/** `undefined` while nothing has answered yet, otherwise the cached answer -
 * `null` included, for "asked and there is nothing to draw". Both fall back to
 * {@link KindArt} in the caller, so the distinction is only ever used here to
 * decide whether to fetch. */
function useConquestCardGalaxy(
  hubUrl: string,
  id: string,
): GalaxyShape | null | undefined {
  const key = `${hubUrl}::${id}`;
  const [galaxy, setGalaxy] = useState<GalaxyShape | null | undefined>(() =>
    conquestGalaxyCache.get(key),
  );

  useEffect(() => {
    const cached = conquestGalaxyCache.get(key);
    if (cached !== undefined) {
      setGalaxy(cached);
      return;
    }
    let cancelled = false;
    shareInFlight(conquestGalaxyPending, key, () =>
      fetchConquestGalaxy(hubUrl, id),
    ).then((result) => {
      conquestGalaxyCache.set(key, result);
      if (!cancelled) setGalaxy(result);
    });
    return () => {
      cancelled = true;
    };
  }, [hubUrl, id, key]);

  return galaxy;
}

/** Read one warpath challenge's run off its container - null too when the
 * container did not turn out to hold a run to draw (a challenge `preview.ts`
 * could not rebuild). See {@link fetchItemPreview}. */
async function fetchWarpathRun(
  hubUrl: string,
  id: string,
): Promise<RunShape | null> {
  const preview = await fetchItemPreview(hubUrl, id);
  return preview?.kind === "challenge" ? preview.run : null;
}

/** Session cache of resolved runs, keyed by `hubUrl::id`, so paging away from
 * a challenge card and back does not repeat its container fetch. Holds `null`
 * for "asked and got nothing to draw", which is itself worth remembering
 * rather than asking again on every remount. */
const warpathRunCache = new Map<string, RunShape | null>();
/** Open reads, so two mounts of the same card (StrictMode, or a duplicate id on
 * the page) share one fetch rather than opening two. */
const warpathRunPending = new Map<string, Promise<RunShape | null>>();

/** `undefined` while nothing has answered yet, otherwise the cached answer -
 * `null` included, for "asked and there is nothing to draw". Both fall back to
 * {@link KindArt} in the caller, so the distinction is only ever used here to
 * decide whether to fetch. */
function useWarpathCardRun(
  hubUrl: string,
  id: string,
): RunShape | null | undefined {
  const key = `${hubUrl}::${id}`;
  const [run, setRun] = useState<RunShape | null | undefined>(() =>
    warpathRunCache.get(key),
  );

  useEffect(() => {
    const cached = warpathRunCache.get(key);
    if (cached !== undefined) {
      setRun(cached);
      return;
    }
    let cancelled = false;
    shareInFlight(warpathRunPending, key, () =>
      fetchWarpathRun(hubUrl, id),
    ).then((result) => {
      warpathRunCache.set(key, result);
      if (!cancelled) setRun(result);
    });
    return () => {
      cancelled = true;
    };
  }, [hubUrl, id, key]);

  return run;
}

/** Read one scenario's map name off its container - null too when the
 * container did not turn out to hold a scenario with a map set (issue #2600).
 * See {@link fetchItemPreview}. */
async function fetchScenarioMapName(
  hubUrl: string,
  id: string,
): Promise<string | null> {
  const preview = await fetchItemPreview(hubUrl, id);
  return preview?.kind === "scenario" ? preview.map : null;
}

/** Session cache of resolved map names, keyed by `hubUrl::id`, so paging away
 * from a scenario card and back does not repeat its container fetch. Holds
 * `null` for "asked and got nothing to draw", which is itself worth
 * remembering rather than asking again on every remount. */
const scenarioMapNameCache = new Map<string, string | null>();
/** Open reads, so two mounts of the same card (StrictMode, or a duplicate id on
 * the page) share one fetch rather than opening two. */
const scenarioMapNamePending = new Map<string, Promise<string | null>>();

/** `undefined` while nothing has answered yet, otherwise the cached answer -
 * `null` included, for "asked and there is nothing to draw". Both fall back to
 * {@link KindArt} in the caller, so the distinction is only ever used here to
 * decide whether to fetch. */
function useScenarioCardMapName(
  hubUrl: string,
  id: string,
): string | null | undefined {
  const key = `${hubUrl}::${id}`;
  const [mapName, setMapName] = useState<string | null | undefined>(() =>
    scenarioMapNameCache.get(key),
  );

  useEffect(() => {
    const cached = scenarioMapNameCache.get(key);
    if (cached !== undefined) {
      setMapName(cached);
      return;
    }
    let cancelled = false;
    shareInFlight(scenarioMapNamePending, key, () =>
      fetchScenarioMapName(hubUrl, id),
    ).then((result) => {
      scenarioMapNameCache.set(key, result);
      if (!cancelled) setMapName(result);
    });
    return () => {
      cancelled = true;
    };
  }, [hubUrl, id, key]);

  return mapName;
}
