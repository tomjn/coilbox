-- Coilbox rewind player: the terrain stage.
--
-- A track has a row for each height that changed: the frame, the corner, the
-- height before and the height after (docs/reference/replay-track-format.md).
-- The stage makes the engine's ground the track's at `t`.
--
-- What a seek costs is the engine's work after a change more than the heights
-- (issue #4025). After each Spring.SetHeightMapFunc call the engine works the
-- ground out again over the rectangle round every corner the call set: the
-- normals, the slope map, line of sight and the pathfinder
-- (CBasicMapDamage::RecalcArea). Corners set far apart in one call make it work
-- out most of the map. So the stage sets the ground a tile at a time, one call
-- for each tile, and only for tiles that have a change between the two times.
--
-- The rows of the whole track are read once, when the stage is made, into lists
-- by corner and by tile. A corner's height at any frame is then a search in its
-- own list, so a seek needs only the ground at the new time and none of the
-- changes in between, and nothing is read in a frame.
--
-- A seek marks the tiles that change between the two times, and a frame sets as
-- many of them as the ground budget allows, which the gadget's unsynced half
-- works out from the time a frame took (coilbox_rewind_player.lua). The ground
-- takes its share of a frame first and the units stage has what is left, so the
-- ground of a seek is in place before any unit is made on it. A frame of play
-- sets the tiles its rows change at once, whatever the budget, so a crater is in
-- the ground on its frame.
--
-- A frame allocates nothing: every list is made when the stage is.

local M = {}

local Terrain = {}
Terrain.__index = Terrain

local floor, min, max = math.floor, math.min, math.max

--- Corners along a side of a tile. The engine's work after a call grows with
-- the area of the rectangle the call touched, and each call has a cost of its
-- own. lua/rewind-player/README.md has the measurements this was chosen from.
M.TILE = 32

--- The first position from `first`, of `count` entries of `list` in order,
-- whose value is above `value`, or `first + count` when there is none.
local function after(list, first, count, value)
	local lo, hi = first, first + count
	while lo < hi do
		local mid = floor((lo + hi) / 2)
		if list[mid] > value then
			hi = mid
		else
			lo = mid + 1
		end
	end
	return lo
end

--- Every window's rows in the order of the track: each row's frame, x, z,
-- height before and height after, and how many there are.
local function readAll(context, track)
	local frame, xs, zs, before, later, n = {}, {}, {}, {}, {}, 0
	for k = 0, track.header.windowCount - 1 do
		local rows, why = track:terrain(k)
		if not rows then
			context.report("terrain " .. k, "the terrain of window " .. k .. " cannot be read (" .. tostring(why) .. "), so its changes are left out")
		else
			for i = 1, rows.count do
				n = n + 1
				frame[n], xs[n], zs[n], before[n], later[n] = rows.frame[i], rows.x[i], rows.z[i], rows.before[i], rows.after[i]
			end
		end
	end
	return frame, xs, zs, before, later, n
end

--- `context` is the player's (see coilbox_player.lua).
function M.new(context)
	local Spring = context.Spring
	local track = context.track
	local square = context.Game.squareSize
	local tile = M.TILE
	local rowFrame, rowX, rowZ, rowBefore, rowAfter, n = readAll(context, track)

	-- Number the corners and the tiles in the order they first change. Corners
	-- are looked up by z and then x, since a key of the two together would not
	-- fit the engine's 32 bit numbers.
	local cornerAt, tileAt = {}, {}
	local cornerX, cornerZ, cornerOwn, cornerTile, cornerRows = {}, {}, {}, {}, {}
	local tileCorners, tileRows = {}, {}
	local rowCorner, rowTile = {}, {}
	local corners, tiles = 0, 0
	for i = 1, n do
		local x, z = rowX[i], rowZ[i]
		local column = cornerAt[z]
		if not column then
			column = {}
			cornerAt[z] = column
		end
		local c = column[x]
		if not c then
			corners = corners + 1
			c = corners
			column[x] = c
			cornerX[c], cornerZ[c] = x, z
			-- A corner's height before its first row is the map's own (the format
			-- page's rule 3).
			cornerOwn[c] = rowBefore[i]
			cornerRows[c] = 0
			local tx, tz = floor(x / tile), floor(z / tile)
			local tileColumn = tileAt[tz]
			if not tileColumn then
				tileColumn = {}
				tileAt[tz] = tileColumn
			end
			local k = tileColumn[tx]
			if not k then
				tiles = tiles + 1
				k = tiles
				tileColumn[tx] = k
				tileCorners[k], tileRows[k] = 0, 0
			end
			cornerTile[c] = k
			tileCorners[k] = tileCorners[k] + 1
		end
		local k = cornerTile[c]
		rowCorner[i], rowTile[i] = c, k
		cornerRows[c] = cornerRows[c] + 1
		tileRows[k] = tileRows[k] + 1
	end

	-- Each corner's rows together in order of frame, each tile's corners
	-- together, and each tile's row frames together in order.
	local cornerFirst, tileFirst, tileFrameFirst = {}, {}, {}
	local at = 1
	for c = 1, corners do
		cornerFirst[c] = at
		at = at + cornerRows[c]
	end
	local cornerAt2, frameAt = 1, 1
	for k = 1, tiles do
		tileFirst[k] = cornerAt2
		cornerAt2 = cornerAt2 + tileCorners[k]
		tileFrameFirst[k] = frameAt
		frameAt = frameAt + tileRows[k]
	end
	local byCornerFrame, byCornerHeight, tileList, tileFrames = {}, {}, {}, {}
	local cornerFill, tileFill, frameFill = {}, {}, {}
	for k = 1, tiles do
		tileFill[k], frameFill[k] = 0, 0
	end
	for c = 1, corners do
		cornerFill[c] = cornerFirst[c]
		local k = cornerTile[c]
		tileList[tileFirst[k] + tileFill[k]] = c
		tileFill[k] = tileFill[k] + 1
	end
	for i = 1, n do
		local c, k = rowCorner[i], rowTile[i]
		local slot = cornerFill[c]
		cornerFill[c] = slot + 1
		byCornerFrame[slot], byCornerHeight[slot] = rowFrame[i], rowAfter[i]
		tileFrames[tileFrameFirst[k] + frameFill[k]] = rowFrame[i]
		frameFill[k] = frameFill[k] + 1
	end

	-- The tiles a seek still has to set, as a ring with a place for every tile.
	-- `marked` says a tile has to be set and `queued` that it is in the ring,
	-- since a tile play has set since stays in the ring and is passed over.
	-- Play's tiles have a list of their own.
	local ring, marked, queued, urgent, isUrgent = {}, {}, {}, {}, {}
	for k = 1, tiles do
		ring[k], marked[k], queued[k], urgent[k], isUrgent[k] = 0, false, false, 0, false
	end

	local self = setmetatable({
		Spring = Spring,
		tile = tile,
		-- The rows in the order of the track: each one's frame and tile.
		rowFrame = rowFrame,
		rowTile = rowTile,
		rowCount = n,
		cornerX = cornerX,
		cornerZ = cornerZ,
		cornerOwn = cornerOwn,
		cornerFirst = cornerFirst,
		cornerRows = cornerRows,
		byCornerFrame = byCornerFrame,
		byCornerHeight = byCornerHeight,
		tiles = tiles,
		tileFirst = tileFirst,
		tileCorners = tileCorners,
		tileList = tileList,
		tileFrameFirst = tileFrameFirst,
		tileRows = tileRows,
		tileFrames = tileFrames,
		ring = ring,
		ringFirst = 1,
		ringCount = 0,
		marked = marked,
		queued = queued,
		urgent = urgent,
		isUrgent = isUrgent,
		urgentCount = 0,
		-- The frame the ground is moving to. Every tile that is not marked has the
		-- track's ground at it. Window 0 holds the rows on the first frame, so the
		-- first move forward starts from the frame before it.
		walked = track.header.firstFrame - 1,
		-- The most corners a frame of a seek sets, and how many this frame set.
		budget = math.huge,
		done = 0,
		unsettled = false,
		-- The share of a frame's time the ground used, which the units stage adds
		-- its own to (see coilbox_player_units.lua).
		share = context.share,
		-- The tile and the frame the function handed to the engine sets.
		current = 0,
		frame = 0,
	}, Terrain)

	-- Made once, so that a frame makes no function. Sets every corner of tile
	-- `self.current` to the track's height at `self.frame`. A corner of the tile
	-- is set even when its height is already that, so a crater the playback's own
	-- engine made there is put right as well.
	local setHeightMap = Spring.SetHeightMap
	self.setTile = function()
		local k, f = self.current, self.frame
		local first = tileFirst[k]
		local x1, x2, z1, z2 = math.huge, -1, math.huge, -1
		for slot = first, first + tileCorners[k] - 1 do
			local c = tileList[slot]
			local start = cornerFirst[c]
			local last = after(byCornerFrame, start, cornerRows[c], f) - 1
			local height = cornerOwn[c]
			if last >= start then
				height = byCornerHeight[last]
			end
			local x, z = cornerX[c], cornerZ[c]
			setHeightMap(x * square, z * square, height)
			x1, x2, z1, z2 = min(x1, x), max(x2, x), min(z1, z), max(z2, z)
		end
		-- The engine skips a rectangle of no area (CBasicMapDamage::RecalcArea),
		-- so corners in one row or one column would never be worked out again. A
		-- corner beside them is touched with a change of nothing, which widens it.
		if x1 == x2 or z1 == z2 then
			setHeightMap((x1 > 0 and x1 - 1 or x1 + 1) * square, (z1 > 0 and z1 - 1 or z1 + 1) * square, 0, 0)
		end
	end
	return self
end

--- Sets the most corners a frame of a seek may set. A frame sets at least one
-- tile whatever it is.
function Terrain:setBudget(corners)
	self.budget = max(1, corners)
end

function Terrain:resync() end

--- Whether tile `k` has a row after `lo` and up to `hi`.
local function changes(self, k, lo, hi)
	local first, frames = self.tileFrameFirst[k], self.tileFrames
	local i = after(frames, first, self.tileRows[k], lo)
	return i < first + self.tileRows[k] and frames[i] <= hi
end

local function mark(self, k)
	self.marked[k] = true
	if not self.queued[k] then
		self.queued[k] = true
		self.ring[(self.ringFirst + self.ringCount - 1) % self.tiles + 1] = k
		self.ringCount = self.ringCount + 1
	end
end

local function set(self, k, f)
	self.current, self.frame = k, f
	self.Spring.SetHeightMapFunc(self.setTile)
end

--- Moves the ground to `t`. Terrain has nothing to create, so all its work is
-- here, before the other stages put anything on the ground.
function Terrain:remove(t, clock)
	local to = floor(t)
	local from = self.walked
	self.done = 0
	if to ~= from then
		local lo, hi = min(from, to), max(from, to)
		if clock.jumped then
			-- A seek or a step: every tile with a change between the two times, as
			-- the budget allows.
			for k = 1, self.tiles do
				if changes(self, k, lo, hi) then
					mark(self, k)
				end
			end
		else
			-- Play: the tiles of the rows played through, in this frame.
			local frames, tileOf, urgent, isUrgent = self.rowFrame, self.rowTile, self.urgent, self.isUrgent
			local i = after(frames, 1, self.rowCount, lo)
			while i <= self.rowCount and frames[i] <= hi do
				local k = tileOf[i]
				if not isUrgent[k] then
					isUrgent[k] = true
					self.urgentCount = self.urgentCount + 1
					urgent[self.urgentCount] = k
				end
				i = i + 1
			end
		end
		self.walked = to
	end

	for i = 1, self.urgentCount do
		local k = self.urgent[i]
		self.isUrgent[k] = false
		-- A tile set now is the track's at `to`, so a seek has nothing left in it.
		self.marked[k] = false
		set(self, k, to)
	end
	self.urgentCount = 0

	local budget, ring, marked, queued = self.budget, self.ring, self.marked, self.queued
	while self.ringCount > 0 and self.done < budget do
		local first = self.ringFirst
		local k = ring[first]
		self.ringFirst = first % self.tiles + 1
		self.ringCount = self.ringCount - 1
		queued[k] = false
		if marked[k] then
			marked[k] = false
			set(self, k, to)
			self.done = self.done + self.tileCorners[k]
		end
	end
	-- A ring of tiles play has already set holds nothing to do.
	local left = false
	for i = 0, self.ringCount - 1 do
		if marked[ring[(self.ringFirst + i - 1) % self.tiles + 1]] then
			left = true
			break
		end
	end
	self.unsettled = left
	self.share.ground = self.done / budget
end

function Terrain:place() end

return M
