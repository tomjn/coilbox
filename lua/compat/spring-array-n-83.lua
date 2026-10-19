-- id: spring-array-n-83
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- The n key on the arrays of IDs and names the functions below return.
--
-- Changelog, 83.0: "remove the "n" field from array-like tables returned by
-- API functions" (commits 1874b58f97 and 40c0a0af81). In 0.82.7.1 each of these
-- functions set n to how many entries its array had (rts/Lua/LuaSyncedRead.cpp
-- and LuaUnsyncedRead.cpp). Complete Annihilation stable-8405's gui_buildbar.lua
-- counts to Spring.GetTeamUnits(teamID).n, and on a current engine stops on a
-- nil loop limit.
--
-- n is given by a metatable whose __index answers #t for it, rather than set
-- on the table. pairs and next then see only the IDs, so a game written for 83.0
-- or later that walks one of these arrays with pairs is not given an extra key.
-- A table that already has a metatable is left alone. Every other result is
-- passed on as it is.
--
-- These are the flat arrays the change took n from that a current engine still
-- has. The keyed tables of Spring.GetTeamUnitsSorted and
-- Spring.GetTeamUnitsCounts kept their n, and the command queues, command
-- descriptions and key bindings are not covered.

local Spring = Spring
if type(Spring) ~= "table" then
	return
end

local type, getmetatable, setmetatable = type, getmetatable, setmetatable

local counted = {
	__index = function(t, key)
		if key == "n" then
			return #t
		end
	end,
}

local function withN(t, ...)
	if type(t) == "table" and getmetatable(t) == nil then
		setmetatable(t, counted)
	end
	return t, ...
end

local function wrap(name)
	local original = Spring[name]
	if type(original) ~= "function" then
		return
	end
	Spring[name] = function(...)
		return withN(original(...))
	end
end

-- rts/Lua/LuaSyncedRead.cpp, in both states.
wrap("GetAllyTeamList")
wrap("GetTeamList")
wrap("GetPlayerList")
wrap("GetAllUnits")
wrap("GetTeamUnits")
wrap("GetTeamUnitsByDefs")
wrap("GetUnitsInRectangle")
wrap("GetUnitsInBox")
wrap("GetUnitsInCylinder")
wrap("GetUnitsInSphere")
wrap("GetUnitsInPlanes")
wrap("GetFeaturesInRectangle")
wrap("GetUnitIsTransporting")
wrap("GetAllFeatures")
wrap("GetUnitPieceList")

-- rts/Lua/LuaUnsyncedRead.cpp, in the unsynced state only.
wrap("GetSelectedUnits")
wrap("GetGroupUnits")
