-- Coilbox rewind player: where the viewer looks (issue #4008).
--
-- After a seek the player makes the units a viewer is looking at first. The
-- player is synced Lua and cannot see the camera, so the unsynced half of the
-- gadget works the view out here and sends it as a Lua message, the way it
-- sends the frame budget.
--
-- The view is the place on the ground in the middle of the screen, and the
-- places on the ground at the screen's four corners, going round. A corner
-- that looks past the edge of the map is where its ray meets the level of the
-- middle. A corner that looks at the sky is nowhere, and the view is then the
-- middle alone. A camera whose middle looks at the sky has no view.
--
-- It is looked at once a simulation frame, which is five rays, and sent only
-- when it has moved by more than a share of the camera's distance from the
-- place it looks at. The player sorts the units still to be made each time a
-- view arrives while a seek settles, so a camera that drifts does not make it
-- sort every frame.
--
-- The engine is handed in, and nothing here reaches for a global of it, so the
-- tests run the same file on a stand-in.

local M = {}

--- What the message starts with, which is `Player.VIEW` in coilbox_player.lua.
M.MESSAGE = "coilbox_rewind_view:"

--- A view is sent again when its middle or a corner has moved more than this
-- share of the distance from the camera to the middle. It is a choice and not
-- a measurement: a smaller share follows the camera more closely and makes the
-- player sort more often while a seek settles.
M.SHARE = 1 / 16

local View = {}
View.__index = View

local floor, sqrt, abs = math.floor, math.sqrt, math.abs

--- A view of the camera `Spring` has.
function M.new(Spring)
	return setmetatable({
		Spring = Spring,
		-- What was last sent: "none", "middle" or "corners", and the numbers.
		sent = nil,
		last = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		now = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
	}, View)
end

--- Where the ray through a pixel meets the ground, or the level plane at
-- `level` when it misses the ground and `level` is given. Gives x and z, or
-- nothing. The water is looked through, because the engine takes a ray that
-- ends above the water plane to have missed it and the ground with it.
local function ground(Spring, sx, sy, level)
	local kind, place = Spring.TraceScreenRay(sx, sy, true, false, level ~= nil, true, level)
	if kind == "ground" then
		return place[1], place[3]
	end
	-- A ray that never meets the plane comes back as a place that is not on it.
	if kind == "sky" and abs(place[5] - level) < 0.5 and place[4] == place[4] and abs(place[4]) < math.huge and abs(place[6]) < math.huge then
		return place[4], place[6]
	end
end

--- Looks at the camera. Gives the message to send, or nil when the view has
-- not moved enough to say so again.
function View:poll()
	local Spring = self.Spring
	local wide, high = Spring.GetViewGeometry()
	local kind, middle = Spring.TraceScreenRay(floor(wide / 2), floor(high / 2), true, false, false, true)
	if kind ~= "ground" then
		if self.sent == "none" then
			return nil
		end
		self.sent = "none"
		return M.MESSAGE .. "none"
	end
	local now, last = self.now, self.last
	now[1], now[2] = middle[1], middle[3]
	local level = middle[2]
	local shape = "corners"
	for corner = 0, 3 do
		-- Round the screen: two corners of one edge, then the two of the other.
		local sx = (corner == 1 or corner == 2) and wide - 1 or 0
		local sy = corner >= 2 and high - 1 or 0
		local x, z = ground(Spring, sx, sy, level)
		if not x then
			shape = "middle"
			break
		end
		now[3 + corner * 2], now[4 + corner * 2] = x, z
	end

	local count = shape == "corners" and 10 or 2
	local moved = self.sent ~= shape
	if not moved then
		local cx, cy, cz = Spring.GetCameraPosition()
		local dx, dy, dz = cx - now[1], cy - level, cz - now[2]
		local allowed = M.SHARE * sqrt(dx * dx + dy * dy + dz * dz)
		for i = 1, count, 2 do
			local mx, mz = now[i] - last[i], now[i + 1] - last[i + 1]
			if mx * mx + mz * mz > allowed * allowed then
				moved = true
				break
			end
		end
	end
	if not moved then
		return nil
	end
	self.sent = shape
	for i = 1, count do
		last[i] = floor(now[i] + 0.5)
	end
	if shape == "middle" then
		return string.format("%s%d %d", M.MESSAGE, last[1], last[2])
	end
	return string.format("%s%d %d %d %d %d %d %d %d %d %d", M.MESSAGE, last[1], last[2], last[3], last[4], last[5], last[6], last[7], last[8], last[9], last[10])
end

return M
