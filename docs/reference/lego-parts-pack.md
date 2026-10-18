# Parts pack format

A parts pack is a library of pre-textured geometry the unit builder assembles units from. It is a documented format, not a coilbox internal, so anyone can build and ship one.

Coilbox bundles one pack, derived from KaiserJ's original v2 lego parts, released on the [Spring forums](https://springrts.com/phpbb/viewtopic.php?t=22283) with "do whatever the heck you'd like with these". The "lego style" approach is how Splinter Faction and Evolution RTS build their units, each with its own separate part set: a single fixed UV atlas carries hundreds of small pre-mapped pieces, and units are assembled from those pieces rather than modelled and unwrapped from scratch.

## Layout

```
legoparts/
  pack.json        manifest and per-part index
  parts.bin.gz     geometry, gzipped
  atlas.png        the texture every part samples
  LICENCE.txt      provenance
```

Coilbox looks for `.coilbox/legoparts/` beside the executable first, then the bundled copy. Dropping a pack into the portable path replaces the built-in one. On Windows the bundled copy is one level deeper, in `.coilbox/resources/legoparts/`, which the installer rewrites on every update, so `.coilbox/legoparts/` stays yours.

## Extension packs

A pack can add parts to another pack's atlas. That is an extension pack, and it is how a game adds its own pieces without reworking the texture or losing access to the ones already there.

Extension packs live one folder each under `<data_dir>/lego/packs/`, alongside the projects and thumbnails. In portable mode that is inside `.coilbox`, so a distribution can ship extension packs the same way it ships everything else. The Lego Parts screen shows the exact path, but only when a pack fails to load.

```
<data_dir>/lego/packs/
  aliens/
    pack.json
    parts.bin.gz
```

An extension pack is a normal pack with three differences:

- `extends` names the base pack it adds to, by id.
- It has no `atlas` and no `textures`. It uses the base pack's, which is what lets its parts sit in the same unit as the base pack's. Repeating the base pack's `textures.tex1` is allowed and means the same thing.
- It ships no atlas file. There is one atlas for the whole library.

```json
{
  "schemaVersion": 1,
  "id": "coilbox-aliens",
  "extends": "splinterfaction-legosv2",
  "version": "1",
  "licence": "...",
  "geometry": { "file": "parts.bin.gz", "encoding": "gzip", "bytes": 4096, "vertexStride": 32 },
  "categories": [{ "id": "chitin", "label": "Chitin" }],
  "parts": [...]
}
```

A pack that extends nothing, extends a pack that is not installed, or names a texture other than the base pack's is skipped, and the Lego Parts screen says why. The atlas rule is not a policy choice: an s3o names one texture and every piece in the model samples it, so a unit is bound to exactly one atlas and there is no way to export a mix.

A pack that brings its own atlas *instead of* parts is a different thing. See atlas packs below.

**Part ids have to be unique across packs.** Ids are global, and the first pack to claim one keeps it: the base pack loads first, then extension packs by folder name. A later pack's part whose id is already taken is skipped and reported. Nothing silently changes what an id draws, which is what would otherwise break every saved unit that used it. Content-hash ids, as `scripts/legopack/` generates, give this for free.

Parts from every loaded pack sit in one grid, filtered by pack alongside the existing search and category. A unit is free to mix them.

A unit records the base pack it was built against. Opening one whose pack is not installed still works: the pieces keep their names, hierarchy and transforms, and any piece whose part is missing draws nothing and is counted in the warnings above the viewport.

## Atlas packs

An atlas pack redraws the base pack's atlas. It is how a faction gets its own look without redrawing a single part: the parts stay where they are on the sheet, the pixels change.

An atlas pack is an extension pack's mirror image. It ships a texture and no parts, where an extension pack ships parts and no texture. It lives in the same folder, one directory each under `<data_dir>/lego/packs/`, and is found the same way.

```
<data_dir>/lego/packs/
  desert/
    pack.json
    desert2048.png
```

```json
{
  "schemaVersion": 1,
  "id": "coilbox-desert",
  "reskins": "splinterfaction-legosv2",
  "version": "1",
  "licence": "...",
  "atlas": { "width": 2048, "height": 2048 },
  "textures": { "tex1": "desert2048.png" }
}
```

