-- id: defs-commander-85
-- catalogue: defTag:UnitDefs.commander, defTag:UnitDefs.isCommander
-- defs: defs_post
-- license: MIT or GNU GPL, v2 or later

-- A unit def's commander tag, copied into customparams.iscommander.
--
-- Changelog, 85.0: "removed "commander" tag" and "UnitDef[].isCommander
-- returns now false". Up to 84.0, UnitDef.cpp read the tag as a true or false
-- value and Lua read it back as UnitDefs[id].isCommander. The engine itself
-- only used it for the Commander selection filter. Games made since mark a
-- commander with customParams.iscommander, which the engine passes to Lua as
-- it is, so a game's Lua and widgets made for either can find the commanders.
--
-- Only a unit whose tag is true gets the parameter, and a unit that already has
-- one keeps its own. canManualFire stays as the game set it.

local compat = ...

for _, ud in ipairs(compat.units()) do
	if compat.bool(compat.get(ud, "commander")) then
		compat.param(ud, "iscommander", "1")
	end
end
