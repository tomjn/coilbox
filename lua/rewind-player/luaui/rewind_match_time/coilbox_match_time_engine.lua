-- Coilbox rewind match time: what the file needs from the engine (issue #4013).
--
-- The same kind of table as luaui/rewind_timeline/coilbox_timeline_engine.lua,
-- and read the same way. See that file and luarules/rewind_player/
-- coilbox_player_engine.lua for the fields.
--
-- A file that lacks a call wraps nothing: it logs a line starting
-- COILBOX_REWIND_MATCH_TIME that names the call and the engine that has it, and
-- every widget is told the engine's own frame, as before issue #4013.
--
-- `since` was read from rts/Lua in the engine's source at the tags 105.0,
-- 105.1.1, 2025.01.6, 2025.04.11 and 2026.07.04: `Spring.GetGameFrame`,
-- `Spring.GetGameSeconds` and `Spring.GetGameRulesParam` in LuaSyncedRead.cpp,
-- which LuaUI is given too, `Game.gameSpeed` in LuaConstGame.cpp, and
-- `VFS.FileExists` and `VFS.ZIP` in LuaVFS.cpp. All are at every one of those
-- tags. No older engine was read. It has run on engine 2026.07.01-102-g6e5c5a0
-- and on no other.

local M = {}

M.PREFIX = "COILBOX_REWIND_MATCH_TIME "

--- Calls the file cannot check, since it cannot report without them.
M.ASSUMED = { "Spring.Echo", "VFS.Include" }

M.ROWS = {
	{
		id = "matchTime",
		feature = "the match's time for the widgets the adapter names",
		calls = { "Spring.GetGameFrame", "Spring.GetGameSeconds", "Spring.GetGameRulesParam", "Game.gameSpeed" },
		how = "presence",
		used = "coilbox_match_time.lua, M.wrap",
		required = true,
		since = "105.0",
		without = "Every widget is told the engine's own frame",
		visible = true,
	},
	{
		id = "adapter",
		feature = "reading the game adapter",
		calls = { "VFS.FileExists", "VFS.ZIP" },
		how = "presence",
		used = "!coilbox_rewind_match_time.lua, readAdapter",
		required = true,
		since = "105.0",
		without = "Every widget is told the engine's own frame",
		visible = true,
	},
}

--- The value at a dotted name, or nil when any part of it is not there.
local function lookup(roots, name)
	local value = roots
	for part in name:gmatch("[^.]+") do
		if type(value) ~= "table" then
			return nil
		end
		value = value[part]
	end
	return value
end

--- Checks the rows against the engine. `roots` holds `Spring`, `Game` and `VFS`.
-- Gives `on`, by row id, `lines` to log, each starting with the file's prefix,
-- and `refused`, true when a required row has a call missing.
function M.check(roots)
	local result = { on = {}, lines = {}, refused = false }
	for _, row in ipairs(M.ROWS) do
		local gone = {}
		for _, call in ipairs(row.calls) do
			if lookup(roots, call) == nil then
				gone[#gone + 1] = call
			end
		end
		result.on[row.id] = #gone == 0
		if #gone > 0 then
			local missing = table.concat(gone, ", ")
			if row.required then
				result.refused = true
				result.lines[#result.lines + 1] = M.PREFIX
					.. "cannot start: this engine has no "
					.. missing
					.. ". It is needed for "
					.. row.feature
					.. ". "
					.. row.without
					.. ". Engine "
					.. row.since
					.. " and later have it"
			else
				result.lines[#result.lines + 1] = M.PREFIX
					.. "this engine has no "
					.. missing
					.. ". Switched off: "
					.. row.feature
					.. ". "
					.. row.without
					.. ". Engine "
					.. row.since
					.. " and later have it"
			end
		end
	end
	return result
end

return M
