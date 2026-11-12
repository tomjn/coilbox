# 3D towns on the land map

Status: draft for review, 11 November 2026.

## What this builds

Towns on a terrain map stop being a flat picture painted on the ground and become dense blocks of 3D buildings on a street grid, standing on ground levelled for them. This spec covers the supporting code and a set of placeholder cuboids. It does not cover the real building models, which come afterwards and replace the cuboids one at a time.

It delivers four things:

1. Ground levelling under each town, so no town stands on a cliff.
2. A layout that fills a town with lots on a grid.
3. A building inventory, holding ten placeholder cuboids to start with.
4. A town layer that draws the buildings with the landmark material, shadows, fog and selection ring, and the removal of the painted towns and their fields.

## Decisions already made

These came from the brief and the review of the spike on 11 November 2026. They are not reopened here.

- Buildings are procedural geometry built in code with the landmark kit, as the landmarks are.
- A standard lot is 0.25 world units a side.
- A planet whose settlements are sealed outposts (red, moon, volcanic, acid) uses a lot three times that, 0.75, so an outpost is a few large structures.
- The street surface is plain. One flat colour is enough.
- Fields round a town are dropped.
- The ground under a town is levelled.
- The reference for the real models is the dense pale sci-fi city in the memory `town-3d-reference`. Nothing is taken from the painted towns' colours or style.

## What the spike showed

The spike is throwaway code in `docs/reports/town-3d/`, which is gitignored. It draws the cuboids on real generated terrain through the landmark kit. Code is ported from it, never imported.

- At the app's closest zoom (distance 25) a 0.1 lot is 3.9 pixels wide in a 900 pixel high frame, which reads as noise. A 0.25 lot is 9.6 pixels.
- On the test map (temperate, seed 35058, 18 locations), the player's capital sits on a cliff. With a 0.25 lot it held 21 buildings on the raw ground and 196 after levelling.
- On the moon version of that map, a 0.75 lot gave 56 structures across 16 outposts. Two outposts, of radius 1.2 and 0.9, got none.
- One merged mesh per town was enough for cuboids. At a 0.1 lot, 1,328 buildings across 16 towns came to 17,920 triangles.
- The landmark's ground decal draws ground that lies lower than the model as shadowed. Beside a city this shows as a grey quadrilateral.
- No frame time was measured. The machine's load average was 13.8.

## Architecture

New folder `src/conquest/galaxy3d/towns3d/`. Each file has one job.

| File | Job | Depends on |
|---|---|---|
| `level.ts` | Pure: level height grids under a list of towns | `towns.ts` |
| `buildings.ts` | The building inventory and the placeholder cuboids | landmark kit |
| `layout.ts` | Pure: the lots of one town and the model on each | `towns.ts`, `buildings.ts` |
| `townModelLayer.ts` | Builds every town's mesh, street sheet, shadow and decal. Exposes `setStyle`, `prepare`, `tops` | all of the above, landmark material and shadow |

Town planning stays where it is. `planTowns`, `townEdge`, `clipRoads`, `withStreets` and `townsOnRoads` still decide where a town is, how big it is, which way it runs and where roads arrive.

### Order of work in the view

Today `GalaxyView` builds the surface from the heights, then routes roads and plans towns while it builds the ground layer. Levelling needs the towns before the surface exists, so the order changes.

1. Build a surface from the raw heights. This one is only for planning.
2. Route the roads and plan the towns on it. Planning reads map sizes, the raw height grid and `mapToWorldXZ`, so it needs nothing from the final surface. `buildGroundLayer` is split into a pure `planGround`, which returns the roads and towns, and the painting that remains.
3. Level the heights under the planned towns.
4. Build the final surface from the levelled heights. Markers, landmarks, labels and the terrain mesh all read this one.
5. Paint the ground from the plan made in step 2. Roads are not routed a second time.

Levelling changes heights only. It never moves a point across sea level, so a coast, a sea crossing's landing and a road's line all stay where they were planned.

Levelling runs when towns are drawn: on a generated map, and on a hand-made map whose manifest asks for towns. Performance mode draws no towns and levels nothing.

### Levelling

`levelGround(grids, towns, frame)` returns new grids and leaves its inputs alone, because the generated pixels are shared.

- It levels three grids alike: the map's heights, the wider heights that carry the land past the map's edge, and the relief the light is worked out from. A grid left out is skipped.
- Inside 0.95 of the town's edge the ground is flat at the town's level. From there to 1.7 times the edge it eases back to the land's own height. These are the spike's values and are tuned on screen.
- A town's level is the mean height of the dry land in that flat part, read from the map's heights.
- Where two towns' skirts overlap, a point is pulled towards each town's level, each by its own pull less the other's, so the result does not depend on the order of the towns. Where a neighbour's skirt reaches a town's flat part, that part keeps the town's own level.
- Sea is never raised and land is never lowered to sea.
- A location that a landmark is expected to stand on is not levelled. If the landmark then finds no site and the town is drawn after all, its buildings stand on the raw ground and the layout's slope rule applies.

The terrain picture is not repainted. Rock colour can remain on ground that is now flat, mostly under the street sheet.

### Layout

`layoutTown(town, style, ground)` returns a list of placements: a model, a centre, a turn and a base height. It is pure and seeded from the town's own seed, so a map always draws the same towns.

