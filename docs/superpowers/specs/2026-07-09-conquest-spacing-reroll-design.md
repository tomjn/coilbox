# Conquest galaxy spacing + regeneration (PR A)

Date: 2026-07-09
Status: approved

## Problem

1. As node count rises the galaxy feels like the same space with more stars crammed in. Cause is two-layer: the generator scatters onto a fixed radius-100 disc with `minDist = (radius * 1.6) / sqrt(count)` (`src/conquest/generate.ts:77,295`), and the renderer normalizes the longest authored span to a fixed `PLAY_EXTENT = 100` world units (`src/conquest/galaxy3d/layout.ts:10,43`), so any generator-side spread is rescaled away.
2. Spacing is uniform: dart-throwing with a single acceptance distance produces a homogeneous carpet with no tight pairs or open gaps.
3. There is no way to regenerate a galaxy with a new seed while looking at it. The wizard has a dice button for the seed number but no visual; GalaxyPage shows the real galaxy but only `generated.seed` is persisted (`src/conquest/model.ts:133`), not the other generation knobs, so in-place regeneration is impossible.

## Design

### 1. Dynamic play extent (renderer)

- `src/conquest/galaxy3d/layout.ts`: add `playExtentFor(nodeCount: number): number` returning `PLAY_EXTENT * Math.sqrt(nodeCount / 18)`. 18 is the wizard's Medium default, so existing medium galaxies render identically; an 80-node galaxy gets a ~2.1x wider plane and constant average density. `layoutNodes` gains an extent parameter (default `PLAY_EXTENT`).
- `src/conquest/galaxy3d/GalaxyView.tsx`: compute `extent = playExtentFor(galaxy.nodes.length)` once and use it wherever `PLAY_EXTENT` is used today (backdrop plane, core distance, nebula distances/scales, camera start height `*1.05` and pullback `*0.55`), so the whole scene scales proportionally. Camera far plane (2500) already covers the max extent (~210 for 80 nodes).
- Render-time change only: existing saved galaxies benefit immediately. Gameplay depends on links/hops, never raw distances, so no gameplay effect.

### 2. Varied spacing (generator)

- `packWithSampler` (`src/conquest/generate.ts:72`): draw a per-candidate acceptance distance of roughly `minDist * (0.65 + rng() * 0.7)` instead of a single uniform `minDist`, keeping the existing relax-on-crowding termination guarantee. Deterministic from the seed. Affects newly generated galaxies only. Exact factors tuned visually during dev.

### 3. Reroll in both places

Persisted knobs:

- Extend `GalaxyDoc.generated` from `{ seed }` to also carry `nodeCount`, `factionCount`, `layout`, `skin`, `startingSystems`, `fogOfWar` as optional fields. Additive, `schemaVersion` stays 1, `parseGalaxyJson` updated to pass them through.
- Maps, AIs, and naming pools are deliberately NOT persisted: they re-resolve from installed content and the current profile/branding at reroll time. Rerolls are not byte-reproducible across environments; nothing needs that.

GalaxyPage regenerate:

- A "Regenerate" button on the pre-run setup panel, visible only when no run state exists and the doc carries the persisted knobs. It draws a fresh random seed, calls `generateGalaxy` with the stored knobs plus freshly resolved maps/AIs/merged names for the doc's game, preserves the doc's `id` and `title`, and saves via the existing galaxy save path.

Wizard preview:

- A lightweight 2D constellation preview (canvas: node points, lanes, capital markers in faction colours) inside the create drawer, regenerated in-memory from `generateGalaxy` as seed or options change. Not the three.js `GalaxyView`: the generator is pure and instant; a full scene rebuild per option change in a drawer is unjustified. The existing dice button is the visible reroll.

## Testing

- Unit: `layout.test.ts` extended for `playExtentFor` and the extent parameter; generator tests for spacing-jitter determinism (same seed, same points) and termination at max count; `parseGalaxyJson` round-trips the new `generated` fields; reroll reproduces a structurally valid galaxy from persisted knobs.
- Live: both reroll paths and the visual density change verified in `bun tauri dev` before PR.

## Out of scope

Naming fallback and cap (PR B), voidwater asteroid/comet node kinds (PR C), predefined stars with presets (PR D, needs its own spec).
