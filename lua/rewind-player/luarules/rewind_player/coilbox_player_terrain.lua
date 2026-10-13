-- Coilbox rewind player: the terrain stage.
--
-- A track has a row for each height that changed: the frame, the corner, the
-- height before and the height after. Moving forward in time sets each corner
-- to its height after, and moving back sets it to its height before, in reverse
-- order. The stage remembers the frame the ground shows and moves it from there
-- to `t`, through the terrain chunks of every window in between.
--
-- A row belongs to one window. Window 0 holds the rows from the track's first
-- frame to its own last frame, and every later window the rows after its first
-- frame up to its last (docs/reference/replay-track-format.md).
--
-- The rows of one window are kept, so playing inside a window reads nothing. A
-- seek across many windows reads the terrain chunk of each, which is what the
-- chunk is separate for.

local M = {}

local Terrain = {}
Terrain.__index = Terrain

local floor, ceil, min = math.floor, math.ceil, math.min

--- `context` is the player's (see coilbox_player.lua). `reader` is
-- coilbox_track.lua.
function M.new(context, reader)
	local Spring = context.Spring
	local header = context.track.header
	local square = context.Game.squareSize
	local setHeightMap = Spring.SetHeightMap
	local applyTerrain = reader.applyTerrain

	-- Made once, so a frame of play makes no function. A row's x and z count
	-- heightmap corners and the engine takes elmos.
	local function set(x, z, height)
		setHeightMap(x * square, z * square, height)
	end
	local function move(rows, from, to)
		applyTerrain(rows, from, to, set)
	end

	return setmetatable({
		context = context,
		track = context.track,
		Spring = Spring,
		move = move,
		first = header.firstFrame,
		length = header.windowLength,
		lastWindow = header.windowCount - 1,
		-- The frame the ground shows. Window 0 holds the rows on the first frame,
		-- so the first move forward starts from the frame before it.
		shown = header.firstFrame - 1,
		-- The one window whose rows are kept.
		keptWindow = nil,
		keptRows = nil,
		badWindow = nil,
	}, Terrain)
end

--- The window that holds the rows of `frame`.
local function windowOfRow(self, frame)
	if frame <= self.first then
		return 0
	end
	return min(ceil((frame - self.first) / self.length) - 1, self.lastWindow)
end

--- The terrain rows of window `k`, or nil when it has none or cannot be read.
local function rowsOf(self, k)
	if self.keptWindow ~= k then
		local rows, why = self.track:terrain(k)
		if not rows then
			if self.badWindow ~= k then
				self.badWindow = k
				self.context.report("terrain " .. k, "the terrain of window " .. k .. " cannot be read (" .. tostring(why) .. "), so its changes are left out")
			end
			return nil
		end
		self.keptWindow, self.keptRows = k, rows
	end
	local rows = self.keptRows
	if rows.count > 0 then
		return rows
	end
end

function Terrain:resync() end

--- Moves the ground to `t`. Terrain has nothing to create, so all its work is
-- here, before the other stages put anything on the ground.
function Terrain:remove(t)
	local to = floor(t)
	local from = self.shown
	if to == from then
		return
	end
	local Spring, move = self.Spring, self.move
	if to > from then
		for k = windowOfRow(self, from + 1), windowOfRow(self, to) do
			local rows = rowsOf(self, k)
			if rows then
				Spring.SetHeightMapFunc(move, rows, from, to)
			end
		end
	else
		for k = windowOfRow(self, from), windowOfRow(self, to + 1), -1 do
			local rows = rowsOf(self, k)
			if rows then
				Spring.SetHeightMapFunc(move, rows, from, to)
			end
		end
	end
	self.shown = to
end

function Terrain:place() end

return M
