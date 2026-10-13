# Replay rewind for your game

Replay rewind plays a recorded match back in the engine with time going in either direction. It works for any game without anything from you. This page is for a game maker who wants playback to look right for their game. That takes one small Lua file, an adapter, which you bundle in your game archive.

For what a player sees and does, see [Replay rewind](../players/replay-rewind.md). For the file format of a recording, see the [replay track format](../reference/replay-track-format.md).

## How a playback is built

Coilbox records a replay by playing it once in the engine without a window. A gadget writes down where units, features and projectiles are as the match plays, and the result is a track. Playback never simulates the match again.

To play a track, coilbox writes a game called Coilbox replay playback. It depends on your game and does not change it. It holds the rewind player's Lua, the track and the adapter in use. The start script has one spectator and no players or AIs. The spectator leads every team, which the engine allows and which lets a gadget create units on any team. Team numbers are the replay's own.

The player holds a time, which is a frame of the track, and on every simulation frame it makes the world match the track at that time. It creates, moves and destroys units, features and projectiles, and it sets the terrain. Because it simulates nothing, the time can jump and run backward. The timeline is a widget that sends the player messages.

Weapons never fire in a playback. The player creates each shot of the track itself.

## What an adapter is

Your game has gadgets and widgets that are right for a match and wrong for a recording. One ends the game when a team has no units. One creates a commander at the start. One offers a menu for gifting units. The player cannot know which of yours do that, so the adapter says.

