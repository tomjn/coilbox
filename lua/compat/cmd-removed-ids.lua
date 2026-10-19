-- id: cmd-removed-ids
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- CMD.AISELECT and CMD.SET_WANTED_MAX_SPEED, with their IDs 30 and 70.
--
-- Changelog, 105.0: "remove CMD_SET_WANTED_MAX_SPEED". Recoil 2025.01.1 then
-- removed CMD_AISELECT, which did nothing (commit d33c07aa26, "Get rid of
-- CMD_AISELECT"). Until then rts/Lua/LuaConstCMD.cpp put each in the CMD
-- table both ways, name to ID and ID to name, with the IDs
-- rts/Sim/Units/CommandAI/Command.h gave them.
--
-- Complete Annihilation stable-8405 uses both as table keys, and a nil key
-- stops ca_layout.lua, gui_chili_commandmenu.lua and gui_jumpjets.lua as they
-- load. No command a current engine has uses either ID. An order a game gives
-- with one is handed to the game's CommandFallback and then dropped, as any
-- command the engine does not know is (rts/Sim/Units/CommandAI/CommandAI.cpp),
-- so the order does nothing, as AISELECT already did.

local CMD = CMD
if type(CMD) ~= "table" then
	return
end

local function restore(name, id)
	if CMD[name] == nil and CMD[id] == nil then
		CMD[name] = id
		CMD[id] = name
	end
end

restore("AISELECT", 30)
restore("SET_WANTED_MAX_SPEED", 70)
