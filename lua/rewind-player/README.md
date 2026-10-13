# Rewind player

The rewind player plays a replay track back inside the engine, with time going in either direction (issue #3794). This folder holds its first part, the Lua that reads a track (issue #3792). It does not create units or draw anything. The gadget that does is not built yet and will include these files.

A track is the file `crates/coilbox-track` writes, in the format `docs/reference/replay-track-format.md` describes. The format was designed so that the engine's Lua can read the file as it is, so there is no export step and no second copy on disk.

This page is for whoever writes the player. It has the functions, the conventions that are easy to get wrong, and what the tests do and do not prove.

## Where it runs

Both files are plain modules for `VFS.Include`. They use `VFS.Unpack*` and `VFS.ZlibDecompress`, which exist in synced and unsynced Lua, and nothing else from the engine. They work in synced Lua, which has no `io`.

- `luarules/rewind_player/coilbox_track.lua` reads the track.
- `luarules/rewind_player/coilbox_track_fetch.lua` has the ways to get bytes out of a file.

```lua
local Track = VFS.Include("luarules/rewind_player/coilbox_track.lua")
local Fetch = VFS.Include("luarules/rewind_player/coilbox_track_fetch.lua")

local fetch, why = Fetch.fromVFS()
local track, why = Track.open(fetch)
local window = track:seek(frame)

local out = { 0, 0, 0, 0, 0, 0, 0 }
for i = 1, window.unitCount do
	if window:unitExistsAt(i, frame) then
		window:sampleTransform(i, frame, out)
		-- out[1], out[2], out[3] is the place, out[4] to out[7] the rotation
	end
end
```

Where the generated game keeps the track is `Fetch.PATH`, which is `coilbox_rewind/track.cbtrack`. Issue #3793 puts it there.

## Fetching bytes

The reader asks for bytes through one function, `fetch(block, length)`. It gives `length` bytes starting at `block * 64` in the file, or nil and a reason. The player picks the function its half of the engine allows.

| Function | Needs | Reads |
| --- | --- | --- |
| `Fetch.fromVFS(path)` | synced or unsynced Lua | a track the game holds, as one string. `path` defaults to `Fetch.PATH`. Gives nil and a reason if the game has no such file |
| `Fetch.fromString(data)` | nothing | a track already in a string |
| `Fetch.fromFile(file)` | `io`, so unsynced Lua | an open file, by seeking to the block. The caller opens and closes the file |

The engine's Lua numbers are 32 bit floats, which hold a whole number exactly up to 16,777,216. A position in a Lua string is such a number, so a track held in a string can be read only as far as byte 16,777,216. A fetch from a string that has to go further returns nil and says so, and the load that asked for it fails. `fromFile` has no such limit, because a block number times 64 is exact up to a gigabyte. The larger benchmark track is 4,805,376 bytes, which is under the limit.

## The track

`Track.open(fetch)` reads the header and the window index and nothing else. It gives the track, or nil and a reason when the file is not a track this reader can read.

| Call | Gives |
| --- | --- |
| `track.header` | the header's fields: `firstFrame`, `lastFrame`, `windowLength`, `windowCount`, `framesPerSecond`, `tolerance`, `positionShift`, `rotationBits` and the rest. `positionStep`, `velocityStep` and `rotationScale` are worked out from the shifts and bits |
| `track:windowOf(frame)` | the window number that holds the frame. A frame on the boundary between two windows is in both and this gives the later. A frame before the first is in window 0 and one past the last is in the last window |
| `track:loadWindow(k)` | window `k`, read if it is not the current one, and made the current one. Nil and a reason if it cannot be read, and the current window stays as it was |
| `track:seek(frame)` | `loadWindow(windowOf(frame))` |
| `track.window` | the current window, or nil |
| `track:info()` | names, teams and the map, read once and kept |
| `track:features()` | every feature of the match, read once and kept |
| `track:terrain(k)` | the terrain rows of window `k` |
| `Track.applyTerrain(rows, from, to, set)` | moves the ground from frame `from` to frame `to` |

Nil and a reason is the only way a bad part is reported. A part that fails to decompress, or whose columns do not agree, is an error for that part. The header, the index and every other window still read.

`info` has `engineVersion`, `game`, `map`, `writer`, `unitDefs`, `weaponDefs`, `featureDefs`, `posedPieces` (each `{ unitDef, pieces }`), `teams`, `unitFootprints` (empty in a track from before recorder version 3) and `mapSize`. A feature has `engineId`, `def`, `team`, `flags`, `firstFrame`, `lastFrame`, `position` and `rotation`.

Terrain rows are parallel lists named `frame`, `x`, `z`, `before` and `after`, with `count` rows. A height is in elmos and x and z count heightmap corners. `applyTerrain` takes one window's rows. A move across several windows calls it for each, in order going forward and in reverse order going back. Window 0 holds the rows on the track's first frame, so the first move forward starts from the frame before it.

## A window

A window is read into flat tables when it is loaded. Lists are counted from 1 and belong to the units, the projectiles, the target tracks, the pose tracks, the keys and the queue items.

A unit `i` has `unitId[i]`, `unitSerial[i]`, `unitDef[i]`, `unitTeam[i]`, `unitFlags[i]` (bit 0: it existed before the window, bit 1: it exists after) and `unitFirstFrame[i]` and `unitLastFrame[i]` as frames. `unitCount` is how many there are. A projectile `p` has `projectileSerial[p]`, `projectileWeapon[p]`, `projectileTeam[p]`, `projectileFlags[p]`, `projectileShooter[p]` (a unit's position in the list, or 0 for none), `projectileFirstFrame[p]` and `projectileLastFrame[p]`. `projectileCount` is how many there are.

The window also has `index`, `startFrame` and `endFrame`.

Sampling writes into a table the caller owns and allocates nothing. The table needs its slots before play, because writing past the end of an empty table makes it grow. Seven slots cover every call below.

| Call | Writes to `out` |
| --- | --- |
| `window:unitExistsAt(i, frame)` | gives true or false |
| `window:projectileExistsAt(p, frame)` | gives true or false |
| `window:sampleTransform(i, frame, out)` | 1 to 3: place in elmos. 4 to 7: rotation as a quaternion x, y, z, w |
| `window:sampleStatus(i, frame, out)` | 1: health from 0 to 1. 2: build progress from 0 to 1. 3: flags, bit 0 for switched on |
| `window:sampleTarget(track, frame, out)` | 1: kind. 2: reference. 3: build power. 4 to 6: place in elmos, for kinds 128 and 129 |
| `window:samplePose(track, frame, out)` | 1 to 3: turn about x, y, z in 65,536ths of a turn. 4 to 6: offset in elmos |
| `window:sampleProjectile(p, frame, out)` | 1 to 3: place in elmos. 4 to 6: velocity in elmos a frame |
| `window:sampleQueue(i, frame)` | gives the position of the first item and the number of items. The items are `queueItemDef`, `queueItemX`, `queueItemZ` (elmos) and `queueItemFacing` |

The sample calls give false when a curve has no key, which a good track never has. Call them for a unit only at a frame it exists.

A unit's target tracks are `unitTargetFirst[i]` for `unitTargetCount[i]` tracks, and `targetWeapon[track]` says which weapon (0 for builder work). Its pose tracks are `unitPoseFirst[i]` for `unitPoseCount[i]` tracks, and `posePiece[track]` is an index into the posed piece names of the unit's definition.

A target reference is a position in a list counted from 1, with 0 for none. For kinds 1, 16, 17 and 20 it is a unit in this window, for kind 4 a projectile in this window, and for kinds 2, 18 and 19 a feature in `track:features()`. A kind the reader does not know comes back as kind 0.

### Conventions

- A definition id, a team and a posed piece are counted from 0, as the file counts them. The name of unit definition `d` is `info.unitDefs[d + 1]`.
- Windows are counted from 0, as the format page does.
- A rotation is the quaternion the format page describes, with the dropped component worked out. Between two keys the sample blends them as the page says.
- A pose track's angles are not reduced to one turn, and are not comparable with an angle from another window.

### Cursors

Every curve keeps the key it last read. A sample first looks at that key and the ones next to it, so playing forward or backward one frame at a time does no search. A frame more than 8 keys away is found by a binary search, and `window.searches` counts those. It is also a way to see whether the player is jumping about.

## Precision

The engine's numbers are 32 bit floats and the tests run on LuaJIT's doubles. Nothing in a track is above 16,777,215, so every value read from the file is exact either way. The maths done on them afterwards is rounded to a float in the engine and not in the tests. A position of 16,000 elmos has a float step of 0.000977, well inside the track's tolerance of 0.5 elmo, but the sampled values will not equal the Rust reader's to the last digit. The stub rounds every value `VFS.Unpack*` returns to a float, so it checks what is read and not what is worked out from it.

## Tests

The tests need `luajit` and run with the other Lua suites from `scripts/mission-tests.sh`:

```sh
luajit lua/rewind-player/tests/reader_test.lua
luajit lua/rewind-player/tests/format_page_test.lua
luajit lua/rewind-player/tests/playback_test.lua
luajit lua/rewind-player/tests/stub_test.lua
```

- `reader_test.lua` reads the fixture and compares every sampled value with what the Rust reader gives. It plays forward, backward and in a fixed shuffle, and checks the errors and the three ways of fetching.
- `format_page_test.lua` builds the format page's worked example by hand and reads it. It checks the reader against the page and not against the Rust crate.
- `playback_test.lua` checks that sampling allocates nothing, that forward play does no search, and that a minute of play (1,800 frames over several windows) does not grow memory.
- `stub_test.lua` checks the engine stand-in against `rts/Lua/LuaVFS.cpp`.

`tests/support.lua` is the stand-in. Its `VFS.Unpack*` and `VFS.ZlibDecompress` follow the engine source, round what they return to a 32 bit float, and raise for a position or count a float could not hold. The zlib is the system's, through LuaJIT's FFI. Its synced environment has no `io`, so a reader that reached for it would fail the tests.

The tests cannot show that the player works in the engine. They show the reading and the addressing. A real replay played in the engine is what #3794 will show.

### The fixture

`tests/fixtures/small.cbtrack` is a track `crates/coilbox-track` wrote from a seed, and `tests/fixtures/expected.lua` holds what the Rust reader gives for 30 of its frames. The Rust test `crates/coilbox-track/tests/lua_fixture.rs` fails when either file stops matching what the Rust crate writes and reads. After a change to the writer or the reader, rewrite both:

```sh
COILBOX_UPDATE_LUA_FIXTURE=1 cargo test -p coilbox-track --test lua_fixture
```
