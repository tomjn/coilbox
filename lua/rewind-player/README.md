# Rewind player

The rewind player plays a replay track back inside the engine, with time going in either direction. This folder holds the Lua that reads a track (issue #3792) and the gadget that makes the world match it (issue #3794): units, features and terrain at any time. It does not yet place projectiles, pose aiming pieces or animate units (issues #3795 to #3797). The control on screen is a widget, the timeline (issue #3798).

A track is the file `crates/coilbox-track` writes, in the format `docs/reference/replay-track-format.md` describes. The format was designed so that the engine's Lua can read the file as it is, so there is no export step and no second copy on disk.

This page is for whoever works on the player or writes something that talks to it. The first half is the player: what it publishes, the messages it takes, the timeline that sends them, how to add to it and what it does about the base game. The second half is the reader: its functions, the conventions that are easy to get wrong, and what the tests do and do not prove.

## The player

The player holds a time `t`, a frame of the track that can be a fraction. On every simulation frame it moves `t` by direction times speed and makes the world the track at `t`. It simulates nothing, so `t` can jump and run backwards.

| File | What it is |
| --- | --- |
| `luarules/gadgets/coilbox_rewind_player.lua` | the gadget: opens the track, hands the engine's call-ins to the player and times a frame's work |
| `luarules/gadgets/!coilbox_rewind_guard.lua` | stops the base game killing a team or ending the match |
| `luarules/rewind_player/coilbox_player.lua` | the player: the clock, the list of stages, the published state |
| `luarules/rewind_player/coilbox_player_clock.lua` | the time and the messages that change it. It touches nothing in the engine |
| `luarules/rewind_player/coilbox_player_terrain.lua`, `coilbox_player_features.lua`, `coilbox_player_units.lua` | the three stages |
| `luarules/rewind_player/coilbox_player_rotation.lua` | a track's rotation as the pitch, yaw and roll the engine takes |
| `luaui/widgets/coilbox_rewind_timeline.lua` | the timeline widget: the engine's call-ins for drawing, keys and the pointer |
| `luaui/rewind_timeline/coilbox_timeline.lua` | the timeline: where everything is, what a key or a press sends, and the drawing. It takes the engine as a table, so the tests run it |

It runs in synced Lua, because creating a unit is synced. It moves only on simulation frames, and a paused engine runs none. So the player's own pause is what holds `t`, and the engine has to be left running for a seek to show.

### Published state

Game rules parameters, which any widget reads with `Spring.GetGameRulesParam(name)`. All are numbers. The names are also `Player.PARAMS` in `coilbox_player.lua`.

| Parameter | Value |
| --- | --- |
| `coilbox_rewind_frame` | the time `t`, as a frame of the track. It can be a fraction |
| `coilbox_rewind_playing` | 1 while playing, 0 while paused |
| `coilbox_rewind_direction` | 1 for forward, -1 for backward |
| `coilbox_rewind_speed` | frames of the track for each simulation frame: 0.5, 1, 2, 4, 8, 16 or 32 |
| `coilbox_rewind_first_frame` | the track's first frame |
| `coilbox_rewind_last_frame` | the track's last frame |
| `coilbox_rewind_frames_per_second` | simulation frames in a second of the match, 30 |

A parameter is set when the player is made, before the first frame, and again whenever its value changes. A message changes them as it arrives, so a widget sees a seek's frame before the world has moved to it. The world moves on the next simulation frame.

`coilbox_rewind_first_frame` being a number is how a widget knows the player is there. A game with no track or a bad one sets none of them, and logs one line starting `COILBOX_REWIND_PLAYER failed:`.

### Messages

A widget sends a message with `Spring.SendLuaRulesMsg(text)`. A spectator's message is delivered, which the real engine run shows, since the one player of a playback is a spectator. The text is `coilbox_rewind:`, a command, and for some commands a space and one argument.

```lua
Spring.SendLuaRulesMsg("coilbox_rewind:seek 1200")
Spring.SendLuaRulesMsg("coilbox_rewind:step -30")
Spring.SendLuaRulesMsg("coilbox_rewind:speed 0.5")
Spring.SendLuaRulesMsg("coilbox_rewind:toggle")
```

| Command | Argument | Does |
| --- | --- | --- |
| `seek` | a frame | jumps to the frame, held inside the track. Play goes on, or stays paused |
| `step` | a number of frames, which can be negative | jumps by that many frames. Play goes on, or stays paused |
| `play` | nothing, or `1` or `-1` | plays, in the direction given or the way it last played. At the end it would play into, it starts from the other end |
| `pause` | | pauses |
| `toggle` | | pauses a playing clock and plays a paused one |
| `reverse` | | plays the other way, starting if it was paused |
| `direction` | `1` or `-1` | sets the direction and leaves playing or paused as it was |
| `speed` | `0.5`, `1`, `2`, `4`, `8`, `16` or `32` | sets the speed |
| `faster`, `slower` | | the next speed up or down the list, stopping at its ends |

Every row of the replay page's key table (`src/content/replayMapView/timelineKeys.ts`) is one message:

| Key | Message |
| --- | --- |
| Space | `toggle` |
| R | `reverse` |
| Left, Right | `step -30`, `step 30`, which is one second of `coilbox_rewind_frames_per_second` frames |
| Shift and Left, Shift and Right | `step -300`, `step 300` |
| Comma, Full stop | `step -1`, `step 1` |
| Home, End | `seek` with `coilbox_rewind_first_frame`, `seek` with `coilbox_rewind_last_frame` |
| `[`, `]` | `seek` with the mark's frame. The player knows nothing of marks |
| Minus, Plus | `slower`, `faster` |

A message that is refused changes nothing and logs one line, `COILBOX_REWIND_PLAYER the message "..." was refused:` and the reason. A speed off the list, a frame that is not a number and a command the player does not know are refused. Playing into either end pauses there.

A unit that dies while playing forward at 0.5x, 1x or 2x dies with the game's own death effect. A unit that goes for any other reason, a seek, a step, playing backward or playing at 4x and over, is removed with nothing shown.

### Mod options

The start script can carry two, which `Player.OPTIONS` also names. Passing them is issue #3809's.

| Key | Value |
| --- | --- |
| `coilbox_rewind_start_frame` | the frame to open on, held inside the track. Without it, the track's first frame |
| `coilbox_rewind_start_paused` | `1` to open paused. Without it, playing |

### The timeline

![The timeline over Splinter Faction, playing backward at 4x](screenshots/timeline.jpg)

The timeline is a LuaUI widget. It reads the parameters above on every draw and sends the messages above, and keeps nothing about playback itself. It sits at the bottom centre of the view. Dragging the panel by any part that is not a control moves it.

From the left: play the other way, play or pause, slower, the speed, faster, the time and the match's length, and a `?` that opens the key list. The bar above them has a knob that seeks while it is dragged, and a press anywhere on the bar seeks there. The times count from the track's first frame, as the replay page's do.

![The key list over Metal Factions, waiting for a key](screenshots/timeline-keys.jpg)

#### Keys

The keys are the replay page's (`src/content/replayMapView/timelineKeys.ts`). `M.ACTIONS` in `coilbox_timeline.lua` is the same table for the engine.

| Key | Does |
| --- | --- |
| Space | Play or pause |
| R | Play the other way |
| Left, Right | Back or forward 1 second |
| Shift and Left, Shift and Right | Back or forward 10 seconds |
| Comma, Full stop | Back or forward one frame |
| Home, End | Go to the start or the end |
| `[`, `]` | Go to the previous or the next mark |
| Minus | Slower |
| Equals or Plus | Faster |

- A key held with Ctrl, Alt or Meta is never taken.
- A held key repeats a step and a change of speed. It does not repeat play, pause or reverse.
- To change a key, open the key list with `?`, click the action's row and press the key. Escape leaves it as it was. A key that another action had is taken from that action. `Reset keys` puts the table back.
- The mark keys are left to the game when the playback game has no marks.

A key the timeline takes goes no further. `widget:KeyPress` gives true for it, and the engine then runs no binding for that key (`CGameInputReceiver::KeyPressed` in `rts/Game/GameInputReceiver.cpp`), its own pause included. The widget's layer is the lowest there is, so it is asked before any other widget.

One thing gets in before it. A widget handler that comes from the engine's runs the actions that widgets have registered and a key is bound to, before it asks any widget for the key. If a game binds one of the timeline's keys to such an action, that action runs and the timeline never hears the key. In Splinter Faction 0.1.89 none of the keys is bound that way: they are bound to the engine's own `repair`, `moveleft`, `moveright`, `prevmenu`, `nextmenu`, `increaseviewradius`, `decreaseviewradius` and `buildfacing`, which the timeline does stop. The cure in a game where one is, is to change the key in the list.

#### What it remembers

The widget handler keeps what `widget:GetConfigData` gives, in the file it keeps every widget's data in. Splinter Faction's and THIS's handlers name that file after the game being played, which is the playback game and not the game it depends on. What is kept is the panel's place, as a share of the view so that it holds in a window of another size, and the keys when they are not the table's.

#### Marks

The replay page's marks are chat lines, players leaving and kills (`src/content/useReplayTimelineMarks.ts`). The chat and the leavers come out of the replay file and the kills out of the stored analysis, and neither is in a track. So the timeline reads marks from a file of the playback game, `coilbox_rewind/marks.lua`, when there is one:

```lua
return { { frame = 1200 }, { frame = 4530 } }
```

A mark draws as a tick above the bar. Marks that fall in one column of the bar, which is 8 pixels wide in a view 1,080 high, are one mark, at the first of them, as on the replay page. Nothing writes that file yet (issue #3978), so `[` and `]` do nothing today.

#### The note

`coilbox_rewind_note` is one more game rules parameter. When it holds a string that is not empty, the timeline shows it in a small panel above itself. The player does not set it yet. It is where issue #3802 says which features an older engine has switched off: `Spring.SetGameRulesParam("coilbox_rewind_note", text)` from the gadget is all that takes.

#### How a game comes to load it

Nothing is asked of the game. A widget handler that comes from the engine's `cont/LuaUI/widgets.lua` lists `luaui/widgets/*.lua` out of the game and everything it depends on, and turns on a widget it has no saved state for when the widget's `enabled` is true. The playback game is a new game to the handler, so it has no saved state for it. Read in the handlers of Splinter Faction (`luaui/widgets_custom.lua`), THIS (`luaui/widgets.lua`) and Beyond All Reason (`luaui/barwidgets.lua`), and run in four: see [In a real engine](#in-a-real-engine).

A game whose LuaUI is not a widget handler, or a player who has LuaUI switched off, gets no timeline. The player still plays, and takes messages from anything else.

#### Drawing

It draws with `gl.Color`, `gl.Rect`, `gl.BeginEnd`, `gl.Vertex` and `gl.Text`, measures with `gl.GetTextWidth` and `gl.GetTextHeight`, and calls `gl.Texture(false)` once. All are registered in `rts/Lua/LuaOpenGL.cpp` at the tags `105.0`, `2025.04.11` and `2026.07.04`. It uses the engine's own font, and no shader, texture, font or library from the game.

Sizes are in pixels of a view 1,080 high and follow the view's height, down to three quarters of that size and no smaller. A draw allocates nothing.

The look follows Slate, the interface in `luaui/slate` of [xta-springrts](https://github.com/Recoil-Game-Archive/xta-springrts/tree/master/luaui/slate): a dark translucent panel, a thin light border, rounded corners and buttons that are a faint wash of white. Slate is GPL v2 or later and coilbox is MIT, so its colours and proportions were followed and none of its code, its font or its images was taken. Slate blurs the world behind a panel with a shader. The timeline has no shader, so its panel is more opaque than Slate's, 0.82 against 0.6.

### Adding a stage

`coilbox_player.lua` keeps a list of stages, `player.stages`. On a frame every stage first takes away what the track does not have at `t`, and then every stage puts in place what it does have. Removals come before creations across all of them, because after a seek a building may stand where another stood earlier.

```lua
stage:resync(t)         -- after a jump, before the two below
stage:remove(t, clock)  -- take away what is not in the track at t
stage:place(t, clock)   -- create what is missing and put everything in place
```

`clock.jumped` says the frame was reached by a seek or a step and not by play, and `clock.direction` and `clock.speed` say how it is playing. A stage is made with the context, a table that has the track, its `info` and `features`, the engine's `Spring`, `Game`, `CMD` and definition tables, `teamOf(team)` and `report(key, text)`. Take the engine from the context and not from a global, so that the tests can hand the stage a stand-in.

Three rules a stage has to keep:

- A frame of play allocates nothing. Synced Lua cannot collect garbage fast enough for a table for each key at 30 frames a second. Sample into tables made once, write to the tables handed to the engine and make them once, and walk a table with `next` and not `pairs`, since synced `pairs` makes a closure for each call. `tests/player_test.lua` counts what 300 frames of play allocate, and it has to stay 0.
- Look a definition up by name, once, when the stage is made. `report` a name the game does not have and skip what uses it. `report(key, text)` logs a line the first time it is given a key.
- Let the engine choose ids, and map the track's serial numbers to them. A destroyed unit's id cannot be asked for again at once.

The units stage has, by serial number, `unitOf[serial]` for the engine's unit id and `indexOf[serial]` for the unit's place in the current window's lists. `player.units` is the stage.

Weapons never fire, because the units stage calls `Spring.SetUnitUseWeapons(unitID, false, false)` on every unit it creates. That also stops a weapon aiming. A stage that wants the engine to aim a unit has to give that back.

### The slow frame line

The unsynced half of the gadget times each frame's work and logs when it took longer than one simulation frame lasts, which is 1000 divided by `Game.gameSpeed` milliseconds, 33.3:

```
COILBOX_REWIND_PLAYER slow frame: the work of frame 4521 took 41.0 ms, and a simulation frame lasts 33.3 ms. 3 slow since the last line, the slowest 52.0 ms
```

After a line, slow frames are counted and not logged for 30 frames. Synced Lua has no clock, so the synced half calls `SendToUnsynced("coilbox_rewind_work", 0, frame)` before the work and with a 1 after it, and the unsynced half reads `Spring.GetTimer`, which gave whole milliseconds in these runs. Measured in four runs of the real engine run below, on a track of 5 units and 30 features, 460 frames each: a mean between 0.087 and 0.117 ms, and a slowest frame between 3 and 13 ms, which was the first frame every time. No larger track has been timed.

### What the base game does

Nothing in the base game is switched off. Issue #3799 is the place for that. Until then the player undoes what it can and says what it cannot, each in one line of the log:

- The base game takes an empty team for a beaten one. Splinter Faction's `game_end.lua` calls `Spring.KillTeam`, and the engine creates nothing on a dead team again. The guard gadget replaces `Spring.KillTeam` and `Spring.GameOver` as its file loads, and logs the first ask of each. It has to load before the gadget it guards against, because `game_end.lua` copies both calls into locals as it loads. Gadget files load in the order the engine's `VFS.DirList` sorts them, and the guard's name starts with `!`, which sorts before every letter, digit and underscore. A gadget whose file sorts before that, or anything outside the gadgets, keeps the real call. A team that dies anyway is logged.
- `Spring.CreateUnit` gives nothing, with no error, for a dead team or one at its unit limit. That is logged once for each team, and the unit is tried again after the next seek and not on every frame.
- A unit or a feature that the track does not have is removed on the next frame. That covers the map's own features, a unit the game spawns and a feature a base game gadget creates, as Splinter Faction's `unit_deathContainerSpawn.lua` does where a unit dies.
- A unit or a feature of the track that something else destroys is made again on the next frame.
- The engine asks before it leaves a wreck, and is refused, because the track has every wreck of the match.
- Nothing takes damage: `UnitPreDamaged` gives every hit no damage and no push. Health that changes anyway is set again on the next frame.
- A nanoframe nobody is building decays, and the engine kills it when its progress or health reaches zero. A unit under construction has both set on every frame, and held above one step of that decay.

A track's team is the same number in the game, because the start script carries the replay's teams. A team the game does not have as a team of its own is Gaia, read from `Spring.GetGaiaTeamID()`.

Not handled: on an engine before `2025.03.9` a finished unit cannot be turned back into a nanoframe, so the stage destroys it and creates it again as one. That path has only run on the stand-in, since no such engine is installed here.

## Where the reader runs

The two reader files are plain modules for `VFS.Include`. They use `VFS.Unpack*` and `VFS.ZlibDecompress`, which exist in synced and unsynced Lua, and nothing else from the engine. They work in synced Lua, which has no `io`.

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

## The playback game

Coilbox writes a game called `coilbox-replay-playback.sdd` under the content root's `games/` for each playback, and replaces it every time (`crates/tauri-plugin-coilbox-content/src/demo/playback.rs`). It depends on the game the replay was recorded on and holds:

- every `.lua` file under `luarules/` and `luaui/` in this folder, at the same path
- the track at `coilbox_rewind/track.cbtrack`, as a hard link to the stored file, or a copy where the filesystem refuses a link
- a `modinfo.lua`

The list of files is made by `crates/tauri-plugin-coilbox-content/build.rs` when coilbox is built, so a gadget added under `luarules/gadgets/` or a widget under `luaui/widgets/` ships with no change to the Rust. A file with another extension, and `tests/`, stay out. A new file is picked up by the next build.

The start script has one spectator, no players or AIs, and every team's `teamleader` is that spectator. Team and ally team numbers are the replay's own. Mod options and map options are the replay's. The script sets `recorddemo=0`. The engine adds the Gaia team, so read its number from the engine and do not assume it.

Nothing in the base game is switched off. The base game's own gadgets run, so a game that creates starting units or ends the match when a team has no units will try to during playback. [What the base game does](#what-the-base-game-does) has what the player does about it.

`contentReplayPlaybackLaunch` in `src/content/bindings.ts` writes the game and script and launches the engine.

## Fetching bytes

The reader asks for bytes through one function, `fetch(block, length)`. It gives `length` bytes starting at `block * 64` in the file, or nil and a reason. The player picks the function its half of the engine allows.

| Function | Needs | Reads |
| --- | --- | --- |
| `Fetch.fromVFS(path)` | synced or unsynced Lua | a track the game holds, as one string. `path` defaults to `Fetch.PATH`. Gives nil and a reason if the game has no such file |
| `Fetch.fromString(data)` | nothing | a track already in a string, of any length the format allows |
| `Fetch.fromFile(file)` | `io`, so unsynced Lua | an open file, by seeking to the block. The caller opens and closes the file |

The gadget uses `fromVFS`. Synced Lua has no `io`, and the unsynced half, which has, cannot hand bytes to the synced half except as messages through the network.

The engine's Lua numbers are 32 bit floats, which hold a whole number exactly up to 16,777,216. A position in a Lua string is such a number, and `string.sub` counts from 1, so past that many bytes it cannot be told where to start. `fromString` therefore cuts a longer string into pieces of 16,777,152 bytes when it is made, and reads from inside a piece (issue #3971). Each piece is cut from the front of what is left, and what is left starts at byte 16,777,153 of what was left before, which a float holds. A track of one piece or less is not copied at all. A longer one is copied once as it is cut, and each cut copies everything after it, so opening a track of `n` bytes copies about `n * n / 33,554,304` bytes on top of the track itself. No part can be longer than a piece. The larger benchmark track is 4,805,376 bytes, which is one piece.

`fromFile` copies nothing and has no such cost, because a block number times 64 is exact up to a gigabyte.

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
luajit lua/rewind-player/tests/fetch_test.lua
luajit lua/rewind-player/tests/clock_test.lua
luajit lua/rewind-player/tests/rotation_test.lua
luajit lua/rewind-player/tests/player_test.lua
luajit lua/rewind-player/tests/gadget_test.lua
luajit lua/rewind-player/tests/timeline_test.lua
```

- `reader_test.lua` reads the fixture and compares every sampled value with what the Rust reader gives. It plays forward, backward and in a fixed shuffle, and checks the errors and the three ways of fetching.
- `format_page_test.lua` builds the format page's worked example by hand and reads it. It checks the reader against the page and not against the Rust crate.
- `playback_test.lua` checks that sampling allocates nothing, that forward play does no search, and that a minute of play (1,800 frames over several windows) does not grow memory.
- `stub_test.lua` checks the engine stand-in against `rts/Lua/LuaVFS.cpp`.
- `fetch_test.lua` reads a string of 38,400,000 bytes and the fixture with every chunk moved past 16,777,216 bytes. It wraps `string.sub` to raise for a position a 32 bit float does not hold.
- `clock_test.lua` checks the clock and every message.
- `rotation_test.lua` checks the pitch, yaw and roll against the engine's own matrix arithmetic, in doubles and with every result rounded to a float.
- `player_test.lua` checks the stages on tracks made from a table (`tests/fake_track.lua`): what is alive at a time, removal before creation, a seek back past a construction, play in both directions, a missing definition, a nil from `Spring.CreateUnit`, terrain forward and back, and that a frame of play allocates nothing.
- `gadget_test.lua` loads the two gadgets the way the engine does.
- `timeline_test.lua` checks the timeline on a stand-in for `Spring` and `gl`: the message for every key, that a key with Ctrl, Alt or Meta is left alone, the frame a drag seeks to at both ends and between, the time and speed shown, that everything drawn is inside views from 640 by 480 to 3840 by 2160, moving the panel, changing a key, marks, and that 300 draws allocate nothing. It also loads the widget file the way a handler does.

`tests/support.lua` is the stand-in for the reader. Its `VFS.Unpack*` and `VFS.ZlibDecompress` follow the engine source, round what they return to a 32 bit float, and raise for a position or count a float could not hold. The zlib is the system's, through LuaJIT's FFI. Its synced environment has no `io`, so a reader that reached for it would fail the tests.

`tests/engine.lua` is the stand-in for the player: units, features, the heightmap, teams and game rules parameters, each call written from the engine source it names.

The tests cannot show that the player works in the engine. They show the logic, the reading and the addressing.

### In a real engine

```sh
scripts/rewind-playback-headless.sh
```

It needs a headless engine, Splinter Faction and the map, so CI does not run it. Run it after changing anything in this folder or the playback game. It plays a scripted match (`tests/headless/fixture_match.lua`) in which a building is built, a unit dies, features come and go and the ground changes, records it into a track, and plays the track back with a driver gadget (`tests/headless/playback_driver.lua`) that sends the player's messages the way a widget does and measures the engine against a reader of its own. The assertions are in the ignored Rust test `a_real_track_is_played_at_any_time` in `crates/tauri-plugin-coilbox-content/src/demo/playback.rs`. A second test, `the_timeline_drives_the_player_in_the_engine`, puts a probe widget (`tests/headless/timeline_probe.lua`) in the game. The probe finds the timeline in the game's own widget handler and calls its call-ins for each key and for a press on the bar. No file under `tests/headless/` ships in the playback game.

What it shows, on engine `2026.07.01-102-g6e5c5a0` and SplinterFaction 0.1.89:

- At ten seeks, forward and backward, the engine has the track's units and features, each unit where the track has it, turned as the track has it, with its health and build progress.
- A building is gone after a seek to before its construction, a nanoframe half way through it, and finished after it.
- The ground is the track's at the end, back at the map's own at the start, and the track's again.
- Play goes forward and backward and pauses at the last frame. A unit that dies during play at 1x explodes, and no unit removed by a seek does.
- No team is dead after the match has stood empty for 150 frames, though the base game asked to kill one.
- The mod options open the player at a frame, paused.
- The same again with every chunk of the track moved 19,200,000 bytes into the file.
- No error from the player's Lua in the engine's log.
- Splinter Faction's widget handler loads the timeline and turns it on. Space, End, Home, the arrows with and without Shift, Comma, Full stop, Minus, Equals, Plus and R each change the parameter they should, a press on the middle of the bar seeks to the middle frame, and Space with Ctrl is left alone and changes nothing. The handler still has the widget at the end, having asked it to draw 200 times in the run these lines come from.

The timeline's test also passed, run by hand with `COILBOX_PLAYBACK_GAME` naming the game, on Metal Factions v2.58, Balanced Annihilation V15.9.8 and THIS, with the Splinter Faction track. Those games have none of the track's units, so the world stays empty, and it is their widget handlers that the run is about. XTA 9.65 does not load on this engine: it stops on a model before any Lua runs.

What it cannot show: anything on screen. A headless engine draws nothing, so how a unit, a death or the changed ground looks has not been seen by anybody.

The timeline has been looked at, once, by hand, on 13 October 2026: the same playback game opened in the engine with a window, in Splinter Faction 0.1.89 and in Metal Factions v2.58, with a scratch widget pressing the timeline's keys and taking the engine's own screenshots. The two pictures on this page are from those runs. The marks on the bar were not in them, since nothing writes a marks file yet. To do it again, set `COILBOX_PLAYBACK_KEEP_GAME` to a folder when running the timeline's test, which copies the playback game and its script there, and launch `spring` on the script. A settings file Splinter Faction has not seen makes its Initial Settings widget reload the engine, which took this engine down, so give the run a settings file with `SFInitialSettingsVersion = 1` in it.

### The fixture

`tests/fixtures/small.cbtrack` is a track `crates/coilbox-track` wrote from a seed, and `tests/fixtures/expected.lua` holds what the Rust reader gives for 30 of its frames. The Rust test `crates/coilbox-track/tests/lua_fixture.rs` fails when either file stops matching what the Rust crate writes and reads. After a change to the writer or the reader, rewrite both:

```sh
COILBOX_UPDATE_LUA_FIXTURE=1 cargo test -p coilbox-track --test lua_fixture
```
