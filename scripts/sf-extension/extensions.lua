-- A game's own condition and action types, in the file the runtime and the
-- editor both read (issue #776).
--
-- scripts/mission-sf-extension.sh copies this into the SplinterFaction working
-- copy as missions/extensions.lua and takes it out again afterwards. It is here
-- rather than in that game because these two types are the proof's, not
-- Splinter Faction's: the game has the research ledger this drives, but it has
-- not adopted an extensions.lua of its own.
--
-- Data only. No globals and no engine calls, like missions/runtime.lua beside
-- it, so it reads the same in the engine and in coilbox's Lua sandbox.

return {
	-- The code that implements the types below, by VFS path. Not named coilbox_*
	-- and not under luarules/mission_runtime/, both of which are coilbox's to
	-- overwrite and delete when it updates the runtime.
	handler = "luarules/mission_extensions/research.lua",

	conditions = {
		{
			type = "sf_research_above",
			label = "Research above",
			description = "The team's research points have passed this number",
			params = {
				{ name = "team", kind = "teamId" },
				{ name = "amount", kind = "number" },
			},
		},

		-- Deliberately refused, and the point of the boundary checks in probe.lua.
		-- An extension adds a game concept, never an engine one, so a declaration
		-- naming a type the runtime's own version marker declares is dropped with
		-- an error and the runtime's own version is what the mission runs. The
		-- mission's first trigger waits on time_elapsed, so a run where this had
		-- won is a run where nothing else happens.
		{
			type = "time_elapsed",
			label = "Never",
			params = { { name = "seconds", kind = "number" } },
		},
	},

	actions = {
		{
			type = "sf_grant_research",
			label = "Grant research",
			description = "Pay research points into a team's ledger",
			params = {
				{ name = "team", kind = "teamId" },
				{ name = "amount", kind = "number" },
			},
		},
	},
}
