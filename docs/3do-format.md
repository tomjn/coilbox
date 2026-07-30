# The 3do model format

Reference for `.3do`, the Total Annihilation model format Spring and Recoil still load. Written because most units in most installed games are `.3do` rather than [`.s3o`](/s3o-format), so anything that shows a real game's models has to read it.

Everything here is verified two ways: against `rts/Rendering/Models/3DOParser.h` and `3DOParser.cpp` in [RecoilEngine](https://github.com/beyond-all-reason/RecoilEngine), and by parsing the 3633 `.3do` files shipped by five installed games. The `coilbox-3do` crate implements it.

## How it differs from s3o

Both formats are a tree of named pieces with an offset from the parent, and past that they have little in common.

| | `.3do` | `.s3o` |
| --- | --- | --- |
| Coordinates | `int32`, 1/65536 of a unit, Z runs the other way | `float`, engine units |
| Faces | any number of corners, mostly quads | triangles, strips or quads |
| Texture | one per face, by name, no UV | one or two for the whole model, with UVs |
| Normals | none, derived on load | one per vertex, stored |
| Tree | first child plus next sibling | a child count and a table of offsets |
| Bounds | none, derived on load | radius, height and middle in the header |

The per-face texture is the difference that matters to anything that draws these. An `.s3o` binds one texture and draws the whole model, a `.3do` binds a texture per face.

## Layout

All values are little endian and signed. Every offset is absolute from the start of the file, so sections can appear in any order. There is no magic number: the first field of the first object is the closest thing to one.

The root object always starts at offset 0.

### Object, 52 bytes

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `int32` | version signature, always 1 |
| 4 | `int32` | number of vertices |
| 8 | `int32` | number of primitives |
| 12 | `int32` | selection primitive, or -1 |
| 16 | `int32[3]` | x, y, z from the parent |
| 28 | `int32` | file offset of the object name |
| 32 | `int32` | always 0 |
| 36 | `int32` | file offset of the vertex array |
| 40 | `int32` | file offset of the primitive array |
| 44 | `int32` | file offset of the next sibling object, 0 for none |
| 48 | `int32` | file offset of the first child object, 0 for none |

### Vertex, 12 bytes

Three `int32`: x, y, z.

### Primitive, 32 bytes

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `int32` | palette entry |
| 4 | `int32` | number of vertex indices |
| 8 | `int32` | always 0 |
| 12 | `int32` | file offset of the index array, `uint16` each |
| 16 | `int32` | file offset of the texture name, 0 for none |
| 20 | `int32[3]` | colour data the engine does not read |

## Conventions the struct does not state

**Coordinates are 1/65536 of an engine unit, and Z is negated.** `GetVertices` scales by `1.0f / 65536.0f` then flips the sign of Z, and `LoadPiece` does the same to the offset from the parent. A reader that skips the flip mirrors every model.

**A face is stretched over the whole of its texture.** There are no UVs. The engine packs `unittextures/tatex/` into an atlas and gives each corner of a face a corner of its texture's entry.

**The texture name in the file is usually not the texture.** The engine lower cases the name, and appends `00` unless the name appears in the game's `unittextures/tatex/teamtex.txt`. A face with no name at all is drawn in a flat colour taken from entry `n` of the Total Annihilation palette, which the engine looks up as `ta_colorN`. Roughly one face in seventeen across the installed games is a flat colour.

**The tree is a first child and a next sibling**, not a child table. A sibling belongs to the reader's parent, not to the object that names it, so the root cannot have one.

**Face normals are derived, and their sign is not the usual one.** The engine takes `-(v1 - v0) x (v2 - v0)`, the negative of the usual right-handed convention. Checked empirically: with the negation, 85 percent of faces in the installed models point away from the middle of their own piece, and without it 15 percent do.

**Vertex normals are smoothed per corner, not per vertex.** The engine averages the normals of the faces meeting at a corner, counting only those whose normals agree to within about 63 degrees, so a hard edge stays hard while a curve reads as smooth.

**Some faces exist but are never drawn.** The engine drops four kinds on load, and 24293 of the 809135 faces in the installed games are one of them.

- The root's selection primitive, which is the flat quad drawn under a selected unit. The field appears on every object and is honoured only on the root. In 84 pieces across the installed games it names a face that does not exist.
- Anything with fewer than three corners. There are 6437 of these, and some name vertices their piece does not have, which is why the engine drops them before it reads their indices.
- Base plates: quads facing straight down, at least 30 units along two edges, with no corner above the piece origin. Exporters left more than one of these behind in some models.
- Duplicate faces, meaning two faces on the same set of corners. Models animate by stacking faces with different textures, and only the last of a set is drawn.

**Empty pieces are the hierarchy**, as in `.s3o`. Balanced Annihilation's `armcom.3do` has a `head` piece with no geometry at all, holding `head1` and `crown`, and its root `ground` is four vertices whose one face is the selection quad.

## Reading in coilbox

`crates/coilbox-3do` is a dependency-free library crate.

```rust
let model = coilbox_3do::read(&bytes)?;
```

There is no writer and there will not be one. Editing a `.3do` ends in saving an `.s3o`, so the format only travels one way. That is why the reader mirrors the engine's parser rather than the file: since nothing is written back, being faithful to the bytes buys nothing and being faithful to the model the engine draws buys everything. The four kinds of dropped face above are dropped here too.

Anything the engine would read past the end of its own arrays for is an error instead, because a viewer cannot tell a silently empty model from a working one.

### Testing against real models

No `.3do` is checked in. Every installed game's models descend from Total Annihilation's, which are not ours to redistribute, so the tests synthesise files byte by byte and pin one real parse by its hash.

To run the corpus test, extract the models from the games and point `COILBOX_3DO_CORPUS` at them:

```sh
mkdir -p /tmp/3do && cd /tmp/3do
unzip -o -d ba ~/.spring/games/balanced_annihilation-v15.9.8.sdz '*.3do'
COILBOX_3DO_CORPUS=/tmp/3do cargo test -p coilbox-3do
```

Without the variable the test does nothing, so CI never needs the files.

## Sources

- [`rts/Rendering/Models/3DOParser.h`](https://github.com/beyond-all-reason/RecoilEngine/blob/master/rts/Rendering/Models/3DOParser.h), struct layout
- [`rts/Rendering/Models/3DOParser.cpp`](https://github.com/beyond-all-reason/RecoilEngine/blob/master/rts/Rendering/Models/3DOParser.cpp), load behaviour and the conventions above
