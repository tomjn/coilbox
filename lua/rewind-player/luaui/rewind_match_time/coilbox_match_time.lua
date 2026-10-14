-- Coilbox rewind match time: the match's frame for the widgets a game's adapter
-- names (issue #4013).
--
-- The engine counts its frames from when the playback was opened, and no Lua
-- call sets that count. A widget that prints the time, or works the sky out from
-- it, shows the playback's and not the match's. The player publishes the time of
-- the match that is showing as `coilbox_rewind_frame`.
--
-- So `Spring.GetGameFrame` and `Spring.GetGameSeconds` are wrapped in the
-- `Spring` every widget shares. A call from a widget the adapter names is
-- answered with the match's frame, and every other call with the engine's.
-- Only the named widgets are told, because many widgets use the frame as a
-- clock that only goes up, for timers, fades and caches, and mix it with the
-- frame the engine hands `widget:GameFrame`. A playback's time jumps and runs
-- backward, and those would break.
--
-- The caller is found by its environment: a widget's functions run in the
-- widget's own table, which the handler gives a `whInfo` with the file it was
-- loaded from. A widget asking as its file runs has no `whInfo` yet, and a call
-- made as a tail call leaves no frame to look at. Both are told the engine's.
--
-- The wrap has to be in place before a named widget's file runs, since a
-- widget keeps the call in a local as it loads. The widget file that makes it,
-- luaui/widgets/!coilbox_rewind_match_time.lua, has a name that comes before
-- any widget's whose name starts with a letter, a digit or an underscore, and a
-- handler lists the folder in the order of the names.
--
-- Change this in the coilbox repository under lua/rewind-player/.

local M = {}

M.PREFIX = "COILBOX_REWIND_MATCH_TIME "

--- The player's published time, a frame of the track that can be a fraction.
M.FRAME_PARAM = "coilbox_rewind_frame"

local WIDGETS = "luaui/widgets/"

--- The file a widget was loaded from, inside luaui/widgets/ and in lowercase,
-- from the `whInfo` its handler gave it.
local function fileOf(info)
	local path = info.filename
	if type(path) == "string" then
		path = path:lower():gsub("\\", "/")
		local at = path:find(WIDGETS, 1, true)
		if at then
			return path:sub(at + #WIDGETS)
		end
	end
	local base = info.basename
	return type(base) == "string" and base:lower() or nil
end

--- Wraps the two calls in `options.Spring` for the widget files in
-- `options.names`, which are paths inside luaui/widgets/ compared without
-- regard to case. `options.gameSpeed` is the engine's frames in a second.
-- Gives true when it wrapped them and false when no widget is named.
function M.wrap(options)
	local named, count = {}, 0
	for _, name in ipairs(options.names or {}) do
		named[name:lower()] = true
		count = count + 1
	end
	if count == 0 then
		return false
	end

	local Spring = options.Spring
	local speed = options.gameSpeed
	-- The engine gives the frame as what is left of a day, and the days.
	local day = speed * 24 * 60 * 60
	local engineFrame, engineSeconds = Spring.GetGameFrame, Spring.GetGameSeconds
	local getParam = Spring.GetGameRulesParam
	local getfenv, pcall, rawget, type, floor = getfenv, pcall, rawget, type, math.floor
	local FRAME = M.FRAME_PARAM

	-- Whether a widget's environment is one of the named widgets. A widget that
	-- is loaded again has a new one, and the old one goes.
	local known = setmetatable({}, { __mode = "k" })

	--- The match's frame for a caller whose environment is `env`, or nil when
	-- the caller is not a named widget or the player has not said its time.
	local function frameFor(env)
		if type(env) ~= "table" then
			return nil
		end
		local yes = known[env]
		if yes == nil then
			local info = rawget(env, "whInfo")
			if type(info) ~= "table" then
				-- Not a widget, or one whose file is still running. Not kept, so a
				-- widget is known once its handler has finished it.
				return nil
			end
			yes = named[fileOf(info) or ""] == true
			known[env] = yes
		end
		if not yes then
			return nil
		end
		local t = getParam(FRAME)
		if type(t) ~= "number" then
			return nil
		end
		return floor(t)
	end

	-- getfenv's level 1 is pcall, 2 is the wrap and 3 is whoever called it. A
	-- tail call there is an error in the engine's Lua, which pcall takes.
	Spring.GetGameFrame = function(...)
		local ok, env = pcall(getfenv, 3)
		local frame = ok and frameFor(env)
		if frame then
			return frame % day, floor(frame / day)
		end
		return engineFrame(...)
	end
	Spring.GetGameSeconds = function(...)
		local ok, env = pcall(getfenv, 3)
		local frame = ok and frameFor(env)
		if frame then
			return frame / speed
		end
		return engineSeconds(...)
	end
	return true
end

return M
