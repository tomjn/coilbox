-- The ground a blueprint's terrain steps leave behind, by Zero-K's own rules.
-- A port of src/blueprint/terraform.ts (issue #4791), which holds the reasoning
-- and the line numbers in Zero-K's LuaRules/Gadgets/unit_terraform.lua that the
-- comments here refer to. lua/blueprint-widget/tests/terraform_test.lua runs the
-- same cases as terraform.test.ts. Change one and change the other.
--
-- Zero-K never makes a vertical cliff. It adds a slope round anything it raises
-- or digs, and stops short of any building already standing. The preview, the
-- cost and the marks on buildings all read this.
--
-- The engine's Lua numbers are 32 bit floats, so no key here is built into one
-- big number. Corners are held by their coordinates in the 8 elmo grid, in a
-- table of rows, which also avoids building a string for each corner.

local M = {}

local MAX_HEIGHT_DIFFERENCE = 28
local MAX_HEIGHT_DIFF_DOWN_INNER = 8
local MAX_EDGE_HEIGHT_DIFF = 4
local MAX_RAMP_GRADIENT = 5

local MAX_AREA_SIZE = 2000
local AREA_SEG_MAX_SIZE = 200
local MAX_WALL_POINTS = 700
local WALL_SEGMENT_LENGTH = 14
local MAX_RAMP_WIDTH = 200
local MAX_RAMP_LENGTH = 200
local MAX_TOTAL_RAMP_LENGTH = 3000
local MAX_TOTAL_RAMP_WIDTH = 800
local MIN_TOTAL_RAMP_LENGTH = 64
local MIN_TOTAL_RAMP_WIDTH = 48

local VOLUME_COST = 0.0128
local POINT_EXTRA_AREA_COST = 0
local POINT_EXTRA_AREA_COST_DEPTH = 14
local POINT_EXTRA_PERIMETER_COST = 0.15
local POINT_EXTRA_PERIMETER_COST_DEPTH = 10
local BASE_TERRAUNIT_COST = 6
local INBUILT_COST_MULT = 0.5
local PERIMETER_EDGE_COST = { [0] = 0, 1, 1.4, 1, 1 }

local SQUARE = 8
local floor, ceil, abs, min, max, sqrt = math.floor, math.ceil, math.abs, math.min, math.max, math.sqrt
local SQRT_2 = sqrt(2)

M.MAX_HEIGHT_DIFFERENCE = MAX_HEIGHT_DIFFERENCE

--------------------------------------------------------------------------------
-- A set of corners, by their place in the 8 elmo grid
--------------------------------------------------------------------------------

local function cx(x)
	return floor(x / SQUARE + 0.5)
end

local function getc(g, x, z)
	local row = g[cx(z)]
	return row and row[cx(x)]
end

local function setc(g, x, z, v)
	local iz = cx(z)
	local row = g[iz]
	if not row then
		row = {}
		g[iz] = row
	end
	row[cx(x)] = v
end

--- The ground, read the way Spring.GetGroundHeight reads a corner: clamped to
-- the map. current holds the corners a step has set, over what heightAt gives.
local function newReader(env)
	local columns, rows = env.corners and env.corners.x, env.corners and env.corners.z
	local overlay = {}
	local function clamp(x, z)
		local c, r = cx(x), cx(z)
		if columns then
			c = min(columns - 1, max(0, c))
			r = min(rows - 1, max(0, r))
		end
		return c, r
	end
	local reader = { overlay = overlay }
	function reader.original(x, z)
		local c, r = clamp(x, z)
		return env.heightAt(c * SQUARE, r * SQUARE)
	end
	function reader.at(x, z)
		local c, r = clamp(x, z)
		local row = overlay[r]
		local v = row and row[c]
		if v ~= nil then
			return v
		end
		return env.heightAt(c * SQUARE, r * SQUARE)
	end
	--- A write off the map goes nowhere, as Spring.SetHeightMap's does.
	function reader.set(x, z, h)
		local c, r = x / SQUARE, z / SQUARE
		if c ~= floor(c) or r ~= floor(r) then
			return
		end
		if columns and (c < 0 or r < 0 or c >= columns or r >= rows) then
			return
		end
		local row = overlay[r]
		if not row then
			row = {}
			overlay[r] = row
		end
		row[c] = h
	end
	return reader
end

--------------------------------------------------------------------------------
-- Buildings
--------------------------------------------------------------------------------

--- RegisterStructure, lines 3527-3563: the corners a building blocks, edges
-- included.
-- @param s table { x, z, xsize, zsize, facing }, the position and the
--   footprint in the engine's own units (half squares of 8 elmos), as a unit
--   def gives it
-- @param visit function(x, z) called for each corner
local function eachCorner(s, visit)
	local ux = floor((s.x + 4) / SQUARE) * SQUARE
	local uz = floor((s.z + 4) / SQUARE) * SQUARE
	local def = s.def
	local hx, hz = (s.xsize or (def and def.xsize) or 0) * 4, (s.zsize or (def and def.zsize) or 0) * 4
	if s.facing == 1 or s.facing == 3 then
		hx, hz = hz, hx
	end
	for x = ux - hx, ux + hx, SQUARE do
		for z = uz - hz, uz + hz, SQUARE do
			visit(x, z)
		end
	end
end

local function addStructure(blocked, s)
	eachCorner(s, function(x, z)
		setc(blocked, x, z, true)
	end)
end
M.addStructure = addStructure

--------------------------------------------------------------------------------
-- A step's points, as the gadget splits them into terraunits
--------------------------------------------------------------------------------

--- TerraformWall, lines 1095-1234.
local function wallSegments(mouse)
	local function snap(v)
		return floor((v + 8) / 16) * 16
	end
	local points = {}
	local prev = { x = snap(mouse[1].x), z = snap(mouse[1].z) }
	points[1] = prev
	for i = 2, #mouse do
		local nextPoint = { x = snap(mouse[i].x), z = snap(mouse[i].z) }
		local diffX, diffZ = nextPoint.x - prev.x, nextPoint.z - prev.z
		local absX, absZ = abs(diffX), abs(diffZ)
		if absX <= 16 and absZ <= 16 then
			points[#points + 1] = nextPoint
		elseif absX > absZ then
			local m, sign = diffZ / diffX, diffX / absX
			for j = 0, absX, 16 do
				points[#points + 1] = { x = prev.x + j * sign, z = floor((prev.z + j * m * sign) / 16) * 16 }
			end
		else
			local m, sign = diffX / diffZ, diffZ / absZ
			for j = 0, absZ, 16 do
				points[#points + 1] = { x = floor((prev.x + j * m * sign) / 16) * 16, z = prev.z + j * sign }
			end
		end
		if #points > MAX_WALL_POINTS then
			return nil
		end
		prev = nextPoint
	end

	local taken = {}
	local segments = {}
	local count = 0
	while count * WALL_SEGMENT_LENGTH < #points do
		local segment = {}
		local last = min((count + 1) * WALL_SEGMENT_LENGTH, #points)
		for j = count * WALL_SEGMENT_LENGTH + 1, last do
			for lx = -16, 16, SQUARE do
				for lz = -16, 16, SQUARE do
					local x, z = points[j].x + lx, points[j].z + lz
					if not getc(taken, x, z) then
						setc(taken, x, z, true)
						segment[#segment + 1] = { x = x, z = z }
					end
				end
			end
		end
		if #segment > 0 then
			segments[#segments + 1] = segment
		end
		count = count + 1
	end
	return segments
end

--- TerraformArea, lines 1489-1722.
local function areaSegments(mouse)
	local function snap(p)
		return { x = floor(p.x / 16) * 16, z = floor(p.z / 16) * 16 }
	end
	local loop = {}
	for i, p in ipairs(mouse) do
		loop[i] = snap(p)
	end
	loop[#loop + 1] = snap(mouse[1])
	local points = { loop[1] }
	local border = { left = loop[1].x, right = loop[1].x, top = loop[1].z, bottom = loop[1].z }
	local function add(p)
		points[#points + 1] = p
		border.left, border.right = min(border.left, p.x), max(border.right, p.x)
		border.top, border.bottom = min(border.top, p.z), max(border.bottom, p.z)
	end
	for i = 2, #loop do
		local nextPoint = loop[i]
		local diffX, diffZ = nextPoint.x - loop[i - 1].x, nextPoint.z - loop[i - 1].z
		local absX, absZ = abs(diffX), abs(diffZ)
		if absX <= 16 and absZ <= 16 then
			add(nextPoint)
		elseif absX > absZ then
			local m, sign = diffZ / diffX, diffX / absX
			for j = 0, absX, 16 do
				add({ x = nextPoint.x - j * sign, z = floor((nextPoint.z - j * m * sign) / 16) * 16 })
			end
		else
			local m, sign = diffX / diffZ, diffZ / absZ
			for j = 0, absZ, 16 do
				add({ x = floor((nextPoint.x - j * m * sign) / 16) * 16, z = nextPoint.z - j * sign })
			end
		end
		if border.right - border.left > MAX_AREA_SIZE or border.bottom - border.top > MAX_AREA_SIZE then
			return nil
		end
	end

	-- Lines 1549-1615. The cells are 16 elmos apart and kept by their place in
	-- the 16 elmo grid. 2 is the outline, 1 not yet reached, -1 the flood, false
	-- flooded. Whatever is still 1 or 2 is inside.
	local cell = {}
	local function key16(x, z)
		return floor(x / 16 + 0.5), floor(z / 16 + 0.5)
	end
	local function get16(x, z)
		local a, b = key16(x, z)
		local row = cell[b]
		return row and row[a]
	end
	local function set16(x, z, v)
		local a, b = key16(x, z)
		local row = cell[b]
		if not row then
			row = {}
			cell[b] = row
		end
		row[a] = v
	end
	for _, p in ipairs(points) do
		set16(p.x, p.z, 2)
	end
	for i = border.left, border.right, 16 do
		for j = border.top, border.bottom, 16 do
			if get16(i, j) ~= 2 then
				set16(i, j, 1)
			end
		end
	end
	for i = border.left, border.right, 16 do
		if get16(i, border.top) ~= 2 then
			set16(i, border.top, -1)
		end
		if get16(i, border.bottom) ~= 2 then
			set16(i, border.bottom, -1)
		end
	end
	for j = border.top, border.bottom, 16 do
		if get16(border.left, j) ~= 2 then
			set16(border.left, j, -1)
		end
		if get16(border.right, j) ~= 2 then
			set16(border.right, j, -1)
		end
	end
	local around = { { 16, 0 }, { -16, 0 }, { 0, 16 }, { 0, -16 } }
	local flooding = true
	while flooding do
		flooding = false
		for i = border.left, border.right, 16 do
			for j = border.top, border.bottom, 16 do
				if get16(i, j) == -1 then
					for _, d in ipairs(around) do
						if get16(i + d[1], j + d[2]) == 1 then
							set16(i + d[1], j + d[2], -1)
							flooding = true
						end
					end
					set16(i, j, false)
				end
			end
		end
	end
	local function inside(x, z)
		local v = get16(floor(x / 16) * 16, floor(z / 16) * 16)
		return v ~= nil and v ~= false
	end

	-- Lines 1619-1722, the split, including its overlap of 8 between blocks.
	local right = border.right + 16
	local bottom = border.bottom + 16
	local wCount = ceil((right - border.left) / AREA_SEG_MAX_SIZE) - 1
	local hCount = ceil((bottom - border.top) / AREA_SEG_MAX_SIZE) - 1
	local width = (right - border.left) / (wCount + 1)
	local height = (bottom - border.top) / (hCount + 1)
	local segments = {}
	local addX = 0
	for i = 0, wCount do
		local addZ = 0
		for j = 0, hCount do
			local segment = {}
			local xEnd = border.left + floor(width * (i + 1) / 8) * 8
			local zEnd = border.top + floor(height * (j + 1) / 8) * 8
			for lx = border.left + floor(width * i / 8) * 8 + addX, xEnd, 16 do
				for lz = border.top + floor(height * j / 8) * 8 + addZ, zEnd, 16 do
					if inside(lx, lz) then
						for x = lx, lx + 8, 8 do
							for z = lz, lz + 8, 8 do
								segment[#segment + 1] = { x = x, z = z }
							end
						end
						local px, pz = floor(lx / 16) * 16, floor(lz / 16) * 16
						local open, below = not inside(px + 16, pz), not inside(px, pz + 16)
						if open and below then
							segment[#segment + 1] = { x = lx + 16, z = lz + 16 }
						end
						if open then
							for z = lz, lz + 8, 8 do
								segment[#segment + 1] = { x = lx + 16, z = z }
							end
						end
						if below then
							for x = lx, lx + 8, 8 do
								segment[#segment + 1] = { x = x, z = lz + 16 }
							end
						end
					end
				end
			end
			addZ = 8
			if #segment > 0 then
				segments[#segments + 1] = segment
			end
		end
		addX = 8
	end
	return segments
end

--- TerraformRamp, lines 659-872. width is the band's whole width on the ground.
-- @return table[]? segments of { x, z, aim }
local function rampSegments(x1, y1, z1, x2In, y2, z2In, width)
	local x2, z2 = x2In, z2In
	if abs(x1 - x2) < 0.1 then
		x2 = x1 + 0.1
	end
	if abs(z1 - z2) < 0.1 then
		z2 = z1 + 0.1
	end
	local dis = sqrt((x1 - x2) ^ 2 + (z1 - z2) ^ 2)
	if dis < MIN_TOTAL_RAMP_LENGTH - 0.05 or dis > MAX_TOTAL_RAMP_LENGTH + 0.05 then
		return nil
	end
	if width < MIN_TOTAL_RAMP_WIDTH or width > MAX_TOTAL_RAMP_WIDTH * 2 then
		return nil
	end
	local xdis = abs(x1 - x2)
	local heightDiff = y2 - y1
	if heightDiff / dis > MAX_RAMP_GRADIENT then
		heightDiff = MAX_RAMP_GRADIENT * dis
	elseif heightDiff / dis < -MAX_RAMP_GRADIENT then
		heightDiff = -MAX_RAMP_GRADIENT * dis
	end
	local m = (z1 - z2) / (x1 - x2)
	local segmentsAlong = ceil(dis / MAX_RAMP_LENGTH)
	local segmentsAcross = ceil(width / MAX_RAMP_WIDTH)
	local segLength = dis / segmentsAlong
	local segWidth = width / segmentsAcross
	local widthScale = width / dis
	local lengthScale = segLength / dis
	local add = { x = (x2 - x1) * lengthScale, z = (z2 - z1) * lengthScale }
	local addPerp = { x = (z1 - z2) * segWidth / dis, z = -(x1 - x2) * segWidth / dis }
	local mid = { x = (x1 - x2) * widthScale / 2, z = (z1 - z2) * widthScale / 2 }
	local rightRot = { x = -mid.z + x1, z = mid.x + z1 }
	local function plus(a, b)
		return { x = a.x + b.x, z = a.z + b.z }
	end

	-- Lines 727-775: the four corners of a block, which depend on the quadrant.
	local topleftGrad, botleftGrad, toppoint, botpoint, leftpoint, rightpoint
	if x1 < x2 then
		if z1 < z2 then
			topleftGrad = -1 / m
			botleftGrad = m
			toppoint = rightRot
			leftpoint = plus(rightRot, addPerp)
			rightpoint = plus(toppoint, add)
			botpoint = plus(leftpoint, add)
		else
			topleftGrad = m
			botleftGrad = -1 / m
			leftpoint = rightRot
			botpoint = plus(rightRot, addPerp)
			rightpoint = plus(botpoint, add)
			toppoint = plus(rightRot, add)
		end
	elseif z1 < z2 then
		topleftGrad = m
		botleftGrad = -1 / m
		rightpoint = rightRot
		toppoint = plus(rightRot, addPerp)
		botpoint = plus(rightRot, add)
		leftpoint = plus(toppoint, add)
	else
		topleftGrad = -1 / m
		botleftGrad = m
		botpoint = rightRot
		rightpoint = plus(rightRot, addPerp)
		toppoint = plus(rightpoint, add)
		leftpoint = plus(rightRot, add)
	end

	-- Line 489, the height along the ramp at a corner.
	local function pointHeight(x, z)
		local xInt = (z - z1 + m * x1 + x / m) / (m + 1 / m)
		return abs(xInt - x1) / xdis * heightDiff + y1
	end
	local function along(l, x)
		return l.m * (x - l.x) + l.z
	end

	local segments = {}
	for i = 0, segmentsAlong - 1 do
		for j = 0, segmentsAcross - 1 do
			local middle = i > 0 and j > 0 and i < segmentsAlong - 1 and j < segmentsAcross - 1
			local offset = middle and 8 or 0
			local function shift(p)
				return { x = p.x + add.x * i + addPerp.x * j, z = p.z + add.z * i + addPerp.z * j }
			end
			local left, top, bot = shift(leftpoint), shift(toppoint), shift(botpoint)
			local borderLeft = floor(left.x / 8) * 8 - offset
			local borderRight = ceil(shift(rightpoint).x / 8) * 8 + offset
			local borderTop = floor(top.z / 8) * 8 - offset
			local topline1 = { x = left.x - offset, z = left.z - offset, m = topleftGrad }
			local topline2 = { x = top.x + offset, z = top.z - offset, m = botleftGrad }
			local botline1 = { x = left.x - offset, z = left.z + offset, m = botleftGrad }
			local botline2 = { x = bot.x + offset, z = bot.z + offset, m = topleftGrad }
			local topline, botline = topline1, botline1
			local segment = {}
			local lx = borderLeft - offset
			while lx <= borderRight + offset do
				local zmin = along(topline, lx)
				local zmax = along(botline, lx)
				local lz = borderTop
				while lz <= zmax do
					if zmin <= lz then
						segment[#segment + 1] = { x = lx, z = lz, aim = pointHeight(lx, lz) }
					end
					lz = lz + 8
				end
				lx = lx + 8
				if topline == topline1 and topline2.x < lx then
					topline = topline2
				end
				if botline == botline1 and botline2.x < lx then
					botline = botline2
				end
			end
			if #segment > 0 then
				segments[#segments + 1] = segment
			end
		end
	end
	return segments
end

--- A step's points as the gadget splits them into terraunits, each with its
-- target height, or nil when the gadget refuses the order.
-- @param step table a laid step: kind, shape, points, height or heights and
--   width
-- @param original function(x, z) the ground as it was when the order was given
-- @param pivot number the ground under the layout's pivot
local function stepSegments(step, original, pivot, pause)
	if step.kind == "ramp" then
		local a, b = step.points[1], step.points[2]
		local h1, h2 = 0, 0
		if step.heights then
			h1, h2 = step.heights[1], step.heights[2]
		end
		if not a or not b then
			return nil
		end
		return rampSegments(a.x, pivot + h1, a.z, b.x, pivot + h2, b.z, step.width or 0)
	end
	if #step.points == 0 then
		return nil
	end
	local segments
	if step.shape == "wall" then
		segments = wallSegments(step.points)
	else
		segments = areaSegments(step.points)
	end
	if not segments then
		return nil
	end
	local height = step.height or 0
	local function aim(x, z)
		if step.kind == "level" then
			-- line 1305: the ordered height, the pivot's ground plus the step's
			return pivot + height
		elseif step.kind == "raise" then
			-- line 1319: the step's height on top of the ground there
			return original(x, z) + height
		end
		-- smooth, lines 1329-1339: the average of the 5 by 5 corners round it
		local total = 0
		for lx = -16, 16, SQUARE do
			for lz = -16, 16, SQUARE do
				total = total + original(x + lx, z + lz)
			end
		end
		return total / 25
	end
	for _, segment in ipairs(segments) do
		for _, p in ipairs(segment) do
			p.aim = aim(p.x, p.z)
			pause()
		end
	end
	return segments
end

--------------------------------------------------------------------------------
-- The estimate
--------------------------------------------------------------------------------

--- The gadget's estimate for one step: totalCost + pyramidCostEstimate for each
-- block, lines 937-990, 1294-1410 and 1785-1897.
local function estimate(segments, original, mult, pause)
	local volumeCost = VOLUME_COST * mult * INBUILT_COST_MULT
	local perimeterCost = POINT_EXTRA_PERIMETER_COST * mult * INBUILT_COST_MULT
	local areaCostEach = POINT_EXTRA_AREA_COST * mult * INBUILT_COST_MULT
	local metal, pyramidTotal = 0, 0
	for _, segment in ipairs(segments) do
		local area = {}
		for _, p in ipairs(segment) do
			setc(area, p.x, p.z, true)
		end
		local volume, areaCost, perimeter, pyramid = 0, 0, 0, 0
		for _, p in ipairs(segment) do
			pause()
			local diff = abs(p.aim - original(p.x, p.z))
			volume = volume + diff
			areaCost = areaCost + min(diff, POINT_EXTRA_AREA_COST_DEPTH)
			local edges = 0
			if not getc(area, p.x + 8, p.z) then
				edges = edges + 1
			end
			if not getc(area, p.x - 8, p.z) then
				edges = edges + 1
			end
			if not getc(area, p.x, p.z + 8) then
				edges = edges + 1
			end
			if not getc(area, p.x, p.z - 8) then
				edges = edges + 1
			end
			perimeter = perimeter + PERIMETER_EDGE_COST[edges] * min(diff, POINT_EXTRA_PERIMETER_COST_DEPTH)
			if edges > 0 and diff > 30 then
				local steps = floor(diff / MAX_HEIGHT_DIFFERENCE)
				local rest = diff % MAX_HEIGHT_DIFFERENCE
				pyramid = pyramid + ((diff - rest) * (steps - 1) * 0.5 + steps * rest) * volumeCost
			end
		end
		if volume ~= 0 then
			local base = areaCost * areaCostEach + perimeter * perimeterCost + BASE_TERRAUNIT_COST
			metal = metal + volume * volumeCost + base + pyramid
			pyramidTotal = pyramidTotal + pyramid
		end
	end
	return metal, pyramidTotal
end

--------------------------------------------------------------------------------
-- Building a step
--------------------------------------------------------------------------------

--- GetHeightDiffLocal, lines 2553-2570: how far below its top a slope may be
-- this far from it. A dug slope starts with a gentler first square.
local function heightDiffLocal(xDiff, zDiff, inner)
	local per = MAX_HEIGHT_DIFFERENCE / 8
	if inner then
		if xDiff == 0 then
			return inner + (zDiff - 8) * per
		end
		if zDiff == 0 then
			return inner + (xDiff - 8) * per
		end
		return SQRT_2 * inner + sqrt((xDiff - 8) ^ 2 + (zDiff - 8) ^ 2) * per
	end
	if xDiff == 0 then
		return zDiff * per
	end
	if zDiff == 0 then
		return xDiff * per
	end
	return sqrt(xDiff ^ 2 + zDiff ^ 2) * per
end

--- Build one step on the ground as it stands, and write the result into it.
-- The points of every block are one set here. A block's own edges would point
-- into its neighbours, but each neighbour then sets its own points to target,
-- so the finished ground is the same.
-- @return table { outcome, shape = { { x, z, aim } }, slope = { { x, z, target,
--   steep } } }
local function build(segments, ground, blocked, pause)
	local points = {}
	local seen = {}
	-- Inside the step: true while the point is terraformed, false once it is cut
	-- back from a building, which still counts for thickness (line 2330).
	local area = {}
	for _, segment in ipairs(segments) do
		for _, p in ipairs(segment) do
			pause()
			if not getc(seen, p.x, p.z) then
				setc(seen, p.x, p.z, true)
				local structure = getc(blocked, p.x, p.z) == true
				-- SetupPointStructure, lines 425-435, and RegisterStructure, lines
				-- 3600-3612: a point under a building is left alone and is not area.
				points[#points + 1] = { x = p.x, z = p.z, aim = p.aim, or_ = ground.at(p.x, p.z), structure = structure, edges = nil }
				if not structure then
					setc(area, p.x, p.z, true)
				end
			end
		end
	end
	local function inArea(x, z)
		return getc(area, x, z) == true
	end
	local function terraformable(x, z)
		return getc(blocked, x, z) ~= true
	end

	-- CheckThickness, lines 2324-2382: a point needs enough of the step round
	-- it, or the gadget drops it.
	local function has(x, z)
		return getc(area, x, z) ~= nil
	end
	local function thick(x, z)
		if x % 16 == 8 then
			if z % 16 == 8 then
				local n = has(x, z - 16)
				local ne = has(x + 16, z - 16)
				local e = has(x + 16, z)
				local se = has(x + 16, z + 16)
				local s = has(x, z + 16)
				local sw = has(x - 16, z + 16)
				local w = has(x - 16, z)
				local nw = has(x - 16, z - 16)
				return (n and ne and e) or (ne and e and se) or (e and se and s) or (se and s and sw) or (s and sw and w) or (sw and w and nw) or (w and nw and n) or (nw and n and ne)
			end
			return has(x, z - 8) or has(x, z + 8)
		end
		if z % 16 == 8 then
			return has(x - 8, z) or has(x + 8, z)
		end
		return has(x - 8, z - 8) or has(x - 8, z + 8) or has(x + 8, z - 8) or has(x + 8, z + 8)
	end
	-- updateTerraformCost, lines 2387-2407.
	local function prune()
		local removed = true
		while removed do
			removed = false
			for _, p in ipairs(points) do
				pause()
				if not p.structure and not thick(p.x, p.z) then
					if getc(area, p.x, p.z) then
						setc(area, p.x, p.z, nil)
					end
					p.structure = true
					removed = true
				end
			end
		end
	end
	-- updateTerraformEdgePoints, lines 2249-2322.
	local function findEdges()
		for _, p in ipairs(points) do
			pause()
			if p.structure then
				p.edges = nil
			else
				local x, z = p.x, p.z
				local left = not inArea(x - 8, z)
				local right = not inArea(x + 8, z)
				local top = not inArea(x, z - 8)
				local bot = not inArea(x, z + 8)
				local edges = {}
				if left then
					edges[#edges + 1] = { x = x - 8, z = z, checkX = -8, checkZ = 0 }
					if top then
						edges[#edges + 1] = { x = x - 8, z = z - 8, checkX = -8, checkZ = -8 }
					end
					if bot then
						edges[#edges + 1] = { x = x - 8, z = z + 8, checkX = -8, checkZ = 8 }
					end
				end
				if right then
					edges[#edges + 1] = { x = x + 8, z = z, checkX = 8, checkZ = 0 }
					if top then
						edges[#edges + 1] = { x = x + 8, z = z - 8, checkX = 8, checkZ = -8 }
					end
					if bot then
						edges[#edges + 1] = { x = x + 8, z = z + 8, checkX = 8, checkZ = 8 }
					end
				end
				if top then
					edges[#edges + 1] = { x = x, z = z - 8, checkX = 0, checkZ = -8 }
				end
				if bot then
					edges[#edges + 1] = { x = x, z = z + 8, checkX = 0, checkZ = 8 }
				end
				p.edges = #edges > 0 and edges or nil
			end
		end
	end

	-- updateTerraform at full progress, lines 2640-2923. Returns "done" and the
	-- extras, "drop" and the id of the point to drop, or "cancel".
	local function slope()
		local extras = {}
		local at = {}

		-- Lines 2671-2683 and 2812-2824: the height a corner already has, and
		-- whether something on it already can be replaced.
		local function existing(x, z)
			local ground0 = ground.at(x, z)
			local overlap = getc(at, x, z)
			if overlap == nil then
				return ground0, ground0, nil, false
			end
			local supported = extras[overlap].support ~= nil
			return ground0, supported and extras[overlap].target or ground0, overlap, not supported
		end

		-- Lines 2741-2777 and 2875-2910: the 4 elmo lip at the foot of a slope.
		local function lip(x, z, lookX, lookZ, groundHere, parentGoal, pyramid)
			local border = nil
			if pyramid then
				if groundHere + MAX_EDGE_HEIGHT_DIFF < parentGoal then
					border = min(MAX_EDGE_HEIGHT_DIFF, parentGoal - groundHere + MAX_EDGE_HEIGHT_DIFF)
				end
			elseif groundHere - MAX_EDGE_HEIGHT_DIFF > parentGoal then
				border = min(MAX_EDGE_HEIGHT_DIFF, groundHere - MAX_EDGE_HEIGHT_DIFF - parentGoal)
			end
			if border == nil or inArea(lookX, lookZ) then
				return
			end
			local ahead = ground.at(lookX, lookZ)
			local wanted
			if pyramid then
				wanted = groundHere < ahead + border
			else
				wanted = groundHere > ahead - border
			end
			if getc(at, x, z) == nil and wanted and terraformable(x, z) then
				extras[#extras + 1] = { x = x, z = z, target = (pyramid and border or -border) + ahead, support = nil, checkX = 0, checkZ = 0, pyramid = pyramid }
				setc(at, x, z, #extras)
			end
		end

		-- The lip's height under a raised slope's foot, when the lip would be
		-- there. Zero-K builds the slope up over many updates and reads the ground
		-- again at each, so the lip goes in first and the slope's check (line
		-- 2693) then measures from it. A slope that would end below the lip ends
		-- on it instead (#4805).
		local function footHeight(lookX, lookZ, groundHere, parentGoal)
			if groundHere + MAX_EDGE_HEIGHT_DIFF >= parentGoal or inArea(lookX, lookZ) then
				return -math.huge
			end
			local border = min(MAX_EDGE_HEIGHT_DIFF, parentGoal - groundHere + MAX_EDGE_HEIGHT_DIFF)
			local ahead = ground.at(lookX, lookZ)
			if groundHere < ahead + border then
				return ahead + border
			end
			return -math.huge
		end

		-- Lines 2663-2781: the first square out from each edge of the step.
		for id = 1, #points do
			local p = points[id]
			pause()
			if p.edges then
				local newHeight = p.aim
				local pyramid = p.aim - p.or_ > 0
				for _, edge in ipairs(p.edges) do
					local x, z = edge.x, edge.z
					local ground0, edgeHeight, overlap, replaces = existing(x, z)
					local diagonal = edge.checkX ~= 0 and edge.checkZ ~= 0
					local base = pyramid and MAX_HEIGHT_DIFFERENCE or MAX_HEIGHT_DIFF_DOWN_INNER
					local maxDiff = diagonal and SQRT_2 * base or base
					local sign = pyramid and 1 or -1
					local diff = newHeight - edgeHeight
					if (pyramid and diff > maxDiff) or (not pyramid and diff < -maxDiff) then
						local index = #extras + 1
						if overlap ~= nil then
							if not replaces and extras[overlap].pyramid ~= pyramid then
								return "cancel"
							end
							index = overlap
						end
						local target = newHeight - sign * maxDiff
						if pyramid then
							target = max(target, footHeight(x + edge.checkX, z + edge.checkZ, ground0, p.aim))
						end
						extras[index] = { x = x, z = z, target = target, support = { x = p.x, z = p.z, h = newHeight, id = id }, checkX = edge.checkX, checkZ = edge.checkZ, pyramid = pyramid }
						if not terraformable(x, z) then
							return "drop", id
						end
						setc(at, x, z, index)
					else
						lip(x, z, x + edge.checkX, z + edge.checkZ, ground0, p.aim, pyramid)
					end
				end
			end
		end

		-- Lines 2785-2921: each sloped corner carries the slope on outward, along
		-- the way its edge faces, until the slope meets the ground. The list grows
		-- as this runs.
		local i = 1
		while i <= #extras do
			local from = extras[i]
			pause()
			local support = from.support
			if support then
				local directions = {}
				if from.checkX ~= 0 then
					directions[#directions + 1] = { from.checkX, 0 }
				end
				if from.checkZ ~= 0 then
					directions[#directions + 1] = { 0, from.checkZ }
				end
				for _, d in ipairs(directions) do
					local diffX, diffZ = d[1], d[2]
					local x, z = from.x + diffX, from.z + diffZ
					if not inArea(x, z) then
						local ground0, edgeHeight, overlap, replaces = existing(x, z)
						local allowed = heightDiffLocal(abs(x - support.x), abs(z - support.z), (not from.pyramid) and MAX_HEIGHT_DIFF_DOWN_INNER or nil)
						local sign = from.pyramid and 1 or -1
						local diff = support.h - edgeHeight
						if (from.pyramid and diff > allowed) or (not from.pyramid and diff < -allowed) then
							local index = #extras + 1
							if overlap ~= nil then
								if not replaces and extras[overlap].pyramid ~= from.pyramid then
									return "cancel"
								end
								index = overlap
							end
							local target = support.h - sign * allowed
							if from.pyramid then
								target = max(target, footHeight(x + diffX, z + diffZ, ground0, from.target))
							end
							extras[index] = { x = x, z = z, target = target, support = support, checkX = from.checkX, checkZ = from.checkZ, pyramid = from.pyramid }
							if not terraformable(x, z) then
								return "drop", support.id
							end
							setc(at, x, z, index)
						else
							lip(x, z, x + diffX, z + diffZ, ground0, from.target, from.pyramid)
						end
					end
				end
			end
			i = i + 1
		end
		return "done", extras
	end

	-- finishInitialisingTerraformUnit, line 2531, then DoTerraformUpdate's
	-- retries, lines 3179-3192: a point whose slope would reach a building is
	-- dropped, and the slope is worked out again without it. Each retry drops a
	-- point, so this ends.
	prune()
	findEdges()
	local kind, extra = slope()
	while kind == "drop" do
		local dropped = points[extra]
		dropped.structure = true
		if getc(area, dropped.x, dropped.z) then
			setc(area, dropped.x, dropped.z, false)
		end
		prune()
		findEdges()
		kind, extra = slope()
	end
	if kind == "cancel" then
		return { outcome = "cancelled", shape = {}, slope = {} }
	end

	-- The height map function, lines 2995-3004: the step's points, then the
	-- slope over them.
	local shape = {}
	for _, p in ipairs(points) do
		if not p.structure then
			ground.set(p.x, p.z, p.aim)
			shape[#shape + 1] = { x = p.x, z = p.z, aim = p.aim }
		end
	end
	local slopes = {}
	for _, e in ipairs(extra) do
		ground.set(e.x, e.z, e.target)
		slopes[#slopes + 1] = { x = e.x, z = e.z, target = e.target, steep = e.support ~= nil }
	end
	return { outcome = "built", shape = shape, slope = slopes }
end

--------------------------------------------------------------------------------
-- A layout's steps
--------------------------------------------------------------------------------

--- Start working out ground. Steps are added with session.apply, each layout in
-- the order it was given, on the ground the layouts before it left.
-- @param env table { heightAt = function(x, z), corners = { x, z }?, structures
--   = table[] or function(minX, minZ, maxX, maxZ) -> table[], costMult =
--   number?, pause = function()? }. corners is how many heightmap corners the map has each way, so
--   reads and writes stay on the map. structures are the buildings standing
--   now, each { x, z, xsize, zsize, facing }. A function is asked once for each
--   layout, for the buildings that could stop its slopes. pause is called
--   once for each corner worked on, so a caller running the
--   session in a coroutine can yield there and spread a large layout over
--   several frames.
-- @return table session
function M.session(env)
	local reader = newReader(env)
	local pause = env.pause or function() end
	local blocked = {}
	if type(env.structures) == "table" then
		for _, s in ipairs(env.structures) do
			addStructure(blocked, s)
		end
	end
	local session = { metal = 0, work = 0, results = {}, reader = reader, blocked = blocked }

	--- Add one layout's steps.
	-- @param steps table[] laid steps. Each has after, how many of foot come
	--   ahead of it, and base, the ground under the layout's pivot.
	-- @param foot table[]? the layout's buildings, each { x, z, xsize, zsize,
	--   facing } (or def.xsize and def.zsize), numbered by seq or by place. Those
	--   numbered up to a step's after are standing when it is built, and a slope
	--   stops short of them.
	-- @return table[] a result for each step, in the order it was built
	function session.apply(steps, foot)
		foot = foot or {}
		local order = {}
		for i = 1, #steps do
			order[i] = i
		end
		table.sort(order, function(a, b)
			local sa, sb = steps[a].after or 0, steps[b].after or 0
			if sa ~= sb then
				return sa < sb
			end
			return a < b
		end)

		-- every step's points and estimate come first, from the ground as it is
		-- now, since that is when the gadget works them out
		local prepared = {}
		local minX, minZ, maxX, maxZ = math.huge, math.huge, -math.huge, -math.huge
		for _, index in ipairs(order) do
			local step = steps[index]
			local pivot = step.base or reader.original(step.points[1].x, step.points[1].z)
			local segments = stepSegments(step, reader.original, pivot, pause)
			prepared[index] = { segments = segments }
			if segments then
				prepared[index].metal, prepared[index].pyramid = estimate(segments, reader.original, env.costMult or 1, pause)
				local most = 0
				for _, segment in ipairs(segments) do
					for _, p in ipairs(segment) do
						minX, maxX = min(minX, p.x), max(maxX, p.x)
						minZ, maxZ = min(minZ, p.z), max(maxZ, p.z)
						most = max(most, abs(p.aim - reader.original(p.x, p.z)))
					end
				end
				prepared[index].reach = M.reach(most)
			end
		end
		if type(env.structures) == "function" and minX ~= math.huge then
			local reach = 0
			for _, p in pairs(prepared) do
				reach = max(reach, p.reach or 0)
			end
			for _, s in ipairs(env.structures(minX - reach, minZ - reach, maxX + reach, maxZ + reach) or {}) do
				addStructure(blocked, s)
			end
		end

		-- the layout's own buildings stand only once they are built, so they go
		-- into a copy
		local copy = {}
		for iz, row in pairs(blocked) do
			local r = {}
			for ix, v in pairs(row) do
				r[ix] = v
			end
			copy[iz] = r
		end
		local bySeq = {}
		for i, b in ipairs(foot) do
			bySeq[#bySeq + 1] = { seq = b.seq or i, building = b }
		end
		table.sort(bySeq, function(a, b)
			return a.seq < b.seq
		end)
		local built = 0
		local out = {}
		for _, index in ipairs(order) do
			local step = steps[index]
			while bySeq[built + 1] and bySeq[built + 1].seq <= (step.after or 0) do
				built = built + 1
				addStructure(copy, bySeq[built].building)
			end
			local segments = prepared[index].segments
			local result
			if not segments then
				result = { index = index, outcome = "refused", metal = 0, shape = {}, slope = {} }
			else
				local done = build(segments, reader, copy, pause)
				done.index, done.metal = index, prepared[index].metal
				-- What the builders spend doing it. The estimate guesses the volume
				-- of the slope from its height, and the work is the ground the slope
				-- actually moves, which is more for a wall and about the same for a
				-- pad (measured in #4797).
				local moved = 0
				for _, e in ipairs(done.slope) do
					moved = moved + abs(e.target - reader.original(e.x, e.z))
				end
				done.work = prepared[index].metal - prepared[index].pyramid + moved * VOLUME_COST * (env.costMult or 1) * INBUILT_COST_MULT
				session.metal = session.metal + done.metal
				session.work = session.work + done.work
				result = done
			end
			out[#out + 1] = result
			session.results[#session.results + 1] = result
		end
		return out
	end

	--- The corners a step has changed, as set by the steps so far.
	-- @return table[] { x, z } of every corner whose height differs from the
	--   ground as it was
	function session.changed()
		local list = {}
		for iz, row in pairs(reader.overlay) do
			for ix, h in pairs(row) do
				pause()
				local x, z = ix * SQUARE, iz * SQUARE
				if abs(h - reader.original(x, z)) >= 0.5 then
					list[#list + 1] = { x = x, z = z, h = h }
				end
			end
		end
		return list
	end

	--- The ground at any point once every step so far is built: the height the
	-- map gives, plus how far the steps moved the four corners around it. The
	-- corners are blended the way the engine's ground is, a square cut along the
	-- diagonal from top right to bottom left (Map/Ground.cpp), so a point the
	-- steps did not touch reads exactly what env.heightAt gives. A building uses
	-- this wherever its step comes in the build order, because the preview shows
	-- the result.
	-- @return number
	function session.heightAt(x, z)
		local base = env.heightAt(x, z)
		if next(reader.overlay) == nil then
			return base
		end
		local c, r = floor(x / SQUARE), floor(z / SQUARE)
		local fx, fz = x / SQUARE - c, z / SQUARE - r
		local function moved(dc, dr)
			local px, pz = (c + dc) * SQUARE, (r + dr) * SQUARE
			return reader.at(px, pz) - reader.original(px, pz)
		end
		local d
		if fx + fz <= 1 then
			d = moved(0, 0) * (1 - fx - fz) + moved(1, 0) * fx + moved(0, 1) * fz
		else
			d = moved(1, 1) * (fx + fz - 1) + moved(1, 0) * (1 - fz) + moved(0, 1) * (1 - fx)
		end
		return base + d
	end

	return session
end

--- Which of some buildings stand on a slope that a step built, which a
-- building may not do.
-- @param results table[] from session.apply
-- @param foot table[] buildings, each { x, z, xsize, zsize, facing } or with a def
-- @return boolean[] by place in foot
function M.onSlope(results, foot)
	local steep = {}
	local any = false
	for _, r in ipairs(results) do
		for _, e in ipairs(r.slope) do
			if e.steep then
				setc(steep, e.x, e.z, true)
				any = true
			end
		end
	end
	local out = {}
	for i, b in ipairs(foot) do
		local hit = false
		if any then
			eachCorner(b, function(x, z)
				if getc(steep, x, z) then
					hit = true
				end
			end)
		end
		out[i] = hit
	end
	return out
end

--- How far out from a step's points a slope can reach, for finding the
-- buildings that can stop it.
-- @param height number the biggest change the step makes, in elmos
function M.reach(height)
	return SQUARE * (ceil(abs(height) / MAX_HEIGHT_DIFFERENCE) + 3)
end

--- Work out a layout's steps on their own.
-- @return table { metal, steps, session }
function M.terraform(env, steps, foot)
	local session = M.session(env)
	local results = session.apply(steps, foot)
	return { metal = session.metal, steps = results, session = session }
end

return M
