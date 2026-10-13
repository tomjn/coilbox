-- Presses the timeline's keys and drags its knob in a real engine, and says
-- what the player then publishes.
--
-- The ignored Rust test the_timeline_drives_the_player_in_the_engine writes
-- this file into luaui/widgets/ of the playback game it has just generated,
-- launches a headless engine on it and reads the TIMELINE_PROBE lines back out
-- of the log. It is not part of the game coilbox ships.
--
-- It finds the timeline in the game's own widget handler, which is the proof
-- that the handler loaded it and turned it on, and calls the call-ins the
-- handler would for a key or a press. A parameter that then changes went the
-- whole way round: the widget's message, the network, the synced gadget and
-- the parameter back. A headless engine draws nothing, so a draw that does not
-- raise is all that can be said about drawing here.
--
-- Every line is a measurement. The test decides what passes.

function widget:GetInfo()
	return { name = "Coilbox rewind timeline probe", layer = 1000, enabled = true, handler = true }
end

local TAG = "TIMELINE_PROBE "
local TIMELINE = "Coilbox rewind timeline"

-- How many simulation frames a step may take before the probe gives up on it
-- and says so. A message is back within a few.
local PATIENCE = 150

-- The view the timeline is laid out in for the run.
local VIEW_X, VIEW_Y = 1280, 720

local NONE = { alt = false, ctrl = false, meta = false, shift = false }
local SHIFT = { alt = false, ctrl = false, meta = false, shift = true }
local CTRL = { alt = false, ctrl = true, meta = false, shift = false }

local function say(text)
	Spring.Echo(TAG .. text)
end

local function param(name)
	return Spring.GetGameRulesParam("coilbox_rewind_" .. name)
end

local function timeline()
	for _, w in ipairs(widgetHandler.widgets) do
		if w.whInfo and w.whInfo.name == TIMELINE then
			return w
		end
	end
end

local function flag(value)
	return value and 1 or 0
end

local function state()
	return string.format(
		"frame=%s playing=%s direction=%s speed=%s",
		tostring(param("frame")),
		tostring(param("playing")),
		tostring(param("direction")),
		tostring(param("speed"))
	)
end

local function press(name, mods)
	return timeline():KeyPress(Spring.GetKeyCode(name), mods or NONE, false)
end

local first, last

-- Each step does something and names what the player should then publish. The
-- probe waits for that, and says what it found either way.
local steps = {
	{
		name = "toggle",
		act = function()
			return press("space")
		end,
		want = function()
			return param("playing") == 1
		end,
	},
	{
		name = "pause",
		act = function()
			return press("space")
		end,
		want = function()
			return param("playing") == 0
		end,
	},
	{
		name = "end",
		act = function()
			return press("end")
		end,
		want = function()
			return param("frame") == last
		end,
	},
	{
		name = "home",
		act = function()
			return press("home")
		end,
		want = function()
			return param("frame") == first
		end,
	},
	{
		name = "right",
		act = function()
			return press("right")
		end,
		want = function()
			return param("frame") == first + param("frames_per_second")
		end,
	},
	{
		name = "shift_right",
		act = function()
			return press("right", SHIFT)
		end,
		want = function()
			return param("frame") == first + 11 * param("frames_per_second")
		end,
	},
	{
		name = "shift_left",
		act = function()
			return press("left", SHIFT)
		end,
		want = function()
			return param("frame") == first + param("frames_per_second")
		end,
	},
	{
		name = "left",
		act = function()
			return press("left")
		end,
		want = function()
			return param("frame") == first
		end,
	},
	{
		name = "full_stop",
		act = function()
			return press(".")
		end,
		want = function()
			return param("frame") == first + 1
		end,
	},
	{
		name = "comma",
		act = function()
			return press(",")
		end,
		want = function()
			return param("frame") == first
		end,
	},
	{
		name = "minus",
		act = function()
			return press("-")
		end,
		want = function()
			return param("speed") == 0.5
		end,
	},
	{
		name = "equals",
		act = function()
			return press("=")
		end,
		want = function()
			return param("speed") == 1
		end,
	},
	{
		name = "plus",
		act = function()
			return press("+")
		end,
		want = function()
			return param("speed") == 2
		end,
	},
	{
		name = "ctrl_space",
		act = function()
			return press("space", CTRL)
		end,
		-- Nothing should change, so there is nothing to wait for.
		want = function()
			return true
		end,
	},
	{
		name = "drag",
		act = function()
			-- A timeline of the probe's own, for where the bar is. The widget's
			-- is in the same place, since nothing has moved it.
			local Timeline = VFS.Include("luaui/rewind_timeline/coilbox_timeline.lua", nil, VFS.ZIP)
			local own = Timeline.new({ Spring = Spring, gl = gl, GL = GL, VFS = VFS })
			own:resize(VIEW_X, VIEW_Y)
			local bar = own.rects.bar
			local x, y = (bar.x1 + bar.x2) / 2, (bar.y1 + bar.y2) / 2
			local w = timeline()
			-- A headless engine's view is 8 pixels square, which no panel fits
			-- in. The timeline is told of a view a window could have, the way
			-- the handler tells it of a resize.
			w:ViewResize(VIEW_X, VIEW_Y)
			local above = w:IsAbove(x, y)
			local taken = w:MousePress(x, y, 1)
			w:MouseRelease(x, y, 1)
			return taken and above
		end,
		want = function()
			return param("frame") == math.floor(first + (last - first) / 2 + 0.5)
		end,
	},
	{
		name = "reverse",
		act = function()
			return press("r")
		end,
		want = function()
			return param("direction") == -1 and param("playing") == 1
		end,
	},
}

