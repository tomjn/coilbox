# Warpath landmarks on the land map

Status: draft for review, 11 November 2026.

## What this builds

Procedural 3D landmarks that stand on the terrain map in place of a town at some warpath stops. This spec covers three things:

1. A shared landmark layer: geometry kit, material, planet palettes, placement on the ground, and the fog, selection and mist states towns already have.
2. The stronghold at boss stops, ported from the approved spike (`docs/reports/warpath-landmarks/bastion.ts`, shots `bastion3-*`).
3. A ruined castle at event stops, built down from the spike's `citadel.ts`. Its look is not approved yet and is reviewed on real terrain before it merges.

The spike folder is gitignored and throwaway. Code is ported from it into `src`, never imported.

## Decisions already made

These came from the brief and are not reopened here.

- Landmarks are procedural geometry built in code. Authored glTF through `placedModelsLayer.ts` is the fallback only if this route fails.
- A landmark replaces the town at boss, event, reward and start stops. Shop and elite stops keep a town. Battle stops stay towns.
- One stronghold design for every game, with no era detection.
- Style follows the memory `warpath-landmark-style`: cast concrete megastructure seen from continent height. No windows, doors, ramps, vehicles or anything else that sets a human scale. No saturated glowing faces. A faint shield dome is the only effect. The whole model is tinted to the planet. The footprint stays smaller than a capital town.
- Landmark palettes are designed on their own and take nothing from the towns.
- 3D towns are a later project. The layer is shaped so they could move onto it, but they do not move now.

## Scope of stops in this spec

| Stop | Today | After this spec |
|---|---|---|
| boss | town plus goal pole | stronghold |
| event | town in violet mist | ruined castle, in the same mist |
| reward | town | town, until a reward landmark exists |
| start | town plus start pole | town, until a start landmark exists |
| shop, elite, battle | town | town |

Reward and start are named in the decision but have no design yet. The kind table carries them so adding a model later is one entry, and until then they keep their town. Building those two is a later spec.

## Architecture

New folder `src/conquest/galaxy3d/landmarks/`. Each file has one job.

| File | Job | Depends on |
|---|---|---|
| `kit.ts` | Geometry helpers (`box`, `shaft`, `block`, `sweep`, `tube`, `at`, `on`, `polar`, `seeded`, `noise3`) and the `Builder` that merges parts into one geometry with colour, kind and a part tag per vertex | three |
| `material.ts` | The landmark surface shader: kind patterns, sun and ambient lighting, baked shadow, fog dimming and mist | three, `terrain.ts` constants |
| `palettes.ts` | One palette per landmark per planet, typed `Record<PlanetId, …>` so a missing planet fails the build | `planets.ts` |
| `site.ts` | Pure: pick the site, the facing, the size and the ground function for a landmark at a node | terrain surface |
| `shadow.ts` | Bake one shadow map per landmark, and the ground decal that shows it | three |
| `shield.ts` | The faint dome, sized from the bounds of the parts it must cover | three |
| `stronghold.ts` | The boss stronghold, ported from `bastion.ts` | kit, palettes |
| `ruin.ts` | The ruined castle, from `citadel.ts` | kit, palettes |
| `landmarkLayer.ts` | Builds every landmark for a map, owns their meshes, exposes `setStyle`, `prepare` and `dispose` | all of the above |

### How a stop becomes a landmark

1. `NodeIdentity` in `GalaxyView.tsx` gains `landmark?: LandmarkKind`, where `LandmarkKind` is `"stronghold" | "ruin"`.
2. `mapRunIdentities` in `src/runlite/galaxyAdapter.ts` sets `landmark: "stronghold"` on the boss location and `landmark: "ruin"` on each event location. The existing `end` and `mist` fields stay as they are.
3. In `GalaxyView`, the towns planned by `townsOnRoads` are split. Every town still takes part in road planning, so roads are unchanged. Towns whose node has a landmark are left out of `buildTownLayer`, so neither the town nor its fields are painted.
4. `buildLandmarkLayer` runs after `buildTerrainMesh` with the scene, disposables, surface, ground heights, terrain colour pixels, planet, the galaxy nodes, the identities and the planned towns.
5. The goal pole at the boss is dropped. `endMarkersToDraw` already hides a marker when a placed model stands on the location, and a landmark counts as one. The start keeps its pole because it keeps its town.

