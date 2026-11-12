# 3D trees on the land map

Status: built as a first pass on `feat/forest-3d`, 12 November 2026. Written for review of the decisions, which were made without a design round.

## What this builds

Forests on a generated terrain map stop being crowns painted into the ground picture and become real trees standing on the ground, at the scale of the town buildings. The terrain picture keeps only what lies under them.

## Decisions

- Trees are real shapes drawn as copies (GPU instancing), one shape per kind of tree, near and far. No billboards and no painted crowns.
- A tree's size is set against the buildings. A low building of an open town is 0.18 world units high. A grown oak is 0.15 to 0.24, a beech 0.2 to 0.3, a spruce 0.2 to 0.34, a pine 0.2 to 0.3, a birch 0.14 to 0.22 and a shrub 0.04 to 0.08. A stand's age scales these by 0.72 to 1.22.
- The planting is the only source of truth. The terrain picture reads where the trees stand from a texture the forest layer makes, so the ground and the trees cannot disagree.
- The colours are the planet's existing `forest` palette. No new planet settings.
- Performance mode draws no trees, as it draws no towns.
- A hand-made map draws no trees. It has no biome weights to plant from.

## Architecture

New folder `src/conquest/galaxy3d/forest3d/`.

| File | Job |
|---|---|
| `placement.ts` | Pure. Where every tree stands, its kind, size and shade, and the cover picture |
| `trees.ts` | The shape of each kind, near and far |
| `material.ts` | The one shader every tree is drawn with |
| `forestLayer.ts` | Reads the map, plants it, builds the meshes, picks near or far per tile |

### Planting

- One candidate tree to a 0.07 cell, anywhere in its cell. The cells are visited in a shuffled order, and a candidate inside a planted crown is dropped. This is what removes the grid.
- Where trees grow comes from the generator's biome weights, sharpened as the terrain picture sharpens them. Forest thins to single trees at its edge.
- Slow noise fields give glades, a stand's kind of tree, and old and young stands. Conifers take the higher ground and some stands of their own. A cold forest is spruce with patches of bare birch.
- Grassland grows copses and the odd lone tree.
- Nothing grows in the sea, on steep ground, within 0.03 of a river, within 0.12 of a road, inside 1.1 times a town's edge, or on a landmark's site.
- Each tree records how far up it the trees toward the sun shade it.

### Drawing

- The map is cut into tiles 8 world units a side. A tile draws each kind of tree it holds in one call.
- A tile whose trees are under 12 pixels high draws the far shapes, of 20 to 40 triangles. Nearer, it draws the near shapes, of 80 to 138.
- The shader is matte. Light wraps round a crown, there is no shine, and a fine noise breaks each crown into clumps of leaf. A crown is darker low down and below its neighbours' shadow. The vertex shader swells each crown differently, so one shape gives many trees.
- Snow lies on the trees of a planet with frost.
- Trees past the map's edge grey and haze out as the land does.

### The ground under the trees

The forest layer draws a two channel picture over the terrain's own: canopy cover and tree shadow. The terrain shader draws leaf litter under the canopy, the clearing colour in a glade, and darkens the ground where a shadow falls. The painted crowns, `tCrown` and `tCanopy`, are removed.

## What was measured

On the test map (temperate, seed 35058, 18 locations, 100 by 100 world units), through the harness in `docs/reports/town-3d/`:

- 90,764 trees. An ice planet with the same seed has 113,782.
- Planting took about 2 seconds on the main thread, with the machine's load average near 8.
- A frame at the closest zoom, 2880 by 1800, drew 4.53 million triangles in 301 calls, towns and terrain included. With near shapes starting at 6 pixels in place of 12 it drew 6.85 million.
- No frame time was measured. The harness's timing read under 1 ms, which cannot be right, and the machine was under load.

## Rocks, bushes, desert plants and dead trees

Added on `feat/scatter-3d`, on top of the trees. The same planting pass and the same layer draw them, so they are six more kinds and no new system.

- Boulders and crags on stony ground (rock, scree, mesa, basalt, flows), and a few on bare ground (tundra, regolith, ash, dust, earth, cracked). None on a slope steeper than 0.4, which the terrain picture already draws as bare rock. They take the planet's two steep-ground colours, so every planet has them, including the four where nothing grows.
- Bushes on scrub, in place of the dark dots the terrain picture painted there, and a few on tundra.
- On a dry world, which is one with scrub and no forest: cactus and flat-topped acacia among the bushes, and palms within 0.3 of a river. Its plants take a sage and cactus palette held in `material.ts`, since the planet has no forest colours.
- Dead trees at a cold forest's edge and a few on dry scrub.
- A rock is 0.03 to 0.14 high. Anything smaller is under two pixels at the closest zoom. A cactus is drawn stouter than a real one for the same reason.

Counts on the test map after these were cut to a quarter at review: desert 24,581, moon 1,510, temperate 90,838, ice 115,467.

## Not done

- Frame timing with `scripts/map-frame-timing` on a quiet machine.
- Moving the planting off the main thread, if 2 seconds at map open is too long.
- Trees in a town's parks and along its streets.
- Any tuning of sizes, colours or densities. Every value is a first pick.
