# Rewind recorder

The rewind recorder is a gadget that writes down where everything was on every frame of a replay, while coilbox plays the replay back headless. It is the first step of replay rewind (issue #3780). What it writes is a raw dump. `crates/coilbox-track-thin` thins the dump (issue #3782) and `crates/coilbox-track` writes the result as a track (issue #3781), in the format `docs/reference/replay-track-format.md` describes.

This page is for whoever reads the dump. It has the byte layout, what each number means, and what the recorder cannot know.

## Where it runs

Coilbox's replay analysis generates a game that depends on the game a replay was recorded on, and plays a scratch copy of the replay in it (`crates/tauri-plugin-coilbox-content/src/demo/analysis.rs`). The replay logger is always in that game. The recorder goes in only when the run asks for a recording, by setting `record` on the `AnalysisRequest`.

A run that records adds two files to the generated game:

- `luarules/gadgets/coilbox_rewind_recorder.lua`, the gadget in this folder
- `luarules/configs/coilbox_rewind_request.lua`, a Lua table holding `lastFrame`, the last frame in the replay's stream, and `teamParams` and `gameParams`, the names of the rules parameters to record (see [Team resources](#team-resources))

The recorder writes `coilbox-rewind.dump` in the engine's write directory, which is the only place the engine lets Lua open a file. When the engine exits, coilbox moves the file to the path the request gave, whether or not the run reproduced the match. `AnalysisRun.recording` says what became of it.

The gadget has no synced code. It reads the simulation from the unsynced half, so it cannot change the match. Without the request file it removes itself and does nothing. If it cannot open its file it logs the reason and removes itself, and the analysis run carries on.

It does not set the game speed. The replay logger does that for the run they share.

## Running it

The tests need `luajit`, and run with the other Lua suites from `scripts/mission-tests.sh`:

```sh
luajit lua/rewind-recorder/tests/recorder_test.lua
```

To record a real replay, run the ignored test with a file to leave the dump in:

```sh
COILBOX_ANALYSIS_REPLAY="<replay.sdfz>" \
COILBOX_ANALYSIS_ENGINE_DIR="<the folder of the engine it was recorded with>" \
COILBOX_ANALYSIS_DATA_DIRS="<content folders holding its game and map>" \
COILBOX_ANALYSIS_TIMEOUT_SECS=900 \
COILBOX_ANALYSIS_RECORD="<where to leave the dump>" \
cargo nextest run -p tauri-plugin-coilbox-content --run-ignored only --no-capture \
  -E 'test(a_real_replay_reproduces_under_the_analysis_game)'
```

The test fails if the run does not reproduce the match or leaves no dump.

To count what a dump holds:

```sh
luajit lua/rewind-recorder/tests/dump_summary.lua <dump>
```

`scripts/rewind-headless.sh` does the whole route in one command: it plays a short scripted match, records it, thins the dump and checks the counts and one unit's position against known values. It needs an engine and Splinter Faction, and says which version its values are for.

`tests/dump.lua` is a reader written from this page. It is the reference for a second reader.

To turn a dump into a track and print what was kept:

```sh
cargo run --release -p coilbox-track-thin --example thin_dump -- <dump> <track>
```

## Byte layout

Every multi-byte value is in the byte order of the machine that recorded, because the engine's `VFS.PackU32` and `VFS.PackF32` copy memory and do not swap. x86-64 and arm64 are both little endian.

```
"CBRD"            4 bytes
u32               format version, 1
then blocks until the end of the file:
  u32             kind
  u32             length of the payload in bytes
  payload
```

| Kind | Block | Payload |
| --- | --- | --- |
| 1 | header | JSON text. Always the first block |
| 2 | piece tree | JSON text. One for each unit definition, written before the first frame block that mentions a unit of it |
| 3 | frame | 32 bit floats. One block for every simulation frame, in order |
| 4 | end | JSON text. The last block of a recording that finished |

A reader skips a block kind it does not know by its length.

The file is flushed after every block. A run that was stopped has no end block, and its last block may be cut short. A reader stops at the first block whose 8 byte head or whose payload runs past the end of the file, and everything before that is good.

### Header block

One JSON object.

| Field | Meaning |
| --- | --- |
| `format` | the format version, 1 |
| `engine` | the engine's full version |
| `game`, `gameVersion` | the game's name and version. In an analysis run these are the generated game's, not the game the replay was recorded on |
| `map`, `mapSizeX`, `mapSizeZ` | the map's name and its size in elmos |
| `squareSize` | elmos between two heightmap corners, 8 |
| `gameSpeed` | simulation frames a second, 30 |
| `maxUnits` | the engine's unit id limit. Builder work names a feature as its id plus this |
| `unitFrames` | frames between two samples of every unit, 3 |
| `lastFrame` | the last frame the recorder was asked to record. Left out when it was given none |
| `terrain` | `false` when the recorder could not listen for heightmap changes, so the dump holds none. `true` otherwise |
| `teams` | one object for each team, Gaia included |
| `unitDefs` | unit definition names. Entry `n`, counting from 1, is definition id `n` |
| `unitRadii` | each unit definition's radius in elmos, in the order of `unitDefs`. A dump made before issue #3782 has none, and the thinning refuses it |
| `unitFootprints` | each unit definition's footprint, in the order of `unitDefs`, as a pair: the engine's `xsize` and `zsize`. Both count heightmap squares of `squareSize` elmos, and `xsize` is twice the definition's `footprintX`. A dump made before issue #3807 has none, and the thinning refuses it |
| `featureDefs` | feature definition names. Entry `n`, counting from 1, is definition id `n` |
| `weaponDefs` | weapon definition names. Entry `n`, counting from 0, is definition id `n` |
| `teamParams` | the names of the team rules parameters the request asked for, in the request's order. A parameter number in a frame block is a place in this list, counting from 1 |
| `gameParams` | the same for game rules parameters |

A team object has `team`, `allyTeam`, `side`, `leader` (the leading player's name) and `color` (red, green and blue from 0 to 255). An AI team also has `ai`, the AI's name. The Gaia team also has `gaia: true`.

Every definition id in a frame block is the id this run's engine gave. The ids change between builds of a game, which is why the names are here.

### Piece tree block

```json
{"def": 12, "pieces": ["base", "turret", "flare"], "parents": [0, 1, 2], "modelType": "s3o",
 "offsets": [[0, 0, 0], [0, 10, -2.5], [0, 3, 14]],
 "bounds": [[-8, 0, -12, 8, 10, 12], [-5, 0, -5, 5, 4, 5], []]}
```

`def` is a unit definition id. `pieces` are the piece names in the engine's order, so a piece number in a frame block is a position in this list counting from 1. `parents` gives each piece's parent as a piece number, and 0 for the root.

The other three fields are what the model says about each piece before a script moves it. The thinning of issue #3783 needs them to turn a piece row into the turn and the move a script set, and it refuses a dump whose trees have no `offsets`.

- `offsets` has each piece's rest offset from its parent in elmos, x, y and z. It is `offset` from `Spring.GetUnitPieceInfo`, the value a script's `Move` adds to.
- `bounds` has the box round each piece's own geometry, in the piece's own space: the least x, y and z, then the greatest. A piece with no geometry has an empty list.
- `modelType` is the extension of the model's file in lower case, from the unit definition's `modeltype`, and an empty string when the definition has none.

The engine gives a piece of an Assimp or glTF model a rest rotation, and Lua has no call that reads it (`bakedTransform` in `rts/Rendering/Models/3DModelPiece.hpp`). A `3do` or `s3o` piece has none. So for any other `modelType` a reader cannot tell a script's turn from the model's own.

### End block

```json
{"reason": "game_over", "frame": 23091, "frames": 23092, "winners": [0]}
```

- `reason` is `game_over`, or `last_frame` for a replay whose stream ran out with no game over in it.
- `frame` is the last frame that was simulated.
- `frames` is the number of frame blocks in the file.
- `winners` are the winning ally teams as the engine's game over event gave them. Empty for `last_frame`.

The team totals that the replay's trailer is checked against are not here. The replay logger writes them in its game over line, and `divergence::compare` checks them for the same run.

### Frame block

A list of 32 bit floats. A whole number is exact up to 16,777,216, which covers every id and frame number the engine has.

```
frame number
then sections until the end of the block:
  code
  count           how many numbers follow in this section
  count numbers
```

A section is left out when it has nothing in it. A code appears at most once in a block. A reader skips a code it does not know by its count. The sections of a block are in no promised order.

| Code | Section | Numbers in a row | Row |
| --- | --- | --- | --- |
| 1 | units created | 16 | unit id, unit definition id, team, then a pose |
| 2 | units destroyed | 14 | unit id, then the pose it was last read in |
| 3 | units given | 2 | unit id, its new team |
| 4 | unit samples | 14 | unit id, then a pose |
| 5 | weapon targets | 6 | unit id, weapon number from 1, kind, `a`, `b`, `c` |
| 6 | builder work | 8 | unit id, command, target, build power, has a place, x, y, z |
| 7 | build queues | varies | unit id, number of items, then for each item: unit definition id, x, z, facing |
| 8 | piece poses | 14 | unit id, piece number from 1, then 12 numbers of a matrix |
| 9 | features created | 12 | feature id, feature definition id, team or -1, x, y, z, front x, y, z, up x, y, z |
| 10 | features destroyed | 1 | feature id |
| 11 | projectiles | 10 | projectile id, weapon definition id or -1, team or -1, the unit that fired it or -1, x, y, z, velocity x, y, z |
| 12 | terrain | 4 | heightmap x, heightmap z, height before, height after |
| 13 | team resources | 3 | team, metal held, energy held |
| 14 | team economy | 17 | team, then for metal and then for energy: storage, pull, income, expense, share level, sent, received, excess |
| 15 | team rules parameters | 3 | team, parameter number from 1, value |
| 16 | game rules parameters | 2 | parameter number from 1, value |

A pose is 13 numbers: position x, y, z, front direction x, y, z, up direction x, y, z, health, maximum health, build progress from 0 to 1, and flags. Bit 0 of the flags is set when the unit is switched on.

## What the numbers mean

### Frames

The block for frame `F` is written as frame `F` starts. What it samples is the state at that moment, which is the result of every frame before `F`.

Events are written in the first block after they happened. A unit the engine reported as created during frame `F - 1` is in the units created section of block `F`.

Every frame has a block, an empty one included, so the frame numbers of a whole file run from the first to the last with none missing. The first block is not always frame 0.

When the game ends, one more block is written after the last, so that what happened since has somewhere to go. A game can end from inside a frame. A gadget calls `Spring.GameOver` from its own frame call, before the recorder has been called for that frame. So the last block is numbered one more than the block before it, and the end block's `frame` is that number or one less.

### Units

Every unit is sampled every third frame, and on the first frame recorded whatever its number. Health and maximum health are as the engine has them. Health can be above the maximum and below zero, and the track writer clamps it.

The engine's list of units decides which units there are, and the recorder goes through it on every sample frame. `UnitCreated` and `UnitDestroyed` only say so sooner, and they cannot be relied on. A gadget handler calls every gadget's function for a call-in from one loop, so another gadget that raises in `UnitCreated` stops the call from reaching the recorder. Splinter Faction's `cus_gl4.lua` does that for every unit when the engine is headless.

So the timing of a unit's first and last rows depends on the game:

- When the call-ins arrive, a unit is created and destroyed in the block after the frame it happened in, and a unit that lived inside one frame is still written.
- When they do not, a unit is created on the first sample frame the engine lists it on, and destroyed on the first sample frame it is dead or gone. That is up to 2 frames late, and a unit that lived less than 3 frames between two samples is missed.

The engine goes on listing a destroyed unit until its death animation is over. The recorder asks `Spring.GetUnitIsDead` so that such a unit is not taken for a new one.

A destroyed row carries the pose the unit was last read in. With `UnitDestroyed` that is where it died. Without it, it is where it was on the last sample frame it was alive.

A change of team is found by asking each unit's team on every sample frame, so a units given row can be up to 2 frames late.

The engine reuses unit ids. A unit id in a units created section is a new unit, whatever that id meant before.

### Weapon targets

One row for each weapon whose target changed since the last sample, for every weapon a unit has. A weapon that has had no target yet has no row.

| Kind | The engine's name | `a`, `b`, `c` |
| --- | --- | --- |
| 0 | no target | 0, 0, 0 |
| 1 | a unit | unit id, 0, 0 |
| 2 | a position | x, y, z |
| 3 | a projectile to shoot down | projectile id, 0, 0 |

These are the engine's own codes, from `rts/Sim/Weapons/WeaponTarget.h`. The track's codes are different: its 128 is the engine's 2, and its 4 is the engine's 3. The engine has no weapon target that is a feature.

### Builder work

One row when what a builder is working on changes, for every unit that can build, factories included. `command` and `target` are what `Spring.GetUnitWorkerTask` answers, and build power is what `Spring.GetUnitCurrentBuildPower` answers, a fraction from 0 to 1 in steps of one fifteenth.

| `command` | Work | `target` | Track kind |
| --- | --- | --- | --- |
| 0 | nothing | -1 | 0 |
| below 0 | building. The command is minus the unit definition being built | unit id | 16 |
| 40 | repairing | unit id | 16 |
| 90 | reclaiming | a unit id below `maxUnits`, or a feature id plus `maxUnits` | 17 or 18 |
| 125 | resurrecting | feature id plus `maxUnits` | 19 |
| 130 | capturing | unit id | 20 |
| 110 | terraforming | -1 | 129 |

Terraforming has no target. The engine does not tell Lua where a builder is terraforming, so the recorder takes the place of the order at the front of the builder's queue when that order is to restore ground or to build. `has a place` is 1 and x, y, z hold it. For a builder that is helping another terraform, the front order is neither, `has a place` is 0 and x, y, z are 0.

### Build queues

One row when a mobile builder's queue of buildings changes. Only build orders are in it, in the order they are queued, each with the definition to build, where, and its facing from 0 to 3. A factory's production queue is not a build queue and is not written.

### Piece poses

The 12 numbers are the piece's model space matrix as `Spring.GetUnitPieceMatrix` gives it, less its fourth row, which is 0, 0, 0, 1 for every piece. In order: the x axis, the y axis, the z axis, then the translation, three numbers each.

A piece is written when its matrix differs from the last one written for it, checked on every sample frame. The pieces watched are each weapon's muzzle piece and every parent up to the root.

The engine does not tell Lua which piece a unit script named as a weapon's muzzle, only where the muzzle is. So the recorder takes the piece nearest that place, and the deeper one in the tree when two sit on the same spot. It looks once the unit is built, and again while the weapon has a target whenever the piece it found is no longer exactly at the muzzle. A script that fires from two barrels in turn gets both watched that way. A weapon whose script names no muzzle gets whichever piece is nearest where the engine puts it.

Most rows are walk cycles, because a muzzle can hang off a leg. That is issue #3941.

### Features

A feature in the first frame block was on the map before the first frame. `FeatureCreated` and `FeatureDestroyed` are used when they arrive, and the engine's list of features is gone through on every sample frame for the ones they missed.

On an engine whose `Spring.GetFeatureDirection` answers only the front, the up direction is written as 0, 1, 0. The engine this was tested on answers both.

### Projectiles

Every projectile on every frame. One with no weapon definition is a piece of flying debris, and has -1 for its definition. It may also have -1 for its team and for the unit that fired it.

The engine reuses projectile ids, and Lua is told nothing when a projectile is created. A reader should take an id that was not in the block before as a new projectile, and also one whose definition, team or firing unit differs from the block before.

### Terrain

Heightmap x and z count corners, which are 8 elmos apart. `height before` is the height the recorder last wrote for that corner, or the map's own height from `Spring.GetGroundOrigHeight` for a corner's first row. So the rows of one corner chain: each one's before is the one before's after.

Two things limit what the recorder can know.

The engine tells unsynced Lua about a change as it draws, not as it simulates. `CReadMap::UpdateDraw` reports at most 128 rectangles each time the world is drawn, several frames can be simulated between two draws, and unsynced Lua reads the heights the last draw copied. So a row's frame is the frame after the engine reported the change, which is the frame it happened in or a later one. How much later was not measured.

The engine does not report every change. A Splinter Faction match of 23,091 frames changed 4,482 corners and the engine reported none of them.

So on the first frame, on every frame that is a multiple of 900, and as the recording ends, the recorder makes the engine copy every height across and reads the whole map. Turning the spectator's full view off and on again does the copy, and it runs before the call returns. At those frames the ground a reader gets by applying every row so far is the simulation's own.

What follows from that:

- The ground at every 900th frame and at the end is the same in every recording of one replay. Measured on two recordings each of two replays.
- The rows are not. Two recordings of a BAR match had 272,135 and 271,996 terrain rows. Everything else in the two dumps was the same.
- A change the engine never reports is written up to 900 frames late.
- A game where the engine reports nothing has the same rows every time. Two recordings of the Splinter Faction match were the same byte for byte.

Corners on the far edges of the map, where x is the map's width in squares or z its depth, are not written. The engine clamps a position to one elmo inside the map before it reads a height, so Lua cannot read those corners exactly.

A spectator who does not have the full view cannot make the engine copy heights. The recorder then only writes what the engine reports. The player of a replay has the full view unless something turns it off.

### Team resources

Every team on every frame, written when a number changes (issue #3982). A reader holds the last row of a team until the next one.

The numbers are the nine `Spring.GetTeamResources` gives for metal and for energy. What a team holds changes on most frames, so it has a section of its own, 13. The other eight change when the engine sums a team's economy up, which is every 30 frames, so they share section 14: one row has all sixteen. Income, expense, pull, sent, received and excess are the sums of the 30 frames before, as the engine reports them, and not rates per second.

A team starts as all zero, so a team that never has anything has no row. A number the engine gives that is not a number is written as 0.

A game keeps numbers of its own as rules parameters, such as supply and research points. The recorder cannot know which of a game's parameters matter, so the request names them, and coilbox takes the names from the game's playback adapter (`teamParams` and `gameParams` in `lua/rewind-player/README.md`). A parameter is written when its value changes, in section 15 for a team's and 16 for the game's. Only a number is written. A parameter that holds text or a boolean, or that is not set, has no row, so a parameter with no row yet had not been set. A parameter that is taken away after it was set keeps its last row.

A gadget reads every team's parameters whatever their access level, the unsynced half included, so a private one is recorded too.

## What was measured

On an Apple M1 Pro with a load average between 3.9 and 6.3, through the analysis run, on 13 October 2026. The spike's figures are from `docs/reports/2026-10-12-replay-rewind-spike.md`.

| | Splinter Faction, 23,091 frames | BAR, 82,496 frames |
| --- | --- | --- |
| Dump | 23,122,540 bytes | 661,358,183 bytes |
| The spike's dump of the same replay | 32,173,373 bytes | 889,864,406 bytes |
| Wall clock of the engine, recording, two runs | 29.34 s and 28.39 s | 153.67 s and 155.65 s |
| Wall clock of the engine with no recorder | 24.41 s | 88.53 s |
| The spike's wall clock, recording | 20.51 s | 133.35 s |
| Units created in the dump | 57 | 1,368 |
| Units produced in the replay's trailer | 57 | 1,368 |
| Unit samples | 233,755 | 6,996,909 |
| Piece pose rows | 149,811 | 4,332,299 |
| Projectile rows | 26,859 | 480,653 |
| Distinct projectiles, and those with no weapon definition | 627 and 349 | 20,609 and 1,895 |
| Weapon target rows | 85 | 5,893 |
| Of them for a weapon after the first | 0 | 1,613 |
| Terrain rows | 4,939 | 272,135 |

The BAR runs were made with the generated game's short name set to BAR's. The generated game now takes the short name of the game it depends on (issue #3943), so a BAR replay reproduces without that change.

Inside the recorder, the BAR run spent 20.4 seconds sampling units, 9.5 on terrain, 6.0 packing and writing, 1.4 going through the unit list, 1.2 on features and 0.3 on projectiles, by `os.clock`. That is 38.7 of the 65.1 seconds the recorder added. Where the rest went was not measured.
