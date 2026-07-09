# Conquest voidwater asteroid/comet nodes (PR C)

Date: 2026-07-09
Status: approved

## Problem

Space maps (`voidWater` true in `mapinfo.lua`) look wrong rendered as glowing star systems in the galactic-conquest map. We want nodes whose battle map is a space map to read as asteroid fields (with a rare comet variant) instead.

The blocker is data: `voidWater` is authoritative only from `mapinfo.lua`, which unitsync reads through its Lua-parser FFI on a **mounted** map archive (`map_appearance()` in the worker). It is not on the cheap `unitsync_scan` that feeds the conquest generator, and mounting every archive during the scan would slow the app-wide map list. So we cannot know "is this a space map" for free.

## Design

Best-effort, opportunistic, no Rust and no generator/schema change. Two pieces.

### 1. Opportunistic map-appearance cache

The worker already returns a rich appearance block on every `MinimapResult` (`src/content/bindings.ts:469-504`: `voidWater`, `voidGround`, wind, tidal, water/sky/sun colours), and the shared minimap hook `useUnitsyncMinimap` (`src/content/config.ts:991`) already reshapes it into the existing `MapAppearance` type (`src/mapconv/bindings.ts:60`) at lines 1026-1047. That data is computed and thrown away after the component using it unmounts.

Add a persistent frontend cache, keyed by map spring-name, storing that existing `MapAppearance` record (reused, not a new type):

- Module `src/content/mapAppearanceCache.ts`: owns an in-memory `Map<string, MapAppearance>` persisted across sessions (frame settings store), exposing `recordMapAppearance(name, appearance)`, `getMapAppearance(name)`, and reactive reads `useMapAppearance(name)` / `useKnownSpaceMaps(): Set<string>` via `useSyncExternalStore` (so it serves React readers while writes can come from anywhere). `useKnownSpaceMaps` returns the names whose appearance has `voidWater === true`.
- Populate: a single call site — inside `useUnitsyncMinimap`, right after the appearance object is built (`config.ts:1026-1047`) / the result is cached (`config.ts:1063`), call `recordMapAppearance(mapName, appearance)`. Because every minimap consumer routes through this one hook (play map picker `MapCard`, content `MapDetailPage`/`MapsPage`, `ReplayDetailPage`, campaign `useMissionMapAssets`), the cache fills broadly as the user browses maps — not just from the Maps page. The recorder never mounts an archive itself; it only banks what an existing minimap call already produced.
- Caching the whole `MapAppearance` (not just `voidWater`) means the next feature that wants wind/tidal/water colours reuses this cache instead of duplicating the plumbing.

Honest limitation (stated so behaviour isn't over-promised): a space map the user has never viewed the minimap of stays a star until something resolves it. Asteroids fill in as maps become known; missing one is invisible and harmless. This is intentional per the agreed best-effort trade-off, not a rescan-driven guarantee.

### 2. Render-time asteroid/comet bodies

Node bodies are already derived at render time from the node id (`starTypeFor`/`starSystemFor`, `GalaxyView.tsx:77-137`) — nothing about the body is persisted. Extend that derivation:

- `GalaxyView` receives the known-space-map set (from `useKnownSpaceMaps`, resolved in `GalaxyPage` and passed as a prop). For a node whose `battle.mapName` is in the set, render a void body instead of a star: an asteroid field by default, a comet for a deterministic rare subset chosen by node-id hash (mirroring how binaries/giants are already derived). Capitals on space maps stay capitals (kept prominent/ringed) but adopt the void look.
- Visual: reuse the per-node sprite slot, swapping the stellar sprite + corona for a muted rocky asteroid cluster (no stellar glow); the comet adds a short tail. Ownership stays entirely on the ring, unchanged.
- `starSystemLabel` (used by the selection panel) reports "asteroid field" / "comet" for void nodes.

Because the body is derived, the feature is retroactive: existing galaxies from PR A/B show asteroids for their space maps once those maps are cached, with no regeneration. Trade-off: an exported/shared galaxy shows asteroids only where the recipient's own cache knows the map is void — acceptable for a cosmetic.

## Data flow

`useUnitsyncMinimap` (existing, all minimap consumers route through it) -> `recordMapAppearance(name, appearance)` -> persistent `mapAppearanceCache` -> `useKnownSpaceMaps()` in `GalaxyPage` -> `GalaxyView` prop -> per-node body derivation by `battle.mapName`.

## Testing

- Unit (`mapAppearanceCache.test.ts`): `recordMapAppearance`/`getMapAppearance` round-trip a `MapAppearance`; the known-space-maps selector reflects only `voidWater === true` entries; unknown maps absent; a later record for the same name overwrites.
- Unit (`galaxy3d` body derivation): a pure `bodyFor(nodeId, capital, isVoid)` returns star for non-void, asteroid for void, comet for the rare hash subset; deterministic per id; `starSystemLabel` labels void bodies.
- Live: view a space map's minimap (caching it), then open a conquest galaxy that uses it — its nodes render as asteroids/comets with the right panel label; a non-space galaxy is unchanged. Verified in `bun tauri dev` before PR.

## Out of scope

No worker/Rust changes, no proactive cache warming (asteroids appear only for maps whose appearance has been resolved), no persisted node body, no generator change. Predefined stars with presets (PR D) remain separate.