local at = 0
local waiting
local deadline
local finished = false

local function start()
	local w = timeline()
	first, last = param("first_frame"), param("last_frame")
	say(string.format("loaded=%d first=%s last=%s %s", flag(w), tostring(first), tostring(last), state()))
	if not w then
		return false
	end
	local vsx, vsy = Spring.GetViewGeometry()
	say(string.format("view width=%d height=%d", vsx, vsy))
	-- What the game and the engine have on the timeline's keys, for a person
	-- to read: the commands a key would have run had the timeline not taken it.
	for _, key in ipairs({ "space", "r", "left", "right", ",", ".", "home", "end", "[", "]", "-", "=", "+" }) do
		local commands = {}
		for _, binding in ipairs(Spring.GetKeyBindings(key) or {}) do
			commands[#commands + 1] = tostring(binding.command)
		end
		say(string.format("bound key=%s code=%s commands=%s", key, tostring(Spring.GetKeyCode(key)), table.concat(commands, "|")))
	end
	return true
end

-- How many times the handler asked the widgets to draw. A headless engine does
-- ask, and its gl calls do nothing. The handler takes a widget out when a
-- call-in of it raises, so a timeline that is still there at the end drew this
-- many times without raising.
local draws = 0

function widget:DrawScreen()
	draws = draws + 1
end

function widget:Update()
	if finished then
		return
	end
	local frame = Spring.GetGameFrame()
	if at == 0 then
		-- The player publishes its state on its first frame.
		if type(param("first_frame")) ~= "number" then
			if frame > PATIENCE then
				say("loaded=" .. flag(timeline()) .. " no_player=1")
				say("done")
				finished = true
			end
			return
		end
		if not start() then
			say("done")
			finished = true
			return
		end
		at = 1
	end
	local step = steps[at]
	if not step then
		local w = timeline()
		local saved = w and w:GetConfigData()
		say(string.format("still_loaded=%d config=%s draws=%d", flag(w), type(saved), draws))
		say("done")
		finished = true
		return
	end
	if not waiting then
		waiting = { taken = step.act() }
		deadline = frame + PATIENCE
		return
	end
	local arrived = step.want()
	if arrived or frame > deadline then
		say(string.format("%s taken=%d arrived=%d %s", step.name, flag(waiting.taken), flag(arrived), state()))
		waiting = nil
		at = at + 1
	end
end
