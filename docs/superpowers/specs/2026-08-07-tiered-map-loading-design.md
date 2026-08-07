# Tiered map loading

Date: 2026-08-07
Issue: [#981](https://github.com/tomjn/coilbox/issues/981)

## Problem

The unitsync scan runs in full on every app launch, even when no content has changed. It blocks the maps list for about 15 seconds on a 73 map library, and it repeats that work every launch because nothing is persisted.

Measured with `COILBOX_UNITSYNC_TIMINGS=1` against `~/.spring` (73 maps, 5.5 GB, 70 of them `.sd7`):

```
init=153ms
archives=10ms  dims=6307ms  file_name=1ms  info=6270ms
maps=73 in 12589ms
games=14 in 45ms
```

The cost splits evenly between two calls, each about 86ms per map:

- `GetInfoMapSize`, read by `map_dimensions`, gives the map proportions
- `GetMapInfoEx`, read by `map_info`, gives the mapinfo metadata

Enumerating names, file names and archive paths costs 11ms in total. `Init` costs 153ms. Everything else in the scan is those two per map calls opening compressed archives.

What the 15 seconds currently buys, on the page that waits for it:

- `m.name`, used for the grid, filter, name sort and links
- `m.width` and `m.height`, used only for the size label and the Largest and Smallest sorts
- `m.info`, not read by the maps grid at all

Every other scan consumer reads `m.name` alone: `conquest/run.ts`, `content/refight.ts`, `content/useResolveContent.ts`, `conquest/pages/GalaxyPage.tsx` and the eligibility helpers. `m.info` is read by `content/pages/MapDetailPage.tsx` and `play/pages/components/MapCard.tsx`.

## Approach

Split the scan into three tiers, each its own worker invocation, each cached independently on archive file identity. This follows the batch mode pattern the worker already uses twice, in `--thumbnails` and `--game-headers`.

Separate processes rather than one process streaming tiers. The worker is deliberately one shot because unitsync is a global C singleton that can `abort()` on a malformed archive, so a crash kills a throwaway process instead of the app. Streaming would put all three tiers behind one process and let a tier 3 crash take the tier 1 list down with it. The cost of separate processes is one extra `Init`, about 150ms, on a cold library only.

### Tier 1: the list

`collect_maps` keeps `map_name`, `map_file_name` and the archive list, and drops `map_dimensions` and `map_info`.

`MapItem` keeps its `width`, `height` and `info` fields. Tier 1 leaves the dimensions unset and `info` empty, and the frontend merges the later tiers in by map name. Callers that already treat those fields as absent, which is all of them, need no change.

Cost is `Init` plus enumeration, about 165ms, near enough independent of library size. This is cheap enough that it needs no disk cache, which is why this design does not persist the scan itself.

### Tier 2: minimaps and dimensions

`minimap::render_all` already calls `map_dimensions` per map and returns `width` and `height` on each `Thumbnail`, and `MapThumbData` already carries them to the frontend. The dimensions are therefore computed twice today, once in the scan and once in the thumbnail pass.

Two changes:

- cache the dimensions alongside the PNG, so a warm thumbnail cache skips `GetInfoMapSize` instead of re-running it per map. `render_one` already skips the expensive minimap read on a cache hit, but `map_dimensions` runs unconditionally after it.
- `MapsPage` reads `width` and `height` from `thumbs` rather than from `data.maps`.

This puts the size label, the minimap aspect ratio and the area sorts in the same tier as the minimap they describe. They appear together, so a non square map does not render square and then reflow.

### Tier 3: mapinfo metadata

A new `--map-meta` batch mode over one `Init`, mirroring `--thumbnails`, reading `map_info` for every map and writing each result to the disk cache keyed on that map's archive identity. The name avoids `--map-info`, which is already taken by the per map options and checksum mode used on the detail page.

It runs at launch in the background, after tiers 1 and 2. It feeds `MapDetailPage.tsx` and `MapCard.tsx`. Both call `Object.entries(map.info)`, so `info` stays an empty map while tier 3 is in flight rather than becoming undefined.

## Caching and invalidation

All tiers key on archive file identity: path, size and mtime. `infocache::identity` and `minimap::map_cache_key` already implement this separately and identically. Tier 3 uses `infocache` with a new namespace rather than adding a third copy. Cache shape changes are handled by bumping `INFO_CACHE_VERSION`.

Rescan stops being wholesale. Today a forced rescan calls `bumpScanEpoch`, which busts the thumbnail session cache for every map on the target. Keyed on identity, a rescan re-runs tier 1 at 165ms and then finds every unchanged archive already cached in tiers 2 and 3. A map whose archive has not changed keeps its minimap and its metadata. Only new or replaced archives do work.

This carries the known limitation of the existing caches: a changed dependency archive does not invalidate an entry, because the item's own file identity is unchanged.

## Expected result

- Cold library: the list appears in about 165ms, with minimaps and dimensions following, then metadata.
- Relaunch with nothing changed: about 165ms in total, against about 15 seconds today.
- Rescan after installing one map: tier 1 in full, plus tier 2 and tier 3 work for the one new archive.

## Error handling

Tiers in separate processes contain failures. Today a single malformed archive can abort the scan and leave the user with no maps at all. With tiers, that crash costs minimaps or metadata and leaves the list on screen.

Error state becomes per tier, where it is currently all or nothing through `scanErrorCache`:

- tier 1 failure keeps the existing page error banner, because without names there is nothing to render
- tier 2 or tier 3 failure does not set that banner. The grid renders and the missing piece is surfaced without blocking.

Within a tier, one bad archive must not sink the batch. `render_all` already collects per map errors and continues, and tier 3 does the same. Only fully resolved results are written to the cache, so a failed read retries on the next launch instead of caching a hole.

## Cancellation

`cancelScan` cancels one `opId` per target. There will now be up to three in flight, so Cancel must stop whichever tiers are still running and Rescan must restart all three.

The launch warm up currently fires `primeThumbnails` with `.catch(() => {})` and keeps no handle. Tier 3 needs a cancellable handle so that quitting mid pass does not leave a worker running.

## Behaviour changes

The Largest and Smallest sorts now depend on tier 2. If the thumbnail pass fails, those sorts do nothing, because `mapArea` returns 0 for every map. This is the same degradation as today when dimensions are missing, but the trigger moves from the scan to the thumbnail pass.

## Testing

Rust:

- the two cache namespaces do not collide for the same archive
- a cache hit skips the expensive call rather than running it and discarding the result
- a batch containing one unreadable archive still returns the other maps

Frontend:

- the maps grid renders names with no dimensions and no thumbnails
- dimensions arriving later update both the size label and the sort order
- `MapDetailPage` and `MapCard` render against an empty `info`

These lock in the graceful degradation that `mapSizeLabel` and `mapArea` already provide, rather than adding it.

Live verification with `bun tauri dev`, once against a cold cache and once on relaunch with nothing changed. Scanning works on this machine even though matches cannot be launched here.

## Dependencies

Assumes the in flight `perf/393-protocol-images` work lands first. That change swaps minimap `data:` URLs for `coilbox://unitsyncthumb/` protocol URLs and alters `render_one`'s return type and the thumbnail payload shape. It does not touch dimension sourcing or tiering, so the overlap is a field rename rather than a behaviour change.
