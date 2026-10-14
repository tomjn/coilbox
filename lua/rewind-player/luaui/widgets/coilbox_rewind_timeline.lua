-- Coilbox rewind timeline: the control for the time the player holds (issue
-- #3798).
--
-- Coilbox generates a game that depends on the game a replay was recorded on,
-- and the player gadget in it plays the replay's track back. This widget draws
-- a bar with the time on it, buttons and a knob, and sends the gadget a message
-- for a click or a key. The work is in luaui/rewind_timeline/coilbox_timeline.lua
-- and this file is the engine's side of it: the call-ins.
--
-- A game's own widget handler loads this. Every handler that comes from the
-- engine's reads luaui/widgets/ out of the game and its dependencies, and turns
-- on a widget it has not seen before when `enabled` is true. The layer is the
-- lowest a number can be, so that a key reaches this before any other widget
-- and the bar is drawn over them.
--
-- A key the timeline takes is handed back as taken, so the engine does not go
-- on to the game's own binding for it, its pause included. The player's pause
-- is its own, and the engine has to keep running for the world to move.
--
-- Change this in the coilbox repository under lua/rewind-player/.

function widget:GetInfo()
	return {
		name = "Coilbox rewind timeline",
		desc = "Seeks, reverses and changes the speed of a replay being played back.",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = -math.huge,
		enabled = true,
	}
end

local timeline
-- What the widget handler kept from last time, which it hands over before
-- Initialize.
local saved

function widget:Initialize()
	-- What the engine has comes first. A widget that lacks a call it cannot do
	-- without does not start, and says which.
	local found, Engine = pcall(VFS.Include, "luaui/rewind_timeline/coilbox_timeline_engine.lua", nil, VFS.ZIP)
	if not found then
		Spring.Echo("COILBOX_REWIND_TIMELINE failed: " .. tostring(Engine))
		return
	end
	local engine = Engine.check({ Spring = Spring, gl = gl, GL = GL, VFS = VFS })
	for _, line in ipairs(engine.lines) do
		Spring.Echo(line)
	end
	if engine.refused then
		return
	end
	local ok, Timeline = pcall(VFS.Include, "luaui/rewind_timeline/coilbox_timeline.lua", nil, VFS.ZIP)
	if not ok then
		Spring.Echo("COILBOX_REWIND_TIMELINE failed: " .. tostring(Timeline))
		return
	end
	local made = Timeline.new({ Spring = Spring, gl = gl, GL = GL, WG = WG, VFS = engine.on.marks and VFS or nil })
	made:setConfig(saved)
	made:resize(Spring.GetViewGeometry())
	timeline = made
end

function widget:GetConfigData()
	if timeline then
		return timeline:config()
	end
	return saved
end

function widget:SetConfigData(data)
	saved = data
	if timeline then
		timeline:setConfig(data)
	end
end

function widget:ViewResize(vsx, vsy)
	if not timeline then
		return
	end
	if not vsy then
		vsx, vsy = Spring.GetViewGeometry()
	end
	timeline:resize(vsx, vsy)
end

function widget:DrawScreen()
	if timeline then
		timeline:draw()
	end
end

function widget:KeyPress(key, mods, isRepeat)
	return timeline ~= nil and timeline:keyPress(key, mods, isRepeat)
end

function widget:IsAbove(x, y)
	return timeline ~= nil and timeline:isAbove(x, y)
end

function widget:GetTooltip(x, y)
	return timeline and timeline:tooltip(x, y) or ""
end

function widget:MousePress(x, y, button)
	return timeline ~= nil and timeline:mousePress(x, y, button)
end

function widget:MouseMove(x, y)
	if timeline then
		timeline:mouseMove(x, y)
	end
end

function widget:MouseRelease()
	if timeline then
		timeline:mouseRelease()
	end
end

--- A widget that is switched off in the middle of a drag ends the drag, so
-- that the player does not wait for the end of one for good.
function widget:Shutdown()
	if timeline then
		timeline:mouseRelease()
	end
end