- `reskins` names the parts pack whose atlas this one replaces, by id.
- `textures.tex1` is the PNG the pack ships, and it must not be the name any other installed atlas uses. Two atlases with the same file name would land on top of each other in a game's `unittextures/`.
- It has no `parts` and no `geometry`. A pack that brings both an atlas and parts is skipped: that would be a second parts library, and a unit cannot mix two.
- **It has to keep the base atlas's UV layout.** Nothing can check this. Every part's UVs are the base pack's, so a redrawn sheet that moves anything leaves those parts sampling the wrong pixels. Resizing the sheet is fine, since UVs are normalised.
- **It has to keep the base pack's swatches plain.** Generated shapes tile the [swatches](#swatches) the base pack lists, so they are part of the layout too. Keep each swatch, and 8 pixels round it, a plain surface that looks right repeated and mirrored. Paint alpha there to give shapes team colour. Keep each of its [round panels](#round-panels) round and in place too.

A unit samples one atlas, chosen when the unit is created and changeable at any point while editing. Changing it does nothing to the pieces: every part is mapped into every atlas, so nothing is dropped and nothing is remapped. The change is an ordinary edit, and undo takes it back.

The unit records the atlas by texture file name, which is what the s3o names. A unit whose atlas is not installed still opens: it is drawn with the base atlas, says so above the viewport, and still names its own atlas when exported, so installing the pack later completes the unit without touching it. An export in that state cannot copy the texture or write the Blender files, and the export drawer says which.

An export writes exactly one atlas, the unit's own. It lands in `unittextures/` under the pack's name for it with `coilbox_` in front, which is also the name the s3o gives it: a pack's own name is unique only among packs, and `atlas.png` is a name a game could already have. A file already at that name is left alone rather than overwritten, and the export drawer says when that happened.

## pack.json

The manifest is the index. Search and filtering run entirely against it, so a picker can be browsed before the geometry has finished loading.

```json
{
  "schemaVersion": 1,
  "id": "splinterfaction-legosv2",
  "version": "2026.07.28",
  "source": { "wings": "legosv2.wings", "wingsSha256": "...", "atlas": "...", "atlasSha256": "..." },
  "licence": "...",
  "atlas": { "width": 2048, "height": 2048 },
  "textures": { "tex1": "atlas.png" },
  "unit": 0.25,
  "geometry": {
    "file": "parts.bin.gz", "encoding": "gzip", "bytes": 24438000,
    "sha256": "...", "vertexStride": 32
  },
  "categories": [{ "id": "green", "label": "Team colour" }],
  "parts": [
    {
      "id": "c7a55d17c378",
      "name": "team colour block 1x0.5x0.5",
      "category": "green",
      "colourway": "green",
      "shape": "block",
      "material": "default",
      "tags": ["block", "tiny", "row7"],
      "vFirst": 0, "vCount": 24, "iFirst": 0, "iCount": 36,
      "bbox": { "min": [-0.5, -0.25, -0.25], "max": [0.5, 0.25, 0.25] },
      "uvBox": { "min": [0.12, 0.44], "max": [0.19, 0.51] },
      "pivot": [0, 0, 0],
      "sourceNames": ["Object123_sep4"],
      "aliasCount": 7,
      "uvIncomplete": 2
    }
  ]
}
```

`vFirst` and `vCount` are in vertices, `iFirst` and `iCount` in indices. `uvIncomplete` counts faces the original model never unwrapped, and is absent when there are none.

Parts are recentred on their own bounding box, so a part's origin is its middle. `pivot` shifts that when the middle is wrong, which is what a wheel wants.

## Connectors

A connector is a place where a part can be joined to another. Every part has them: the pack either states them or the builder works them out.

A connector has four fields, all in the part's own space, the same space as `bbox` and `pivot`:

```json
{
  "id": "top",
  "position": [0, 0.5, 0],
  "facing": [0, 1, 0],
  "up": [0, 0, 1]
}
```

