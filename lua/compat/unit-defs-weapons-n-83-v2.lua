-- id: unit-defs-weapons-n-83-v2
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- The n key on UnitDefs[id].weapons in every Lua state. This takes over from
-- unit-defs-weapons-n-83, which ran unsynced only and made ud:pairs() run
-- forever (issue #4866).
--
-- Changelog, 83.0: "remove the "n" field from array-like tables returned by
-- API functions" (commit 1874b58f97). In 0.82.7.1 the weapons table of a unit
-- def had n set to how many weapons it held (rts/Lua/LuaUnitDefs.cpp,
-- WeaponsTable). Complete Annihilation stable-8405's unit_healthbars.lua,
-- gui_defenserange.lua and unit_customformations2.lua count to
-- ud.weapons.n, and on a current engine stop on a nil loop limit.
--
-- Each entry of UnitDefs is a proxy that builds a new weapons table on every
-- read, and whose __newindex refuses the name. The old fix wrote the table
-- back onto the proxy with rawset. The engine's iterator, LuaUtils::Next in
-- rts/Lua/LuaUtils.cpp, walks the names it knows and then the proxy's raw
-- keys, and starts the names again when it meets a raw key with a known name.
-- weapons is a known name (rts/Lua/LuaUnitDefs.cpp), so a walk over the proxy
-- never ended.
--
-- UnitDefs itself is a plain table, so each entry is replaced by a table that
-- holds the weapons table and passes everything else to the engine's proxy, so
-- the proxy gets no raw key named weapons. It has pairs and next of its own, which walk the
-- proxy and give the held table for weapons. The held table is read once and
-- is the same for every later read, so a widget that changes it changes it for
-- every widget. A game takes its entries from UnitDefs after the prelude has
-- run, so it never sees the old ones. Without rawset or rawget, the fix runs
-- in the synced state too. buildOptions lost its n in the same change and is
-- not covered.

local UnitDefs = UnitDefs
if type(UnitDefs) ~= "table" then
	return
end

local type, pairs = type, pairs
local getmetatable, setmetatable = getmetatable, setmetatable

local counted = {
	__index = function(t, key)
		if key == "n" then
			return #t
		end
	end,
}

local function withCountedWeapons(def)
	local weapons, defNext = def.weapons, def.next
	if type(weapons) ~= "table" or getmetatable(weapons) ~= nil or type(defNext) ~= "function" then
		return def
	end
	setmetatable(weapons, counted)

	local entry
	local function entryNext(_, key)
		local nextKey, value = defNext(def, key)
		if nextKey == "weapons" then
			return nextKey, entry.weapons
		end
		return nextKey, value
	end

	entry = {
		weapons = weapons,
		pairs = function(self)
			return entryNext, self, nil
		end,
		next = entryNext,
	}
	return setmetatable(entry, {
		__index = def,
		__newindex = def,
		__metatable = getmetatable(def),
	})
end

for id, def in pairs(UnitDefs) do
	if type(def) == "table" then
		UnitDefs[id] = withCountedWeapons(def)
	end
end