### Drawing order and lighting

The landmark draws as ordinary opaque geometry after the terrain, with depth test and depth write on. It does not use three's scene lights. On a warpath `playLayer.ts` adds a raking space-station light, and the landmark must be lit by the same sun as the ground. The material takes `TERRAIN_SUN` and `SHADE_AMBIENT` as uniforms, as the town shader does, and adds a sky and ground hemisphere term so the faces turned away from the sun match the spike's look. The spike used `MeshStandardMaterial` at roughness 0.92 with a directional light and a hemisphere light. The port is checked against the approved `bastion3` shots side by side, and the light levels are tuned until they match.

### Shadows

The terrain shader receives no shadows, and three's shadow map only works through scene lights. The landmark bakes its own.

1. On the first `prepare(renderer)` call, each landmark renders its own geometry once into a depth target from `TERRAIN_SUN`, with an orthographic camera fitted to its bounds.
2. The landmark material samples that depth texture, so the tower shades the decks and the crag.
3. A ground decal, a mesh draped on the terrain heights over the landmark's reach, samples the same texture and darkens the ground where the model's shadow falls. It also carries the contact darkening the spike drew at the foot of the crag.
4. Nothing re-renders afterwards. The sun and the model never move.

This keeps the terrain shader unchanged and costs one small render per landmark. The towns already use the same `prepare(renderer)` hook for their one-off block bake. The renderer's `shadowMap` stays off.

The alternative was turning on `renderer.shadowMap` with a directional light. One light cannot cover landmarks spread across a whole map at the detail the spike had, and one light per landmark adds shader cost to every lit material. I did not pick it.

### Patterns that scale with the model

The kit's shader patterns (cast panels, rock, joints) used world position, so a scaled group kept full-size panels. The product material uses the landmark's own coordinates, the positions the `Builder` writes before the group transform. Scaling the group then scales the panels with it. A test builds one landmark at two scales and checks the pattern coordinate per vertex is the same.

### Placement

`site.ts` is pure and works in world units on the terrain surface.

