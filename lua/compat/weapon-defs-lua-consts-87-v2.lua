-- id: weapon-defs-lua-consts-87-v2
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- WeaponDefs[id].areaOfEffect, maxVelocity and onlyTargetCategories in every Lua
-- state. This takes over from weapon-defs-lua-consts-87, which ran unsynced only
-- and did not cover onlyTargetCategories.
--
-- Changelog, 87.0: "remove the following Lua consts: wdef[id].areaOfEffect,
-- wdef[id].maxVelocity & wdef[id].onlyTargetCategories". The engine still knows
-- the three names, so reading one logs "ERROR_TYPE for key" and gives nil
-- (rts/Lua/LuaWeaponDefs.cpp, ADD_DEPRECATED_LUADEF_KEY). Complete Annihilation
-- stable-8405's synced exp_no_air_nuke.lua and lups_shockwaves.lua compare
-- areaOfEffect with a number and stop.
--
-- In 86.0 (rts/Lua/LuaWeaponDefs.cpp and rts/Sim/Weapons/WeaponDefHandler.cpp)
-- areaOfEffect was damageAreaOfEffect, maxVelocity was projectilespeed times 30,
-- the game's frames per second, and onlyTargetCategories was every category,
-- since every weapon def set its bits to 0xffffffff. Game.springCategories has
-- every category name (rts/Lua/LuaConstGame.cpp).
--
-- The synced state has no rawset (rts/Lua/LuaHandleSynced.cpp), an entry's
-- __newindex refuses the three names, and its metatable is protected. WeaponDefs
-- itself is a plain table, so each entry is replaced by a table holding the old
-- values, which passes anything else to the engine's entry. A game takes its
-- entries from WeaponDefs after the prelude has run, so it never sees the old
-- ones.
--
-- The new table has pairs and next of its own. The engine's Next starts its walk
-- of the known names again when it reaches a raw key with a known name
-- (LuaUtils::Next), so it would never end on this table.

local WeaponDefs, Game = WeaponDefs, Game
if type(WeaponDefs) ~= "table" then
	return
end

local type, pairs, next = type, pairs, next
local getmetatable, setmetatable = getmetatable, setmetatable

local categories = {}
local names = type(Game) == "table" and Game.springCategories
if type(names) == "table" then
	for name in pairs(names) do
		categories[name] = true
	end
end

local function withOldValues(def)
	local old = { onlyTargetCategories = categories }
	local area, speed = def.damageAreaOfEffect, def.projectilespeed
	if type(area) == "number" then
		old.areaOfEffect = area
	end
	if type(speed) == "number" then
		old.maxVelocity = speed * 30
	end

	local defNext = def.next
	local function entryNext(_, key)
		if key == nil or old[key] == nil then
			local nextKey, value = defNext(def, key)
			if nextKey ~= nil then
				return nextKey, value
			end
			key = nil
		end
		return next(old, key)
	end

	local entry = {
		pairs = function(self)
			return entryNext, self, nil
		end,
		next = entryNext,
	}
	for name, value in pairs(old) do
		entry[name] = value
	end
	return setmetatable(entry, {
		__index = def,
		__newindex = def,
		__metatable = getmetatable(def),
	})
end

for id, def in pairs(WeaponDefs) do
	if type(def) == "table" then
		WeaponDefs[id] = withOldValues(def)
	end
end
