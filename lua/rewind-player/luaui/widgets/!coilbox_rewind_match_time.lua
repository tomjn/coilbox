-- Coilbox rewind match time: the match's time for the widgets a game's adapter
-- names (issue #4013).
--
-- Coilbox generates a game that depends on the game a replay was recorded on,
-- and the player gadget in it plays the replay's track back. The engine counts
-- its frames from when the playback was opened, so a widget that prints the
-- time or works the sky out from it shows the playback's. The adapter names
-- such widgets in `matchTimeWidgets`, and this file makes them be told the
-- match's frame (luaui/rewind_match_time/coilbox_match_time.lua has how).
--
-- The work is done as this file runs, because a widget keeps the engine's call
-- in a local as its own file runs, and the handler runs every file before it
-- starts any widget. The name starts with `!` so that it comes before the
-- game's widgets when a handler lists the folder. Then the file asks not to be
-- loaded, as a file that returns false does, so it is no widget: there is
-- nothing to switch off and no call-in to run.
--
-- Change this in the coilbox repository under lua/rewind-player/.

--- What it is, for whoever reads the file. A handler never asks, since the file
-- returns false before the handler looks for it.
function widget:GetInfo()
	return {
		name = "Coilbox rewind match time",
		desc = "Tells the widgets a game's adapter names the time of the match being played back.",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
	}
end

local PREFIX = "COILBOX_REWIND_MATCH_TIME "
local ADAPTER_PATH = "coilbox_rewind/adapter.lua"
local OWN_NAME = "!coilbox_rewind_match_time.lua"

--- Where the lines go: the playback's own log file, and not the engine's log,
-- which the console shows (issue #4032, luarules/rewind_player/coilbox_log.lua).
-- Without the module, the engine's log.
local function logWriter()
	local ok, Log = pcall(VFS.Include, "luarules/rewind_player/coilbox_log.lua", nil, VFS.ZIP)
	if ok and type(Log) == "table" then
		return (Log.new(io, Spring.Echo))
	end
	return Spring.Echo
end

--- The adapter the playback game holds, or nil. Include runs the file in the
-- environment of the function that calls it, so it is read in this file's.
local function readAdapter(say)
	if not VFS.FileExists(ADAPTER_PATH, VFS.ZIP) then
		return nil
	end
	local ok, adapter = pcall(function()
		return VFS.Include(ADAPTER_PATH, nil, VFS.ZIP)
	end)
	if not ok then
		say(PREFIX .. "the game's adapter could not be read, so every widget is told the engine's own frame: " .. tostring(adapter))
		return nil
	end
	if type(adapter) ~= "table" then
		return nil
	end
	return adapter
end

local function start()
	local say = logWriter()
	local found, Engine = pcall(VFS.Include, "luaui/rewind_match_time/coilbox_match_time_engine.lua", nil, VFS.ZIP)
	if not found then
		say(PREFIX .. "failed: " .. tostring(Engine))
		return
	end
	local engine = Engine.check({ Spring = Spring, Game = Game, VFS = VFS })
	for _, line in ipairs(engine.lines) do
		say(line)
	end
	if engine.refused then
		return
	end
	local adapter = readAdapter(say)
	local names = adapter and adapter.matchTimeWidgets
	if type(names) ~= "table" or #names == 0 then
		return
	end
	local loaded, MatchTime = pcall(VFS.Include, "luaui/rewind_match_time/coilbox_match_time.lua", nil, VFS.ZIP)
	if not loaded then
		say(PREFIX .. "failed: " .. tostring(MatchTime))
		return
	end
	MatchTime.wrap({ Spring = Spring, names = names, gameSpeed = Game.gameSpeed })
	say(PREFIX .. "the match's time is given to: " .. table.concat(names, ", "))
	-- A named widget whose file comes before this one has run already and kept
	-- the engine's call.
	local early = {}
	for _, name in ipairs(names) do
		if name:lower() < OWN_NAME then
			early[#early + 1] = name
		end
	end
	if #early > 0 then
		say(PREFIX .. "these come before this file in luaui/widgets/, so they keep the engine's own frame: " .. table.concat(early, ", "))
	end
end

start()

return false
