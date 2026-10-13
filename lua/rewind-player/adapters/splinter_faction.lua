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
