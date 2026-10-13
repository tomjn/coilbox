-- Splinter Faction's playback adapter (issue #3800).
--
-- What is listed here is what fights a recording or offers a spectator of one
-- something to do that means nothing. Everything that tells a viewer about the
-- match stays: the resource bars, the tooltip and its unit descriptions, the
-- minimap, the players list, the menu, health bars and the game's own effects.
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
	},

	widgets = {
		-- The faction picker and the start position picker of a match's first
		-- seconds, with their ready buttons.
		"gui_static_factionchooser.lua",
		"gui_static_placement.lua",
		-- Gives units and resources to another team.
		"gui_static_sharemenu.lua",
	},
}
