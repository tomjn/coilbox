# Replay track format

A track is a recording of where everything was during one replay: units, the pieces they aim with, projectiles, features, terrain and build queues. Coilbox records it in one headless run of the replay and plays it back with time going in either direction.

This page is the design of format version 1. It is written so that a second person can write a reader from it. The Rust crate `crates/coilbox-track` (issue #3781) reads and writes it. `crates/coilbox-track-thin` (issue #3782) makes a track from the recorder's raw dump. The engine side is the two milestones after "Replay rewind: record a match".

A track file has the extension `.cbtrack`. The same file is read by coilbox and by Lua inside the engine, so there is no export step and no second copy on disk.

The numbers on this page come from three places: the engine source, the two benchmark recordings from the spike in #3778, and measurements made for this design on those recordings. [How the measurements were made](#how-the-measurements-were-made) lists the scripts.

## What the engine's Lua can read

The format is shaped by what Lua in the engine can do. Each point was checked in RecoilEngine at commit `212c369b4c`.

- Numbers are 32 bit floats. `rts/lib/lua/include/luaconf.h` sets `LUA_NUMBER` to `float`. A whole number is exact only up to 16,777,216, which is 2 to the power 24. So no single value in a track is larger than 16,777,215, and a 32 bit word that packs several fields together cannot be read in one call.
- `VFS.UnpackU8`, `UnpackU16`, `UnpackU32`, `UnpackS8`, `UnpackS16`, `UnpackS32` and `UnpackF32` take a string, a position that counts from 1, and a count. With a count they return a table of that many values in one call. They read fixed widths only, in the machine's byte order. `UnpackType` in `rts/Lua/LuaVFS.cpp` returns nothing when the position is the last byte of the string or beyond it.
- `VFS.ZlibDecompress` is the only decompressor. It calls zlib's `uncompress`, so it reads a zlib stream as RFC 1950 describes, with the two byte header and the Adler-32 checksum. It does not read raw deflate or gzip. It raises a Lua error on a bad stream, and also when the result is empty.
- `zlib::inflate` in `rts/System/StringUtil.cpp` starts with a 262,144 byte buffer. When the result does not fit it doubles the buffer and decompresses again from the start.
- The `io` library is opened for unsynced Lua only (`rts/Lua/LuaLibs.cpp`). Synced Lua has `VFS.LoadFile`, which returns a whole file as one string.
- `file:seek` takes its offset as a Lua number. An offset above 16,777,216 is exact only when it is a multiple of a large enough power of two.

## File layout

All values are little endian. `VFS.Unpack*` reads in the machine's byte order and does not swap, so the engine's Lua can read a track on a little endian machine only. x86-64 and arm64 both are.

```
header          96 bytes
window index    16 bytes for each window
info chunk      names, teams and the map
features chunk  every feature of the match
window 0        main chunk, then a terrain chunk if terrain changed
window 1        ...
```

Each chunk is a zlib stream that starts at a multiple of 64 bytes from the start of the file. The gap before it is filled with zero bytes. The header and index are not compressed.

The file is cut into windows of a fixed number of frames. A window holds everything a reader needs for any frame inside it, so a seek reads one window and never the whole match.

Chunks start on 64 byte blocks so that Lua can address them. A block number below 16,777,216 times 64 is an offset that a 32 bit float holds exactly, which reaches 1,073,741,824 bytes. The padding this costs was 3,915 bytes in the larger benchmark.

## Header

96 bytes at offset 0.

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `char[4]` | magic, `CBTK` |
| 4 | `u16` | format version, 1 |
| 6 | `u16` | header size in bytes, 96 |
| 8 | `u16` | recorder version |
| 10 | `u16` | frames per second of the simulation. The engine's `GAME_SPEED` is 30 |
| 12 | `u32` | first frame recorded |
| 16 | `u32` | last frame recorded |
| 20 | `u32` | window length in frames, 1 to 65,535, so that an offset in a window fits 16 bits |
| 24 | `u32` | number of windows |
| 28 | `f32` | tolerance in elmos. No recorded sample is further than this from the track, measured as [the tolerance](#what-the-tolerance-measures) says. The only float in the file |
| 32 | `u8` | position shift. The position step is 1 elmo divided by 2 to this power |
| 33 | `u8` | velocity shift. The velocity step is 1 elmo per frame divided by 2 to this power |
| 34 | `u8` | rotation bits, 8 to 16 |
| 35 | `u8` | frames between the recorder's unit samples. For information only |
| 36 | `u32` | block number of the info chunk |
| 40 | `u32` | length of the info chunk in bytes |
| 44 | `u32` | block number of the features chunk |
| 48 | `u32` | length of the features chunk in bytes |
| 52 | `u32` | number of units in the match |
| 56 | `u32` | number of projectiles in the match |
| 60 | `u32` | number of features in the match |
| 64 | `u8[16]` | the replay's game id, copied from the replay header |
| 80 | `u8[16]` | reserved, zero |

A block number times 64 is the chunk's offset in the file. Every `u32` in the header and index is at most 16,777,215.

The number of windows is the frame span divided by the window length, rounded up, and at least 1. The frame span is the last frame minus the first, so a span of exactly one window length is one window. Window `k` starts at `first frame + k * window length`. It ends one window length later, or at the last frame if that comes first. A frame on the boundary between two windows is in both, and both give the same values for it.

The engine version, the game and the map are text and live in the info chunk.

### Versions

A reader refuses a file whose magic is not `CBTK` or whose format version it does not know, and names the field and the value it found. This is what `require_known_layout` does for replay headers in `crates/tauri-plugin-coilbox-content/src/demo.rs`.

The header size is a minimum. A later writer may add fields after byte 96, so a reader finds the index at the header size the file states, not at 96.

A change that adds a column or a header field keeps version 1, because readers skip what they do not know. A change to the meaning of anything on this page is a new version.

The recorder version is separate. It changes when the recorder would produce different keys from the same replay, and when a track gains something a reader depends on. Issue #3786 uses it to mark a track as stale, and a stale track is recorded again.

| Recorder version | What changed |
| --- | --- |
| 2 | Pose keys are relative to the parent piece (issue #3783) |
| 3 | The info chunk has a footprint for each unit definition, columns 181 and 182 (issue #3807). The format version is still 1, because a column was added and nothing changed its meaning |

## Window index

The index starts at the header size. It has one 16 byte entry for each window, in order.

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `u32` | block number of the main chunk |
| 4 | `u32` | length of the main chunk in bytes |
| 8 | `u32` | block number of the terrain chunk, or 0 |
| 12 | `u32` | length of the terrain chunk in bytes, or 0 when no terrain changed in the window |

A reader that has the header and the index knows where every window is without touching one.

## Chunks

A chunk is one zlib stream. Decompressed, it is a list of columns. A column is an array of one integer type.

```
u32   number of columns
      then for each column, 12 bytes:
u16     column id
u16     type: 1 u8, 2 u16, 3 s16, 4 u32, 5 s32
u32     offset of the column's data from the start of the decompressed chunk
u32     number of values
      then the data of each column
      then 4 zero bytes
```

- Columns are listed in rising order of id, and an id appears once.
- Each column's data starts at a multiple of 4 bytes and is padded with zero bytes to the next one.
- A column that is not listed has no values. For a column with one value per unit, that means 0 for every unit.
- A reader ignores a column id it does not know, and a column of a type it does not know.
- A writer lists only columns that have values. It also leaves out a count column (ids 10, 11 and 12) whose value is 0 for every unit, as the worked example does.
- A decompressed chunk is at most 16,777,215 bytes, so every offset in it is exact in Lua.
- The 4 zero bytes at the end mean no column ends on the last byte of the chunk, which `VFS.Unpack*` cannot read from.
- A zlib stream ends with a checksum of the data, and `uncompress` checks it. A chunk that fails to decompress is an error for that window only. The header, the index and every other window still read.

In Lua, one column is one call: `VFS.UnpackS16(chunk, offset + 1, count)`.

## How a column stores values

Columns of the same kind sit together, so position differences are beside position differences. That is what lets zlib compress them. Four ways of storing a value are used.

Plain. The value itself.

Time. A `u16` number of frames since the previous key of the same curve. For a curve's first key in a window it is the number of frames since the window's first frame. Two keys of one curve never share a frame.

Difference with an escape. Two columns: a narrow `s16` one with a value for every key, and a wide `s32` one. To read a curve, keep a running value. For each key, take the next narrow value `d`. If `d` is -32768, the key's value is the next unread value of the wide column. Otherwise the key's value is the running value plus `d`. The first key of every curve in a window is written with the escape, so the wide column always gives the starting value. A wide value is between -16,777,215 and 16,777,215.

Wrapping difference. A `u16` column. Keep a running value that starts at 0 for each curve. For each key the value is the running value plus the stored one, modulo 65,536. Where the value is signed, a result of 32,768 or more stands for that result minus 65,536. No escape is needed, because the values never leave 16 bits.

## Units of measurement

- A position, a piece offset and a height are whole numbers of position steps. The step is `1 / 2^position shift` elmo.
- A velocity is a whole number of velocity steps. The step is `1 / 2^velocity shift` elmo per frame.
- A piece angle is a whole number of 65,536ths of a turn. That is the engine's own unit for piece angles, `COBSCALE` in `rts/Sim/Units/Scripts/CobInstance.h`.
- A frame is a simulation frame. A reader may ask for a time between two frames.

### Rotation

A unit's rotation is a unit quaternion `(x, y, z, w)`. It turns the unit's resting directions, front `(0, 0, 1)` and up `(0, 1, 0)`, into its front and up directions in the world:

```
front = ( 2(xz + wy),  2(yz - wx),  1 - 2(xx + yy) )
up    = ( 2(xy - wz),  1 - 2(xx + zz),  2(yz + wx) )
```

A writer builds it from the recorded front and up. It takes `right = up x front`, makes the rotation matrix whose columns are right, up and front, and converts that to a quaternion in the usual way.

Three of the four components are stored. The one with the largest size is dropped, and the quaternion is negated first if that component is negative. The reader gets it back as `sqrt(1 - a*a - b*b - c*c)`. The three kept ones, in the order x, y, z, w with the dropped one left out, are each stored as a signed whole number `n`:

```
n         = round( component * (2^(rotation bits - 1) - 1) / sqrt(1/2) )
component = n * sqrt(1/2) / (2^(rotation bits - 1) - 1)
```

A kept component is never larger in size than `sqrt(1/2)`, so `n` fits in the number of bits the header gives.

## Info chunk

One chunk, read once. A list of strings is two columns: the length of each string in bytes as `u16`, and the bytes of all of them end to end as `u8`. Strings are UTF-8 with no terminator.

| Id | Type | Column |
| --- | --- | --- |
| 160, 161 | strings | track text. In order: engine version, game name and version, map name, the name and version of the program that wrote the file |
| 162, 163 | strings | unit definition names |
| 164, 165 | strings | weapon definition names |
| 166, 167 | strings | feature definition names |
| 168 | `u16` | for each unit definition with posed pieces, its index in the unit definition names |
| 169 | `u16` | for each of those, how many posed piece names it has |
| 170, 171 | strings | posed piece names, grouped in the order of column 168 |
| 172 | `u8` | team id |
| 173 | `u8` | ally team of each team |
| 174 | `u8` | team flags. Bit 0 is set for an AI team |
| 175 | `u8` | team colour, three values for each team: red, green, blue |
| 176, 177 | strings | side name of each team |
| 178, 179 | strings | leader name of each team |
| 180 | `u32` | two values, the map's size along x and z in elmos |
| 181 | `u16` | for each unit definition, the size of its footprint across the unit, in elmos |
| 182 | `u16` | for each unit definition, the size of its footprint along the way the unit faces, in elmos |

Every other chunk refers to a definition by its index in these lists, counting from 0. A definition is stored by name because its id changes between builds of a game (issue #1176). A piece is stored by name for the same reason.

Only the definitions and pieces the track uses are listed. A writer may list more.

A footprint is the ground a unit takes up, and it is what the map view on the replay page sizes a unit's mark from (issue #3807). Columns 181 and 182 are in the order of the unit definition names. They are the engine's `xsize` and `zsize` for the definition, each times 8. The engine counts both in heightmap squares, a square is 8 elmos (`SQUARE_SIZE` in `rts/Sim/Misc/GlobalConstants.h`), and `xsize` is twice the definition's `footprintX` (`rts/Sim/Units/UnitDef.cpp`). A track written before recorder version 3 has neither column. A reader that needs a footprint treats such a track as stale and does not guess one.

The text of a definition is not stored. The game the track is played back in has it. The benchmark files spend 3,101,936 and 1,123,360 bytes on definitions and map data as text. The info chunks measured here are 2,130 and 619 bytes.

## Features chunk

One chunk for the whole match, with one entry for each feature. Features appear and go but are not recorded as moving, so one list is smaller than repeating them in each window.

| Id | Type | Column |
| --- | --- | --- |
| 128 | `u16` | the engine's feature id |
| 129 | `u16` | feature definition |
| 130 | `u8` | team, or 255 for none |
| 131 | `u8` | flags. Bit 0: it was there before the first frame. Bit 1: it was still there after the last frame |
| 132 | `u32` | first frame it exists |
| 133 | `u32` | last frame it exists |
| 134, 135, 136 | `s32` | position x, y, z, plain |
| 137 | `u8` | rotation: which component is dropped |
| 138, 139, 140 | `u16` | rotation: the three kept components, plain. Each is the signed whole number `n` as a 16 bit two's complement value |

A feature exists at frame `f` when `first <= f <= last`.

## Main chunk

One for each window. Offsets in it are frames counted from the window's first frame.

### Units

One entry for each unit that exists at any frame of the window.

| Id | Type | Column |
| --- | --- | --- |
| 1 | `u16` | the engine's unit id. The engine's `MAX_UNITS` is 32,000 |
| 2 | `u32` | serial number, counting from 0 in order of first appearance in the match |
| 3 | `u16` | unit definition |
| 4 | `u8` | team |
| 5 | `u8` | flags. Bit 0: it existed before this window. Bit 1: it exists after this window |
| 6 | `u16` | offset of the first frame in this window at which it exists |
| 7 | `u16` | offset of the last frame in this window at which it exists |
| 8 | `u16` | number of transform keys |
| 9 | `u16` | number of status keys |
| 10 | `u8` | number of target tracks |
| 11 | `u16` | number of pose tracks |
| 12 | `u16` | number of build queue keys |

The engine reuses unit ids, so the serial number is what identifies a unit across windows. Two entries in one window can share a unit id when one unit died and a later one took its id.

Every key column below holds the keys of the first unit, then the second, and so on. Within a unit, keys are in time order. Every key of a unit lies between its first and last offset.

### Transform keys

At least one for each unit.

| Id | Type | Column |
| --- | --- | --- |
| 16 | `u16` | time |
| 17, 18, 19 | `s16` | position x, y, z, difference with an escape |
| 20, 21, 22 | `s32` | the wide columns for x, y and z |
| 23 | `u8` | rotation: which component is dropped, 0 to 3 for x, y, z, w |
| 24, 25, 26 | `u16` | rotation: the three kept components, wrapping difference, signed |

Between two keys the position is a straight line. The rotation is the two quaternions blended in the same proportion and then scaled back to unit length, with the second one negated first when the dot product of the two is negative. A blend does not run at an even speed, so a window that starts part way along a blend, with a key added at its edge, matches the whole curve only to within rounding when the two keys are close in rotation. Keys kept by thinning are.

### Status keys

At least one for each unit.

| Id | Type | Column |
| --- | --- | --- |
| 32 | `u16` | time |
| 33 | `u16` | health as a fraction of the unit's maximum at that frame, 65,535 for full. Wrapping difference |
| 34 | `u16` | build progress, 65,535 for complete. Wrapping difference |
| 35 | `u8` | flags, plain. Bit 0: the unit is switched on |

Health and build progress run in a straight line between keys. Flags hold until the next key.

A writer clamps health to the range before storing it. In the larger benchmark 850 of 22,467 status keys had health above the maximum and 172 had it below zero.

### Target tracks

A unit has one target track for each weapon that had a target in the window, and one for its builder work if it did any. A track that is missing means no target for the whole window. So a unit with one weapon costs one track, and a second weapon costs nothing until it has a target of its own.

Column 10 says how many tracks each unit has. The tracks of the first unit come first.

| Id | Type | Column |
| --- | --- | --- |
| 40 | `u8` | for each track, the weapon number from 1, or 0 for builder work. The engine's `MAX_WEAPONS_PER_UNIT` is 32 |
| 41 | `u16` | for each track, its number of keys |
| 42 | `u16` | time |
| 43 | `u8` | kind |
| 44 | `u32` | reference, 0 when the kind has none |
| 45 | `u8` | for builder work, the build power in use, 255 for full. 0 for a weapon |
| 46, 47, 48 | `s32` | position x, y, z in position steps, plain. One entry for each key whose kind is 128 or more |

| Kind | Meaning | Reference |
| --- | --- | --- |
| 0 | nothing | |
| 1 | a unit | index in this window's units |
| 2 | a feature | index in the features chunk |
| 4 | a projectile | index in this window's projectiles |
| 16 | building or repairing a unit | index in this window's units |
| 17 | reclaiming a unit | index in this window's units |
| 18 | reclaiming a feature | index in the features chunk |
| 19 | resurrecting a feature | index in the features chunk |
| 20 | capturing a unit | index in this window's units |
| 128 | a position | none. Takes the next entry of columns 46 to 48 |
| 129 | terraforming at a position | none. Takes the next entry of columns 46 to 48 |

A target holds until the next key. A reader treats a kind it does not know as nothing, and still takes a position entry for it when the kind is 128 or more.

A writer refuses a key whose reference is not in the window it is written into, since the file cannot say what it points at.

The engine reports build power as a count out of 15 (`MASK_BITS` in `rts/Sim/Misc/NanoPieceCache.h`). A writer stores that count times 17.

A target that stops existing is followed by a key of kind 0 on the frame after its last. The engine goes on answering with a dead unit's id until the weapon picks again, so a recording does not say the target has gone, and without the key a later window would start with a target that is not in it.

Kind 129 needs a position. The engine does not tell Lua where a builder is terraforming, and the recorder has a place only for a builder whose own order names one. A builder that is helping another terraform is written as kind 0.

### Pose tracks

A pose track is one aiming piece of one unit. It holds what a unit script set on the piece: three turn angles and three offsets, both relative to the piece's parent. They are the values a Lua unit script passes to `Turn` and `Move` for that piece, and gets back from `GetPieceRotation` and `GetPieceTranslation`.

Column 11 says how many tracks each unit has. A track that is missing means the piece is at rest for the whole window, with all six values 0.

The engine places a piece in its parent's space in two steps (`S3DModelPiece::ComposeTransform` in `rts/Rendering/Models/3DModelPiece.cpp`, at the commit named above):

1. It moves the piece to the model's rest offset for it plus the three offsets.
2. It turns the piece about its own origin by the three angles: about z first, then about x, then about y, each about the parent's axes. That is `CQuaternion::FromEulerYPR` in `rts/System/Quaternion.cpp`. As matrices that act on a column it is `Ry * Rx * Rz`, where each is the usual right handed turn about that axis.

A piece's place in the unit's model space is its parent's, then those two steps. `Spring.GetUnitPieceMatrix` gives that as a matrix, and it is what the recorder writes. `coilbox-track-thin` (issue #3783) takes the parent's matrix off, takes the rest offset off the translation, and takes the rotation apart into the three angles.

A reader sets the six values on the piece and gets the recorded pose. Four things to know:

- A COB script's own numbers are not these. The engine negates a COB turn about z and a COB move along x before it sets them (`CCobInstance::Turn` and `Move` in `rts/Sim/Units/Scripts/CobInstance.h`). The track holds the values after that.
- A rotation has two sets of three angles, `(x, y, z)` and `(half a turn - x, y + half a turn, z + half a turn)`, and each angle can be any number of whole turns further on. The writer picks the set nearest the sample before, so the angles of two keys in a row are never far apart unless the piece turned that far. The engine itself keeps each angle between 0 and one turn, so a key's angles are the same rotation as the script's and not always the same numbers.
- When the angle about x is a quarter turn, the rotation depends on the angles about y and z only through their difference or their sum. The writer keeps the angle about z it had on the sample before.
- A model in a format that bakes a rest rotation into a piece, which Assimp and glTF models can do, has that rotation between the two steps, and the engine has no Lua call that reads it. For such a model the angles hold the rest rotation and the script's turn together. They still give the recorded pose when composed as above, and they are not what to pass to `Turn`. `3do` and `s3o` models have no rest rotation, and every unit with a posed piece in the two benchmark matches has one of those. `coilbox-track-thin` reports the unit definitions this applies to.

| Id | Type | Column |
| --- | --- | --- |
| 56 | `u16` | for each track, the piece: an index into the posed piece names of the unit's definition |
| 57 | `u16` | for each track, its number of keys |
| 58 | `u16` | time |
| 59, 60, 61 | `s16` | angle about x, y, z, difference with an escape |
| 62, 63, 64 | `s32` | the wide columns for the angles |
| 65, 66, 67 | `s16` | offset x, y, z from the piece's rest position, difference with an escape |
| 68, 69, 70 | `s32` | the wide columns for the offsets |

All six values run in a straight line between keys. An angle is not reduced to one turn when it is read. If two keys are a turn and a half apart, the piece turns a turn and a half between them.

An angle cannot be stored without limit, because a piece that spins all match long passes 16,777,215 steps. The largest angle in the larger benchmark is 887.44 radians, which is 141 turns. So in each window a writer shifts every key of a track by the same whole number of turns, chosen so that the track's first key in that window is between -32,768 and 32,767. The shift is chosen for each of the three angles on its own, so the three angles of one key may be shifted by different numbers of turns. The shift does not change what is drawn. A reader never compares an angle in one window with an angle in another.

### Build queue keys

Column 12 says how many keys each unit has. A unit with none has an empty queue for the whole window.

| Id | Type | Column |
| --- | --- | --- |
| 72 | `u16` | time |
| 73 | `u8` | for each key, the number of items in the queue |
| 74 | `u16` | for each item, the unit definition |
| 75, 76 | `s32` | for each item, position x and z in position steps, plain |
| 77 | `u8` | for each item, the facing, 0 to 3 |

A queue holds until the next key.

### Projectiles

One entry for each projectile that exists at any frame of the window.

| Id | Type | Column |
| --- | --- | --- |
| 80 | `u32` | serial number, counting from 0 in order of first appearance in the match |
| 81 | `u16` | weapon definition, or 65,535 for a projectile that has none |
| 82 | `u8` | team, or 255 for none. A piece of debris can have none |
| 83 | `u8` | flags. Bit 0: it existed before this window. Bit 1: it exists after this window |
| 84 | `u16` | the unit that fired it, as an index in this window's units, or 65,535. A unit that is not in the window counts as none |
| 85 | `u16` | offset of the first frame in this window at which it exists |
| 86 | `u16` | offset of the last frame in this window at which it exists |
| 87 | `u16` | number of keys |
| 88 | `u16` | time |
| 89, 90, 91 | `s16` | position x, y, z, difference with an escape |
| 92, 93, 94 | `s32` | the wide columns for position |
| 95, 96, 97 | `s16` | velocity x, y, z, difference with an escape |
| 98, 99, 100 | `s32` | the wide columns for velocity |

The engine's projectile id is not stored. The engine's `MAX_PROJECTILES` is 128,000, which does not fit 16 bits, and playback makes its own projectiles. The serial number is what identifies one across windows.

A projectile with no weapon definition is a piece of debris. They are 1,895 of the 20,609 projectiles in the larger benchmark and 349 of 627 in the smaller.

A projectile has a key at its first offset and at its last. Between two keys `n` frames apart, with positions `p0` and `p1` and velocities `v0` and `v1`, the position at the fraction `s` of the way from the first to the second is the cubic of issue #3784:

```
p(s) = (2s^3 - 3s^2 + 1) p0 + (s^3 - 2s^2 + s) n v0 + (-2s^3 + 3s^2) p1 + (s^3 - s^2) n v1
```

The velocity is the slope of that curve, divided by `n`.

## Terrain chunk

One for each window in which the heightmap changed. It has one row for each height that changed, sorted by frame, then z, then x.

| Id | Type | Column |
| --- | --- | --- |
| 112 | `u16` | frames since the previous row. For the first row, frames since the window's first frame |
| 113 | `u16` | heightmap x, as a wrapping difference from the previous row |
| 114 | `u16` | heightmap z, as a wrapping difference from the previous row |
| 115 | `s32` | height before the change in position steps, as a difference from the previous row's height before. The first row's is a difference from 0 |
| 116 | `s32` | height after minus height before. Never 0 |

Heightmap x and z count heightmap corners, which are 8 elmos apart (`SQUARE_SIZE`). All three running values start at 0 at the top of each chunk.

A row belongs to one window only. Window 0 holds the rows at frames from the first frame to its last frame, and every later window the rows after its first frame up to its last frame. So a reader that has shown frame `a` and wants frame `b` reads the terrain chunks of the windows from the one holding `a` to the one holding `b`, and applies the rows between the two frames.

A writer keeps three rules.

1. At most one row for a point in a frame.
2. A change that rounds to nothing is not written. At a step of an eighth of an elmo that drops 58,084 of the 168,736 rows in the larger benchmark.
3. A row's height before is the height after of the previous row for that point, in any window. For a point's first row it is the map's own height. The writer works the height before out from its own record of what it has written, and does not copy it from the recorder.

Rule 3 is what makes playing backwards land where playing forwards started. The benchmark's recorder does not keep it: in 75,480 of its 168,736 rows the height before is not the height after of the row before it at that point, and the largest gap is 16.86 elmos.

To move from frame `a` to a later frame `b`, a reader sets each row's point to its height after, for every row with a frame after `a` and up to `b`, in order. To move back it sets each point to its height before, in reverse order. A seek across several windows reads the terrain chunks in between and not their main chunks. That is why terrain has a chunk of its own.

### Terrain is not the same from run to run

Two recordings of one replay gave 169,161 and 168,736 terrain rows, though the simulation was identical. The cause in the benchmark's recorder is not known.

One fact from the engine may explain it. The engine tells Lua about heightmap changes through `UnsyncedHeightMapUpdate`, and `CReadMap::UpdateDraw` sends at most 128 rectangles each time it draws (`MAX_UHM_RECTS_PER_FRAME` in `rts/Map/ReadMap.cpp`). A recorder that listens there hears about a change at a time that depends on drawing, not on the simulation. Whether the benchmark's recorder does that was not checked.

The format does three things about it.

- Terrain is kept out of the main chunks. Nothing in a main chunk depends on terrain, so two recordings of one replay can be compared byte for byte on their main chunks.
- The rules above remove the differences that are only noise: rows that round to nothing, and a height before that does not follow from the row before.
- It does not promise that two recordings have the same terrain rows. A test compares the heights a track ends with, not its rows.

Coilbox's own recorder, issue #3780, listens there, and its rows differ from run to run for that reason: two recordings of the larger benchmark match had 272,135 and 271,996 terrain rows. It also reads the whole heightmap on the first frame, on every 900th frame and at the end, so the ground at those frames is the same in every recording. `lua/rewind-recorder/README.md` has the detail.

## Reading a frame

To give every value at frame `f`:

1. Work out the window: `k = floor((f - first frame) / window length)`, and the last window if `k` is past the end.
2. Read that window's main chunk if it is not the one already loaded. Seek to its block number times 64, read its length in bytes, and decompress.
3. A unit or projectile exists when `first offset <= f - window start <= last offset`.
4. For each curve, find the keys either side of `f`. Before a curve's first key in the window its value is that key's value. After its last key its value is that key's value.
5. A feature exists when its first and last frame say so.
6. For terrain, apply the rows between the frame last shown and `f`.

A reader that holds a whole track as one Lua string can only address the first 16,777,216 bytes of it exactly. Past that it needs `io`, with `file:seek` to the block and `file:read` of the length. The Lua reader in `lua/rewind-player` takes the way bytes are fetched as a function, so a player can pick either.

## Rules for a writer

- For each curve and each window the unit or projectile exists in, copy the keys that fall in the window. If no key sits on the first offset at which it exists in the window, work out the curve's value there and add it as a key, unless the first copied key rounds to the same value. Do the same at the last offset. A transform curve and a status curve always have at least one key. A projectile always has a key at both ends.
- A reader must get the same value for any frame of a window from that window alone as it would from the whole curve. The added keys are what make that true.
- The check in issue #3782, that no dropped sample is further from the track than the tolerance, runs against the rounded values a reader will see. It does not run against the values before rounding. `coilbox-track-thin` reads each window of the file it has made and measures every recorded sample against what the reader's curve functions give from that window's keys.
- A recorded sample that falls on a window's edge is kept as a key. When none falls on an edge, the samples either side of it are kept. Then no window has a value between two samples that was worked out from the curve and rounded a second time, which could put a sample up to one position rounding, 0.108 elmo, further from the track than thinning measured.
- Of three keys in a row with the same value, the middle one is left out, for every curve that runs in a straight line between keys. A unit that stands still for the whole match has one transform key, and the keys above give it one in each window.
- A value that does not fit is an error, not a silent wrap. That covers a position, a velocity, an offset, a height and every value a column stores, including a difference from the key before. Nothing is clamped except health and build progress, which go to the range 0 to 65,535 as the status keys say.
- Any zlib level reads the same. Level 9 was 1.6% smaller than level 6 on the larger benchmark.

## What the tolerance measures

The header's tolerance is one distance in elmos. How far a recorded sample is from the track depends on what was sampled.

- A unit. The distance between the recorded position and the track's, plus the unit's radius times the angle in radians between the recorded rotation and the track's. No point within the radius of the unit's centre is further than that from where it was recorded, so one tolerance holds at a unit's centre and at the end of its barrel. The radius is the unit definition's, `UnitDefs[id].radius`, which the recorder writes in the dump's header.
- A piece. The distance between the recorded offset and the track's, plus the piece's reach times the angle in radians between the recorded rotation and the track's. Both are relative to the piece's parent, as a pose key is. The reach is how far the model's geometry gets from the piece's origin, counting the piece's own geometry and that of every piece below it, with all of them at rest. So no point of that geometry is further than the tolerance from where a script's values for this piece put it. A piece with no geometry on it or below it, such as the point a barrel fires from, has no reach of its own and takes the unit's radius. The recorder writes each piece's rest offset and the box round its geometry in the dump's piece tree.
- A piece is measured against its parent and not against the unit. A barrel on a sleeve on a turret is drawn with the error of all three, so in the unit's model space a point on it can be up to three tolerances from where it was recorded. How far the pieces of the benchmark tracks are in model space was not measured.
- A projectile. The distance between the recorded position and the cubic's. Velocity has no tolerance. Its worst error is reported, and [Projectile velocity](#projectile-velocity) has what it came to.
- Health and build progress. These are fractions and not distances, so the header's tolerance does not apply. A sample is within one step of the 65,535 a fraction is stored in.
- Flags, targets, build queues, teams, and the frames a unit or a projectile exists on have no tolerance. The track has what was recorded or it is wrong.

A track that is further from a recorded sample than its tolerance is a failed recording. `coilbox-track-thin` writes no file for one and names the sample.

## Choosing the steps and the window length

The steps and the window length are header fields, so a writer can change them without a new format version. These are the rules a version 1 writer uses, and the measurements behind them. The tolerance of both benchmarks is 0.5 elmo.

### Position step

Rule: the largest power of two step whose rounding moves a point no further than a quarter of the tolerance. Rounding each of three axes by up to half a step moves a point by up to `step * sqrt(3) / 2`. For a tolerance of 0.5 that gives a step of one eighth of an elmo, and a position shift of 3.

A coarser step makes each key smaller but uses up tolerance, so thinning keeps more keys. Both were measured on the larger benchmark. The keys column is unit positions thinned to 0.5 elmo with the kept keys rounded to the step. The size column is the whole track laid out as this page describes.

| Step in elmos | Largest rounding error | Position keys kept | Against no rounding | Track size in bytes |
| --- | --- | --- | --- | --- |
| no rounding | 0 | 254,777 | | |
| 1/32 | 0.0271 | 254,987 | +0.08% | 5,264,256 |
| 1/16 | 0.0541 | 255,248 | +0.18% | 5,037,056 |
| 1/8 | 0.1083 | 255,812 | +0.41% | 4,805,376 |
| 1/4 | 0.2165 | 258,035 | +1.28% | 4,569,728 |
| 1/2 | 0.4330 | 265,497 | +4.21% | 4,329,344 |

Each halving of the step costs between 227,200 and 240,384 bytes and saves a fraction of a percent of keys, so size alone favours a coarse step. The quarter rule is a limit on how much of the stated tolerance is rounding. At one eighth the worst case is 22% of it. At one quarter it would be 43%.

At one eighth of an elmo a 16 bit difference reaches 4,095 elmos. The largest move between two keys of one unit is 841 elmos in the larger benchmark and 1,795 in the smaller, so no position needed an escape after a unit's first key in either.

### Rotation bits

Rule: the smallest width at which rounding cannot move a point at the unit's edge further than a quarter of the tolerance. Rounding turns a unit by at most `sqrt(6) / (2^(bits - 1) - 1)` radians. The writer multiplies that by the largest radius of any unit in the match, since a unit's radius is the length issue #3782 weights its rotation by, and picks the smallest width that keeps the result within a quarter of the tolerance. A unit definition that the game has and the match does not use is not counted: the largest radius of any definition is 150 elmos in BAR and 228 in Splinter Faction.

Measured over every transform key of the larger benchmark, with the unit's radius as the length:

| Bits | Largest turn from rounding, radians | The rule's bound, radians | Largest movement at the unit's radius, elmos |
| --- | --- | --- | --- |
| 10 | 0.003550 | 0.004793 | 0.0987 |
| 11 | 0.001812 | 0.002394 | 0.0389 |
| 12 | 0.000868 | 0.001197 | 0.0182 |
| 13 | 0.000437 | 0.000598 | 0.0122 |
| 16 | 0.000055 | 0.000075 | 0.0016 |

The largest unit radius is 85 elmos in the larger benchmark and 130 in the smaller. The rule gives 12 bits for the first and 13 for the second. Going from 11 bits to 12 cost 98,240 bytes on the larger benchmark, and from 12 to 13 cost 95,424.

Rotation rounding costs almost no keys. Issue #3782 thinned both recordings at each width, with everything else the same. 16 bits is the widest the format has and stands in for no rounding.

| Bits | BAR transform keys kept | Against 16 bits | BAR track in bytes | Splinter Faction transform keys kept | Splinter Faction track in bytes |
| --- | --- | --- | --- | --- | --- |
| 10 | 368,826 | +0.35% | 7,418,391 | 29,120 | 330,729 |
| 11 | 367,992 | +0.12% | 7,532,759 | 29,070 | 338,071 |
| 12 | 367,658 | +0.03% | 7,646,679 | 29,040 | 345,159 |
| 13 | 367,554 | +0.00% | 7,755,287 | 29,044 | 352,362 |
| 14 | 367,518 | -0.01% | 7,863,639 | 29,040 | 358,714 |
| 16 | 367,547 | | 8,079,063 | 29,042 | 371,924 |

Each bit from 10 to 14 costs between 108,352 and 114,368 bytes on the BAR track and saves at most 834 keys, so size alone favours a narrow width, as it does for the position step. The quarter rule is what keeps the width up.

### Velocity step

Rule: the largest power of two step whose rounding moves the cubic no further than a quarter of the tolerance over a gap of one window length. Rounding both velocities by up to half a step moves the curve by up to `window length * step * sqrt(3) / 8`. For a tolerance of 0.5 and a window of 900 frames that gives a step of 1/2048 elmo per frame, and a velocity shift of 11.

The fastest projectile in the larger benchmark moves 608 elmos in a frame. A wide value reaches 8,191 elmos per frame at this step.

### Window length

Rule: 900 frames, which is 30 seconds.

A window stands alone, so every unit alive at its start costs a starting value in each window. Short windows pay that often. Measured on the larger benchmark:

| Window length in frames | Track size in bytes | Largest main chunk, decompressed |
| --- | --- | --- |
| 150 | 8,509,504 | 186,996 |
| 300 | 6,365,056 | 293,316 |
| 450 | 5,626,752 | 263,068 |
| 600 | 5,218,176 | 334,032 |
| 900 | 4,805,376 | 462,824 |
| 1,200 | 4,581,504 | 597,460 |
| 1,800 | 4,342,784 | 857,956 |
| 3,600 | 4,066,624 | 1,496,812 |

900 is the longest of these at which the largest window still fits the engine's second buffer of 524,288 bytes, so the engine decompresses it at most twice. No length in the table fits the first buffer of 262,144 bytes in every window.

How long the engine's Lua takes to unpack a window was not measured, and that is what should set the length in the end. The length is in the header so it can change when the playback milestone measures it.

## Worked example

One window of a track with a window length of 900, a position shift of 3 and 12 rotation bits. It holds one unit, engine id 7983, that exists for the whole window and beyond it. The unit stands at (724, 220.5, 800) facing along z. At offset 300 it starts to move. At offset 420 it is at (784, 221.25, 800) and has turned 60 degrees towards x. It is at full health, complete and switched on.

The columns, as a writer builds them:

| Id | Type | Values | What they are |
| --- | --- | --- | --- |
| 1 | `u16` | 7983 | unit id |
| 2 | `u32` | 0 | serial number |
| 3 | `u16` | 0 | unit definition |
| 4 | `u8` | 0 | team |
| 5 | `u8` | 2 | flags: exists after this window |
| 6 | `u16` | 0 | first offset |
| 7 | `u16` | 900 | last offset |
| 8 | `u16` | 3 | transform keys |
| 9 | `u16` | 1 | status keys |
| 16 | `u16` | 0 300 120 | time |
| 17 | `s16` | -32768 0 480 | x |
| 18 | `s16` | -32768 0 6 | y |
| 19 | `s16` | -32768 0 0 | z |
| 20 | `s32` | 5792 | wide x |
| 21 | `s32` | 1764 | wide y |
| 22 | `s32` | 6400 | wide z |
| 23 | `u8` | 3 3 3 | dropped component: w |
| 24 | `u16` | 0 0 0 | kept component x |
| 25 | `u16` | 0 0 1447 | kept component y |
| 26 | `u16` | 0 0 0 | kept component z |
| 32 | `u16` | 0 | status time |
| 33 | `u16` | 65535 | health |
| 34 | `u16` | 65535 | build progress |
| 35 | `u8` | 1 | flags: switched on |

Columns 10, 11 and 12 are left out, so the unit has no target tracks, pose tracks or queue keys.

The chunk before compression is 420 bytes: 4 for the column count, 288 for 24 directory entries, 124 of data and 4 zero bytes.

```
0000  18 00 00 00 01 00 02 00 24 01 00 00 01 00 00 00
0010  02 00 04 00 28 01 00 00 01 00 00 00 03 00 02 00
0020  2c 01 00 00 01 00 00 00 04 00 01 00 30 01 00 00
0030  01 00 00 00 05 00 01 00 34 01 00 00 01 00 00 00
0040  06 00 02 00 38 01 00 00 01 00 00 00 07 00 02 00
0050  3c 01 00 00 01 00 00 00 08 00 02 00 40 01 00 00
0060  01 00 00 00 09 00 02 00 44 01 00 00 01 00 00 00
0070  10 00 02 00 48 01 00 00 03 00 00 00 11 00 03 00
0080  50 01 00 00 03 00 00 00 12 00 03 00 58 01 00 00
0090  03 00 00 00 13 00 03 00 60 01 00 00 03 00 00 00
00a0  14 00 05 00 68 01 00 00 01 00 00 00 15 00 05 00
00b0  6c 01 00 00 01 00 00 00 16 00 05 00 70 01 00 00
00c0  01 00 00 00 17 00 01 00 74 01 00 00 03 00 00 00
00d0  18 00 02 00 78 01 00 00 03 00 00 00 19 00 02 00
00e0  80 01 00 00 03 00 00 00 1a 00 02 00 88 01 00 00
00f0  03 00 00 00 20 00 02 00 90 01 00 00 01 00 00 00
0100  21 00 02 00 94 01 00 00 01 00 00 00 22 00 02 00
0110  98 01 00 00 01 00 00 00 23 00 01 00 9c 01 00 00
0120  01 00 00 00 2f 1f 00 00 00 00 00 00 00 00 00 00
0130  00 00 00 00 02 00 00 00 00 00 00 00 84 03 00 00
0140  03 00 00 00 01 00 00 00 00 00 2c 01 78 00 00 00
0150  00 80 00 00 e0 01 00 00 00 80 00 00 06 00 00 00
0160  00 80 00 00 00 00 00 00 a0 16 00 00 e4 06 00 00
0170  00 19 00 00 03 03 03 00 00 00 00 00 00 00 00 00
0180  00 00 00 00 a7 05 00 00 00 00 00 00 00 00 00 00
0190  00 00 00 00 ff ff 00 00 ff ff 00 00 01 00 00 00
01a0  00 00 00 00
```

Reading it:

- The first four bytes, `18 00 00 00`, say there are 24 columns.
- The first directory entry is `01 00 02 00 24 01 00 00 01 00 00 00`: column 1, type 2 which is `u16`, at offset 0x124, with 1 value. At 0x124 is `2f 1f`, which is 7983.
- The entry for column 17 is at 0x7c: `11 00 03 00 50 01 00 00 03 00 00 00`. Column 17, type 3 which is `s16`, at offset 0x150, with 3 values. At 0x150 is `00 80 00 00 e0 01`, which is -32768, 0 and 480.
- Key 0. Time 0, so offset 0. The x value is the escape, so x is the first wide value, 5792 steps, which is 724 elmos. In the same way y is 1764 steps, 220.5 elmos, and z is 6400 steps, 800 elmos. The kept components are 0, 0 and 0, and w is dropped, so the quaternion is (0, 0, 0, 1). Front is (0, 0, 1).
- Key 1. Time 300, so offset 300. Every difference is 0, so nothing has changed.
- Key 2. Time 120, so offset 420. The x value is 5792 + 480 = 6272 steps, 784 elmos. The y value is 1764 + 6 = 1770 steps, 221.25 elmos. The kept y component is 0 + 1447, and `1447 * sqrt(1/2) / 2047` is 0.49985. So w is `sqrt(1 - 0.49985^2)`, 0.86611, and front is (0.86585, 0, 0.50031). The unit was recorded with a front of (0.86603, 0, 0.5).
- At offset 360, half way between keys 1 and 2, x is 754 elmos.
- From offset 420 to 900 the unit holds the value of key 2. In a real track it would have a key at offset 900 if it were still moving.

Compressed at level 9 the chunk is 194 bytes and starts `78 da`. The Adler-32 of the 420 bytes is `3f8d1533`.

## Projected size

Both benchmark recordings were laid out as this page describes and compressed, using a window of 900 frames, a position shift of 3, a velocity shift of 11 and zlib level 9. Rotation is 12 bits for BAR and 13 for Splinter Faction, by the rule above.

The keys are the ones the benchmark's own thinning kept. The key counts are the spike's. "Written" is higher than the spike's count because of the keys added at window boundaries.

### BAR, 82,496 frames

| What | Count in the spike | Written | Bytes each before compression | Bytes before | Bytes compressed |
| --- | --- | --- | --- | --- | --- |
| Unit entries, 92 windows | 1,367 units | 24,620 | 23 | 566,260 | 175,366 |
| Transform keys | 328,679 | 353,031 | 15, and 12 more for a unit's first in a window | 5,590,905 | 2,224,426 |
| Status keys | 22,467 | 45,686 | 7 | 319,802 | 92,222 |
| Target keys | 33,064 | 35,146 | 8, and 3 for each track | 291,515 | 64,854 |
| Pose keys | 422,060 | 433,676 | 14, and 24 more for a track's first in a window, and 4 for each track | 6,484,256 | 811,962 |
| Build queue keys and items | 1,325 and 1,176 | 2,888 and 3,505 | 3 and 11 | 47,219 | 29,604 |
| Projectile entries | 20,609 | 21,139 | 16 | 338,224 | 134,341 |
| Projectile keys | 145,332 | 146,158 | 14, and 24 more for a projectile's first in a window | 2,553,548 | 1,039,457 |

The compressed figure for each row is that row's columns compressed on their own, to show where the bytes go. The total below is from compressing each window whole, which is what a track does.

| Part | Bytes |
| --- | --- |
| 92 main chunks, 16,279,132 bytes before compression | 4,641,024 |
| 43 terrain chunks, 110,652 rows of 14 bytes | 150,080 |
| Features chunk, 636 features | 10,496 |
| Info chunk | 2,176 |
| Header and index | 1,600 |
| Total | 4,805,376 |

The benchmark file for the same match is 37,187,696 bytes. `37,187,696 / 4,805,376` is 7.74.

The features chunk that was measured stores a heading where this page stores a rotation and a team. That is 6 more bytes a feature before compression, 3,816 bytes for this match.

### Splinter Faction, 23,091 frames

| What | Count in the spike | Written | Bytes before | Bytes compressed |
| --- | --- | --- | --- | --- |
| Unit entries, 26 windows | 57 units | 829 | 19,067 | 6,753 |
| Transform keys | 26,176 | 26,966 | 414,438 | 183,972 |
| Status keys | 1,558 | 2,269 | 15,883 | 4,170 |
| Target keys | 1,791 | 1,817 | 14,785 | 2,648 |
| Pose keys | 125,284 | 125,915 | 1,785,770 | 25,156 |
| Build queue keys and items | 38 and 72 | 54 and 105 | 1,317 | 963 |
| Projectile entries and keys | 627 and 5,926 | 631 and 5,930 | 108,756 | 48,327 |

| Part | Bytes |
| --- | --- |
| 26 main chunks, 2,378,424 bytes before compression | 283,648 |
| Terrain chunks | 0 |
| Features chunk, 172 features | 2,432 |
| Info chunk | 640 |
| Header and index | 512 |
| Total | 287,232 |

The benchmark file for the same match is 5,965,824 bytes. `5,965,824 / 287,232` is 20.77.

### The target

A track is 7.7 times smaller than BAR-Rewind's file for the BAR benchmark match, at 4.8 MB against 37.2 MB, and 20.8 times smaller for the Splinter Faction one, at 287 KB against 6.0 MB. That is 105 KB for each minute of the BAR match against 811 KB.

BAR-Rewind's README gives 108 MB for a 53 minute match. If the BAR multiple held for that match its track would be 14 MB. That match was not measured.

### What will move these figures

- Projectiles as cubics, issue #3784. A throwaway thinner run on the raw projectile samples kept 54,426 keys with the cubic against 146,192 with straight lines for BAR, and 1,759 against 5,836 for Splinter Faction. With those keys the BAR track is 4,342,656 bytes, 8.56 times smaller than the benchmark file, and the Splinter Faction track is 261,824 bytes, 22.79 times smaller.
- The thinning of issue #3782 is not the benchmark's, and keeps a different number of keys. The next section has what it kept.
- The poses of issue #3783 are not the benchmark's. This projection uses the six values the benchmark stores for each pose key. [Measured with the poses of issue #3783](#measured-with-the-poses-of-issue-3783) has what they came to.
- A target curve for each weapon, issue #3790. The benchmark records one weapon for each unit. [Measured with the projectiles of issue #3784 and the weapons of issue #3790](#measured-with-the-projectiles-of-issue-3784-and-the-weapons-of-issue-3790) has what it came to.

### Where Splinter Faction's pose keys went

The spike found that Splinter Faction's poses hardly thinned: 90.45% of samples survived, against 10.41% in BAR.

The measurements explain what the keys are. 125,157 of the 125,284 pose keys, 99.90%, belong to one unit definition, `fedstorm`, and to four of its pieces: `rthigh`, `rfoot`, `rleg` and `pelvis`. There were 19 of that unit. 99.79% of the keys fall while the unit is moving, 99.70% come within 6 frames of the key before, and at 69.79% of them a piece's turn reverses. That is a walk cycle sampled every 3 frames. A straight line cannot stand in for a swing that reverses every few samples, so nearly every sample is kept.

BAR's pose keys are mostly the same thing: 90.32% fall while the unit is moving and 72.15% come within 6 frames of the key before.

Why the recorder treats leg pieces as aiming pieces was not looked at.

The format does nothing special for this and does not need to. A walk cycle repeats, and zlib is good at repeats. The pose columns compress 74 times for Splinter Faction, from 1,782,490 bytes to 23,935, and 8 times for BAR, from 6,426,272 to 787,232. Poses are 58.80% of the Splinter Faction benchmark file and 8.8% of its projected track.

## Measured with the thinning of issue #3782

`coilbox-track-thin` made a track from a recording of each benchmark replay by coilbox's own recorder, at a tolerance of 0.5 elmo, on 13 October 2026. Every recorded sample was then measured against the file. These are real files and not projections.

The poses in these two tracks were a stand-in: each piece's rotation and position in the unit's model space. The next section has the same two matches with the poses this page describes, and those are the figures to use.

The recordings are `bar-3.dump`, 661,354,318 bytes, and `sf-3.dump`, 23,124,566 bytes. They are new recordings of the two benchmark replays, made because thinning needs each unit's radius and the dumps before them did not have it.

"Kept" is what thinning kept over the whole match. "Written" is what the file holds, counted over every window, so it has the keys added at window edges and counts a unit once for each window it is in.

| | BAR kept | BAR written | Splinter Faction kept | Splinter Faction written |
| --- | --- | --- | --- | --- |
| Units, or unit entries | 1,368 | 24,619 | 57 | 829 |
| Transform keys | 367,658 | 389,965 | 29,044 | 29,730 |
| Status keys | 35,855 | 58,043 | 2,181 | 2,919 |
| Target tracks and keys | 664 and 23,215 | 3,769 and 26,984 | 24 and 1,580 | 83 and 1,663 |
| Pose tracks and keys | 4,312 and 1,503,679 | 50,689 and 1,546,293 | 245 and 136,116 | 3,828 and 139,388 |
| Build queue keys and items | 1,508 and 1,168 | 3,296 and 3,511 | 38 and 72 | 60 and 105 |
| Projectiles and keys | 20,609 and 54,654 | 21,113 and 55,158 | 627 and 1,769 | 631 and 1,773 |
| Features | 637 | 637 | 173 | 173 |
| Terrain rows | 271,409 | 155,859 | 4,939 | 4,311 |

The samples they were thinned from: 6,998,315 unit samples, 4,332,299 piece rows and 480,653 projectile rows for BAR, and 233,770, 149,811 and 26,859 for Splinter Faction.

| | BAR | Splinter Faction |
| --- | --- | --- |
| Track | 7,646,679 bytes | 352,362 bytes |
| Projected above | 4,805,376 bytes | 287,232 bytes |
| BAR-Rewind's file for the same match | 37,187,696 bytes, 4.86 times the track | 5,965,824 bytes, 16.93 times the track |
| Main chunks | 7,404,163 bytes, from 32,181,872 | 340,490 bytes, from 2,636,620 |
| Terrain chunks | 220,569 bytes | 6,452 bytes |
| Largest main chunk, decompressed | 937,916 bytes | 319,548 bytes |
| Furthest unit sample from the track | 0.49999689 elmo | 0.49989960 elmo |
| Furthest piece sample | 0.49999757 elmo | 0.49999905 elmo |
| Furthest projectile sample | 0.49983939 elmo | 0.49954246 elmo |
| Furthest health or build progress sample, in steps of 1/65,535 | 0.996 | 0.566 |
| Time to scan, thin, check and write, on an Apple M1 Pro | 10.16 s | 0.80 s |
| Peak memory, the maximum resident set size from `/usr/bin/time -l` | 193,036,288 bytes | 32,358,400 bytes |

Each section's columns compressed on their own, as in the projection:

| Section | BAR | BAR projected | Splinter Faction | Splinter Faction projected |
| --- | --- | --- | --- | --- |
| Unit entries | 49,209 | 175,366 | 1,985 | 6,753 |
| Transform keys | 2,368,079 | 2,224,426 | 189,619 | 183,972 |
| Status keys | 86,555 | 92,222 | 3,570 | 4,170 |
| Target keys | 52,009 | 64,854 | 1,627 | 2,648 |
| Pose keys | 3,780,198 | 811,962 | 90,374 | 25,156 |
| Build queue keys and items | 16,408 | 29,604 | 404 | 963 |
| Projectile entries and keys | 693,276 | 1,173,798 | 22,938 | 48,327 |

### Where the real figures differ from the projection

- Poses are the whole of it. The BAR track is 2,841,303 bytes over its projection, and its pose columns alone are 2,968,236 bytes over theirs. The Splinter Faction track is 65,130 bytes over, and its pose columns 65,218. Thinning kept 1,503,679 pose keys for BAR where the benchmark's own thinning kept 422,060.
- The poses in these tracks are a stand-in: a pose key holds the piece's rotation and position in the unit's model space. In model space a piece moves whenever any piece above it does, and that is why it keeps three and a half times the keys. The next section measured it.
- Transform keys are 6.5% over for BAR and 3.1% over for Splinter Faction. The projection used the benchmark's keys, which were thinned by another program to a rule this page does not have.
- Projectiles are thinned against the cubic, since that is what a reader draws, so they are already at the size issue #3784 was expected to bring: 54,654 keys for BAR where a throwaway thinner kept 54,426, and 1,769 where it kept 1,759.
- Terrain is 70,489 bytes over for BAR. Coilbox's recorder writes more terrain rows than the benchmark's did, 271,409 against 168,736, because it also reads the whole heightmap once a window.
- The largest BAR window decompresses to 937,916 bytes. The window length of 900 frames was chosen so that the largest stayed under the engine's second buffer of 524,288 bytes, and with these poses it does not. The pose columns are 23,084,538 of the 32,181,872 bytes before compression. With the poses of #3783 it is 454,968 bytes.

## Measured with the poses of issue #3783

Both replays were recorded again on 13 October 2026, as `bar-4.dump`, 661,462,501 bytes, and `sf-4.dump`, 23,140,583 bytes, because the piece trees of the dumps before them had no rest offsets. `coilbox-track-thin` made a track from each at a tolerance of 0.5 elmo, with each pose relative to its parent piece. Nothing else about the thinning changed, and every key count but the poses is the same as in the section above.

| | BAR before | BAR after | Splinter Faction before | Splinter Faction after |
| --- | --- | --- | --- | --- |
| Pose keys kept | 1,503,679 | 470,973 | 136,116 | 124,271 |
| Pose tracks kept | 4,312 | 2,148 | 245 | 105 |
| Pose tracks and keys written | 50,689 and 1,546,293 | 14,847 and 480,861 | 3,828 and 139,388 | 1,273 and 125,204 |
| Pose columns before compression | 23,084,538 bytes | 7,154,666 bytes | 2,058,616 bytes | 1,788,500 bytes |
| Pose columns compressed on their own | 3,780,198 bytes | 875,757 bytes | 90,374 bytes | 28,377 bytes |
| Track | 7,646,679 bytes | 4,713,582 bytes | 352,362 bytes | 289,328 bytes |
| Projected above | 4,805,376 bytes | | 287,232 bytes | |
| BAR-Rewind's file, as a multiple of the track | 4.86 | 7.89 | 16.93 | 20.62 |
| Main chunks | 7,404,163 bytes, from 32,181,872 | 4,470,488 bytes, from 16,251,884 | 340,490 bytes, from 2,636,620 | 277,633 bytes, from 2,366,536 |
| Largest main chunk, decompressed | 937,916 bytes | 454,968 bytes | 319,548 bytes | 290,592 bytes |
| Furthest piece sample | 0.49999757 elmo | 0.5 elmo | 0.49999905 elmo | 0.49999905 elmo |
| Furthest unit sample | 0.49999689 elmo | 0.49999689 elmo | 0.49989960 elmo | 0.49989960 elmo |
| Time to scan, thin, check and write, on an Apple M1 Pro | 10.16 s | 7.57 s | 0.80 s | 0.71 s |
| Peak memory, the maximum resident set size from `/usr/bin/time -l` | 193,036,288 bytes | 156,663,808 bytes | 32,358,400 bytes | 31,932,416 bytes |

The piece samples thinned are 4,332,308 for BAR and 149,812 for Splinter Faction. That is the dump's 4,332,299 and 149,811 piece rows, and 9 and 1 more for a piece whose parent has a row on a frame when it has none.

What the figures say:

- The BAR track is now 91,794 bytes under its projection, and the Splinter Faction track 2,096 bytes over. The spike's thinning kept 422,060 and 125,284 pose keys for the same matches, against 470,973 and 124,271 here.
- The largest BAR window is back under the engine's second buffer of 524,288 bytes, by 69,320 bytes. So the window length stays at 900 frames. The buffer is not a limit: `zlib::inflate` in `rts/System/StringUtil.cpp` doubles its buffer and decompresses again from the start until the result fits, so a window over 524,288 bytes costs a third pass and still reads. A longer or busier match than this one will go over.
- Taking the parent off is the whole of the saving. A pose track that never leaves rest is not written, which is what halves the tracks: most watched pieces sit between a muzzle and the root and are never moved by a script.
- Weighting a piece's turn by its reach and not by the unit's radius saved nothing. With the unit's radius in its place the same two dumps keep 467,736 and 119,631 pose keys, which is 3,237 and 4,640 fewer. The pieces with the most keys are the ones a walk moves, the root and the hips, and their reach is more than the unit's radius because a model is larger than the radius its definition gives. The reach is kept because it is the length that makes the tolerance true of the geometry.
- A spin is kept as a spin. The largest angle in a window of the BAR track is 543,810 steps, 8.30 turns, on the `fan` of `corsnap`. In the Splinter Faction track it is 27,045 steps, 0.41 of a turn, on a turret.

### Which pieces the pose keys are on

Most of what is left is not aiming. Counted over the keys written to each track, by what the unit was doing at the key's frame:

| | BAR | Splinter Faction |
| --- | --- | --- |
| Pose keys written | 480,861 | 125,204 |
| While the unit is moving or turning | 445,476, 92.64% | 124,416, 99.37% |
| While it stands still and a weapon has a target | 16,912, 3.52% | 277, 0.22% |
| While it stands still and no weapon has a target | 18,473, 3.84% | 511, 0.41% |
| On a piece of a unit definition that has under 1% of its keys while standing still with a target | 371,271, 77.21%, on 73 of 206 pieces | 123,931, 98.98%, on 6 of 10 pieces |
| Keys whose three offsets are all 0 | 314,880, 65.48% | 94,451, 75.44% |

A unit counts as moving or turning at a frame when the track gives it a different position or rotation 3 frames before and 3 frames after.

The track cannot say which script turned a piece, so "a piece no weapon turns" is read here as one that has under 1% of its keys while its unit stands still with a target. A weapon aims whether or not its unit is moving, and a walk does not, so a piece that only a walk moves has almost no such keys: a leg settling after a stop is all there is. The 1% line is a choice made for this table and nothing in the code uses it.

In Splinter Faction the four pieces `rthigh`, `rfoot`, `pelvis` and `rleg` of `fedstorm` hold 123,774 of the 125,204 keys, and its `turret` and `barrel1` hold 1,140. In BAR the pieces named `base`, `pelvis` and `torso` hold 276,748 of the 480,861, and the pieces named `turret` hold 21,173.

Whether to record such pieces at all is issue #3941.

## Measured with the projectiles of issue #3784 and the weapons of issue #3790

Nothing in the thinning changed for these two issues. `coilbox-track-thin` made a track from `bar-4.dump` and `sf-4.dump` again on 13 October 2026, and each came out byte for byte the same as the track of the section above: 4,713,582 bytes for BAR and 289,328 for Splinter Faction. So the largest BAR window is still 454,968 bytes decompressed.

The section sizes below are from the `section_bytes` example in `coilbox-track-thin`. It reads each window's main chunk, puts the columns of one section in a chunk of its own, compresses it at level 9 and adds up the windows. It also writes each window again from its keys, and gets the same bytes as the file has: 4,470,488 for BAR and 277,633 for Splinter Faction. The earlier tables on this page that say "compressed on their own" came from scripts that are not in the repository, and this method does not give the same figure for the projectile and target sections: 722,410 bytes for BAR projectiles here, where the section for #3782 has 693,276. Compare the figures in this section with each other and not with those.

### Projectiles

Keys at a tolerance of 0.5 elmo. "Straight lines" is the throwaway thinner in the first comment on #3784, run on the raw samples of the same two matches with keys rounded to the track's steps. The crate has no straight line thinning, so the straight line figure is a key count only and has no byte figure of its own.

| | BAR | Splinter Faction |
| --- | --- | --- |
| Projectile samples in the dump | 480,653 | 26,859 |
| Keys with straight lines | 146,192 | 5,836 |
| Keys with the cubic, kept | 54,654 | 1,769 |
| Keys with the cubic, written to the file | 55,158 | 1,773 |
| Projectile entries written | 21,113 | 631 |
| Projectile columns before compression | 1,640,420 bytes | 51,808 bytes |
| Projectile columns compressed on their own | 722,410 bytes | 24,024 bytes |
| The track | 4,713,582 bytes | 289,328 bytes |
| Furthest projectile sample from the track | 0.49983939 elmo | 0.49954246 elmo |

The cubic keeps 37.4% of the keys straight lines needed for BAR and 30.3% for Splinter Faction. `54,654 / 146,192` and `1,769 / 5,836`.

### Projectile velocity

The tolerance covers position only. `coilbox-track-thin` now also measures, for every recorded projectile sample thinning dropped, the distance between the recorded velocity and the slope of the track's curve, in elmos per frame. A sample that is a key holds the velocity it was given, to within rounding, so it is not counted. The report prints the worst as "projectile velocity".

| | BAR | Splinter Faction |
| --- | --- | --- |
| Worst velocity error at a dropped sample | 929.996 elmos per frame, projectile 2658 on frame 31544 | 0.4927 elmo per frame, projectile 466 on frame 23036 |
| Checks of a dropped sample, counted once for each window it is in | 425,999 | 25,090 |
| Of them over 0.5 elmo per frame | 11,798 | 0 |
| Of them over 100 elmos per frame | 10,253 | 0 |
| Median error | 0.061 | 0.048 |
| 99th percentile | 480.2 | 0.077 |

The counts and percentiles are from a temporary line that printed each check, taken out again. The worst figures are the ones the report prints.

Splinter Faction is well under half an elmo a frame. BAR is not, and the cause is not noise. The samples with a large error are projectiles whose position does not move while their recorded velocity is large. On frames 31543 to 31548 one place in the dump has several projectiles of weapon definition 217 with the same position and the same velocity of about 620 elmos per frame. The weapons with the most checks over 0.5 are named `corllt_cor_lightlaser`, `corhllt_hllt_top`, `armwar_armwar_laser`, `corhal_cor_canlaser`, `corexp_hllt_bottom`, `corhllt_hllt_bottom`, `corerad_cor_erad` and `armsh_armsh_weapon`. Several are lasers by name. What the engine puts in a beam's velocity was not looked up.

Two keys with the same position and velocity are not flat between them. The curve swings away from the position and is back on it half way between the keys, whatever the gap. The slope there is -0.5 of the velocity at the keys, so a dropped frame in the middle is 1.5 times the velocity away. Position is right and velocity is not.

No bound was added. A bound is only worth having if it comes from what playback does with the velocity, and playback does not exist yet. The nearest ground is that a velocity error that lasts one frame moves a projectile by that distance, which would make 0.5 elmo per frame the limit. BAR is over that limit at 11,798 checks, and the ones looked at were projectiles that a velocity does not move, so the limit would force keys for no reason that can be named yet. Velocity is stored and read back, and its worst error is reported.

### Target tracks for every weapon

Before issue #3790 a unit had target tracks for its first weapon and for builder work. Now it has one for each weapon that had a target in the window. The "before" figures are what the file would hold without the tracks for weapon 2 and above. They come from taking those tracks out of each window as read and writing the window again, so they are the file as it would have been if the recorder had stopped at the first weapon. Builder work is weapon 0 and stays. The target columns are 10, which counts each unit's tracks, and 40 to 48.

| | BAR | Splinter Faction |
| --- | --- | --- |
| Target tracks and keys written, with every weapon | 3,769 and 26,984 | 83 and 1,663 |
| Of them for a weapon after the first | 324 and 2,027 | 0 and 0 |
| Target columns before compression, first weapon only | 243,780 bytes | 16,712 bytes |
| Target columns before compression, every weapon | 261,000 bytes | 16,712 bytes |
| Target columns compressed on their own, first weapon only | 66,240 bytes | 3,755 bytes |
| Target columns compressed on their own, every weapon | 69,946 bytes | 3,755 bytes |
| Main chunks compressed, first weapon only | 4,466,579 bytes | 277,633 bytes |
| Main chunks compressed, every weapon | 4,470,488 bytes | 277,633 bytes |

Weapons after the first cost the BAR track 3,909 bytes of main chunks, which is 0.08% of its 4,713,582. They cost the Splinter Faction track nothing, since none of its units had a target on a second weapon.

The file stores each chunk in whole blocks of 64 bytes, so the difference in the size of the file can be up to 63 bytes a window different from the difference in main chunks. The track as it is, 4,713,582 and 289,328 bytes, is the "after".

A unit with one weapon has one target track, and a second weapon that never had a target has none. The tests `a_unit_with_one_weapon_costs_one_target_track_and_a_weapon_without_a_target_none` and `two_weapons_aimed_at_different_targets_each_have_a_target_curve` in `coilbox-track-thin` check both. The second also covers a weapon aimed at a projectile and at a position, which neither benchmark recording has.

## Savings considered and rejected

Each was measured on the BAR benchmark against the 4,805,376 byte projection unless it says otherwise.

| Saving | Measured | Why not |
| --- | --- | --- |
| The quaternion packed into one 32 bit word, 10 bits a component | 4,702,208 bytes, against 4,608,192 for the same 10 bits in three 16 bit columns | It is 2.0% larger than the columns. A packed word cannot be stored as a difference from the key before, and the columns can. Lua also cannot read a 32 bit word exactly. At 10 bits, rounding moved the edge of the largest Splinter Faction unit by 0.16 elmo |
| Three turn angles for a unit's rotation in place of a quaternion | 4,564,224 bytes at 4,096 steps a turn, 5.0% smaller | When a unit points straight up or down two of the three angles have no fixed value, and a straight line between angles does not follow the rotation near there. Thinning can only answer that with more keys, and how many was not measured. Both readers would also have to apply the angles in the engine's order |
| Each 16 bit column split into a column of low bytes and a column of high bytes | 4,640,768 bytes, 3.4% smaller | Lua would need two unpack calls and a multiply and add for every value, where one call now gives the values |
| Storing a position as the error of a guess that the unit keeps its last speed | 4,663,104 bytes, 3.0% smaller | The guess is a multiply and a divide that Lua's 32 bit floats and Rust must round the same way for every key. One disagreement moves every later key of that unit. The same goes for guessing a projectile's position from its velocity, which was not measured |
| Time as an offset from the window start in place of a difference | 5,183,360 bytes, 7.9% larger | Larger |
| Rotation as plain values in place of differences | 4,900,800 bytes, 2.0% larger | Larger |
| Terrain columns as plain values in place of differences | 4,854,912 bytes, 1.0% larger | Larger |
| Longer windows | 4,066,624 bytes at 3,600 frames, 15.4% smaller | The largest window grows to 1,496,812 bytes, which the engine decompresses four times over, and a seek has to unpack all of it |
| A coarser position step of a quarter of an elmo | 4,569,728 bytes, 4.9% smaller, with 0.87% more position keys | Rounding would be 43% of the stated tolerance |
| Listing every definition of the game, not only those used | 9,408 bytes larger | Not needed. A writer may do it |
| Time in 8 bits | Not measured | 0.78% of the gaps between a unit's transform keys in the BAR benchmark are over 255 frames, so it would need an escape. The 16 bit column already compresses to under half a byte a key |
| Variable length integers | Not measured | The engine's Lua has no call that reads them, so each value would be read one at a time |
| Another compressor | Not measured | `VFS.ZlibDecompress` is the only one the engine's Lua has |
| A snapshot of the terrain in each window | Not measured | 93,245 heightmap points had changed by the end of the BAR benchmark, so the last window's snapshot alone would hold that many |
| Features listed in each window | Not measured | 636 features in 92 windows, where one list holds them once |
| Health as a number of hit points | Not measured | The fraction is what a health bar draws and what playback sets. A unit's maximum changed during the match for 409 of 1,367 units in the BAR benchmark, so hit points would need the maximum stored beside them |

The issue's guide was a 12 byte transform key before compression. This design's is 15, because the rotation is three 16 bit columns and a byte in place of 4 packed bytes. The packed form was measured and is larger once compressed.

## Not measured

- The time the engine's Lua takes to decompress and unpack a window. A test widget that loads a window of the BAR projection would measure it.
- A human BAR match, and a full Splinter Faction match. The spike could not record either.
- How far a piece is from where it was recorded in the unit's model space, where the errors of the pieces above it add to its own.
- A model with a baked rest rotation. Neither benchmark game has one.
- Why terrain rows differ between runs.

## How the measurements were made

The scripts are in `/Users/tomjn/dev/coilbox-rewind-bench/track-format/` on the machine that ran the spike, beside the benchmark files. They are throwaway and are not in this repository.

- `stats.py` prints value ranges and key spacing from a benchmark file.
- `poses.py` breaks pose keys down by unit definition and piece.
- `proto.py` lays a benchmark file out as a track and compresses it. Every size on this page is its output.
- `thin_pos.py` and `thin_proj.py` thin the raw unit and projectile samples with rounded keys.
- `rotprec.py` measures rotation rounding.
- `example.py` builds the worked example and reads it back.

The benchmark files are BAR-Rewind's output. BAR-Rewind is GPL-2.0 and coilbox is MIT. The scripts read the files by the section table the spike documented and by the values in them. BAR-Rewind's source was not read, and nothing on this page describes its layout.
