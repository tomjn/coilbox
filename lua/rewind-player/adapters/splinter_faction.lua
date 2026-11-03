-- Splinter Faction's playback adapter (issue #3800).
--
-- What is listed here is what fights a recording or offers a spectator of one
-- something to do that means nothing. Everything that tells a viewer about the
-- match stays: the resource bars, the tooltip and its unit descriptions, the
-- minimap, the players list, the menu, health bars and the game's own effects.
-- The menu stays, because it is one widget with Settings and Quit in it. It
-- hides its Resign button from a spectator, and its Sharing button once the
-- share menu is gone.
--
-- The build menu stays too, though it shows a spectator the build and order
-- buttons of a selected unit. It is what hides the engine's own command menu,
-- which takes its place when it is gone.
--
-- The game rebuilds its interface under new file names, and moves a widget it
-- has stopped using to LuaUI/Widgets/disabled/, where its handler does not look.
-- So each widget below is named once for each set of names a release has used:
-- gui_static_ up to 0.1.89, gui_rml_ in 0.1.93 and gui_bastion_ in 0.1.95 and
-- 0.1.96. A name a release does not have costs nothing: it is one more file that
-- returns false, and its handler treats that as a widget that asked not to load.
-- So there is no version range, which would also leave a game folder under
-- development, which declares `$VERSION`, with no adapter at all.
--
-- When a new release arrives, run the ignored test that checks this list against
-- the installed archives, splinter_factions_adapter_names_what_each_release_loads.
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
		"gui_rml_factionchooser.lua",
		"gui_bastion_factionchooser.lua",
		"gui_static_placement.lua",
		"gui_rml_placement.lua",
		"gui_bastion_placement.lua",
		-- Gives units and resources to another team.
		"gui_static_sharemenu.lua",
		"gui_rml_share.lua",
		"gui_bastion_share.lua",
		-- A strip for the selection at the bottom centre of the view, which is
		-- where the timeline is, so the two draw over each other.
		"gui_static_selected_units_buttons.lua",
		"gui_rml_selection.lua",
		"gui_bastion_selection.lua",
		-- Writes the time left over a unit under construction, worked out from
		-- how fast its build progress moved between the frames it watched. A
		-- playback simulates nothing: its build progress moves as the track
		-- has it, at the speed of play and backward too, and stands still while
		-- paused, so the time is not the match's, and paused it reads ???.
		"gui_build_eta.lua",
	},

	-- The numbers on the game's resource bar that are the game's own and not the
	-- engine's (issue #3982). The game's resource bar reads all three as team
	-- rules parameters. It was gui_static_resourcebar.lua up to 0.1.89, and is
	-- gui_bastion_resourcebar.lua in 0.1.95 and 0.1.96. unit_supply_requirement.lua writes the supply a team
	-- uses and has, and game_researchpoints_ledger.lua its research points. Both
	-- gadgets stay, since the game's build menu asks them what a team may
	-- build. In a playback they count the units the player has placed, which is
	-- not what the match had, so the recording has the last word on every frame.
	--
	-- Metal and energy need nothing here. The track has each team's own, storage
	-- included, and the player sets them whatever the game.
	teamParams = { "supplyUsed", "supplyMax", "researchPoints" },

	-- The seed of the game's day, night, rain and fog (issue #4013).
	-- weather_seed.lua makes it from the engine's id for the match, which a
	-- playback does not have, unless the parameter is set already. The player
	-- sets it as it is made, before the gadget asks and before the weather widget
	-- reads it once as it loads.
	gameParams = { "weather_seed" },

	-- Widgets that are told the match's time when they ask the engine for the
	-- game's frame (issue #4013). The players list prints it as the time of the
	-- match, and the weather widget works the sun, the rain and the fog out from
	-- it and the seed. Every other widget keeps the engine's count, which only
	-- goes up, since a playback's time jumps and runs backward.
	matchTimeWidgets = {
		"gui_static_playerslist.lua",
		"gui_rml_playerslist.lua",
		"gui_bastion_playerslist.lua",
		"gfx_timecyclesweathereffects_weather.lua",
	},

	hooks = {
		-- How far from the left of the view the game's tooltip panel reaches (issue
		-- #5026). It stays on in a playback, and stands over the bottom left, where
		-- the timeline's left end would be at most window sizes. The game places it
		-- beside its order menu and scales it with the window, and its layout widget
		-- keeps the place it has, so this asks that widget and does not work the place
		-- out. All three releases above have the widget and the panel's name for it.
		-- The panel's rectangle is there whether or not it shows, so the timeline
		-- does not move each time a unit is selected.
		timelineClearance = function()
			local layout = WG and WG.StaticLayout
			if not (layout and layout.GetRect) then
				return 0
			end
			local _, _, right = layout.GetRect("tooltip")
			return right or 0
		end,
	},
}
