-- The skeleton of a unit from engine data alone (issue #5179).
--
-- Pure. The widget hands in what it read from the engine, so the tests run
-- this with plain luajit. Nothing here touches `gl` or `Spring`.
--
-- A piece's bone runs from its origin, the point it turns about, to the far
-- end of its geometry (boneEnd). A piece whose geometry reaches both ways
-- from its origin, as a radar dish does, has a second part to the other end
-- (boneStart). Every piece gets a dot at its origin and a line to its parent's
-- origin, so an empty piece still shows as a joint.

local M = {}

-- 0xe879f9, the builder's skeleton colour (src/lego/pages/components/skeletonLayer.ts).
M.COLOR = { 232 / 255, 121 / 255, 249 / 255 }
-- The colour of the deepest pieces of a unit's tree. A piece's colour is part
-- of the way from COLOR to this, by how deep it is, so neighbouring bones of
-- different depths can be told apart.
M.DEEP_COLOR = { 0.62, 0.55, 1 }
-- How bright a bone's tip is against its origin, so the end it turns about
-- can be told from the other.
M.TIP_LUMA = 0.6
-- How opaque each mark is. The bone matches the builder's 0.95. The line to
-- the parent is dimmer, so the bones read first.
M.BONE_ALPHA = 0.95
M.PARENT_ALPHA = 0.55
M.DOT_ALPHA = 0.95
-- Half the width of each line on screen, in pixels of a view 1080 tall. A
-- bone narrows from its origin to its tip, and is wider than the line to the
-- parent. Lines are strips of two triangles, because macOS draws GL.LINES one
-- pixel wide whatever is asked.
M.BONE_WIDTH = 4
M.BONE_TIP_WIDTH = 1.5
M.PARENT_WIDTH = 1.5

-- How much of its opacity a piece keeps when the unit has a plan and the piece
-- is not in it.
M.DIM = 0.3
-- How much of its opacity a piece keeps while the cursor is on another piece
-- and it is not between that piece and the root.
M.FOCUS_DIM = 0.45

-- A piece that moved against its parent is drawn this much of the way to
-- white and this much wider, fading over FADE_FRAMES sim frames. A walking
-- unit moves most of its pieces at once, so the tint is light enough that a
-- bone keeps the hue of its depth.
M.HOT_MIX = 0.35
M.HOT_WIDTH = 0.6
M.FADE_FRAMES = 15
-- How far a piece's turn (an entry of its rotation) or its place (elmos) has
-- to change against its parent in one sim frame to count as moving. The
-- matrices are 32-bit floats multiplied down the tree, so a piece that is
-- still does not come out the same to the last digit. Chosen from the size of
-- that error, not measured in a game.
M.TURN_TOLERANCE = 1e-4
M.MOVE_TOLERANCE = 1e-2

-- The skeleton is drawn at its full widths once the unit's radius covers this
-- many pixels of a view 1080 tall, and narrower when the unit is smaller on
-- screen. Read off screenshots, not measured.
M.FULL_AT_RADIUS = 200

-- Numbers per vertex: position, colour, corner, then the other end of its
-- line and the line's half width, then 1 for a dashed line, then the unit's
-- grain: how many elmos one pixel of width may cover, 0 for no limit. A line's
-- corner is the side, -1 or 1, the vertex shader moves it to. A dot's corners
-- run from -1 to 1 and its half width is 0, which tells the shader it is a dot.
M.STRIDE = 15

-- Which axis wins when two are as long as each other and reach as far from
-- the origin: z first, the way a unit faces, then y, then x.
local AXIS_ORDER = { 3, 2, 1 }

--- The axis a piece's bone runs along: see boneEnd.
local function boneAxis(min, max)
	local best, bestLength, bestReach
	for _, axis in ipairs(AXIS_ORDER) do
		local length = max[axis] - min[axis]
		local reach = math.max(math.abs(min[axis]), math.abs(max[axis]))
		if not best or length > bestLength or (length == bestLength and reach > bestReach) then
			best, bestLength, bestReach = axis, length, reach
		end
	end
	return best
end

--- The middle of the box, with `value` on `axis`.
local function faceMiddle(min, max, axis, value)
	local point = {}
	for a = 1, 3 do
		point[a] = (min[a] + max[a]) / 2
	end
	point[axis] = value
	return point
end

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
	local best = boneAxis(min, max)
	local finish = faceMiddle(min, max, best, math.abs(min[best]) > math.abs(max[best]) and min[best] or max[best])
	if finish[1] == 0 and finish[2] == 0 and finish[3] == 0 then
		return nil
	end
	return finish
end

--- The other end of a piece's geometry, for a piece whose origin lies inside
-- its box along the bone's axis: the middle of the face boneEnd did not take.
-- A piece that turns about one end of its geometry has none.
-- @return table|nil {x, y, z}
function M.boneStart(min, max)
	local best = boneAxis(min, max)
	if not (min[best] < 0 and max[best] > 0) then
		return nil
	end
	return faceMiddle(min, max, best, math.abs(min[best]) > math.abs(max[best]) and max[best] or min[best])
end

--- A unit's piece tree.
-- @param names table piece names by index, as Spring.GetUnitPieceList gives them
-- @param info function(index) the piece's table, as Spring.GetUnitPieceInfo gives it
-- @param entry table|nil the unit's bones from the body plan file, as plan.lua
--   reads them. A piece it names carries `planned = { bone, label }`, and the
--   result's `evidence` is the entry's. An entry that names none of the pieces
--   is as no entry, so a file written for another model dims nothing.
-- @return table { [index] = { name, parent = index|nil, depth = integer,
--   bone = {x, y, z}|nil, back = {x, y, z}|nil, planned = { bone, label }|nil },
--   deepest = integer, evidence = string|nil }. `depth` is how many pieces lie
--   between the piece and the root, counting the piece, and `deepest` the
--   greatest of them.
function M.build(names, info, entry)
	local byName = {}
	for i, name in ipairs(names) do
		byName[name] = i
	end
	local pieces = {}
	for i, name in ipairs(names) do
		local piece = info(i) or {}
		local bone, back = nil, nil
		if not piece.isEmpty and type(piece.min) == "table" and type(piece.max) == "table" then
			bone = M.boneEnd(piece.min, piece.max)
			back = bone and M.boneStart(piece.min, piece.max)
		end
		pieces[i] = { name = name, parent = byName[piece.parent], bone = bone, back = back }
	end
	pieces.deepest = 0
	for _, piece in ipairs(pieces) do
		local depth, above = 0, piece.parent
		while above and depth < #pieces do
			depth = depth + 1
			above = pieces[above].parent
		end
		piece.depth = depth
		pieces.deepest = math.max(pieces.deepest, depth)
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

--- A piece's matrix as seen from its parent: the three columns of its turn,
-- then its place. With no parent it is the piece's own. The matrices turn and
-- move without stretching, so the parent's turn is undone by its transpose.
-- @return table 12 numbers
local function relative(m, p)
	if not p then
		return { m[1], m[2], m[3], m[5], m[6], m[7], m[9], m[10], m[11], m[13], m[14], m[15] }
	end
	local out = {}
	local function across(x, y, z)
		local n = #out
		out[n + 1] = p[1] * x + p[2] * y + p[3] * z
		out[n + 2] = p[5] * x + p[6] * y + p[7] * z
		out[n + 3] = p[9] * x + p[10] * y + p[11] * z
	end
	across(m[1], m[2], m[3])
	across(m[5], m[6], m[7])
	across(m[9], m[10], m[11])
	across(m[13] - p[13], m[14] - p[14], m[15] - p[15])
	return out
end

--- Whether a piece moved against its parent between two poses' `locals`.
function M.moved(a, b)
	for k = 1, 12 do
		if math.abs(a[k] - b[k]) > (k > 9 and M.MOVE_TOLERANCE or M.TURN_TOLERANCE) then
			return true
		end
	end
	return false
end

--- Every piece's origin and bone ends in the unit's model space.
-- @param pieces table from build
-- @param matrix function(index) the piece's model space matrix, 16 numbers
-- @return table { origins, ends, starts = { [index] = {x, y, z} }, locals =
--   { [index] = the piece's matrix as seen from its parent, 12 numbers } }
function M.pose(pieces, matrix)
	local origins, ends, starts, locals = {}, {}, {}, {}
	local matrices = {}
	for i in ipairs(pieces) do
		local m = matrix(i)
		matrices[i] = m and m[16] and m or nil
	end
	for i, piece in ipairs(pieces) do
		local m = matrices[i]
		if m then
			origins[i] = { M.apply(m, 0, 0, 0) }
			if piece.bone then
				ends[i] = { M.apply(m, piece.bone[1], piece.bone[2], piece.bone[3]) }
			end
			if piece.back then
				starts[i] = { M.apply(m, piece.back[1], piece.back[2], piece.back[3]) }
			end
			locals[i] = relative(m, piece.parent and matrices[piece.parent])
		end
	end
	return { origins = origins, ends = ends, starts = starts, locals = locals }
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
	return {
		origins = lerpPoints(prev.origins, cur.origins, t, {}),
		ends = lerpPoints(prev.ends, cur.ends, t, {}),
		starts = lerpPoints(prev.starts or {}, cur.starts or {}, t, {}),
	}
end

--- A pose moved into the world by the unit's matrix.
function M.place(pose, m)
	local function move(points)
		local out = {}
		for i, p in pairs(points or {}) do
			out[i] = { M.apply(m, p[1], p[2], p[3]) }
		end
		return out
	end
	return { origins = move(pose.origins), ends = move(pose.ends), starts = move(pose.starts) }
end

--- Keeps the pose of each selected unit for this sim frame and the last.
--
-- `read` holds what the widget reads from the engine:
--   skeleton(unitID) the pieces from build, or nil for a unit it cannot read
--   matrix(unitID, index) the piece's model space matrix
--   unitMatrix(unitID) the unit's matrix into the world
--   radius(unitID) the unit's radius in elmos. Optional: without it the
--     skeleton keeps its full widths however small the unit is on screen
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
					local radius = read.radius and read.radius(unitID) or 0
					held = { pieces = pieces, movedAt = {}, grain = radius / M.FULL_AT_RADIUS }
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
					if held.prev then
						for i, now in pairs(cur.locals) do
							local before = held.prev.locals[i]
							if before and M.moved(before, now) then
								held.movedAt[i] = frame
							end
						end
					end
				end
				units[unitID] = held
				order[#order + 1] = unitID
			end
		end
		self.units, self.order = units, order
	end

	--- Every held unit's pose in the world, `t` of the way from the last
	-- sim frame to this one.
	-- @return table list of { unitID, pieces, origins, ends, starts, grain,
	--   heat = { [index] = 1 for a piece that moved this frame, down to 0 } }
	function self.world(t)
		local out = {}
		for _, unitID in ipairs(self.order) do
			local held = self.units[unitID]
			local m = read.unitMatrix(unitID)
			if m and m[16] then
				local placed = M.place(M.blend(held.prev, held.cur, t), m)
				placed.unitID = unitID
				placed.pieces = held.pieces
				placed.grain = held.grain
				placed.heat = {}
				for i, at in pairs(held.movedAt) do
					local heat = 1 - (held.frame - at) / M.FADE_FRAMES
					if heat > 0 then
						placed.heat[i] = heat
					else
						held.movedAt[i] = nil
					end
				end
				out[#out + 1] = placed
			end
		end
		return out
	end

	return self
end

local NO_END = { 0, 0, 0 }

-- What every vertex of one mark shares: { alpha, dash, grain }
local function vertex(out, n, p, c, mark, cx, cy, other, width)
	other = other or NO_END
	out[n + 1], out[n + 2], out[n + 3] = p[1], p[2], p[3]
	out[n + 4], out[n + 5], out[n + 6], out[n + 7] = c[1], c[2], c[3], mark.alpha
	out[n + 8], out[n + 9] = cx, cy
	out[n + 10], out[n + 11], out[n + 12], out[n + 13] = other[1], other[2], other[3], width or 0
	out[n + 14] = mark.dash and 1 or 0
	out[n + 15] = mark.grain or 0
	return n + M.STRIDE
end

--- A line from a to b as two triangles, in colour ca and half width wa at a
-- and cb and wb at b. Each vertex knows the other end, so the shader can push
-- it sideways across the line on screen. The corner's x is the side, the same
-- side at both ends, so the fade across the line runs evenly over both
-- triangles. Its y is 1 at b, which tells the shader that the other end is
-- behind it, so it turns the direction round, and which it reads as how far
-- along the line the vertex is when the line is dashed.
local function line(out, n, a, b, ca, cb, wa, wb, mark)
	n = vertex(out, n, a, ca, mark, -1, 0, b, wa)
	n = vertex(out, n, a, ca, mark, 1, 0, b, wa)
	n = vertex(out, n, b, cb, mark, 1, 1, a, wb)
	n = vertex(out, n, a, ca, mark, -1, 0, b, wa)
	n = vertex(out, n, b, cb, mark, 1, 1, a, wb)
	n = vertex(out, n, b, cb, mark, -1, 1, a, wb)
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

local function mix(a, b, t)
	return { a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t }
end

local WHITE = { 1, 1, 1 }

-- A link shorter than this, in elmos squared, is not drawn. It would be too
-- short to see, and a line of no length has no direction for the shader.
local NO_LINK = 1e-6

--- The point of the line from a to b that is nearest to o.
local function nearestOn(o, a, b)
	local dx, dy, dz = b[1] - a[1], b[2] - a[2], b[3] - a[3]
	local t = ((o[1] - a[1]) * dx + (o[2] - a[2]) * dy + (o[3] - a[3]) * dz) / (dx * dx + dy * dy + dz * dz)
	t = math.max(0, math.min(1, t))
	return { a[1] + dx * t, a[2] + dy * t, a[3] + dz * t }
end

--- The piece under the cursor and the pieces between it and the root.
-- @param marks table list of { x, y, pose, piece = index, drawn = boolean } in
--   screen pixels, `pose` being the world pose the piece belongs to
-- @return table|nil { pose, piece, chain = { [index] = true } }, nil when the
--   cursor is within `radius` of no drawn piece
function M.focus(marks, x, y, radius)
	local shown = {}
	for _, mark in ipairs(marks) do
		if mark.drawn then
			shown[#shown + 1] = mark
		end
	end
	local near = M.nearest(shown, x, y, radius)
	if not near then
		return nil
	end
	local pieces = near.pose.pieces
	local chain, i, seen = {}, near.piece, 0
	while i and seen <= #pieces do
		chain[i] = true
		i = pieces[i].parent
		seen = seen + 1
	end
	return { pose = near.pose, piece = near.piece, chain = chain }
end

--- How each drawn piece of a pose looks: its colour by depth, lit and widened
-- while it moves, and dimmed while the cursor is on a piece it does not lead to.
-- @return table { [index] = { colour, tip, wide, parent, alpha, dash, grain } }
local function looks(pose, others, focus)
	local out = {}
	local pieces = pose.pieces
	local deepest = pieces.deepest or 0
	for i, piece in ipairs(pieces) do
		local style = pose.origins[i] and M.style(pieces, i, others)
		if style then
			local heat = pose.heat and pose.heat[i] or 0
			local colour = mix(M.COLOR, M.DEEP_COLOR, deepest > 0 and (piece.depth or 0) / deepest or 0)
			colour = mix(colour, WHITE, heat * M.HOT_MIX)
			local alpha = style.alpha
			if focus and not (focus.pose == pose and focus.chain[i]) then
				alpha = alpha * M.FOCUS_DIM
			end
			out[i] = {
				colour = colour,
				tip = { colour[1] * M.TIP_LUMA, colour[2] * M.TIP_LUMA, colour[3] * M.TIP_LUMA },
				wide = 1 + heat * M.HOT_WIDTH,
				parent = style.parent,
				alpha = alpha,
				dash = style.dash,
				grain = pose.grain,
			}
		end
	end
	return out
end

--- The vertices for a list of world poses, all drawn as GL.TRIANGLES: the
-- lines to the parents first, then the bones over them, then the dots.
--
-- A unit with a plan draws the pieces in it in full, and the others dimmed, or
-- not at all when `others` is false. A plan whose evidence is `observed` draws
-- its bones and its lines dashed. A unit with no plan draws every piece in full.
-- @param poses table list of world poses from the tracker
-- @param others boolean|nil whether pieces outside a plan are drawn, true when nil
-- @param focus table|nil from M.focus: every piece outside its chain is dimmed
-- @return table the numbers, integer how many line vertices, integer how many dot vertices
function M.pack(poses, others, focus)
	if others == nil then
		others = true
	end
	local out, n = {}, 0
	local lines, dots = 0, 0
	local all = {}
	for p, pose in ipairs(poses) do
		all[p] = looks(pose, others, focus)
	end
	local function mark(look, alpha)
		return { alpha = alpha * look.alpha, dash = look.dash, grain = look.grain }
	end
	for p, pose in ipairs(poses) do
		for i, look in pairs(all[p]) do
			local parent = look.parent and pose.origins[look.parent]
			if parent then
				n = line(out, n, parent, pose.origins[i], look.colour, look.colour, M.PARENT_WIDTH, M.PARENT_WIDTH, mark(look, M.PARENT_ALPHA))
				lines = lines + M.LINE_VERTICES
			end
		end
	end
	for p, pose in ipairs(poses) do
		for i, look in pairs(all[p]) do
			local o = pose.origins[i]
			local far, back = pose.ends[i], pose.starts and pose.starts[i]
			local bone = mark(look, M.BONE_ALPHA)
			local function half(from, tip)
				n = line(out, n, from, tip, look.colour, look.tip, M.BONE_WIDTH * look.wide, M.BONE_TIP_WIDTH * look.wide, bone)
				lines = lines + M.LINE_VERTICES
			end
			if far and back then
				-- A piece that reaches both ways is one straight bone from face
				-- to face, widest where it passes the origin. Its box can lie to
				-- one side of the origin, so a thin link joins the two.
				local middle = nearestOn(o, back, far)
				local dx, dy, dz = middle[1] - o[1], middle[2] - o[2], middle[3] - o[3]
				if dx * dx + dy * dy + dz * dz > NO_LINK then
					n = line(out, n, o, middle, look.colour, look.colour, M.PARENT_WIDTH, M.PARENT_WIDTH, mark(look, M.PARENT_ALPHA))
					lines = lines + M.LINE_VERTICES
				end
				half(middle, far)
				half(middle, back)
			elseif far then
				half(o, far)
			end
		end
	end
	for p, pose in ipairs(poses) do
		for i, look in pairs(all[p]) do
			local dot = mark(look, M.DOT_ALPHA)
			dot.dash = false
			for _, corner in ipairs(DOT_CORNERS) do
				n = vertex(out, n, pose.origins[i], look.colour, dot, corner[1], corner[2])
			end
			dots = dots + #DOT_CORNERS
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