Without an adapter nothing is switched off and nothing is hidden. The match still plays. The player still undoes what it can, and the log says what it could not. [What the player does without an adapter](#what-the-player-does-without-an-adapter) lists it.

## The format

An adapter is a Lua file that returns a table. This is Splinter Faction's, which is the real one coilbox ships, in full:

```lua
-- Splinter Faction's playback adapter (issue #3800).
--
-- What is listed here is what fights a recording or offers a spectator of one
-- something to do that means nothing. Everything that tells a viewer about the
-- match stays: the resource bars, the tooltip and its unit descriptions, the
-- minimap, the players list, the menu, health bars and the game's own effects.
-- The menu keeps its Resign and Sharing buttons, because it is one widget with
-- Settings and Quit in it. Neither does anything for a spectator.
--
-- gui_static_buildordermenu.lua stays too, though it shows a spectator the
-- build and order buttons of a selected unit. It is what hides the engine's own
-- command menu, which takes its place when it is gone, and
-- game_buildHotkeys.lua raises without it.
--
-- The file names were read from the archives of 0.1.88 and 0.1.89 and from the
-- game's repository at the commit of 24 August 2026, which declares no version.
-- All three have every file below, so there is no version range. A range would
-- also leave a game folder under development, which declares `$VERSION`, with
-- no adapter at all.
--
-- lua/rewind-player/README.md has what each of these did to a playback.

return {
	name = "Splinter Faction",
	shortname = "SF",

	gadgets = {
		-- Kills a team that has no units, which every team is before its first
		-- unit and after its last.
		"game_end.lua",
		-- Kills a team that has no commander, on the same grounds.
		"game_team_com_ends.lua",
		-- Runs the start of a match: it waits for a faction and a start position
		-- from each team, picks both itself when nobody answers, and creates a
		-- commander for each team at frame 181. The track has the match's own.
		"game_spawn.lua",
		-- Leaves a container where a unit dies, picked at random. It hears of a
		-- unit a seek removes as well, and the track has the containers the
		-- match left.
		"unit_deathContainerSpawn.lua",
		-- The track owns health, and these two raise it. The first sets a
		-- commander's health once a second after it has gone without damage, the
		-- second heals the allied units around a heal station and draws the heal
		-- effect on each. Neither tells anybody, and nothing a viewer reads depends
		-- on them. The game turns the engine's own healing off in
		-- alldefs_post.lua, so these are all there is.
		"unit_auto_health_regeneration.lua",
		"unit_area_heal_radius.lua",
	},

	widgets = {
		-- The faction picker and the start position picker of a match's first
		-- seconds, with their ready buttons.
		"gui_static_factionchooser.lua",
		"gui_static_placement.lua",
		-- Gives units and resources to another team.
		"gui_static_sharemenu.lua",
		-- A strip of buttons for the selection at the bottom centre of the view,
		-- which is where the timeline is, so the two draw over each other.
		"gui_static_selected_units_buttons.lua",
	},

	hooks = {
		-- game_spawn.lua also gave each team its storage at the start of a match,
		-- the `startmetal` and `startenergy` of the team or of the mod options,
		-- and 1000 of each when neither says. Without it a team keeps the
		-- engine's own 1,000,000 and the resource bars read 0/1000000. The
		-- storage a team's buildings add comes from the units the player places,
		-- so this has to be in before any of them is.
		started = function()
			local options = Spring.GetModOptions()
			local gaia = Spring.GetGaiaTeamID()
			for _, team in ipairs(Spring.GetTeamList()) do
				if team ~= gaia then
					local keys = select(8, Spring.GetTeamInfo(team)) or {}
					local metal = tonumber(keys.startmetal or options.startmetal) or 1000
					local energy = tonumber(keys.startenergy or options.startenergy) or 1000
					-- As the game does, a 0 leaves the engine's own.
					if metal ~= 0 then
						Spring.SetTeamResource(team, "ms", metal)
					end
					if energy ~= 0 then
						Spring.SetTeamResource(team, "es", energy)
					end
				end
			end
		end,
	},
}
```

Every key is optional. A key that is not in this table is refused, so a misspelling cannot quietly switch nothing off.

| Key | Value | Does |
| --- | --- | --- |
| `name` | text | The name the log line shows. `unnamed` without it. |
| `shortname` | text | The game's `shortname` from its `modinfo.lua`, compared without regard to case. Coilbox uses it to match an adapter it ships to a game. It is required in a shipped adapter and ignored in one in your own archive. |
| `versions` | `{ min = "...", max = "..." }` | The versions a shipped adapter is for, both ends included and either end optional. Without it every version matches. Ignored in your own archive. |
| `gadgets` | list of file names | Gadgets to switch off, as paths inside `luarules/gadgets/`, such as `game_end.lua` or `sub/folder/other.lua`. |
| `widgets` | list of file names | Widgets to switch off, as paths inside `luaui/widgets/`. |
| `units` | list of names | Unit definitions the player never creates. |
| `features` | list of names | Feature definitions the player never creates. |
| `hooks` | table of functions | Three optional functions, described under [Hooks](#hooks). |

Coilbox runs the file in `coilbox-springlua`, the sandboxed Spring Lua evaluator it uses for a game's other config. The file has no `io`, no `os` and no way to read another file, but it can compute its lists in Lua. Coilbox reads everything except `hooks` before the engine starts. The player reads the file again in the engine, for `units`, `features` and `hooks`.

### What switching off does

For each name in `gadgets` and `widgets`, coilbox writes a file at that path in the playback game, `luarules/gadgets/<name>` or `luaui/widgets/<name>`. The engine gives a depending game's file precedence over the same path in the game it depends on, and file names are not case sensitive, so your file is never read. The file is a comment and `return false`.

This relies on your gadget and widget handlers treating a file that returns `false` as one that asked not to be loaded. The engine's own handlers do. So do Splinter Faction's, and the widget handler of THIS. Beyond All Reason's handlers have not been read or run for this. An empty file is not a substitute. Splinter Faction's gadget handler loads an empty file as a gadget with nothing in it and still lists it, and its widget handler refuses it with `Failed to load: <file>  (no GetInfo() call)`.

Coilbox does not write over one of its own files and refuses an adapter that names one.

### Hiding units and features

The player never creates a unit of a definition in `units` or a feature of one in `features`. Names are compared without regard to case. The track still holds them, so a seek has no effect on them. A name that is not in the track is harmless, and a name your game does not have gets no log line, since leaving them out is the point.

Use this for a definition the track holds that you do not want to show. It is separate from `gadgets`, which stops the code that creates things. Splinter Faction's adapter hides none.

### Hooks

A hook is an optional function in `hooks`. The player calls these three and no others. It logs a name in `hooks` that is not one of them, or is not a function, since it is most likely a misspelling. A hook that raises is logged once and not called again, and the player carries on.

| Hook | Called | Arguments |
| --- | --- | --- |
| `started` | Once, when the player has opened the track, before the first frame and so before anything of the track is in the world. | None. |
| `unitPlaced` | After the player created a unit and put it in place, and again for a unit made again after a seek. A seek that needs many units made spreads them over several frames, so this can come some frames after the seek. | The engine's unit id, the unit definition's engine id, the track frame and the clock. |
| `afterFrame` | At the end of every simulation frame, after every stage. | The track frame and the clock. |

The clock is the player's, and a hook only reads it. `clock.jumped` says the frame was reached by a seek or a step. `clock.direction` is 1 or -1. `clock.speed` is how many frames of the track one simulation frame covers.

A hook runs in synced Lua, in the gadget's environment. A frame of play allocates nothing in the player, so a hook that runs every frame should not allocate either.

Splinter Faction's `started` hook is the example. Its `game_spawn.lua` gave each team its storage at the start of a match. With that gadget switched off, a team keeps the engine's own 1,000,000 and the resource bars read 0/1000000. The hook gives each team what the gadget gave it, and it runs before any unit is placed because a team's buildings add storage.

## Where an adapter lives

Put your adapter at `coilbox_rewind/adapter.lua` in your game's primary archive. Coilbox reads it through unitsync from the archive of the version being played, and not from archives your game depends on.

Your own adapter wins. It applies whatever its `shortname` and `versions` say, because it is in the archive of the version being played. If it cannot be used, because it does not run or has a key that is not in the table, the launch carries on with an adapter coilbox ships for your game if one matches, and with none otherwise. The player's log line says why.

Coilbox also ships adapters, in `lua/rewind-player/adapters/` in the coilbox repository. A file there is picked up by the next build, and it matches a game by `shortname` and `versions`. Of those, the first in file name order that matches wins, so give two adapters for one game ranges that do not overlap.

Whichever adapter is chosen, the playback game holds it at `coilbox_rewind/adapter.lua`, written on every launch. When no adapter applies, that file returns `false`, so a file at that path in your base game never reaches the player.

### How a shipped adapter is matched

A shipped adapter matches a game when its `shortname` equals the game's, without regard to case, and the game's version is inside `versions`.

A version is the numbers it starts with. Coilbox skips whatever comes before the first digit, reads numbers joined by single dots and stops at anything else. It compares numbers one at a time, and a missing number counts as 0.

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

## What to switch off

Keep what tells a viewer about the match. Switch off only what fights the recording, what offers an action that makes no sense in playback, and what covers the timeline.

Keep the resource bars, the tooltip with a unit's description, the minimap, the players list, health bars and build progress. Splinter Faction's adapter keeps all of these, along with the game's own effects, lights and weather.

Switch off a gadget that fights the recording. These are the kinds Splinter Faction had:

- A gadget that kills a team or ends the game, because the track already has the match's own end. An empty team looks beaten to it.
- A gadget that creates units or features the track does not have, such as a start of match spawn or a container left where a unit dies.
- A gadget that changes health, because the recording owns health. See [healing](#healing).

Switch off a widget that offers an action that makes no sense in playback. A faction picker, a start position picker and a menu that gives units to another team are of this kind. A spectator can do none of them.

Switch off a widget that covers the timeline. The timeline sits at the bottom centre of the view and a player can drag it. Splinter Faction's strip of buttons for the selection was at the bottom centre too, so the two drew over each other.

Two things stay in Splinter Faction because there is no way to take them out cleanly, and issue #3983 is about it.

- The menu at the top right is one widget with Settings, Keybinds, Economy, Graph, Log and Quit in it, so it stays whole. Its Resign button sends the engine's `spectator` command, which does nothing for somebody who already is one.
- The build menu and order buttons of a selected unit stay. A spectator's orders go nowhere. Switched off, the engine's own command menu takes its place and a gadget that depends on the widget raises. Both were seen in a window.

## Finding what to switch off

1. Play a recorded match with no adapter. Open the replay with "Watch with rewind" in coilbox, with no adapter of your own in the archive.
2. Open the engine's `infolog.txt` and read the lines that start `COILBOX_REWIND_PLAYER`. Each says something the base game did that the track does not have. [The log](#the-log) lists them.
3. Find the gadgets the engine loaded, in lines that read `Loaded SYNCED gadget:  <name>  <file>.lua`. Read the ones that end a game, spawn units or kill teams.
4. Look at the screen. Note any widget that offers something a spectator cannot do, and any that draws at the bottom centre.
5. Put the file names in `gadgets` and `widgets`, and the definitions in `units` and `features`.
6. Bundle the file at `coilbox_rewind/adapter.lua` in your archive and run the match again. The log should say `adapter loaded:` and your game's name, and the lines you were reading should be gone.

A gadget that an adapter switches off is not in the engine's `Loaded SYNCED gadget:` lines, and a log line that came from it does not appear.

If you add an adapter to coilbox's own set instead, the steps and the tests that check a shipped adapter are in [`lua/rewind-player/README.md`](https://github.com/tomjn/coilbox/blob/main/lua/rewind-player/README.md), under "Writing one for a game".

### The log

The player logs which adapter it has, once, when it starts.

```
COILBOX_REWIND_PLAYER adapter loaded: Splinter Faction. 2 gadgets and 1 widgets are switched off by the playback game, 1 unit definitions are hidden, 1 feature definitions are skipped, hooks: afterFrame, unitPlaced
COILBOX_REWIND_PLAYER adapter loaded: none
COILBOX_REWIND_PLAYER adapter loaded: none. the game's own adapter could not be used: the adapter is not in the format: unknown field `gadget`, expected one of ...
```

The first line is an example of an adapter that switches off 2 gadgets and 1 widget and hides 1 unit definition and 1 feature definition, with two hooks. The counts come from your adapter. The second line is a game with no adapter. The third is what a misspelt key looks like.

Other lines you may see.

- `COILBOX_REWIND_PLAYER failed:` means there is no track or a bad one, and nothing plays.
- `COILBOX_REWIND_PLAYER this engine has no Spring.SetHeightMapFunc. Switched off: ground changes. ...` names a call the engine lacks and the one feature it switches off. The rest plays. A line that starts `COILBOX_REWIND_PLAYER cannot play:` means a call that cannot be done without, and nothing plays.
- `COILBOX_REWIND_PLAYER the message "..." was refused:` and a reason is a message to the player it did not accept.
- `COILBOX_REWIND_PLAYER the health of a unit of the track changed with no damage to hear of` means a gadget of your game raised a unit's health. Put that gadget in your adapter.
- `COILBOX_REWIND_PLAYER slow frame:` means a frame's work took longer than a simulation frame lasts.
- The player logs once by name a weapon your game does not have and a unit or feature definition it cannot find, and leaves them out.
- Creating a unit for a dead team, or for one at its unit limit, gives nothing and no error. The player logs it once for each team and tries the unit again after the next seek.
- The guard that stops the base game killing a team or ending the match logs the first ask of each, and a team that dies anyway.

## What the player does without an adapter

These stay in place whatever an adapter says. An adapter makes them unnecessary for your game, and they are the safety net for a game with none.

- The base game takes an empty team for a beaten one and calls `Spring.KillTeam`, and the engine creates nothing on a dead team again. A guard gadget, `!coilbox_rewind_guard.lua`, replaces `Spring.KillTeam` and `Spring.GameOver` as its file loads. The `!` makes its name sort before every letter, digit and underscore, so it loads before your gadgets. A gadget whose file sorts before that, or anything outside the gadgets, keeps the real call.
- A unit or a feature that the track does not have is removed on the next frame. That covers the map's own features, a unit the game spawns and a feature a base game gadget creates.
- A unit or a feature of the track that something else destroys is made again on the next frame.
- The engine asks before it leaves a wreck, and is refused, because the track has every wreck of the match.
- Nothing takes damage. Every hit does no damage and no push. Health that changes anyway is set again on the next frame.
- A unit that dies with its death effect explodes, and the explosion reaches the features around it. The player gives that no damage, so a tree does not fall and a wreck stays. The explosion's effect and sound still show.

### Healing

No unit's health changes in a playback except when the player sets it. The player stops the engine's own healing for every game. It does this by giving a wounded unit a maximum equal to its health during the frame, so the engine finds nothing to heal and nothing to repair.

A gadget of your game that sets health is not stopped this way. The player puts the health right in the frame it acts in and logs one line, and you should put the gadget in your adapter. Splinter Faction's two are `unit_auto_health_regeneration.lua` and `unit_area_heal_radius.lua`. A repair pad done in a gadget is the same kind of thing.

A gadget of a higher layer than the player's that reads a unit's health in its `GameFrame` sees a wounded unit as whole in that frame. Nothing is drawn in that time.

### Gadgets that react to a shot

The game's gadgets hear of the player's shots as they would of a match's. In Splinter Faction's match, whose two weapons are a rocket and a laser bolt, none raised and none changed what the track has. Splinter Faction has more gadgets that act on a shot. Some create projectiles or a unit where a shot lands, one can destroy a unit and one leaves an area that damages. The match does not fire their weapons, so what they do to a playback has been read and not seen, and the adapter switches none of them off. This is issue #3989. Check your own gadgets that react to a projectile or an explosion.

## What is recorded

A recording is made in one headless run of the replay, by a recorder gadget with no synced code. It cannot change the match.

Recorded:

- Every unit, sampled every third frame and on the first frame recorded. A sample has its position, facing, health, build progress and whether it is on or off. Creation, destruction and a change of team are recorded too.
- Weapon targets, and what each builder is working on.
- The queue of buildings of each mobile builder. A factory's production queue is not recorded.
- Piece poses. The pieces watched are each weapon's muzzle piece and every parent up to the root.
- Every feature, and every projectile on every frame.
- Terrain changes.

Positions in the track are within half an elmo of the sampled ones. That is the track's tolerance.

Not recorded, or not exact:

- Team resources. The track holds none, so the resource bars show the playback's own economy. That is issue #3982.
- Shield power. The track holds none.
- Which piece a unit script named as a weapon's muzzle. The engine does not tell Lua. The recorder takes the piece nearest the muzzle's place, and the deeper one in the tree when two sit on the same spot.
- A script's turn on a model of any type other than `3do` or `s3o`. The engine gives an Assimp or glTF piece a rest rotation that Lua cannot read, so a reader cannot tell a script's turn from the model's own.
- Chat and players leaving. They are in the replay file and not in a track.
- Terrain changes that the engine does not report. The engine does not report every change, and the recorder reads the whole map on the first frame, every 900th frame and at the end. A change it never reported reaches the track up to 900 frames late.
- The exact first and last frame of a unit, in a game where another gadget raises an error in `UnitCreated`. The recorder is then not told, and finds units by sampling. A unit can be up to 2 frames late, and one that lived less than 3 frames between two samples is missed.

The recording is kept only if the playback matches the recorded match exactly, which is who won, how long it lasted and every team's final totals. A game whose engine or version differs from the replay's often fails this.

### Units with COB scripts

Today the player does not pose or animate any unit, whatever its script. That covers walking, building and aiming, and a turret or torso does not turn to face its target after a seek. Issues #3796 and #3797 are about it.

A spike on posing, issue #3791, ran the same engine calls on a COB unit and on a Lua unit and found no difference between them for posing a piece. There is no COB specific step to document.

A unit's own script still runs when the unit is created. Splinter Faction's commander stages work because of it. A stage is a unit definition of its own, with a script that hides the pieces the stage does not have. A morph destroys one unit and creates another, so the track has two units and the player creates each by its definition.

## Engines

The replay is played on the engine it was recorded on, and that can be old. Every engine call the player uses is in one table. If a call is missing, the player switches off the one feature that depends on it, logs a line and carries on, unless the call is one the player cannot work without. Then it stops and logs why. A note panel above the timeline says what is switched off, if a viewer would notice.

The oldest engine tag read for any call is 105.0. No engine before 2025.03.9 has been run for this. Older paths are tested with a stand-in for the engine, which shows the logic and the log lines and not what an old engine does with the calls that are left.

## Licence

The rewind Lua and its adapters are offered under the MIT licence or the GNU General Public License version 2 or any later version, at your choice. Each file names this in its `license` field, and the notice is in `lua/LICENSE.md` in the coilbox repository.

The playback game is written again on every launch and stays on your machine, so it carries no notice. A game you install the mission runtime into gets a `coilbox-licence/` folder with the notice and both licence texts.
