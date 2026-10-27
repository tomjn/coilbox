-- Run: luajit lua/blueprint-widget/tests/ground_test.lua
--
-- Reading ground changes back as raise steps (issue #4798), on made-up grids.
--
-- Each grid holds the change in height at every 8 elmo corner, as the widget
-- reads it from GetGroundHeight minus GetGroundOrigHeight. The raised and dug
-- shapes are drawn the way Zero-K's terraform gadget leaves them: a top of 16
-- elmo cells, and round it a slope one corner wide per ring. A raised slope
-- drops by up to 28 a ring and ends in a step of 4, as measured in a real
-- match on issue #4789. A dug slope rises by 8 in its first ring and then as a
-- raised one does.
--
-- Every test checks the steps against what the gadget would raise for them:
-- areaCells is a copy of how it fills an area outline, so a step whose
-- outline it would fill differently is caught here rather than in a match.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, show = support.check, support.show
local GROUND = support.module("ground.lua")

-- The tolerance the widget uses, measured in two real matches (see
-- ground.lua): over the 7.7 elmo dent Zero-K left where two terraform blocks
-- of one wall met, and under the 28 a raised top drops to its first ring.
local TOL = GROUND.TOLERANCE
check("the tolerance keeps a 7.7 elmo dent in a top and leaves out the ring 28 below it", TOL >= 7.7 and TOL < 28, tostring(TOL))

--------------------------------------------------------------------------------
-- grids
--------------------------------------------------------------------------------

--- A grid of corners from (x, z), w by h, all unchanged.
local function grid(x, z, w, h)
	local g = { x = x, z = z, w = w, h = h, delta = {} }
	for k = 1, w * h do
		g.delta[k] = 0
	end
	return g
end

local function index(g, x, z)
	local i, j = (x - g.x) / 8, (z - g.z) / 8
	if i < 0 or j < 0 or i >= g.w or j >= g.h or i ~= math.floor(i) or j ~= math.floor(j) then
		return nil
	end
	return j * g.w + i + 1
end

local function set(g, x, z, v)
	local k = index(g, x, z)
	if k then
		g.delta[k] = v
	end
end

local function get(g, x, z)
	local k = index(g, x, z)
	return k and g.delta[k] or 0
end

--- The heights of a slope going out from a top of height h, ring by ring.
local function slopeRings(h, dug)
	local rings = {}
	local sign = h < 0 and -1 or 1
	local v = math.abs(h)
	if dug then
		v = v - 8
		if v > 4 then
			rings[#rings + 1] = sign * v
		end
	end
	while v - 28 > 4 do
		v = v - 28
		rings[#rings + 1] = sign * v
	end
	if math.abs(h) > 4 then
		rings[#rings + 1] = sign * 4
	end
	return rings
end

--- Change the corners of a set (keyed "x:z") to h, and draw the slope round
-- them. A slope corner keeps whichever change is further from 0, so slopes
-- that meet do as the gadget's do and never cut into a top.
local function shape(g, corners, h, dug)
	local rings = slopeRings(h, dug)
	local tops = {}
	for key in pairs(corners) do
		local x, z = key:match("^(-?%d+):(-?%d+)$")
		x, z = tonumber(x), tonumber(z)
		tops[#tops + 1] = { x = x, z = z }
		set(g, x, z, h)
	end
	for _, t in ipairs(tops) do
		for r, v in ipairs(rings) do
			for dx = -r, r do
				for dz = -r, r do
					if math.max(math.abs(dx), math.abs(dz)) == r then
						local x, z = t.x + dx * 8, t.z + dz * 8
						if not corners[x .. ":" .. z] and math.abs(v) > math.abs(get(g, x, z)) then
							set(g, x, z, v)
						end
					end
				end
			end
		end
	end
end

--- The corners of a rectangle, both ends included.
local function rectCorners(x0, z0, x1, z1, into)
	into = into or {}
	for x = x0, x1, 8 do
		for z = z0, z1, 8 do
			into[x .. ":" .. z] = true
		end
	end
	return into
end

--- The corners a Zero-K wall raises: 5 by 5 round each point of its path.
local function wallCorners(points, into)
	into = into or {}
	for _, p in ipairs(points) do
		rectCorners(p.x - 16, p.z - 16, p.x + 16, p.z + 16, into)
	end
	return into
end

--- The corners the steps would raise, each the gadget's own fill of its
-- outline, and the corners two steps both raise.
local function raised(regions)
	local all, twice = {}, {}
	for _, r in ipairs(regions) do
		for key in pairs(GROUND.cellCorners(GROUND.areaCells(r.points))) do
			if all[key] then
				twice[key] = true
			end
			all[key] = true
		end
	end
	return all, twice
end

local function count(set)
	local n = 0
	for _ in pairs(set) do
		n = n + 1
	end
	return n
end

local function sameSet(a, b)
	for k in pairs(a) do
		if not b[k] then
			return false, "extra " .. k
		end
	end
	for k in pairs(b) do
		if not a[k] then
			return false, "missing " .. k
		end
	end
	return true
end

local function heights(regions)
	local out = {}
	for i, r in ipairs(regions) do
		out[i] = r.height
	end
	table.sort(out)
	return table.concat(out, ",")
end

--------------------------------------------------------------------------------
-- the gadget's fill
--------------------------------------------------------------------------------

do
	local cells = GROUND.areaCells({ { x = 64, z = 96 }, { x = 176, z = 96 }, { x = 176, z = 112 }, { x = 64, z = 112 } })
	local corners = GROUND.cellCorners(cells)
	check("a rectangle outline fills its cells and one more to the right and below", count(cells) == 16, tostring(count(cells)))
	local ok, why = sameSet(corners, rectCorners(64, 96, 192, 128))
	check("a rectangle outline raises the corners from its first point to its last plus 16", ok, why)
	local snapped = GROUND.areaCells({ { x = 70, z = 100 }, { x = 180, z = 100 }, { x = 180, z = 120 }, { x = 70, z = 120 } })
	check("the fill snaps an outline down to 16 elmos, as the gadget does", sameSet(snapped, cells))
end

--------------------------------------------------------------------------------
-- one shape at a time
--------------------------------------------------------------------------------

do
	-- a straight wall raised by 112, from a Zero-K path along x
	local g = grid(0, 0, 60, 40)
	local top = wallCorners({ { x = 96, z = 160 }, { x = 112, z = 160 }, { x = 128, z = 160 }, { x = 144, z = 160 }, { x = 160, z = 160 } })
	shape(g, top, 112)
	local regions = GROUND.find(g, { tolerance = TOL })
	check("a wall is one step", #regions == 1, show(regions))
	check("the wall's step raises by the wall's height", regions[1] and regions[1].height == 112, show(regions[1]))
	local got, twice = raised(regions)
	local ok, why = sameSet(got, top)
	check("the wall's step raises its top and none of its slope", ok, why)
	check("nothing is raised twice", count(twice) == 0)
	check("a straight wall is four points", regions[1] and #regions[1].points == 4, show(regions[1] and regions[1].points))
end

do
	-- a flattened pad, level 40 above the flat ground it was made on
	local g = grid(200, 200, 40, 40)
	local top = rectCorners(256, 256, 352, 352)
	shape(g, top, 40)
	local regions = GROUND.find(g, { tolerance = TOL })
	check("a pad is one step", #regions == 1 and regions[1].height == 40, show(regions))
	local ok, why = sameSet((raised(regions)), top)
	check("the pad's step covers the pad and not its slope", ok, why)
end

do
	-- a trench dug 48 deep, with the gentler first ring a dug slope has
	local g = grid(0, 0, 100, 30)
	local top = rectCorners(400, 48, 560, 96)
	shape(g, top, -48, true)
	local regions = GROUND.find(g, { tolerance = TOL })
	check("a trench is one step that digs", #regions == 1 and regions[1].height == -48, show(regions))
	local ok, why = sameSet((raised(regions)), top)
	check("the trench's step covers its floor and not its sides", ok, why)
end

do
	-- a diagonal wall: each path point 16 along and 16 down from the last
	local path = {}
	for k = 0, 8 do
		path[#path + 1] = { x = 160 + 16 * k, z = 160 + 16 * k }
	end
	local g = grid(64, 64, 60, 60)
	local top = wallCorners(path)
	shape(g, top, 84)
	local regions = GROUND.find(g, { tolerance = TOL })
	check("a diagonal wall is one step", #regions == 1, show(regions))
	local ok, why = sameSet((raised(regions)), top)
	check("the diagonal wall's step raises the same staircase", ok, why)
	check("the diagonal wall's outline is a few corners, not one per cell", regions[1] and #regions[1].points <= 8, tostring(regions[1] and #regions[1].points))
end

do
	-- two walls meeting at a corner, the same height
	local g = grid(0, 0, 60, 60)
	local top = wallCorners({ { x = 96, z = 96 }, { x = 112, z = 96 }, { x = 128, z = 96 }, { x = 144, z = 96 }, { x = 160, z = 96 } })
	wallCorners({ { x = 96, z = 112 }, { x = 96, z = 128 }, { x = 96, z = 144 }, { x = 96, z = 160 } }, top)
	shape(g, top, 70)
	local regions = GROUND.find(g, { tolerance = TOL })
	check("an L of wall is one step", #regions == 1 and regions[1].height == 70, show(regions))
	local ok, why = sameSet((raised(regions)), top)
	check("the L's step raises the L", ok, why)
	-- six corners, and one more where the outline cuts the inside corner on a
	-- diagonal, which fills the same cells
	check("the L's outline has at most seven points", regions[1] and #regions[1].points <= 7, show(regions[1] and regions[1].points))
end

do
	-- a closed ring of wall round a square of untouched ground
	local g = grid(0, 0, 60, 60)
	local top = rectCorners(96, 96, 288, 128)
	rectCorners(96, 256, 288, 288, top)
	rectCorners(96, 96, 128, 288, top)
	rectCorners(256, 96, 288, 288, top)
	shape(g, top, 112)
	local regions = GROUND.find(g, { tolerance = TOL })
	check("a ring of wall becomes more than one step, since an area cannot have a hole", #regions >= 2, show(regions))
	local got, twice = raised(regions)
	local ok, why = sameSet(got, top)
	check("the ring's steps raise the ring and leave the middle alone", ok, why)
	-- steps may share the corners along the line they were split on, which
	-- raises them to the same height either way
	local shared = true
	for key in pairs(twice) do
		shared = shared and top[key] == true
	end
	check("steps of a ring only overlap on the ring", shared)
	for _, r in ipairs(regions) do
		check("every ring step raises by 112", r.height == 112, show(r))
	end
end

--------------------------------------------------------------------------------
-- buildings, noise and edges
--------------------------------------------------------------------------------

do
	-- a turret on a wall, its footprint levelled a little off the wall's top
	local g = grid(0, 0, 60, 40)
	local top = wallCorners({ { x = 96, z = 160 }, { x = 112, z = 160 }, { x = 128, z = 160 }, { x = 144, z = 160 }, { x = 160, z = 160 } })
	shape(g, top, 112)
	for x = 112, 144, 8 do
		for z = 144, 176, 8 do
			set(g, x, z, 109.5)
		end
	end
	-- and a solar collector on the flat ground beside it, levelled by the
	-- engine into a bump of a few elmos
	for x = 304, 336, 8 do
		for z = 200, 232, 8 do
			set(g, x, z, ((x + z) % 3) * 2 - 1)
		end
	end
	local footprints = { { x0 = 112, z0 = 144, x1 = 144, z1 = 176 }, { x0 = 304, z0 = 200, x1 = 336, z1 = 232 } }
	local regions, on = GROUND.find(g, { tolerance = TOL, footprints = footprints })
	check("a turret on a wall leaves the wall one step", #regions == 1 and regions[1].height == 112, show(regions))
	local ok, why = sameSet((raised(regions)), top)
	check("the turret's footprint is part of the wall's step", ok, why)
	check("the turret stands on the step and the solar does not", on[1] == true and not on[2], show(on))
end

do
	-- a building levelled into the ground with a change too big for the
	-- tolerance, on its own: nothing round it says it was terraformed
	local g = grid(0, 0, 30, 30)
	for x = 64, 128, 8 do
		for z = 64, 128, 8 do
			set(g, x, z, 18)
		end
	end
	local regions = GROUND.find(g, { tolerance = TOL, footprints = { { x0 = 64, z0 = 64, x1 = 128, z1 = 128 } } })
	check("ground changed only under a building is not a step", #regions == 0, show(regions))
end

do
	-- slopes and nothing else, as round a wall that was cut out of the grid
	local g = grid(0, 0, 40, 40)
	for _, v in ipairs({ { 80, 84 }, { 88, 56 }, { 96, 28 }, { 104, 4 } }) do
		for z = 0, 312, 8 do
			set(g, v[1], z, v[2])
		end
	end
	check("slopes on their own are not steps", #GROUND.find(g, { tolerance = TOL }) == 0)
end

do
	-- untouched ground reads exactly 0, so any other change is a change, even
	-- one smaller than the tolerance
	local g = grid(0, 0, 30, 30)
	shape(g, rectCorners(64, 64, 160, 160), 3)
	local regions = GROUND.find(g, { tolerance = TOL })
	check("a raise smaller than the tolerance is still a step", #regions == 1 and regions[1].height == 3, show(regions))
end

do
	-- a wall placed as an area on rough ground in a real match, where its
	-- two terraform blocks met: four corners left 2 to 7.7 below the top
	local g = grid(0, 0, 60, 40)
	local top = rectCorners(96, 144, 304, 176)
	shape(g, top, 112)
	set(g, 200, 152, 105.0)
	set(g, 208, 152, 104.3)
	set(g, 200, 160, 109.9)
	set(g, 208, 160, 108.2)
	local regions = GROUND.find(g, { tolerance = TOL })
	local all112 = #regions > 0
	for _, r in ipairs(regions) do
		all112 = all112 and r.height == 112
	end
	check("a dent where two terraform blocks met leaves the wall at one height", all112, show(regions))
	local ok, why = sameSet((raised(regions)), top)
	check("the dented wall's steps raise the whole wall", ok, why)
end

do
	-- a narrow trench, where the first ring of its sides, 8 above the floor,
	-- has more corners than the floor itself
	local g = grid(0, 0, 40, 20)
	local top = rectCorners(64, 64, 96, 80)
	shape(g, top, -30, true)
	local regions = GROUND.find(g, { tolerance = TOL })
	check("a narrow trench digs to its floor, not to the ring round it", #regions == 1 and regions[1].height == -30, show(regions))
end

do
	-- two walls of different heights side by side, slopes and all
	local g = grid(0, 0, 80, 40)
	local high = rectCorners(64, 96, 192, 128)
	local low = rectCorners(208, 96, 336, 128)
	shape(g, high, 112)
	shape(g, low, 70)
	-- the high wall's slope runs over the low wall's top, which the gadget
	-- stops at; put the low top back
	for key in pairs(low) do
		local x, z = key:match("^(%d+):(%d+)$")
		set(g, tonumber(x), tonumber(z), 70)
	end
	local regions = GROUND.find(g, { tolerance = TOL })
	check("walls of two heights are two steps", heights(regions) == "70,112", heights(regions))
	local both = {}
	for k in pairs(high) do
		both[k] = true
	end
	for k in pairs(low) do
		both[k] = true
	end
	local ok, why = sameSet((raised(regions)), both)
	check("each raises its own top", ok, why)
end

do
	-- a grid that starts off the 16 elmo lines, and a wall cut by its edge
	local g = grid(8, 8, 30, 30)
	local top = rectCorners(96, 96, 288, 128)
	shape(g, top, 56)
	local regions = GROUND.find(g, { tolerance = TOL })
	local inside = {}
	for k in pairs(top) do
		local x = tonumber(k:match("^(%d+):"))
		if x <= 8 + 29 * 8 then
			inside[k] = true
		end
	end
	check("a wall cut by the grid's edge is one step", #regions == 1 and regions[1].height == 56, show(regions))
	local ok, why = sameSet((raised(regions)), inside)
	check("the cut wall's step covers the wall up to the grid's edge", ok, why)
end

do
	-- A wall too long for one of the gadget's terraform blocks. The gadget
	-- fills every block after the first 8 elmos off the 16 grid, which in a
	-- real match raised a wall saved as one area 8 elmos past its end, so a
	-- step never spans more than one block.
	local g = grid(0, 0, 80, 20)
	local top = rectCorners(16, 32, 576, 64)
	shape(g, top, 30)
	local regions = GROUND.find(g, { tolerance = TOL })
	check("a wall longer than one terraform block is split", #regions >= 3, show(regions))
	local widest, tallest = 0, 0
	for _, r in ipairs(regions) do
		local x0, x1, z0, z1 = math.huge, -math.huge, math.huge, -math.huge
		for _, p in ipairs(r.points) do
			x0, x1 = math.min(x0, p.x), math.max(x1, p.x)
			z0, z1 = math.min(z0, p.z), math.max(z1, p.z)
		end
		widest, tallest = math.max(widest, x1 - x0), math.max(tallest, z1 - z0)
	end
	check("no piece spans more than one block of 200, its cells and the 16 the gadget adds", widest + 16 <= 200 and tallest + 16 <= 200, widest .. " by " .. tallest)
	local ok, why = sameSet((raised(regions)), top)
	check("the pieces raise the whole wall", ok, why)
end

do
	-- every area has the three points a step needs, even a single cell
	local g = grid(0, 0, 20, 20)
	shape(g, rectCorners(64, 64, 80, 80), 50)
	local regions = GROUND.find(g, { tolerance = TOL })
	check("a single cell is one step", #regions == 1, show(regions))
	check("a single cell's outline still has three points", regions[1] and #regions[1].points >= 3, show(regions[1]))
	local ok, why = sameSet((raised(regions)), rectCorners(64, 64, 80, 80))
	check("the single cell raises its nine corners", ok, why)
end

support.report()
