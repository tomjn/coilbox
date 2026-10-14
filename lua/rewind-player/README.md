# Rewind player

The rewind player plays a replay track back inside the engine, with time going in either direction. This folder holds the Lua that reads a track (issue #3792) and the gadget that makes the world match it (issue #3794): units, features, terrain and the shots in the air (issue #3795) at any time. It does not yet pose aiming pieces or animate units (issues #3796 and #3797). The control on screen is a widget, the timeline (issue #3798). What a game switches off or hides during playback is its adapter (issue #3799).

A track is the file `crates/coilbox-track` writes, in the format `docs/reference/replay-track-format.md` describes. The format was designed so that the engine's Lua can read the file as it is, so there is no export step and no second copy on disk.

This page is for whoever works on the player or writes something that talks to it. The first half is the player: what it publishes, the messages it takes, the timeline that sends them, how to add to it and what it does about the base game. The second half is the reader: its functions, the conventions that are easy to get wrong, and what the tests do and do not prove.

## The player

The player holds a time `t`, a frame of the track that can be a fraction. On every simulation frame it moves `t` by direction times speed and makes the world the track at `t`. It simulates nothing, so `t` can jump and run backwards. A seek that needs many units made or removed is done over several frames, and the player says when it is done ([A seek over frames](#a-seek-over-frames)).

| File | What it is |
| --- | --- |
| `luarules/gadgets/coilbox_rewind_player.lua` | the gadget: opens the track, hands the engine's call-ins to the player and times a frame's work |
| `luarules/gadgets/!coilbox_rewind_guard.lua` | stops the base game killing a team or ending the match |
| `luarules/rewind_player/coilbox_player.lua` | the player: the clock, the list of stages, the published state |
| `luarules/rewind_player/coilbox_player_clock.lua` | the time and the messages that change it. It touches nothing in the engine |
| `luarules/rewind_player/coilbox_player_engine.lua` | the table of engine calls the player needs, and the check of it ([Engine calls](#engine-calls)) |
| `luarules/rewind_player/coilbox_player_terrain.lua`, `coilbox_player_features.lua`, `coilbox_player_units.lua`, `coilbox_player_projectiles.lua` | the four stages |
| `luarules/rewind_player/coilbox_player_rotation.lua` | a track's rotation as the pitch, yaw and roll the engine takes |
| `luarules/rewind_player/coilbox_player_adapter.lua` | reads the game's adapter, and guards its hooks |
| `luarules/rewind_player/coilbox_player_view.lua` | works out where the viewer looks, for the unsynced half of the gadget to send ([Which units first](#which-units-first)) |
| `luarules/rewind_player/coilbox_player_arrival.lua` | draws the effect where a unit arrives, in the unsynced half of the gadget ([The arrival effect](#the-arrival-effect)) |
| `luaui/widgets/coilbox_rewind_timeline.lua` | the timeline widget: the engine's call-ins for drawing, keys and the pointer |
| `luaui/rewind_timeline/coilbox_timeline.lua` | the timeline: where everything is, what a key or a press sends, and the drawing. It takes the engine as a table, so the tests run it |
| `luaui/rewind_timeline/coilbox_timeline_engine.lua` | the widget's own table of engine calls, in the same shape |

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
| `coilbox_rewind_settled` | 1 when the world is the track at `coilbox_rewind_frame`, 0 from a seek until it is. See [A seek over frames](#a-seek-over-frames) |

A parameter is set when the player is made, before the first frame, and again whenever its value changes. A message changes them as it arrives, so a widget sees a seek's frame before the world has moved to it. The world moves on the next simulation frame, and for a seek that needs a lot made or removed, on several. `coilbox_rewind_settled` is 0 from the seek's message until the last of them.

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
| `drag` | `1` or `0` | says the timeline's knob is being dragged, or has been let go. It moves nothing. While a drag lasts no arrival effect is shown ([The arrival effect](#the-arrival-effect)) |

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

The gadget's own unsynced half sends one more, `coilbox_rewind_budget:` and two whole numbers, the most units a frame may make and the most it may remove. It is not for a widget. [How many a frame](#how-many-a-frame) has what sets it. It sends a second of its own, `coilbox_rewind_view:`, which says where the viewer looks. [Which units first](#which-units-first) has that one.

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

From the left: play the other way, play or pause, slower, the speed, faster, the time and the match's length, and a `?` that opens the key list. The bar above them has a knob that seeks while it is dragged, and a press anywhere on the bar seeks there. A press on the bar sends `drag 1` before its first seek, and letting go sends `drag 0`, which is how the player tells the many seeks of a drag from one seek. A widget that is switched off in the middle of a drag sends the `drag 0` too. The times count from the track's first frame, as the replay page's do.

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

`coilbox_rewind_note` is one more game rules parameter. When it holds a string that is not empty, the timeline shows it in a small panel above itself. The gadget sets it once, when it loads, from the check of the engine's calls ([Engine calls](#engine-calls)). It says either what is switched off on this engine or why playback did not start. It is set with `Spring.SetGameRulesParam("coilbox_rewind_note", text)`, and it is left unset when there is nothing to say.

When playback does not start there is no player, so none of the other parameters is set. The timeline then draws the note and nothing else.

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
stage:afterSim()        -- optional: the frame is over (GameFramePost)
```

The engine does its own work on a frame between a gadget's `GameFrame` and its `GameFramePost`: units heal, and teams make and use resources. A stage that has to put something back after that has `afterSim`, as the units and resources stages do. `Player:framePost` calls it.

`clock.jumped` says the frame was reached by a seek or a step and not by play, and `clock.direction` and `clock.speed` say how it is playing. `clock:watched()` is true for a frame of play forward at 0.5x, 1x or 2x, which is when a death, an impact and a sound are shown. A stage is made with the context, a table that has the track, its `info` and `features`, the engine's `Spring`, `Game`, `CMD` and definition tables, `teamOf(team)` and `report(key, text)`. Take the engine from the context and not from a global, so that the tests can hand the stage a stand-in.

Four rules a stage has to keep:

- A frame of play allocates nothing. Synced Lua cannot collect garbage fast enough for a table for each key at 30 frames a second. Sample into tables made once, write to the tables handed to the engine and make them once, and walk a table with `next` and not `pairs`, since synced `pairs` makes a closure for each call. `tests/player_test.lua` counts what 300 frames of play allocate, and it has to stay 0.
- Look a definition up by name, once, when the stage is made. `report` a name the game does not have and skip what uses it. `report(key, text)` logs a line the first time it is given a key.
- Let the engine choose ids, and map the track's serial numbers to them. A destroyed unit's id cannot be asked for again at once.
- A new stage adds the engine calls it uses to the table in `coilbox_player_engine.lua` ([Engine calls](#engine-calls)), and does not call one that its row says is off. A test fails for a call that has no row.

A stage that can leave work for the next frame sets `stage.unsettled` to true in the frame it does. The player publishes `coilbox_rewind_settled` as 0 while a seek is waiting to be shown or any stage is unsettled. Only the units stage and the projectiles stage do. The units stage makes at most `makeBudget` units in a frame and removes at most `removeBudget`, and a creation waits for every removal. The projectiles stage leaves a shot whose shooter the units stage has yet to make.

The units stage has, by serial number, `unitOf[serial]` for the engine's unit id and `indexOf[serial]` for the unit's place in the current window's lists. `player.units` is the stage. The projectiles stage has `idOf[serial]` for the engine's projectile id of a shot it is holding, and is `player.projectiles`.

Weapons never fire, because the units stage calls `Spring.SetUnitUseWeapons(unitID, false, false)` on every unit it creates. That also stops a weapon aiming. A stage that wants the engine to aim a unit has to give that back.

### Engine calls

A replay is played on the engine it was recorded on, and that engine can be old. A call the player uses that an old engine lacks would be a Lua error part way through a match. `luarules/rewind_player/coilbox_player_engine.lua` is the one table of every engine call the player depends on, in rows, and the gadget checks it as it loads, before it loads any module that takes a call from the engine.

A row names the calls (`calls`), the feature that hangs on them (`feature`), how it is checked (`how`), whether the player can work without it (`required`), the oldest engine tag read that has the calls (`since`), what happens without them (`without`) and whether a viewer can tell (`visible`). The file's header describes each field.

- A row with a call missing that is not `required` switches off that one feature, and the rest plays. The gadget logs one line for it: `COILBOX_REWIND_PLAYER this engine has no Spring.SetHeightMapFunc. Switched off: ground changes. The ground stays as the map has it. Engine 105.0 and later have it`.
- A row that is `required` with a call missing stops playback. The gadget does nothing else: no player is made, damage is left alone, wrecks are left to the engine and no message is taken. It logs `COILBOX_REWIND_PLAYER cannot play: this engine has no Spring.CreateUnit. It is needed for creating and placing units. Engine 105.0 and later have it`, one line for each row.
- `how` is `presence` when having the calls is the whole check. It is `behaviour` for a call that exists on every engine read and acts differently on some. A presence check cannot tell those apart, so the row says where the player checks what the call did, and the player checks it where it already uses the call.

| Row | Calls | Required | Without it | In the note |
| --- | --- | --- | --- | --- |
| `track` | `VFS.UnpackU8`, `UnpackU16`, `UnpackS16`, `UnpackU32`, `UnpackS32`, `UnpackF32`, `VFS.ZlibDecompress`, `VFS.LoadFile` | yes | no playback | the engine to use |
| `world` | `Spring.GetModOptions`, `GetGaiaTeamID`, `GetTeamList`, `GetAllyTeamList`, `SetGameRulesParam` | yes | no playback | the engine to use |
| `units` | `Spring.CreateUnit`, `DestroyUnit`, `ValidUnitID`, `GetUnitIsDead`, `GetAllUnits`, `GetUnitHealth`, `SetUnitHealth`, `SetUnitMaxHealth`, `Spring.MoveCtrl.Enable`, `SetPosition`, `SetRotation`, `Game.constructionDecay`, `Game.constructionDecaySpeed` | yes | no playback | the engine to use |
| `terrain` | `Spring.SetHeightMapFunc`, `SetHeightMap`, `Game.squareSize` | no | the terrain stage does nothing | ground changes |
| `features` | `Spring.CreateFeature`, `DestroyFeature`, `ValidFeatureID`, `GetAllFeatures` | no | the features stage does nothing | wrecks and rocks |
| `featureTurn` | `Spring.SetFeatureRotation` | no | features are not turned | feature turns |
| `sight` | `Spring.SetGlobalLos` | no | the fog of war stays | full sight |
| `holdFire` | `Spring.SetUnitUseWeapons` | no | units may fire. They do no damage | holding fire |
| `onOff` | `Spring.GetUnitIsActive`, `Spring.GiveOrderToUnit`, `CMD.ONOFF` | no | units keep the state they were made in | unit on and off |
| `rebuild` (behaviour) | `Spring.GetUnitIsStunned` | no | a building seeked back to its construction can show as finished | construction after a seek |
| `shots` | `Spring.SpawnProjectile`, `SetProjectileMoveControl`, `SetProjectileDamages`, `SetProjectilePosition`, `SetProjectileVelocity`, `GetProjectileTimeToLive`, `GetProjectileDirection`, `DeleteProjectile`, `GetGroundHeight`, `Game.armorTypes` | no | the projectiles stage does nothing | shots |
| `shotHandover` | `Spring.SetProjectileTimeToLive`, from `2025.03.9` | no | `Projectiles:release` keeps the shot under move control for the engine's one look | nothing |
| `sound` | `Spring.PlaySoundFile`, `Game.gameSpeed` | no | weapons fire without a sound | nothing |
| `resources` | `Spring.SetTeamResource`, `SetTeamShareLevel` | no | what each team holds, its storage and its share level are the playback's own | team resources |
| `resourceRates` | `Spring.GetGameFrame`, `GetTeamResources`, `GetTeamInfo`, `AddTeamResource`, `UseTeamResource` | no | each team's income, expense and pull are the playback's own | team income and expense |
| `resourceExcess` | `Spring.AddTeamResourceExcessStats`, from `2026.07.01` | no | what a team wasted reads as the playback's own | nothing |
| `teamParams` | `Spring.SetTeamRulesParam` | no | the team rules parameters an adapter names are the playback's own | the game's own team numbers |
| `workTiming` | `SendToUnsynced` | no | the slow frame line is not logged, a seek is shown in one frame because no budget is worked out, units are made in the order of the track's list and there is no arrival effect | nothing |
| `adapter` | `VFS.FileExists` | no | no adapter is read | the game adapter |

Every row has `since = "105.0"` except `shotHandover` and `resourceExcess`. The four rows of the resources stage were read at `105.0`, `105.1.1`, `2025.01.6`, `2025.03.9` and `2026.07.04`, and `Spring.AddTeamResourceExcessStats` at every tag of 2025 and 2026, of which `2026.07.01` is the first that registers it. That is the oldest tag read, not a claim about an older engine. `105.0`, `105.1.1`, `2025.01.6` and `2026.07.04` were read for this table in `rts/Lua` of `~/dev/RecoilEngine`, and the spike on issue #3791 read ten tags and found `Spring.SetProjectileTimeToLive` registered from `2025.03.9` only. In `2025.01.6` the function's body is in `LuaSyncedCtrl.cpp` and nothing registers it.

#### What the note says

The gadget sets `coilbox_rewind_note` once, as it loads ([The note](#the-note)). A feature a viewer cannot tell is missing (`visible = false`) is logged and not put in the note, because a note that names something nobody would have noticed is noise. The `shotHandover` row is one: an engine without the call still shows every shot and still lands the ones that hit something. A missing fire sound and a missing frame timer are the others.

- One feature off: `Switched off on this engine: ground changes`
- Several: `Switched off on this engine: ground changes, wrecks and rocks, shots`
- More than three: the first three, then `and 2 more`. The panel is one line wide as the text.
- Playback refused: `Playback needs engine 105.0 or later: no Spring.CreateUnit`. With several calls missing it names the first and counts the others: `... and 3 more`. The log has a line for each.
- Nothing a viewer can see: no note.

Required rows are the ones the units stage cannot work without: it creates, places, destroys and heals units, and the clock and teams are what it is made from. Terrain, features, shots and the rest are things a match can be watched without.

#### Adding a row

A new stage adds its calls to the table in the commit that adds the stage. For a call the stage uses:

1. Add a row to `M.SYNCED` in `coilbox_player_engine.lua` with every field. A call in the unsynced half of the gadget goes in `M.UNSYNCED`. Name a call by the dotted path from a global the gadget hands over (`Spring`, `VFS`, `Game`, `CMD` and `SendToUnsynced`). A different global needs adding to the roots table the gadget passes to `check` in `gadget:Initialize` as well.
2. Read `context.on.<id>` in the stage when it is made, and do not call what the row says is off. If the whole stage depends on it, make the stage in `Player.new` only when `on.<id>` is true, as the terrain, features and projectiles stages are. A stage that is off is the table `OFF`, which does nothing.
3. If the calls exist on every engine but act differently on some, set `how = "behaviour"`, say in `where` how the stage checks, report it with `context.report` when it finds the older behaviour, and add the check to `BEHAVIOUR` in `tests/engine_test.lua`. A behaviour row with no entry there fails the test.
4. Run `luajit lua/rewind-player/tests/engine_test.lua`. For every call of every row it takes the call out of the engine stand-in, plays the fixture track forward, backward and across seeks, and asserts that nothing raises, the log line and the note are right (or that a required call stops playback), and that the other features still work. To also assert that the feature is off, add an entry to `OBSERVE` in that file, a function that gives a number that is above 0 on a full run and 0 when the feature is off. A call the fixture track cannot show, as with `onOff`, gets a test of its own.

The same test reads the source of every file under `luarules/` and fails for an engine call with no row, and for a row whose call nothing uses.

Calls that are not engine functions come into a row too, when the stage reads them: `Game.squareSize` is a row member as `Spring.SetHeightMap` is. A call-in the engine may not make, such as `GameFramePost` before `105.1.1-2590`, cannot be found by looking at a global. Its row is `how = "behaviour"`, with the calls the stage makes in `calls` and the check, which is whether the call-in has arrived after a few frames, in `where`.

`Spring.SetUnitPieceMatrix`, `Spring.SetUnitDirection`, `Spring.SetFeatureDirection` and `Spring.GetFeatureDirection` are on every engine read and changed what they do. The player does not use them, and `M.AVOID` in the table says why. A test fails if the source uses one. A stage that needs one adds a row and checks its behaviour.

Rows for the guard gadget's `Spring.KillTeam` and `Spring.GameOver` are not needed. The guard replaces them and does not call them (`M.REPLACED`).

#### The widget

The timeline widget uses `gl`, `GL` and the unsynced `Spring`, which the synced gadget cannot look at. It has a second, small table of its own in `luaui/rewind_timeline/coilbox_timeline_engine.lua`, with rows in the same shape and a `check` copied from the gadget's, since a widget cannot reach a file under `luarules/`. The widget checks it in `widget:Initialize`:

- `drawing`, `player` and `keys` are required. A widget missing one logs `COILBOX_REWIND_TIMELINE cannot start: this engine has no gl.Rect. It is needed for drawing the timeline. Engine 105.0 and later have it` and does not start. The player goes on playing.
- `marks` is optional. Without `VFS.FileExists` or `VFS.ZIP` the timeline starts with no marks and logs a line.

A widget cannot set a game rules parameter, so the widget has no note. An engine too old for the player's own calls shows the gadget's note through this widget. An engine too old for the widget's calls shows nothing on screen and has the line in the log.

The unsynced half of the gadget has five rows in `M.UNSYNCED`:

- `workTimingLine` needs `Spring.GetTimer`, `Spring.DiffTimers` and `Game.gameSpeed`. Without one it logs a line, takes no timings and sends the player `coilbox_rewind_budget:none` once, which takes the limit off the units stage, so a seek is shown in one frame as it was before issue #3988.
- `microTimer` needs `Spring.GetTimerMicros`, from `2025.01.6`. Without it a frame is timed in whole milliseconds with `Spring.GetTimer`, and the budgets are coarser.
- `budgetMessage` needs `Spring.SendLuaRulesMsg`. Without it no budget can be sent, so the budgets stay at one unit made and one removed in a frame. A seek of many units then takes that many frames to show and shows correctly, and a viewer can notice, so the note names it. The synced half cannot tell, which is why this is not a fall back to no limit.

- `view` needs `Spring.GetViewGeometry`, `Spring.TraceScreenRay` and `Spring.GetCameraPosition`. Without one the camera is not looked at, so the units a seek makes are made in the order of the track's list, and an arrival effect is shown for a unit outside the view too. The view is sent with `Spring.SendLuaRulesMsg`, so it is off without the `budgetMessage` row as well.
- `arrivalEffect` needs `gl.BeginEnd`, `gl.Vertex`, `gl.Color`, `gl.Blending`, `gl.DepthTest`, `gl.DepthMask`, `gl.Texture`, `GL.QUADS`, `GL.SRC_ALPHA`, `GL.ONE`, `GL.ONE_MINUS_SRC_ALPHA`, `Spring.GetCameraDirection`, `Spring.GetUnitRadius` and `Spring.GetTeamColor`. Without one no effect is drawn and the gadget has no `DrawWorld`. The effect's clock is the frame timer's, so it is off without the `workTimingLine` row as well.

Neither is in the note. A viewer cannot tell that an order or an effect they never saw is missing. All of those calls are registered at `105.0`, `105.1.1`, `2025.01.6`, `2025.03.9` and `2026.07.04`: the `Spring` ones in `rts/Lua/LuaUnsyncedRead.cpp` and `LuaSyncedRead.cpp`, the `gl` ones in `LuaOpenGL.cpp` and the constants in `LuaConstGL.cpp`. The unsynced half of a gadget is given `gl` and `GL` in `rts/Lua/LuaHandleSynced.cpp`. They have run on engine `2026.07.01-102-g6e5c5a0` and on no other.

Without `SendToUnsynced` the synced half has no timing at all and starts with no budget, so a seek is shown in one frame.

#### What has run

No engine was run for this table. No engine before `2025.03.9` is installed, so every older path is tested on the stand-in in `tests/engine.lua` with a call taken out of it, and none has run in an engine. The stand-in has `world.oldEngine` for the `SetUnitHealth` behaviour, and the tests take `Spring.SetProjectileTimeToLive` out for the rest. That shows the logic, the log lines and the note. It does not show what an old engine does with the calls that are left.

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

After a line, slow frames are counted and not logged for 30 frames. Synced Lua has no clock, so the synced half calls `SendToUnsynced("coilbox_rewind_work", 0, frame)` before the work and with a 1 after it, and the unsynced half reads `Spring.GetTimerMicros` where the engine has it, which is 2025.01.1 and later, and `Spring.GetTimer` otherwise, which gave whole milliseconds in the runs below. Measured in four runs of the real engine run below, on a track of 5 units and 30 features, 460 frames each: a mean between 0.087 and 0.117 ms, and a slowest frame between 3 and 13 ms, which was the first frame every time.

A whole match of 23,091 frames with up to 54 units, in the run [In a real engine](#in-a-real-engine) describes, over 2,236 frames of work: a mean of 0.305 ms and a slowest frame of 27 ms without the projectiles stage, and 0.321 ms and 26 ms with it. The slowest is a seek that creates the match's units. The shots plan, 13,929 frames of mostly play through the fight, had a mean of 0.220 ms and a slowest frame of 26 ms. None of those runs logged a slow frame. Two earlier runs of the shots plan logged one each, of 36 ms on a seek and of 59 ms in the middle of play, on a frame where the log shows nothing else happening. The timer reads the wall clock, so another process taking the processor shows up as a slow frame, and whether that is what those two were is not known.

In an engine with a window the first seek from the start of that match to its last minutes took 39 and 41 ms in two runs, and logged the line. Timed stage by stage in the second: 33.3 ms for the units, 6.2 for the terrain, 1.5 for the projectiles and 0.1 for the features. The same seek later in the run took 20.3 ms for the units. That was issue #3988, and [A seek over frames](#a-seek-over-frames) is what became of it.

### A seek over frames

A seek can need hundreds of units made or removed, and in Splinter Faction the engine takes 0.2 to 0.5 ms for each. Before issue #3988 the units stage did all of them in the frame the seek was shown in, so a seek across 400 units took 130 to 166 ms of one frame in a window and 120 to 215 ms in a headless engine. The stage now does a seek over as many frames as the engine's time allows.

- A frame makes at most `makeBudget` units and removes at most `removeBudget`. Making and removing have a budget each, because they cost the engine different amounts.
- While a removal is left, nothing is made. The frame that does the last removal makes as many as the rest of its share allows. A removal uses `1 / removeBudget` of a frame's share, a creation `1 / makeBudget`, and a frame has one share. So removals still come before creations, now across frames as well as across stages.
- A unit that is in the track both before and after the seek is put where the track has it at the time shown from the first frame. The units that go are removed over the first frames and the units that arrive are made over the frames after. Features, the ground and the shots whose shooter is in the world are the time shown from the first frame.
- A unit a seek removes goes quietly in every frame it takes, as it did when a seek was one frame.
- A seek that arrives while another settles needs nothing special. Every frame works out what the track has at the time shown from nothing, so the units the new time does not have are removed first and the ones it has are made.
- Play goes on while a seek settles. The clock moves in every frame, and a unit made late is put where the track has it at the time of the frame it is made in.
- A shot waits for its shooter. A shot made before its unit would have no owner for good, so the projectiles stage leaves a shot whose shooter is in the track and not yet made, and makes it in the frame the shooter is there if it is still in the air.
- The adapter's `unitPlaced` hook is called when a unit is made, which can be several frames after the seek.
- `coilbox_rewind_settled` is 0 from a seek's message until the world is the track at `coilbox_rewind_frame`, and 0 before the first frame. A test or a widget that waits for a seek waits for the frame and then for this.

#### How many a frame

The player cannot time itself, because synced Lua has no clock. The synced half of the gadget tells the unsynced half, which has one, how many units the frame made and how many it removed. The unsynced half works out how many of each fit in half a simulation frame, 16.7 ms, and sends the two numbers back as a `coilbox_rewind_budget:` message. Half, because the rest of the frame is the engine's own simulation and drawing, and the slow frame line is what says whether that left enough. The rules are `fit` and `retune` in `luarules/gadgets/coilbox_rewind_player.lua`:

- Both budgets start at one.
- A frame that used the whole of a budget sets it to what fits in half a frame at the cost per unit that frame showed, with the rest of the frame's work counted in so that it errs low. The new budget is at least one and at most twice what the frame did.
- A frame that used less of a budget leaves it alone, unless the frame took longer than half a frame, and then cuts it.
- A frame that made and removed nothing sets both back to one. What a unit costs moves with how many there are, from 0.28 to 0.5 ms to make and from 0.13 to 0.37 ms to remove in a headless run as the count went from none to 400 and from 400 to none. So the budget a seek ended on is wrong for the start of the next, and a first version that kept it logged frames of 33 to 58 ms.
- A frame that did both changes neither, because it says what neither costs.

The message reaches the synced half 2 to 5 frames later in the windowed runs below, and up to 22 frames later in a headless run on a machine doing other work. A budget therefore doubles every few frames, and a seek of 400 units took 17 to 24 frames to settle in the windowed runs, and 38 the first time. No count of units is written in the code. The only numbers are half a frame, one to start from and a doubling.

Which units a seek makes first follows the viewer. [Which units first](#which-units-first) has how.

#### Measured

The engine was `2026.07.01-102-g6e5c5a0` with Splinter Faction, on a Mac with other work running, so the load average was 3 to 6 in these runs. A window was 1,280 by 720. The timers were microseconds. Each stage is timed on its own by a scratch patch that is not in the repository, and every figure is the slowest frame of the seek in milliseconds. A seek is from the first frame to frame 22,791, the last ten seconds of the match. "Later" is the second such seek in the same run. One run of each, so a figure carries the noise of one.

The whole match is the 23,091 frame match of [In a real engine](#in-a-real-engine), which has 53 units at frame 22,791. The crowd is described below, with 400 units from frame 300 on.

| Track | Engine | Player | Seek | Frames to settle | Terrain | Features | Units | Projectiles | Slowest frame | Slow frame lines |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| whole match | headless | before | first | - | 2.54 | 0.08 | 22.80 | 0.06 | 25.49 | 0 |
| whole match | headless | before | later | - | 2.37 | 0.07 | 19.37 | 0.04 | 21.85 | |
| whole match | headless | after | first | 8 | 2.62 | 0.08 | 6.82 | 0.07 | 9.55 | 0 |
| whole match | headless | after | later | 7 | 2.52 | 0.09 | 6.38 | 0.04 | 8.16 | |
| whole match | window | before | first | - | 6.89 | 0.08 | 22.29 | 0.06 | 29.33 | 0 |
| whole match | window | before | later | - | 2.58 | 0.08 | 16.84 | 0.05 | 19.55 | |
| whole match | window | after | first | 26 | 8.11 | 0.08 | 7.19 | 0.06 | 15.41 | 0 |
| whole match | window | after | later | 7 | 2.50 | 0.08 | 5.54 | 0.05 | 8.16 | |
| crowd of 400 | headless | before | first | - | 2.60 | 0.07 | 166.61 | 0.01 | 169.30 | 3 |
| crowd of 400 | headless | before | later | - | 2.45 | 0.08 | 172.27 | 0.01 | 174.81 | |
| crowd of 400 | headless | after | first | 15 | 2.46 | 0.09 | 18.50 | 0.02 | 18.56 | 0 |
| crowd of 400 | headless | after | later | 16 | 2.45 | 0.10 | 19.09 | 0.01 | 19.15 | |
| crowd of 400 | window | before | first | - | 4.40 | 0.08 | 161.16 | 0.01 | 165.65 | 3 |
| crowd of 400 | window | before | later | - | 2.48 | 0.08 | 150.63 | 0.01 | 153.20 | |
| crowd of 400 | window | after | first | 38 | 3.88 | 0.09 | 21.35 | 0.01 | 21.38 | 0 |
| crowd of 400 | window | after | later | 20 | 2.61 | 0.09 | 22.51 | 0.01 | 22.60 | |

The slow frame lines are for the whole run of eight seeks, which also go back to the first frame and to the last, and not for the one row. There is no figure for frames to settle before the change, since the world was whole in the frame the seek was shown in. The slowest frame in all eight seeks of the windowed crowd run was 27.2 ms, and of the windowed whole match run 15.4 ms. Going back to the first frame removed 400 units in one frame of 141.45 ms before, and over 24 frames with a slowest of 13.56 ms after.

The whole match run today did not reproduce the issue's 39 and 41 ms. The first windowed seek before the change took 29.3 ms, with the units at 22.3 ms where the issue measured 33.3. The issue's runs were on a different day and nobody else's load is known. What the table shows for the whole match is that the first seek is now 15.4 ms, and that its units stage went from 22.3 to 7.2 ms.

##### The crowd

No replay on the machine that wrote this has more than 54 units at once, and Beyond All Reason is not installed. `crates/coilbox-track/tests/crowd.rs` builds a track from the recorded track of the whole match. It keeps the match's info, features and terrain, drops the projectiles, and writes 400 units of the 13 unit definitions the match used, taken in turn, standing still at places where the match's units stood, in rings of eight 40 elmos apart round each place, at the height of the place. Half exist from 300 frames in and half from the middle of the match, to the last frame. None exists at the first frame, so the first seek makes all of them and the first time of each definition is in it. The units are not Beyond All Reason's, and a Beyond All Reason match has more kinds of unit than 13.

```sh
COILBOX_CROWD_SOURCE=whole-match.cbtrack COILBOX_CROWD_OUT=crowd.cbtrack COILBOX_CROWD_UNITS=400 \
  cargo test -p coilbox-track --test crowd -- --ignored --nocapture
COILBOX_PLAYBACK_TRACK=crowd.cbtrack  # then run the test below, with the variables of the whole match tests
```

`COILBOX_CROWD_DEFS` is a list of unit definition names with commas between them. The crowd then uses those in place of the match's own, in turn, which makes a crowd for another game than the one the match was played on. The crowd of 400 Balanced Annihilation units in [The arrival effect](#the-arrival-effect) was made with `armcom,armpw,armsolar,armllt,armmex,armlab,armvp,armstump,armflash,armrad,corcom,corak,corllt` and played with `COILBOX_PLAYBACK_GAME` naming Balanced Annihilation V15.9.8. The ignored test below passed on it in a headless engine: 400 units at each stop and no slow frame.

The ignored test `a_seek_across_a_whole_match_settles_in_frames_that_fit` plays eight seeks across a match with the driver's seeks plan, waits for `coilbox_rewind_settled` after each, and checks that the engine has the track's units and features at each stop and that the log has no slow frame line and no Lua error. It passed on the whole match and on the crowd of 400 in a headless engine. `COILBOX_PLAYBACK_TRACK` names a track to play instead of the one recorded from the replay.

#### Where it stops holding

The same seeks on crowds of 1,000 and 2,000 units in a headless engine, with the player after the change:

| Units | Frames to settle | Slowest frame of the units stage | Slow frame lines |
| --- | --- | --- | --- |
| 400 | 12 to 16 | 19.09 ms | 0 |
| 1,000 | 37 to 55 | 43.35 ms | 1 of 43.4 ms |
| 2,000 | 122 to 175 | 30.46 ms | 0 |

A seek of 2,000 units takes 4 to 6 seconds to show. Each frame with every unit in place and nothing to do costs 1.0 ms at 400 units, 2.3 ms at 1,000 and 4.8 ms at 2,000, the median of the units stage, so about 2.4 microseconds for each unit in the world. That cost is not spread and is in every frame of play. At that rate it reaches half a frame at about 7,000 units, which is arithmetic on three points and has not been run. The one slow frame at 1,000 units is one frame of 43.4 ms in a run whose other seeks had no frame over 24.6 ms. A crowd of 400 shows the same thing in headless runs on a machine with a load average of 7 to 9: of three runs, one logged a frame of 42.4 ms, one of 76.5 ms and one none, and in each the frame was 39 to 44 creations whose calls to `Spring.CreateUnit` took 41 and 76 ms against 17 to 19 ms for the same number in the frames either side. A run of the ignored test on that machine logged frames of 39.3 and 110.5 ms. These are single frames in which the engine's calls alone were slow, which looks like the machine's other work, and the figures do not show that it was. The test can fail on one when the machine is busy. The acceptance of issue #3988 holds in the runs above for a crowd of 400 in a window, and in a headless engine for 1,000 and 2,000 with that one frame in 1,000 as an exception. It was not run in a window above 400.

Two stages have no budget. The features stage took 1.0 ms to make the match's 162 features in the first frame, and the terrain stage took 2.4 to 8.1 ms for the match's changes to the ground. A match with thousands of features has not been timed.

#### The first time of a definition

The first unit of a definition costs more than the next ones. In the first windowed crowd run, before the change, with the 13 definitions the first seek made, the first unit of `fedcommander_up1` took 8.00 ms against a median of 0.46 ms for the later ones, `f1landfac` 2.34 against 0.39 and `fedmetalextractor_up1` 0.94 against 0.33. The other ten were within 0.25 ms of their later median. Summed over the 13 definitions the extra was 10.3 ms, which is the gap the issue saw between 33.3 and about 20 ms. The median of all later creations was 0.36 ms.

The engine already loads every model while the game loads (`PreloadModels` in `rts/Rendering/WorldDrawer.cpp`, on by default, which calls `SolidObjectDef::PreloadModel` for every unit, feature and weapon definition), so the cost is not the model. What it is was not measured. `Spring.PreloadUnitDefModel(unitDefID)` exists in unsynced Lua (`rts/Lua/LuaUnsyncedCtrl.cpp`, since 2015) and does the same thing for one definition, so it adds nothing unless a player has switched `PreloadModels` off.

The player does not create one unit of every definition while the game loads, which the issue suggested. The extra was 10.3 ms in all for 13 definitions, once. With a budget of one, then two, then four, the first units of a seek are few, and in the crowd all 13 definitions were among the first 15 units, made in frames of one, two, four and eight. A unit made and destroyed at load would also run the base game's gadgets for a unit that is not in the track.

### Which units first

After a seek the units the viewer is looking at are made first (issue #4008).

![A seek 0.35 seconds after it was sent: every unit in view is there, and the minimap shows that nothing outside the view is yet](screenshots/seek-view-first.jpg)

The same seek at the same moment with no view sent and no effect, which is how the player made its units before:

![The same moment in the order of the track's list: three units in view, and the rest scattered over the map](screenshots/seek-list-order.jpg)

- The synced gadget cannot see the camera. Its unsynced half looks at it once a simulation frame, before the frame's work is timed, and sends what it finds as a Lua message, `coilbox_rewind_view:`, the way it sends the budget. `luarules/rewind_player/coilbox_player_view.lua` works it out.
- The view is the place on the ground in the middle of the screen, then the places on the ground at the screen's four corners, going round, each as an x and a z in whole elmos: `coilbox_rewind_view:4000 3000 3200 3450 4799 3450 4799 2551 3200 2551`. That is five calls of `Spring.TraceScreenRay`. Each is made with `onlyCoords`, so the engine walks the heightmap along the ray and looks at no unit and no feature, and with `ignoreWater`, because the engine takes a ray that ends above the water plane to have missed the ground too (`TraceRay::GuiTraceRay` in `rts/Game/TraceRay.cpp`).
- A corner whose ray leaves the map is where the ray meets the level of the middle. A corner that looks at the sky is nowhere, and the message is then the middle alone: `coilbox_rewind_view:4000 3000`. A camera whose middle looks at the sky sends `coilbox_rewind_view:none`.
- A view is sent again when its middle or a corner has moved by more than a sixteenth of the distance from the camera to the middle (`View.SHARE`), or when it gains or loses its corners. The share is a choice and not a measurement. A smaller one follows the camera more closely and makes the player sort more often while a seek settles.
- The units stage keeps the last view. While a seek's units are arriving it puts the units still to be made in order once: those inside the four corners first, and in each group the nearest the middle first. Two as near are in the order of the window's list. A frame makes the next ones of that order as far as its budget goes. With the middle alone, every unit counts as inside.
- The order is worked out again when a view arrives while the seek settles, when another seek arrives, when the window changes, and when play has brought in a unit the order does not have. So the units still to come follow a camera that moves.
- A frame of play never sorts. The stage only sorts between a seek and the frame that makes the seek's last unit.
- With no view the order is the window's list, as it was before: until the first message arrives, on an engine without the calls, and after `coilbox_rewind_view:none`.
- The world at the end of a seek is the same, and removals still come before creations.

A refused view logs `COILBOX_REWIND_PLAYER the message "..." was refused:` and leaves the last good one.

What the sort costs was timed in a headless engine on a crowd of 2,000, with a scratch mark either side of it: 3.7 to 4.5 ms for 1,740 to 2,000 units over 14 sorts, and 0.59 to 0.81 ms for 289 to 318 units over 6. That includes sampling where each unit stands. It is inside the frame's timed work, so the budget that is worked out from the frame counts it. A camera that scrolls while a seek settles makes the stage sort once for each sixteenth of the camera's distance it moves. A headless engine has a camera, with a view of 8 by 8 pixels, so the headless runs make their units in view order too.

In an engine with a window, on the crowd of 400, with the view of 2560 by 1440 pixels read from the engine once a simulation frame by a scratch gadget, which takes a unit to be in view when its middle is on the screen:

- Before, 288 to 304 of the 360 to 368 units outside the view were made in an earlier frame than the last unit in view, in three seeks of one run.
- Now, 0 to 7 of the 320 outside were, in 20 seeks over four runs. Each of those was within 115 pixels of the edge of the view. The four corners are joined by straight lines on the ground, and the edge of a view over hills is not straight, so a unit beside the edge can fall on either side. So the rule that every unit in view exists before any unit outside it holds but for units at the edge.
- Now, the last of the 79 units in view was there 260 to 549 ms after the seek was sent, and the whole seek took 615 to 1,114 ms. Before, it was 567 to 759 ms of 605 to 942 ms, with 31 to 39 units in view, because the camera had moved in that run.

[Measured in a window](#measured-in-a-window) has the frames.

### The arrival effect

A unit that a slow seek makes gets a short effect where it appears, so that it arrives and does not pop into place (issue #4009).

![The effect in Splinter Faction, 0.4 seconds into a seek](screenshots/arrival-effect.jpg)

![The same effect in Balanced Annihilation V15.9.8, on a crowd of its own units](screenshots/arrival-effect-ba.jpg)

Which units get one is the units stage's to say:

- A unit made in a later frame than the frame that showed the seek, while the seek's units are still arriving. That is what slow means here. A seek that is shown in one frame gets none. With a budget that starts at one, a seek that makes more than one unit takes more than one frame.
- Only a unit inside the view's four corners. With a view that has no corners, or no view, every unit counts as inside.
- None while the timeline's knob is being dragged, which the `drag` message says. A drag sends many seeks a second. When the drag ends, the units still to come get one.
- None for a unit a seek removes, and none in plain play. A unit that play brings in while a seek is still settling does get one.

The stage asks with `context.arrive(unitID, x, y, z, team)`. The gadget hands that to its unsynced half with `SendToUnsynced("coilbox_rewind_arrive", ...)`, which is a call and costs no frame, and the unsynced half draws from `gadget:DrawWorld`. `luarules/rewind_player/coilbox_player_arrival.lua` is the effect.

#### What is drawn

A column of light that fades, a ring on the ground that closes on the unit, and 16 dots in the team's colour that fall into it, over 0.9 seconds of the frame timer's clock. The lengths are in the unit's radius, from `Spring.GetUnitRadius`, so a larger unit has a larger effect, and the colour is the team's, from `Spring.GetTeamColor`. The dots are plain squares with a little difference in shade from one to the next. The lengths and the 0.9 seconds are choices of how it looks, made by looking at it in six runs.

It is drawn with `gl.BeginEnd`, `gl.Vertex` and `gl.Color` as quads, with `gl.Blending`, `gl.DepthTest`, `gl.DepthMask` and `gl.Texture(false)` round them. It has no texture, no shader and nothing from the game, and it never touches how a unit is drawn. An effect is a row in lists made once, and a draw allocates nothing.

#### Why the player draws it

The other way would be a particle effect of the engine's, an explosion generator, which the player could start with `Spring.SpawnCEG`. Read in the engine source at commit `212c369b4c`, it cannot be made to work in every game:

- The engine reads every definition from one file, `gamedata/explosions.lua`, and takes the game's own before the engine's (`CExplosionGeneratorHandler::ParseExplosionTables` in `rts/Sim/Projectiles/ExplosionGenerator.cpp`). The engine's file lists `gamedata/explosions/` and `effects/` in every archive, so a file the playback game added there would be read. A game that ships its own `gamedata/explosions.lua` decides what is read. None of Splinter Faction 0.1.89, Balanced Annihilation V15.9.8, Metal Factions v2.58 and THIS does.
- A particle needs a texture, and the textures are the game's. The atlas is built from the game's `gamedata/resources.lua` (`CProjectileDrawer::Init` in `rts/Rendering/Env/Particles/ProjectileDrawer.cpp`), and the engine's base content has no projectile bitmap. A particle whose texture the atlas lacks is not drawn (`CSimpleParticleSystem::Draw`). No name is in every game.

Drawing from a gadget needs the game's gadget handler to pass `DrawWorld` to the unsynced half. Splinter Faction and Balanced Annihilation have handlers of their own and both pass it, as the engine's does, which Metal Factions and THIS use. Each lists the call-ins it knows, and a gadget that defines one is called with nothing to register. A game whose handler does not pass `DrawWorld` gets no effect and no error.

#### A game's own effect

A game's adapter can show the game's own spawn or warp effect in its `unitPlaced` hook ([Hooks](#hooks)). The hook's fifth argument is whether the player is about to show its effect for the unit, and a hook that gives true has shown its own, so the player shows none. The name below stands for one of the game's own explosion generators.

```lua
unitPlaced = function(unitID, unitDefID, t, clock, effect)
	if effect then
		local x, y, z = Spring.GetUnitPosition(unitID)
		Spring.SpawnCEG("mygame_warp_in", x, y, z)
		return true
	end
end,
```

A hook that gives nothing leaves the player's effect, and so does one that raises. The hook is still called for every unit the player makes, whatever `effect` is.

#### What it costs

- Asking is inside the frame's timed work: one `SendToUnsynced` and, in the unsynced half, `Spring.GetUnitRadius` and `Spring.GetTeamColor`. The budget counts it.
- Drawing was timed by a scratch gadget that held 16, 64, 256 and 1,024 effects half way through their lives and timed the module's draw, in three runs in a view of 2560 by 1440 pixels, two in Splinter Faction and one in Balanced Annihilation: 13.4 to 16.0 microseconds for each effect in each drawn frame. 64 effects drew in 0.91 to 0.94 ms, 256 in 3.5 to 3.8 ms and 1,024 in 13.8 to 14.9 ms.
- So there is a cap. No more than 256 effects are alive at once (`Arrival.MOST`), and a unit that arrives past that has none. The cap is a choice of how much of a drawn frame to spend, 3.8 ms at the worst measured. The crowd of 400 had 79 units in view.
- While a seek of the crowd of 400 settled, the engine drew 9 to 10 frames a second with the effect and 8 to 11 without, in three of the runs below.

#### Measured in a window

The engine was `2026.07.01-102-g6e5c5a0` with Splinter Faction, in a window of 1,280 by 720 points, which is 2560 by 1440 pixels, on 14 October 2026. Another agent was building and running engines on the same machine, so the load average is given for each run. The track is the crowd of 400 and the seek is from the first frame to frame 22,791, with the camera over the place most of its units are. The first seek of a run is the first row and later ones follow. A scratch gadget read the player's own measure of each frame's work. "Frames" is the frames that made a unit. "In view by" is when the last unit in view was there, after the seek was sent, and "whole seek" is when the player said it was settled.

| Player | Run, load | Seek | Effect | Frames | Slowest frame | In view by | Whole seek | Slow frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before | 1, 5.6 | first | none | 21 | 28.04 ms | 759 ms | 942 ms | 0 |
| before | 1, 5.6 | later | none | 16 | 19.67 ms | 567 ms | 605 ms | 0 |
| before | 1, 5.6 | later | none | 16 | 22.84 ms | 590 ms | 617 ms | 0 |
| now | 2, 5.2 | first | on | 22 | 39.06 ms | 549 ms | 1,114 ms | 1 |
| now | 2, 5.2 | later | on | 18 | 23.72 ms | 322 ms | 768 ms | 0 |
| now | 2, 5.2 | later | on | 17 | 21.20 ms | 324 ms | 779 ms | 0 |
| now | 2, 5.2 | later | off | 16 | 24.25 ms | 347 ms | 642 ms | 0 |
| now | 2, 5.2 | later | off | 15 | 21.74 ms | 260 ms | 692 ms | 0 |
| now | 3, 17.6 | first | on | 19 | 46.13 ms | 433 ms | 963 ms | 2 |
| now | 3, 17.6 | later | on | 16 | 24.32 ms | 315 ms | 747 ms | 0 |
| now | 3, 17.6 | later | on | 18 | 23.28 ms | 374 ms | 690 ms | 0 |
| now | 3, 17.6 | later | off | 16 | 24.02 ms | 331 ms | 625 ms | 0 |
| now | 3, 17.6 | later | off | 17 | 25.65 ms | 390 ms | 654 ms | 0 |
| now | 4, 4.4 | first | on | 23 | 21.54 ms | 415 ms | 925 ms | 0 |
| now | 4, 4.4 | later | on | 17 | 23.40 ms | 373 ms | 814 ms | 0 |
| now | 4, 4.4 | later | on | 17 | 23.83 ms | 344 ms | 647 ms | 0 |
| now | 4, 4.4 | later | off | 17 | 22.30 ms | 366 ms | 853 ms | 0 |
| now | 4, 4.4 | later | off | 16 | 22.25 ms | 300 ms | 734 ms | 0 |
| now | 6, 3.5 | first | on | 22 | 39.92 ms | 487 ms | 1,028 ms | 3 |
| now | 6, 3.5 | later | on | 18 | 21.16 ms | 358 ms | 714 ms | 0 |
| now | 6, 3.5 | later | on | 17 | 20.52 ms | 404 ms | 731 ms | 0 |
| now | 6, 3.5 | later | off | 16 | 23.94 ms | 377 ms | 715 ms | 0 |
| now | 6, 3.5 | later | off | 16 | 24.38 ms | 341 ms | 615 ms | 0 |

"Off" is the same seek sent between a `drag 1` and a `drag 0`, which asks for no effect. A first seek with the effect off was not run. Run 5 was Balanced Annihilation.

What the table shows and does not:

- A later seek logged no slow frame in any run, with the effect or without, and its slowest frame is the same before and now.
- The first seek of a run logged a slow frame in three of the four runs now, of 36.6 to 46.1 ms, and not in the one run before, whose slowest was 28.0 ms. One run before is not enough to say the first seek was safe before.
- In the two runs that have each frame, the slow frames came late in the seek, after every unit in view had been made. Going by run 4, where the first unit of all 13 definitions was made in the first seven frames, the first units of the definitions were over too. They were frames of 40 and 46 units that took 0.80 to 1.15 ms a unit, where the frames that set the budget had taken 0.36 to 0.41 ms a unit. The sort and the asks for an effect were over by then. Why the last units of a first seek cost twice the first ones in a window is not known. It did not show in a headless engine, where three first seeks before and three now had a slowest frame of 18.4 to 21.9 ms. Issue #4015 is for it.
- A screenshot was taken part way through 13 more seeks, and one of those logged a slow frame of 33.8 ms.

In Balanced Annihilation, in run 5, the same crowd as its own units logged no slow frame and no Lua error, with a slowest frame of 13.4 ms. The engine drew 4 to 7 frames a second there, and the budget was slow to grow: the first seek took 49 frames, 25 of them at two units a frame, and the later ones 21 to 25 frames. Why the budget's message took longer to come back there was not looked into, and issue #4016 is for it. Balanced Annihilation's gadget handler logs `UpdateCallIn: GameFramePost is not implemented`, so the player never hears the end of a simulation frame there (issue #4002).

### What the base game does

A game's adapter ([Game adapters](#game-adapters)) is where a game says what to switch off. For a game with no adapter, and for what an adapter leaves, the player undoes what it can and says what it cannot, each in one line of the log:

- The base game takes an empty team for a beaten one. Splinter Faction's `game_end.lua` and `game_team_com_ends.lua` call `Spring.KillTeam`, and the engine creates nothing on a dead team again. The guard gadget replaces `Spring.KillTeam` and `Spring.GameOver` as its file loads, and logs the first ask of each. It has to load before the gadget it guards against, because `game_end.lua` copies both calls into locals as it loads. Gadget files load in the order the engine's `VFS.DirList` sorts them, and the guard's name starts with `!`, which sorts before every letter, digit and underscore. A gadget whose file sorts before that, or anything outside the gadgets, keeps the real call. A team that dies anyway is logged.
- `Spring.CreateUnit` gives nothing, with no error, for a dead team or one at its unit limit. That is logged once for each team, and the unit is tried again after the next seek and not on every frame.
- A unit or a feature that the track does not have is removed on the next frame. That covers the map's own features, a unit the game spawns and a feature a base game gadget creates, as Splinter Faction's `unit_deathContainerSpawn.lua` does where a unit dies.
- A unit or a feature of the track that something else destroys is made again on the next frame.
- The engine asks before it leaves a wreck, and is refused, because the track has every wreck of the match.
- Nothing takes damage: `UnitPreDamaged` gives every hit no damage and no push. Health that changes anyway is set again on the next frame, and the first time it does the player logs one line saying so. [Nothing heals](#nothing-heals) has the rest: the engine's own healing never gets to heal a unit, and a game's gadget that heals belongs in the game's adapter.
- A nanoframe nobody is building decays, and the engine kills it when its progress or health reaches zero. A unit under construction has both set on every frame, and held above one step of that decay.
- A unit with no health left is killed by the next hit, and the track can have a living unit at none. A finished unit keeps one step of health.
- A unit that dies with its death effect explodes, and that explosion reaches the features round it (`CGameHelper::Explosion` to `CFeature::DoDamage` in `rts/Game/GameHelper.cpp` and `rts/Sim/Features/Feature.cpp`). The engine asks `FeaturePreDamaged` first, and the gadget answers no damage and no push, as it does for units (issue #3987). A tree does not fall and a wreck stays. The explosion's effect and sound do not depend on the damage done, so they still show. [Death explosions](#death-explosions) has what else was checked.

A track's team is the same number in the game, because the start script carries the replay's teams. A team the game does not have as a team of its own is Gaia, read from `Spring.GetGaiaTeamID()`.

Not handled: on an engine before `2025.03.9` a finished unit cannot be turned back into a nanoframe, so the stage destroys it and creates it again as one. That path has only run on the stand-in, since no such engine is installed here.

### Nothing heals

The recording owns health, so no unit's health changes in a playback except when the player sets it. Every way the engine or a game can move a unit's health or build progress with nothing simulated, as read in the engine source at commit `212c369b4c`, and what the player does about each:

| What | In the engine | What the player does |
| --- | --- | --- |
| `autoHeal` and `idleAutoHeal` | `CUnit::SlowUpdate` (`rts/Sim/Units/Unit.cpp`) adds both to a unit whose health is below its maximum. It runs between `GameFrame` and `GameFramePost`, and the engine tells nobody | Stopped. See below |
| Repair by a builder | `CUnit::AddBuildPower` refuses when `health >= maxHealth`. A builder looks for something to repair only while it carries out an order (`CBuilderCAI`), and the player gives a unit no order but on and off | Stopped by the same maximum. An idle builder does not repair on its own |
| A repair pad | No code for one in `rts/Sim`. A game does it in a gadget that sets health | The game's adapter |
| A nanoframe's decay | `CUnit::SlowUpdate` takes progress and health off a unit under construction that nobody is building, and kills it at none | Set again on every frame, held above one step of decay, as before |
| Shields recharging | `CPlasmaRepulser::Update` raises shield power, which is not health. Weapons only update when `CUnit::CanUpdateWeapons` is true, and the player switches them off | Nothing needed. The track holds no shield power either |
| Paralysis wearing off | `paralyzeDamage` falls in `CUnit::SlowUpdate`. Nothing sets it in a playback | Nothing needed |
| A game's gadget that sets health | Splinter Faction's `unit_auto_health_regeneration.lua` and `unit_area_heal_radius.lua`. Neither raises `UnitDamaged` | Splinter Faction's adapter switches both off. Any other is put right in the frame it acts in and logged once |

The engine has no switch for healing on one unit. The numbers are in the unit definition, which Lua reads and cannot change. `restTime` is not reachable from Lua. A stunned unit does not heal, but `SlowUpdate` returns early for it, so it also stops making resources. A depending game cannot change the definitions either: `CGame::Load` runs the one `gamedata/defs.lua` that the top archive has, a game's own is a single file that the playback game would have to replace, and `VFS.Include` from Lua cannot reach the file that one hides.

So the player takes away what the heal acts on. `SlowUpdate` heals only when `health < maxHealth`, so after it has put a wounded unit's health in place, the player gives the unit a maximum equal to that health (`Spring.SetUnitMaxHealth`). The engine then finds nothing to heal, and nothing to repair. `GameFramePost` is the end of the simulation frame, where the player gives every unit its maximum back and looks at its health once more. Health never moves, so a read at any point of any frame finds the track's value. A unit at full health, and a unit under construction, are left alone. If a held unit's health has changed by then, or a gadget of the game raised health before the player's frame, the player sets it again and logs one line starting `COILBOX_REWIND_PLAYER the health of a unit of the track changed with no damage to hear of`. A game that logs it needs its healing gadget in its adapter.

What a viewer can notice: for the part of a frame between the player's `GameFrame` and `GameFramePost`, a wounded unit reports a maximum equal to its health. A gadget of a higher layer than the player's, which is 0, that reads a unit's health in its `GameFrame`, sees it as whole in that frame. Nothing is drawn in that time. A widget reads between frames, when the maximum is whole again.

### Team resources

A playback simulates nothing of the match, so left alone each team's economy is whatever the units the player placed happen to make. The resources stage, `coilbox_player_resources.lua`, makes the engine's own numbers the recorded match's (issue #3982). Nothing is hidden and no panel is changed: a resource bar, another widget and a gadget all ask the engine and all get the match.

What can be set was read from the engine at commit `212c369b4c`, in `rts/Sim/Misc/Team.cpp`, `TeamHandler.cpp` and `rts/Lua/LuaSyncedCtrl.cpp`. `Spring.GetTeamResources` gives nine numbers for a resource.

| Number | How the player makes it the match's | How true |
| --- | --- | --- |
| held | `Spring.SetTeamResource(team, "m", value)` on every frame and in `GameFramePost` | the track's value, as the 32 bit float the engine holds |
| storage | `Spring.SetTeamResource(team, "ms", value)`, the same | exact when the frame is over. Set before what is held, since the engine cuts what is held to the storage |
| share level | `Spring.SetTeamShareLevel`, the same | exact, except for part of one frame in 30 (below) |
| income | `Spring.AddTeamResource` on the frames the engine sums up on | the match's, or the playback's own where that is more |
| expense | `Spring.UseTeamResource` of an amount the team holds | the same |
| pull | `Spring.UseTeamResource` of an amount the team does not hold | the same |
| excess | `Spring.AddTeamResourceExcessStats`, on engines from `2026.07.01` | the match's. The playback's own on an older engine, and the larger of the two on an engine with no `GameFramePost` |
| sent, received | not set | the playback's own, which is nothing |

No call sets income, expense or pull. The engine keeps a running sum of each, and on every frame that divides by 30 (`TEAM_SLOWUPDATE_RATE`) `CTeam::ResetResourceState` makes the sums the numbers it reports and starts them again from nothing. `AddTeamResource` adds to the income sum as well as to what is held, and `UseTeamResource` always adds to the pull sum and adds to the expense sum when the team holds the amount. So on those frames the stage, for each resource of each team:

1. Sets storage to twice what is about to go through it, so that nothing added runs over into excess.
2. Sets what is held to 0 and adds the income that is missing. A team with an income multiplier in the start script has the amount divided by it first, since the engine multiplies what a gadget adds too.
3. Sets what is held to the expense that is missing and uses exactly that, which goes through.
4. Sets what is held to 0 and uses the pull that is missing, which does not go through and counts as a pull only.

Then storage and what is held are set to the track's, as on every frame. All of it happens inside one call of the gadget, so nothing else sees the steps.

"Missing" is the track's number less the playback's own. The playback's own sum for the 30 frames that are running cannot be read, since the engine only gives the sums of the 30 before. The stage reads those when the engine has summed up, takes off what it added itself, and uses the rest as its guess for the next 30. That guess is right while the same units stand in the world. After a seek it is wrong twice: the first sum still has what the units of the frame before the seek made, and the second is guessed from that one. So the numbers settle on the third of the engine's sums after a seek, which is up to three seconds, and can read too high or too low until then. They change once in 30 frames, as they did in the match, and a playback's 30 frames do not start where the match's did, so a number can be one sum behind.

The sums only go up. Where the playback's own economy makes or uses more than the match did, the number reads as the playback's. That happens for a moment after the match's income went up. The engine reports the 30 frames before, so the track's income at frame 10,262 of the Splinter Faction match is 18.4 metal, from before a metal extractor was finished. The extractor stands finished in the playback at that frame, and held there the engine's own income is 28.1.

The same goes for excess, and there the stage can do something. A team that is nearly full wastes what its units make, and the engine counts that as excess, which can be more than the match wasted: 396.7 energy against the track's 174.7 at frame 20,525. So at the start of a frame the stage gives a team room for all the playback makes in 30 frames, on top of the track's storage, and takes it away again in `GameFramePost`. The playback then wastes nothing itself and the excess is the track's. It does this only once the engine has made a `GameFramePost` call, since without one the storage would be drawn with the room in it.

Production cannot be switched off at its source. `CUnit::SlowUpdate` adds a unit's `resourceMake`, takes its upkeep and adds what an extractor, a windmill or a tidal generator makes, all from the unit definition, which Lua reads and cannot change. `Spring.SetUnitResourcing` only reaches the amounts a gadget gave a unit itself. A team's income multiplier comes from the start script, and one of 0 would also stop the stage adding what is missing.

What a team sent and received would take a transfer between two teams for each amount, through `Spring.ShareTeamResource`, which adds to one team's sent sum and the other's received sum. The stage would have to pair each team that sent with one that received. It does not do that yet, and both read as nothing. It is issue #4011. A team's running totals for the end of game statistics (`TeamStatistics`) have no call that sets them.

#### When in a frame

The engine's order in a frame is the gadgets' `GameFrame`, its own units, its teams and then the gadgets' `GameFramePost` (`CGame::SimFrame`). The units make and use resources, and the teams sum up and hand excess to allies, after the stage has set everything. So the stage sets storage, share level, what is held and the rules parameters again in `GameFramePost`, and that is what is drawn.

It does not depend on that call-in, which an engine before `105.1.1-2590` does not make (issue #4002). Without it nothing is put back before the frame is drawn, so what a team holds reads one frame of the playback's own economy off, and never more, since the next frame sets it again. The sums are then read at the start of the next frame, which gives the same numbers.

On a frame the engine sums up on, it also hands what a team holds above its share level to its allies (`CTeam::SlowUpdate`, with the game's `nativeExcessSharing`). The match did that once already. So on those frames the stage sets the share level to 1, where the engine has nothing to hand over, and `GameFramePost` sets it back. Without `GameFramePost` the share level reads 1 until the next frame.

#### Old tracks

A track from before recorder version 4 has no team's resources. The stage is not made for one, the player logs `the track is from recorder version 3, which did not record the teams' resources, so the resource bars show the playback's own economy`, and coilbox takes the track as stale: it refuses to play it and records the replay again.

### Death explosions

What else a unit's death explosion does, read in `CGameHelper::Explosion`:

- It starts no fire. `CFeature::StartFire` has two callers, a weapon projectile's collision with a feature (`fireStarter`) and a fire projectile (`rts/Sim/Projectiles/FireProjectile.cpp`). A death explosion is neither.
- It can crater. The ground is deformed when the weapon's `craterMult` is above 0, and no call-in answers that. The death weapons of the match in this folder's runs, `commnuke_up1`, `commnuke_up2` and `smallexplosiongeneric`, have a `craterMult` of 0, and the driver's `death_ground` lines show the ground round all 4 explosions of the whole match run and all 55 of the fight run within 0.019 elmo of the track's. A game whose death weapon does crater would have it cratered at the frame the unit goes, and the terrain stage puts the track's heights on the corners the track changed.
- A gadget of the game with a higher layer than the player's can overrule the answer, since the handler calls the lowest layer first. In Splinter Faction none did: the driver, which is called first and so sees the engine's own damage, counts the hits it would have done and the damage that was done after all the gadgets.

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

	teamParams = { "supplyUsed", "supplyMax" },
	gameParams = { "wave" },

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
| `teamParams` | list of names | team rules parameters that are the recording's to set, see [Rules parameters](#rules-parameters) |
| `gameParams` | list of names | the same for game rules parameters |
| `hooks` | table of functions | see [Hooks](#hooks) |

The file is run by `coilbox-springlua`, the sandboxed Spring Lua evaluator that reads a game's other config, so the lists can be worked out in Lua. It has no `io`, no `os` and no way to read another file. Coilbox reads everything but `hooks` from it before the engine starts, and the player reads the same file again in the engine, for `units`, `features`, `teamParams`, `gameParams` and `hooks`.

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

### Rules parameters

A game keeps numbers of its own in rules parameters: supply, research points, a score. Neither the recorder nor the player can tell which of a game's parameters a viewer reads, so the adapter names them, as the game spells them. `teamParams` are the ones a gadget sets with `Spring.SetTeamRulesParam` and `gameParams` the ones it sets with `Spring.SetGameRulesParam`. Each list is names with no name twice.

The lists are read in two places.

- Before a recording run, `analysis.rs` in `tauri-plugin-coilbox-content` chooses the game's adapter the way a playback launch does and writes both lists into the recorder's request file, `luarules/configs/coilbox_rewind_request.lua`. The recorder writes each parameter when its value changes, and the track's info chunk has the names (`lua/rewind-recorder/README.md` and the format page).
- In the engine, the resources stage sets each parameter that the track has and the adapter in use names. The track's names are what was recorded, and the adapter's are what the game says may be written over, so it takes both.

The two can differ, since a track outlives the adapter it was recorded with. The player logs one line for each case and plays on:

```
COILBOX_REWIND_PLAYER the track has rules parameters the game's adapter does not name, so they are left to the game: supplyUsed
COILBOX_REWIND_PLAYER the game's adapter names rules parameters the track was recorded without, so they are the playback's own. A new recording of the replay has them: supplyMax
```

Coilbox does not take a track as stale when an adapter gains a name. The track has to be cleared and the replay recorded again.

A parameter is set on every frame and again in `GameFramePost`, so a gadget of the game that writes the same parameter during the frame is written over before anything is drawn. A parameter with no value at the time showing had not been set yet in the match, and the player leaves it as the game has it. `Spring.SetTeamRulesParam` is called with no access argument, which keeps whatever access the game gave the parameter, and gives a parameter the game never made the engine's default of private. A spectator with the full view reads those too.

### Hooks

A hook is an optional function in `hooks`. The player calls these and no others, and logs a name in `hooks` that is not one of them or is not a function, since it is most likely a misspelling. A hook that raises is logged once and not called again, and the player carries on.

| Hook | Called | Arguments |
| --- | --- | --- |
| `started` | once, when the player has opened the track, before the first frame and so before anything of the track is in the world | none |
| `unitPlaced` | after the player created a unit and put it in place, and again for a unit made again after a seek | the engine's unit id, the unit definition's engine id, the track frame, the clock, and whether the player is about to show its arrival effect for the unit. A hook that gives true has shown the game's own effect, and the player shows none ([A game's own effect](#a-games-own-effect)) |
| `afterFrame` | at the end of every simulation frame, after every stage | the track frame, the clock |

The clock is the player's, and a hook only reads it. `clock.jumped` says the frame was reached by a seek or a step, `clock.direction` is 1 or -1 and `clock.speed` is how many frames of the track a simulation frame covers.

A hook runs in synced Lua, in the gadget's environment, and a frame of play allocates nothing in the player, so a hook that is called every frame should not either. These are the only hook points. They are the smallest set that issues #3797 (a build spray effect that reads a builder's recorded work), #3800 (a team's storage, which had to be set before any unit was placed until the track held it, issue #3982), #3801 (a warp in effect for a unit that appears) and #3804 (replacing ghost drawing) are known to need, and a hook point is added by the issue that needs one.

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
| A wounded unit healed while the time stood still | `unit_auto_health_regeneration.lua`, which sets a commander's health once a second. The game turns the engine's own healing off in `alldefs_post.lua` | the gadget is switched off. The player stops the engine's healing for every game ([Nothing heals](#nothing-heals)) |
| A heal station healed the units round it and drew the heal effect on each | `unit_area_heal_radius.lua` | the gadget is switched off |
| A feature of the track was destroyed a moment early | the death explosion of a unit that died while the match was watched | nothing needed. The player's `FeaturePreDamaged` gives it no damage ([Death explosions](#death-explosions)) |

With `game_spawn.lua` off, a team would keep the engine's own storage of 1,000,000 and the resource bars would read 0/1000000. The adapter had a `started` hook that gave each team what that gadget gave it. The track now has each team's storage and the resources stage sets it on every frame, so the hook is gone and the adapter has no hooks.

The adapter names three team rules parameters, `supplyUsed`, `supplyMax` and `researchPoints`. `gui_static_resourcebar.lua` reads all three for its supply and research panels. `unit_supply_requirement.lua` writes the first two on every unit event and `game_researchpoints_ledger.lua` the third in `GameFrame`. Both gadgets stay, because the game's build menu asks them what a team may build, and in a playback they count the units the player has placed. The recording has the last word: the stage sets the three after every unit is in place and again in `GameFramePost`.

What stays, because it tells a viewer about the match: the resource bars, the tooltip with a unit's description, the minimap, the players list, health bars, build progress and its time left, the metal and geothermal spot markers, and the game's own effects, lights and weather. Two things stay for want of a way to take them out (issue #3983):

- The menu at the top right is one widget, `gui_static_menu.lua`, with Settings, Keybinds, Economy, Graph, Log and Quit in it, so it stays whole. Its Resign button sends the engine's `spectator` command, which does nothing for somebody who already is one.
- The build menu and order buttons of a selected unit, `gui_static_buildordermenu.lua`. A spectator's orders go nowhere. Switched off, the engine's own command menu takes its place and `game_buildHotkeys.lua` raises, both seen in a window.

What the kept panels show was not all the recording's until issue #3982. A track held no team resources, so everything on the resource bars was the playback game's own economy, run by the engine on the units the player had placed. The track now has them and the resources stage sets them ([Team resources](#team-resources)). Measured in the same match for team 0: in the real replay, in the playback before the stage, and in the playback now. The first two columns are from the look of issue #3800 and the third from the look of 14 October 2026, paused at the frame, on engine `2026.07.01-102-g6e5c5a0` and Splinter Faction 0.1.89.

| At frame | Number | In the match | In the playback before | In the playback now |
| --- | --- | --- | --- | --- |
| 6,927 | metal storage | 1100 | 1100 | 1100 |
| 6,927 | metal income, expense | +9.1, -7.0 | +9.1, -0 | +9.1, -6.9 |
| 6,927 | metal held | 1028 | 171, and rising for as long as the playback runs | 1028, and it stays |
| 6,927 | energy income, expense | +100, -23.1 | +100, -12.6 | +100, -23.0 |
| 6,927 | supply used | 3 | 2 | 3 |
| 6,927 | research points | 216 | 0 | 216 |
| 12,000 | metal storage | 1700 | 1700 | 1700 |
| 12,000 | metal income, expense | +27.7, -24.6 | +27.7, -0 | +27.7, -24.6 |
| 12,000 | metal held | 87 | 640, and rising | 87, and it stays |
| 12,000 | energy income, expense | +450, -161.9 | +450, -88.2 | +450, -161.9 |
| 12,000 | supply used | 30 | 29 | 30 |
| 12,000 | research points | 86 | 0 | 86 |

The real replay showed a metal expense of 7.0 at frame 6,927 and the track has 6.9114 there, which the playback now shows. Why the two differ by 0.1 was not looked into.

![The resource bars before and after, at frames 6,927 and 12,000](screenshots/resources-before-after.jpg)

The left column is the playback with the track marked as one that has no resources and the adapter as it was, which is the playback before the stage. The right is the same launch with the track as recorded. Both are the engine's own screenshots of a window, cut down to the bars, taken paused seven seconds after the seek.

Three things on screen are still the playback's and not the match's. A commander's name tag reads `CoilboxPlayback`, the one spectator who leads every team, where the match had the player's name (issue #4012). The clock in the players list is the engine's, which starts at nothing whenever the playback is opened. And the game's day and night and its weather follow that clock, so a moment that was dark in the match can be light in the playback (issue #4013). None of the three can be set from the gadget: a player's name comes from the start script, and no Lua call sets the engine's frame number.

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
luajit lua/rewind-player/tests/resources_test.lua
luajit lua/rewind-player/tests/settle_test.lua
luajit lua/rewind-player/tests/view_test.lua
luajit lua/rewind-player/tests/arrival_test.lua
luajit lua/rewind-player/tests/gadget_test.lua
luajit lua/rewind-player/tests/adapter_test.lua
luajit lua/rewind-player/tests/engine_test.lua
luajit lua/rewind-player/tests/timeline_test.lua
```

- `reader_test.lua` reads the fixture and compares every sampled value with what the Rust reader gives. It plays forward, backward and in a fixed shuffle, and checks the errors and the three ways of fetching.
- `format_page_test.lua` builds the format page's worked example by hand and reads it. It checks the reader against the page and not against the Rust crate.
- `playback_test.lua` checks that sampling allocates nothing, that forward play does no search, and that a minute of play (1,800 frames over several windows) does not grow memory.
- `stub_test.lua` checks the engine stand-in against `rts/Lua/LuaVFS.cpp`.
- `fetch_test.lua` reads a string of 38,400,000 bytes and the fixture with every chunk moved past 16,777,216 bytes. It wraps `string.sub` to raise for a position a 32 bit float does not hold.
- `clock_test.lua` checks the clock and every message.
- `rotation_test.lua` checks the pitch, yaw and roll against the engine's own matrix arithmetic, in doubles and with every result rounded to a float.
- `player_test.lua` checks the stages on tracks made from a table (`tests/fake_track.lua`): what is alive at a time, removal before creation, a seek back past a construction, play in both directions, a missing definition, a nil from `Spring.CreateUnit`, terrain forward and back, that the engine's own healing (`world.heal` in the stand-in, run between a frame and its post frame) leaves a wounded unit's health alone and its maximum is whole again afterwards, that health which moved anyway is put right and logged once, and that a frame of play allocates nothing.
- `projectiles_test.lua` checks the projectiles stage: what is in the air at a time, stepping forward and backward, that a seek looks at the shots that can be alive and not the window's list, that a shot lands only while it is watched and with no damage, crater or push, a shell that ends in the air, a bolt that stops, a beam fired once, the fire sound and when it is not played, a weapon the game lacks, an engine with no `Spring.SetProjectileTimeToLive`, a shot the engine ended and an id handed out again, a shot alive across two windows, and that 300 frames of play with 40 shots in the air allocate nothing.
- `resources_test.lua` checks the resources stage on a stand-in whose teams follow `rts/Sim/Misc/Team.cpp` and whose frame runs in the engine's order, with the playback's own economy between the gadget's two call-ins: what a team holds, its storage and its share level at a frame, after a seek forward and backward, held for 400 frames and while playing each way, on an engine with and without `GameFramePost`, income, expense and pull after three of the engine's sums, a team with an income multiplier, excess, allied teams and the engine's own sharing, rules parameters with and without an adapter that names them, a track from recorder version 3, the fixture through the real reader, and that 300 frames allocate nothing.
- `settle_test.lua` checks a seek that needs more units than a frame may make or remove: that it settles over several frames, that removals use their own budget and come first, that a second seek while one settles starts again, that play goes on while it settles and units made late stand where the track has them now, what `coilbox_rewind_settled` says and when, the budget message and the ones it refuses, that a shot waits for its shooter, and that 300 frames of play with a budget allocate nothing.
- `view_test.lua` checks the order a seek makes its units in: the list's with no view, nearest the camera's place first with one, inside the view's corners before outside, the rest following a camera that moves, the list's again after `coilbox_rewind_view:none`, removals still first, a unit born while a seek settles, the view messages it refuses, and that 300 frames of play with a view allocate nothing.
- `arrival_test.lua` checks which units the player asks an arrival effect for: each one a slow seek makes after its first frame, none for a seek shown in one frame, a removal or plain play, none during a drag until it ends, none outside the view, and none when the adapter's hook says it showed its own. Then the two unsynced modules on a stand-in (`tests/unsynced.lua`): the view's message, when it is sent again, a corner off the map and one in the sky, and what the effect draws, where, in which colour, for how long, how many at once, the state it leaves and that a draw allocates nothing. It does not show how the effect looks.
- `gadget_test.lua` loads the two gadgets the way the engine does. That includes the gadget's answers of no damage for units and for features, its post frame, and the unsynced half's working out of the two budgets from the time a frame's work took.
- `adapter_test.lua` checks how the player reads an adapter, that it never creates a hidden unit or skipped feature and says nothing about either, that each hook is called with the right arguments and a hook that raises is switched off, the log line, and that 60 frames of play with hooks allocate nothing.
- `engine_test.lua` is made from the engine table ([Engine calls](#engine-calls)). For every call of every row it takes the call out of the stand-in and plays the fixture track, and it checks the table against the source with `tests/scan.lua`. The widget's table is tested the same way in `timeline_test.lua`.
- `timeline_test.lua` checks the timeline on a stand-in for `Spring` and `gl`: the message for every key, that a key with Ctrl, Alt or Meta is left alone, the frame a drag seeks to at both ends and between, the time and speed shown, that everything drawn is inside views from 640 by 480 to 3840 by 2160, moving the panel, changing a key, marks, and that 300 draws allocate nothing. It also loads the widget file the way a handler does.

`tests/support.lua` is the stand-in for the reader. Its `VFS.Unpack*` and `VFS.ZlibDecompress` follow the engine source, round what they return to a 32 bit float, and raise for a position or count a float could not hold. The zlib is the system's, through LuaJIT's FFI. Its synced environment has no `io`, so a reader that reached for it would fail the tests.

`tests/engine.lua` is the stand-in for the player: units, features, projectiles, the heightmap, teams and their resources, and rules parameters, each call written from the engine source it names. `world.step(frame, post)` runs one frame in the engine's order: the gadget's `GameFrame`, the engine's own economy as the test gives it in `world.economy`, the teams' sums on a frame that divides by 30, and the gadget's `GameFramePost`. `world.simulate()` is the engine's own frame for projectiles: it looks for a hit along a projectile's speed and under the ground, whether or not the projectile is under move control, and then counts its time to live down.

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

- With no adapter the gadgets the adapter names load, a commander is spawned that the track does not have and a team is asked to be killed.
- With the adapter none of them loads, nothing is spawned, no team is asked for, the match is not asked to end, no team is dead and the engine does not hold the match to be over.
- At both ends of play, at the ten seeks, past the death and after the wounded unit was held, the engine has the track's units and features, each unit where and how the track has it.
- No Lua raised once the match was running, apart from `cus_gl4.lua`, the game's unit shader gadget. It calls `gl.SetUnitBufferUniforms` for every unit created, which a headless engine does not have, so it raised 664 times in a run. In an engine with a window it did not raise once.
- With the player as it was before this test, the wounded unit, at 8.5% of its health, was 4.3% of its maximum higher after the 450 frames.

Issues #3986 and #3987 added to this test and ran it again on Splinter Faction 0.1.89 standing in for the game, with the two gadgets of the adapter that heal now named in it. A second test gadget, `tests/headless/health_probe.lua`, has layer -50. It reads the held unit's health at the start of every `GameFrame`, which is after Splinter Faction's regeneration gadget (layer -100) and before the player's correction, and at the start of every `GameFramePost`, where the engine's own healing of that frame would show. It also reads the unit's maximum at each `GameFrame`. Over the 450 frames, for the unit at 1309.088 health:

| Player and adapter | Health changed at a `GameFrame` start | Changed at a `GameFramePost` start | Maximum not whole | The player's line |
| --- | --- | --- | --- | --- |
| Before, with the adapter as it was | 12 frames, 60 each, by the regeneration gadget | 0 | not read | none, the player put it back silently |
| Now, no adapter | 11 frames, 60 each, by the regeneration gadget | 0 | 0 | once |
| Now, with the adapter | 0 | 0 | 0 | none |

Splinter Faction turns the engine's own healing off, so none of those rows has the engine healing a unit. The test `the_engine_does_not_heal_a_wounded_unit` runs the same hold with no adapter on a scratch game on top of Splinter Faction 0.1.89 whose `Gamedata/alldefs_post.lua` is the game's with `autoheal` and `idleautoheal` at 20 (the unit definition then reads 10 for each) and whose two healing gadgets are files that return `false`. With the player as it was, the engine raised the unit's health by 20 on 30 of the 450 frames, seen at both readings, and the player put it back on the next frame. Now the engine raises it on none, the maximum is whole at the start of every frame, and the player logs nothing.

For a unit's death, the driver counts the hits a death's explosion makes on features before any gadget is asked and the damage that is done after all of them. In the whole match, the death at frame 9,514 reached 7 features. Before the gadget answered `FeaturePreDamaged`, all 7 were damaged, and 0 are now. The explosions the driver counts went from 0 to 2 across the death, so the effect still shows. In the fight of the shots test, a death reached 2 features in each pass at 1x, 0.5x and 2x and damaged none, and the line about a destroyed feature was not logged. The mean frame of work was 0.337 ms before and after in the whole match, with the slowest 29 ms before and 27 ms after.

A fifth test, `the_shots_of_a_whole_match_follow_the_track`, wants the same replay and runs the driver's shots plan on it with the shipped adapter (issue #3795). On the match above, whose shots are 195 rockets and 83 laser bolts fired between frames 20,256 and 23,048:

- Paused on frame 22,819, the frame with the most in the air, the engine has the track's 7 shots, and still has them after 150 frames. At 20 seeks to frames with shots in the air it has as many as the track each time. Every shot is where the track has it, to four decimal places of an elmo, or held short as [Held](#held) says, and points the way the track has it going.
- Nothing lands while paused or during the seeks.
- Played backward from the frame it landed on, a rocket is nearer where it was fired on each of 58 frames in a row.
- Played forward through the fight, all 278 shots land at 1x and at 0.5x, a mean of 0.09 elmo from the last frame of flight the track has for them, and 277 at 2x. At 4x and played backward none lands.
- No shot did damage to a unit or a feature, by the engine's own sum before any gadget was asked, and none left a crater. After each pass every unit has the track's health.
- The engine ended no shot the player was holding, no slow frame was logged, no team died and no Lua raised.

The first runs of the plan did not show that, and what they showed is why a shot is held short of where it ends, why a unit keeps a step of health and why a bolt lands on a whole frame.

A sixth test, `the_teams_resources_are_the_matchs_in_the_engine`, wants the same replay and runs the driver's resources plan (issue #3982). `COILBOX_PLAYBACK_RESOURCE_FRAMES` gives it frames to look at, as numbers with commas between them, and it adds eight more across the match. The driver's gadget runs before the player's on a frame, so what it reads is what the frame before left, which is what a widget draws. It launches the playback twice: with the track marked as recorder version 3, which the player takes as a track with no resources, and with the track as recorded. On the match above, at frames 6,927 and 12,000 and the eight others, for all three teams:

| | Track marked as version 3 | Track as recorded |
| --- | --- | --- |
| What a team holds and can store, furthest from the track at the 10 frames | 999,000, the engine's own storage | 0 |
| The same at 9 seeks backward | 999,000 | 0 |
| The same over 600 frames held paused at frame 10,262 | 999,000 | 0 |
| The same over 300 frames played forward and 300 backward at 1x | 999,000 | 0 |
| Lines, of 60 for a resource of a team at a frame, with income, expense, pull or excess not the track's | not counted | 1 |
| Supply used, supply available and research points, where the match had set them | supply 2 and research 0 at frame 6,927, where the track has 3 and 216 | the track's every time |

0 means equal to the track's value as the 32 bit float the engine holds, with what is held cut to the storage. The one line is team 0's energy income at frame 5,131: 75 where the track has 62.5, and the playback's own is 75 with the stage off. After the 600 frames at frame 10,262 team 0's metal income was 28.1 where the track has 18.4, which [Team resources](#team-resources) explains. No team died and no Lua raised. The player's work took a mean of 0.220 ms a frame in that run.

The first run of the plan waited two of the engine's sums after a seek and had 7 lines of 60 that were not the track's. One had an income of 112.5 at frame 6,927 where the track has 100, and was right a sum later, which is why the numbers are said to settle on the third sum. All 7 had more excess than the track, up to 396.7 where it has 174.7, which is why a team is given room for the playback's own income during a frame.

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

The order a seek makes its units in and the arrival effect were looked at on 14 October 2026, in six runs with a window: one of the player as it was, four on Splinter Faction and one on Balanced Annihilation V15.9.8, each with a scratch gadget that pointed the camera, seeked, read the engine once a frame and took the engine's own screenshots part way through a seek. [Which units first](#which-units-first) and [The arrival effect](#the-arrival-effect) have the pictures and the figures. In the first two of those runs the camera moved by itself, because the pointer was at the edge of the window. A run that needs the camera to stay sets `WindowedEdgeMove = 0` in its settings file.

The timeline has been looked at, once, by hand, on 13 October 2026: the same playback game opened in the engine with a window, in Splinter Faction 0.1.89 and in Metal Factions v2.58, with a scratch widget pressing the timeline's keys and taking the engine's own screenshots. The two pictures on this page are from those runs. The marks on the bar were not in them, since nothing writes a marks file yet. To do it again, set `COILBOX_PLAYBACK_KEEP_GAME` to a folder when running the timeline's test, which copies the playback game and its script there, and launch `spring` on the script. A settings file Splinter Faction has not seen makes its Initial Settings widget reload the engine, which took this engine down, so give the run a settings file with `SFInitialSettingsVersion = 1` in it.

### The fixture

`tests/fixtures/small.cbtrack` is a track `crates/coilbox-track` wrote from a seed, and `tests/fixtures/expected.lua` holds what the Rust reader gives for 30 of its frames. The Rust test `crates/coilbox-track/tests/lua_fixture.rs` fails when either file stops matching what the Rust crate writes and reads. After a change to the writer or the reader, rewrite both:

```sh
COILBOX_UPDATE_LUA_FIXTURE=1 cargo test -p coilbox-track --test lua_fixture
```