- Blocks run along the town's axis, with an avenue crossing at its centre each way.
- Every road that arrives at the town is kept clear as a boulevard from the edge to the centre.
- A lot is left empty when it is outside the town's edge, in the sea, on a river or its bank, or on ground too steep to build on.
- Wanted height falls from the centre to the edge, and a small town is lower than a capital. Density falls towards the edge too.
- Each lot takes the model nearest its wanted height whose lots are all free.
- A town that ends with no building gets one single-lot model at its centre.

| | Open town | Sealed outpost |
|---|---|---|
| Lot | 0.25 | 0.75 |
| Block, in lots | 4 by 2 | 2 by 2 |
| Street | 0.1 | 0.2 |
| Avenue | 0.2, every third block | 0.3, every second block |
| Boulevard | 0.25 | 0.35 |

The lot sizes are decided. The other widths are the spike's and are tuned on screen.

### Building inventory

`buildings.ts` holds a list of models. Each has:

- an id
- a footprint in lots, such as 1 by 1 or 2 by 2
- a height in world units
- which kind of settlement it belongs to, open or sealed
- a build function that adds its parts to a landmark `Builder`, round its own origin, standing on y = 0, with a foundation below so a slope shows no gap

The first entries are ten cuboids from 0.12 to 2.4 high, drawn at 1.5 times those heights, used for both kinds of settlement. A real model replaces a cuboid by taking its footprint and height. When no placeholder is left the list is the inventory.

### Town layer

`buildTownModelLayer` builds one group per town.

- Each model is built once. A town's mesh is the models copied to their placements and merged, so a town is one draw. Each copy takes its own shade so no two neighbours match.
- The material is the landmark material, lit by the terrain's sun, with the cast panel pattern.
- The street sheet is a mesh draped on the ground inside the town's edge, in one colour from the palette, fading out at the edge. It draws where the painted town drew, over a province's tint.
- Each town bakes one shadow map from the sun, as a landmark does, and its buildings and the ground read it. The map's side follows the town's radius, up to 1024 for a full capital, which is the texel density a stronghold's shadow has. The spike's 2048 for every town would have held about 200 MB on the 18 location test map. The PR reports the texture memory the test map takes.
- The ground decal gets two changes: ground beyond the shadow map's far side is not drawn as shadowed, and a town's decal leaves out the darkening at the foot, which was drawn for a single model.
- `setStyle(nodeIndex, TownStyle)` takes the same style the painted towns take. Hidden by fog draws the town dim and grey. The ring is drawn on the decal, one lot outside the town's furthest building. A town's edge can reach well past its buildings where the ground is too steep or wet to build on, so the ring follows the buildings and not the edge.
- The violet mist of an event stop is not drawn on a 3D town, as it is not drawn on a landmark.
- A town keeps its badge. The badge stands above the town's tallest building, which the layer reports in `tops`.
- On a Territories map a capital is marked by a star, not a badge. It stands above its town's tallest building too, and faces the camera there. A capital with no town under it keeps its star flat on the ground.
- The player's home ring lies on the ground just outside the capital's own ring, so no building stands through it. A capital with no town of buildings keeps the flat ring of a fixed size.
- The meshes are never picked. The location's own hit target carries the pointer.

### Palettes

`TOWN_PALETTES: Record<PlanetId, TownPalette>` in `landmarks/palettes.ts`, so a missing planet fails the build. A palette has the building colour, the street colour, and what settles on roofs. Each starts from that planet's stronghold concrete, which is already tinted to the planet. A hand-made map with no planet uses temperate.

## What is removed

In the last PR, once the 3D towns draw everywhere the painted ones did:

- `townShader.ts`
- `buildTownLayer` and the block bake in `townLayer.ts`
- the town index, patches, field cells and bake layout in `towns.ts`
- the fields, and the planet settings only the painted towns read
- the `--towns` option of `scripts/map-frame-timing`, replaced by one that times the 3D towns

`townGate.ts` stays as the rule for where towns are drawn.

## Testing

Vitest in the node environment, with a flat or sloped `createTerrainSurface`.

- `levelGround`: the core is flat at the mean, the ground past the skirt is unchanged, sea stays sea, two overlapping towns give the same result in either order, and all three grids move alike.
- `layoutTown`: every building lies inside the edge, no two share a lot, boulevards are clear, the same town gives the same placements, a town too small for a block still gets one building, and a sealed planet uses the 0.75 lot.
- `buildings.ts`: every model stands on y = 0 and stays inside its lots.
- The town layer builds on a flat surface, leaves landmark locations out, reports a top for each town and `setStyle` flips the fog uniform.
- `planGround` gives the same roads and towns the ground layer gave before the split.

The look is checked on screen, not by tests.

## Verification on screen

In a seeded portable instance per `CLAUDE.md`, on its own MCP socket, with `multiplayer.autoConnect` off in the copy.

1. Open a generated land map on a temperate planet and one on a moon.
2. Capture a capital, a mid town and a small town at far, mid and closest zoom on each.
3. Capture one town hidden by fog and one selected.
4. Run `scripts/map-frame-timing` before and after on a quiet machine, and put both tables in the PR.

## Delivery

Three PRs.

1. Levelling: `level.ts`, the `planGround` split and the new order in the view. The painted towns then sit on level ground.
2. The 3D towns: inventory, layout, town layer, palettes and the decal changes. The painted towns and fields stop being drawn.
3. Removal of the painted towns' code.

`bun run check` passes before each.

## Out of scope

Each of these is its own piece of work, in its own chat.

- The real building models for open towns.
- The real structures for sealed outposts.
- Letting the camera come closer than distance 25.
- Drawing buildings as instances, if the frame timing in PR 2 calls for it.
- Repainting the terrain picture where ground was levelled.
