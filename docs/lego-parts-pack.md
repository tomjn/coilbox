# The lego parts pack

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

Coilbox looks for `.coilbox/legoparts/` beside the executable first, then the bundled copy. Dropping a pack into the portable path replaces the built-in one.

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
  "geometry": {
    "file": "parts.bin.gz", "encoding": "gzip", "bytes": 24438000,
    "sha256": "...", "vertexStride": 32
  },
  "categories": [{ "id": "green", "label": "Green" }],
  "parts": [
    {
      "id": "c7a55d17c378",
      "name": "green block 1x0.5x0.5",
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

**Triangles wind counter-clockwise** seen from outside, matching s3o. See [the s3o format](/s3o-format).

**UVs are not clamped to 0 to 1.** Some parts in the bundled pack sample a neighbouring atlas column through negative `u`, so the texture must repeat rather than clamp.

**Vertices are float32 and pre-merged.** Positions, normals and UVs are already rounded, and identical corners share a vertex.

## Building the bundled pack

`scripts/legopack/` converts KaiserJ's v2 lego OBJ source into a pack. It runs once and its output is committed, so coilbox itself never parses OBJ.

```
bun run lego:pack --obj <legosv2.obj> --atlas <lego2skin.png> --version 2026.07.28
```

The sources are not checked in. KaiserJ released them on [the Spring forums](https://springrts.com/phpbb/viewtopic.php?t=22283).

Before trusting a full run, dump one part and look at it in Blender. A UV or winding mistake would otherwise be baked into every part in the pack.

```
bun run lego:pack --obj <legosv2.obj> --verify Object731
```

The build reports everything it changed or could not do: faces it could not ear clip, triangles it turned round, zero-area triangles it dropped, faces with no UVs, and a final audit of how many triangles disagree with their own normals. None of it is silent.

### Where the categories come from

The part names in the source file are `Object1848_copy5182` and carry no meaning, so the converter derives everything:

- **Colourway**, the category. The atlas is three vertical columns of the same panel layout in green, tan and grey, and a part's `u` says which it samples. A unit generally wants one colourway throughout, which makes this the cut worth browsing by. Parts spanning a boundary are "mixed".
- **Shape**: sheet, beam, plate or block, from the bounding box aspect ratio.
- **Size**: a quintile of the longest side.
- **Row**: which eighth of the atlas the part sits in vertically, which groups parts the artist drew near each other.

The generated name carries the dimensions, as in `green block 2.5x1.5x0.5`, because that is what someone assembling a unit actually looks for.

`scripts/legopack/overrides.json` overrides any of this by part id. It ships near empty on purpose: the pack is searchable without it, so curating is an improvement rather than a prerequisite. Part ids are content hashes, so they survive a rebuild and saved projects keep resolving.
