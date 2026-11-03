-- An adapter for the headless runs of issue #3799. It is not shipped: the ignored
-- Rust test an_adapter_switches_things_off_in_the_engine hands it to the launch
-- as if coilbox shipped it.
--
-- It names two real Splinter Faction gadgets and a widget, a unit the fixture
-- match builds, and two hooks that say they ran. The widget is
-- gui_build_eta.lua, which 0.1.93, 0.1.95 and 0.1.96 all load unchanged. The
-- game's GUI widgets are being renamed from one version to the next, so a
-- widget named here is checked against the version in use. Both gadgets kill teams:
-- game_end.lua when a team has no units, and game_team_com_ends.lua when it has
-- no commander. Switching off only the first leaves the second asking.

local placed, frames = 0, 0

return {
	name = "Headless fixture",
	shortname = "SF",
	versions = { min = "0.1.80", max = "0.1.99" },

	gadgets = { "game_end.lua", "game_team_com_ends.lua" },
	widgets = { "gui_build_eta.lua" },
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
