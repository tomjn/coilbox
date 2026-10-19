-- id: snext-spairs-sipairs
-- catalogue: removed:snext, removed:spairs, removed:sipairs
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- snext, spairs and sipairs, as next, pairs and ipairs.
--
-- Changelog, 2025.01.1: "removed `snext`, `spairs` and `sipairs`. These
-- functions can be replaced by the regular `next`, `pairs`, and `ipairs`
-- respectively with no change in behaviour." (commit d083766c74).
--
-- Before 97.0 they walked the old SYNCED proxy. From 97.0 a read of SYNCED
-- gives a copy, and LuaSyncedTable::PushEntries (rts/Lua/LuaSyncedTable.cpp)
-- set the three globals to the state's own next, pairs and ipairs. The engine
-- called it only in the unsynced half of LuaRules and LuaGaia, the same call
-- that sets SYNCED, so this defines them only where SYNCED is a table. LuaUI
-- never had them.
--
-- The engine's LuaGadgets/gadgets.lua gives each gadget a copy of the System
-- table its system.lua builds, not the globals, and that file listed the three
-- until the same commit. Old games load the engine's handler, so this also adds
-- them to System when it is first set.

local compat = ...

if type(SYNCED) ~= "table" then
	return
end

local type, getmetatable, setmetatable, rawset = type, getmetatable, setmetatable, rawset

local aliases = { snext = next, spairs = pairs, sipairs = ipairs }

local function fill(t)
	for name, fn in pairs(aliases) do
		compat.define(t, name, fn)
	end
end

fill(_G)

if type(System) == "table" then
	fill(System)
	return
end

local meta = getmetatable(_G)
if meta == nil then
	meta = {}
	setmetatable(_G, meta)
end
if type(meta) ~= "table" then
	return
end

-- The global table has no System yet, so its first assignment goes through
-- __newindex. Whatever handled that before still does.
local previous = meta.__newindex
meta.__newindex = function(t, name, value)
	if name == "System" and type(value) == "table" then
		fill(value)
	end
	if type(previous) == "function" then
		return previous(t, name, value)
	elseif type(previous) == "table" then
		previous[name] = value
	else
		rawset(t, name, value)
	end
end
