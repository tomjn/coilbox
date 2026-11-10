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

-- How much of its opacity a piece keeps when the unit has a plan and the piece
-- is not in it.
M.DIM = 0.3

-- Numbers per vertex: position, colour, corner, then the other end of its
-- line and the line's half width, then 1 for a dashed line. A line's corner is
-- the side, -1 or 1, the vertex shader moves it to. A dot's corners run from
-- -1 to 1 and its half width is 0, which tells the shader it is a dot.
M.STRIDE = 14

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
-- @param entry table|nil the unit's bones from the body plan file, as plan.lua
--   reads them. A piece it names carries `planned = { bone, label }`, and the
--   result's `evidence` is the entry's. An entry that names none of the pieces
--   is as no entry, so a file written for another model dims nothing.
-- @return table { [index] = { name, parent = index|nil, bone = {x, y, z}|nil, planned = { bone, label }|nil }, evidence = string|nil }
function M.build(names, info, entry)
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
	if entry then
		local matched = false
		for _, piece in ipairs(pieces) do
			piece.planned = entry.pieces[piece.name:lower()]
			matched = matched or piece.planned ~= nil
		end
		if matched then
			pieces.evidence = entry.evidence
		else
			for _, piece in ipairs(pieces) do
				piece.planned = nil
			end
		end
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

local function vertex(out, n, p, alpha, cx, cy, other, width, dash)
	local c = M.COLOR
	other = other or NO_END
	out[n + 1], out[n + 2], out[n + 3] = p[1], p[2], p[3]
	out[n + 4], out[n + 5], out[n + 6], out[n + 7] = c[1], c[2], c[3], alpha
	out[n + 8], out[n + 9] = cx, cy
	out[n + 10], out[n + 11], out[n + 12], out[n + 13] = other[1], other[2], other[3], width or 0
	out[n + 14] = dash and 1 or 0
	return n + M.STRIDE
end

--- A line from a to b as two triangles. Each vertex knows the other end, so
-- the shader can push it sideways across the line on screen. The corner's x
-- is the side, the same side at both ends, so the fade across the line runs
-- evenly over both triangles. Its y is 1 at b, which tells the shader that
-- the other end is behind it, so it turns the direction round, and which it
-- reads as how far along the line the vertex is when the line is dashed.
local function line(out, n, a, b, alpha, width, dash)
	n = vertex(out, n, a, alpha, -1, 0, b, width, dash)
	n = vertex(out, n, a, alpha, 1, 0, b, width, dash)
	n = vertex(out, n, b, alpha, 1, 1, a, width, dash)
	n = vertex(out, n, a, alpha, -1, 0, b, width, dash)
	n = vertex(out, n, b, alpha, 1, 1, a, width, dash)
	n = vertex(out, n, b, alpha, -1, 1, a, width, dash)
	return n
end
M.LINE_VERTICES = 6

local DOT_CORNERS = { { -1, -1 }, { 1, -1 }, { 1, 1 }, { -1, -1 }, { 1, 1 }, { -1, 1 } }

--- How one piece of a unit is drawn.
-- @param pieces table a unit's pieces from build
-- @param i integer the piece
-- @param others boolean whether the pieces outside the plan are drawn
-- @return table|nil { alpha = multiplier, dash = boolean, parent = index|nil }, nil
--   for a piece that is not drawn. `parent` is the piece its line runs to: its
--   own parent, or while the others are hidden the nearest planned ancestor,
--   since a piece outside the plan can stand between two bones.
function M.style(pieces, i, others)
	if not pieces.evidence then
		return { alpha = 1, dash = false, parent = pieces[i].parent }
	end
	if not pieces[i].planned then
		if not others then
			return nil
		end
		return { alpha = M.DIM, dash = false, parent = pieces[i].parent }
	end
	local parent = pieces[i].parent
	if not others then
		local seen = 0
		while parent and not pieces[parent].planned and seen <= #pieces do
			parent = pieces[parent].parent
			seen = seen + 1
		end
	end
	return { alpha = 1, dash = pieces.evidence == "observed", parent = parent }
end

--- The vertices for a list of world poses, all drawn as GL.TRIANGLES: the
-- lines to the parents first, then the bones over them, then the dots.
--
-- A unit with a plan draws the pieces in it in full, and the others dimmed, or
-- not at all when `others` is false. A plan whose evidence is `observed` draws
-- its bones and its lines dashed. A unit with no plan draws every piece in full.
-- @param poses table list of world poses from the tracker
-- @param others boolean|nil whether pieces outside a plan are drawn, true when nil
-- @return table the numbers, integer how many line vertices, integer how many dot vertices
function M.pack(poses, others)
	if others == nil then
		others = true
	end
	local out, n = {}, 0
	local lines, dots = 0, 0
	for _, pose in ipairs(poses) do
		for i in ipairs(pose.pieces) do
			local o = pose.origins[i]
			local style = o and M.style(pose.pieces, i, others)
			local parent = style and style.parent and pose.origins[style.parent]
			if parent then
				n = line(out, n, parent, o, M.PARENT_ALPHA * style.alpha, M.PARENT_WIDTH, style.dash)
				lines = lines + M.LINE_VERTICES
			end
		end
	end
	for _, pose in ipairs(poses) do
		for i in ipairs(pose.pieces) do
			local o, e = pose.origins[i], pose.ends[i]
			local style = o and e and M.style(pose.pieces, i, others)
			if style then
				n = line(out, n, o, e, M.BONE_ALPHA * style.alpha, M.BONE_WIDTH, style.dash)
				lines = lines + M.LINE_VERTICES
			end
		end
	end
	for _, pose in ipairs(poses) do
		for i in ipairs(pose.pieces) do
			local o = pose.origins[i]
			local style = o and M.style(pose.pieces, i, others)
			if style then
				for _, corner in ipairs(DOT_CORNERS) do
					n = vertex(out, n, o, M.DOT_ALPHA * style.alpha, corner[1], corner[2])
				end
				dots = dots + #DOT_CORNERS
			end
		end
	end
	return out, lines, dots
end

--- Which names to write beside the pieces.
--
-- A piece in a plan always has its role label, since that is what the plan
-- adds. Every other piece is named while `naming`, and otherwise only the one
-- nearest the cursor within `radius`. A piece that is not drawn is not named.
-- @param marks table list of { x, y, text, planned = boolean, drawn = boolean } in screen pixels
-- @return table the marks to write
function M.names(marks, naming, mouseX, mouseY, radius)
	local out, others = {}, {}
	for _, mark in ipairs(marks) do
		if mark.drawn then
			if mark.planned then
				out[#out + 1] = mark
			else
				others[#others + 1] = mark
			end
		end
	end
	if naming then
		for _, mark in ipairs(others) do
			out[#out + 1] = mark
		end
	else
		local near = M.nearest(others, mouseX, mouseY, radius)
		if near then
			out[#out + 1] = near
		end
	end
	return out
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
