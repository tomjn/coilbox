-- Hands the timeline's speed keys to Beyond All Reason's widget handler with the
-- actions the game binds to them, in a real engine, and says what then moved
-- (issue #4027).
--
-- The ignored Rust test beyond_all_reasons_speed_keys_reach_the_timeline writes
-- this file into luaui/widgets/ of the playback game, launches a headless
-- engine on it and reads the VOLUME_PROBE lines back out of the log. It is not
-- part of the game coilbox ships.
--
-- Beyond All Reason's handler runs the widget actions bound to a key before it
-- asks any widget for the key, so the call here goes through the handler's own
-- KeyPress and not the timeline's, with the actions that
-- luaui/configs/hotkeys/grid_keys.txt binds to the key. Every line is a
-- measurement. The test decides what passes.

function widget:GetInfo()
	return { name = "Coilbox rewind volume keys probe", layer = 1000, enabled = true, handler = true }
end

local TAG = "VOLUME_PROBE "
local TIMELINE = "Coilbox rewind timeline"

-- How many simulation frames a key may take before the probe gives up on it.
local PATIENCE = 150

local NONE = { alt = false, ctrl = false, meta = false, shift = false }

local function say(text)
	Spring.Echo(TAG .. text)
end

local function param(name)
	return Spring.GetGameRulesParam("coilbox_rewind_" .. name)
end

local function loaded(name)
	for _, w in ipairs(widgetHandler.widgets) do
		if w.whInfo and w.whInfo.name == name then
			return true
		end
	end
	return false
end

local function volume()
	return Spring.GetConfigInt("snd_volmaster", -1)
end

-- The key, and the actions grid_keys.txt binds to it.
local steps = {
	{ name = "minus", key = "-", action = "snd_volume_decrease" },
	{ name = "equals", key = "=", action = "snd_volume_increase" },
	{ name = "plus", key = "+", action = "snd_volume_increase" },
}

local at = 0
local waiting
local finished = false

local function state()
	return string.format("volume=%s speed=%s", tostring(volume()), tostring(param("speed")))
end

function widget:Update()
	if finished then
		return
	end
	local frame = Spring.GetGameFrame()
	if at == 0 then
		if type(param("first_frame")) ~= "number" then
			if frame > PATIENCE then
				say("no_player=1")
				say("done")
				finished = true
			end
			return
		end
		say(string.format("start timeline=%d volume_osd=%d %s", loaded(TIMELINE) and 1 or 0, loaded("Volume OSD") and 1 or 0, state()))
		at = 1
	end
	local step = steps[at]
	if not step then
		say("done")
		finished = true
		return
	end
	if not waiting then
		local before = param("speed")
		local actions = { { command = step.action, extra = "" } }
		local taken = widgetHandler:KeyPress(Spring.GetKeyCode(step.key), NONE, false, step.key, nil, nil, actions)
		waiting = { before = before, taken = taken, deadline = frame + PATIENCE }
		return
	end
	-- The timeline's message takes a few frames to come back as the speed.
	if param("speed") ~= waiting.before or frame > waiting.deadline then
		say(string.format("%s taken=%d speed_before=%s %s", step.name, waiting.taken and 1 or 0, tostring(waiting.before), state()))
		waiting = nil
		at = at + 1
	end
end