- `id` is a name, unique within the part. A join records connector ids rather than positions, so swapping one part for another that has the same ids keeps the join.
- `position` is where the connector is.
- `facing` is the way out of the part, with a length of 1.
- `up` has a length of 1 and is at right angles to `facing`. It fixes the twist: a join turns the piece until its `up` lines up with the other connector's, so "twist 90 degrees" means the same on every part.

Lengths and angles are checked to within 0.001, so a value rounded to four decimals passes.

To state connectors, give a part a `connectors` list:

```json
{ "id": "c7a55d17c378", "bbox": {...}, "connectors": [{ "id": "top", "position": [0, 0.5, 0], "facing": [0, 1, 0], "up": [0, 0, 1] }] }
```

A part with a `connectors` list uses that list and none of the derived ones. An empty list is allowed and means nothing joins to the part. A part with no `connectors` field gets derived ones, which is every part in the bundled pack. Extension packs follow the same rules.

A list is used whole or not at all. If any connector in it is invalid, or two share an id, the part falls back to its derived connectors, and the Lego Parts screen reports the pack and the first part affected. Half a list would leave joins to the missing connectors broken without a word.

Overriding a bundled part goes through `scripts/legopack/overrides.json` like the rest of a part's fields.

### Derived connectors

The builder derives six connectors for a part from its `bbox`, one at the middle of each face, facing out of it. The id is the sign and axis of the facing: `+x`, `-x`, `+y`, `-y`, `+z`, `-z`. `+y` is the top of any part.

