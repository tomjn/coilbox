# Rewind player

The rewind player plays a replay track back inside the engine, with time going in either direction. This folder holds the Lua that reads a track (issue #3792) and the gadget that makes the world match it (issue #3794): units, features, terrain and the shots in the air (issue #3795) at any time. It does not yet pose aiming pieces or animate units (issues #3796 and #3797). The control on screen is a widget, the timeline (issue #3798). What a game switches off or hides during playback is its adapter (issue #3799).

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
| `luarules/rewind_player/coilbox_player_terrain.lua`, `coilbox_player_features.lua`, `coilbox_player_units.lua`, `coilbox_player_projectiles.lua` | the four stages |
| `luarules/rewind_player/coilbox_player_rotation.lua` | a track's rotation as the pitch, yaw and roll the engine takes |
| `luarules/rewind_player/coilbox_player_adapter.lua` | reads the game's adapter, and guards its hooks |
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

A unit that dies while playing forward at 0.5x, 1x or 2x dies with the game's own death effect. A unit that goes for any other reason, a seek, a step, playing backward or playing at 4x and over, is removed with nothing shown. A shot is the same: it lands with the game's impact effect and makes its weapon's sound at those three speeds going forward, and otherwise comes and goes with nothing shown. [Projectiles](#projectiles) has the detail.

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

The look follows Slate, the interface in `luaui/slate` of [xta-springrts](https://github.com/Recoil-Game-Archive/xta-springrts/tree/master/luaui/slate): a dark translucent panel, a thin light border, rounded corners and buttons that are a faint wash of white. Its colours and proportions were followed and none of its code, its font or its images was taken. Slate blurs the world behind a panel with a shader. The timeline has no shader, so its panel is more opaque than Slate's, 0.82 against 0.6.

### Adding a stage

`coilbox_player.lua` keeps a list of stages, `player.stages`. On a frame every stage first takes away what the track does not have at `t`, and then every stage puts in place what it does have. Removals come before creations across all of them, because after a seek a building may stand where another stood earlier.

```lua
stage:resync(t)         -- after a jump, before the two below
stage:remove(t, clock)  -- take away what is not in the track at t
stage:place(t, clock)   -- create what is missing and put everything in place
```

`clock.jumped` says the frame was reached by a seek or a step and not by play, and `clock.direction` and `clock.speed` say how it is playing. `clock:watched()` is true for a frame of play forward at 0.5x, 1x or 2x, which is when a death, an impact and a sound are shown. A stage is made with the context, a table that has the track, its `info` and `features`, the engine's `Spring`, `Game`, `CMD` and definition tables, `teamOf(team)` and `report(key, text)`. Take the engine from the context and not from a global, so that the tests can hand the stage a stand-in.

Three rules a stage has to keep:

- A frame of play allocates nothing. Synced Lua cannot collect garbage fast enough for a table for each key at 30 frames a second. Sample into tables made once, write to the tables handed to the engine and make them once, and walk a table with `next` and not `pairs`, since synced `pairs` makes a closure for each call. `tests/player_test.lua` counts what 300 frames of play allocate, and it has to stay 0.
- Look a definition up by name, once, when the stage is made. `report` a name the game does not have and skip what uses it. `report(key, text)` logs a line the first time it is given a key.
- Let the engine choose ids, and map the track's serial numbers to them. A destroyed unit's id cannot be asked for again at once.

The units stage has, by serial number, `unitOf[serial]` for the engine's unit id and `indexOf[serial]` for the unit's place in the current window's lists. `player.units` is the stage. The projectiles stage has `idOf[serial]` for the engine's projectile id of a shot it is holding, and is `player.projectiles`.

Weapons never fire, because the units stage calls `Spring.SetUnitUseWeapons(unitID, false, false)` on every unit it creates. That also stops a weapon aiming. A stage that wants the engine to aim a unit has to give that back.

### Projectiles

No weapon fires in playback, so the projectiles stage creates each shot of the track with `Spring.SpawnProjectile` and decides where it is on every frame. A piece of debris, which the track stores with no weapon, is left to the engine, which makes its own when a unit dies with its death effect.

What the stage does follows from how the engine treats a projectile, read in `rts/Sim/Projectiles` and `rts/Lua/LuaSyncedCtrl.cpp`:

- `Spring.SetProjectileMoveControl` only stops the engine moving a projectile. On every frame `CProjectileHandler::CheckCollisions` still looks for a unit or a feature from where the projectile is to where its speed would take it, and takes a projectile under the ground to have hit it. The look comes before the move. So the last frame a track has a shot on is the frame the engine found its hit on, and the place and speed recorded there are all it takes to find the hit again.
- Every kind of projectile counts its time to live down under move control. A shell bursts when it reaches nothing left, a bolt stops or fades, and a missile only bursts if its weapon has `selfExplode`.
- A beam or a bolt of lightning (`BeamLaser`, `LightningCannon`) never moves and is never looked at for a hit. Its weapon does the damage when it fires, and the projectile is what is drawn. The track has where it starts and, as its velocity, the way to where it ends.

#### Held

A shot the track has in the air at `t` is a projectile under move control. On every frame it is put where the track has it and given a speed of one position step (an eighth of an elmo) along the recorded velocity. That keeps its direction, which is all the engine draws a held projectile from, and reaches nothing. It is created at the recorded speed, because a laser bolt keeps the speed it was created with as its length. Its time to live is 16,777,216 frames, the largest whole number the engine's Lua numbers count to, which is six days.

Three places are not the track's, each because the engine would otherwise land the shot during a seek or a pause:

- A shot under the ground is held one position step above it, or above the water for a weapon that is not a water weapon.
- A shot on its last frame is held the track's tolerance (half an elmo) short of where the track has it, along its flight. The playback's units can be that far from the match's.
- A laser bolt stops on the frame it hits and stays there while it fades, which the track has as a velocity of nothing. From the frame before it stops it is held one frame of its flight short of there. A bolt first created in the frames it fades in is pointed by the last frame the track has it moving on.

A shot is held at any speed and in either direction, paused included, so it is the same projectile from its first frame to its last.

#### Let go

Played forward at 0.5x, 1x or 2x, a shot is let go on the frame its flight ends: its last frame, or for a bolt the last whole frame before it stops. It is put where the track has it on that frame, at the speed the track has. The engine's own look then finds what the match's did and makes the game's impact effect and its sound.

No frames of free flight are needed, so none are given. Measured on the whole match below, with 195 rockets and 83 laser bolts: at 1x and at 0.5x all 278 landed, a mean of 0.09 elmo from the last frame of flight the track has for them. At 2x 277 landed. The one that did not was let go on the frame before its last, because play at 2x passed over the last, and the unit it hit was a frame short of where it was hit.

What letting go means depends on the kind and on the engine:

| Kind | Let go |
| --- | --- |
| `Cannon`, `AircraftBomb`, `LaserCannon`, `EmgCannon`, and a `MissileLauncher` with `selfExplode` | Move control off and one frame to live, with `Spring.SetProjectileTimeToLive`. The engine has it from there. A shell that hits nothing bursts one frame's flight on, and a bolt goes on to stop and fade as it did in the match |
| `MissileLauncher`, `StarburstLauncher`, `TorpedoLauncher`, `Flame`, `DGun` | It stays under move control for the engine's one look, and is deleted on the next frame if it hit nothing |
| Any kind on an engine before `2025.03.9`, which has no `Spring.SetProjectileTimeToLive` | As the row above. `Projectiles:release` is the one place the call is used |

Only a rocket and a laser bolt have been let go in a real engine. The other kinds are read from the engine source and run on the stand-in.

#### Fired once

A beam cannot be steered, so it is fired once as play passes its first frame going forward, from where the track has it to where its velocity says it ends, for the frames the track has it divided by the speed of play. The engine fades it. At 4x and over only the beams born on the last frame of each step are fired, which is as many a frame as the match had. A seek and play backward fire none, so a beam is not among what is in the air when paused. The whole match below has no beam, so this has only run on the stand-in.

A shot whose whole flight is inside one step of play at 2x is created and let go at once.

#### No damage

Every projectile is created and then given `Spring.SetProjectileDamages` with nothing for every armour type, `craterMult`, `craterBoost`, `impulseFactor` and `impulseBoost`. That changes the projectile's own copy of its damages and nothing of the weapon. So the engine works out no damage, no crater and no push for it, and nothing rests on the gadget's `UnitPreDamaged`, which another gadget after it could overrule.

Two things follow from it:

- An impact effect is given the damage as a number it can scale by (the `d` of an explosion generator), and that number is now nothing. Splinter Faction's two weapons below look as they do in a match.
- The engine kills a unit that has no health left the next time anything hits it, for no damage too. So the units stage keeps a unit the track has alive one step of health, a 65,535th of its maximum, above none.

A weapon's `fireStarter` is not on the projectile, so a shot that lands on a burnable feature can still set it on fire. The features stage makes a feature the fire destroys again.

#### Sound

A shot born while play is watched plays its weapon's fire sound where it was born, with `Spring.PlaySoundFile` on the battle channel at the weapon's volume. A unit's shots of one weapon on one frame make one sound. A weapon with `soundTrigger` makes one for a burst: no second sound within `(salvoSize - 1) * salvoDelay` frames of the first, or within `beamtime` for a beam. A weapon with several sounds plays them in turn. A shot carried into a window from the one before is not a birth there, so a shot born on the last frame or two before a window's end, 900 frames apart, makes no sound.

Nobody has heard it. The headless engine has no sound and the runs with a window had it off.

#### What is not there

- A weapon the game does not have, or one of a kind that makes no projectile, is logged once by name and its shots are left out.
- The engine can still end a held shot, when the playback's world is not the match's. The stage notices, because a projectile it holds has a time to live nothing else has, logs the first, and does not make the shot again until a seek, a turn or the next window. The engine tells Lua of a projectile's death only for weapons a gadget has asked to watch, a list the base game's gadgets change, so the stage asks and does not listen. In the whole match below the engine ended none.
- A shot the engine has been handed, or has ended, is not in the air for the rest of its frames. Pause while a bolt fades and it finishes fading.

### The slow frame line

The unsynced half of the gadget times each frame's work and logs when it took longer than one simulation frame lasts, which is 1000 divided by `Game.gameSpeed` milliseconds, 33.3:

```
COILBOX_REWIND_PLAYER slow frame: the work of frame 4521 took 41.0 ms, and a simulation frame lasts 33.3 ms. 3 slow since the last line, the slowest 52.0 ms
```

After a line, slow frames are counted and not logged for 30 frames. Synced Lua has no clock, so the synced half calls `SendToUnsynced("coilbox_rewind_work", 0, frame)` before the work and with a 1 after it, and the unsynced half reads `Spring.GetTimer`, which gave whole milliseconds in these runs. Measured in four runs of the real engine run below, on a track of 5 units and 30 features, 460 frames each: a mean between 0.087 and 0.117 ms, and a slowest frame between 3 and 13 ms, which was the first frame every time.

A whole match of 23,091 frames with up to 54 units, in the run [In a real engine](#in-a-real-engine) describes, over 2,236 frames of work: a mean of 0.305 ms and a slowest frame of 27 ms without the projectiles stage, and 0.321 ms and 26 ms with it. The slowest is a seek that creates the match's units. The shots plan, 13,929 frames of mostly play through the fight, had a mean of 0.220 ms and a slowest frame of 26 ms. None of those runs logged a slow frame. Two earlier runs of the shots plan logged one each, of 36 ms on a seek and of 59 ms in the middle of play, on a frame where the log shows nothing else happening. The timer reads the wall clock, so another process taking the processor shows up as a slow frame, and whether that is what those two were is not known.

In an engine with a window the first seek from the start of that match to its last minutes took 39 and 41 ms in two runs, and logged the line. Timed stage by stage in the second: 33.3 ms for the units, 6.2 for the terrain, 1.5 for the projectiles and 0.1 for the features. The same seek later in the run took 20.3 ms for the units. Issue #3988 is about it.

### What the base game does

A game's adapter ([Game adapters](#game-adapters)) is where a game says what to switch off. For a game with no adapter, and for what an adapter leaves, the player undoes what it can and says what it cannot, each in one line of the log:

- The base game takes an empty team for a beaten one. Splinter Faction's `game_end.lua` and `game_team_com_ends.lua` call `Spring.KillTeam`, and the engine creates nothing on a dead team again. The guard gadget replaces `Spring.KillTeam` and `Spring.GameOver` as its file loads, and logs the first ask of each. It has to load before the gadget it guards against, because `game_end.lua` copies both calls into locals as it loads. Gadget files load in the order the engine's `VFS.DirList` sorts them, and the guard's name starts with `!`, which sorts before every letter, digit and underscore. A gadget whose file sorts before that, or anything outside the gadgets, keeps the real call. A team that dies anyway is logged.
- `Spring.CreateUnit` gives nothing, with no error, for a dead team or one at its unit limit. That is logged once for each team, and the unit is tried again after the next seek and not on every frame.
- A unit or a feature that the track does not have is removed on the next frame. That covers the map's own features, a unit the game spawns and a feature a base game gadget creates, as Splinter Faction's `unit_deathContainerSpawn.lua` does where a unit dies.
- A unit or a feature of the track that something else destroys is made again on the next frame.
- The engine asks before it leaves a wreck, and is refused, because the track has every wreck of the match.
- Nothing takes damage: `UnitPreDamaged` gives every hit no damage and no push. Health that changes anyway is set again on the next frame. That includes health that rises with no damage to hear of: the engine heals an idle unit, and a game can have a gadget that does, as Splinter Faction's `unit_auto_health_regeneration.lua` does for its commanders. The units stage asks the engine for each unit's health on every frame, so a wounded unit on a paused frame stays wounded.
- A nanoframe nobody is building decays, and the engine kills it when its progress or health reaches zero. A unit under construction has both set on every frame, and held above one step of that decay.
- A unit with no health left is killed by the next hit, and the track can have a living unit at none. A finished unit keeps one step of health.
- A unit that dies with its death effect explodes, and that explosion damages features. `UnitPreDamaged` covers units only. A feature it destroys is made again on the next frame (issue #3987).

A track's team is the same number in the game, because the start script carries the replay's teams. A team the game does not have as a team of its own is Gaia, read from `Spring.GetGaiaTeamID()`.

Not handled: on an engine before `2025.03.9` a finished unit cannot be turned back into a nanoframe, so the stage destroys it and creates it again as one. That path has only run on the stand-in, since no such engine is installed here.

## Game adapters

An adapter is a small Lua file for one game. It says what the game does that fights a recording, so the player stays the same for every game. Without an adapter nothing is switched off, nothing is hidden and the match still plays.

```lua
return {
	name = "Splinter Faction",
	shortname = "SF",
	versions = { min = "0.1.80", max = "0.1.99" },

	gadgets = { "game_end.lua", "game_team_com_ends.lua" },
	widgets = { "gui_static_resourcebar.lua" },
	units = { "armcom_start" },
	features = { "grave_marker" },

	hooks = {
		started = function() end,
		unitPlaced = function(unitID, unitDefID, t, clock) end,
		afterFrame = function(t, clock) end,
	},
}
```

Every key is optional except `shortname` in an adapter that coilbox ships. A key that is not in this table is refused, so a misspelling cannot switch nothing off without saying so.

| Key | Value | Does |
| --- | --- | --- |
| `name` | text | the name the log line shows. `unnamed` without it |
| `shortname` | text | the game's `shortname` from its `modinfo.lua`, compared without regard to case. Used to match a shipped adapter to a game, and ignored in a game's own |
| `versions` | `{ min = "...", max = "..." }` | the versions a shipped adapter is for, both ends included, either end optional. Without it every version matches |
| `gadgets` | list of file names | gadgets to switch off, as paths inside `luarules/gadgets/`, such as `game_end.lua` or `sub/folder/other.lua` |
| `widgets` | list of file names | widgets to switch off, as paths inside `luaui/widgets/` |
| `units` | list of names | unit definitions the player never creates |
| `features` | list of names | feature definitions the player never creates |
| `hooks` | table of functions | see [Hooks](#hooks) |

The file is run by `coilbox-springlua`, the sandboxed Spring Lua evaluator that reads a game's other config, so the lists can be worked out in Lua. It has no `io`, no `os` and no way to read another file. Coilbox reads everything but `hooks` from it before the engine starts, and the player reads the same file again in the engine, for `units`, `features` and `hooks`.

### Where an adapter lives

- Coilbox ships adapters in `lua/rewind-player/adapters/`. A file there is picked up by the next build and needs no change to the Rust, the way a gadget under `luarules/gadgets/` is.
- A game can ship its own at `coilbox_rewind/adapter.lua` in its primary archive. Coilbox reads it through unitsync, from the archive of the version being played, and not from archives that game depends on.

A game's own adapter wins. It applies whatever its `shortname` and `versions` say, since it is in the archive of the version being played. If it cannot be used, because it does not run or has a key that is not in the table, the launch carries on with a shipped adapter if one matches and with none otherwise, and the player's log line says why.

Of the shipped adapters, the first in file name order that matches wins. Give two adapters for one game ranges that do not overlap.

Whichever adapter is chosen, the playback game holds it at `coilbox_rewind/adapter.lua`, written on every launch, which is where the player reads it. When no adapter applies, that file returns `false`, and so a file at that path in the base game never reaches the player.

### Matching

A shipped adapter matches a game when its `shortname` equals the game's, without regard to case, and the game's version is inside `versions`.

A version is the numbers it starts with. Coilbox skips whatever comes before the first digit, reads numbers joined by single dots, and stops at anything else. Numbers are compared one at a time, and a missing number counts as 0.

| The game declares | Is read as |
| --- | --- |
| `0.1.89` | 0.1.89 |
| `V15.9.8` | 15.9.8 |
| `v2.58` | 2.58 |
| `stable-8405` | 8405 |
| `test-30922-8064a43` | 30922 |
| `1.7 (Beta 10.1)` | 1.7 |
| `$VERSION`, `KRE $VERSION`, nothing | no version |

An adapter with a `versions` range is for no game that has no version. A game folder under development declares `$VERSION`, so only an adapter without `versions`, or the game's own, applies to it. `min` and `max` are read the same way, and one with no number in it is refused. `max = "0.1"` means up to 0.1.0, so write `max = "0.1.99"` for every 0.1 release.

### What switching off does

For each name in `gadgets` and `widgets`, coilbox writes a file at that path in the playback game, `luarules/gadgets/<name>` or `luaui/widgets/<name>`. A depending game's file takes precedence over the same path in the game it depends on, and the engine's file names are not case sensitive, so the base game's file is never read. The shadow is a comment and `return false`.

The handlers read for this treat a file that returns `false` as one that asked not to be loaded, and load nothing for it. Those are the engine's own gadget and widget handlers, Splinter Faction's (run in the engine, see [In a real engine](#in-a-real-engine)) and THIS's widget handler. Beyond All Reason's has not been read or run here. An empty file is not the same:

- Splinter Faction's gadget handler loads it as a gadget with nothing in it, and the log still lists the gadget.
- Splinter Faction's widget handler refuses it with `Failed to load: <file>  (no GetInfo() call)`.

Coilbox does not write a shadow over one of its own files, and refuses an adapter that names one.

### Hide and skip

The player never creates a unit of a definition in `units` or a feature of one in `features`. Names are compared without regard to case. The track still has them, so a seek has no effect on them, and the log has no line about a name the game lacks, since leaving them out is the point. A name that is in the list and not in the track is harmless. A unit the base game creates by itself, and a feature it creates, are still removed on the next frame as before.

### Hooks

A hook is an optional function in `hooks`. The player calls these and no others, and logs a name in `hooks` that is not one of them or is not a function, since it is most likely a misspelling. A hook that raises is logged once and not called again, and the player carries on.

| Hook | Called | Arguments |
| --- | --- | --- |
| `started` | once, when the player has opened the track, before the first frame and so before anything of the track is in the world | none |
| `unitPlaced` | after the player created a unit and put it in place, and again for a unit made again after a seek | the engine's unit id, the unit definition's engine id, the track frame, the clock |
| `afterFrame` | at the end of every simulation frame, after every stage | the track frame, the clock |

The clock is the player's, and a hook only reads it. `clock.jumped` says the frame was reached by a seek or a step, `clock.direction` is 1 or -1 and `clock.speed` is how many frames of the track a simulation frame covers.

A hook runs in synced Lua, in the gadget's environment, and a frame of play allocates nothing in the player, so a hook that is called every frame should not either. These are the only hook points. They are the smallest set that issues #3797 (a build spray effect that reads a builder's recorded work), #3800 (a team's storage, which has to be set before any unit is placed), #3801 (a warp in effect for a unit that appears) and #3804 (replacing ghost drawing) are known to need, and a hook point is added by the issue that needs one.

### The log line

The player logs which adapter it has, once, when it starts:

```
COILBOX_REWIND_PLAYER adapter loaded: Splinter Faction. 2 gadgets and 1 widgets are switched off by the playback game, 1 unit definitions are hidden, 1 feature definitions are skipped, hooks: afterFrame, unitPlaced
COILBOX_REWIND_PLAYER adapter loaded: none
COILBOX_REWIND_PLAYER adapter loaded: none. the game's own adapter could not be used: the adapter is not in the format: unknown field `gadget`, expected one of ...
```

A gadget that an adapter switches off is not in the engine's `Loaded SYNCED gadget:` lines, and a line the player or the guard logged because of it does not appear.

### Writing one for a game

1. Play a recorded match with no adapter and read the `COILBOX_REWIND_PLAYER` lines. Each says something the base game did that the track does not have. Then list the gadgets in the engine's log, `Loaded SYNCED gadget:  <name>  <file>.lua`, and read the ones that end a game, spawn units or kill teams.
2. Put the file names in `gadgets` and `widgets`, and the definitions in `units` and `features`.
3. For a game coilbox ships an adapter for, add `lua/rewind-player/adapters/<anything>.lua` with a `shortname` and, if it only holds for some releases, `versions`. For a game's own, add `coilbox_rewind/adapter.lua` to the archive.
4. Run `cargo test -p tauri-plugin-coilbox-content`. It reads every shipped adapter and fails on one with a key that is not in the table, a file name that is not a `.lua` file inside its folder, or no `shortname`.
5. Run `scripts/rewind-playback-headless.sh` and read the log for the same lines. `lua/rewind-player/tests/headless/fixture_adapter.lua` is an adapter that the run uses, and `tests/headless/adapter_probe.lua` is a widget that says what was loaded and created.

The team guard and the player's removal of units and features that the track does not have stay in place, whatever an adapter says. An adapter makes them unnecessary for a game, and they are the safety net for a game with none.

### Splinter Faction

`adapters/splinter_faction.lua` is the adapter for Splinter Faction (issue #3800). It has no version range. The archives of 0.1.88 and 0.1.89 and the game's repository at its commit of 24 August 2026 all hold every file it names, and a range would leave a game folder under development, which declares `$VERSION`, with no adapter.

What a whole match did with no adapter, on engine `2026.07.01-102-g6e5c5a0`, and what the adapter does about it:

| What went wrong | Where it came from | With the adapter |
| --- | --- | --- |
| A team with no units was asked to be killed, at frame 182 in a window and 303 headless | `game_end.lua` and `game_team_com_ends.lua`, which also logged a `[com_ends]` line 7 to 28 times | both gadgets are switched off |
| A commander the track does not have was created for each team at frame 181 and removed a frame later | `game_spawn.lua`, which runs the start of a match: it waits for a faction and a start position, picks both when nobody answers and spawns | the gadget is switched off |
| The faction picker and the start position picker of a match's first seconds | `gui_static_factionchooser.lua` and `gui_static_placement.lua` | both widgets are switched off |
| A container was left where a unit died, picked at random, and also where a seek removed a unit | `unit_deathContainerSpawn.lua`. The track has the containers the match left | the gadget is switched off |
| A menu that gives units and resources to another team | `gui_static_sharemenu.lua` | the widget is switched off, and the menu's Sharing button then does nothing |
| A strip of buttons for the selection drew under the timeline | `gui_static_selected_units_buttons.lua`, which sits at the bottom centre of the view | the widget is switched off |
| A wounded unit healed while the time stood still | the engine's idle healing and `unit_auto_health_regeneration.lua` | nothing. The player puts health back, for every game |
| A feature of the track was destroyed a moment early | the death explosion of a unit that died while the match was watched | nothing yet. The player makes it again on the next frame (issue #3987) |

With `game_spawn.lua` off, a team would keep the engine's own storage of 1,000,000 and the resource bars would read 0/1000000. The adapter's `started` hook gives each team what that gadget gave it: the `startmetal` and `startenergy` of the team or of the mod options, and 1000 of each when neither says.

What stays, because it tells a viewer about the match: the resource bars, the tooltip with a unit's description, the minimap, the players list, health bars, build progress and its time left, the metal and geothermal spot markers, and the game's own effects, lights and weather. Two things stay for want of a way to take them out (issue #3983):

- The menu at the top right is one widget, `gui_static_menu.lua`, with Settings, Keybinds, Economy, Graph, Log and Quit in it, so it stays whole. Its Resign button sends the engine's `spectator` command, which does nothing for somebody who already is one.
- The build menu and order buttons of a selected unit, `gui_static_buildordermenu.lua`. A spectator's orders go nowhere. Switched off, the engine's own command menu takes its place and `game_buildHotkeys.lua` raises, both seen in a window.

What the kept panels show is not all the recording's. A track holds no team resources, so everything on the resource bars is the playback game's own economy, run by the engine on the units the player has placed. Measured in the same match, in the real replay and in the playback, for team 0:

| At frame | Number | In the match | In the playback |
| --- | --- | --- | --- |
| 6,927 | metal storage | 1100 | 1100 |
| 6,927 | metal income, expense | +9.1, -7.0 | +9.1, -0 |
| 6,927 | metal held | 1028 | 171, and rising for as long as the playback runs |
| 6,927 | energy income, expense | +100, -23.1 | +100, -12.6 |
| 6,927 | supply used | 3 | 2 |
| 6,927 | research points | 216 | 0 |
| 12,000 | metal storage | 1700 | 1700 |
| 12,000 | metal income, expense | +27.7, -24.6 | +27.7, -0 |
| 12,000 | metal held | 87 | 640, and rising |
| 12,000 | energy income, expense | +450, -161.9 | +450, -88.2 |
| 12,000 | supply used | 30 | 29 |
| 12,000 | research points | 86 | 0 |

Storage and income are right, because the same buildings make them. What is held, what is spent, the supply used and the research points are not. Issue #3982 is about recording them. Three more things on screen are the playback's and not the match's: a commander's name tag reads `CoilboxPlayback`, the one spectator who leads every team, where the match had the player's name. The clock in the players list is the engine's, which starts at nothing whenever the playback is opened. And the game's day and night and its weather follow that clock, so a moment that was dark in the match can be light in the playback.

The game's gadgets hear of the player's shots as they would of a match's. In the whole match, whose two weapons are a rocket (`fedstorm_rocket`, a `MissileLauncher`) and a laser bolt (`fedcommander_up2_particlebeamcannon_up2`, a `LaserCannon`), none raised and none changed what the track has:

- `gfx_explosion_lights.lua` lights an explosion and, for a cannon or a laser, the place a projectile is created. Both stay, being the game's own look. A bolt that the player creates after a seek is created where the track has it, in the air, so the light for a barrel flashes there. A held bolt carries the game's light for as long as it is held, which paused is a red glow that stays.
- `lups_projectiles.lua` draws on projectiles of the weapons it lists. It ran with no error.

Splinter Faction has more gadgets that act on a shot: `weapon_cluster_missiles.lua` and `game_airburst_weapons.lua` create projectiles of their own, `unit_turretLauncher.lua` creates a unit where a shot lands, `game_heat_weapons.lua` can destroy a unit, and `unit_area_timed_damage.lua` leaves an area that damages. The match fires none of their weapons, so what they do to a playback has been read and not seen, and the adapter switches none of them off (issue #3989).

![The fight of the whole match, paused](screenshots/shots-paused.jpg)

Paused, four rockets hang where the track has them, each with the game's own flame. Below, the same fight playing forward at 0.5x: the rockets have their trails, and one has just landed on the commander with the game's impact effect.

![The same fight playing forward at 0.5x](screenshots/shots-watched.jpg)

A commander shows the right stage after a seek with nothing done for it. Each stage is a unit definition of its own, `fedcommander_up1` and `fedcommander_up2` in the match that was played, with a script of its own that hides the pieces the stage does not have when the unit is created. A morph destroys one unit and creates another, so the track has two units with two definitions, and the player creates each by its definition.

![The commander in the playback and in the real replay, at frames 6,927 and 12,000](screenshots/adapter-commander.jpg)

The left column is the playback and the right the real replay, at the same two frames and from the same place. The colours differ because the playback takes each team's from the replay's start script, and the game recolours them for whoever is playing. The pose and the build spray differ because the player does not animate yet (issues #3796 and #3797).

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
- the game's adapter at `coilbox_rewind/adapter.lua`, and a file for each gadget and widget it switches off ([Game adapters](#game-adapters))

The list of files is made by `crates/tauri-plugin-coilbox-content/build.rs` when coilbox is built, so a gadget added under `luarules/gadgets/` or a widget under `luaui/widgets/` ships with no change to the Rust. A file with another extension, and `tests/`, stay out. A new file is picked up by the next build.

The start script has one spectator, no players or AIs, and every team's `teamleader` is that spectator. Team and ally team numbers are the replay's own. Mod options and map options are the replay's. The script sets `recorddemo=0`, and `gamestartdelay=0`, which takes away the engine's four second countdown before the first frame. The timeline is on screen during a countdown and takes a seek, and the world cannot show it, since the player moves only on frames. The engine adds the Gaia team, so read its number from the engine and do not assume it.

The base game's own gadgets run, except those the game's adapter switches off. A game with no adapter that creates starting units or ends the match when a team has no units will try to during playback. [What the base game does](#what-the-base-game-does) has what the player does about it.

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
| `window:projectileRange(frame)` | gives the positions `from, to` between which every projectile that exists at `frame` lies. Ask `projectileExistsAt` for each |
| `window:projectilesBorn(after, frame)` | gives the positions `from, to` of the projectiles whose first frame is after `after` and no later than `frame` |
| `window:sampleQueue(i, frame)` | gives the position of the first item and the number of items. The items are `queueItemDef`, `queueItemX`, `queueItemZ` (elmos) and `queueItemFacing` |

The two range calls search the first frames and walk nothing, so a frame of play looks at the shots in the air and not at the window's whole list. That needs the entries in the order they were born in. Coilbox's writer keeps that order and the format does not promise it, so a window says whether it holds in `projectileOrdered`, and when it does not both calls give the whole list. `projectileLongest` is the longest any projectile lasts in the window, which is how far back a projectile alive now can have been born. A projectile with bit 0 of its flags set was born in an earlier window, whatever its first frame here.

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
luajit lua/rewind-player/tests/projectiles_test.lua
luajit lua/rewind-player/tests/gadget_test.lua
luajit lua/rewind-player/tests/adapter_test.lua
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
- `projectiles_test.lua` checks the projectiles stage: what is in the air at a time, stepping forward and backward, that a seek looks at the shots that can be alive and not the window's list, that a shot lands only while it is watched and with no damage, crater or push, a shell that ends in the air, a bolt that stops, a beam fired once, the fire sound and when it is not played, a weapon the game lacks, an engine with no `Spring.SetProjectileTimeToLive`, a shot the engine ended and an id handed out again, a shot alive across two windows, and that 300 frames of play with 40 shots in the air allocate nothing.
- `gadget_test.lua` loads the two gadgets the way the engine does.
- `adapter_test.lua` checks how the player reads an adapter, that it never creates a hidden unit or skipped feature and says nothing about either, that each hook is called with the right arguments and a hook that raises is switched off, the log line, and that 60 frames of play with hooks allocate nothing.
- `timeline_test.lua` checks the timeline on a stand-in for `Spring` and `gl`: the message for every key, that a key with Ctrl, Alt or Meta is left alone, the frame a drag seeks to at both ends and between, the time and speed shown, that everything drawn is inside views from 640 by 480 to 3840 by 2160, moving the panel, changing a key, marks, and that 300 draws allocate nothing. It also loads the widget file the way a handler does.

`tests/support.lua` is the stand-in for the reader. Its `VFS.Unpack*` and `VFS.ZlibDecompress` follow the engine source, round what they return to a 32 bit float, and raise for a position or count a float could not hold. The zlib is the system's, through LuaJIT's FFI. Its synced environment has no `io`, so a reader that reached for it would fail the tests.

`tests/engine.lua` is the stand-in for the player: units, features, projectiles, the heightmap, teams and game rules parameters, each call written from the engine source it names. `world.simulate()` is the engine's own frame for projectiles: it looks for a hit along a projectile's speed and under the ground, whether or not the projectile is under move control, and then counts its time to live down.

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

A third test, `an_adapter_switches_things_off_in_the_engine`, launches the playback three times on Splinter Faction 0.1.89 with a probe widget (`tests/headless/adapter_probe.lua`) that reports at frame 320 of the track. With no adapter shipped, `game_end.lua` and `game_team_com_ends.lua` load, the guard logs that a team was asked to be killed, the widget `gui_static_resourcebar.lua` is one of 110 loaded, and the engine has 2 `lozscorpion`. With a fixture adapter (`tests/headless/fixture_adapter.lua`) that names the two gadgets, the widget and `lozscorpion`, neither gadget is in the log, no team is asked to be killed, the widget is one of 109, no `lozscorpion` exists and the other units are as before, no error names a shadowed file, and both hooks logged that they ran. A third launch with the shadow files emptied shows what an empty file does (see [What switching off does](#what-switching-off-does)). Switching off `game_end.lua` alone did not stop the team being asked to be killed, which is why the fixture names both gadgets.

A fourth test, `a_whole_splinter_faction_match_plays_with_its_adapter`, is not part of the script, because it wants a replay of a whole match and the script's is 1,100 frames. Give it one in `COILBOX_ANALYSIS_REPLAY` with the other variables the script sets. It launches the playback twice, with no adapter and with the one coilbox ships, and the driver plays the whole match forward at 32x, the whole match backward, seeks to ten times, plays through a death at 1x, holds a wounded unit paused for 450 frames and holds the empty start for 150.

It was run on a match of 23,091 frames on All That Glitters v2.2.3, with up to 54 units at the frames the driver looked at, recorded from a replay of 24 August 2026. Once on the game the replay was played on, which is the game's repository at that day's commit and declares `$VERSION`, and once on Splinter Faction 0.1.89 standing in for it. Both times:

- With no adapter the four gadgets load, a commander is spawned that the track does not have and a team is asked to be killed.
- With the adapter none of the four loads, nothing is spawned, no team is asked for, the match is not asked to end, no team is dead and the engine does not hold the match to be over.
- At both ends of play, at the ten seeks, past the death and after the wounded unit was held, the engine has the track's units and features, each unit where and how the track has it.
- No Lua raised once the match was running, apart from `cus_gl4.lua`, the game's unit shader gadget. It calls `gl.SetUnitBufferUniforms` for every unit created, which a headless engine does not have, so it raised 664 times in a run. In an engine with a window it did not raise once.
- With the player as it was before this test, the wounded unit, at 8.5% of its health, was 4.3% of its maximum higher after the 450 frames.

A fifth test, `the_shots_of_a_whole_match_follow_the_track`, wants the same replay and runs the driver's shots plan on it with the shipped adapter (issue #3795). On the match above, whose shots are 195 rockets and 83 laser bolts fired between frames 20,256 and 23,048:

- Paused on frame 22,819, the frame with the most in the air, the engine has the track's 7 shots, and still has them after 150 frames. At 20 seeks to frames with shots in the air it has as many as the track each time. Every shot is where the track has it, to four decimal places of an elmo, or held short as [Held](#held) says, and points the way the track has it going.
- Nothing lands while paused or during the seeks.
- Played backward from the frame it landed on, a rocket is nearer where it was fired on each of 58 frames in a row.
- Played forward through the fight, all 278 shots land at 1x and at 0.5x, a mean of 0.09 elmo from the last frame of flight the track has for them, and 277 at 2x. At 4x and played backward none lands.
- No shot did damage to a unit or a feature, by the engine's own sum before any gadget was asked, and none left a crater. After each pass every unit has the track's health.
- The engine ended no shot the player was holding, no slow frame was logged, no team died and no Lua raised.

The first runs of the plan did not show that, and what they showed is why a shot is held short of where it ends, why a unit keeps a step of health and why a bolt lands on a whole frame.

What it cannot show: anything on screen. A headless engine draws nothing, so how a unit, a death or the changed ground looks cannot be seen in any of the above.

The playback has been looked at in an engine with a window, on 13 October 2026, with a scratch widget seeking, moving the camera and taking the engine's own screenshots: the whole match above on Splinter Faction 0.1.89 with and without the adapter, the real replay of it at the same frames and from the same places, and the script's fixture match. The fight was looked at the same way for the projectiles stage, on the game the replay was played on: paused, at 0.5x forward and at 1x backward. [Splinter Faction](#splinter-faction) has two of those pictures. Units draw as their models with their textures, team colours and shadows, and as the game's icons from far away. [Splinter Faction](#splinter-faction) has what the panels show and a picture of the commander.

![The fixture match from far away, with the engine's default icon atlas and with Splinter Faction's](screenshots/adapter-icons.jpg)

The first look, on the left, had every unit as a black square, in the view and on the minimap. Those are unit icons, and the cause is the run's settings file and not the playback. Splinter Faction 0.1.89 has 90 icons of 512 by 512 pixels, the engine packs them into one atlas, and an atlas of the default `MaxTextureAtlasSizeX` and `MaxTextureAtlasSizeY`, 4096, holds 64 of them. The engine's log says `atlas=IconsAtlas_0 atlasFinalized=0` on every try, 290 times in that run, and every icon draws black. Splinter Faction's Initial Settings widget sets both to 8192 the first time the game is played, so a player's own settings file has them. On the right is the same match with those two settings and nothing else added.

So a settings file for a scripted run needs three lines for Splinter Faction:

```
SFInitialSettingsVersion = 1
MaxTextureAtlasSizeX = 8192
MaxTextureAtlasSizeY = 8192
```

Without the first line, the Initial Settings widget reloads the engine four seconds after it loads, which is what every headless run above does, since each has a settings file of its own. The match has no countdown to wait behind, so a driver starts, is cut off at about frame 100 and starts again, and the tests read what it said from its last start.

A scripted screenshot can hang this engine for good. `CBitmap::Save` logs while it holds the bitmap lock, and the info console, updating on the main thread, holds its own lock while it wraps a new line and loads any character its font does not have yet, which takes the bitmap lock. The font has ASCII from the start. Splinter Faction logs an em dash and an arrow in its first frames. Echo both before the first screenshot, wait until the game's start has logged, and keep any line of your own a second away from a screenshot.

The timeline has been looked at, once, by hand, on 13 October 2026: the same playback game opened in the engine with a window, in Splinter Faction 0.1.89 and in Metal Factions v2.58, with a scratch widget pressing the timeline's keys and taking the engine's own screenshots. The two pictures on this page are from those runs. The marks on the bar were not in them, since nothing writes a marks file yet. To do it again, set `COILBOX_PLAYBACK_KEEP_GAME` to a folder when running the timeline's test, which copies the playback game and its script there, and launch `spring` on the script. A settings file Splinter Faction has not seen makes its Initial Settings widget reload the engine, which took this engine down, so give the run a settings file with `SFInitialSettingsVersion = 1` in it.

### The fixture

`tests/fixtures/small.cbtrack` is a track `crates/coilbox-track` wrote from a seed, and `tests/fixtures/expected.lua` holds what the Rust reader gives for 30 of its frames. The Rust test `crates/coilbox-track/tests/lua_fixture.rs` fails when either file stops matching what the Rust crate writes and reads. After a change to the writer or the reader, rewrite both:

```sh
COILBOX_UPDATE_LUA_FIXTURE=1 cargo test -p coilbox-track --test lua_fixture
```
