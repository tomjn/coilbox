-- The skeleton of a unit from engine data alone (issue #5179).
--
-- Pure. The widget hands in what it read from the engine, so the tests run
-- this with plain luajit. Nothing here touches `gl` or `Spring`.
--
-- A piece's bone runs from its origin, the point it turns about, to the far
-- end of its geometry (boneEnd). Every piece gets a dot at its origin and a
-- line to its parent's origin, so an empty piece still shows as a joint.

local M = {}

-- 0xe879f9, the builder's skeleton colour (src/lego/pages/components/skeletonLayer.ts).
M.COLOR = { 232 / 255, 121 / 255, 249 / 255 }
-- How opaque each mark is. The bone matches the builder's 0.95. The line to
-- the parent is dimmer, so the bones read first.
M.BONE_ALPHA = 0.95
M.PARENT_ALPHA = 0.55
M.DOT_ALPHA = 0.95
-- Half the width of each line on screen, in pixels of a view 1080 tall. The
-- bone is wider than the line to the parent. Lines are strips of two
-- triangles, because macOS draws GL.LINES one pixel wide whatever is asked.
M.BONE_WIDTH = 3
M.PARENT_WIDTH = 1.5

-- Numbers per vertex: position, colour, corner, then the other end of its
-- line and the line's half width. A line's corner is the side, -1 or 1, the
-- vertex shader moves it to. A dot's corners run from -1 to 1 and its half
-- width is 0, which tells the shader it is a dot.
M.STRIDE = 13

-- Which axis wins when two are as long as each other and reach as far from
-- the origin: z first, the way a unit faces, then y, then x.
local AXIS_ORDER = { 3, 2, 1 }

--- The far end of a piece's geometry, in the piece's own space, from its box.
--
-- The rule: take the axis the box is longest along (max - min). The end is
-- the middle of the box face on that axis that lies farther from the origin.
-- Being the middle of a face, it keeps the box's offset on the other two
-- axes, so a barrel mounted above its pivot gets a bone that points at the
-- barrel, not along the axis through the pivot.
--
-- Ties: between axes of the same length, the one whose far face lies farther
-- from the origin, then z, y, x. Between two faces as far from the origin as
-- each other, the one on the positive side.
--
-- @param min table {x, y, z}
-- @param max table {x, y, z}
-- @return table|nil {x, y, z}, nil when the box is a point at the origin
function M.boneEnd(min, max)
	local best, bestLength, bestReach
	for _, axis in ipairs(AXIS_ORDER) do
		local length = max[axis] - min[axis]
		local reach = math.max(math.abs(min[axis]), math.abs(max[axis]))
		if not best or length > bestLength or (length == bestLength and reach > bestReach) then
			best, bestLength, bestReach = axis, length, reach
		end
	end
	local finish = {}
	for axis = 1, 3 do
		finish[axis] = (min[axis] + max[axis]) / 2
	end
	finish[best] = math.abs(min[best]) > math.abs(max[best]) and min[best] or max[best]
	if finish[1] == 0 and finish[2] == 0 and finish[3] == 0 then
		return nil
	end
	return finish
end

--- A unit's piece tree.
-- @param names table piece names by index, as Spring.GetUnitPieceList gives them
-- @param info function(index) the piece's table, as Spring.GetUnitPieceInfo gives it
-- @return table { [index] = { name, parent = index|nil, bone = {x, y, z}|nil } }
function M.build(names, info)
	local byName = {}
	for i, name in ipairs(names) do
		byName[name] = i
	end
	local pieces = {}
	for i, name in ipairs(names) do
		local piece = info(i) or {}
		local bone = nil
		if not piece.isEmpty and type(piece.min) == "table" and type(piece.max) == "table" then
			bone = M.boneEnd(piece.min, piece.max)
		end
		pieces[i] = { name = name, parent = byName[piece.parent], bone = bone }
	end
	return pieces
end

--- A point through a column major 4x4 matrix, as the engine returns them.
function M.apply(m, x, y, z)
	return m[1] * x + m[5] * y + m[9] * z + m[13],
		m[2] * x + m[6] * y + m[10] * z + m[14],
		m[3] * x + m[7] * y + m[11] * z + m[15]
end

--- Every piece's origin and bone end in the unit's model space.
-- @param pieces table from build
-- @param matrix function(index) the piece's model space matrix, 16 numbers
-- @return table { origins = { [index] = {x, y, z} }, ends = { [index] = {x, y, z} } }
function M.pose(pieces, matrix)
	local origins, ends = {}, {}
	for i, piece in ipairs(pieces) do
		local m = matrix(i)
		if m and m[16] then
			origins[i] = { M.apply(m, 0, 0, 0) }
			if piece.bone then
				ends[i] = { M.apply(m, piece.bone[1], piece.bone[2], piece.bone[3]) }
			end
		end
	end
	return { origins = origins, ends = ends }
end

local function lerpPoints(a, b, t, out)
	for i, q in pairs(b) do
		local p = a[i] or q
		out[i] = { p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t, p[3] + (q[3] - p[3]) * t }
	end
	return out
end

--- The pose part of the way from one sim frame's to the next, as the engine
-- draws the model between frames.
function M.blend(prev, cur, t)
	if not prev or t >= 1 then
		return cur
	end
	return { origins = lerpPoints(prev.origins, cur.origins, t, {}), ends = lerpPoints(prev.ends, cur.ends, t, {}) }
end

--- A pose moved into the world by the unit's matrix.
function M.place(pose, m)
	local function move(points)
		local out = {}
		for i, p in pairs(points) do
			out[i] = { M.apply(m, p[1], p[2], p[3]) }
		end
		return out
	end
	return { origins = move(pose.origins), ends = move(pose.ends) }
end

--- Keeps the pose of each selected unit for this sim frame and the last.
--
-- `read` holds what the widget reads from the engine:
--   skeleton(unitID) the pieces from build, or nil for a unit it cannot read
--   matrix(unitID, index) the piece's model space matrix
--   unitMatrix(unitID) the unit's matrix into the world
function M.tracker(read)
	local self = { units = {}, order = {} }

	--- Sample the selection. A unit is read again only when the sim frame
	-- has moved on, and a unit no longer selected is dropped.
	function self.update(selected, frame)
		local units, order = {}, {}
		for _, unitID in ipairs(selected or {}) do
			local held = self.units[unitID]
			if not held then
				local pieces = read.skeleton(unitID)
				if pieces then
					held = { pieces = pieces }
				end
			end
			if held then
				if held.frame ~= frame then
					local cur = M.pose(held.pieces, function(i)
						return read.matrix(unitID, i)
					end)
					-- The engine draws the model between the last frame's pose
					-- and this one's. A pose more than a frame old is not that,
					-- as when the view draws slower than the sim runs, so then
					-- the skeleton shows this frame's pose alone.
					held.prev = held.frame == frame - 1 and held.cur or nil
					held.cur = cur
					held.frame = frame
				end
				units[unitID] = held
				order[#order + 1] = unitID
			end
		end
		self.units, self.order = units, order
	end

	--- Every held unit's pose in the world, `t` of the way from the last
	-- sim frame to this one.
	-- @return table list of { unitID, pieces, origins, ends }
	function self.world(t)
		local out = {}
		for _, unitID in ipairs(self.order) do
			local held = self.units[unitID]
			local m = read.unitMatrix(unitID)
			if m and m[16] then
				local placed = M.place(M.blend(held.prev, held.cur, t), m)
				placed.unitID = unitID
				placed.pieces = held.pieces
				out[#out + 1] = placed
			end
		end
		return out
	end

	return self
end

local NO_END = { 0, 0, 0 }

local function vertex(out, n, p, alpha, cx, cy, other, width)
	local c = M.COLOR
	other = other or NO_END
	out[n + 1], out[n + 2], out[n + 3] = p[1], p[2], p[3]
	out[n + 4], out[n + 5], out[n + 6], out[n + 7] = c[1], c[2], c[3], alpha
	out[n + 8], out[n + 9] = cx, cy
	out[n + 10], out[n + 11], out[n + 12], out[n + 13] = other[1], other[2], other[3], width or 0
	return n + M.STRIDE
end

--- A line from a to b as two triangles. Each vertex knows the other end, so
-- the shader can push it sideways across the line on screen. Seen from the
-- other end the sides swap, so b's sides are the other way round.
local function line(out, n, a, b, alpha, width)
	n = vertex(out, n, a, alpha, -1, 0, b, width)
	n = vertex(out, n, a, alpha, 1, 0, b, width)
	n = vertex(out, n, b, alpha, -1, 0, a, width)
	n = vertex(out, n, a, alpha, -1, 0, b, width)
	n = vertex(out, n, b, alpha, -1, 0, a, width)
	n = vertex(out, n, b, alpha, 1, 0, a, width)
	return n
end
M.LINE_VERTICES = 6

local DOT_CORNERS = { { -1, -1 }, { 1, -1 }, { 1, 1 }, { -1, -1 }, { 1, 1 }, { -1, 1 } }

--- The vertices for a list of world poses, all drawn as GL.TRIANGLES: the
-- lines to the parents first, then the bones over them, then the dots.
-- @return table the numbers, integer how many line vertices, integer how many dot vertices
function M.pack(poses)
	local out, n = {}, 0
	local lines, dots = 0, 0
	for _, pose in ipairs(poses) do
		for i, piece in ipairs(pose.pieces) do
			local o = pose.origins[i]
			local parent = o and piece.parent and pose.origins[piece.parent]
			if parent then
				n = line(out, n, parent, o, M.PARENT_ALPHA, M.PARENT_WIDTH)
				lines = lines + M.LINE_VERTICES
			end
		end
	end
	for _, pose in ipairs(poses) do
		for i in ipairs(pose.pieces) do
			local o, e = pose.origins[i], pose.ends[i]
			if o and e then
				n = line(out, n, o, e, M.BONE_ALPHA, M.BONE_WIDTH)
				lines = lines + M.LINE_VERTICES
			end
		end
	end
	for _, pose in ipairs(poses) do
		for i in ipairs(pose.pieces) do
			local o = pose.origins[i]
			if o then
				for _, corner in ipairs(DOT_CORNERS) do
					n = vertex(out, n, o, M.DOT_ALPHA, corner[1], corner[2])
				end
				dots = dots + #DOT_CORNERS
			end
		end
	end
	return out, lines, dots
end

--- The piece whose origin is nearest a point on screen, within `radius`.
-- @param marks table list of { x, y, name } in screen pixels
-- @return table|nil the mark
function M.nearest(marks, x, y, radius)
	local best, bestD = nil, radius * radius
	for _, mark in ipairs(marks) do
		local dx, dy = mark.x - x, mark.y - y
		local d = dx * dx + dy * dy
		if d <= bestD then
			best, bestD = mark, d
		end
	end
	return best
end

return M
