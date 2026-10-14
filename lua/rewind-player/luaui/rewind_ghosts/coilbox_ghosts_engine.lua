-- Coilbox rewind ghosts: what the widget needs from the engine (issue #3804).
--
-- The same kind of table as luaui/rewind_timeline/coilbox_timeline_engine.lua,
-- and read the same way. See that file and luarules/rewind_player/
-- coilbox_player_engine.lua for the fields. It is a table of its own because
-- each widget checks the calls it uses and starts or not by itself.
--
-- The widget reads the track in its own Lua state, so the calls of the track
-- reader are its calls too. They are the `track` row.
--
-- A widget that lacks a required call does not start: it logs a line starting
-- COILBOX_REWIND_GHOSTS that names the call and the engine that has it, and
-- draws nothing. The player goes on playing. A widget that lacks an optional call
-- starts without that one feature.
--
-- `since` was read from rts/Lua in the engine's source at the tags 105.0,
-- 105.1.1, 2025.01.6, 2025.04.11 and 2026.07.04: `gl.UnitShape`, `gl.MatrixMode`, `gl.PushMatrix`,
-- `gl.PopMatrix`, `gl.Translate` and `gl.Rotate` in LuaOpenGL.cpp, and
-- `Spring.GetGroundHeight` and `Spring.GetGameRulesParam` in LuaSyncedRead.cpp,
-- which LuaUI is given too (LuaUI.cpp adds the synced read entries to `Spring`).
-- All are at every one of those tags. `gl.UnitShape` has its fifth argument,
-- which picks translucent drawing, at 105.0. No older engine was read, and none
-- has run this widget. No engine before 2025.03.9 is installed.

local M = {}

M.PREFIX = "COILBOX_REWIND_GHOSTS "

--- Calls the widget cannot check, since it cannot report without them.
M.ASSUMED = { "Spring.Echo", "VFS.Include" }

M.ROWS = {
	{
		id = "track",
		feature = "reading the track",
		calls = {
			"VFS.UnpackU8",
			"VFS.UnpackU16",
			"VFS.UnpackS16",
			"VFS.UnpackU32",
			"VFS.UnpackS32",
			"VFS.UnpackF32",
			"VFS.ZlibDecompress",
			"VFS.LoadFile",
		},
		how = "presence",
		used = "coilbox_track.lua and coilbox_track_fetch.lua, the player's own reader",
		required = true,
		since = "105.0",
		without = "No queued building is drawn",
		visible = false,
	},
	{
		id = "player",
		feature = "reading the player's time",
		calls = { "Spring.GetGameRulesParam" },
		how = "presence",
		used = "coilbox_ghosts.lua, Ghosts:update",
		required = true,
		since = "105.0",
		without = "No queued building is drawn",
		visible = false,
	},
	{
		id = "ground",
		feature = "putting a ghost on the ground",
		calls = { "Spring.GetGroundHeight" },
		how = "presence",
		used = "coilbox_ghosts.lua, Ghosts:draw",
		required = true,
		since = "105.0",
		without = "No queued building is drawn",
		visible = false,
	},
	{
		id = "drawing",
		feature = "drawing a ghost",
		calls = { "gl.MatrixMode", "gl.PushMatrix", "gl.PopMatrix", "gl.Translate", "gl.Rotate", "gl.UnitShape", "GL.MODELVIEW" },
		how = "presence",
		used = "coilbox_ghosts.lua, Ghosts:draw",
		required = true,
		since = "105.0",
		without = "No queued building is drawn",
		visible = false,
	},
	{
		id = "outline",
		feature = "the footprint outline",
		calls = { "gl.Color", "gl.BeginEnd", "gl.Vertex", "GL.LINE_LOOP", "Spring.GetTeamColor" },
		how = "presence",
		used = "coilbox_ghosts.lua, Ghosts:draw",
		required = false,
		since = "105.0",
		without = "A ghost has no outline on the ground",
		visible = false,
	},
	{
		id = "adapter",
		feature = "the game adapter's drawing",
		calls = { "VFS.FileExists", "VFS.ZIP" },
		how = "presence",
		used = "coilbox_rewind_ghosts.lua, readAdapter",
		required = false,
		since = "105.0",
		without = "The engine's own shape is always used",
		visible = false,
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

--- Checks the rows against the engine. `roots` holds `Spring`, `gl`, `GL` and `VFS`.
-- Gives `on`, by row id, `lines` to log, each starting with the widget's prefix,
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
