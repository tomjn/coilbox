-- Ground changes read back as raise steps (issue #4798).
--
-- The engine keeps no record of the terraform a player drew, only the ground
-- it left. This works the shapes back out of the change in height at each 8
-- elmo corner, GetGroundHeight minus GetGroundOrigHeight.
--
-- Corners with a similar change are grouped, and each group becomes one raise
-- step of Zero-K's area shape. Zero-K's terraform gadget fills an area in 16
-- elmo cells and puts a slope round it that is one corner wide per ring, so a
-- group is kept only as the cells it covers whole. That leaves the slopes
-- out, because the gadget makes them again when the step is placed. A step's
-- points are what the gadget fills from, as areaCells shows, so placing the
-- step raises the same corners again.
--
-- No engine calls. The widget reads the ground and hands it over as a grid.

local M = {}

M.SQUARE = 8
M.CELL = 16

--- The most a step's outline spans along either side, in elmos. Zero-K's
-- gadget fills an area in blocks of up to 200 (unit_terraform.lua,
-- areaSegMaxSize) measured to 16 past the outline, and fills every block
-- after the first 8 elmos off the 16 grid. In a real match that raised a
-- wall saved as one area of two blocks 8 elmos past its end. An outline
-- spanning no more than 200 - 16 is one block, and is filled exactly.
M.MAX_SPAN = 184

--- How far apart two changes in height can be and still be one step, in
-- elmos. Measured in real Zero-K matches on SpeedMetal and Acidic Quarry
-- (scripts/zerok-terraform-headless.sh). A raised or dug top reads one exact
-- value except in one place: where two of the gadget's terraform blocks met
-- on rough ground, a wall raised by 112 had corners down to 104.3, 7.7 below
-- its top. A raised top's first ring of slope is 28 below it. A dug top's
-- first ring is 8 above it, and may join the top's group, which costs
-- nothing: a ring is one corner wide, so it covers no cell, and a step's
-- height is read from the corners its cells cover.
M.TOLERANCE = 8

--- Whether a corner's ground was changed. Untouched ground reads exactly 0 in
-- both of those matches, on every corner nothing reached.
function M.changed(delta)
	return delta ~= 0
end

local abs, floor, min, max = math.abs, math.floor, math.min, math.max

local function key(x, z)
	return x .. ":" .. z
end

local function floor16(v)
	return floor(v / 16) * 16
end

--------------------------------------------------------------------------------
-- the gadget's fill
--------------------------------------------------------------------------------

--- The 16 elmo cells Zero-K's gadget fills for an area outline, keyed "x:z"
-- by each cell's lowest corner. A copy of TerraformArea in Zero-K's
-- unit_terraform.lua: the outline closed and snapped down to 16, the gaps
-- between its points filled in, and everything inside it that a flood from
-- the edge of its box cannot reach. Exact for an outline within M.MAX_SPAN,
-- which the gadget fills as one block.
-- @param points table[] { x, z } in elmos
-- @return table cells, key -> { x, z }
function M.areaCells(points)
	local loop = {}
	for i, p in ipairs(points) do
		loop[i] = { x = floor16(p.x), z = floor16(p.z) }
	end
	loop[#loop + 1] = loop[1]
	local outline = { loop[1] }
	local left, right, top, bottom = loop[1].x, loop[1].x, loop[1].z, loop[1].z
	local function add(x, z)
		outline[#outline + 1] = { x = x, z = z }
		left, right = min(left, x), max(right, x)
		top, bottom = min(top, z), max(bottom, z)
	end
	for i = 2, #loop do
		local nx, nz = loop[i].x, loop[i].z
		local dx, dz = nx - loop[i - 1].x, nz - loop[i - 1].z
		local ax, az = abs(dx), abs(dz)
		if ax <= 16 and az <= 16 then
			add(nx, nz)
		elseif ax > az then
			local m, sign = dz / dx, dx / ax
			for j = 0, ax, 16 do
				add(nx - j * sign, floor16(nz - j * m * sign))
			end
		else
			local m, sign = dx / dz, dz / az
			for j = 0, az, 16 do
				add(floor16(nx - j * m * sign), nz - j * sign)
			end
		end
	end
	local edge = {}
	for _, p in ipairs(outline) do
		edge[key(p.x, p.z)] = true
	end
	-- flood from the edge of the box through everything that is not outline
	local flooded, queue = {}, {}
	local function reach(x, z)
		local k = key(x, z)
		if x >= left and x <= right and z >= top and z <= bottom and not edge[k] and not flooded[k] then
			flooded[k] = true
			queue[#queue + 1] = { x, z }
		end
	end
	for x = left, right, 16 do
		reach(x, top)
		reach(x, bottom)
	end
	for z = top, bottom, 16 do
		reach(left, z)
		reach(right, z)
	end
	local head = 1
	while head <= #queue do
		local x, z = queue[head][1], queue[head][2]
		head = head + 1
		reach(x + 16, z)
		reach(x - 16, z)
		reach(x, z + 16)
		reach(x, z - 16)
	end
	local cells = {}
	for x = left, right, 16 do
		for z = top, bottom, 16 do
			local k = key(x, z)
			if not flooded[k] then
				cells[k] = { x = x, z = z }
			end
		end
	end
	return cells
end

--- The corners a set of cells raises: each cell's square, edges included.
-- @return table key "x:z" -> true
function M.cellCorners(cells)
	local out = {}
	for _, c in pairs(cells) do
		for x = c.x, c.x + 16, 8 do
			for z = c.z, c.z + 16, 8 do
				out[key(x, z)] = true
			end
		end
	end
	return out
end

--------------------------------------------------------------------------------
-- outlines
--------------------------------------------------------------------------------

-- The eight neighbours, clockwise with z growing down the screen.
local DIRS = { { 1, 0 }, { 1, 1 }, { 0, 1 }, { -1, 1 }, { -1, 0 }, { -1, -1 }, { 0, -1 }, { 1, -1 } }
local WEST = 5

local function dirIndex(dx, dz)
	for i, d in ipairs(DIRS) do
		if d[1] == dx and d[2] == dz then
			return i
		end
	end
end

local function size(set)
	local n = 0
	for _ in pairs(set) do
		n = n + 1
	end
	return n
end

local function sameKeys(a, b)
	for k in pairs(a) do
		if not b[k] then
			return false
		end
	end
	for k in pairs(b) do
		if not a[k] then
			return false
		end
	end
	return true
end

--- The cell at the top of a set, leftmost on its row.
local function firstCell(cells)
	local best
	for _, c in pairs(cells) do
		if not best or c.z < best.z or (c.z == best.z and c.x < best.x) then
			best = c
		end
	end
	return best
end

--- The outer boundary of a set of cells joined at edges or corners, as the
-- cells along it in order, by Moore neighbour tracing. Runs in one direction
-- are cut down to their ends.
local function trace(cells)
	local start = firstCell(cells)
	local function has(x, z)
		return cells[key(x, z)] ~= nil
	end
	local path = { start }
	local cur, back = start, WEST
	local firstMove
	-- a boundary visits each cell at most four times, so this many steps can
	-- only be exceeded by a fault, which the caller's fill check then catches
	for _ = 1, 4 * size(cells) + 8 do
		local found
		for i = 1, 8 do
			local d = (back - 1 + i) % 8 + 1
			if has(cur.x + DIRS[d][1] * 16, cur.z + DIRS[d][2] * 16) then
				found = d
				break
			end
		end
		if not found then
			break
		end
		if cur == start and found == firstMove then
			path[#path] = nil
			break
		end
		firstMove = firstMove or found
		local nx, nz = cur.x + DIRS[found][1] * 16, cur.z + DIRS[found][2] * 16
		local prev = (found - 2) % 8 + 1
		local px, pz = cur.x + DIRS[prev][1] * 16, cur.z + DIRS[prev][2] * 16
		back = dirIndex((px - nx) / 16, (pz - nz) / 16)
		cur = cells[key(nx, nz)]
		path[#path + 1] = cur
	end
	-- keep only the cells where the direction changes
	local n = #path
	if n <= 2 then
		return path
	end
	local out = {}
	for i = 1, n do
		local a, b, c = path[(i - 2) % n + 1], path[i], path[i % n + 1]
		if b.x - a.x ~= c.x - b.x or b.z - a.z ~= c.z - b.z then
			out[#out + 1] = b
		end
	end
	return out
end

--- Split a set of cells into the sets joined at edges or corners.
local function components(cells)
	local seen, out = {}, {}
	for k, c in pairs(cells) do
		if not seen[k] then
			local part, queue = {}, { c }
			seen[k] = true
			local head = 1
			while head <= #queue do
				local cur = queue[head]
				head = head + 1
				part[key(cur.x, cur.z)] = cur
				for _, d in ipairs(DIRS) do
					local nk = key(cur.x + d[1] * 16, cur.z + d[2] * 16)
					if cells[nk] and not seen[nk] then
						seen[nk] = true
						queue[#queue + 1] = cells[nk]
					end
				end
			end
			out[#out + 1] = part
		end
	end
	return out
end

--- Cut a set in two along a line, x or z below `at` and the rest.
local function cut(cells, axis, at)
	local a, b = {}, {}
	for k, c in pairs(cells) do
		if c[axis] < at then
			a[k] = c
		else
			b[k] = c
		end
	end
	return a, b
end

--- Outlines whose fills together are exactly these cells, each within
-- M.MAX_SPAN. An outline that fills more than its cells has a hole in it, and
-- is cut along the hole's row.
local function outlines(cells, out)
	if next(cells) == nil then
		return
	end
	local left, right, top, bottom = math.huge, -math.huge, math.huge, -math.huge
	for _, c in pairs(cells) do
		left, right = min(left, c.x), max(right, c.x)
		top, bottom = min(top, c.z), max(bottom, c.z)
	end
	local parts
	-- the gadget measures an area between its snapped points, which are the
	-- cells' lowest corners, and a piece is cut off at the most one block
	-- takes, so the rest is as long as it can be
	if right - left > M.MAX_SPAN then
		parts = { cut(cells, "x", left + floor16(M.MAX_SPAN) + 16) }
	elseif bottom - top > M.MAX_SPAN then
		parts = { cut(cells, "z", top + floor16(M.MAX_SPAN) + 16) }
	else
		local points = trace(cells)
		local filled = M.areaCells(points)
		if sameKeys(filled, cells) then
			local pts = {}
			for i, p in ipairs(points) do
				pts[i] = { x = p.x, z = p.z }
			end
			-- a step needs three points, and repeating one fills the same
			while #pts < 3 do
				pts[#pts + 1] = { x = pts[#pts].x, z = pts[#pts].z }
			end
			out[#out + 1] = { points = pts, cells = size(cells) }
			return
		end
		local hole
		for k, c in pairs(filled) do
			if not cells[k] and (not hole or c.z < hole.z) then
				hole = c
			end
		end
		if hole and hole.z > top then
			parts = { cut(cells, "z", hole.z) }
		elseif bottom > top then
			parts = { cut(cells, "z", top + floor16((bottom - top) / 2) + 16) }
		else
			parts = { cut(cells, "x", left + floor16((right - left) / 2) + 16) }
		end
	end
	for _, part in ipairs(parts) do
		for _, piece in ipairs(components(part)) do
			outlines(piece, out)
		end
	end
end

--------------------------------------------------------------------------------
-- regions
--------------------------------------------------------------------------------

local function median(values)
	if #values == 0 then
		return 0
	end
	table.sort(values)
	local mid = (#values + 1) / 2
	return (values[floor(mid)] + values[math.ceil(mid)]) / 2
end

--- Find the ground changes in a grid, as raise steps.
-- @param grid table x, z (the first corner, in elmos, on the 8 elmo grid),
--   w, h (corners across and down), delta (the change at each corner, row by
--   row from the first, delta[j * w + i + 1] for the corner i across, j down)
-- @param opts table? tolerance (elmos, M.TOLERANCE if absent), footprints
--   ({ x0, z0, x1, z1 } in elmos, the buildings standing in the grid)
-- @return table[] regions, each { height, points = { { x, z } }, cells }, in
--   elmos, and a set of the footprints' indices that stand on one of them
function M.find(grid, opts)
	opts = opts or {}
	local tol = opts.tolerance or M.TOLERANCE
	local footprints = opts.footprints or {}
	local gx, gz, w, h, delta = grid.x, grid.z, grid.w, grid.h, grid.delta

	local function at(x, z)
		local i, j = (x - gx) / 8, (z - gz) / 8
		if i < 0 or j < 0 or i >= w or j >= h or i ~= floor(i) or j ~= floor(j) then
			return nil
		end
		return j * w + i + 1
	end

	-- Corners under a building are left out of the grouping: the engine
	-- levels the ground under a building itself, so their change says more
	-- about the building than about any terraform.
	local free = {}
	for fi, f in ipairs(footprints) do
		for x = f.x0 - f.x0 % 8, f.x1, 8 do
			for z = f.z0 - f.z0 % 8, f.z1, 8 do
				local k = at(x, z)
				if k then
					free[k] = fi
				end
			end
		end
	end

	-- group changed corners by flood, each within the tolerance of the
	-- change at the corner it started from
	local label, groups = {}, {}
	for k = 1, w * h do
		if not free[k] and not label[k] and M.changed(delta[k]) then
			local g = { members = {}, ref = delta[k] }
			groups[#groups + 1] = g
			label[k] = #groups
			local queue, head = { k }, 1
			while head <= #queue do
				local cur = queue[head]
				head = head + 1
				g.members[#g.members + 1] = cur
				local i, j = (cur - 1) % w, floor((cur - 1) / w)
				for _, n in ipairs({ { i + 1, j }, { i - 1, j }, { i, j + 1 }, { i, j - 1 } }) do
					local ni, nj = n[1], n[2]
					if ni >= 0 and nj >= 0 and ni < w and nj < h then
						local nk = nj * w + ni + 1
						if not free[nk] and not label[nk] and M.changed(delta[nk]) and abs(delta[nk] - g.ref) <= tol then
							label[nk] = #groups
							queue[#queue + 1] = nk
						end
					end
				end
			end
		end
	end

	local function cellsOf(members)
		local set = {}
		for _, k in ipairs(members) do
			set[k] = true
		end
		local cells = {}
		for _, k in ipairs(members) do
			local x, z = gx + ((k - 1) % w) * 8, gz + floor((k - 1) / w) * 8
			if x % 16 == 0 and z % 16 == 0 then
				local whole = true
				for dx = 0, 16, 8 do
					for dz = 0, 16, 8 do
						local c = at(x + dx, z + dz)
						whole = whole and c ~= nil and set[c] == true
					end
				end
				if whole then
					cells[key(x, z)] = { x = x, z = z }
				end
			end
		end
		return cells
	end

	-- A group's height is read from the corners its cells cover, so a ring of
	-- slope that joined it does not pull it.
	for _, g in ipairs(groups) do
		local cells = cellsOf(g.members)
		local covered = M.cellCorners(cells)
		local values = {}
		for _, k in ipairs(g.members) do
			local x, z = gx + ((k - 1) % w) * 8, gz + floor((k - 1) / w) * 8
			if covered[key(x, z)] then
				values[#values + 1] = delta[k]
			end
		end
		g.height = median(values)
		g.solid = next(cells) ~= nil
	end

	-- A building's footprint joins the step it stands on: one beside it whose
	-- change is nearer the footprint's own than no change at all is. A
	-- building as wide as a wall cuts it in two, so every step beside it of
	-- the same height joins that step too.
	local alias = {}
	local function owner(gi)
		while alias[gi] do
			gi = alias[gi]
		end
		return gi
	end
	local on = {}
	for fi, f in ipairs(footprints) do
		local inside = {}
		for k, owner in pairs(free) do
			if owner == fi then
				inside[#inside + 1] = delta[k]
			end
		end
		local mid = median(inside)
		local best, gap
		local beside = {}
		local x0, z0 = f.x0 - f.x0 % 8 - 8, f.z0 - f.z0 % 8 - 8
		local x1, z1 = f.x1 - f.x1 % 8 + 8, f.z1 - f.z1 % 8 + 8
		for x = x0, x1, 8 do
			for z = z0, z1, 8 do
				if x == x0 or x == x1 or z == z0 or z == z1 then
					local k = at(x, z)
					local gi = k and label[k] and owner(label[k])
					if gi then
						beside[gi] = true
					end
					if gi and groups[gi].solid then
						local d = abs(mid - groups[gi].height)
						if d < abs(mid) and (not gap or d < gap) then
							best, gap = gi, d
						end
					end
				end
			end
		end
		if best and #inside > 0 then
			on[fi] = best
			local members = groups[best].members
			for k, holder in pairs(free) do
				if holder == fi then
					members[#members + 1] = k
				end
			end
			for gi in pairs(beside) do
				if gi ~= best and abs(groups[gi].height - groups[best].height) <= tol then
					for _, k in ipairs(groups[gi].members) do
						members[#members + 1] = k
					end
					groups[gi].members = {}
					groups[gi].solid = false
					alias[gi] = best
				end
			end
		end
	end
	for fi, gi in pairs(on) do
		on[fi] = owner(gi)
	end

	local regions = {}
	local regionOf = {}
	for gi, g in ipairs(groups) do
		if g.solid then
			local found = {}
			for _, part in ipairs(components(cellsOf(g.members))) do
				outlines(part, found)
			end
			for _, r in ipairs(found) do
				r.height = floor(g.height + 0.5)
				regions[#regions + 1] = r
			end
			regionOf[gi] = #found > 0
		end
	end
	local stands = {}
	for fi, gi in pairs(on) do
		if regionOf[gi] then
			stands[fi] = true
		end
	end
	return regions, stands
end

return M
