-- Coilbox rewind timeline: what the widget needs from the engine (issue #3802).
--
-- The same kind of table as luarules/rewind_player/coilbox_player_engine.lua
-- and read the same way, and the rows are in the same shape (see that file for
-- the fields). It is a second table because the synced gadget cannot check
-- these: `gl`, `GL` and the unsynced `Spring` are the widget's own, and the
-- gadget's table is for the synced half, and each widget checks its own calls.
-- So the small `check`
-- here is a copy of the gadget's, with the note left out. A widget cannot set a
-- game rules parameter, so a widget that cannot start says so in the log only.
--
-- A widget that lacks a required call does not start: it logs a line starting
-- COILBOX_REWIND_TIMELINE that names the call and the engine that has it, and
-- the timeline is not shown. The player goes on playing and takes messages from
-- anything else. A widget that lacks an optional call starts without that one
-- feature.
--
-- `since` was read from rts/Lua in the engine's source at the tags 105.0,
-- 105.1.1, 2025.01.6 and 2026.07.04: the `gl` calls in LuaOpenGL.cpp and
-- LuaFonts.cpp, the `GL` constants in LuaConstGL.cpp, the rest in
-- LuaUnsyncedRead.cpp, LuaUnsyncedCtrl.cpp, LuaSyncedRead.cpp and LuaVFS.cpp. No
-- older engine was read, and none has run this widget. No engine before
-- 2025.03.9 is installed.

local M = {}

M.PREFIX = "COILBOX_REWIND_TIMELINE "

--- Calls the widget cannot check, since it cannot report without them.
M.ASSUMED = { "Spring.Echo", "VFS.Include" }

M.ROWS = {
	{
		id = "drawing",
		feature = "drawing the timeline",
		calls = {
			"gl.Color",
			"gl.Rect",
			"gl.BeginEnd",
			"gl.Vertex",
			"gl.Text",
			"gl.GetTextWidth",
			"gl.GetTextHeight",
			"gl.Texture",
			"GL.TRIANGLE_FAN",
			"GL.LINE_LOOP",
			"GL.TRIANGLES",
		},
		how = "presence",
		used = "coilbox_timeline.lua, the draw functions",
		required = true,
		since = "105.0",
		without = "The timeline is not shown",
		visible = false,
	},
	{
		id = "player",
		feature = "talking to the player",
		calls = {
			"Spring.GetGameRulesParam",
			"Spring.SendLuaRulesMsg",
			"Spring.GetViewGeometry",
			"Spring.GetMouseState",
		},
		how = "presence",
		used = "coilbox_timeline.lua, Timeline:read and Timeline:send, and coilbox_rewind_timeline.lua",
		required = true,
		since = "105.0",
		without = "The timeline is not shown",
		visible = false,
	},
	{
		id = "keys",
		feature = "the keys",
		calls = { "Spring.GetKeyCode", "Spring.GetKeySymbol" },
		how = "presence",
		used = "coilbox_timeline.lua, the key bindings",
		required = true,
		since = "105.0",
		without = "The timeline is not shown",
		visible = false,
	},
	{
		id = "marks",
		feature = "marks on the bar",
		calls = { "VFS.FileExists", "VFS.ZIP" },
		how = "presence",
		used = "coilbox_timeline.lua, loadMarks",
		required = false,
		since = "105.0",
		without = "The bar has no marks",
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

--- Checks the rows against the engine. `roots` holds `Spring`, `gl`, `GL` and
-- `VFS`. Gives `on`, by row id, `lines` to log, each starting with the widget's
-- prefix, and `refused`, true when a required row has a call missing.
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
