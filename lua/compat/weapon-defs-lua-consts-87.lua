-- id: weapon-defs-lua-consts-87
-- catalogue:
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- WeaponDefs[id].areaOfEffect and WeaponDefs[id].maxVelocity in unsynced Lua.
--
-- Changelog, 87.0: "remove the following Lua consts: wdef[id].areaOfEffect,
-- wdef[id].maxVelocity & wdef[id].onlyTargetCategories". The engine still
-- knows the two names, so reading one logs "ERROR_TYPE for key" and gives nil
-- (rts/Lua/LuaWeaponDefs.cpp, ADD_DEPRECATED_LUADEF_KEY). Complete
-- Annihilation stable-8405's gui_attack_aoe.lua compares areaOfEffect with a
-- number and stops.
--
-- In 86.0 (rts/Lua/LuaWeaponDefs.cpp and rts/Sim/Weapons/WeaponDefHandler.cpp)
-- areaOfEffect was damageAreaOfEffect, half the def's areaOfEffect tag, and
-- maxVelocity was projectilespeed times 30, the game's frames per second. A
-- current engine still gives Lua both damageAreaOfEffect and projectilespeed,
-- worked out from the same tags, so this copies them under the old names.
--
-- Each entry of WeaponDefs is a proxy whose __newindex refuses both names, so
-- the values are written with rawset, and a raw value means __index is never
-- asked. The synced state has no rawset (rts/Lua/LuaHandleSynced.cpp), so it is
-- not given this fix. onlyTargetCategories is not put back either.

local WeaponDefs = WeaponDefs
if type(WeaponDefs) ~= "table" or type(rawset) ~= "function" or type(rawget) ~= "function" then
	return
end

local type, pairs, rawget, rawset = type, pairs, rawget, rawset

for _, wd in pairs(WeaponDefs) do
	if type(wd) == "table" then
		local area = wd.damageAreaOfEffect
		if type(area) == "number" and rawget(wd, "areaOfEffect") == nil then
			rawset(wd, "areaOfEffect", area)
		end
		local speed = wd.projectilespeed
		if type(speed) == "number" and rawget(wd, "maxVelocity") == nil then
			rawset(wd, "maxVelocity", speed * 30)
		end
	end
end
