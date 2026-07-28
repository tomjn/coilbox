# The s3o model format

Reference for `.s3o`, the model format Spring and Recoil use for units and features. Written because the community wiki documents the tooling but not the bytes.

Everything here is verified two ways: against `rts/Rendering/Models/s3o.h` and `S3OParser.cpp` in [RecoilEngine](https://github.com/beyond-all-reason/RecoilEngine), and by parsing shipped models. The `coilbox-s3o` crate implements it, and its tests assert the claims on this page against a real model.

## Layout

All values are little endian. The engine byte-swaps on big-endian hosts, so files themselves are always little endian.

A file is a header, then a graph of pieces reached by absolute file offsets. Sections can appear in any order, and different tools order them differently.

### Header, 52 bytes at offset 0

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `char[12]` | magic, `Spring unit\0` |
| 12 | `int32` | version, always 0 |
| 16 | `float` | radius of the collision sphere |
| 20 | `float` | height of the whole object |
| 24 | `float[3]` | midx, midy, midz |
| 36 | `uint32` | file offset of the root piece |
| 40 | `uint32` | collision data offset, must be 0 |
| 44 | `uint32` | file offset of the first texture name |
| 48 | `uint32` | file offset of the second texture name |

Texture names are NUL-terminated strings anywhere in the file. An offset of 0 means no texture. PNG works, so DDS is not required.

`radius` and `height` are only used when greater than `0.01`. Below that the engine computes its own from the geometry, which is a deliberate way to defer to it. `mid` is always taken from the header, and is the offset from the origin, which sits on the ground plane, to the middle of the collision sphere.

**`radius` is measured from `mid`, not from the origin.** The two describe one sphere, so they have to share a centre. Checked against `ammobox2.s3o`: its header radius of 12.749866 is exactly its furthest vertex from its own `mid`, where the furthest from the origin is 17.6037. A generator that measures from the origin gives every model built off-centre a collision sphere far larger than its geometry.

`height` is looser. `ammobox2.s3o` declares 18 where its geometry reaches 16.353, so it is an authored figure rather than a derived one, and writing the true top of the model is fine.

### Piece, 52 bytes

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `uint32` | file offset of the piece name |
| 4 | `uint32` | number of children |
| 8 | `uint32` | file offset of the child table, an array of `uint32` piece offsets |
| 12 | `uint32` | number of vertices |
| 16 | `uint32` | file offset of the vertex array |
| 20 | `uint32` | vertex type, always 0 |
| 24 | `uint32` | primitive type: 0 triangles, 1 triangle strips, 2 quads |
| 28 | `uint32` | number of indices |
| 32 | `uint32` | file offset of the index array, `uint32` each |
| 36 | `uint32` | collision data offset, must be 0 |
| 40 | `float[3]` | xoffset, yoffset, zoffset from the parent piece |

The offset is a translation. There is no rotation or scale field, so anything that generates models has to bake those into vertex positions and emit only the translation.

### Vertex, 32 bytes

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `float[3]` | position, relative to the piece origin |
| 12 | `float[3]` | normal |
| 24 | `float[2]` | u, v |

## Conventions the struct does not state

**No axis negation.** `S3OParser.cpp` assigns `sv.pos = float3(v->xpos, v->ypos, v->zpos)` verbatim, so file coordinates are engine coordinates. Y is up.

**Front faces wind counter-clockwise.** The parser does not flip winding, so a generator has to get this right. Checked empirically: in `ammobox2.s3o` all 356 triangles have `cross(b - a, c - a)` pointing along the mean vertex normal, none against it.

**A triangles piece has a flat index list.** Three indices per triangle, no end-of-primitive markers. `0xFFFFFFFF` is an end-of-strip marker and only appears in strip pieces. The parser only checks for it in the strip branch, so a marker in a triangle list would be read as a vertex index.

**Indices are piece-local.** They address the piece's own vertex array, not a shared one.

**Zero counts mean the matching offset is ignored.** The engine only dereferences the vertex, index and child pointers when the count is above zero, because widely used s3o tools leave stale offsets on empty pieces. Writing 0 is the clean choice, and readers must not dereference regardless.

**Empty pieces are the hierarchy.** A piece with no vertices is how models carry structure and named points. `ammobox2.s3o`'s root is `base` with 0 vertices and one child. Flares, aim points and build emitters are the same thing: an empty piece at a position, named so a unit script can address it.

**Piece names should be lower case.** Unit scripts address pieces by name and the tooling is inconsistent about case, so lower case avoids the whole problem.

**Strips and quads are converted on load.** `SS3OPiece::Trianglize` turns both into triangles, so writing triangles is always safe.

## Reading and writing in coilbox

`crates/coilbox-s3o` is a dependency-free library crate.

```rust
let model = coilbox_s3o::read(&bytes)?;
let bytes = coilbox_s3o::write(&model)?;
```

`write` lays sections out densely and deterministically: header, every piece struct in depth-first pre-order, then names, child tables, vertices, index tables and the two texture names. Re-writing a third-party file therefore moves bytes around without changing meaning, so the round-trip test asserts the model survives rather than the bytes. It also asserts the output is the same length as the original, which catches anything lost or duplicated.

`write` rejects content the engine would read as garbage: an index that addresses no vertex, an index count that is not a whole number of primitives, and a NUL inside a piece name.

## Sources

- [`rts/Rendering/Models/s3o.h`](https://github.com/beyond-all-reason/RecoilEngine/blob/master/rts/Rendering/Models/s3o.h), struct layout
- [`rts/Rendering/Models/S3OParser.cpp`](https://github.com/beyond-all-reason/RecoilEngine/blob/master/rts/Rendering/Models/S3OParser.cpp), load behaviour and the conventions above
- [Skeletor_S3O](https://github.com/Beherith/Skeletor_S3O), independent Python implementation
- [s3o-blender-tools](https://github.com/ChrisFloofyKitsune/s3o-blender-tools), independent Blender implementation
