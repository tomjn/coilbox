-- id: defs-weapon-consts-87
-- catalogue:
-- defs: defs_post
-- license: MIT or GNU GPL, v2 or later

-- Two of the weapon def values Lua lost in 87.0, kept in each weapon def's
-- custom parameters under the names Lua read them by, lower case.
--
-- Changelog, 87.0: "remove the following Lua consts: wdef[id].areaOfEffect,
-- wdef[id].maxVelocity & wdef[id].onlyTargetCategories". Reading one now logs
-- an error and gives nil (rts/Lua/LuaWeaponDefs.cpp). In 86.0
-- (WeaponDefHandler.cpp and LuaWeaponDefs.cpp):
--
-- - areaOfEffect was damageAreaOfEffect, which is half the def's areaOfEffect
--   tag. customparams.areaofeffect gets that half.
-- - maxVelocity was the projectile speed per frame times 30, and the speed per
--   frame was the def's weaponVelocity divided by 30, at least 0.01. So
--   customparams.maxvelocity gets weaponVelocity, at least 0.3.
-- - onlyTargetCategories was every category for every weapon def, as no tag
--   set it. A weapon's own target categories are on the unit, in
--   UnitDefs[id].weapons. So there is nothing per def to keep.
--
-- A def that does not set the tag gets no parameter, and one that already has
-- the parameter keeps its own.

local compat = ...

for _, wd in ipairs(compat.weapons()) do
	local area = tonumber(compat.get(wd, "areaofeffect"))
	if area ~= nil then
		compat.param(wd, "areaofeffect", tostring(area * 0.5))
	end
	local velocity = tonumber(compat.get(wd, "weaponvelocity"))
	if velocity ~= nil then
		compat.param(wd, "maxvelocity", tostring(math.max(0.3, velocity)))
	end
end
