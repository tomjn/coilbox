-- id: defs-icon-type-2025
-- catalogue: signature:UnitDefs.iconType@2025.06.07
-- defs: defs_post
-- license: MIT or GNU GPL, v2 or later

-- Gives a unit def whose iconType names no icon in gamedata/icontypes.lua the
-- icon type "default", which is what 104.0 read for it (issue #4699).
--
-- In 104.0 a UnitDef held iconHandler->GetIcon(name) (rts/Sim/Units/UnitDef.cpp),
-- and GetIcon gives the default icon for a name it does not have
-- (rts/Rendering/IconHandler.cpp), so UnitDefs[id].iconType read "default".
-- RecoilEngine commit 24ae98356d, "Icon atlas v3" (#2604, first in
-- 2025.06.07), keeps the name instead, and UnitDefs[id].iconType returns it as
-- the def gave it. Spring 1944's gui_s44_healthbar.lua looks up every type
-- that is not "default" in its icontypes.lua, and its ships name "pontoon",
-- which that file does not have.
--
-- The engine still draws a name it does not have with the default icon
-- (CIconHandler::GetIconIdxOrDefault), so the change shows only in Lua. It is
-- made here, while the defs load, because 104.0 decided it then, once. A def
-- the game later points at another icon with Spring.SetUnitDefIcon reads that
-- icon, as it did in 104.0.
--
-- The icons are the string keys of the table icontypes.lua returns, in lower
-- case, as LuaParser gives them to CIconHandler::LoadIcons, plus "default",
-- which the engine always has. The file is read from the game and then the
-- base content, as LoadIcons reads it, in a table of its own so it sets no
-- global of the defs. The engine reads the def's tag as a string, so a number
-- is read as its text, and a tag that is neither is "default" to the engine
-- already. The def's own spelling is compared, so "Tank" is not the icon
-- "tank", as in 104.0.
--
-- When icontypes.lua cannot be read, no def is changed.
--
-- compat.icons lists the name of each unit def changed.

local compat = ...

compat.icons = {}

local mode = (VFS.MOD or "M") .. (VFS.BASE or "b")
local ok, icons = pcall(VFS.Include, "gamedata/icontypes.lua", setmetatable({}, { __index = _G }), mode)
if not ok or type(icons) ~= "table" then
	return
end

local known = { default = true }
for name in pairs(icons) do
	if type(name) == "string" then
		known[name:lower()] = true
	end
end

local units = DEFS.unitDefs
if type(units) ~= "table" then
	return
end
for name, ud in pairs(units) do
	if type(name) == "string" and type(ud) == "table" then
		local icon = compat.get(ud, "icontype")
		if (type(icon) == "string" or type(icon) == "number") and not known[tostring(icon)] then
			compat.set(ud, "icontype", "default")
			compat.icons[#compat.icons + 1] = name
		end
	end
end
