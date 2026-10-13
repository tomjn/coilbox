-- An adapter for the headless runs of issue #3799. It is not shipped: the ignored
-- Rust test an_adapter_switches_things_off_in_the_engine hands it to the launch
-- as if coilbox shipped it.
--
-- It names two real Splinter Faction 0.1.89 gadgets and a widget, a unit the
-- fixture match builds, and two hooks that say they ran. Both gadgets kill teams:
-- game_end.lua when a team has no units, and game_team_com_ends.lua when it has
-- no commander. Switching off only the first leaves the second asking.

local placed, frames = 0, 0

return {
	name = "Headless fixture",
	shortname = "SF",
	versions = { min = "0.1.80", max = "0.1.99" },

	gadgets = { "game_end.lua", "game_team_com_ends.lua" },
	widgets = { "gui_static_resourcebar.lua" },
	units = { "lozscorpion" },
	features = {},

	hooks = {
		unitPlaced = function(unitID, unitDefID, t, clock)
			placed = placed + 1
			if placed == 1 then
				Spring.Echo("ADAPTER_FIXTURE unitPlaced first unit=" .. unitID .. " def=" .. UnitDefs[unitDefID].name .. " frame=" .. t)
			end
		end,
		afterFrame = function(t, clock)
			frames = frames + 1
			if frames == 1 then
				Spring.Echo("ADAPTER_FIXTURE afterFrame first frame=" .. t)
			end
		end,
	},
}