`up` follows one rule on every part: it is `[0, 1, 0]` on the four side faces and `[0, 0, 1]` (the unit's forward) on the top and the bottom, where +y would be the facing itself.

The box's guess is wrong for a part that is not boxy, such as a wheel or a hexagonal block, and those are the parts that want a stated list. Corners and the middle of the box are not connectors, because a corner has no facing.

A piece's scale and pivot move its connectors with it. A mirrored piece's `+x` faces the way the piece now points, so it joins on the side it sits on.

## Part unit

`unit` in the manifest is the pack's step size in the same units as `bbox`: the spacing its parts are built on. Moving and sliding a piece in steps uses it. It is a positive number and optional.

A pack that states none gets 0.25, which `DEFAULT_PART_UNIT` in `src/lego/pack.ts` exports. `partUnit(pack)` gives the value for a loaded library. A stated `unit` that is not a positive number is ignored and reported.

A library has one unit, the base pack's, because parts from every pack mix in one unit and a piece cannot sit on two grids. An extension pack that states a different `unit` is reported and its value is ignored. Stating the base pack's own value is fine.

The bundled pack states 0.25. Counting its 373 parts from `pack.json` to within 0.002:

- 295 have all three sides on a 0.25 step, and 207 on a 0.5 step.
- 78 have a side off the 0.25 step: 51 blocks, 21 beams and 6 plates, such as `grey block 1.5x1.5x1.25`.
- Parts are centred on their bounding box, so a face connector sits half a side from the middle. That half side is on a 0.25 step for 207 parts and on a 0.125 step for 295. A part 0.75 wide has its side faces half a step off the grid.

Choose a `unit` for your own pack by the same count: the step that most of its parts' sides fall on.

### Sizes in the bundled pack

The builder resizes a pack part by swapping it for another part of the same pack, colourway, shape and material whose other two sides match. A pack with more sizes gives a drag more to land on. The bundled pack has gaps. Counted on its team colour colourway, which the other two repeat:

- 36 of its 82 blocks have no other size along their longest side, and 110 of their 246 sides have no other size at all.
- 49 of the 84 sides of its beams have no other size.
- 40 of the 42 sides of its plates have no other size.

A generated shape has no such gap, because it is made at whatever size is asked for.

## Swatches

A swatch is a rectangle of plain surface on the atlas that the unit builder's generated shapes tile. Shapes such as cylinders and wedges are made in code, not stored in any pack, so they have no panels of their own. A pack neither adds shapes nor changes their numbers. It only says where on the atlas they sample.

`swatches` in the manifest lists them, one per colourway:

```json
"swatches": [
  { "id": "green", "uv": { "min": [0.168, 0.9492], "max": [0.1992, 0.9805] }, "tile": 1.56 }
]
```

- `id` matches a part's `colourway`. A new shape takes the colourway most of the unit's pieces use.
- `uv` is the rectangle in the pack's UVs, v up from the bottom, each number from 0 to 1 with `min` below `max`.
- `tile` is how many pack units one copy of the swatch covers. Set it so a shape is drawn at the same pixels per unit as the parts. The bundled atlas has 41.1 pixels per unit and 64 pixel swatches, so its `tile` is 1.56.

A shape is cut on a grid one `tile` wide, and each piece samples the swatch with every other copy mirrored, so there is no seam and nothing stretches as the shape is resized. A shape's UVs never leave its swatch.

The bundled pack has three swatches, team colour, tan and grey, each 64 pixels square. The team colour one is all team colour, as most of the team colour column of the atlas is. Tan is grainy concrete. Grey is a flat light grey.

Only the base pack's swatches count. Extension packs and atlas packs use them. A base pack that lists none offers no shapes. A swatch with no id, an id another swatch has, a rectangle outside the atlas or a `tile` that is not a positive number is skipped, and the Lego Parts screen reports how many.

Choose swatches with an 8 pixel margin of the same surface round each one. That keeps the smaller mipmap levels on the same surface at a tile edge, so filtering does not pull in a neighbouring panel.

## Round panels

A round panel is a circle on the atlas that a cylinder, a tube or a cone can show on its flat ends, in place of its tiled swatch, when **Hub on ends** is ticked in the piece panel. `roundPanels` in the manifest lists them, one per colourway:

```json
"roundPanels": [
  { "id": "green", "centre": [0.061035, 0.272461], "radius": 0.032227 }
]
```

- `id` matches a swatch's `id`. A shape in a colourway with no round panel has no **Hub on ends** choice.
- `centre` is in the pack's UVs, v up from the bottom, and `radius` is in the same units. The whole circle must be on the atlas.

The panel is fitted to the end, so it stretches as the radius grows. A tube's end ring shows the outer part of the panel, from the hole's share of the radius out. A shape's UVs on its ends never leave the circle.

The bundled pack's round panels are the seven spoked wheel drawn in each column, 66 pixels in radius. That is the pack's own density on an end 1.6 units in radius. At 3.2 units, twice that, the panel is soft but still reads as drawn. Past that it is visibly blurred.

Only the base pack's round panels count, as with swatches. A panel with no id, an id another panel has, a circle that leaves the atlas or a radius that is not a positive number is skipped, and the Lego Parts screen reports how many.

## parts.bin

Gzipped on disk. Inflated it is:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | magic, `CBLEGO\0\0` |
| 8 | 4 | `uint32` version, currently 1 |
| 12 | 4 | `uint32` part count |
| 16 | 4 | `uint32` offset of the vertex block |
| 20 | 4 | `uint32` length of the vertex block |
| 24 | 4 | `uint32` offset of the index block |
| 28 | 4 | `uint32` length of the index block |

The vertex block is per-part runs of 32-byte records: `float32` x, y, z, nx, ny, nz, u, v, little endian. That is deliberately the same record s3o uses, so exporting a part is a transform and a copy rather than a conversion.

The index block is per-part runs of `uint16`, three per triangle, indexing the part's own vertices. Each run is padded to a 4-byte boundary so a `Uint16Array` view never straddles.

There is no directory in the blob. `pack.json` holds it.

## Things a pack has to get right

**Triangles wind counter-clockwise** seen from outside, matching s3o. See [the s3o format](https://github.com/tomjn/coilbox/blob/main/docs/internal/s3o-format.md).

**The atlas's alpha channel is the team colour mask** once it is in a game. The engine mixes an s3o's first texture with the player's colour by its alpha: 0 is the atlas's own colour and 255 is all team colour, and a PNG with no alpha loads as 255 everywhere. An export writes an atlas that has no alpha channel with an alpha of 0, so a unit shows the parts' own colours and no team colour. The `.glb` export bakes the same atlas in through the same function, so the two cannot disagree. An atlas that has an alpha channel is written as it is, so an atlas pack that wants team colour on some parts paints it into its alpha. The bundled atlas has one, which marks its team colour column. A game exported to before that keeps its old copy, with no team colour, until the export drawer is told to replace textures already there.

**v runs up from the bottom of the atlas**, as it does in an `.obj` and in the builder. The engine reads an s3o's v from the top of a PNG, so the s3o export writes a part's v as 1 - v. The `.obj` and `.glb` exports keep the pack's v. A mesh imported from a game's own model is already in the engine's convention, and is exported as it came.

**UVs are not clamped to 0 to 1.** Some parts in the bundled pack sample a neighbouring atlas column through negative `u`, so the texture must repeat rather than clamp.

**Vertices are float32 and pre-merged.** Positions, normals and UVs are already rounded, and identical corners share a vertex.

## Building the bundled pack

`scripts/legopack/` converts KaiserJ's v2 lego OBJ source into a pack. It runs once and its output is committed, so coilbox itself never parses OBJ.

```
bun run lego:pack --obj <legosv2.obj> --atlas <lego2skin.png> --version 2026.07.28
```

The sources are not checked in. KaiserJ released them on [the Spring forums](https://springrts.com/phpbb/viewtopic.php?t=22283).

### The team colour mask

KaiserJ's atlas is an RGB PNG with no alpha channel. He painted its first column red to mark the team colour set, and left the mask to whoever used the kit. In the release thread, Forboding Angel, whose Evolution RTS was built from these parts, wrote "The red pieces ARE teamcolor" and made the mask by hand.

The build makes it by rule, in `scripts/legopack/teamColour.mjs`, and writes `atlas.png` with an alpha channel. For each pixel in the first column, how far its red stands above its green and blue becomes the alpha. What is left becomes the colour, scaled so that the engine's mix gives it back. So:

- Pure red is all team colour.
- Darker red is darker team colour, which keeps the panel lines.
- Pink edges are a pale tint of team colour.
- A red player sees the atlas exactly as KaiserJ drew it.
- Black, grey and white pixels in the first column, and every pixel in the tan and grey columns, have an alpha of 0 and show no team colour.

To rebuild only the atlas, without the OBJ:

```
bun run lego:atlas --atlas <lego2skin2048_2-2.png>
```

The input has to be KaiserJ's original, the file `pack.json` names under `source.atlas`, with the sha256 under `source.atlasSha256`. It refuses a PNG that already has an alpha channel, so it cannot be run on its own output, which has had the red taken out of its colour.

Before trusting a full run, dump one part and look at it in Blender. A UV or winding mistake would otherwise be baked into every part in the pack.

```
bun run lego:pack --obj <legosv2.obj> --verify Object731
```

The build reports everything it changed or could not do: faces it could not ear clip, triangles it turned round, zero-area triangles it dropped, faces with no UVs, and a final audit of how many triangles disagree with their own normals. None of it is silent.

### Where the categories come from

The part names in the source file are `Object1848_copy5182` and carry no meaning, so the converter derives everything:

- **Colourway**, the category. The atlas is three vertical columns of the same panel layout in team colour red, tan and grey, and a part's `u` says which it samples. A unit generally wants one colourway throughout, which makes this the cut worth browsing by. Parts spanning a boundary are "mixed".

  The first column is the original kit's team colour set. KaiserJ painted it red to mark where a modder adds the team colour mask, and shipped it with no mask. The build adds one, so these parts draw in the player's colour in the builder and in a game. See [the team colour mask](#the-team-colour-mask). Its id is `green`, the name the converter first gave it by mistake. It keeps that id because a saved unit names a shape's swatch by it.
- **Shape**: sheet, beam, plate or block, from the bounding box aspect ratio.
- **Size**: a quintile of the longest side.
- **Row**: which eighth of the atlas the part sits in vertically, which groups parts the artist drew near each other.

The generated name carries the dimensions, as in `tan block 2.5x1.5x0.5`, because that is what someone assembling a unit actually looks for.

`scripts/legopack/overrides.json` overrides any of this by part id. It ships near empty on purpose: the pack is searchable without it, so curating is an improvement rather than a prerequisite. Part ids are content hashes, so they survive a rebuild and saved projects keep resolving.
