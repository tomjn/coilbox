# The lego parts pack

A parts pack is a library of pre-textured geometry the unit builder assembles units from. It is a documented format, not a coilbox internal, so anyone can build and ship one.

Coilbox bundles one pack, derived from Splinter Faction's Lego Models and reused with the author's permission. Splinter Faction and Evolution RTS build units "lego style": a single fixed UV atlas carries hundreds of small pre-mapped pieces, and units are assembled from those pieces rather than modelled and unwrapped from scratch.

## Layout

```
legoparts/
  pack.json        manifest and per-part index
  parts.bin.gz     geometry, gzipped
  atlas.png        the texture every part samples
  LICENCE.txt      provenance
```

Coilbox looks for `.coilbox/legoparts/` beside the executable first, then the bundled copy. Dropping a pack into the portable path replaces the built-in one.

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

`scripts/legopack/` converts Splinter Faction's Wings3D source into a pack. It runs once and its output is committed, so coilbox itself never parses `.wings`.

```
bun run lego:pack --wings <legosv2.wings> --atlas <atlas.bmp> --version 2026.07.28
```

The sources are not checked in. They live in [the Splinter Faction repository](https://github.com/SplinterFaction/SplinterFaction/tree/master/Lego%20Models).

Before trusting a full run, dump one part and look at it in Blender. A UV or winding mistake would otherwise be baked into every part in the pack.

```
bun run lego:pack --wings <legosv2.wings> --verify Object731
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
