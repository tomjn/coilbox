function widget:GetInfo()
  return {
    name = "Persepolis opening camera",
    desc = "Turns the camera to look straight down once, when the game starts, so the towers hide fewer units",
    author = "AF",
    license = "GNU GPL, v2 or later",
    layer = 0,
    enabled = true,
  }
end

-- Only the angle changes. The camera keeps its type, place and zoom, and the
-- player can tilt it again straight away.
local function lookDown()
  local s = Spring.GetCameraState()
  if s.name == "spring" or s.name == "rot" or s.name == "fps" then
    -- Each camera stops short of straight down at its own limit.
    s.rx = math.pi
  elseif s.name == "ta" then
    -- The overhead camera's angle is measured from straight down.
    s.angle = 0
  else
    Spring.Echo("Persepolis: left the " .. tostring(s.name) .. " camera's angle alone")
    return
  end
  Spring.SetCameraState(s, 0)
  Spring.Echo("Persepolis: the opening " .. s.name .. " camera looks straight down")
end

-- A reload or a rejoin in a running game leaves the camera alone.
function widget:Initialize()
  if Spring.GetGameFrame() > 0 then
    widgetHandler:RemoveWidget(self)
  end
end

-- The first frame rather than GameStart, which Splinter Faction 0.1.97 was
-- not seen to pass to this widget.
function widget:GameFrame()
  lookDown()
  widgetHandler:RemoveWidget(self)
end
