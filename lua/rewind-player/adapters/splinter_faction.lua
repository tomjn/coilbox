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

	-- The numbers on the game's resource bar that are the game's own and not the
	-- engine's (issue #3982). gui_static_resourcebar.lua reads all three as team
	-- rules parameters. unit_supply_requirement.lua writes the supply a team
	-- uses and has, and game_researchpoints_ledger.lua its research points. Both
	-- gadgets stay, since the game's build menu asks them what a team may
	-- build. In a playback they count the units the player has placed, which is
	-- not what the match had, so the recording has the last word on every frame.
	--
	-- Metal and energy need nothing here. The track has each team's own, storage
	-- included, and the player sets them whatever the game.
	teamParams = { "supplyUsed", "supplyMax", "researchPoints" },
}
