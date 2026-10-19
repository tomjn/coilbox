-- id: unit-defs-weapons-n-83
-- catalogue:
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- The n key on UnitDefs[id].weapons in unsynced Lua.
--
-- Changelog, 83.0: "remove the "n" field from array-like tables returned by
-- API functions" (commit 1874b58f97). In 0.82.7.1 the weapons table of a unit
-- def had n set to how many weapons it held (rts/Lua/LuaUnitDefs.cpp,
-- WeaponsTable). Complete Annihilation stable-8405's unit_healthbars.lua,
-- gui_defenserange.lua and unit_customformations2.lua count to
-- ud.weapons.n, and on a current engine stop on a nil loop limit.
--
-- Each entry of UnitDefs is a proxy that builds a new weapons table on every
-- read, and whose __newindex refuses the name. So this reads it once per unit
-- def and writes it back with rawset, with a metatable whose __index answers
-- #t for n, as spring-array-n-83 does. Every later read then gets that same
-- table rather than a new one, so a widget that changes it changes it for
-- every widget. The synced state has no rawset (rts/Lua/LuaHandleSynced.cpp),
-- so it is not given this fix. buildOptions lost its n in the same change and
-- is not covered.

local UnitDefs = UnitDefs
if type(UnitDefs) ~= "table" or type(rawset) ~= "function" or type(rawget) ~= "function" then
	return
end

local type, pairs, rawget, rawset = type, pairs, rawget, rawset
local getmetatable, setmetatable = getmetatable, setmetatable

local counted = {
	__index = function(t, key)
		if key == "n" then
			return #t
		end
	end,
}

for _, ud in pairs(UnitDefs) do
	if type(ud) == "table" and rawget(ud, "weapons") == nil then
		local weapons = ud.weapons
		if type(weapons) == "table" and getmetatable(weapons) == nil then
			rawset(ud, "weapons", setmetatable(weapons, counted))
		end
	end
end