1. Size. Each landmark has a design reach (the stronghold's is 3.6 in the spike). The scale is the smaller of 1 and what the town cap allows: towns cap their radius at 0.3 times the distance to the nearest other node. A landmark never reaches past that, so it never overlaps a neighbour.
2. Site. Candidates sit on a small grid round the node, out to a fifth of the scaled reach. Any candidate with sea under the footprint is dropped. The one with the least relief across the footprint wins, with a small penalty for distance from the node so the landmark stays on its stop.
3. Facing. The stronghold's long wall points away from the road that arrives at the stop, so the road meets the main block and the crag, not the end of the wall.
4. Height. The group stands at the ground height at the site. Its ground function is the terrain height in the landmark's own scaled coordinates, less that base height, as the spike's `local()` was.
5. Seed. From the node id, so a landmark looks the same each time the map opens.

If no candidate is dry, the landmark is skipped and the stop keeps its town. A test covers this with a node on a coast.

### The crag's edge

The spike's crag ended in a hard outline against temperate forest. Two changes fade it into the ground.

1. Over the outer band of the crag, each vertex's colour blends towards the terrain's own colour at that point, read from the terrain colour pixels already loaded for the map. At the very edge the crag is the ground's colour.
2. The opacity fade gets broken noise along its edge, so it does not trace a clean ellipse, and the edge sits a little below the terrain.

The decal's contact darkening then sits under the blend rather than drawing a ring.

### States

`setStyle(nodeIndex, TownStyle)` takes the same `TownStyle` the town layer takes, so `cityLayer`'s `style()` writes to the landmark layer for nodes that have one and to the town layer for the rest.

- Hidden by fog. The town draws dim and grey. The landmark does the same through a material uniform: something is there, but its colour is gone.
- Ring. Selected, hovered and emphasised draw the town's ring in the same colour, strength and thickness. The landmark's ring is a thin band on the ground decal at the footprint's edge.
- Mist. The event's dark violet haze, matched to the town shader's mist by reading its colour and strength from `townShader.ts`.

The landmark meshes set `raycast` to a no-op. Picking still goes through the node's hit target, as it does for towns and markers.

### Shield

The shield is the spike's additive dome with a bright rim and a faint body. The `Builder` tags each part, and the shield is sized from the bounds of the parts tagged `tower` and `mast`, plus a margin. A test checks every vertex of those parts sits inside the dome's ellipsoid. In the spike the masts poked through, and this test makes that a build failure.

### Palettes

Every planet the land map supports needs one: temperate, desert, ice, red, moon, volcanic and acid. The stronghold palette has the spike's fields: concrete, armour, trim, rock, top cover, lamp and shield. The ruin palette has stone, a darker stone, rock and top cover, and nothing that glows.

Temperate and volcanic port as approved. The five new ones follow the same rule: the whole model takes the planet's cast, as volcanic's muddy orange brown does. They are chosen by rendering each on its own planet. They take nothing from the town colours in `Planet.settlement`. A hand-made map with no planet uses temperate, as the towns do.

## The stronghold

A port of `bastion.ts` with the crag, long wall, decks on piers, containment spheres, tower and shield, at the approved proportions. Changes from the spike are limited to:

- The crag edge fade described above.
- The shield sized from the tower and mast bounds.
- Patterns in the landmark's own coordinates.
- Facing from the arriving road instead of a fixed `gate`.

The spike's few small lamp points and the reactor collars stay, because they are in the approved shots. They are the only lit parts.

## The ruined castle

A small broken historic site, built down from `citadel.ts`. It is a ruin, not a working castle. It keeps:

- The mound, at a lower height.
- Two rings of wall, with gaps, broken tops and fallen sections lying as rubble.
- Some corner towers cut off at uneven heights.
- The keep's lower stage as a shell, with no spire.

It drops the halls, roofs, windows, banners, gatehouse portcullis, turrets, trees, beam and every lit part. It is smaller than the stronghold. Its final size and its look are set on the render review, and it does not merge until you approve that render.

## Testing

Vitest in the node environment, following `placedModelsLayer.test.ts`, with a flat `createTerrainSurface`.

- `mapRunIdentities` sets `landmark` on boss and event locations and on nothing else.
- Each `PlanetId` has both palettes. The `Record` type enforces it, and a test walks `PlanetId` values as well.
- `site.ts`: a flat site centres on the node, a sloped site moves to the flatter side, the size respects the town cap, and a coastal node with no dry site returns none.
- The landmark layer builds both landmarks on a flat surface, leaves the landmark nodes out of the town list, and `setStyle` flips the fog uniform.
- The shield contains every tower and mast vertex.
- The pattern coordinate is the same at two scales.
- `endMarkersToDraw` hides the goal pole at a stronghold.

The look is checked on screen, not by tests.

## Verification on screen

In a seeded portable instance per `CLAUDE.md`, on its own MCP socket, with `multiplayer.autoConnect` off in the copy.

1. Start a land warpath on a temperate planet and one on a volcanic planet.
2. Capture the stronghold and the ruin at far, mid and close zoom on each.
3. Post each as a single 1440 by 900 JPEG.
4. Capture the five new palettes at mid zoom so every planet has been seen once.

## Delivery

Two PRs, so the stronghold is not held back by the ruin's review.

1. The layer, the stronghold, the seven stronghold palettes and the town and marker changes.
2. The ruined castle and its seven palettes, after you approve its render.

`bun run check` passes before each.

## Out of scope

- Moving towns onto the landmark layer.
- Reward and start landmarks.
- Any change to the terrain shader.
- Era detection or per-game strongholds.
