-- Says what the ghosts widget would draw at chosen frames of a playback in a
-- real engine.
--
-- The ignored Rust test the_ghosts_follow_the_track_in_the_engine writes this
-- file into luaui/widgets/ of the playback game it has just generated, replaces
-- @FRAMES@ with the frames to look at, launches a headless engine on it and
-- reads the GHOSTS_PROBE lines back out of the log. It is not part of the game
-- coilbox ships.
--
-- It finds the ghosts widget in the game's own widget handler, which is the
-- proof that the handler loaded it and turned it on. For each frame it pauses the
-- player, seeks, waits for the player to publish that frame, and calls the
-- widget's DrawWorld the way the handler would. A headless engine does not draw,
-- and the engine's own drawing calls refuse to run outside a draw, so the probe
-- puts counting versions of the eight the widget uses in their place for the
-- length of that one call. What it records is what the widget asked the engine
-- to draw: which shape, in which team's colour, at which place and turn.
--
-- Every line is a measurement. The test decides what passes.

function widget:GetInfo()
	return { name = "Coilbox rewind ghosts probe", layer = 1000, enabled = true, handler = true }
end

local TAG = "GHOSTS_PROBE "
local GHOSTS = "Coilbox rewind ghosts"
local FRAMES = @FRAMES@
-- A frame with ghosts in it, where the key is pressed.
local TOGGLE_FRAME = @TOGGLE_FRAME@
local TIMELINE = "Coilbox rewind timeline"

-- How many simulation frames a step may take before the probe gives up on it.
local PATIENCE = 300

local function say(text)
	Spring.Echo(TAG .. text)
end

local function param(name)
	return Spring.GetGameRulesParam("coilbox_rewind_" .. name)
end

local function ghosts()
	for _, w in ipairs(widgetHandler.widgets) do
		if w.whInfo and w.whInfo.name == GHOSTS then
			return w
		end
	end
end

--- What one call of DrawWorld asks the engine for, as a list of
-- `name:team:x:y:z:turn:flags`.
local function drawn(widget_)
	local list = {}
	local current = {}
	local real = {}
	for _, name in ipairs({ "MatrixMode", "Color", "BeginEnd", "PushMatrix", "PopMatrix", "Translate", "Rotate", "UnitShape" }) do
		real[name] = gl[name]
	end
	local depth = 0
	local outlines = 0
	gl.MatrixMode = function() end
	gl.Color = function() end
	gl.BeginEnd = function()
		outlines = outlines + 1
	end
	gl.PushMatrix = function()
		depth = depth + 1
		if depth == 1 then
			current = { x = 0, y = 0, z = 0, turn = 0 }
		end
	end
	gl.PopMatrix = function()
		depth = depth - 1
	end
	gl.Translate = function(x, y, z)
		current.x, current.y, current.z = x, y, z
	end
	gl.Rotate = function(degrees)
		current.turn = degrees
	end
	gl.UnitShape = function(def, team, rawState, toScreen, opaque)
		local name = UnitDefs[def] and UnitDefs[def].name or ("def" .. tostring(def))
		list[#list + 1] = string.format(
			"%s:%d:%.3f:%.3f:%.3f:%d:%s%s%s",
			name,
			team,
			current.x,
			current.y,
			current.z,
			current.turn,
			tostring(rawState),
			tostring(toScreen),
			tostring(opaque)
		)
	end
	local ok, err = pcall(widget_.DrawWorld, widget_)
	for name, fn in pairs(real) do
		gl[name] = fn
	end
	return list, ok, err, outlines
end

local at = 0
local step
local deadline
local finished = false
local sent = false

function widget:Update()
	if finished then
		return
	end
	local frame = Spring.GetGameFrame()
	if at == 0 then
		if type(param("first_frame")) ~= "number" then
			if frame > PATIENCE then
				say("loaded=" .. (ghosts() and 1 or 0) .. " no_player=1")
				say("done")
				finished = true
			end
			return
		end
		local w = ghosts()
		say(string.format("loaded=%d first=%s last=%s frames=%d", w and 1 or 0, tostring(param("first_frame")), tostring(param("last_frame")), #FRAMES))
		if not w then
			say("done")
			finished = true
			return
		end
		Spring.SendLuaRulesMsg("coilbox_rewind:pause")
		at = 1
		return
	end
	local want = FRAMES[at] or (at == #FRAMES + 1 and TOGGLE_FRAME)
	if not want then
		local w = ghosts()
		say(string.format("still_loaded=%d", w and 1 or 0))
		say("done")
		finished = true
		return
	end
	if not sent then
		Spring.SendLuaRulesMsg("coilbox_rewind:seek " .. want)
		sent = true
		deadline = frame + PATIENCE
		return
	end
	if param("frame") == want and param("playing") == 0 or frame > deadline then
		local w = ghosts()
		local list, ok, err, outlines = drawn(w)
		table.sort(list)
		say(
			string.format(
				"%s=%d arrived=%d ghosts=%d outlines=%d ok=%d list=%s%s",
				FRAMES[at] and "frame" or "toggle_frame",
				want,
				param("frame") == want and 1 or 0,
				#list,
				outlines,
				ok and 1 or 0,
				table.concat(list, ";"),
				ok and "" or (" error=" .. tostring(err))
			)
		)
		if not FRAMES[at] then
			-- The key the timeline's list has for the ghosts, pressed the way the
			-- handler would, as it is in the game: the timeline widget takes it and
			-- switches the ghosts widget through WG.
			local timeline
			for _, other in ipairs(widgetHandler.widgets) do
				if other.whInfo and other.whInfo.name == TIMELINE then
					timeline = other
				end
			end
			local none = { alt = false, ctrl = false, meta = false, shift = false }
			local taken = timeline and timeline:KeyPress(Spring.GetKeyCode("g"), none, false)
			local off = drawn(w)
			local saved = w:GetConfigData()
			local back = timeline and timeline:KeyPress(Spring.GetKeyCode("g"), none, false)
			local on = drawn(w)
			say(
				string.format(
					"toggle taken=%d ghosts_off=%d show_off=%s taken_again=%d ghosts_on=%d",
					taken and 1 or 0,
					#off,
					tostring(saved and saved.show),
					back and 1 or 0,
					#on
				)
			)
		end
		at = at + 1
		sent = false
	end
end
